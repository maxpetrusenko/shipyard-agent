# Planless Rebuild Wireframes

**Date:** 2026-03-29

These wireframes are reference artifacts for the planless rebuild mode. They are intentionally low fidelity and optimized for execution planning, not final visual design.

---

## 1. Rebuild Setup

```text
+-----------------------------------------------------------------------------------+
| Rebuild Setup                                                                     |
+-----------------------------------+-----------------------------------------------+
| Inputs                            | Plan Preview                                  |
|                                   |                                               |
| Target Repo                       | Rebuild Plan                                  |
| [ ship-refactored            v ]  | 1. Database schema + migrations               |
|                                   | 2. Auth + session management                  |
| Target Worktree                   | 3. Document CRUD API                          |
| [ /tmp/rebuild-...            ]   | 4. Realtime collaboration                     |
|                                   | 5. React frontend shell                       |
| Plan Source                       | 6. TipTap editor                              |
| [ paste json / markdown      ]    | 7. File uploads + comments                    |
|                                   |                                               |
| PRD Context                       | Validation                                    |
| [ attached: rebuild-prd.md   ]    | - 7 steps                                     |
|                                   | - 7 file scopes listed                        |
| Wireframes Context                | - no missing indices                          |
| [ attached: rebuild-wireframes ]  | - planner bypass: enabled                     |
|                                   |                                               |
| [ Start Planless Rebuild ]        |                                               |
+-----------------------------------+-----------------------------------------------+
```

---

## 2. Run Workspace

```text
+-----------------------------------------------------------------------------------+
| Planless Rebuild Run                                                              |
+----------------------------+--------------------------------+---------------------+
| Supplied Plan              | Active Step                    | Verification         |
|                            |                                |                     |
| 1  done                    | Step 4 of 7                    | Last step result     |
| 2  done                    | Realtime collaboration         | typecheck: pass      |
| 3  done                    |                                | build: not run       |
| 4  running                 | Worker: step-4-implement-1     | tests: fail          |
| 5  pending                 | Repair attempts: 1/2           | new errors: 2        |
| 6  pending                 |                                |                     |
| 7  pending                 | Worker log / trace summary     | [ Spawn Repair ]     |
|                            |                                |                     |
| [ Open PRD ]               | [ streamed timeline ]          | [ Open final gate ]  |
| [ Open Wireframes ]        |                                |                     |
+----------------------------+--------------------------------+---------------------+
```

---

## 3. Final Gate

```text
+-----------------------------------------------------------------------------------+
| Final Rebuild Gate                                                                |
+-----------------------------------+-----------------------------------------------+
| Gate Summary                      | Artifacts                                      |
|                                   |                                               |
| typecheck   PASS                  | typecheck log                                 |
| build       PASS                  | build log                                     |
| test        FAIL                  | test log                                      |
| new errors  3                     | trace pack                                    |
| retry state present: yes          | issues snapshot                               |
|                                   |                                               |
| Result: NOT COMPLETE              | Next action                                   |
|                                   | - fix failing tests                           |
| [ Run repair attempt ]            | - rerun final gate                            |
+-----------------------------------+-----------------------------------------------+
```

---

## 4. Benchmarks Page

```text
+-----------------------------------------------------------------------------------+
| Benchmarks                                                                        |
+-----------------------------------------------------------------------------------+
| Tabs: [ Best Verified ] [ Latest Attempts ] [ Rebuild Gates ] [ Issues ]         |
+-----------------------------------------------------------------------------------+
| Best Verified Runs                                                                |
| Instruction                          Status   Duration   Tokens   Edits   Trace   |
| Database schema                      done     4m31s      1.2M     1       open    |
| Auth + sessions                      done     5m10s      1.8M     4       open    |
| ...                                                                               |
+-----------------------------------------------------------------------------------+
| Latest Attempts                                                                   |
| Includes noisy failures, cancels, and exploratory reruns for auditability         |
+-----------------------------------------------------------------------------------+
| Rebuild Final Gates                                                                |
| Campaign                 Typecheck   Build   Test   New Errors   Complete         |
| 2026-03-29 /tmp/...      pass        pass    fail   3            no               |
+-----------------------------------------------------------------------------------+
```

---

## Notes

- The rebuild setup screen should make planner bypass explicit.
- The run workspace should keep PRD and wireframes one click away for worker context debugging.
- The benchmarks page should stop mixing “best evidence” and “latest noise” into one table.

