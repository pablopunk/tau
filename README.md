<p align="center">
  <img src="./packages/web/public/favicon.svg" height="128" />
</p>
<p align="center">
  <i align="center">Chat with a coding agent that works in your project folders, from the browser.</i>
</p>

<h1 align="center">tau</h1>

## Features

- 🏠 **Home project included**: your home folder is always there; add folders or clone a Git repo (https or ssh).
- 💬 **Threads**: pick project, model and thinking level; attach, paste or drop images.
- ✨ **Generated titles**: an optional fast model names your threads; status dots show running, failed or new activity.
- ⌨️ **Fast to use**: command palette (`Cmd/Ctrl+K`), keyboard shortcuts, desktop notifications when a run ends.
- 🐙 **GitHub-aware**: with `gh` logged in, pick from your repos (newest push first); clone or link to a folder on disk.
- 🎨 **Project icons**: found in the project (favicon, logo, app icon) or uploaded by you.

## Run

```sh
npx tau
```

Requires Node.js 22.19+ and an OpenRouter API key (asked on first start, or `OPENROUTER_API_KEY`).

The terminal prints a private URL and opens it in your browser. Running it again prints the same URL and exits.

| Flag | Meaning |
| --- | --- |
| `--port <n>` | Preferred port (default 4317; next free port if taken). |
| `--no-open` | Do not open the browser. |
| `--home <dir>` | Data home (default `~/.tau`, or `TAU_HOME`). |
| `--faux` | Scripted fake model instead of OpenRouter (or `TAU_FAUX=1`). |

Everything lives in the data home (database, settings, key, token). Projects are never copied; the agent works in them directly.
