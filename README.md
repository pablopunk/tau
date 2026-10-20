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

Install the signed binary (macOS and Linux, no Node or npm needed) and let `tau` take care of everything:

```sh
curl -fsSL https://github.com/pablopunk/tau/releases/latest/download/install.sh | sh
```

## Update

When a newer version is released, an **Update** button appears next to Settings (owner only). It downloads the release, verifies its SHA-256, swaps the install, restarts tau and reloads the page, and it rolls back if the new version does not come up. From a terminal: `tau update` (`--check` only looks). A tau that was not started as a service must be restarted by hand.
