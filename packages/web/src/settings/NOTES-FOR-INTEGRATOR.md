# Notes for the integrator (settings-web)

* `main.tsx`: call `applyTheme()` from `@/lib/theme` once before `createRoot` (not in my files).
* `app/providers.tsx` still wraps the app in `next-themes` `ThemeProvider` (own storage key `theme`, own `.dark` writes). It fights `lib/theme.ts`. Remove it; `components/ui/sonner.tsx` uses `useTheme` from next-themes and should read `preferences`/the `.dark` class instead.
* `app/App.test.tsx` setup test was updated to the provider rows flow (Add key, Save, Continue).
* `setup/KeyForm.tsx` was deleted; the `Setup` gate in `App.tsx` is unchanged and works with the new `SetupScreen`.
* No missing ui pieces. The disconnect confirm is inline (no AlertDialog in ui).
