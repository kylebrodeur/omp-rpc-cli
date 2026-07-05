#!/usr/bin/env node
// pi-acp — drive a long-running Oh My Pi (omp) ACP session from the shell.
import { Command } from "commander";
import net from "node:net";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SOCK_PATH,
  PID_PATH,
  META_PATH,
  LOG_PATH,
  RUNTIME_DIR,
  MODEL_ALIASES,
  resolveModel,
  DEFAULT_MODEL,
} from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(__dirname, "..", "src", "daemon.js");

const program = new Command();
program
  .name("pi-acp")
  .description("Long-running omp ACP session you can send tasks to")
  .version("0.1.0");

// --- helpers -------------------------------------------------------------

function isRunning() {
  if (!fs.existsSync(PID_PATH) || !fs.existsSync(SOCK_PATH)) return false;
  const pid = Number(fs.readFileSync(PID_PATH, "utf8").trim());
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return pid;
  } catch {
    return false;
  }
}

// Connect to the daemon socket and stream newline-delimited JSON responses.
function request(payload, { onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(SOCK_PATH);
    let buf = "";
    const events = [];
    conn.on("connect", () => conn.write(JSON.stringify(payload) + "\n"));
    conn.on("data", (c) => {
      buf += c.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        events.push(ev);
        onEvent?.(ev);
      }
    });
    conn.on("end", () => resolve(events));
    conn.on("close", () => resolve(events));
    conn.on("error", reject);
  });
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

// --- commands ------------------------------------------------------------

program
  .command("start")
  .description("Start the background daemon holding an omp ACP session open")
  .option("-m, --model <model>", `model alias or omp id (aliases: ${Object.keys(MODEL_ALIASES).join(", ")})`)
  .option("-c, --cwd <dir>", "working directory for the omp session", process.cwd())
  .option("--mode <mode>", "session mode: default | plan", "default")
  .action(async (opts) => {
    const running = isRunning();
    if (running) die(`already running (pid ${running}). Use 'pi-acp stop' first.`);

    const model = resolveModel(opts.model);
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const out = fs.openSync(LOG_PATH, "a");
    const child = spawn(process.execPath, [DAEMON], {
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        PI_ACP_MODEL: model,
        PI_ACP_CWD: opts.cwd,
        PI_ACP_MODE: opts.mode,
      },
    });
    child.unref();

    // Wait for the socket + a status reply.
    process.stdout.write("starting");
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 150));
      process.stdout.write(".");
      if (isRunning()) {
        try {
          const events = await request({ cmd: "status" });
          const s = events.find((e) => e.type === "status");
          console.log("\n✓ pi-acp running");
          console.log(`  pid:     ${s.pid}`);
          console.log(`  model:   ${model}`);
          console.log(`  cwd:     ${opts.cwd}`);
          console.log(`  mode:    ${opts.mode}`);
          console.log(`  session: ${s.sessionId}`);
          console.log(`  socket:  ${SOCK_PATH}`);
          return;
        } catch {
          /* not ready yet */
        }
      }
    }
    die("\n✗ daemon did not come up in time — check logs: pi-acp logs");
  });

program
  .command("send [task...]")
  .description("Send a task to the running session (reads stdin if no args)")
  .option("-q, --quiet", "suppress thoughts/tool events; print only the reply")
  .option("--json", "print the raw done event as JSON")
  .action(async (taskWords, opts) => {
    if (!isRunning()) die("not running. Start it with: pi-acp start");
    let text = (taskWords || []).join(" ").trim();
    if (!text && !process.stdin.isTTY) {
      text = fs.readFileSync(0, "utf8").trim();
    }
    if (!text) die("no task given. Usage: pi-acp send \"your task\"");

    let done, errored;
    const dim = (s) => `\x1b[2m${s}\x1b[0m`;
    await request(
      { cmd: "prompt", text },
      {
        onEvent: (ev) => {
          if (ev.type === "chunk") process.stdout.write(ev.text);
          else if (ev.type === "thought" && !opts.quiet) process.stderr.write(dim(ev.text));
          else if (ev.type === "tool" && !opts.quiet) process.stderr.write(dim(`\n· ${ev.title ?? "tool"} [${ev.status ?? ""}]\n`));
          else if (ev.type === "done") done = ev;
          else if (ev.type === "error") errored = ev.message;
        },
      },
    );
    if (errored) die(`\n✗ ${errored}`);
    if (opts.json) {
      console.log("\n" + JSON.stringify(done, null, 2));
    } else if (done && !opts.quiet) {
      const u = done.usage || {};
      console.error(dim(`\n— ${done.stopReason} · in ${u.inputTokens ?? "?"} / out ${u.outputTokens ?? "?"} tok`));
    } else {
      process.stdout.write("\n");
    }
  });

program
  .command("status")
  .description("Show the running session's status")
  .action(async () => {
    if (!isRunning()) {
      console.log("● stopped");
      return;
    }
    const events = await request({ cmd: "status" });
    const s = events.find((e) => e.type === "status") || {};
    const meta = fs.existsSync(META_PATH) ? JSON.parse(fs.readFileSync(META_PATH, "utf8")) : {};
    console.log("● running");
    console.log(`  pid:     ${s.pid}`);
    console.log(`  model:   ${meta.activeModel || s.model}`);
    console.log(`  cwd:     ${s.cwd}`);
    console.log(`  mode:    ${s.mode}`);
    console.log(`  session: ${s.sessionId}`);
    console.log(`  turns:   ${s.turns}`);
    console.log(`  busy:    ${s.busy}`);
    console.log(`  started: ${s.startedAt}`);
  });

program
  .command("mode <mode>")
  .description("Switch the live session mode (default | plan)")
  .action(async (mode) => {
    if (!isRunning()) die("not running.");
    await request({ cmd: "mode", mode });
    console.log(`mode -> ${mode}`);
  });

program
  .command("stop")
  .description("Stop the daemon and close the session")
  .action(async () => {
    if (!isRunning()) {
      console.log("already stopped");
      return;
    }
    await request({ cmd: "stop" }).catch(() => {});
    console.log("✓ stopped");
  });

program
  .command("logs")
  .description("Print the daemon log")
  .option("-n, --lines <n>", "tail the last N lines", "40")
  .action((opts) => {
    if (!fs.existsSync(LOG_PATH)) return console.log("(no log yet)");
    const lines = fs.readFileSync(LOG_PATH, "utf8").split("\n");
    console.log(lines.slice(-Number(opts.lines)).join("\n"));
  });

program
  .command("models")
  .description("List the built-in model aliases")
  .action(() => {
    console.log("aliases (use with --model):\n");
    for (const [k, v] of Object.entries(MODEL_ALIASES)) {
      console.log(`  ${k.padEnd(9)} → ${v}${v === DEFAULT_MODEL ? "   (default)" : ""}`);
    }
    console.log("\nany raw omp id also works, e.g. --model anthropic/claude-opus-4-8");
    console.log("full list: omp models list");
  });

program.parseAsync();
