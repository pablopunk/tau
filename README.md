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

```sh
npx @pablopunk/tau
```

This installs tau globally and runs it as a service (launchd on macOS, systemd on Linux). It starts at login and restarts if it crashes. It prints an `Open:` sign-in link and opens your browser. Run it again any time: it is safe, and it repairs a stale service.

To use tau from your phone or another device, run `tau pair`. It shows the QR code.

`tau serve` runs the server in the foreground. Use it for debugging only.

If there is no service manager (a container, or Linux without a user session), tau says so and runs in the background. It will not survive a reboot or logout.

Update an installed tau with `tau update` (`tau update --check` only looks).

## Nodes

Every tau is a **node**. Link two and each sees the other's threads: in the sidebar and in Settings → Nodes you can open a thread or a terminal that runs on the other node, from your laptop or your phone. A thread always lives on one node; the link does not move it.

```sh
# on node A: Settings → Nodes → Connect a node (shows a link, a code and a QR), then on node B:
tau connect <link>
tau connect <code> --node https://<a-tunnel-url>   # the same, with the short code and A's URL
tau disconnect [node]                              # unlink; both sides forget each other
tau nodes list                                     # rename, disconnect, forget, reset-identity too
```

Links are **symmetric**: whichever node runs `tau connect`, both see each other. Linking gives each node **full power over the other** (terminals, agents, files, Claude login): link only nodes you own. A node with no provider yet can skip setup with "Use my other nodes". Nodes must run the same tau version to open each other: after an update, run `tau update` on each node. Routing through a third node and removing a node from the whole group come later.
