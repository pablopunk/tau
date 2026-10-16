# Notes from E (sidebar and icons)

* `packages/web/src/app/App.test.tsx` (owner C) has 4 tests that expect the Projects layout (`New thread in <project>`, `Actions for <project>`, project groups). The sidebar default is now Threads mode (MVP3.md). Fix: call `preferences.setSidebarMode("projects")` in that file's `beforeEach` (or adapt the queries).
* `ConversationSummary` has no model, so the row tooltip shows title, project and status only. If the model should show, `toSummary` needs a `model` field.
* `useAllConversations` still sorts by `updatedAt`; the sidebar re-sorts by `lastActivityAt` (tie: id desc) itself in `sidebar/sidebar-model.ts`.
