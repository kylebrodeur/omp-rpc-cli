// AcpClient — a minimal Agent Client Protocol client for `omp acp`.
//
// Speaks newline-delimited JSON-RPC 2.0 over the child's stdio (omp does NOT
// use LSP Content-Length framing). Handles the three message shapes:
//   - responses to our requests (matched by id)
//   - server->client requests (permission / fs), which we must answer
//   - notifications (session/update) which stream the turn
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export class AcpClient extends EventEmitter {
  constructor({ model, cwd } = {}) {
    super();
    this.model = model;
    this.cwd = cwd || process.cwd();
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = "";
    this.sessionId = null;
    this.agentInfo = null;
    this.capabilities = null;
    // Auto-approve permission prompts so the session runs unattended.
    this.autoApprove = true;
  }

  async start() {
    const argv = ["acp"];
    if (this.model) argv.push("--model", this.model);
    this.child = spawn("omp", argv, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.cwd,
    });
    this.child.stdout.on("data", (c) => this._onData(c));
    this.child.stderr.on("data", (c) => this.emit("stderr", c.toString()));
    this.child.on("exit", (code, sig) => this.emit("exit", { code, sig }));

    const init = await this._send("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    this.agentInfo = init.agentInfo;
    this.capabilities = init.agentCapabilities;
    return init;
  }

  async newSession({ cwd, mcpServers = [] } = {}) {
    const res = await this._send("session/new", {
      cwd: cwd || this.cwd,
      mcpServers,
    });
    this.sessionId = res.sessionId;
    this.configOptions = res.configOptions;
    return res;
  }

  async setMode(modeId) {
    return this._send("session/set_mode", { sessionId: this.sessionId, modeId });
  }

  // Send a task/prompt. Streams text via the `chunk`/`thought` events and
  // resolves with { stopReason, usage } when the turn ends.
  async prompt(text, { onChunk, onThought } = {}) {
    if (onChunk) this.on("chunk", onChunk);
    if (onThought) this.on("thought", onThought);
    try {
      return await this._send("session/prompt", {
        sessionId: this.sessionId,
        prompt: [{ type: "text", text }],
      });
    } finally {
      if (onChunk) this.off("chunk", onChunk);
      if (onThought) this.off("thought", onThought);
    }
  }

  stop() {
    try {
      this.child?.stdin.end();
    } catch {}
    this.child?.kill();
  }

  // --- internals ---------------------------------------------------------

  _send(method, params) {
    const id = this.nextId++;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  _respond(id, result) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  _onData(chunk) {
    this.buf += chunk.toString("utf8");
    let idx;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this.emit("stderr", "[non-json] " + line + "\n");
        continue;
      }
      this._handle(msg);
    }
  }

  _handle(msg) {
    // Response to one of our requests.
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message + " :: " + JSON.stringify(msg.error.data || {})));
        else p.resolve(msg.result);
      }
      return;
    }
    // Server -> client request (needs a reply).
    if (msg.method && msg.id !== undefined) {
      if (msg.method === "session/request_permission") {
        const opts = msg.params?.options || [];
        const pick =
          opts.find((o) => /allow|yes|accept|approve/i.test((o.name || "") + (o.optionId || o.kind || ""))) ||
          opts[0];
        this.emit("permission", { params: msg.params, chose: pick?.optionId });
        this._respond(msg.id, { outcome: { outcome: "selected", optionId: pick?.optionId } });
      } else {
        // fs reads/writes etc. — we declared no fs capability, so reply empty.
        this._respond(msg.id, {});
      }
      return;
    }
    // Notification — streamed session updates.
    if (msg.method === "session/update") {
      const u = msg.params?.update;
      const kind = u?.sessionUpdate;
      if (kind === "agent_message_chunk" && u.content?.type === "text") {
        this.emit("chunk", u.content.text);
      } else if (kind === "agent_thought_chunk" && u.content?.type === "text") {
        this.emit("thought", u.content.text);
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        this.emit("tool", u);
      } else {
        this.emit("update", u);
      }
      return;
    }
    this.emit("notify", msg);
  }
}
