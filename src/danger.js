// Dangerous-command guard for the auto-approving daemon.
//
// The daemon runs omp in `--mode rpc-ui --approval-mode write`, so every
// mutating tool (bash, file writes) surfaces an `extension_ui_request` of
// method "select" that the daemon must answer "Approve"/"Deny" unattended.
// `classifyCommand` inspects the command string and returns "block" for clearly
// destructive operations; the daemon then answers "Deny" instead of "Approve".
//
// This is a safety net, not a sandbox: it targets high-blast-radius mistakes
// (wiping the disk, fork bombs, piping the internet into a shell), not every
// conceivable misuse. Tune PATTERNS to taste.

export const PATTERNS = [
  // Recursive force-delete of a root/home/broad path.
  { re: /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f|\brm\s+(-[a-z]*\s+)*-[a-z]*f[a-z]*r/i, why: "recursive force rm" },
  { re: /\brm\s+.*\s(\/|~|\.|\/\*|\$HOME)(\s|$)/i, why: "rm of root/home/cwd" },
  // Disk / filesystem destruction.
  { re: /\bmkfs(\.\w+)?\b/i, why: "mkfs (format filesystem)" },
  { re: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|disk|hd)/i, why: "dd to raw disk" },
  { re: /\b(shred|wipe)\b/i, why: "shred/wipe" },
  { re: />\s*\/dev\/(sd|nvme|disk|hd)\w*/i, why: "redirect to raw disk" },
  // Fork bomb.
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: "fork bomb" },
  // Pipe remote content straight into a shell.
  { re: /\b(curl|wget|fetch)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|k|)?sh\b/i, why: "curl|wget piped to shell" },
  // Overly-broad permission/ownership changes on root.
  { re: /\bchmod\s+(-[a-z]*\s+)*-R\s+[0-7]{3,4}\s+(\/|~|\$HOME)(\s|$)/i, why: "recursive chmod on root/home" },
  { re: /\bchown\s+(-[a-z]*\s+)*-R\b[^\n]*\s(\/|~|\$HOME)(\s|$)/i, why: "recursive chown on root/home" },
  // Machine control.
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, why: "shutdown/reboot" },
  { re: /\bkillall\s+-9\b|\bkill\s+-9\s+-1\b/i, why: "kill all processes" },
  // Nuke git history / untracked files irreversibly.
  { re: /\bgit\s+clean\s+(-[a-z]*\s+)*-[a-z]*f[a-z]*d[a-z]*x|\bgit\s+reset\s+--hard\b[^\n]*\bHEAD~/i, why: "destructive git" },
];

// Returns { action: "allow" | "block", why?: string }.
export function classifyCommand(command) {
  if (!command || typeof command !== "string") return { action: "allow" };
  for (const p of PATTERNS) {
    if (p.re.test(command)) return { action: "block", why: p.why };
  }
  return { action: "allow" };
}

// Parse an rpc-ui tool-approval prompt. omp phrases these as a `select` whose
// title looks like:
//
//   Allow tool: bash
//   Command: rm -rf /
//
// Returns { tool, command }. `command` is null for non-shell tools (writes,
// edits, …) which carry no runnable command line — those are always allowed.
export function parseApproval(title) {
  if (!title || typeof title !== "string") return { tool: null, command: null };
  const tool = title.match(/Allow tool:\s*([^\n]+)/i)?.[1]?.trim() || null;
  const command = title.match(/Command:\s*([\s\S]+)$/i)?.[1]?.trim() || null;
  return { tool, command };
}

// True for tools whose approval carries a shell command worth classifying.
export function isShellTool(tool) {
  return /^(bash|shell|sh|execute|exec|pty|run)$/i.test(tool || "");
}
