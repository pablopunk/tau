# Notes from owner C (web)

* The ">6 processes" warning needs a count in `ClaudeCliStatus` (for example `processCount`). The protocol has none, so the row cannot show it yet.
* The thread header label "Claude CLI · Opus 5.5" is done in `ModelCombobox` by relabelling the selected option, because `Combobox` has one label for trigger and list. A `triggerLabel` on `ComboboxOption` would be cleaner.
