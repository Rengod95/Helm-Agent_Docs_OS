# Founder Dogfood 002 — Foundations as an Executable System

> Status: implementation and immediate verification complete; delayed resumption pending  
> Date: 2026-08-16  
> Concern: `helm-vertical-slice`

## 1. Decision exercised

The product owner requested that the previous recommendation continue and that the Foundations themselves become an architected CLI/GUI system similar in boundary shape to OpenCode.

Recorded Decision:

- Selected: one headless Helm core and shared API with CLI and GUI clients
- Rationale: prevent interface-specific canonical state while making Event, Projection, and Adapter invariants executable
- Alternatives: keep expanding Docs/paper artifacts; give each client its own state; defer
- Reopen trigger: CLI and GUI require incompatible semantic state, or delayed resumption shows no projection value

## 2. OpenCode transfer decision

Official OpenCode material shows a TUI/client talking to a headless server, an OpenAPI contract used for SDKs, CLI attachment to an existing server, and separate app/cli/core/desktop/sdk/server packages.

- [OpenCode Server](https://opencode.ai/docs/server/)
- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [OpenCode packages](https://github.com/anomalyco/opencode/tree/dev/packages)

Transferred:

- headless application boundary
- one server contract for multiple clients
- local one-shot and attached modes
- explicit SDK boundary
- GUI as a client rather than canonical state owner

Not transferred:

- model/provider/session domain
- prompt transcript as the product's canonical state
- agent tool execution runtime
- desktop packaging before local UX validation

## 3. Vertical slice implemented

| Surface | Result |
|---|---|
| Event core | append-only validated JSONL, actor/authority/concern/provenance |
| Semantic capture | Decision, Commitment, Belief Update, Next Action |
| Material adapter | read-only Git snapshot with deterministic duplicate IDs |
| Projection | workspace state and cursor-bound Return Brief |
| Cognitive compression | raw paths grouped into at most five meaningful groups |
| Resumption | four probes, private answer keys, public hash, human-review completion |
| CLI | init, status, brief, events, record, capture, resumption, serve/web, attach |
| Server | local HTTP API, OpenAPI document, SSE invalidation, CSP/body/static boundaries |
| SDK | shared HTTP client for attached CLI and future clients |
| GUI | responsive Brief, timeline, semantic capture, Git capture, resumption start |

## 4. Actual dogfood path

1. Helm state was initialized in the repository's ignored `.helm/` directory so the delayed run can resume from durable local state without polluting Git.
2. The user Decision, one Commitment, one architecture Belief, and one next action were recorded through the CLI.
3. The current repository was captured through the Git adapter.
4. A 24-hour resumption probe was opened.
5. The GUI loaded the same Event cursor through the server.
6. A second Belief Event was recorded through the actual browser UI.
7. An attached CLI Event was sent through the same server; the GUI refreshed through SSE.
8. The Browser, SDK, attached CLI, and local projection cursors were compared.

## 5. Measured result

| Metric | Result |
|---|---:|
| Raw Git changes | 89 |
| Material groups in Brief | 5 |
| Total Events after GUI + attached CLI writes | 98 |
| Semantic Event kinds exercised | Decision, Commitment, Belief, Next Action |
| CLI/core/server automated tests | 12/12 pass |
| Broken local Markdown links | 0/150 checked |
| Desktop browser viewport | 1280 × 900 |
| Mobile browser viewport | 390 × 844 |
| Mobile horizontal overflow | 0 px |
| CLI/API/GUI cursor equality | yes — `evt_d38fe13286cf4c45b224506ed51f6521` |

Client provenance was also preserved across the shared server boundary: the browser write records `helm web`, while the attached command records `helm cli-attached`.

The first architecture capture before the final documentation pass reduced 79 file-level changes to five material groups. The final capture is reported above and may contain more files while retaining the same five-group attention ceiling.

## 6. Defect found through real interaction

The first resumption implementation placed expected answers inside the `experience.resumption.started` Event payload. Although the dedicated resumption endpoint hid them, the general Event timeline could expose them and invalidate the experiment.

Correction:

- answer keys moved to `private/resumption-keys.json`
- public Event stores only an answer-key hash
- public resumption and Event APIs omit expected answers
- automated tests inspect both surfaces
- participant answers remain `awaiting-human-review`; the system does not claim automatic correctness

This was a useful Helm-style result: the implementation Outcome invalidated an Assumption before schema promotion.

## 7. Hypothesis assessment

| Hypothesis | Result | Evidence |
|---|---|---|
| Explicit semantic capture can stay smaller than paper forms | supported for this run | four short CLI/GUI write paths replaced long artifact editing |
| One headless core can support CLI and GUI | supported technically | same application service, API cursor, attached client, browser state |
| Material grouping can reduce flooding | supported structurally | file-level changes projected into at most five groups |
| Event provenance can preserve drill-down after grouping | supported technically | group paths and source Event IDs remain in state |
| Return Brief improves delayed situation recovery | pending | 24-hour participant response not yet collected |
| User workload and agency improve | pending | no subjective response yet |
| Stable Event/API schema is justified | not yet | one founder run and a discovered secret-boundary defect |
| SaaS demand is justified | not tested | no external users, team workflow, or willingness-to-pay evidence |

## 8. Architecture decision after the run

Keep the current shape:

```text
Event core → application service → local server/API → CLI/Web/adapter clients
```

Do not yet add:

- production desktop wrapper
- SQLite migration and multi-process locking
- authentication and remote hosting
- autonomous agent orchestration
- stable SDK generation or plugin marketplace
- SaaS organization model

## 9. Next evidence gate

The next run is not another broad implementation sprint. It is the already-open delayed resumption, `resumption:founder-dogfood-002:1786862214213`, due at 2026-08-17 15:36:54 KST:

1. product owner answers four probes without the Brief
2. record time, omissions, confidence, and raw-log fallback
3. show the Brief and allow corrections
4. record whether the Decision, Belief, risk, or Next Action changes
5. collect workload, agency, and reuse intent

After three comparable runs, decide whether to promote the following only:

- the minimum semantic Event vocabulary
- material grouping policy interface
- projection cursor contract
- local server/client boundary

## 10. Limitations

- Single founder, project, machine, and facilitator/implementer
- No 24-hour result yet
- JSONL has no inter-process append lock or migration system
- Grouping is deterministic path policy, not validated semantic classification
- Local server has no authentication and must remain loopback-only
- OpenAPI document is descriptive, not yet a complete generated-schema source of truth
- GUI is a Web client, not a packaged native desktop application
