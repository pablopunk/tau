# pi-everywhere

Chat with a coding agent that works in your project folders, from the browser. It runs a small server on your computer (127.0.0.1 only) and opens a web app where you add project folders and start chats. The agent is built on Pi and talks to models through OpenRouter.

## Requirements

* Node.js 22.19 or newer
* An OpenRouter API key

## Run

```sh
npx pi-everywhere
```

The terminal prints a URL with a private token and opens it in your browser. Running it a second time prints the same URL and exits.

| Flag | Meaning |
| --- | --- |
| `--port <n>` | Preferred port (default 4317; the next free port is used if it is taken). |
| `--no-open` | Do not open the browser. |
| `--home <dir>` | Data home (default `~/.pi-everywhere`, or `PI_EVERYWHERE_HOME`). |
| `--faux` | Use a scripted fake model instead of OpenRouter (or `PI_EVERYWHERE_FAUX=1`). |

## OpenRouter key

On first start the app asks for your key and stores it in the data home. If the `OPENROUTER_API_KEY` environment variable is set, it is used before any pasted key.

## Data home

Everything lives in the data home: the agent database, settings, the saved key, the access token and a lock file that allows one running instance per home. Project folders are never copied; the agent works in them directly.

## Development

Use pnpm through mise: `mise exec -- pnpm <command>`.

* `pnpm check`: Biome and TypeScript.
* `pnpm test`: unit tests in every package.
* `pnpm build`: builds the web app, then the CLI bundle.
* `pnpm e2e`: Playwright against the built CLI in faux mode (run `pnpm exec playwright install chromium` once).

See `AGENTS.md` for the package layout and `MVP.md` for the design.
