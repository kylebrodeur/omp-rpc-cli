// RpcClient — drives a long-running `omp --mode rpc-ui` process.
//
// omp's native RPC mode is newline-delimited JSON over the child's stdio (no
// LSP Content-Length framing). It's a superset of what `omp acp` exposed:
// besides prompting, it supports live model switching, steering/queuing into a
// running turn, aborting, and session stats. This client wraps that wire.
//
// Three message shapes flow back from omp:
//   - responses to our commands:  {id, type:"response", command, success, data?}
//   - server->client UI requests: {type:"extension_ui_request", id, method, …}
//     (tool-approval prompts arrive here under rpc-ui and MUST be answered)
//   - event stream (untagged):    agent_start, message_update, tool_execution_*,
//                                  agent_end — the turn a prompt waits on.
//
// We run `--approval-mode write` so mutating tools (bash, writes) surface an
// approval `select`; everything is auto-approved except commands the danger
// guard flags. Reads run headless (no prompt).
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { classifyCommand, parseApproval, isShellTool } from "./danger.js";

export class RpcClient extends EventEmitter {
  constructor({ model, cwd } = {}) {
    super();
    this.model = model; // full "provider/id" selector, or null for omp's default
    this.cwd = cwd || process.cwd();
    this.child = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject} for command acks
    this.buf = "";
    this.sessionId = null;
    this.activeModel = model || null;
    this._turn = null; // {resolve, usage} for the in-flight prompt turn
    this._ready = null; // resolves when omp emits {type:"ready"}
  }

  // Spawn omp and resolve once it signals {type:"ready"}.
  async start() {
    const argv = ["--mode", "rpc-ui", "--approval-mode", "write"];
    if (this.model) argv.push("--model", this.model);
    argv.push("--cwd", this.cwd);
    this.child = spawn("omp", argv, { stdio: ["pipe", "pipe", "pipe"], cwd: this.cwd });
    this.child.stdout.on("data", (c) => this._onData(c));
    this.child.stderr.on("data", (c) => this.emit("stderr", c.toString()));
    this.child.on("exit", (code, sig) => this.emit("exit", { code, sig }));

    await new Promise((resolve, reject) => {
      this._ready = resolve;
      this.child.once("exit", () => reject(new Error("omp exited before ready")));
      setTimeout(() => reject(new Error("timed out waiting for omp ready")), 30000);
    });
    // Best-effort: learn the live session id + model for status display.
    try {
      const stats = await this.getSessionStats();
      this.sessionId = stats?.sessionId || this.sessionId;
    } catch {}
    return { model: this.activeModel, sessionId: this.sessionId };
  }

  // Send a task. Streams text via `chunk`/`thought` events and resolves with
  // { stopReason, usage } when the turn ends (agent_end).
  async prompt(text, { onChunk, onThought } = {}) {
    if (this._turn) throw new Error("a turn is already in progress");
    if (onChunk) this.on("chunk", onChunk);
    if (onThought) this.on("thought", onThought);
    try {
      const turnEnded = new Promise((resolve) => {
        this._turn = { resolve, usage: null };
      });
      const ack = await this._send("prompt", { message: text });
      // A slash-command message may complete without invoking the agent — then
      // no agent_start/agent_end arrives, so resolve immediately.
      if (ack && ack.agentInvoked === false) {
        this._turn = null;
        return { stopReason: "no_turn", usage: {} };
      }
      return await turnEnded;
    } finally {
      this._turn = null;
      if (onChunk) this.off("chunk", onChunk);
      if (onThought) this.off("thought", onThought);
    }
  }

  // Inject a message into the currently running turn.
  steer(text) {
    return this._send("steer", { message: text });
  }

  // Queue a message to run after the current turn.
  followUp(text) {
    return this._send("follow_up", { message: text });
  }

  // Interrupt the active turn.
  abort() {
    return this._send("abort", {});
  }

  // Switch the model live. `selector` is { provider, modelId }.
  async setModel({ provider, modelId }) {
    const m = await this._send("set_model", { provider, modelId });
    this.activeModel = m?.provider && m?.id ? `${m.provider}/${m.id}` : this.activeModel;
    return m;
  }

  getSessionStats() {
    return this._send("get_session_stats", {});
  }

  // No explicit session/close in RPC; just tear down the child.
  async close() {
    this.stop();
  }

  stop() {
    try {
      this.child?.stdin.end();
    } catch {}
    this.child?.kill();
  }

  // --- internals ---------------------------------------------------------

  _send(command, extra = {}) {
    const id = "c" + this.nextId++;
    this.child.stdin.write(JSON.stringify({ id, type: command, ...extra }) + "\n");
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  _respondUi(id, payload) {
    this.child.stdin.write(JSON.stringify({ type: "extension_ui_response", id, ...payload }) + "\n");
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
    switch (msg.type) {
      case "ready":
        this._ready?.();
        this._ready = null;
        return;
      case "response":
        return this._onResponse(msg);
      case "extension_ui_request":
        return this._onUiRequest(msg);
      case "session":
        if (msg.id) this.sessionId = msg.id;
        return;
      case "message_update":
        return this._onMessageUpdate(msg.assistantMessageEvent);
      case "message_end":
        // Capture cumulative usage from the assistant message for the turn.
        if (msg.message?.role === "assistant" && msg.message.usage && this._turn) {
          this._turn.usage = msg.message.usage;
        }
        return;
      case "tool_execution_start":
        return this.emit("tool", { toolCallId: msg.toolCallId, title: msg.args?.command || msg.intent || msg.toolName, toolName: msg.toolName, status: "start" });
      case "tool_execution_update":
        return this.emit("tool", { toolCallId: msg.toolCallId, title: msg.args?.command || msg.toolName, toolName: msg.toolName, status: "update" });
      case "tool_execution_end":
        return this.emit("tool", { toolCallId: msg.toolCallId, title: msg.toolName, toolName: msg.toolName, status: msg.isError ? "error" : "end" });
      case "agent_end":
        return this._onAgentEnd(msg);
      default:
        this.emit("notify", msg);
    }
  }

  _onResponse(msg) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.success === false) p.reject(new Error(msg.error || `${msg.command} failed`));
    else p.resolve(msg.data);
  }

  _onMessageUpdate(ev) {
    if (!ev) return;
    switch (ev.type) {
      case "text_delta":
        if (ev.delta) this.emit("chunk", ev.delta);
        return;
      case "thinking_delta":
      case "reasoning_delta":
        if (ev.delta) this.emit("thought", ev.delta);
        return;
      default:
        // text_start/end, toolcall_* — surfaced via tool_execution_* instead.
        return;
    }
  }

  _onAgentEnd(msg) {
    const usage = normalizeUsage(this._turn?.usage || lastAssistantUsage(msg.messages));
    this._turn?.resolve({ stopReason: msg.stopReason || "end_turn", usage });
  }

  _onUiRequest(msg) {
    const { id, method } = msg;
    if (method === "select") {
      const opts = msg.options || [];
      const { tool, command } = parseApproval(msg.title || "");
      const isApproval = /Allow tool:/i.test(msg.title || "");
      if (isApproval) {
        // Guard: block clearly destructive shell commands even unattended.
        const verdict = isShellTool(tool) ? classifyCommand(command) : { action: "allow" };
        const want = verdict.action === "block" ? /deny|reject|no/i : /approve|allow|yes|accept/i;
        const pick = opts.find((o) => want.test(String(o))) || opts[verdict.action === "block" ? opts.length - 1 : 0];
        this.emit("permission", { tool, command, action: verdict.action, why: verdict.why, chose: pick });
        this._respondUi(id, { value: pick });
        return;
      }
      // Unknown selector while unattended: take the first option.
      this._respondUi(id, { value: opts[0] });
      return;
    }
    if (method === "confirm") {
      this._respondUi(id, { confirmed: true });
      return;
    }
    // setWidget, open_url, text input, etc. — nothing sensible to answer
    // headless; leave unanswered (omp proceeds without a response for these).
    this.emit("notify", msg);
  }
}

// omp usage → the { inputTokens, outputTokens, … } shape the CLI prints.
function normalizeUsage(u) {
  if (!u) return {};
  return {
    inputTokens: u.input,
    outputTokens: u.output,
    totalTokens: u.totalTokens ?? u.total,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    cost: u.cost?.total ?? u.cost,
  };
}

function lastAssistantUsage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant" && messages[i].usage) return messages[i].usage;
  }
  return null;
}
