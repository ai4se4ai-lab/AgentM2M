# Local Ollama model sweep — Duration.parse running example

| Model | Success | Rate | Mean cost (turns) | Mean iterations | Mean latency |
| --- | --- | --- | --- | --- | --- |
| qwen2.5:3b | 2/2 | 100% | 1.0 | 1.0 | 2.3s |
| llama3.3:70b-instruct-q3_K_S | 2/2 | 100% | 1.0 | 1.0 | 20.8s |
| mistral-small:24b | 2/2 | 100% | 1.0 | 1.0 | 12.6s |
| phi4-mini:latest | 2/2 | 100% | 1.0 | 1.0 | 3.7s |
| gemma4:e4b | 2/2 | 100% | 1.0 | 1.0 | 10.7s |
| llama3.1:8b | 2/2 | 100% | 1.0 | 1.0 | 5.2s |
| qwen2.5-coder:7b | 2/2 | 100% | 1.0 | 1.0 | 4.0s |
| phi4:14b | 2/2 | 100% | 1.0 | 1.0 | 4.8s |
| devstral:24b | 2/2 | 100% | 1.0 | 1.0 | 9.5s |
| qwen3-coder:30b | 2/2 | 100% | 1.0 | 1.0 | 5.2s |
| deepseek-r1:14b | 2/2 | 100% | 1.0 | 1.0 | 6.8s |
| qwen3.8:27b | 0/2 | 0% | - | - | - |
| qwen3.6:27b | 0/2 | 0% | - | - | - |
| gpt-oss:20b | 0/2 | 0% | - | - | - |

## Scenario

The paper's running example, reduced to the RA<->TS slice (edge $e_4$): a `RA` agent files a
`Requirement` for the `Duration.parse('1h30m')` bug (expected 5400s, observed 3600s); `Propagate` then
runs `GuardedRestore` on $e_4$, whose `Rule_e` creates a `TestCase` skeleton and whose `FillHoles` (a
second, separately-prompted LLM call scoped to just the `code` field) writes a Python assertion; a real
executable oracle (`src/seed/python-repro-oracle.ts`) runs that assertion against the paper's buggy
`Duration.parse` and accepts only if it genuinely reproduces the bug. `phi` requires genuine cross-model
referential integrity (the `TestCase.verifies` reference must resolve to the real `Requirement` id), not
merely "a TestCase exists" — see `docs/dev.md`/the engine's own integration test for why that distinction
matters. 2 trials/model, budget 8 turns, `temperature=0.1`, no cloud models, no API keys, no mocking
anywhere in this path.

## Why the three failing models failed (diagnosed, not just observed)

Both `qwen3.8:27b` and `gpt-oss:20b` were probed directly against Ollama with the exact same prompt the
engine sends for the RA turn:

- **`qwen3.8:27b`** returned an **empty string** as its `response`. Qwen3's hybrid "thinking" mode
  generates internal reasoning tokens before an answer; under a bounded `num_predict` (512, matching the
  agent's configured `maxTokens`) it can exhaust the entire output budget on that internal reasoning and
  never reach the actual JSON answer.
- **`gpt-oss:20b`** returned **prose chain-of-thought text that never resolved to JSON** ("We need to
  produce a JSON object... So statement: ..."), truncated mid-sentence at the token limit. gpt-oss is
  tuned around a structured "harmony" chat format with separate reasoning/answer channels; driving it
  through Ollama's raw completion-style `/api/generate` endpoint with a single concatenated prompt string
  (this prototype's current `OllamaProvider` — see `src/model-router/ollama.provider.ts`) bypasses that
  template, so the reasoning and answer channels aren't separated the way the model expects.
- `qwen3.6:27b` (same family as `qwen3.8:27b`) failed identically and is presumed to share the same cause.

In both cases `Lift`'s retry loop behaved *correctly*: it kept re-prompting with the same explained
validation errors up to `k_L` times per turn, got the same non-conforming output back every time (matching
the paper's Algorithm 2 exactly), and `RunTeam` correctly reported `budget_exhausted` rather than a false
success. **This is a model-router integration gap (no chat-template-aware request path for reasoning-tuned
models), not a defect in Lift or Propagate.** Notably, `deepseek-r1:14b` — also a reasoning-distilled model
— succeeded, so the failure is specific to how these two particular architectures structure their output
under a raw completion prompt, not "reasoning models in general." Fixing this would mean adding an
`/api/chat`-based request path (proper system/user roles, and respecting each model's own
reasoning/answer channel) to `OllamaProvider` — noted as future work, not fabricated as already done.
