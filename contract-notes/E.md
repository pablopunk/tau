# E notes

* Palette "Settings" cannot reach `AppSidebar`'s `SettingsDialog` state without a change in MainLayout/C code. Workaround: `palette/settings-event.ts` dispatches a window event that `AppSidebar` listens to. If C hoists the settings dialog state, replace the event with it.
* Kept the labels `New chat in <project>`, `Rename chat` and `Add project`/`Folder path` because `app/App.test.tsx` (C) asserts them.
* `sidebar/test-support.tsx` is shared by the E tests only.
