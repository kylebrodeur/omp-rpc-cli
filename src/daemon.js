// omp-rpc daemon: holds ONE long-running `omp --mode rpc-ui` session open and
// serves tasks over a Unix domain socket. Started detached by `omp-rpc start`.
//
// Wire protocol (newline-delimited JSON, both directions):
//   client -> daemon:  {cmd:"prompt", text}
//                      {cmd:"steer", text} | {cmd:"abort"}
//                      {cmd:"model", provider, modelId}
//                      {cmd:"status"} | {cmd:"stop"}
//   daemon -> client:  {type:"thought"|"chunk", text}
//                      {type:"tool", title, status}
//                      {type:"done", stopReason, usage}
//                      {type:"status", ...} | {type:"error", message}
import net from "node:net";
import fs from "node:fs";
import { RpcClient } from "./client.js";
import { SOCK_PATH, PID_PATH, META_PATH, LOG_PATH, RUNTIME_DIR, splitModel } from "./config.js";

const model = process.env.OMP_RPC_MODEL || null;
const cwd = process.env.OMP_RPC_CWD || process.cwd();
// Exact selectors this session may switch among. Empty = unscoped (any model).
const scope = (process.env.OMP_RPC_MODELS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

fs.mkdirSync(RUNTIME_DIR, { recursive: true });
const log = (m) => fs.appendFileSync(LOG_PATH, `[${isoNow()}] ${m}\n`);
// new Date() is fine in a normal Node process (only workflow scripts forbid it).
function isoNow() {
  return new Date().toISOString();
}

let turns = 0;
const startedAt = isoNow();
let busy = false;

const client = new RpcClient({ model, cwd, scope });
client.on("stderr", (s) => log("omp-stderr: " + s.trimEnd()));
client.on("exit", ({ code, sig }) => {
  log(`omp exited code=${code} sig=${sig}; shutting down daemon`);
  cleanup();
  process.exit(1);
});
client.on("permission", ({ action, why, command, chose }) => {
  if (action === "block") log(`BLOCKED dangerous command (${why}): ${String(command).slice(0, 200)} -> ${chose}`);
  else log(`approved permission -> ${chose}`);
});

async function boot() {
  const init = await client.start();
  log(`connected: omp rpc session ${init.sessionId} model=${init.model} cwd=${cwd}`);
  writeMeta({ activeModel: init.model });
  serve();
}

function writeMeta(extra = {}) {
  fs.writeFileSync(
    META_PATH,
    JSON.stringify(
      {
        pid: process.pid,
        sessionId: client.sessionId,
        model: model || "(default)",
        scope,
        cwd,
        startedAt,
        turns,
        sock: SOCK_PATH,
        ...extra,
      },
      null,
      2,
    ),
  );
}

function serve() {
  try {
    fs.unlinkSync(SOCK_PATH);
  } catch {}
  const server = net.createServer((conn) => handleConn(conn));
  server.listen(SOCK_PATH, () => {
    fs.writeFileSync(PID_PATH, String(process.pid));
    log(`listening on ${SOCK_PATH}`);
  });
  server.on("error", (e) => {
    log("server error: " + e.message);
    cleanup();
    process.exit(1);
  });
}

function handleConn(conn) {
  let buf = "";
  const write = (obj) => conn.write(JSON.stringify(obj) + "\n");
  conn.on("data", async (c) => {
    buf += c.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        write({ type: "error", message: "bad json" });
        continue;
      }
      await dispatch(req, write, conn);
    }
  });
}

async function dispatch(req, write, conn) {
  switch (req.cmd) {
    case "status":
      write({ type: "status", pid: process.pid, model: client.activeModel || model || "(default)", scope, cwd, sessionId: client.sessionId, startedAt, turns, busy });
      conn.end();
      return;
    case "model": {
      // The CLI sends an already-resolved exact selector. The daemon is the scope
      // gate: reject anything outside the session's allowed set (omp's own
      // --models only scopes TUI cycling, not RPC set_model — so we enforce here).
      const selector = req.selector;
      if (scope.length && !scope.includes(selector)) {
        write({ type: "error", message: `"${selector}" is not in this session's scope:\n  ${scope.join("\n  ")}` });
        conn.end();
        return;
      }
      try {
        const { provider, modelId } = splitModel(selector);
        const m = await client.setModel({ provider, modelId });
        const label = m?.provider && m?.id ? `${m.provider}/${m.id}` : selector;
        writeMeta({ activeModel: label });
        log(`model switched -> ${label}`);
        write({ type: "status", model: label });
      } catch (e) {
        write({ type: "error", message: e.message });
      }
      conn.end();
      return;
    }
    case "steer":
      try {
        if (!busy) throw new Error("no turn in progress to steer into");
        await client.steer(req.text);
        write({ type: "status", steered: true });
      } catch (e) {
        write({ type: "error", message: e.message });
      }
      conn.end();
      return;
    case "abort":
      try {
        await client.abort();
        write({ type: "status", aborted: true });
      } catch (e) {
        write({ type: "error", message: e.message });
      }
      conn.end();
      return;
    case "stop":
      write({ type: "status", stopping: true });
      conn.end();
      log("stop requested — closing session");
      await shutdown(0);
      return;
    case "prompt": {
      if (busy) {
        write({ type: "error", message: "session busy with another task; try again shortly (or use `omp-rpc steer`)" });
        conn.end();
        return;
      }
      busy = true;
      const onChunk = (t) => write({ type: "chunk", text: t });
      const onThought = (t) => write({ type: "thought", text: t });
      const onTool = (u) => write({ type: "tool", title: u.title || u.toolName || u.toolCallId, status: u.status });
      client.on("tool", onTool);
      try {
        log(`turn ${turns + 1}: ${JSON.stringify(req.text).slice(0, 160)}`);
        const res = await client.prompt(req.text, { onChunk, onThought });
        turns++;
        writeMeta();
        write({ type: "done", stopReason: res.stopReason, usage: res.usage });
      } catch (e) {
        log("prompt error: " + e.message);
        write({ type: "error", message: e.message });
      } finally {
        client.off("tool", onTool);
        busy = false;
        conn.end();
      }
      return;
    }
    default:
      write({ type: "error", message: "unknown cmd: " + req.cmd });
      conn.end();
  }
}

function cleanup() {
  for (const p of [SOCK_PATH, PID_PATH, META_PATH]) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }
}

let shuttingDown = false;
// Single graceful-shutdown path: close the RPC session, remove runtime files,
// then exit. Idempotent — safe to call from stop, signals, or errors.
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await client.close();
  } catch {}
  cleanup();
  log("shutdown complete");
  process.exit(code);
}

process.on("SIGTERM", () => {
  log("SIGTERM");
  shutdown(0);
});
process.on("SIGINT", () => {
  log("SIGINT");
  shutdown(0);
});

boot().catch((e) => {
  log("boot failed: " + e.message);
  cleanup();
  process.exit(1);
});
