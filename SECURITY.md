# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| latest tag | yes |
| older tags | best effort (backport security fixes as needed) |

## Reporting a Vulnerability

**Do not open a public issue for a security vulnerability.**

Use GitHub's **Private Vulnerability Reporting** to reach the
maintainer:

1. Go to the **Security** tab in this repository.
2. Click **"Report a vulnerability."**
3. Describe the issue, a reproduction path, and the affected version or
   tag.

You receive an acknowledgment within 72 hours. If you do not hear back,
follow up via the contact info on the maintainer's profile.

## Scope notes for omp-rpc-cli

The tool deliberately runs an agent UNATTENDED: a daemon holds one open
`omp` RPC session, approves its tool calls (through a pattern guard), and
serves tasks over a Unix socket. Reports most welcome:

- **The danger guard (`src/danger.js`):** any destructive command that
  classifies as `allow` (a false negative), or any benign command a
  pattern wrongly blocks. The guard is deny-list regexes at omp's
  `select` approval channel, so both directions matter.
- **The fail-closed path:** `parseApproval` on an approval it cannot
  parse must DENY, never approve silently. A bypass that gets
  `Approve` out of an unparseable prompt is a vulnerability.
- **The socket surface:** `~/.omp-rpc/daemon.sock` accepts unauthenticated
  JSON commands from any local process with the rights to reach the
  file. Reports about the local-exposure shape (path hijack, a second
  daemon stealing the socket, symlink tricks on the runtime files) are
  in scope. Scope/implications are documented in
  docs/RUNBOOK.md; a claim that it is a multi-user boundary is wrong.
- **The detached daemon lifecycle:** `start`/`stop`/`cleanStaleFiles`
  behavior on shared and hostile directories, and anything that gets
  the daemon to touch paths outside its runtime dir and its session's
  `--cwd`.

Explicitly NOT a vulnerability: the tool is not a sandbox, the guard is
not an adversary-proof gate (documented), and delegation to a smaller
model can produce bad code (that is what review is for).

The docs' banned-word list is a style gate, not a security boundary;
reports about it are style feedback, not vulnerabilities.

## Disclosure Process

- Reports are triaged, confirmed, and fixed.
- Coordinated disclosure applies (60 to 120 days typical embargo).
- The reporter is credited in the security advisory and release notes
  unless anonymity is preferred.