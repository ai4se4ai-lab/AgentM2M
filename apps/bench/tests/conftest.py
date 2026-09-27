"""Shared pytest fixtures.

Every test that touches persisted dataset files gets an isolated data/runs
directory, so tests never read or clobber the real apps/bench/data/
directory this session's real fetches wrote to.

Implementation note: `app.config.DATA_DIR`/`RUNS_DIR` are patched as
*attributes* on the already-imported `app.config` module (via
`monkeypatch.setattr`), not by deleting and re-importing modules. Functions
like `instances_path()` look up `DATA_DIR` from their own module globals at
call time, so this is picked up correctly no matter when/where a module
first imported `app.config` -- an earlier version of this fixture tried to
force re-imports instead and had a subtle bug: any name already bound via
`from app.config import X` at another module's *top level* (before the
fixture ran) kept pointing at the pre-fixture module object, silently
falling through to the real data directory. That bug briefly caused a test
to overwrite the real apps/bench/data/lite.json with fixture data; the fix
here (patch attributes in place) closes that hole for good.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def isolated_data_dir(monkeypatch, tmp_path):
    import app.config as config

    data_dir = tmp_path / "data"
    runs_dir = data_dir / "runs"
    data_dir.mkdir(parents=True, exist_ok=True)
    runs_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(config, "DATA_DIR", data_dir, raising=True)
    monkeypatch.setattr(config, "RUNS_DIR", runs_dir, raising=True)

    yield config


@pytest.fixture
def lite_raw_sample() -> list[dict]:
    """Two REAL rows recorded from a live `princeton-nlp/SWE-bench_Lite`
    fetch (psf__requests-1963, pallets__flask-4045) -- not fabricated, just
    cached so normalization tests don't need network access."""
    return json.loads((FIXTURES_DIR / "lite_raw_sample.json").read_text())
