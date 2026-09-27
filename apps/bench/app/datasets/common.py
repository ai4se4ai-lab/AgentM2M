"""Shared normalization + persistence helpers for SWE-bench-family fetchers.

Every fetcher in this package produces records with at least the fields the
task requires: instance_id, repo, base_commit, problem_statement, patch
(gold), test_patch, FAIL_TO_PASS, PASS_TO_PASS. Dataset-specific extra fields
are kept under "extra" rather than dropped, so nothing real is thrown away.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from datetime import datetime, timezone

from app.config import instances_path, meta_path


def _as_list(value: Any) -> list[str]:
    """FAIL_TO_PASS / PASS_TO_PASS arrive as a JSON-encoded string in the raw
    HF datasets (e.g. '["test_a", "test_b"]'); some sources already give a
    real list. Normalize to a plain list of strings either way."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(v) for v in parsed]
        except json.JSONDecodeError:
            pass
        # fallback: a single test id given as a bare string
        return [value] if value else []
    return []


@dataclass
class Instance:
    instance_id: str
    repo: str
    base_commit: str
    problem_statement: str
    patch: str
    test_patch: str
    fail_to_pass: list[str]
    pass_to_pass: list[str]
    dataset: str
    docker_image: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "instance_id": self.instance_id,
            "repo": self.repo,
            "base_commit": self.base_commit,
            "problem_statement": self.problem_statement,
            "patch": self.patch,
            "test_patch": self.test_patch,
            "FAIL_TO_PASS": self.fail_to_pass,
            "PASS_TO_PASS": self.pass_to_pass,
            "dataset": self.dataset,
            "docker_image": self.docker_image,
            "extra": self.extra,
        }


def normalize_row(row: dict[str, Any], dataset: str, extra_keys: list[str] | None = None,
                   docker_image_key: str | None = None) -> Instance:
    """Normalize one raw HF dataset row (a dict-like mapping) into an Instance.

    `extra_keys` names additional raw fields worth preserving verbatim
    (dataset-specific, e.g. "difficulty", "version", "hints_text").
    """
    extra: dict[str, Any] = {}
    for key in extra_keys or []:
        if key in row:
            extra[key] = row[key]
    docker_image = row.get(docker_image_key) if docker_image_key else None
    return Instance(
        instance_id=str(row["instance_id"]),
        repo=str(row.get("repo", "")),
        base_commit=str(row.get("base_commit", "")),
        problem_statement=str(row.get("problem_statement", "") or ""),
        patch=str(row.get("patch", "") or ""),
        test_patch=str(row.get("test_patch", "") or ""),
        fail_to_pass=_as_list(row.get("FAIL_TO_PASS") or row.get("fail_to_pass")),
        pass_to_pass=_as_list(row.get("PASS_TO_PASS") or row.get("pass_to_pass")),
        dataset=dataset,
        docker_image=str(docker_image) if docker_image else None,
        extra=extra,
    )


def persist_instances(dataset_name: str, instances: list[Instance]) -> Path:
    path = instances_path(dataset_name)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [i.to_dict() for i in instances]
    # `extra` can carry raw HF row values (e.g. a datetime for created_at on
    # SWE-bench-Live) that aren't natively JSON-serializable; stringify
    # anything json doesn't know rather than fail the whole persist.
    path.write_text(json.dumps(payload, indent=2, default=str))
    meta_path(dataset_name).write_text(
        json.dumps({"count": len(payload), "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    )
    return path


def dataset_meta(dataset_name: str) -> dict[str, Any]:
    """{count, fetchedAt} for a persisted dataset, or {count: 0, fetchedAt: None}.

    Reads the sidecar written by persist_instances; for data persisted before
    sidecars existed, counts once and writes the sidecar (so the big file is
    parsed at most one time, not on every listing request).
    """
    mp = meta_path(dataset_name)
    if mp.exists():
        try:
            return json.loads(mp.read_text())
        except json.JSONDecodeError:
            pass
    ip = instances_path(dataset_name)
    if not ip.exists():
        return {"count": 0, "fetchedAt": None}
    count = len(json.loads(ip.read_text()))
    fetched = datetime.fromtimestamp(ip.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds")
    meta = {"count": count, "fetchedAt": fetched}
    mp.write_text(json.dumps(meta))
    return meta


def load_persisted_instances(dataset_name: str) -> list[dict[str, Any]]:
    path = instances_path(dataset_name)
    if not path.exists():
        return []
    return json.loads(path.read_text())
