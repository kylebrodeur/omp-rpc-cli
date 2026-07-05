// pi-acp daemon: holds ONE long-running omp ACP session open and serves tasks
// over a Unix domain socket. Started detached by `pi-acp start`.
//
// Wire protocol (newline-delimited JSON, both directions):
//   client -> daemon:  {cmd:"prompt", text}
//                      {cmd:"mode", mode:"default"|"plan"}
//                      {cmd:"status"} | {cmd:"stop"}
//   daemon -> client:  {type:"thought"|"chunk", text}
//                      {type:"tool", title, status}
//                      {type:"done", stopReason, usage}
//                      {type:"status", ...} | {type:"error", message}
import net from "node:net";
import fs from "node:fs";
import { AcpClient } from "./client.js";
import { SOCK_PATH, PID_PATH, META_PATH, LOG_PATH, RUNTIME_DIR } from "./config.js";

const model = process.env.PI_ACP_MODEL || null;
const cwd = process.env.PI_ACP_CWD || process.cwd();
const startMode = process.env.PI_ACP_MODE || "default";

fs.mkdirSync(RUNTIME_DIR, { recursive: true });
const log = (m) => fs.appendFileSync(LOG_PATH, `[${isoNow()}] ${m}\n`);
// new Date() is fine in a normal Node process (only workflow scripts forbid it).
function isoNow() {
  return new Date().toISOString();
}

let turns = 0;
const startedAt = isoNow();
let busy = false;

const client = new AcpClient({ model, cwd });
client.on("stderr", (s) => log("omp-stderr: " + s.trimEnd()));
client.on("exit", ({ code, sig }) => {
  log(`omp exited code=${code} sig=${sig}; shutting down daemon`);
  cleanup();
  process.exit(1);
});
client.on("permission", ({ chose }) => log("auto-approved permission -> " + chose));

async function boot() {
  const init = await client.start();
  log(`connected: ${init.agentInfo?.name} v${init.agentInfo?.version}`);
  const s = await client.newSession({ cwd });
  const activeModel = s.configOptions?.find((o) => o.id === "model")?.currentValue;
  log(`session ${s.sessionId} model=${activeModel} cwd=${cwd}`);
  if (startMode && startMode !== "default") {
    await client.setMode(startMode);
    log(`mode set -> ${startMode}`);
  }
  writeMeta({ activeModel });
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
        cwd,
        mode: startMode,
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
      write({ type: "status", pid: process.pid, model: model || "(default)", cwd, mode: startMode, sessionId: client.sessionId, startedAt, turns, busy });
      conn.end();
      return;
    case "mode":
      try {
        await client.setMode(req.mode);
        write({ type: "status", mode: req.mode });
      } catch (e) {
        write({ type: "error", message: e.message });
      }
      conn.end();
      return;
    case "stop":
      write({ type: "status", stopping: true });
      conn.end();
      log("stop requested");
      cleanup();
      client.stop();
      process.exit(0);
      return;
    case "prompt": {
      if (busy) {
        write({ type: "error", message: "session busy with another task; try again shortly" });
        conn.end();
        return;
      }
      busy = true;
      const onChunk = (t) => write({ type: "chunk", text: t });
      const onThought = (t) => write({ type: "thought", text: t });
      const onTool = (u) => write({ type: "tool", title: u.title || u.rawInput?.command || u.toolCallId, status: u.status });
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
  for (const p of [SOCK_PATH, PID_PATH]) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }
}

process.on("SIGTERM", () => {
  log("SIGTERM");
  cleanup();
  client.stop();
  process.exit(0);
});
process.on("SIGINT", () => {
  cleanup();
  client.stop();
  process.exit(0);
});

boot().catch((e) => {
  log("boot failed: " + e.message);
  cleanup();
  process.exit(1);
});
