# Chat Rename Delete Design

**Goal:** Add dashboard controls to rename chat titles locally and delete persisted chats from history.

**Decision:** Minimal scope. Titles remain browser-local via the existing `localStorage` map. Delete is real and removes persisted chat history via API, except for the active run.

**API:** Add `DELETE /api/runs/:id`. No title API in this scope.

**UI:** Add delete affordances in the sidebar and open-thread header. Keep the existing prompt-based rename flow.

**Testing:** Add REST route coverage for delete success and active-run guard. Add dashboard HTML coverage for delete controls.
