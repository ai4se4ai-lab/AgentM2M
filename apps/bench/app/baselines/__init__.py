"""Baseline agent adapters (SWE-agent, OpenHands, Agentless, MAGIS).

Not implemented in this pass: they require a live LLM backend and, per
docs/dev.md's phased plan, a lot of separate integration work per baseline.
This environment has no cloud LLM API keys configured, and building a real
adapter without ever calling a model would just be a stub pretending to be
real -- out of scope for the "real, honest, small-scale" mandate this
service was built under. See app/harness/docker_runner.py's `gold`/`noop`
baselines for what IS computed for real without an LLM.
"""
