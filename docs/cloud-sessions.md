# Cloud sessions

`scripts/cloud-session-setup.sh` prepares a fresh Claude Code cloud container
so that `cargo test --all` and `npm run build` work from the first command:

- apt packages: the Tauri system libraries (`libwebkit2gtk-4.1-dev`,
  `libgtk-3-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`),
  `device-tree-compiler` and `gcc` (for `cpp`);
- `app/dist`, which `tauri::generate_context!` needs to exist;
- `npm install` in `app/` (not `npm ci`, so the cached container keeps its
  `node_modules`);
- `cargo fetch --locked`.

It does nothing outside cloud sessions (`CLAUDE_CODE_REMOTE` is not `true`) and
is safe to run again.

## Registering it as a SessionStart hook

Add this to `.claude/settings.json` (create the file if it does not exist):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/scripts/cloud-session-setup.sh"
          }
        ]
      }
    ]
  }
}
```

The hook runs synchronously, so a session only starts once the dependencies
are in place. To start faster at the price of a possible race with the first
commands, make the script print `{"async": true, "asyncTimeout": 300000}` first.
