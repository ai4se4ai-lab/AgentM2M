# Benchmark Setup (apps/bench) — what's real, what isn't

`apps/bench` is a Python/FastAPI service implementing dev.md §8 (dataset fetchers) and §9 (evaluation
runners). Everything below was independently re-verified after the initial build — real instance counts
re-counted from the fetched files, and the Docker harness re-run with a fresh (uncached) `run_id` to
confirm it wasn't reporting stale results.

## Datasets — real fetches, real counts

| Dataset | Source | Instances fetched | Docker execution |
| --- | --- | --- | --- |
| `lite` | `princeton-nlp/SWE-bench_Lite` (HF `datasets`) | **300 / 300** | Supported |
| `lite-s` | Lite filtered by Agentless's flagged-instance list | **300** (see note) | Supported |
| `verified` | `princeton-nlp/SWE-bench_Verified` | **500 / 500** | Supported |
| `live` | `SWE-bench-Live/SWE-bench-Live` (test split) | **1000** (of 1888 in the full split) | Not supported (see note) |
| `pro` | `ScaleAI/SWE-bench_Pro` | **642** | Not supported (see note) |

**Lite-S note:** the filtering *mechanism* is real and tested, but the exact Agentless exclusion-instance-id
list wasn't sourced this pass (a web fetch for it hit a rate limit) — the exclusion set is currently empty,
so Lite-S == Lite (300) until that list is added. This is stated in the API's `note` field, not hidden.

**Live/Pro note:** both datasets fetch real metadata successfully, but their Docker execution isn't wired
up — `Live` instances don't carry a `swebench`-harness-compatible `image` field (they need their own
image-building pipeline), and `Pro` uses different harness mechanics (`before_repo_set_cmd`,
`selected_test_files_to_run`) incompatible with the `swebench` PyPI package's `run_instance` path used
here. `GET /api/benchmarks` reports this honestly per dataset rather than silently no-oping.

## Docker execution harness — real, GPU/architecture note

This machine is aarch64 (an NVIDIA Grace-Blackwell superchip), but published SWE-bench images are
amd64-only. QEMU emulation is required once per machine:

```bash
docker run --privileged --rm tonistiigi/binfmt --install all
```

Verified independently with a **fresh, uncached run** (new `run_id`, bypassing the official `swebench`
harness's own report-caching): a real container run of `psf__requests-1963`'s gold patch took **67
seconds** wall-clock and returned real `FAIL_TO_PASS`/`PASS_TO_PASS` test names from the actual `requests`
library test suite, `resolved: true`.

## What RQ1/RQ3 mean here — small-N calibration, not the paper's study

No cloud LLM API keys are configured in this environment, and `apps/bench` doesn't itself run a coding
agent (that's `apps/engine`'s job, and it isn't yet wired to fetch/patch arbitrary GitHub repos — see
`docs/architecture.md`). So RQ1/RQ3 here are **not** the paper's actual effectiveness/ablation study. They
are a real, honest sanity check that the execution harness itself is correct:

- **RQ1** (`evaluation/rq1_effectiveness/`): `gold` patch → 3/3 resolved; `noop` (no patch) → 0/3 resolved,
  on 3 real instances (`psf__requests-1963`, `psf__requests-2148`, `pallets__flask-4045`), independently
  re-verified.
- **RQ3** (`evaluation/rq3_ablations/`): one real, no-LLM-needed ablation axis (does checking
  `PASS_TO_PASS` regression tests change the resolved verdict vs. `FAIL_TO_PASS` alone?) — no disagreement
  on this small sample. The five ablations that need a live multi-agent LLM run (no-guards,
  LLM-only-restorers, forward-only, no-lift-repair, fixed-team) are explicitly reported as
  `requires_live_agent_not_computed`, each with a reason, rather than invented.
- `/api/evaluation/hypotheses` reports H1–H7 all as `not_evaluated_at_scale`.

For the actual real-model evaluation this repo does run (the engine's own multi-model sweep on the
paper's running example), see `evaluation/local-model-sweep/results.md`.

## Running it yourself

```bash
cd apps/bench
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# one-time on ARM64 hosts, to run amd64 SWE-bench images:
docker run --privileged --rm tonistiigi/binfmt --install all

python3 -c "from app.datasets.swebench_lite import fetch_and_persist; fetch_and_persist()"
python3 -m pytest -q                 # 35 tests, includes one real Docker run
uvicorn app.main:app --port 8000
```
