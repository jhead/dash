# Agent instructions — Flash 8 clone

This project uses a file-backed task manager for coordinating work across agents and
sessions. **All task operations go through `./task`.** Do not create, edit, or delete
task files under `.tasks/` by hand.

Agents may **create, update, and delete tasks at any time** as work evolves. The task
list is not fixed — treat it as a living backlog you maintain while working.

## Task scope

Tasks are **stories**: meaningful units of deliverable work, not checklist items.

| Good (story-sized)              | Too small (do not create)     |
|---------------------------------|-------------------------------|
| Stage MVP                       | Run tests                     |
| Timeline scrubbing & playback   | Fix typo in comment           |
| Pencil tool (Flash 8 parity)    | Add import for utils          |
| FLA project open/save           | Update README                 |

A story should represent hours to days of focused work — a feature slice, subsystem, or
vertical milestone — not a single commit or routine step. Testing, refactors, and small
fixes belong *inside* the story you already hold; they do not get their own tasks.

**Breaking down work:** While implementing a story, you may discover sub-stories worth
tracking separately (e.g. holding "Stage MVP" and creating "Stage zoom & pan" when scope
grows). Create sibling or follow-up tasks with `./task create`, link them in the
description, and leave them `open` for other agents or a later session. You do not need
permission — use your judgment.

Conversely, merge or delete tasks that turned out to be duplicates or too granular:
`./task update` to refine, `./task delete` to remove.

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

# 3. Do the work (create/update/delete sibling tasks as scope becomes clear) ...

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
  "id": "stage-mvp-a1b2",
  "title": "Stage MVP",
  "description": "Minimal stage: canvas, zoom, pan. See docs/01-documents-stage-scenes.md",
  "status": "open",
  "created_at": "2026-06-09T12:00:00Z",
  "updated_at": "2026-06-09T12:00:00Z"
}
```

Lock metadata (written by `acquire`, not edited manually):

```json
{
  "task_id": "stage-mvp-a1b2",
  "holder": "cursor-my-machine",
  "pid": 12345,
  "hostname": "my-machine",
  "acquired_at": "2026-06-09T12:05:00Z",
  "expires_at": "2026-06-09T13:05:00Z",
  "ttl_seconds": 3600
}
```

## Managing tasks

Use the CLI freely throughout a session — not only at the start.

**Create** story-sized tasks when you identify new work:

```bash
./task create \
  --title "Stage MVP" \
  --description "Minimal stage: canvas, zoom, pan, pixel grid. See docs/01-documents-stage-scenes.md"
```

**Update** when scope, status, or description changes:

```bash
./task update stage-mvp-a1b2 --description "Add pixel-snapping; see docs/01 § Stage properties"
./task update stage-mvp-a1b2 --status cancelled   # if superseded
```

**Delete** tasks that are duplicates, obsolete, or mistakenly too small:

```bash
./task delete run-tests-x9f2              # remove mistaken micro-task
./task delete obsolete-id --force         # --force only when the task is locked
```

**Example — breaking down mid-story:**

```bash
# You hold the lock on "Stage MVP" and realize zoom/pan is a separate chunk of work.
./task create \
  --title "Stage zoom and pan" \
  --description "Split from stage-mvp-a1b2. See docs/01-documents-stage-scenes.md"

# Keep working the original story, or release and pick up the new one.
./task update stage-mvp-a1b2 --description "Canvas + grid only; zoom/pan → stage-zoom-pan-c4d1"
```

Commit new or updated task JSON files so other agents see the current backlog.

## Project context

- **Goal:** Pixel-accurate Flash Professional 8 clone (authoring + SWF v8 output + FLA I/O).
- **Docs:** `docs/` defines required behavior domain by domain.
- **Accuracy first:** Match Flash 8 behavior exactly; see `docs/00-overview-and-architecture.md`.
