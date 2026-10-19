# Threat model

Scope: one trusted local operator. Core, its configuration and database are trusted.
Model outputs, repository content, pages, external webhooks and workflow results are untrusted.
This is not a multi-tenant authorization system or a hostile-host sandbox.

| Threat | Implemented containment | Residual gate |
| --- | --- | --- |
| Prompt injection / manipulated model success | Models have no API tools; output is schema-checked; permissions live in Core | Text matching proves an output contract only |
| Misdirected database (inherited shell `DATABASE_URL`) | Startup refuses any host other than loopback or the Compose `postgres` service | A remote database needs a code change and a review |
| Credential exfiltration | Secret references, restricted child environment, known-secret redaction, no request/exception logs | Unknown secrets and secrets embedded in user input need operator care; disk encryption outside Core |
| Dependency compromise | Exact npm/uv locks, npm install scripts disabled, vulnerability audit | OS image and Python dependency scans, provenance review remain required |
| Arbitrary command execution | No shell executor endpoint; Codex disabled without verified isolation | A configuration flag attests isolation; it does not create or prove it |
| Cross-agent escalation | Capability/provider allowlist, deterministic risk floor (HIGH for OpenClaw, Codex, n8n), no model-owned authorization | OpenClaw runtime tool denial must be independently enforced; live probes found only isolated code-mode `exec`/`wait` with no nested tools, Codex sandbox set read-only |
| Compromised webhook / replay | Separate token, restricted task shape, timestamp window, durable key+content hash | Shared token compromise permits scoped task admission; tokens need rotation |
| Ingress flood / queue exhaustion | Per-principal cap of 100 queued tasks for non-operator principals, 1000 in total; bounded body size | One compromised token can still fill its own quota |
| Duplicate external action | Persist intention first, single-use approval, call budget, no automatic replay after uncertainty | No exactly-once external guarantee; n8n workflow must deduplicate too |
| Stale or competing workers | PostgreSQL transaction lock, lease owner, monotonic fence and commit check | Competing claims and reconnect verified on PostgreSQL 18.3; multi-host workers untested |
| Browser session leakage | Ephemeral profile, no shared cookies, one browser slot, cleanup, downloads disabled | Container lifecycle and orphan-process behavior need live failure injection |
| SSRF / lateral movement | Service URLs from trusted configuration; request URL cannot select workflow endpoints; exact browser URL allowlist | Browser subresources/redirects require external egress policy; URL allowlist alone is insufficient |
| Path traversal / symlink escape | Canonical realpath containment, junction/symlink regression | Codex OS/container boundary must prevent reads outside delegated data |
| Unsafe deserialization / payload exhaustion | Zod strict boundaries, bounded JSON body/output/context, Python JSON only | HTTP libraries/processes still require OS quotas |
| Approval mutation / reuse | Parameters and configuration hash, expiry, atomic consumption | Mutable files inside a verified Codex home must be made immutable or re-fingerprinted before enablement |
| Misleading external success | Typed output evidence labels; reconciliation requires criterion match and operator identity | Authoritative business read-after-write verifiers remain integration-specific |
| Service compromise / lateral movement between services | Loopback publication; segmented Compose networks (data: PostgreSQL+Core, automation: n8n+Core, browser: worker+Core), so n8n and the browser worker cannot resolve or reach PostgreSQL (verified live), which is not published by default; no Docker socket or shared host profile; Core non-root; resource limits | Docker 28+ accepts a published container port from every bridge network, so n8n's and Core's loopback-published ports are reachable from other segments by IP, and `compose.dev.yaml` does the same for PostgreSQL; default dev database role is privileged; separate migration/runtime roles before sensitive deployment |
| Provider outage amplification | Per-provider circuit breaker rebuilt from durable observations at startup, measured demotion of failing or too-slow providers, bounded retries with jitter, call budget, total deadline, optional daily call/token budgets | State is per Core process; token counts are provider-reported |

Subscription-mode additions:

| Threat | Controls | Residual |
| --- | --- | --- |
| Subscription login theft | Vendor-owned logins, dedicated Codex home, API keys excluded from subscription child environments; Core never reads OAuth files | Native Codex can read host files and machine-wide guidance; OS user compromise exposes vendor logins; read-only is not an OS read boundary |
| OpenClaw operator-scope token theft | Random 48-byte shared secret, loopback Gateway, dedicated agent denying every tool; URL input fetching disabled | Bearer grants operator authority; protect profile config and `.env`, rotate together after compromise |
| Claude customization injection | `--safe-mode`, no tools/MCP/slash commands, empty working directory, bounded JSON and stderr | Enterprise-managed policy may still apply; account entitlement is checked by live calls |

Voice desktop M1 additions (see [ADR 0009](ADR/0009-voice-desktop-operator-experience.md)):

| Threat | Controls | Residual |
| --- | --- | --- |
| TV, other speakers or replayed voice | Local ECAPA gate after enrollment, name/follow-up gate; voice grants no approvals; M1 has no computer actions | Speaker embeddings are spoofable, not authentication; real microphone/TV threshold remains uncalibrated |
| Desktop renderer compromise | Context isolation, sandbox, no Node integration, self-only scripts, no webviews/navigation/popups; fixed IPC methods | Renderer can access its per-launch voice token and microphone; same-user compromise remains out of scope |
| Credential exposure | Core token read only in main, minimal voice-child environment; per-launch random token on authenticated loopback endpoints | OS user or main-process compromise exposes local credentials; the voice child holds the full operator token, so "voice never approves" is enforced in code, not by token scope |
| Model HTML or script injection | Bounded display contract, DOM text nodes, no remote content or executable code rendering | Model prose can still mislead; it has no action authority in M1 |
| Unwanted personal data retention | No audio recordings; local deletable voice print; addressed transcript export/delete and 30-day purge in Core | Everyday transcripts reach configured external providers under `personal` consent; provider retention is outside local deletion |
| Silent self-modification or unconfirmed actions | M1 exposes neither computer actions nor a modification mechanism; later milestones must use Core and operator review | M2–M4 need their own implementation and verification gates |

Intent and action engine M3 additions (see [ADR 0010](ADR/0010-model-proposed-typed-plans.md)):

| Threat | Controls | Residual |
| --- | --- | --- |
| Prompt injection adding or widening actions | Catalog-only actions, strict Zod arguments, risk from the catalog, plan approval bound to the step hash, one repair call then "not understood" | An injected utterance can still propose a valid catalog plan; the approval card is the operator's check |
| Typing into shells, the Run dialog or password fields | Escape guard on the target window (terminals, PowerShell, cmd, Run, Regedit, UAC, Task Manager, password fields) and on shortcuts such as Win+R, Win+X, Ctrl+Shift+Esc; PowerShell and Registry tools never enabled | Guard relies on Windows-MCP accessible names and window titles; an application that hides them is not recognised |
| File damage outside the operator's folders | Real-path containment in Desktop, Documents and Downloads (or `JARVIS_FILE_ROOTS`), junctions and symlinks resolved; no delete action | Move and rename inside the roots are not undoable by JARVIS |
| Screen content reaching training providers | Screen text only to trusted-private providers (Claude Code) for `screen.describe` and the single replan (window and element names only, never field values); screen-description replies are excluded from later model history; once used, the text is replaced by a marker in every task and action record | Until the finisher runs, the text sits in the step record and the live plan stream |
| False action claims | Model `say` discarded for plans; narration from templates and Core records | Weak evidence actions (`media.key`, `ui.click`) report tool success, not an observed state |
| Remote content in the renderer | Core fetches RSS and thumbnails (HTTPS, private addresses refused, JPEG/PNG/WebP magic bytes, ≤ 200 KB) and sends data URIs; CSP adds only `img-src data:` | DNS rebinding between the address check and the fetch is not pinned |
| Untrusted page, workflow or agent text | OpenClaw and n8n actions need separate exact approval; Browser Use reads exact allowlisted URLs only; provider text is displayed as text, not spoken in JARVIS's voice | Displayed text can still mislead the operator; it carries no action authority |
| Voice spoofing | Voice can cancel a plan, never approve one; a spoken candidate choice continues an approved plan only within its two-minute approval window, otherwise it asks for a new tap | Speaker gate is not authentication (see M1) |

Routing, memory and outbox additions (see [ADR 0011](ADR/0011-measured-adaptive-routing.md),
[ADR 0012](ADR/0012-operator-approved-memory.md), [ADR 0013](ADR/0013-n8n-outcome-outbox.md)):

| Threat | Controls | Residual |
| --- | --- | --- |
| Measurements widening access | Observations only reorder providers that passed every policy filter; a demoted provider stays a last resort; budgets only remove eligibility | A provider that alternates failures can stay just below the degradation threshold |
| Memory poisoning by an injected utterance | Each `memory.save` / `memory.forget` is a MEDIUM plan step that waits for the operator's tap; notes enter prompts under a data-not-instructions heading | An approved misleading note influences every later prompt until forgotten |
| Credentials stored in memory | Notes with key-shaped tokens, card-length digit runs or password/PIN/IBAN words are refused | The filter is heuristic; unusual secrets can pass |
| Misfired spoken fast path | Only bare stop phrases or a single ordinal skip the model; anything else goes to the model; stop is fail-safe | Speech meant for someone else inside the follow-up window can still stop a plan or pick a candidate |
| Forged or replayed outcome pushes | Bearer token from the operator's `.env`, loopback service URLs, stable `eventId` for receiver deduplication, results only for verified completions | Callback token theft lets an attacker forge events to n8n; delivery is at least once |

Standing permissions and the learning brain (see
[ADR 0014](ADR/0014-operator-standing-permissions.md),
[ADR 0015](ADR/0015-learning-brain-and-layered-intent.md)):

| Threat | Controls | Residual |
| --- | --- | --- |
| Misheard or injected utterance running an allowed action | Only the operator widens permissions, in Settings; grants can expire (≤ 30 days); every change is audited with a policy version; grants apply only to steps of a running plan, never to CRITICAL, never to direct API tasks; engine guards stay on in every mode | With `trusted` or `autonomous`, an utterance that compiles to an allowed action runs without a card |
| Widening permissions from the renderer or by voice | Changes go only through Core's authenticated operator API; the desktop main process validates action ids, modes, durations and presets before calling it, and the renderer never holds the Core token; there is no voice or catalog action for permissions | A compromised renderer can call the fixed Settings bridge like the operator |
| Turned-off action still running | Denied actions are hidden from every prompt, refused at plan creation and re-checked by the gateway before each step | A step already executing when the action is turned off finishes |
| Brain poisoning | The brain only proposes: learned plans are compiled against the catalog and pass permissions, approvals and the gateway; reflexes need 3+ successes, a success streak and no context-dependent words; failures and corrections weaken skills faster than successes strengthen them | A practised phrase can propose a wrong learned plan until a failure or correction weakens it |
| Learned data outliving retention | Experiences follow the 30-day transcript retention; conversation deletion and Settings reset forget everything learned | Skills keep normalized trigger phrases until they fade or are forgotten |
| Utterances sent for embeddings | Off by default; `BRAIN_EMBEDDINGS=gemini` sends only understood utterances, never results, notes or screen text | Gemini receives every understood utterance while enabled |

Duplex conversation and live progress (see
[ADR 0016](ADR/0016-duplex-conversation-and-live-progress.md)):

| Threat | Controls | Residual |
| --- | --- | --- |
| Queue jumping by a submitter | The interactive lane is honoured for the operator principal only; n8n and other principals stay in the background lane | An operator API client can mark its own tasks interactive |
| Page or agent text spoken in JARVIS's voice through progress | Executors report a stage, a host name and positions only (bounded, whitespace-normalised, in memory); narration is built from templates over plan records; spoken results still come only from the existing finishers | Host names of allowlisted pages are spoken and shown |
| Narration claiming what did not happen | Every sentence comes from Core's records (running step, reported progress, measured durations); estimates are worded as estimates and overruns are admitted | An estimate can be wrong until a few runs were measured |
| JARVIS talking over the operator or speech meant for others | Announcements wait while the operator speaks and 1.5 s after; stale progress expires; the follow-up window after an announcement still needs a voice print | Speech inside the follow-up window that was not meant for JARVIS can still reach Core, as after any reply |
| Progress data outliving the task | Progress lives in memory only and is cleared when the task leaves RUNNING; measured durations store an action name and milliseconds, purged after 30 days | None beyond timing metadata |

Production gates: Docker/WSL isolation, non-bypassable OpenClaw tool policy, browser egress
controls, image scans, backup restoration, credential rotation, provider entitlement checks,
least-privilege DB roles and signed release/upgrade procedure. No production-readiness claim.
