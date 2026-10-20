# Parallel live acceptance and release boundaries

The operator requested release readiness, two simultaneous useful jobs (authenticated GitHub
connection plus website registration), then installer/hardware acceptance. They delegated site
selection; use an owned local test site, not a third-party account or invented identity. They
confirmed presence and closed private windows for desktop/microphone tests on 2026-10-20.

Current adapters deliberately do not provide full coding-agent authority: Claude Code has no
tools, Codex is read-only/network-disabled, Browser Use only reads allowlisted pages. Do not remove
these controls or claim arbitrary Claude Code/Codex parity from a successful example.

## First implementation slice

- Add optional `github.profile`: a fixed read-only GitHub CLI query for the authenticated account's
  public identity. Keep credentials inside the official CLI. No arbitrary command, host, endpoint,
  repository write, token export, user shell, or raw stderr in records.
- Reuse Core scheduling, action approvals, integration recipes and `info.fetch`; no second agent
  runner or new capability protocol. Configuration defaults off; existing actions still work.
- Verify GitHub and a second registered workflow can genuinely be in flight concurrently, not
  merely accepted into a queue. Cancellation/failure of one must not cancel the other.
- Perform a separate live GitHub task through Core using the real installed CLI. A direct `gh`
  connectivity check alone is not JARVIS evidence.
- Reuse existing desktop actions for the local test site's form; verify account creation in the
  site's actual store rather than a model's completion claim. No external site signup implied.
- Hardware checks distinguish CUDA/model inference, microphone capture, operator enrollment,
  voice roundtrip and Electron presence. Record failures and missing prerequisites separately.

## Release status

Original release gates remain binding; this slice is not the installer or a release-complete
claim. Installer acceptance, all remaining matrices, migration/rollback and operator publication
checkpoints must pass before v1.0.0 is represented as ready. No real `.env` change, release tag,
publication, production migration, or unsafe tool unlocking is authorized by a test pass.
