# Herdr integration contract

Pinned contract for migrating 2code onto [Herdr](https://herdr.dev). Later tasks must depend on this release and the behaviors marked **verified** below. Claims from Herdr docs that this probe did not execute are marked **documented** or **unverified**.

**Decision: proceed** with Herdr **v0.9.0** for Tasks 2–9 on Linux and macOS. Windows JSON control is documented; Windows live terminal attach is **unsupported** by Herdr and is tracked in [#396](https://github.com/AkaraChen/2code/issues/396) for Task 10, not as a blocker for the JSON bridge.

Machine that executed this probe: Linux x86_64. Reproduction does not use `latest`.

## Pinned release

| Field | Value |
| --- | --- |
| Version | `0.9.0` |
| Tag | `v0.9.0` |
| Source commit | `b99002ac99b09e00b4ca692436cb15a6b0d676f1` |
| Release | https://github.com/herdrdev/herdr/releases/tag/v0.9.0 |
| Published | 2026-09-07T19:21:31Z |
| License | Apache-2.0 ([LICENSE](https://github.com/herdrdev/herdr/blob/v0.9.0/LICENSE)) |
| JSON protocol | 22 |
| Schema version | 1 |
| Endpoint generation | 1 |

Checksums are GitHub Release asset SHA-256 digests. This tag does not publish a detached GPG or cosign signature for the binaries.

| Asset | Target | SHA-256 |
| --- | --- | --- |
| [herdr-linux-x86_64](https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-linux-x86_64) | `x86_64-unknown-linux` | `4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f` |
| [herdr-linux-aarch64](https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-linux-aarch64) | `aarch64-unknown-linux` | `9c8db20fb7e7427b138d5367113f1621ffd319f2f65d6f009e2594029115f0d2` |
| [herdr-macos-aarch64](https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-macos-aarch64) | `aarch64-apple-darwin` | `32b53df09872628059c789a69f02a6b8e29e14ddf26711421f3463f70c1aef17` |
| [herdr-macos-x86_64](https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-macos-x86_64) | `x86_64-apple-darwin` | `d0c920b2a126a74809fa1491411c9a097a44786cac9c2ca51b818a995581cf16` |
| [herdr-windows-x86_64.zip](https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-windows-x86_64.zip) | `x86_64-pc-windows-msvc` | `b4508c445de1c1a68c760a01735da2aba2fa214b2aafd4b07f732e49b2a64b11` |

There is no Windows ARM64 stable asset. The Linux x86_64 binary is a static-pie ELF (`BuildID=2c0360b8fa3d9e8fff96e3124c529848ca7814c4`).

Canonical pin file: `src-tauri/crates/infra/tests/fixtures/herdr/pin.json`.

## How to obtain the binary

Do not commit binaries. Cache them outside the repo:

```bash
VERSION=0.9.0
ASSET=herdr-linux-x86_64
SHA=4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f
DIR="${XDG_CACHE_HOME:-$HOME/.cache}/2code/herdr/v$VERSION"
mkdir -p "$DIR"
curl -fL -o "$DIR/$ASSET" \
  "https://github.com/herdrdev/herdr/releases/download/v$VERSION/$ASSET"
echo "$SHA  $DIR/$ASSET" | sha256sum -c
chmod +x "$DIR/$ASSET"
"$DIR/$ASSET" --version   # herdr 0.9.0
```

macOS uses `shasum -a 256`. Windows: download the zip, verify the zip digest, then use `herdr.exe` from the archive.

Override the probe with `HERDR_BIN=/path/to/verified-binary`. The test still checks that digest against the pin.

## Isolated reproduction

```bash
cd src-tauri
cargo test -p infra --test herdr_contract -- --nocapture
```

`cargo test --workspace` from `src-tauri` also runs this probe when the pinned binary is in the cache (or `HERDR_BIN`). If the binary is missing the live tests skip unless `HERDR_CONTRACT_REQUIRED=1`.

The probe:

1. Sets `XDG_CONFIG_HOME`, `HOME`, and `SHELL=/bin/sh` to a temp directory.
2. Writes `onboarding = false` and a private `[worktrees].directory`.
3. Starts `herdr --session <unique> server` in the foreground.
4. Talks to `$XDG_CONFIG_HOME/herdr/sessions/<name>/herdr.sock`.
5. Stops the session in `Drop` (`herdr session stop` then `kill`).

Cleanup if a test is interrupted:

```bash
herdr --session <name> session stop
# or: kill the herdr server PID; then rm -rf the temp XDG dir
```

`herdr server` stays in the foreground. Status reports `detached_server_daemon: false` for that launch. Task 4 must spawn a detached process so GUI exit does not take the server with it. Closing CLI clients does **not** stop this server.

## Control API (JSON)

Newline-delimited JSON over a Unix domain socket (Windows: named pipe). One request per line; the response repeats `id`.

Verified against v0.9.0:

```json
{"id":"req_1","method":"ping","params":{}}
{"id":"req_1","result":{"type":"pong","version":"0.9.0","protocol":22,"capabilities":{"live_handoff":true,"detached_server_daemon":false,"endpoint_protocol_generation":1,"surface_interest":true,"health_check":true}}}
```

Dump the schema bundled in the binary (not from the website):

```bash
herdr api schema            # protocol: 22
herdr api schema --json
herdr api schema --output herdr-api.schema.json
```

An excerpt of methods and subscribe types is in `tests/fixtures/herdr/schema-excerpt.json` (102 methods). Terminal frame records are **not** in that schema.

| Method | Verified behavior |
| --- | --- |
| `ping` | `type: pong` plus version/protocol/capabilities |
| `session.snapshot` / `herdr api snapshot` | `{type: session_snapshot, snapshot: {version, protocol, workspaces, tabs, panes, layouts, agents}}` |
| `events.subscribe` | first line `{type: subscription_started}`; later lines `{event, data}`. Subscribe types use dots (`tab.created`); emitted `event` names use underscores (`tab_created`). Subscriptions do not replay history. |
| `workspace.create` | returns `workspace_created` with `workspace`, `tab`, `root_pane` |
| `workspace.list` / `get` / `rename` / `close` | rename keeps `workspace_id`; last-tab/group rules below |
| `worktree.list` / `create` / `open` / `remove` | see worktree section |
| `tab.create` | returns `tab_created` with `tab` and `root_pane` |
| `pane.list` / `get` / `split` / `read` / `scroll` / `run` | see terminal section |
| `server.stop` / `herdr session stop` | stops the named session |

Socket resolution (verified): `--session` wins; else `HERDR_SOCKET_PATH`; else `$XDG_CONFIG_HOME/herdr/herdr.sock`. Named sessions live at `.../herdr/sessions/<name>/herdr.sock`. The binary client socket is `herdr-client.sock` beside the API socket (or `*-client.sock` when `HERDR_SOCKET_PATH` ends in `.sock`).

`herdr status --json` reports client/server version, protocol 22, endpoint generation, socket path, and session name. Headless `herdr server` is ready once the API socket accepts a connection.

## Terminal frames

**Supported transport for Task 10:** the pinned CLI helper, not the JSON API.

```text
herdr terminal session observe <pane|terminal|agent> [--cols N] [--rows N]
herdr terminal session control <target> [--takeover] [--cols N] [--rows N]
```

Internally this uses the numbered binary protocol on `herdr-client.sock` and negotiates `RenderEncoding::TerminalAnsi`. Direct `herdr terminal attach` is the interactive TUI form of the same exclusivity rules. Herdr documents both as Linux/macOS only, not native Windows.

Stdout is newline-delimited JSON:

```json
{"type":"terminal.frame","seq":1,"encoding":"ansi","width":80,"height":24,"full":true,"bytes":"<base64>"}
{"type":"terminal.closed","reason":"..."}
```

Verified frame semantics:

- Bytes are base64-encoded ANSI, including UTF-8 text.
- `full: true` is a complete redraw. The payload typically starts with synchronized output (`CSI ? 2026 h`), hide-cursor, OSC 8 reset, `CSI 2 J` / `CSI 1;1 H`, then the screen. An xterm.js consumer must treat this as a replacement surface (reset/clear, then write), not as extra scrollback.
- `full: false` is incremental output to apply on top of the current surface.
- `seq` increases per stream. Use it for ordering; do not assume a global seq across observers.
- The first frame after attach is `full: true` at the requested cols/rows and includes the current screen (so reconnect does not require a separate history replay API).
- Resize (`terminal.resize`) is followed by frames at the new `width`/`height`, including a `full: true` redraw.
- Control stdin commands (one JSON object per line):

```json
{"type":"terminal.input","text":"echo hi\n"}
{"type":"terminal.input","bytes":"<base64>"}
{"type":"terminal.resize","cols":90,"rows":28}
{"type":"terminal.scroll","direction":"up","lines":2,"source":"wheel"}
{"type":"terminal.release"}
```

`terminal.input` accepts `text` **or** `bytes`, not both. `cols`/`rows` and scroll `lines` must be `> 0`. Optional resize fields: `cell_width_px`, `cell_height_px`. Scroll `source` is `wheel` (default) or `page_key`.

JSON `pane.scroll` with `offset_from_bottom` is a second, verified way to set scroll position. `pane.get` exposes `scroll: {offset_from_bottom, max_offset_from_bottom, viewport_rows}`. `offset_from_bottom == 0` is at-bottom.

`pane.read` prints UTF-8 text (not JSON). `--ansi` keeps SGR. Sources: `visible`, `recent`, `recent-unwrapped`, `detection`. Default recent window is 80 rows. This is a snapshot helper, not the live transport.

`pane.run` submits text plus Enter (empty stdout on success). `pane.send-text` / `pane.send-keys` are lower-level and also print nothing on success.

Default scrollback is 10,000,000 bytes (`advanced.scrollback_limit_bytes`). Pane screen history across server restart is off (`experimental.pane_history = false`). Headless size defaults to 120×40; this probe used 80×24.

Unicode in pane output was verified (`αβγ`). ANSI color sequences are present in `--ansi` reads and in `terminal.frame` bytes. Alternate-screen (`tput smcup`) was not a reliable probe here (`TERM`/capability dependent) — treat as **unverified** for Task 11. Terminal query replies (DSR/DA) were not exercised.

## Controller exclusivity

Verified:

- One writable controller at a time.
- A second `terminal session control` without `--takeover` exits 0 and prints `{"type":"terminal.closed","reason":"terminal attach failed: terminal term_… already has an attached client; retry with --takeover"}`.
- `--takeover` makes the previous controller receive `{"type":"terminal.closed","reason":"terminal attach taken over"}`.
- After `terminal.release` (or process exit), a new controller can attach without `--takeover`.
- `observe` does not take input/resize/scroll/takeover authority. Control can run while observers exist.
- Multiple observers of the same terminal are allowed.

2code must not silently take control. Task 18 should surface the conflict string and require an explicit takeover.

## Workspace and worktree lifecycle

A workspace create also creates tab `wN:t1` and root pane `wN:p1` with a `terminal_id`. An empty server has no default workspace.

Worktree commands need a git checkout. `--cwd` / `--path` on the socket API must be absolute (the CLI expands relatives). `--trust-repository` trusts that path for one request.

| Operation | Verified result |
| --- | --- |
| `worktree.create --branch wt/contract` | creates a git worktree under `[worktrees].directory` (`~/.herdr/worktrees` by default), opens workspace `wN` with `worktree.is_linked_worktree: true`, emits create records |
| `worktree.open --path <existing>` | `already_open: false` the first time; preserves uncommitted files; does not recreate the checkout |
| `worktree.open` again | `already_open: true` with the **same** `workspace_id` / `pane_id` / `terminal_id` |
| `worktree.create` for a branch already used | `worktree_create_failed` (git fatal: already used by worktree at …) |
| `worktree.remove` on a dirty checkout | `dirty_worktree_requires_force`; checkout kept |
| `worktree.remove --force` | deletes the checkout directory; **does not delete the git branch** |
| `worktree.remove` on a clean linked worktree | deletes the checkout; keeps the branch |
| `workspace.close` on a primary with linked worktrees open | `workspace_group_close_required` |
| `workspace.close --group` | closes Herdr state for the group; **does not** delete git worktrees |

`workspace.close` kills the pane PTY (SIGHUP). It is not “forget this project”.

## Identity stability

| ID | Across enumerate / rename / detach | Across server restart |
| --- | --- | --- |
| `workspace_id` (`wN`) | stable; not the label | restored from `session.json` |
| `tab_id` (`wN:tM`) | stable | restored |
| `pane_id` (`wN:pK`) | stable | restored |
| `terminal_id` (`term_<hex>`) | stable while the PTY lives | **new** (new process) |

Do not key 2code records on display names. After restart, reattach by `pane_id`; expect a new `terminal_id` and an empty screen unless pane history or native agent restore applies. Restored panes are new shells in the saved cwd — not the old processes.

Public IDs increment for new objects in a session (`w1` closed then created becomes `w2`). Internal `session.json` uses numeric pane ids, not public ids.

## External split mapping

Verified: `pane.split --direction right` creates `wN:p2` with its own `terminal_id` in the same tab. `pane.layout` / `session.snapshot.layouts` include pane rects and a `splits` array (`direction`, `ratio`, `rect`).

**Supported 2code mapping for this migration:**

| Herdr | 2code |
| --- | --- |
| git repo / `worktree.repo_key` | project |
| workspace (primary or linked worktree) | profile |
| every pane in that workspace (all tabs, including splits) | terminal tab |
| `pane_id` | terminal identity for attach/close |
| `terminal_id` | live PTY identity (do not persist across restart) |

Split **layout is flattened**: 2code does not reconstruct Herdr’s BSP grid. Every pane is still listed, selected, reattached, and closed. Closing a 2code tab maps to `pane.close`. Closing the last pane/tab of a workspace closes that workspace (Herdr CLI: last tab closes the workspace). If an external pane disappears, drop the 2code tab during snapshot/event reconcile — do not recreate it.

Herdr tabs in the same workspace are additional pane groups, still flattened into 2code terminal tabs. Zoomed splits stay in the layout snapshot (`zoomed`).

## Platform / capability matrix

| Capability | Linux x86_64 | Linux aarch64 | macOS | Windows x86_64 |
| --- | --- | --- | --- | --- |
| Release asset | **verified** (executed) | asset+checksum recorded | asset+checksum recorded | zip+checksum recorded |
| JSON API Unix socket | **verified** | documented | documented | n/a |
| JSON API named pipe | n/a | n/a | n/a | documented, **unverified** |
| `herdr server` + named session | **verified** | documented | documented | documented |
| `terminal session control/observe` | **verified** | documented | documented (Unix) | **unsupported** ([#396](https://github.com/AkaraChen/2code/issues/396)) |
| Worktree create/open/remove | **verified** | documented | documented | documented (`--trust-repository` for other-SID repos) |
| Client disconnect keeps server | **verified** | documented | documented | documented |
| Server restart restores layout, not processes | **verified** | documented | documented | documented |
| Agent detection live states | API present; empty-shell `unknown` verified | unverified | unverified | unverified |
| `live_handoff` | capability flag true; **not exercised** | — | — | — |

## Later-task capabilities

| Need | Status |
| --- | --- |
| Shell | Config `terminal.default_shell` (empty → `$SHELL` then `/bin/sh`). Probe set `/bin/sh` on the server process. Per-create shell via `--env` is accepted; not a first-class create field. |
| Working directory | `--cwd` on workspace/tab/worktree create **verified**. `terminal.new_cwd = follow` when omitted. |
| Environment | `--env KEY=VALUE` on create/split **verified** (accepted). Herdr injects `HERDR_SOCKET_PATH`, `HERDR_ENV`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`. |
| Startup command | **Not** a `workspace.create` / `tab.create` parameter. Use `pane.run` **once after create**, never on reattach. `layout.apply` can set argv on new panes (documented; not probed). |
| Agent state | `agent_status` on panes; `agent.list` / `pane.report_agent`. Idle shells report `unknown`. Live Claude/Codex detection **unverified** here. |
| Subscriptions | `events.subscribe` **verified**; bootstrap = subscribe first, then `session.snapshot`, then drain buffered events (Herdr docs; subscribe+event verified). |
| Scrollback search | `pane.read` snapshots **verified**; live search is a 2code UI concern on the xterm buffer plus `pane.read`. |

## Gaps (not silently “passing”)

Open separate issues before the named task depends on them:

1. **Windows live terminal streaming** — Herdr’s `terminal session` / direct attach is Linux/macOS only. Tracked in [#396](https://github.com/AkaraChen/2code/issues/396). Task 10 on Windows needs another design or remains experimental.
2. **No GPG/cosign** on release assets — Task 3 should keep verifying GitHub SHA-256; signing is extra.
3. **Alternate screen and DSR/DA** — unverified; Task 11 should add explicit fixtures.
4. **Live agent detection** — Task 13 needs a real agent CLI; this contract only saw `unknown` shells.
5. **`herdr server` is not a daemon** — Task 4 must detach; sidecar must not tie server lifetime to the GUI.
6. **Startup commands** — no create-time command field; one-shot `pane.run` is the verified workaround.

None of these block Task 2 (runtime boundary) or Task 5 (JSON socket client) on Linux/macOS.
