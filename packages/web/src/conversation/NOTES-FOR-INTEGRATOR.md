# Notes for the integrator (agent D, composer-web)

* `routes/NewThreadPage.tsx`: pass `projectId={projectId}` to `<Composer>` so `@` mentions search the chosen project. Slash commands are optional; pass `commands={{ model: ..., thinking: ... }}` (a `CommandHandlers`) to enable `/model` and `/thinking` there. Use a `useRef<PickersHandle>` on `ModelThinkingPickers` (`ref` prop) and call `openModel()` / `openThinking()`.
* `Composer` now needs a `QueryClientProvider` (skills query). The app already has one.
* `ModelThinkingPickers` opens by clicking its trigger through a `ref` handle. A controlled `open` prop on `components/ui/combobox.tsx` would be cleaner.
* `/rename` reuses `sidebar/NameDialog` (imported, not edited). `/archive` calls `api.conversations.archive` and navigates to `/`.
* `/new` navigates to `/?project=<id>`, the same query the new thread page reads.
* The context meter lives in `ThreadToolbar` and needs the `TooltipProvider` already mounted in the app.
