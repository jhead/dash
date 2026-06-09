# Agent instructions — Flash 8 clone

This project uses a file-backed task manager for coordinating work across agents and
sessions. **All task operations go through `./task`.** Do not create, edit, or delete
task files under `.tasks/` by hand.

Agents may **create, update, and delete tasks at any time** as work evolves. The task
list is not fixed — treat it as a living backlog you maintain while working.

Agents may **spawn sub-agents at will** to parallelize work. Sub-agents must follow the
same task rules: each sub-agent acquires a lock on its own task before starting
implementation and releases it when done. Create the sub-tasks first (with `./task
create`), then hand each task ID to a spawned sub-agent. Do not bypass the task system
when splitting work across agents — locks prevent conflicts and the shared backlog keeps
all agents coordinated.

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

## Prioritization — critical path first

The backlog is not a buffet. Claim order:

1. Tasks titled **CRITICAL:** — always claim these before anything else.
2. MVP-gate work: the agent interface suite (0613–0616), the interactivity oracle
   (0518), and the capstone game (0519).
3. Everything else.

Rules:

- **Stop creating compile-only test-coverage tasks** for AS2 built-in classes
  (Accessibility, PrintJob, NetStream, Capabilities, ...). Coverage breadth is no longer
  the bottleneck — these add near-zero MVP value. Create test tasks only when tied to a
  critical-path feature or a real, observed bug.
- **Before creating any task, search for duplicates** — including `done` ones:
  `./task list --json | grep -i <keyword>`. Parallel agent waves have re-created ~20
  duplicate tasks; this wastes everyone's time.
- The MVP exit criterion is **0519**: author a basic Flash game in the tool, publish it,
  and verify it plays in Ruffle. If your task doesn't move toward that, question it.
- **Ruffle is the sole ActionScript execution engine.** Never create AVM1
  interpreter/runtime tasks (see docs/12-actionscript.md, docs/16-player-runtime.md).
- **Closing a task requires evidence.** A visual-oracle or e2e acceptance criterion means
  the spec actually ran and passed; don't mark done on unit tests alone. When a task asks
  for numbers or run output, paste them into the task (`./task update <id> --description`)
  before closing. The Oracle reopens evidence-free closures.
- **A task is not done until its code is committed.** Commit your own scope (and only
  your own scope) before marking done; do not leave finished work sitting in the shared
  working tree, and do not sweep other agents' uncommitted files into your commit.
- **Do not batch-create tasks you immediately self-close.** If the work fits in minutes,
  it was never a story — fold it into the story you already hold (see Task scope).
  Created-then-closed-in-one-sitting batches are backlog noise and will be audited.

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
./task create  --title "..." [--description "..."] [--id slug-without-prefix]
./task migrate
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
  <NNNN>-<slug>.json   # task record (tracked in git); NNNN = auto-increment id
  .counter             # next auto-increment number (tracked in git)
  locks/
    <NNNN>-<slug>/
      meta.json        # runtime lock metadata (gitignored)
  .mutex               # runtime global lock file (gitignored)
```

Task IDs and filenames always use a **4-digit auto-increment prefix** plus a slug
(e.g. `0007-stage-view-mvp`). `./task create` assigns the next number automatically;
`--id` sets the slug portion only. Legacy tasks without a prefix can be fixed with
`./task migrate`.

Task JSON shape:

```json
{
  "id": "0007-stage-view-mvp",
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
  "task_id": "0007-stage-view-mvp",
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

## Controlling the editor (Agent MCP bridge)

Connect Claude Code or any MCP client to the live editor:

```bash
claude mcp add --transport http flash-editor http://localhost:1420/mcp
```

Or use the `flash-agent` CLI (start the dev server first with `pnpm dev:browser`):

```bash
pnpm flash-agent tools                          # list tools with schemas
pnpm flash-agent call editor_status            # check editor is alive
pnpm flash-agent call doc_summary              # orient: scenes/layers/library
pnpm flash-agent call stage_add_shape '{"kind":"rect","x1":10,"y1":10,"x2":100,"y2":50}'
pnpm flash-agent screenshot -o stage.png       # write PNG to file
pnpm flash-agent publish -o movie.swf          # compile and write SWF
pnpm flash-agent repl                          # interactive session
```

See `docs/19-agent-interface.md` for the full tool surface.

## Project context

- **Goal:** Pixel-accurate Flash Professional 8 clone (authoring + SWF v8 output + FLA I/O).
- **Docs:** `docs/` defines required behavior domain by domain.
- **Accuracy first:** Match Flash 8 behavior exactly; see `docs/00-overview-and-architecture.md`.
