<p align="center">
  <img src="./packages/web/public/favicon.svg" height="200" />
</p>


<h1 align="center">tau</h1>

<p align="center">
  <i align="center">The pi coding agent, everywhere you go.</i>
</p>


<p align="center">
  <img src="./assets/screenshots/diff.jpg" />
</p>

<table align="center">
  <tr>
    <td width="50%"><img src="./assets/screenshots/phone-thread.jpg" /></td>
    <td width="50%"><img src="./assets/screenshots/phone-sidebar.jpg" /></td>
  </tr>
</table>

## Run

Let `tau` take care of everything:

```sh
npx @pablopunk/tau
```

## Update

When a newer version is published, an **Update** button appears next to Settings (owner only). It installs the new version, restarts tau and reloads the page. From a terminal: `tau update` (`--check` only looks). An npx run shows the command to copy instead (`npm i -g @pablopunk/tau@latest && tau restart`), and a tau that was not started as a service must be restarted by hand. On a systemd or launchd service the button shows the command until the automatic restart is verified on that platform.
