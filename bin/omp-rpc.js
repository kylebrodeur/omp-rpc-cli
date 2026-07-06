#!/usr/bin/env node
// omp-rpc — drive a long-running Oh My Pi (omp) RPC session from the shell.
import { Command } from "commander";
import net from "node:net";
import fs from "node:fs";
import readline from "node:readline";
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
  splitModel,
  DEFAULT_MODEL,
} from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(__dirname, "..", "src", "daemon.js");

const program = new Command();
program
  .name("omp-rpc")
  .description("Long-running omp RPC session you can send tasks to")
  .version("0.2.0");

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

// Remove leftover runtime files (socket/pid/meta) from a dead daemon.
function cleanStaleFiles() {
  for (const p of [SOCK_PATH, PID_PATH, META_PATH]) {
    try {
      fs.unlinkSync(p);
    } catch {}
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

// Ask a yes/no question. Auto-yes when --yes is passed or there's no TTY
// (so scripted/agent callers never hang waiting on input).
function confirm(question, assumeYes) {
  if (assumeYes || !process.stdin.isTTY) return Promise.resolve(true);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

// --- commands ------------------------------------------------------------

program
  .command("start")
  .description("Start the background daemon holding an omp RPC session open")
  .option("-m, --model <model>", `model alias or omp selector (aliases: ${Object.keys(MODEL_ALIASES).join(", ")})`)
  .option("-c, --cwd <dir>", "working directory for the omp session", process.cwd())
  .action(async (opts) => {
    const running = isRunning();
    if (running) die(`already running (pid ${running}). Use 'omp-rpc stop' first.`);
    cleanStaleFiles(); // clear leftovers from a previously-crashed daemon

    const model = resolveModel(opts.model);
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const out = fs.openSync(LOG_PATH, "a");
    const child = spawn(process.execPath, [DAEMON], {
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        OMP_RPC_MODEL: model,
        OMP_RPC_CWD: opts.cwd,
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
          console.log("\n✓ omp-rpc running");
          console.log(`  pid:     ${s.pid}`);
          console.log(`  model:   ${model}`);
          console.log(`  cwd:     ${opts.cwd}`);
          console.log(`  session: ${s.sessionId}`);
          console.log(`  socket:  ${SOCK_PATH}`);
          return;
        } catch {
          /* not ready yet */
        }
      }
    }
    die("\n✗ daemon did not come up in time — check logs: omp-rpc logs");
  });

program
  .command("send [task...]")
  .description("Send a task to the running session (reads stdin if no args)")
  .option("-q, --quiet", "suppress thoughts/tool events; print only the reply")
  .option("--json", "print the raw done event as JSON")
  .action(async (taskWords, opts) => {
    if (!isRunning()) die("not running. Start it with: omp-rpc start");
    let text = (taskWords || []).join(" ").trim();
    if (!text && !process.stdin.isTTY) {
      text = fs.readFileSync(0, "utf8").trim();
    }
    if (!text) die('no task given. Usage: omp-rpc send "your task"');

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
  .command("steer <text...>")
  .description("Inject a message into the turn currently running")
  .action(async (words) => {
    if (!isRunning()) die("not running.");
    const events = await request({ cmd: "steer", text: words.join(" ") });
    const err = events.find((e) => e.type === "error");
    if (err) die(`✗ ${err.message}`);
    console.log("steered");
  });

program
  .command("abort")
  .description("Interrupt the turn currently running")
  .action(async () => {
    if (!isRunning()) die("not running.");
    await request({ cmd: "abort" });
    console.log("aborted");
  });

program
  .command("model <model>")
  .description("Switch the live session model (alias or omp selector)")
  .action(async (input) => {
    if (!isRunning()) die("not running.");
    const { provider, modelId } = splitModel(input);
    const events = await request({ cmd: "model", provider, modelId });
    const err = events.find((e) => e.type === "error");
    if (err) die(`✗ ${err.message}`);
    const s = events.find((e) => e.type === "status") || {};
    console.log(`model -> ${s.model || resolveModel(input)}`);
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
    console.log(`  session: ${s.sessionId}`);
    console.log(`  turns:   ${s.turns}`);
    console.log(`  busy:    ${s.busy}`);
    console.log(`  started: ${s.startedAt}`);
  });

program
  .command("stop")
  .description("Close the session cleanly, stop the daemon, remove runtime files")
  .option("-y, --yes", "skip the confirmation prompt")
  .option("-f, --force", "stop even if a task is currently running")
  .action(async (opts) => {
    const pid = isRunning();
    if (!pid) {
      cleanStaleFiles();
      console.log("already stopped");
      return;
    }

    // Look before we leap: report where the session did its work and whether a
    // task is still running, so we never quietly discard in-flight work.
    const events = await request({ cmd: "status" }).catch(() => []);
    const s = events.find((e) => e.type === "status") || {};
    if (s.busy && !opts.force) {
      die(`✗ session is busy running a task (turn ${s.turns + 1}). Wait for it to finish, or use: omp-rpc stop --force`);
    }

    // omp-rpc only ever removes its OWN runtime files. The session's working
    // directory and any files the agent created/edited there are left untouched.
    console.log("This will close the omp session and remove runtime files:");
    console.log(`  ${SOCK_PATH}`);
    console.log(`  ${PID_PATH}`);
    console.log(`  ${META_PATH}`);
    console.log(`The daemon log is kept. Working dir (${s.cwd || "?"}) is NOT touched.`);
    if (s.busy) console.log("⚠  A task is still running and will be interrupted (--force).");
    if (!(await confirm("Proceed?", opts.yes))) {
      console.log("aborted — session left running");
      return;
    }

    // Ask the daemon to close its session gracefully.
    await request({ cmd: "stop" }).catch(() => {});
    // Wait for it to actually exit; escalate if it lingers.
    for (let i = 0; i < 20; i++) {
      if (!isRunning()) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (isRunning()) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    cleanStaleFiles();
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
    console.log("aliases (use with --model or `omp-rpc model`):\n");
    for (const [k, v] of Object.entries(MODEL_ALIASES)) {
      console.log(`  ${k.padEnd(9)} → ${v}${v === DEFAULT_MODEL ? "   (default)" : ""}`);
    }
    console.log("\nany raw omp selector also works, e.g. `omp-rpc model anthropic/claude-opus-4-8`");
    console.log("full list: omp models list");
  });

program.parseAsync();
