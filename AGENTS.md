# Agent instructions — Flash 8 clone

This project uses a file-backed task manager for coordinating work across agents and
sessions. **All task operations go through `./task`.** Do not create, edit, or delete
task files under `.tasks/` by hand.

## Before you start

1. Read `docs/README.md` and the relevant domain doc for your work.
2. List open tasks: `./task list --status open`
3. Pick an unassigned task (no lock holder in the list output).

## Required workflow

Every agent **must** acquire a task lock before doing implementation work tied to that
task, and **must** release the lock when finished.

```bash
# 1. Claim work
./task acquire <task-id> --holder "<your-agent-id>"

# 2. Confirm lock and read details
./task show <task-id>

# 3. Do the work ...

# 4. Mark complete and release
./task update <task-id> --status done
./task release <task-id> --holder "<your-agent-id>"
```

Set a stable holder name with `TASK_AGENT_ID` (recommended) or `--holder`:

```bash
export TASK_AGENT_ID="cursor-$(hostname)"
./task acquire my-task-id
```

### Lock rules

- **One lock per task.** If `./task acquire` fails, another agent holds the lock — pick a different task.
- **Locks expire** after 1 hour by default. Renew during long work: `./task renew <id> --ttl 3600`
- **Do not bypass locks.** Never edit `.tasks/*.json` directly; the CLI serializes mutations with a global file lock and uses atomic lock directories for per-task claims.
- **Release when done**, even if the task is cancelled or blocked — use `./task release`.

### Status values

| Status        | Meaning                                      |
|---------------|----------------------------------------------|
| `open`        | Available; not yet started                   |
| `in_progress` | Actively being worked on (set on acquire)    |
| `done`        | Completed                                    |
| `cancelled`   | Will not be done                             |

## Task CLI reference

```bash
./task create  --title "..." [--description "..."] [--id custom-id]
./task list    [--status open|in_progress|done|cancelled] [--json]
./task show    <id> [--json]
./task update  <id> [--title "..."] [--description "..."] [--status STATUS]
./task delete  <id> [--force]
./task acquire <id> [--holder NAME] [--ttl SECONDS]
./task release <id> [--holder NAME] [--force]
./task renew   <id> [--holder NAME] [--ttl SECONDS]
```

Add `--json` to `list` or `show` for machine-readable output.

## Storage layout

```
.tasks/
  <task-id>.json       # task record (tracked in git)
  locks/
    <task-id>/
      meta.json        # runtime lock metadata (gitignored)
  .mutex               # runtime global lock file (gitignored)
```

Task JSON shape:

```json
{
  "id": "implement-timeline-a1b2",
  "title": "Implement timeline scrubbing",
  "description": "See docs/02-timeline-and-animation.md",
  "status": "open",
  "created_at": "2026-06-09T12:00:00Z",
  "updated_at": "2026-06-09T12:00:00Z"
}
```

Lock metadata (written by `acquire`, not edited manually):

```json
{
  "task_id": "implement-timeline-a1b2",
  "holder": "cursor-my-machine",
  "pid": 12345,
  "hostname": "my-machine",
  "acquired_at": "2026-06-09T12:05:00Z",
  "expires_at": "2026-06-09T13:05:00Z",
  "ttl_seconds": 3600
}
```

## Creating tasks

When breaking down new work, create tasks via the CLI:

```bash
./task create \
  --title "Add pencil tool" \
  --description "Implement pencil per docs/04-toolbox.md § Pencil"
```

Commit new task JSON files so other agents can pick them up.

## Project context

- **Goal:** Pixel-accurate Flash Professional 8 clone (authoring + SWF v8 output + FLA I/O).
- **Docs:** `docs/` defines required behavior domain by domain.
- **Accuracy first:** Match Flash 8 behavior exactly; see `docs/00-overview-and-architecture.md`.
