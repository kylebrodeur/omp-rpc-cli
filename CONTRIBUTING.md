# Contributing to omp-rpc-cli

## The setup

Node >= 20, npm, zero build steps (plain ESM source, no TypeScript).

```bash
git clone https://github.com/kylebrodeur/omp-rpc-cli
cd omp-rpc-cli
npm ci
npm test
```

Expected output (14 tests):

```text
# tests 14
# pass 14
# fail 0
```

No network and no omp binary are needed for the tests: the suite tests
the pure parts (selector resolution against a synthetic catalog, scope
building, preset storage under a temp `OMP_RPC_DIR`).

## Run the CLI locally from a checkout

```bash
node bin/omp-rpc.js --help
```

An `omp` install is only needed for the LIVE parts (`start`, `send`,
`models`); see [docs/quickstart.md](docs/quickstart.md) for a real
session, or run the scripted example:
`examples/session.sh` (see
[examples/README.md](examples/README.md)).

## Ground rules

- **Plain ESM JavaScript.** No TypeScript, no bundler, no transpilation;
  the package is consumed from `bin/` and `src/` as-is (Node >= 20).
- **One command per concern.** New commands slot into the ten-command
  surface of `bin/omp-rpc.js` with the same socket-request shape; keep
  the CLI thin, put state in the daemon.
- **Selectors resolve against the live catalog, always.** Never add an
  alias table: the aliases were removed in 0.3.0 on purpose, and tests
  assert exact resolution with candidate lists.
- **Fail closed and fail loudly.** A script reading a half-turn as
  success is the bug class this repo exists to avoid (`session closed
  before the turn completed` exists for that reason).
- **No AI slop in comments or docs.** No em/en dashes in markdown, and
  none of the four banned filler words the family prose gate matches
  (see the family harness for the list). Family
  prose gates enforce this fail-closed on tracked markdown.
- **Tests are contracts.** A change to resolution, scope, or presets
  lands with a test that fails before and passes after.

## Workflow

1. Fork, create a feature branch.
2. Set up per the block above.
3. Run the repo's CI commands locally before submitting; they are
   exactly what `.github/workflows/ci.yml` runs (`npm test`).
4. Open a pull request against `main` describing what and why.

## Releasing

Plain Node package: bump `version` in `package.json` (the CLI reads it
via commander's `.version()`), commit, tag `v<version>`, push, publish
(`npm publish`), and confirm all four publication artifacts exist (tag,
release, notes, registry). The release recipe and the parity bar are
family contracts; follow them.

## Doc changes

This repo follows the AI ECP documentation standard. Before a commit
that adds or moves a doc:

```bash
npm test
```

Require every `omp-rpc-cli:` line to read PASS.

## Security

Do not open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for the private reporting path.

## License

MIT. By contributing you agree your contributions are licensed under
the project's license.