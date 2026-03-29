# Ship Rebuild Agent PRD

**Date:** 2026-03-29

## Purpose

This document is meant to be copied directly into a coding agent.

Goal: rebuild the Ship app end to end in a deterministic execution flow.

The agent should **not** spend time planning. The plan is already provided here. The job is execution, verification, repair, and completion.

## Copy Paste Prompt

```text
You are rebuilding the Ship app end to end.

Operate in execution mode, not planning mode.

Do not generate a new plan unless explicitly blocked by missing requirements.
Do not ask broad product questions.
Do not re-scope the app.
Do not spend tokens on planner-style decomposition beyond what is written here.

Work style:
- one vertical slice at a time
- fresh worker or fresh context per slice if available
- each worker implements + adds tests + runs narrow validation
- orchestrator independently verifies the slice
- if verification fails, spawn a repair worker for that same slice
- move to next slice only after current slice passes its acceptance checks
- keep context lean; carry forward only what the next slice needs

Core success metric:
- final target passes typecheck + build + tests with 0 new errors
- no partial completion claims
- no "done because all steps were attempted"
- done only when the final integrated gate is green

Execution constraints:
- fix root cause, not surface symptoms
- preserve existing runtime/package manager/framework choices
- keep files reasonably small; split large files when needed
- add regression tests when fixing bugs or reliability issues
- after every slice, run targeted validation first, then broader validation as needed
- before final handoff, run full gate

Product to rebuild:
Ship is a collaborative document app with:
- PostgreSQL-backed data layer and migrations
- auth and session management
- document CRUD API
- realtime collaboration
- React frontend shell
- Tiptap rich text editor
- file uploads and comments

Execution order is fixed. Follow these verticals in order.

Vertical 1: Database schema and migrations
Requirements:
- establish database client and connection management
- define schema and migrations for users, sessions, documents, document membership if needed, comments, uploads, collaboration metadata
- provide local/dev-safe setup
Acceptance:
- migrations run cleanly from empty state
- schema supports downstream auth, documents, comments, uploads, realtime presence data
- tests cover migration/bootstrap or adjacent DB contracts where repo patterns support it

Vertical 2: Auth and session management
Requirements:
- session-cookie auth for web app
- API auth path where required by the product
- login/logout/session lookup flows
- authorization boundaries for document access
Acceptance:
- protected routes reject unauthorized access
- authenticated user can create and access own resources
- auth tests cover happy path + unauthorized path + access control edge cases

Vertical 3: Document CRUD API
Requirements:
- create/read/update/delete document endpoints or handlers
- list documents for current user
- persist title/content/metadata
- enforce document-level authorization
Acceptance:
- CRUD tests pass end to end
- invalid access fails correctly
- API shape is stable enough for frontend use

Vertical 4: Realtime collaboration
Requirements:
- realtime channel for document collaboration
- propagate edits/presence or equivalent collaboration events
- avoid corrupting persisted document state
Acceptance:
- at least one deterministic integration test or harness-backed verification for collaboration flow
- reconnect or multi-client behavior is handled at a basic reliable level

Vertical 5: React frontend shell
Requirements:
- app shell, routing, auth-aware navigation, document list, editor screen entry
- clear loading, empty, and error states
- visual system should be deliberate, not generic
Acceptance:
- shell can navigate through primary product flow
- authenticated user can reach documents UI
- major views render without runtime errors

Vertical 6: Tiptap rich text editor
Requirements:
- editor mounted in document experience
- save/sync loop integrated with backend/realtime model
- preserve core formatting/content behavior expected by product
Acceptance:
- editor interactions function locally
- persistence path works
- regression coverage exists for editor mount/save or equivalent critical path

Vertical 7: File uploads and comments
Requirements:
- attach uploads to documents or comments as product requires
- comments system tied to document context
- auth and access rules enforced
Acceptance:
- upload/comment flow works end to end
- tests cover allowed and denied cases

Global product requirements:
- local/dev must support the same behavior model as prod
- no prod-only hacks
- if env vars are needed, document them and update examples
- if migrations are needed, they must be runnable in dev
- avoid hidden manual steps

Global code requirements:
- prefer deterministic tests over manual-only claims
- keep changes reviewable and scoped to current slice
- avoid unrelated refactors unless needed to unblock the slice
- if architecture debt blocks progress, do the minimum refactor that unlocks the slice cleanly

Verification protocol per slice:
1. implement slice
2. add or update tests
3. run narrow validation for touched area
4. run slice-level integration validation if available
5. fix failures before moving on
6. record what passed and what remains

Orchestrator protocol:
- maintain a canonical checklist of the 7 verticals
- never mark a vertical done based only on worker self-report
- use independent verification result to mark done
- if a worker fails, retry with a focused repair worker
- if blocked after 2 focused repair attempts, summarize blocker precisely and stop

Completion gate:
- run full typecheck
- run full build
- run full tests
- verify no new errors remain
- verify core user flow works across auth -> document list -> document open -> editor -> comments/uploads path

Final deliverables:
- working rebuilt app
- passing tests and build
- concise summary of what changed per vertical
- list of residual risks if any

Important: execution only. No planner loop. Start with Vertical 1.
```

## Operator Notes

Recommended attachments when you use this prompt:

- product PRD / spec
- wireframes or screenshots
- target repo path or worktree
- any environment setup doc
- any current failure log or benchmark trace bundle

Recommended execution model:

- main orchestrator agent owns checklist and final verification
- fresh subagent per vertical slice
- fresh repair subagent only when verification fails
- sequential slices, not parallel edits to overlapping files

## Optional Input Template

Use this if you want one more explicit wrapper around the prompt.

```text
Target repo/worktree:
<fill this in>

Reference docs attached:
- <prd>
- <wireframes>
- <runbook>

Environment/setup notes:
<fill this in>

Special constraints:
<fill this in>

Now execute the PRD exactly as written. Start with Vertical 1.
```

