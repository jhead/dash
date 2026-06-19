#!/usr/bin/env python3
"""Concurrency + ambiguity tests for the ./task CLI (task 1206).

Run: python3 tools/task-concurrency.test.py   (or `pnpm test:task`)

Proves:
  * N parallel `./task create` invocations yield N DISTINCT ids (no duplicate prefixes
    even under heavy contention).
  * Two independent "worktrees" seeded with the SAME counter never mint colliding ids.
  * A bare numeric prefix that matches multiple tasks FAILS LOUDLY (non-zero exit, lists
    matches) for show/update/acquire; a unique prefix and the exact id both resolve.
  * `./task migrate` is idempotent and leaves zero duplicate filenames/ids.

No third-party deps -- stdlib unittest only (the CLI is Python, so are these tests).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TASK_CLI = REPO_ROOT / "task"


def run_task(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(cwd / "task"), *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )


class TaskWorktree:
    """A throwaway copy of the repo's ./task CLI with an isolated .tasks dir."""

    def __init__(self, root: Path, counter: int | None = None):
        self.root = root
        (root / ".tasks").mkdir(parents=True, exist_ok=True)
        shutil.copy(TASK_CLI, root / "task")
        os.chmod(root / "task", 0o755)
        if counter is not None:
            (root / ".tasks" / ".counter").write_text(f"{counter}\n", encoding="utf-8")

    def run(self, *args: str) -> subprocess.CompletedProcess:
        return run_task(self.root, *args)

    def ids(self) -> list[str]:
        return sorted(p.stem for p in (self.root / ".tasks").glob("*.json"))


class ConcurrencyTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp(prefix="task-test-")
        self.tmp = Path(self._tmp)

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_parallel_creates_are_distinct(self):
        """N parallel creates in ONE worktree -> N distinct ids."""
        wt = TaskWorktree(self.tmp / "wt", counter=1)
        n = 32

        def create(i: int) -> str:
            cp = wt.run("create", "--title", f"parallel task {i}")
            self.assertEqual(cp.returncode, 0, cp.stderr)
            return cp.stdout.strip()

        with ThreadPoolExecutor(max_workers=n) as pool:
            ids = list(pool.map(create, range(n)))

        self.assertEqual(len(ids), n)
        self.assertEqual(len(set(ids)), n, f"duplicate ids minted: {ids}")
        # Files on disk match the minted ids exactly (no overwrite / loss).
        self.assertEqual(len(wt.ids()), n)

    def test_cross_worktree_same_counter_no_collision(self):
        """Two worktrees seeded with the SAME counter never collide (the real bug)."""
        a = TaskWorktree(self.tmp / "a", counter=1217)
        b = TaskWorktree(self.tmp / "b", counter=1217)
        ra = a.run("create", "--title", "regression fix")
        rb = b.run("create", "--title", "qa finding shape geometry")
        self.assertEqual(ra.returncode, 0, ra.stderr)
        self.assertEqual(rb.returncode, 0, rb.stderr)
        ida, idb = ra.stdout.strip(), rb.stdout.strip()
        # Both pick the same NNNN hint...
        self.assertTrue(ida.startswith("1217-"))
        self.assertTrue(idb.startswith("1217-"))
        # ...but the full ids (and thus filenames) differ -> merge cleanly, no collision.
        self.assertNotEqual(ida, idb)

    def test_ambiguous_prefix_fails_loudly(self):
        """A bare numeric prefix matching >1 task must fail (non-zero) and list matches."""
        wt = TaskWorktree(self.tmp / "wt", counter=1)
        # Simulate two tasks that ended up sharing a numeric prefix (merged worktrees).
        a = TaskWorktree(self.tmp / "src_a", counter=1217)
        b = TaskWorktree(self.tmp / "src_b", counter=1217)
        a.run("create", "--title", "first dup")
        b.run("create", "--title", "second dup")
        for src in (a, b):
            for p in (src.root / ".tasks").glob("*.json"):
                shutil.copy(p, wt.root / ".tasks" / p.name)

        ids_1217 = [i for i in wt.ids() if i.startswith("1217-")]
        self.assertEqual(len(ids_1217), 2, wt.ids())

        for sub in ("show", "update", "acquire"):
            extra = ["--status", "done"] if sub == "update" else []
            cp = wt.run(sub, "1217", *extra)
            self.assertNotEqual(cp.returncode, 0, f"{sub} should fail on ambiguous prefix")
            self.assertIn("ambiguous", cp.stderr)
            for tid in ids_1217:
                self.assertIn(tid, cp.stderr, f"{sub} error must list match {tid}")

    def test_unique_prefix_and_exact_id_resolve(self):
        wt = TaskWorktree(self.tmp / "wt", counter=1)
        created = wt.run("create", "--title", "resolve me").stdout.strip()
        # exact id
        cp = wt.run("show", created)
        self.assertEqual(cp.returncode, 0, cp.stderr)
        self.assertIn(created, cp.stdout)
        # unique numeric prefix (only one task with this NNNN)
        nnnn = created.split("-", 1)[0]
        cp = wt.run("show", nnnn)
        self.assertEqual(cp.returncode, 0, cp.stderr)
        self.assertIn(created, cp.stdout)
        # unique leading substring
        cp = wt.run("show", created[: len(nnnn) + 4])
        self.assertEqual(cp.returncode, 0, cp.stderr)
        self.assertIn(created, cp.stdout)
        # nonexistent
        cp = wt.run("show", "9999")
        self.assertNotEqual(cp.returncode, 0)
        self.assertIn("not found", cp.stderr)

    def test_migrate_is_idempotent_and_collision_free(self):
        wt = TaskWorktree(self.tmp / "wt", counter=1)
        # Seed a couple of legacy (untokenized) ids by hand, including a colliding pair and
        # a slug whose first word looks token-ish ("golden").
        seed = {
            "0007-stage-view-mvp": {"created_at": "2026-06-01T00:00:00Z"},
            "1213-golden-parity-shape-geometry": {"created_at": "2026-06-02T00:00:00Z"},
            "1213-some-other-collision": {"created_at": "2026-06-02T01:00:00Z"},
        }
        for tid, extra in seed.items():
            rec = {
                "id": tid, "title": tid, "description": "", "status": "open",
                "effort": "default", "priority": "medium",
                "created_at": extra["created_at"], "updated_at": extra["created_at"],
            }
            (wt.root / ".tasks" / f"{tid}.json").write_text(json.dumps(rec, indent=2) + "\n")

        cp = wt.run("migrate")
        self.assertEqual(cp.returncode, 0, cp.stderr)

        ids = wt.ids()
        self.assertEqual(len(ids), len(set(ids)), "migration produced duplicate filenames")
        # Every id is now NNNN-TOKEN-slug (TOKEN starts with a digit).
        import re
        scheme = re.compile(r"^\d{4}-\d[0-9a-z]{5}-.+$")
        for tid in ids:
            self.assertRegex(tid, scheme, f"id not on new scheme: {tid}")
        # The "golden"-prefixed legacy slug got tokenized (not mistaken for already-migrated).
        self.assertTrue(any("golden-parity" in t for t in ids))

        # Re-running migrate is a no-op and changes nothing.
        ids_before = set(ids)
        cp2 = wt.run("migrate")
        self.assertEqual(cp2.returncode, 0, cp2.stderr)
        self.assertIn("already use", cp2.stdout)
        self.assertEqual(set(wt.ids()), ids_before, "migrate was not idempotent")


if __name__ == "__main__":
    unittest.main(verbosity=2)
