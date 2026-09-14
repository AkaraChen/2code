# Herdr integration contract

Pinned contract for migrating 2code onto [Herdr](https://herdr.dev). Later tasks must depend on this release and the behaviors marked **verified** below. Claims from Herdr docs that this probe did not execute are marked **documented** or **unverified**.

**Decision: proceed** with Herdr **v0.9.0** for Tasks 2–4, 6–9, and 11–12 on **Linux x86_64 (executed)**. macOS Unix sockets and terminal attach are **documented** by Herdr and have release assets, but this probe did **not** execute on macOS. Blocking gaps:

- Task 5 on Windows: named-pipe JSON **unverified** — [#399](https://github.com/AkaraChen/2code/issues/399)
- Task 10 on Windows: live terminal attach **unsupported** — [#396](https://github.com/AkaraChen/2code/issues/396)
- Task 13: live agent detection **unverified** — [#398](https://github.com/AkaraChen/2code/issues/398)
- Task 17: no create-time startup command — [#397](https://github.com/AkaraChen/2code/issues/397)
- Line-count growth vs the 200–400 estimate (tests/docs only) — [#400](https://github.com/AkaraChen/2code/issues/400)

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

Prerequisites: the pinned binary (checksum-verified), `git`, and `python3` with the `termios` and `tty` modules (used for DSR/DA).

Acceptance command — **require** the binary so a missing sidecar cannot skip into a green run:

```bash
cd src-tauri
HERDR_CONTRACT_REQUIRED=1 cargo test -p infra --test herdr_contract -- --nocapture --test-threads=1
```

Without `HERDR_CONTRACT_REQUIRED=1`, live tests skip if the binary is absent. `cargo test --workspace --exclude code` is the crate-level suite on machines without GTK/`gdk-3.0`.

The probe:

1. Puts git/home/config state under a **long** nested directory (80 `x` characters inside `TMPDIR`, which may itself be long). Default `--session` sockets at `$XDG_CONFIG_HOME/herdr/sessions/<33-char-name>/herdr.sock` would then exceed `sun_path`.
2. Binds the JSON API at a **short** `/tmp/2c<pid><n>.sock` via `HERDR_SOCKET_PATH` (not nested `sessions/<name>/herdr.sock`). The client socket is `/tmp/2c<pid><n>-client.sock`. Both must be shorter than `sockaddr_un.sun_path` (104 bytes, macOS bound). The probe asserts those lengths and that the override path does not contain the long XDG component.
3. Writes `onboarding = false` and a private `[worktrees].directory`.
4. Starts `herdr server` in the foreground with that socket override.
5. Stops with `herdr server stop` (2s), then `SIGKILL` if needed, and removes both socket files. Timed-out CLI children are `kill -9`'d and reaped (1s). Each `terminal session` client is a scoped helper: `Drop` kills and reaps it on assertion failure, not only on the success path. Frame waits are named by phase and dump child status, client stderr, and the server log tail on timeout.

Cleanup if a test is interrupted — pass the **same** `HERDR_SOCKET_PATH` and isolated `XDG_CONFIG_HOME`:

```bash
export XDG_CONFIG_HOME=/tmp/.tmpXXXX/xdg-config
export HOME=/tmp/.tmpXXXX/home
export HERDR_SOCKET_PATH=/tmp/2c<pid><n>.sock
export HERDR_DISABLE_SOUND=1

herdr server stop
kill -9 <pid>   # if the foreground server is still alive
rm -f "$HERDR_SOCKET_PATH" "${HERDR_SOCKET_PATH%.sock}-client.sock"
```

Do **not** run `herdr server stop` without `HERDR_SOCKET_PATH`; that targets the user’s default session.

`herdr server` stays in the foreground. Status reports `detached_server_daemon: false` for that launch. Task 4 must spawn a detached process so GUI exit does not take the server with it. Closing CLI clients does **not** stop this server. The probe does not use `--session` names for sockets; it uses `HERDR_SOCKET_PATH` so paths stay short.

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
| `pane.list` / `get` / `split` / `read` / `scroll` | see terminal section |
| `pane.send_text` / `send_keys` / `send_input` | JSON input. CLI `herdr pane run` is **not** a schema method; it maps to `pane.send_input` with the command plus a trailing newline (verified: creates a disposable file). `pane.send_text` is text without Enter; `pane.send_keys` sends named keys. |
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

**Verified** frame semantics (live probe + `tests/fixtures/herdr/frames/`):

- Bytes are base64-encoded ANSI. UTF-8 (`αβγ`) and SGR (`CSI 31 m` / `RED_COLOR`) appear in `terminal.frame` payloads and in `pane.read --ansi`.
- `full: true` is a complete redraw. The payload starts with synchronized output (`CSI ?2026h`), hide-cursor, OSC 8 reset, `CSI 2J`, `CSI 1;1H`, then the screen. An xterm.js consumer must treat this as a replacement surface, not extra scrollback. Fixture: `frames/full-redraw.json`.
- `full: false` is incremental output: cursor addressing plus new text, **no** `CSI 2J`. Apply on top of the current surface. Fixture: `frames/incremental.json`.
- `seq` increases on a given observe stream (**verified**: first full frame seq `<` later incremental seq).
- The first frame after attach is `full: true` at the requested cols/rows and includes the current screen.
- Resize (`terminal.resize`) is followed by frames at the new `width`/`height`.
- Scroll: with a controller and observer **already attached**, `printf` unique `SCR01`–`SCR40` lines, then `terminal.scroll` up. Before/after **visible** snapshots are compared by those unique lines (not the last nonempty line, which can be a prompt). Scroll-up hides later markers (`SCR40`) and reveals earlier ones. Existing observe/control clients then receive a later incremental `terminal.frame` (higher `seq`) that rewrites the new digits in place and includes the new bottom `SCRnn`, without `SCR40`. A **fresh** observe, kept as a separate check, starts with `full: true` containing complete `SCRnn` strings of that scrolled surface. JSON `pane.scroll` is a second, verified way to move the same unique viewport.
- Alternate screen: with an observer attached, `CSI ?1049h` + `CSI 2J` + `CSI H` shows `ALT_ONLY` in `pane.read --source visible` **and** in a `terminal.frame`. `CSI ?1049l` returns to the main screen (`LEFT_ALT`).
- DSR/DA: with an observer attached, a pane process that writes `CSI 6n` / `CSI c` receives replies **as PTY input**, not as `terminal.frame` bytes. Captured replies: `CSI <row>;<col>R` and `CSI ?62;22c`. 2code must **not** also answer those queries from observe/control frames. Fixture: `frames/dsr-da.json`. Requires `python3`.
- Control stdin commands (one JSON object per line):

```json
{"type":"terminal.input","text":"echo hi\n"}
{"type":"terminal.input","bytes":"<base64>"}
{"type":"terminal.resize","cols":90,"rows":28}
{"type":"terminal.scroll","direction":"up","lines":2,"source":"wheel"}
{"type":"terminal.release"}
```

`terminal.input` accepts `text` **or** `bytes`, not both. `cols`/`rows` and scroll `lines` must be `> 0`. Optional resize fields: `cell_width_px`, `cell_height_px`. Scroll `source` is `wheel` (default) or `page_key`.

JSON `pane.scroll` with `offset_from_bottom` is a second, **verified** way to set scroll position (checked together with visible contents, not only the offset field). `pane.get` exposes `scroll: {offset_from_bottom, max_offset_from_bottom, viewport_rows}`. `offset_from_bottom == 0` is at-bottom.

`pane.read` prints UTF-8 text (not JSON). `--ansi` keeps SGR. Sources: `visible`, `recent`, `recent-unwrapped`, `detection`. Default recent window is 80 rows. This is a snapshot helper, not the live transport.

CLI `herdr pane run <pane> <command>` submits the command plus Enter (empty stdout on success). It is **not** in the bundled JSON schema. The pinned wire operation is `pane.send_input` with `text` ending in a newline (verified). CLI `herdr pane send-text` / `send-keys` map to `pane.send_text` / `pane.send_keys` and also print nothing on success.

Default scrollback is 10,000,000 bytes (`advanced.scrollback_limit_bytes`). Pane screen history across server restart is off (`experimental.pane_history = false`). Headless size defaults to 120×40; this probe used 80×24.

`tput smcup` is **not** required; the probe used raw CSI `?1049h` / `?1049l`.

## Controller exclusivity

Verified:

- One writable controller at a time.
- A second `terminal session control` without `--takeover` exits 0 and prints `{"type":"terminal.closed","reason":"terminal attach failed: terminal term_… already has an attached client; retry with --takeover"}`.
- `--takeover` makes the previous controller receive `{"type":"terminal.closed","reason":"terminal attach taken over"}`.
- After `terminal.release`, the controller process **exits**. Killing the observer then leaves **no** attach clients. `pane_id` / `terminal_id` / shell pid stay the same; the live process keeps running (`DETACH_LIVE_TOKEN` still on screen). A new `terminal session control` **without** `--takeover` attaches; its first frame is `full: true` and includes that live screen. Input is a real newline (`touch <repo>/reconnected.ran`); execution is the file existing, not matching echoed command text.
- **Verified coexistence:** an `observe` client stays connected while a `control` client owns input/resize. The observer receives `full: false` frames for later output and does not take ownership. A second `control` without `--takeover` still fails with the conflict close above.

2code must not silently take control. Task 18 should surface the conflict string and require an explicit takeover.

## Workspace and worktree lifecycle

A workspace create also creates tab `wN:t1` and root pane `wN:p1` with a `terminal_id`. An empty server has no default workspace.

Worktree commands need a git checkout. `--cwd` / `--path` on the socket API must be absolute (the CLI expands relatives). `--trust-repository` trusts that path for one request.

| Operation | Verified result |
| --- | --- |
| `workspace.create --cwd` on a dirty primary checkout | opens the existing repo; uncommitted files are preserved (not recreated) |
| `worktree.open --path` of that primary | `already_open: true` with the **same** `workspace_id` |
| `worktree.create --branch wt/contract` | creates a git worktree under `[worktrees].directory` (`~/.herdr/worktrees` by default), opens workspace `wN` with `worktree.is_linked_worktree: true` |
| `worktree.open --path <external dirty worktree>` | `already_open: false` the first time; preserves uncommitted files; does not recreate the checkout |
| `worktree.open` again | `already_open: true` with the **same** `workspace_id` / `pane_id` / `terminal_id` |
| `worktree.create` for a branch already used | `worktree_create_failed` (git fatal: already used by worktree at …) |
| `worktree.remove` on a dirty checkout | `dirty_worktree_requires_force`; checkout kept; pane/`terminal_id`/shell pid unchanged |
| `worktree.remove --force` | deletes the checkout; drops the workspace and pane records (`pane_not_found`); terminates the pane process; **does not delete the git branch** |
| `worktree.remove` on a clean linked worktree | same runtime teardown as `--force`; deletes the checkout; keeps the branch |
| `workspace.close` on a primary with linked worktrees open | `workspace_group_close_required` |
| `workspace.close --group` | closes Herdr state for the group; **does not** delete git worktrees |
| `pane.split` | emits `pane_created` and `layout_updated` on `events.subscribe`; creates `wN:p2` |
| `pane.close` on a split pane | emits `pane_closed`; workspace remains; remaining pane ids unchanged |
| `pane.close` on the last pane | workspace is removed; later `pane.get` is `pane_not_found` |

`workspace.close` kills the pane PTY (SIGHUP). It is not “forget this project”.

## Identity stability

| ID | Across enumerate / rename / detach | Across server restart |
| --- | --- | --- |
| `workspace_id` (`wN`) | **verified** stable; not the label | **verified** restored from `session.json` |
| `tab_id` (`wN:tM`) | **verified** stable | **verified** restored (root tab and extra tab) |
| `pane_id` (`wN:pK`) | **verified** stable | **verified** restored (root, split, and extra-tab panes) |
| `terminal_id` (`term_<hex>`) | **verified** stable while the PTY lives | **verified** **new** (new process) for every restored pane |

Do not key 2code records on display names. After restart, reattach by `pane_id`; expect a new `terminal_id` and an empty screen unless pane history or native agent restore applies. Restored panes are new shells in the saved cwd — not the old processes.

Public IDs increment for new objects in a session (`w1` closed then created becomes `w2`). Internal `session.json` uses numeric pane ids, not public ids.

## External split mapping

**Verified:** `pane.split --direction right` creates `wN:p2` with its own `terminal_id` in the same tab and emits `pane_created` plus `layout_updated`. `pane.layout` / `session.snapshot.layouts` include pane rects and a `splits` array (`direction`, `ratio`, `rect`). `terminal session observe` can attach to that split pane. Closing the split pane emits `pane_closed`, leaves the original pane and workspace; closing the last remaining pane removes the workspace (`pane_not_found` afterward). Split pane ids survive server restart with new `terminal_id`s.

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
| JSON API Unix socket | **verified** (executed) | documented | documented, **not executed** | n/a |
| JSON API named pipe | n/a | n/a | n/a | documented, **unverified** ([#399](https://github.com/AkaraChen/2code/issues/399)) |
| `herdr server` + `HERDR_SOCKET_PATH` | **verified** | documented | documented, **not executed** | documented |
| `terminal session control/observe` | **verified** | documented | documented (Unix) | **unsupported** ([#396](https://github.com/AkaraChen/2code/issues/396)) |
| Full vs incremental frames | **verified** | — | — | — |
| Unicode / SGR / alt-screen / DSR+DA | **verified** | — | — | — |
| Worktree create/open/remove + dirty primary | **verified** | documented | documented | documented (`--trust-repository` for other-SID repos) |
| Client disconnect keeps server | **verified** | documented | documented | documented |
| Server restart restores workspace/tab/pane ids, not processes | **verified** | documented | documented | documented |
| Agent detection live states | empty-shell `unknown` **verified**; live CLIs **unverified** ([#398](https://github.com/AkaraChen/2code/issues/398)) | — | — | — |
| `live_handoff` | capability flag true; **not exercised** (not required for local Tasks 2–12) | — | — | — |

## Later-task capabilities

| Need | Status |
| --- | --- |
| Shell | **Verified** to launch `/bin/sh` when the server process has `SHELL=/bin/sh` and `terminal.default_shell = "/bin/sh"`. Per-create shell is not a first-class field. |
| Working directory | `--cwd` on workspace/tab/worktree create **verified**. `terminal.new_cwd = follow` when omitted (**documented**). |
| Environment | `--env CONTRACT_ENV=from_probe` on `workspace.create` **verified** (`printenv` returns `from_probe`). Herdr-injected `HERDR_*` variables are **documented**. |
| Startup command | **Not** a create parameter. Workaround after create: JSON `pane.send_input` with `text` ending in a newline, or CLI `herdr pane run` (not a schema method). Blocking: [#397](https://github.com/AkaraChen/2code/issues/397). `layout.apply` argv is **documented**, not probed. |
| Agent state | Idle shells **verified** `unknown`. Live agent CLIs **unverified**. Blocking for Task 13: [#398](https://github.com/AkaraChen/2code/issues/398). |
| Subscriptions | `events.subscribe` ack + live `tab.created` **verified**. Full bootstrap race (subscribe → snapshot → drain) is **documented** by Herdr, not separately race-tested. |
| Scrollback search | `pane.read` snapshots **verified**; live search is a 2code UI concern. |

## Gaps (not silently “passing”)

| Gap | Blocks | Issue |
| --- | --- | --- |
| Windows live terminal attach / `terminal session` | Task 10 on Windows | [#396](https://github.com/AkaraChen/2code/issues/396) |
| Windows named-pipe JSON transport unverified | Task 5 on Windows | [#399](https://github.com/AkaraChen/2code/issues/399) |
| No create-time startup command / argv on `workspace.create` / `tab.create` | Task 17 | [#397](https://github.com/AkaraChen/2code/issues/397) |
| Live agent detection (`working`/`blocked`/`done`) unverified | Task 13 | [#398](https://github.com/AkaraChen/2code/issues/398) |

Not blocking (recorded, no issue):

- No detached GPG/cosign on release assets — Task 3 keeps using GitHub SHA-256.
- `herdr server` is foreground (`detached_server_daemon: false`) — **verified**. Task 4 must detach the process.
- `live_handoff` advertised but not exercised — not required for local Tasks 2–12.

None of the open issues block Task 2 (runtime boundary) or Task 5 on **Linux** (Unix sockets **verified**). macOS Unix sockets remain **documented, not executed**.

## Scope vs the 200–400 line estimate

Issue #395 estimated 200–400 lines and required material growth to be tracked separately: [#400](https://github.com/AkaraChen/2code/issues/400). This branch is larger because the issue also required an executable probe against a real sidecar: isolation, checksums, captured frames, worktree fixtures, and lifecycle evidence. All of that is tests and docs; production, frontend, and the default runtime are unchanged. Splitting the extra evidence into a follow-up implementation issue would leave Tasks 5/10–12 without the contract #395 asked them to depend on, so it stays in Task 1.
