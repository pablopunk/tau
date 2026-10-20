# Integrator notes (web, binary)

- The install script URL is hard-coded in `settings/ConnectNodeDialog.tsx` (`INSTALL_COMMAND`): `https://github.com/pablopunk/tau/releases/latest/download/install.sh`. The release owner must publish `install.sh` there.
- The "update tau" hint (`nodes/node-text.ts`, `updateCommand`) is now `tau update`. The CLI owner must provide that command.
- `UpdateButton`/`UpdateDialog` were already generic: `run` shows the button, anything else shows `install.command` as sent.
- e2e (`update-support.ts`, `update-button.spec.ts`) may still expect npm copy: integrator's.
