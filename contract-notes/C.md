# Notes from agent C

* `Composer` (conversation/, not mine) has no `disabled` prop. "Cloning…" is shown next to the project picker and `onSend` rejects with "Cloning… you can send once the project is ready." Needs: a Composer `disabled` prop so Send is truly disabled.
* Pushed time shows as text in the option hint (`local · 3d`) because `ComboboxOption.hint` is a string; a `RelativeTime` node would need `hint: ReactNode`.
* The code-folder suggestion shows the absolute path the server returns (no `~` shortening).
