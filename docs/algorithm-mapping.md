# Algorithm → Code Mapping

Mirrors the paper's own algorithm boxes (§IV, "Description of Approach"). Every mapping below is backed by
passing tests — see the test file column.

| Paper element | Code | Tests |
| --- | --- | --- |
| Def. II.1/II.2 — View metamodel, `Schema(MM_a)` | `packages/schema/src/metamodel.ts` (`ViewMetamodel`, `deriveJsonSchema`) | `packages/schema/test/model.test.ts` |
| Def. III.2 — Team, Agent, Edge, ω | `packages/schema/src/team.ts` | (zod schema, exercised transitively by every engine test) |
| Def. III.5 — Obligation, `Schedule` | `packages/schema/src/obligation.ts` (`schedule`) | `packages/schema/test/obligation.test.ts` |
| Algorithm 1 — `RunTeam` | `apps/engine/src/algorithms/run-team.ts` (`runTeam`) | `apps/engine/test/run-team.test.ts`, `apps/engine/test/integration/duration-parse-ollama.test.ts` (real Ollama, no mocks) |
| Algorithm 2 — `Lift` (`Decode`, `Instantiate`, `TypeErrors`, `Explain`) | `apps/engine/src/algorithms/lift.ts`; `Instantiate`/stable ids/`Diff` in `packages/schema/src/model.ts` | `apps/engine/test/lift.test.ts` |
| Algorithm 3 — `GuardedRestore` (`Rule_e`, `FillHoles`, `Diagnose`) | `apps/engine/src/algorithms/guarded-restore.ts`; `Rule_e`/skeleton+hole logic in `apps/engine/src/algorithms/structural-rule.ts` | `apps/engine/test/guarded-restore.test.ts`, `apps/engine/test/structural-rule.test.ts` |
| Algorithm 4 — `Propagate` (worklist, `Direction`, budgets ℓ) | `apps/engine/src/algorithms/propagate.ts` (`propagate`, `direction`) | `apps/engine/test/propagate.test.ts` — includes a real 3-edge cycle that exhausts a per-edge budget and escalates (Proposition: termination at ≤ ℓ\|E\|) |
| Def. IV.1 — HOT `H`, template library Θ, `Validate` | `apps/engine/src/algorithms/hot.ts` | `apps/engine/test/adapt.test.ts` |
| Algorithm 5 — `Adapt` (`Try`, `μ`, ω_init) | `apps/engine/src/algorithms/adapt.ts` | `apps/engine/test/adapt.test.ts` — covers condition-not-met, successful `insert_agent` (the paper's insert-impact-analyst scenario), the `A_max` cap, and transactional rollback |
| Model Router (§ "Complexity", cost tracking) | `apps/engine/src/model-router/{router,ollama.provider,mock.provider,agent-client,oracle-dispatch}.ts` | `apps/engine/test/integration/duration-parse-ollama.test.ts` (real HTTP calls to a local Ollama server) |
| Orchestration HTTP/WS API (dashboard-facing) | `apps/engine/src/http/server.ts` | `apps/engine/test/http/server.test.ts` |

## Documented simplifications (all noted inline in code comments too)

- **`Rule_e`** is a small declarative "for-each unmatched X, create skeleton Y with holes" interpreter
  (`structural-rule.ts`), not a full triple-graph-grammar engine.
- **`Instantiate`'s stable-id matching** is content-hash based (structural signature of class+attributes),
  not a general model-matching algorithm.
- **Obligation derivation** in `RunTeam` drives normal `task` turns through a fixed round-robin over
  `team.agents`, with `escalation` obligations always preempting it — a simplification of a full
  task-decomposition engine, documented in `run-team.ts`'s doc comment.
- **`omega_init`** (Algorithm 5's initialization-only overwrite rights) is implemented as an explicit
  `restrictOverwriteTo` parameter on `propagate()`, rather than a distinct omega value type.
- **HOT template library Θ** (`hot.ts`) is a small hand-authored map covering the concept pairs needed for
  the paper's concrete insert-impact-analyst scenario, not a pluggable DSL.
- **Oracle dispatch** for `executable` oracles (`oracle-dispatch.ts`) runs the edge's command against two
  JSON-serialized model files via `child_process`, rather than the full SWE-bench Docker harness (which
  lives in `apps/bench` and *is* Docker-based, used for benchmark evaluation, not for authoring-time edges).
