#!/usr/bin/env node
// omp-rpc — drive a long-running Oh My Pi (omp) RPC session from the shell.
import { Command } from "commander";
import net from "node:net";
import fs from "node:fs";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { SOCK_PATH, PID_PATH, META_PATH, LOG_PATH, RUNTIME_DIR, splitModel } from "../src/config.js";
import { loadCatalog, findExact, resolveScope, ModelResolveError } from "../src/models.js";
import * as presets from "../src/presets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(__dirname, "..", "src", "daemon.js");

const program = new Command();
program
  .name("omp-rpc")
  .description("Long-running omp RPC session you can send tasks to")
  .version("0.3.0");

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

// Resolve the session's scope + active model from start options, honoring
// precedence: explicit flags → preset → interactive picker (TTY) → omp default.
// Returns { scope: string[], active: string|null }. Throws ModelResolveError on
// a bad flag; the caller turns that into a friendly die().
async function resolveStartScope(opts) {
  if (opts.models || opts.model) {
    const scope = opts.models ? await resolveScope(opts.models) : [];
    let active = opts.model ? await findExact(opts.model) : scope[0];
    if (opts.models && !scope.includes(active)) {
      die(`✗ --model ${active} is not in --models scope:\n  ${scope.join("\n  ")}`);
    }
    // --model alone locks the session to that one model (switch is disabled).
    return { scope: scope.length ? scope : [active], active };
  }
  if (opts.preset) {
    const p = presets.get(opts.preset);
    if (!p) die(`✗ no preset named "${opts.preset}". List them: omp-rpc presets`);
    return { scope: p.models, active: p.active };
  }
  if (process.stdin.isTTY) {
    const { runPicker } = await import("../src/picker.js");
    const picked = await runPicker(await loadCatalog());
    if (!picked) process.exit(0); // cancelled
    if (picked.saveAs) presets.save(picked.saveAs, { models: picked.models, active: picked.active });
    return { scope: picked.models, active: picked.active };
  }
  return { scope: [], active: null }; // no TTY, no flags → omp's own default, unscoped
}

// Spawn the detached daemon with the resolved scope, wait for it to answer, and
// print a status summary. Shared by `start` and `pick`.
async function spawnDaemon({ active, scope, cwd }) {
  const running = isRunning();
  if (running) die(`already running (pid ${running}). Use 'omp-rpc stop' first.`);
  cleanStaleFiles();

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const out = fs.openSync(LOG_PATH, "a");
  const child = spawn(process.execPath, [DAEMON], {
    detached: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      OMP_RPC_MODEL: active || "",
      OMP_RPC_MODELS: scope.join(","),
      OMP_RPC_CWD: cwd,
    },
  });
  child.unref();

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
        console.log(`  model:   ${active || "(omp default)"}`);
        console.log(`  scope:   ${scope.length ? scope.join(", ") : "(unscoped)"}`);
        console.log(`  cwd:     ${cwd}`);
        console.log(`  session: ${s.sessionId}`);
        console.log(`  socket:  ${SOCK_PATH}`);
        return;
      } catch {
        /* not ready yet */
      }
    }
  }
  die("\n✗ daemon did not come up in time — check logs: omp-rpc logs");
}

// --- commands ------------------------------------------------------------

program
  .command("start")
  .description("Start the background daemon holding an omp RPC session open")
  .option("-m, --model <selector>", "active model (exact selector/id from `omp-rpc models`)")
  .option("-M, --models <list>", "comma-separated selectors to scope the session to")
  .option("-p, --preset <name>", "start from a saved preset (see `omp-rpc presets`)")
  .option("-c, --cwd <dir>", "working directory for the omp session", process.cwd())
  .action(async (opts) => {
    try {
      const { scope, active } = await resolveStartScope(opts);
      await spawnDaemon({ active, scope, cwd: opts.cwd });
    } catch (e) {
      if (e instanceof ModelResolveError) die(`✗ ${e.message}`);
      throw e;
    }
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
    // No `done` and no `error` means the socket closed mid-turn (daemon crash,
    // omp exit). Fail loudly so scripted callers don't read it as success.
    if (!done) die("\n✗ session closed before the turn completed — check: omp-rpc logs");
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
  .command("model [selector]")
  .description("Switch the live session model within scope (no arg = pick, on a TTY)")
  .action(async (input) => {
    if (!isRunning()) die("not running.");

    // Read the session scope so we resolve/pick within it.
    const st = (await request({ cmd: "status" })).find((e) => e.type === "status") || {};
    const scope = st.scope || [];

    let selector = input;
    if (!selector) {
      if (!process.stdin.isTTY) die("no model given. Usage: omp-rpc model <selector>  (or run on a TTY to pick)");
      const catalog = await loadCatalog();
      const choices = scope.length ? catalog.filter((m) => scope.includes(m.selector)) : catalog;
      const { runPicker } = await import("../src/picker.js");
      const picked = await runPicker(choices, { title: "Switch active model", preselect: scope });
      if (!picked) return;
      selector = picked.active;
    } else {
      // Resolve the typed value to an exact selector against the FULL catalog,
      // then let the daemon enforce scope — so a valid-but-out-of-scope selector
      // gets the daemon's clear "not in this session's scope" message, not a
      // misleading "no match".
      try {
        selector = await findExact(selector);
      } catch (e) {
        die(`✗ ${e.message}`);
      }
    }

    const events = await request({ cmd: "model", selector });
    const err = events.find((e) => e.type === "error");
    if (err) die(`✗ ${err.message}`);
    const s = events.find((e) => e.type === "status") || {};
    console.log(`model -> ${s.model || selector}`);
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
    console.log(`  scope:   ${(s.scope || []).length ? s.scope.join(", ") : "(unscoped)"}`);
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
  .command("models [pattern]")
  .description("Browse omp's live model catalog (the source of selectors)")
  .option("--json", "machine-readable output (the agent path — copy exact selectors from here)")
  .option("--refresh", "re-fetch omp's catalog first (picks up newly-added models)")
  .action(async (pattern, opts) => {
    let catalog = await loadCatalog({ refresh: opts.refresh });
    if (pattern) {
      const q = pattern.toLowerCase();
      catalog = catalog.filter((m) => [m.selector, m.id, m.name].some((f) => String(f).toLowerCase().includes(q)));
    }
    if (opts.json) {
      console.log(JSON.stringify(catalog, null, 2));
      return;
    }
    if (!catalog.length) return console.log("(no models matched)");
    // Mark which are in the running session's scope, if any.
    const scope = isRunning() ? ((await request({ cmd: "status" })).find((e) => e.type === "status")?.scope || []) : [];
    let provider = null;
    for (const m of catalog.sort((a, b) => a.provider.localeCompare(b.provider) || b.contextWindow - a.contextWindow)) {
      if (m.provider !== provider) {
        provider = m.provider;
        console.log(chalk.bold(`\n${provider}`));
      }
      const inScope = scope.includes(m.selector) ? chalk.green(" ◉") : "  ";
      console.log(`${inScope} ${chalk.cyan(m.selector.padEnd(38))} ${chalk.dim(m.contextWindow.toLocaleString().padStart(9) + " ctx")}  ${m.name}`);
    }
    console.log(chalk.dim("\nselect exact selectors above with `omp-rpc start --models \"…\"`, or pick interactively: `omp-rpc pick`"));
  });

program
  .command("pick")
  .description("Interactively pick a model scope, then start / save / print it")
  .option("-c, --cwd <dir>", "working directory for the omp session", process.cwd())
  .option("--save <name>", "save the chosen scope as a preset")
  .option("--print", "print the equivalent `omp-rpc start` command instead of starting")
  .action(async (opts) => {
    if (!process.stdin.isTTY) die("✗ `pick` needs a terminal. Non-interactive? Use `omp-rpc models --json` + `omp-rpc start --models`.");
    const { runPicker } = await import("../src/picker.js");
    const picked = await runPicker(await loadCatalog());
    if (!picked) return;
    const name = opts.save || picked.saveAs;
    if (name) {
      presets.save(name, { models: picked.models, active: picked.active });
      console.log(chalk.green(`saved preset "${name}"`));
    }
    if (opts.print) {
      console.log(`\nomp-rpc start --models "${picked.models.join(",")}" --model "${picked.active}"`);
      return;
    }
    await spawnDaemon({ active: picked.active, scope: picked.models, cwd: opts.cwd });
  });

program
  .command("presets [action] [name]")
  .description("List saved presets, or `presets rm <name>` to delete one")
  .action((action, name) => {
    if (action === "rm") {
      if (!name) die("✗ usage: omp-rpc presets rm <name>");
      console.log(presets.remove(name) ? `removed "${name}"` : `no preset named "${name}"`);
      return;
    }
    const all = presets.list();
    const names = Object.keys(all);
    if (!names.length) return console.log("(no presets — create one with `omp-rpc pick`)");
    for (const n of names) {
      const p = all[n];
      console.log(`${chalk.bold(n)}  ${chalk.dim(`active=${p.active}`)}`);
      for (const m of p.models) console.log(`  ${m === p.active ? chalk.green("◉") : "·"} ${m}`);
    }
  });

program.parseAsync();
