"""Low-level unified-diff validation used before handing a patch to Docker.

This is intentionally small: the actual patch *application* inside a
container is done by the official `swebench` harness (git apply with a
fallback chain -- see docker_runner.py), which is more robust than anything
worth re-implementing here. What this module gives the API layer is a fast,
dependency-light sanity check so a malformed patch string fails with a clear
400 instead of an opaque Docker/git error two minutes into a container run.
"""

from __future__ import annotations

import re

_HUNK_HEADER_RE = re.compile(r"^@@ -\d+(,\d+)? \+\d+(,\d+)? @@")
_DIFF_FILE_RE = re.compile(r"^(diff --git |--- |\+\+\+ )")


class InvalidPatchError(ValueError):
    pass


def is_empty_patch(patch: str | None) -> bool:
    return not patch or not patch.strip()


def validate_unified_diff(patch: str) -> None:
    """Raise InvalidPatchError if `patch` is not shaped like a unified diff.

    Deliberately permissive (real-world SWE-bench gold patches vary in
    header style) -- this only rejects strings that could not plausibly be
    a diff, e.g. empty text handed in as a "candidate patch" by mistake, or
    prose with no diff markers at all.
    """
    if is_empty_patch(patch):
        raise InvalidPatchError("patch is empty")
    lines = patch.splitlines()
    has_file_header = any(_DIFF_FILE_RE.match(line) for line in lines)
    has_hunk_header = any(_HUNK_HEADER_RE.match(line) for line in lines)
    if not (has_file_header and has_hunk_header):
        raise InvalidPatchError(
            "text does not look like a unified diff (missing diff/---/+++ "
            "file header or an @@ hunk header)"
        )


def count_changed_files(patch: str) -> int:
    """Count distinct files touched by a unified diff (best-effort)."""
    return len({line for line in patch.splitlines() if line.startswith("diff --git ")}) or len(
        {line for line in patch.splitlines() if line.startswith("+++ ")}
    )
