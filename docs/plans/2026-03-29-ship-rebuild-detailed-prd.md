# Ship Rebuild Detailed PRD

**Date:** 2026-03-29

## Intent

This is a detailed rebuild PRD for an execution agent.

It is not a harness PRD.
It is not a fleet-graph PRD.
It is not a planner prompt.

The end goal is simple:

**Rebuild the app so the resulting product behaves like Ship.**

That means the agent should focus on product and application parity:

- backend behavior
- frontend behavior
- editor behavior
- collaboration behavior
- auth and authorization
- uploads and comments
- final integrated quality gate

The agent should not spend time inventing a new roadmap. The phased roadmap is already provided below.

---

## Copy Paste Prompt

```text
You are rebuilding the Ship application.

Important framing:
- this is an app rebuild task
- not a fleet graph task
- not an agent runtime redesign task
- not a planner exercise
- the goal is end-state app parity with Ship

Operate in execution mode.

Use the phased PRD below as the source of truth.
Do not replace it with your own big-plan rewrite.
Do not spend tokens on high-level planning unless a requirement is genuinely missing.

Working mode:
- execute phase by phase
- within each phase, complete the listed scope and acceptance criteria
- add tests as you go
- validate each phase before moving on
- if a phase fails verification, repair that phase before advancing
- only claim completion when the whole app passes the final integrated gate

Product target:
Rebuild a collaborative document application equivalent to Ship:
- auth-aware web app
- document list and document workspace
- rich text editing
- realtime collaboration on documents
- comments and file attachments
- persistent backend with migrations

Definition of done:
- final app matches Ship's core user workflows
- typecheck passes
- build passes
- tests pass
- no new errors remain

Start at Phase 0 and proceed in order.
```

---

## Product Summary

Ship is a collaborative writing and document workspace product.

Core experience:

1. user signs in
2. user lands on a document-centric app shell
3. user can create and browse documents
4. user can open a document into a rich editor workspace
5. document changes persist reliably
6. multiple users can collaborate in realtime on the same document
7. users can discuss via comments
8. users can attach files where the product expects them

The rebuilt app does not need every edge-case feature Ship may have ever had, but it must deliver a strong product-equivalent core experience.

---

## Product Principles

### 1. App parity over implementation mimicry

The rebuild does not need the same internal code structure as Ship.
It does need the same effective product behavior for the main flows.

### 2. Vertical execution

Each phase should leave the app more real, not just more scaffolded.

### 3. Deterministic verification

Every phase should end with concrete validation, not intuition.

### 4. Local-first reproducibility

Anything that works in the rebuilt app should be runnable locally or in dev with the documented environment.

### 5. No hidden recovery debt

Do not mark phases complete if they silently break downstream phases.

---

## End State User Journeys

The rebuild is successful when these journeys work.

### Journey A: Sign in and land in app

- unauthenticated user is redirected or blocked appropriately
- user can authenticate
- authenticated user lands in the main app shell
- shell loads user-scoped document state

### Journey B: Create and edit a document

- user creates a document
- document appears in list/navigation
- user opens document
- rich editor loads current content
- edits persist

### Journey C: Resume an existing document

- user returns later
- document list loads persisted documents
- opening a document restores its content and metadata correctly

### Journey D: Collaborate with another user

- two sessions can open the same document
- content changes propagate in near realtime
- collaboration does not corrupt saved state

### Journey E: Comment and attach

- user can add contextual comments or document comments
- user can attach a file where the product expects uploads
- permissions are enforced

---

## Rebuild Scope

### In scope

- database layer and migrations
- auth and session management
- authorization model for document access
- document CRUD and listing
- realtime collaboration path
- frontend shell and navigation
- rich text editor integration
- comments
- uploads
- final integrated validation

### Out of scope unless required to unblock core parity

- analytics or admin tooling
- deep billing systems
- marketing site polish
- complex onboarding experiments
- unrelated infrastructure modernization
- agent runtime redesign

---

## Required Domain Model

The rebuild should support at least these concepts.

### Users

- identity
- profile basics as needed by UI

### Sessions

- session cookies or equivalent web session state
- expiration/lookup/invalidation

### Documents

- id
- title
- content payload
- owner or workspace association
- timestamps

### Document access

- ownership and/or membership model
- authorization rules for read/write access

### Comments

- comment id
- document association
- author association
- body/content
- timestamps

### Uploads

- file metadata
- storage reference/path
- association to document or comment context

### Collaboration state

- document channel identity
- presence or session metadata as needed
- synchronization-safe persistence boundary

---

## Required App Surfaces

The rebuild should ship the following primary surfaces.

### Auth surface

- sign-in view or auth entry flow
- sign-out path
- authenticated session restoration

### App shell

- persistent navigation or shell chrome
- document list/sidebar or equivalent
- route into active document workspace

### Document workspace

- document title state
- rich text editor area
- collaboration wiring
- comment access point
- upload access point

### Error and empty states

- no documents state
- missing document state
- unauthorized state
- save/load failure state

---

## Technical Expectations

Use the repo's existing stack and conventions.

General rules:

- preserve current package manager and runtime choices
- do not switch frameworks without explicit approval
- keep files reasonably small
- add regression tests when fixing failures
- prefer minimal, root-cause fixes

Quality rules:

- typecheck must stay healthy
- build must remain healthy
- tests should grow with the product surface
- no prod-only assumptions

---

## Phase Plan

## Phase 0. Baseline and foundations

### Goal

Establish a trustworthy starting point and basic project bootability.

### Scope

- understand current app structure and runtime entrypoints
- confirm package manager, env loading, build/test commands
- identify DB config path, server entry, frontend entry, editor integration points
- ensure local boot path is coherent enough for incremental rebuild work

### Deliverables

- baseline command set documented in working notes
- confirmed environment contract
- known blockers captured precisely

### Acceptance

- agent can run the repo's canonical typecheck/build/test commands
- agent knows where backend, frontend, DB, and realtime boundaries live
- no code churn unless needed to unblock the next phase

### Validation

- run typecheck
- run tests
- run build if available and safe

---

## Phase 1. Database schema and migrations

### Goal

Create the persistent data foundation required for the rest of the app.

### Scope

- database client setup
- connection handling
- schema definitions
- migrations
- bootstrap/dev setup

### Required entities

- users
- sessions
- documents
- document access or membership if needed
- comments
- uploads
- collaboration-related persisted metadata where needed

### Deliverables

- canonical DB access layer
- migration files from empty state
- initial schema for all core entities

### Acceptance

- migrations apply cleanly from empty state
- schema supports downstream auth, CRUD, comments, uploads, collaboration
- local setup path is documented or discoverable from repo patterns

### Validation

- migration command from clean state
- targeted DB tests or contract tests where patterns exist

---

## Phase 2. Auth and session management

### Goal

Enable reliable identity and protected app access.

### Scope

- sign in
- sign out
- session creation and lookup
- session restoration in app
- protected backend routes
- authorization model for document access

### Deliverables

- auth endpoints or handlers
- session middleware/helpers
- protected route behavior
- frontend auth-aware loading path

### Acceptance

- anonymous user cannot access protected data
- authenticated user can access their own allowed resources
- invalid or expired session is handled correctly
- document authorization boundaries are enforced

### Validation

- auth happy-path tests
- unauthorized access tests
- document access control tests

---

## Phase 3. Document CRUD API

### Goal

Make documents real and operable through the backend.

### Scope

- create document
- list user documents
- read single document
- update document metadata/content container
- delete or archive document if Ship flow expects it

### Deliverables

- document API or server handlers
- persistence wiring to DB
- authorization enforcement

### Acceptance

- user can create a document and see it again later
- document list is user-scoped
- invalid access is denied
- API shape is stable enough for the frontend to consume

### Validation

- CRUD endpoint tests
- auth boundary tests
- persistence round-trip verification

---

## Phase 4. Frontend shell and document list

### Goal

Create the actual navigable app experience.

### Scope

- authenticated shell layout
- navigation chrome
- document list or sidebar
- route into active document view
- create/open flows
- loading, empty, and error states

### Deliverables

- production-usable app shell
- document browser/list experience
- route-level state handling

### Acceptance

- signed-in user can reach the app shell
- user can browse documents
- user can create and open a document from the UI
- major screens render without runtime crashes

### Validation

- component/integration tests where appropriate
- route/render smoke coverage
- manual or automated shell-path verification

---

## Phase 5. Rich text editor integration

### Goal

Make the document workspace editable in a way that feels like Ship.

### Scope

- mount the rich text editor in document workspace
- load existing document content into editor
- persist editor changes
- keep content model stable enough for collaboration and reload

### Deliverables

- editor container
- load/save loop
- title/content synchronization as product requires

### Acceptance

- opening a document loads content into the editor
- editing changes local state and persistence path correctly
- reloading restores saved content

### Validation

- targeted editor integration tests
- save/reload regression test

---

## Phase 6. Realtime collaboration

### Goal

Enable multi-session collaborative editing.

### Scope

- realtime session/channel wiring
- multi-client document sync
- presence or lightweight collaborator state if product expects it
- persistence boundary that avoids corrupt writes

### Deliverables

- collaboration transport integration
- document channel lifecycle
- basic multi-user sync behavior

### Acceptance

- two sessions can edit the same document and observe updates
- persistence does not regress under collaboration
- disconnect/reconnect behavior is at least minimally reliable

### Validation

- deterministic collaboration integration test if possible
- otherwise a harness-backed repeatable validation script

---

## Phase 7. Comments

### Goal

Enable discussion attached to document context.

### Scope

- comment create/read/list path
- author attribution
- document-scoped authorization
- UI placement in workspace

### Deliverables

- backend comments model and endpoints/handlers
- UI comment rendering and creation flow

### Acceptance

- authorized users can add and read comments in document context
- unauthorized users cannot access comments for restricted docs

### Validation

- backend comment tests
- document authorization tests
- UI flow verification if supported

---

## Phase 8. File uploads and attachment flows

### Goal

Support file attachment behavior expected by Ship.

### Scope

- upload endpoint or storage path
- metadata persistence
- file association with document or comment context
- UI entry points and attachment display rules
- auth and authorization around upload access

### Deliverables

- upload backend flow
- attachment persistence model
- UI attachment flow

### Acceptance

- authorized user can attach a file in the intended product context
- unauthorized access is blocked
- attachment metadata survives reload

### Validation

- upload tests
- auth boundary tests
- UI or integration flow validation

---

## Phase 9. Final polish and integrated gate

### Goal

Prove the rebuilt app actually works as a cohesive product.

### Scope

- close remaining integration gaps
- remove obvious drift between backend and frontend
- ensure env/config/docs are aligned
- run final integrated validation

### Acceptance

- user can sign in
- user can create/open/edit a document
- user can persist and reload content
- collaboration path works
- comments path works
- upload path works
- typecheck passes
- build passes
- tests pass

### Validation

- full typecheck
- full build
- full test suite
- final product flow verification across the primary journeys

---

## Cross Phase Requirements

These apply to every phase.

### Authorization

Every new data surface must enforce auth and access rules.

### Error handling

Failures should be visible and actionable, not swallowed silently.

### Testing

Each phase should leave behind tests that protect its behavior.

### Documentation

If a new env var, migration step, or setup rule is introduced, update docs and examples in the same phase.

### Local parity

No phase may rely on a prod-only assumption to appear complete.

---

## Required Verification Protocol

For each phase, the agent must:

1. implement the phase scope
2. add or update targeted tests
3. run the narrowest relevant validation
4. fix failures
5. re-run validation
6. only then mark the phase complete

For final completion, the agent must:

1. run full typecheck
2. run full build
3. run full tests
4. verify core product journeys
5. only then declare the rebuild complete

---

## Delivery Rules For The Agent

### Do

- execute sequentially by phase
- fix root causes
- preserve repo conventions
- keep diffs reviewable
- add regression tests when fixing bugs

### Do not

- rewrite the product scope
- stop at mock UI without backend behavior
- stop at backend APIs without frontend path completion
- claim done because individual slices look good in isolation
- spend effort redesigning agent orchestration instead of rebuilding the app

---

## Final Output Expected From The Agent

At the end, the agent should provide:

- a phase-by-phase completion summary
- files changed per major area
- validation commands run
- validation results
- residual risks or known gaps if anything remains

If blocked, the agent should report:

- exact blocker
- exact phase
- exact missing requirement or failing dependency
- concrete next options

---

## Operator Attachment Checklist

When sending this PRD to an agent, attach if available:

- Ship product PRD or functional spec
- wireframes or screenshots
- target repo/worktree path
- env/setup notes
- known failing traces or benchmark logs

---

## Optional Wrapper Prompt

```text
Target repo/worktree:
<fill in>

Reference attachments:
- <product prd>
- <wireframes>
- <runbook>
- <failing traces if any>

Instruction:
Rebuild the app to match Ship using the attached detailed phased PRD.
Do not redesign agent runtime internals.
Do not use a planner loop.
Execute phase by phase, verify each phase, then run the full integrated gate.
Start with Phase 0.
```

