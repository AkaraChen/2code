# Herdr integration contract

Pinned contract for 2code as a **Herdr client** ([parent plan #436](https://github.com/AkaraChen/2code/issues/436)). Later **#436** tasks must depend on **this** rewrite, not on [#394](https://github.com/AkaraChen/2code/issues/394)'s Local-default / mapping-table / `profiles.worktree_path` cache. Claims marked **verified** were executed against pinned **v0.9.0**. Claims from Herdr docs that this probe did not execute are **documented** or **unverified**.

**Decision: proceed** with Herdr **v0.9.0** on **Linux x86_64 (executed)** for **#436 Tasks 2–10**, gated only on capabilities this probe marks verified. Frame semantics, controller exclusivity, DSR/DA, and sidecar checksums stay as previously recorded; this rewrite adds the client-mode join key.

Herdr is the **production default** runtime ([#436 Task 2](https://github.com/AkaraChen/2code/issues/439)). [`RuntimeBackend::default`](../src-tauri/crates/model/src/runtime.rs), [`RuntimeSelector::default`](../src-tauri/crates/service/src/runtime.rs), and [`RuntimeRouter::new`](../src-tauri/crates/service/src/runtime.rs) select Herdr. GUI startup resolves the pinned **v0.9.0** sidecar, calls `ensure_herdr_listener` on the dedicated `2code` namespace (never the user default session), and injects JSON terminal + worktree + CLI attach clients. sqlite `profiles` and mapping tables are **DROPped** ([#436 Task 8](https://github.com/AkaraChen/2code/issues/451)); leftover extra import is gone. GUI Herdr connect starts [`HerdrRuntimeSync`](../src-tauri/crates/service/src/runtime_sync.rs) ([#436 Task 6](https://github.com/AkaraChen/2code/issues/448)); `lib.rs` still does not name it. Local remains only as an **explicit** fallback (`TWOCODE_RUNTIME=local` or `--twocode-runtime=local`) until **#436 Task 9** deletes it. That flag skips `ensure_herdr_listener` and `HerdrRuntimeSync`, lists only the synthetic `projects.folder` default, and creates Local sessions. Local extras create/delete fail closed and do not `git worktree add` / `git worktree remove`. There is no Settings toggle and no silent failover: if Herdr is selected and the sidecar/namespace is absent or incompatible, ops fail closed (`HerdrServerAbsent` / `HerdrServerIncompatible` or equivalent) without flipping the selector to Local. Local must never own a worktree or workspace Herdr already owns. GUI exit still must not `herdr server stop`.

The sidebar / profile-switcher list is derived from live Herdr ([#436 Task 3](https://github.com/AkaraChen/2code/issues/441)). [`list_projects`](../src-tauri/src/handler/project.rs) / [`list_with_runtime`](../src-tauri/crates/service/src/project.rs) still load sqlite **projects** (and groups). When Herdr is selected, each project's `profiles` array is **replaced** from JSON `worktree.list` (git, `cwd` = canonical `projects.folder`, membership = non-empty `open_workspace_id`) or `session.snapshot` pane `cwd` / `foreground_cwd` (non-git `not_git_worktree`). `workspace.list` is not a path join. Profile `id` is the Herdr `workspace_id` (`wN`); route ids are `wN`. sqlite `profiles` is not a table. Empty Herdr, disk git checkouts without `open_workspace_id`, or an absent/incompatible sidecar yield `profiles: []` for that project until **#436 Task 10**. `TWOCODE_RUNTIME=local` lists only the synthetic `projects.folder` default (`id=default-{project_id}`). Notes live on 2code `checkout_notes` keyed by `project_id` + canonical checkout path and overlay the live catalog; they are not stored in Herdr. Profile list does not start `HerdrRuntimeSync` / `events.subscribe` (GUI connect does, **#436 Task 6**).

Create and delete go through Herdr when that backend is selected ([#436 Task 4](https://github.com/AkaraChen/2code/issues/443)). [`create_profile`](../src-tauri/src/handler/profile.rs) / [`create_with_runtime`](../src-tauri/crates/service/src/profile.rs) does **not** INSERT sqlite `profiles` (the table is gone). Git New Profile is JSON `worktree.create` (parent `workspace_id` from the live primary `worktree.list` row). Non-git New Profile is JSON `workspace.create` with absolute `--cwd` (the project folder). The returned `Profile.id` is the Herdr `workspace_id`. [`delete_profile`](../src-tauri/src/handler/profile.rs) / [`delete_with_runtime`](../src-tauri/crates/service/src/profile.rs) uses `worktree.remove` for linked git, then 2code `git branch -D` on the repo resolved from the listed checkout / `projects.folder` so New Profile can reuse the name. Herdr does not delete the git branch. Non-git extra profiles are `workspace.close`. The primary / project-folder checkout is still refused. Herdr-down fails closed: no `git worktree add` / `git worktree remove`. `TWOCODE_RUNTIME=local` extras create/delete fail closed and do not `git worktree add` / `git worktree remove`. Uncertain JSON mutations are never auto-replayed.

Profile identity is live Herdr `workspace_id` ([#436 Task 5](https://github.com/AkaraChen/2code/issues/445), drop in [#436 Task 8](https://github.com/AkaraChen/2code/issues/451)). Herdr list/create/close join live cwd/worktree group; leftover UUID joins (`sqlite_profile_id_for_checkout`, `live_workspace_for_sqlite_profile`) and `import_leftover_sqlite_profiles` are gone. Mapping tables are DROPped. Local list synthesizes the folder default and does not call Herdr. Launch/adopt of disk checkouts stays **#436 Task 10**.

Herdr list/create/close/attach/agent use the live snapshot or `HerdrRuntimeSync` `pane_id` ([#436 Task 6](https://github.com/AkaraChen/2code/issues/448)). They do not INSERT / UPDATE / DELETE `pty_sessions`. [`list_project_sessions`](../src-tauri/src/handler/pty.rs) returns every live pane in that project's open workspaces; session id is `pane_id` (`wN:pK`); `profile_id` is `workspace_id`. Leftover sqlite `pty_sessions` are not merged. New Tab is `tab.create` and returns `pane_id`. Splits stay flattened as extra tabs. Herdr-down New Tab fail-closes instead of spawning a Local PTY. `session_runtime_mappings` is DROPped ([#436 Task 8](https://github.com/AkaraChen/2code/issues/451)); live `pane_id` shape still routes to Herdr. Launch/adopt stays **#436 Task 10**. Local PTY stays until **#436 Task 9**; `pty_sessions` keeps `project_id` and no FK to `profiles`.

Git, the file tree, and watchers use live Herdr cwd ([#436 Task 7](https://github.com/AkaraChen/2code/issues/449)). [`reconcile_profile_checkout`](../src-tauri/crates/service/src/project.rs) is the checkout seam: Herdr-selected `workspace_id` → `worktree.list` path / snapshot pane `cwd`. Local-flag ids are `default-{project_id}` → `projects.folder`. Git service helpers (`get_diff`, `get_log`, `commit_changes`, `push`, …) and [`delete_check`](../src-tauri/crates/service/src/profile.rs) go through that seam. There is no sqlite `profiles.worktree_path` and no path-cache column that can disagree with Herdr and still win. File-tree search / git status / reveal / open-in-app use `*_for_profile` (same seam). Sidebar `rootPath` / `worktreePath` and topbar editor launch keep the live catalog DTO. Watcher roots come from `list_with_runtime` checkouts; empty Herdr still falls back to `projects.folder` only until **#436 Task 10**. `TWOCODE_RUNTIME=local` watches the folder default only. Herdr-selected + absent/incompatible sidecar or unknown `workspace_id` fail closed (`NotFound`). No second `events.subscribe`; `lib.rs` still does not name `HerdrRuntimeSync`. Git / file-tree / notes / tab clicks and labels stay.

GUI clicks and labels stay **New Profile** / **Delete Profile**. Named exceptions Herdr cannot back with the old meaning: route ids are `workspace_id` (`wN`); tab ids are `pane_id` (`wN:pK`); splits stay flattened as extra tabs; non-git New Profile opens a folder workspace instead of failing git-only; empty Herdr-only list until **#436 Task 10**; Local-flag nested sqlite extras are gone. Notes for Herdr-only workspaces save/load via live cwd on `checkout_notes` (Task 5 empty-notes exception is closed).

macOS Unix sockets and `terminal session` attach are **documented** by Herdr and have release assets, but this probe did **not** execute on the primary shipping OS — [#401](https://github.com/AkaraChen/2code/issues/401) (**#394 leftover, not this plan**).

**Blocked (#436 on Linux):** none. v0.9.0 can join a 2code project folder to live Herdr state by path (see join key). Do not invent a sqlite cache to paper over a hole that is not there.

**#394 leftover (not this plan):**

- #394 Task 5 on Windows: named-pipe JSON **unverified** — [#399](https://github.com/AkaraChen/2code/issues/399)
- #394 Task 10 on Windows: live terminal attach **unsupported** — [#396](https://github.com/AkaraChen/2code/issues/396)
- #394 Task 5/10 on macOS: Unix sockets and `terminal session` attach **not executed** — [#401](https://github.com/AkaraChen/2code/issues/401)
- #394 Task 13: live agent detection **unverified** — [#398](https://github.com/AkaraChen/2code/issues/398)
- #394 Task 17: no create-time startup command — [#397](https://github.com/AkaraChen/2code/issues/397) (this stack already sends init/startup after create via `pane.send_input`; that is not #436 Task 2–10)
- #394 line-count growth vs the original 200–400 estimate — [#400](https://github.com/AkaraChen/2code/issues/400)

Machine that executed this probe: Linux x86_64. Reproduction does not use `latest`. Keep the **v0.9.0** pin.

## Client-mode architecture

#394 treated Local as the production default, sqlite `profiles` as catalog rows, and `profile_runtime_mappings` / `session_runtime_mappings` / `profiles.worktree_path` as association caches. **This plan inverts that.**

| Thing | Owner |
| --- | --- |
| Project catalog and groups | 2code sqlite `projects`, `project_groups` |
| Notes | 2code feature on `checkout_notes` (`project_id` + canonical checkout path). Not stored in Herdr. |
| File tree, Git UI, watchers | 2code, checkout paths from **live** Herdr (**#436 Task 7**, done on `task-7-herdr-live-cwd`) |
| Profile list / create / delete / restore | Herdr workspaces + worktrees |
| Terminals, panes, scrollback, agents | Herdr |
| Default checkout for a project | The open Herdr workspace whose checkout path is the project folder |

A 2code **project** stays a sqlite row (`projects.id`, canonical `projects.folder`). A **profile is a Herdr workspace**. The profile id is the Herdr `workspace_id` (stable `wN` in a session; restored across server restart — see identity table). It is **not** a UUID 2code mints into `profiles.id`.

Listing, creating, deleting, and restoring profiles go through Herdr. sqlite `profiles` is DROPped ([#436 Task 8](https://github.com/AkaraChen/2code/issues/451)) and is not source of truth.

Production default is Herdr. Local is only an explicit env/flag fallback. sqlite `profiles` is DROPped. Local extras create/delete fail closed.

## Project ↔ Herdr binding (join key)

**Join key:** canonical absolute `projects.folder` ↔ live Herdr checkout path / workspace cwd.

No parallel sqlite `worktree_path` column, and no `profile_runtime_mappings` / `session_runtime_mappings` row, may disagree with live Herdr and still win.

Verified on v0.9.0 Linux (JSON, disposable repo, `HERDR_CONTRACT_REQUIRED=1`):

| Source | What it gives | Use for profiles |
| --- | --- | --- |
| `worktree.list` with absolute `cwd` = project folder (`trust_repository: true`) | Repo-scoped git checkouts: `path`, `branch`, `is_linked_worktree`, `open_workspace_id` when open. `source.repo_key` is the absolute `.git` path. | **Git profile list:** entries whose `open_workspace_id` is a non-empty string. Missing or null `open_workspace_id` is **not** a profile. |
| `workspace.list` | Global session catalog of `workspace_id` / label / focus. **v0.9.0 omits `worktree` / `checkout_path`.** | Identity and labels for ids already joined by path. **Not** a path join by itself. |
| `session.snapshot` | `workspaces`, `tabs`, `panes` (pane `cwd` / `foreground_cwd`, `workspace_id`). | **Any workspace**, including non-git: join `pane.cwd` to `projects.folder`. Session store for **#436 Task 6** (not sqlite `pty_sessions`). |

`repo_key` groups git worktrees of one repository. It is **not** a 2code project id. 2code project identity stays `projects.id` bound by folder path.

**Default checkout:** the open workspace whose `worktree.list` `path` (and snapshot pane `cwd`) is the project folder, with `is_linked_worktree: false`.

**Linked git worktrees:** additional profiles in the same repo group (`worktree.create` / `is_linked_worktree: true`). Their checkout path is not the project folder.

**Non-git project folders:** `workspace.create --cwd` (not `worktree.*`). JSON `worktree.list` on that cwd fails with `not_git_worktree`. Join via snapshot pane `cwd`. Fixture: `tests/fixtures/herdr/lists/join-key.json`.

**Empty Herdr** (no open workspaces for that path) → **empty profile list** for that project. `workspace.list` / snapshot `workspaces` are empty. `worktree.list` may still show disk git checkouts **without** `open_workspace_id`; those are not profiles. Do **not** fall back to leftover sqlite `profiles` rows. **#436 Task 10** later starts or adopts a workspace so the GUI is not stuck empty; this task only documents the empty case.

**Disk git worktrees** that exist but are **not** open in Herdr (`open_workspace_id` absent) are **not** profiles until `worktree.open`. Leftover sqlite extra import is gone ([#436 Task 8](https://github.com/AkaraChen/2code/issues/451)); there are no sqlite extras to open at GUI Herdr connect. Default / project-folder checkouts and disk worktrees stay unopened until **#436 Task 10**. Listing them as sqlite-style profiles is a contract failure.

**Re-open / `already_open`:** `worktree.open` of an already-open primary keeps the same `workspace_id`. `worktree.list` / snapshot still key that profile as that id (**verified** here; create/open identity was already verified in the lifecycle probe).

**Repo isolation:** a second repo's workspaces do **not** appear in the first repo's `worktree.list`. `source.repo_key` differs. `workspace.list` is session-global, so **#436 Task 3** filters by the join key, not by listing every Herdr workspace.

Sanitized payloads: `src-tauri/crates/infra/tests/fixtures/herdr/lists/join-key.json`. Live test: `client_mode_path_join_lists_open_workspaces_as_profiles`.

## Sqlite tables that stay vs die

Authority after **#436 Task 8**. Dying catalog/mapping tables are DROPped on this branch.

| Table / column | Role today (#394 stack) | This plan | Dies as authority |
| --- | --- | --- | --- |
| `projects` | Project catalog, `folder` | **Stay.** Join key is canonical `folder`. | — |
| `project_groups` | Sidebar groups | **Stay.** | — |
| `profiles` | Profile catalog (UUID, `worktree_path`, `branch_name`, `is_default`, `notes`) | **Dropped.** Profile id is Herdr `workspace_id`. | **#436 Task 8 (done)** |
| `checkout_notes` | — | **Stay.** Notes keyed by `project_id` + canonical checkout path. | — |
| `profile_runtime_mappings` | sqlite profile UUID ↔ Herdr `workspace_id` | **Dropped.** Join is path ↔ live Herdr. | **#436 Task 8 (done)**. Authority ended in **#436 Task 5**. |
| `session_runtime_mappings` | sqlite `pty_sessions` ↔ Herdr `pane_id` | **Dropped.** Live `pane_id` wins. | **#436 Task 8 (done)**. Authority ended in **#436 Task 6**. |
| `pty_sessions` | Local PTY session metadata + implicit Herdr session store via mappings | **Not** the Herdr session store. Tabs/panes restore from `session.snapshot` / `pane_id`. **#436 Task 6** stopped Herdr INSERT/UPDATE/DELETE. | As Herdr session store: **#436 Task 6**. Local rows go away with **#436 Task 9**. |
| `herdr_namespaces` | Scopes the mapping tables (`2code`) | **Dropped** with the mapping tables. | **#436 Task 8 (done)** |

One-shot import of leftover sqlite extras into Herdr was **#436 Task 5**. sqlite `profiles` / mapping tables are DROPped in **#436 Task 8**. Disk checkouts without an open workspace stay unopened until **#436 Task 10**.

## #436 proceed / block (Linux x86_64)

| #436 task | Status | Gate |
| --- | --- | --- |
| 2. Make Herdr the default runtime | **done** (`task-2-herdr-default-runtime`) | No new Herdr capability. Local is explicit fallback (`TWOCODE_RUNTIME=local`) until **#436 Task 9**. Fail closed if sidecar/namespace is absent. |
| 3. Derive the profile list from Herdr | **done** (`task-3-herdr-profile-list`) | JSON `worktree.list` (git, repo-scoped) + `session.snapshot` pane `cwd` (including non-git). Profile id is `workspace_id`. Empty Herdr → empty list. Route ids are `wN`. `workspace.list` is not a path join. |
| 4. Create/delete profile through Herdr only | **done** (`task-4-herdr-create-delete`) | `worktree.create` / `worktree.remove` (git linked); `workspace.create` / `workspace.close` (non-git extras). Do not INSERT/DELETE `profiles`. Returned id is `workspace_id`. Primary checkout refused. Herdr-down fails closed. Local extras create/delete fail closed after **#436 Task 8**. |
| 5. Stop persisting profile mappings | **done** (`task-5-stop-profile-mappings`) | Import leftover extras via `worktree.open` without mapping / `worktree_path` writes. Notes overlay by leftover checkout path. Identity is live `workspace_id` or leftover sqlite path. Default adopt remains **#436 Task 10**. Tables not DROPped (**#436 Task 8**). |
| 6. Sessions from Herdr snapshot, not `pty_sessions` | **done** (`task-6-herdr-session-store`) | Live `session.snapshot` / `HerdrRuntimeSync` `pane_id`. No sqlite session writes. List every live pane; `profile_id` is `workspace_id`. New Tab returns `pane_id` (fixes [#447](https://github.com/AkaraChen/2code/issues/447)). GUI connect starts sync; `TWOCODE_RUNTIME=local` does not; `lib.rs` does not name `HerdrRuntimeSync`. Tables not DROPped. |
| 7. Git, file tree, watchers at live Herdr cwd | **done** (`task-7-herdr-live-cwd`) | `reconcile_profile_checkout` / `list_with_runtime`. sqlite `profiles.worktree_path` cannot win. Empty Herdr watches `projects.folder` until **#436 Task 10**. |
| 8. Drop sqlite `profiles` | **done** (`task-8-drop-profiles`) | Notes moved to `checkout_notes`. Mapping tables DROPped. Local extras fail closed. |
| 9. Delete the Local PTY runtime | **proceed** | After Herdr-only acceptance. Until then Local must not own a Herdr worktree. |
| 10. Launch/adopt existing checkouts | **proceed** | `workspace.create --cwd`, `worktree.open` / `already_open` **verified**. Disk worktrees without `open_workspace_id` stay unopened until this task. |

Do not implement or close #394 issues [#395](https://github.com/AkaraChen/2code/issues/395)–[#434](https://github.com/AkaraChen/2code/issues/434) from this branch.

## #394 task numbers (leftover vs this plan)

Bare “Task N” in older notes means **#394**, not #436. This table remaps every #394 task so later work does not follow Local-default / mapping-table / path-cache rules.

| #394 | Title | This plan |
| --- | --- | --- |
| 1 | Verify the Herdr integration contract | **Superseded** by **#436 Task 1** / [#437](https://github.com/AkaraChen/2code/issues/437) (this rewrite). Pin/frames/exclusivity evidence is reused. |
| 2 | Introduce a narrow runtime boundary | **#394 leftover (shipped).** **#436 Task 2** switches the default to Herdr; it does not reintroduce the boundary. |
| 3 | Bundle the pinned Herdr sidecar | **#394 leftover (shipped).** Keep the **v0.9.0** pin. |
| 4 | Implement server discovery and startup | **#394 leftover (shipped).** Detached sidecar already exists; the contract probe still uses a foreground `herdr server`. |
| 5 | Implement the socket request client | **#394 leftover.** Unix JSON **verified**. Not **#436 Task 5** (stop mapping writes). Windows named pipes: [#399](https://github.com/AkaraChen/2code/issues/399). |
| 6 | Synchronize runtime snapshots and events | **#394 leftover.** Feeds **#436 Tasks 3 and 6**. |
| 7 | Persist project-to-runtime associations | **Inverted.** **#436 Task 5** stops treating mapping tables / `profiles.worktree_path` as authority. |
| 8 | Adopt existing profiles and worktrees | **#394 leftover** (sqlite-seeded adopt). **#436 Task 10** starts/adopts from the project folder with no sqlite profile seed. |
| 9 | Implement Herdr terminal lifecycle commands | **#394 leftover.** |
| 10 | Bridge live terminal frames into Tauri | **#394 leftover.** Linux frames **verified**. Not **#436 Task 10** (launch/adopt). Windows attach: [#396](https://github.com/AkaraChen/2code/issues/396). |
| 11 | Connect xterm.js to the Herdr transport | **#394 leftover, not this plan.** |
| 12 | Restore terminals by reattachment | **#394 leftover.** Related to **#436 Task 6** (snapshot / `pane_id`, not `pty_sessions`). |
| 13 | Drive agent indicators from Herdr | **#394 leftover, not this plan.** Live CLIs **unverified**: [#398](https://github.com/AkaraChen/2code/issues/398). |
| 14 | Create profiles through Herdr worktree management | Related to **#436 Task 4**. Do not INSERT `profiles`. |
| 15 | Delegate profile and project runtime cleanup | Related to **#436 Task 4**. Do not DELETE `profiles` as the delete authority. |
| 16 | Reconcile workspace paths for Git and the editor | Related to **#436 Task 7**. Paths come from live Herdr, not sqlite `worktree_path`. |
| 17 | Preserve shell and template behavior | **#394 leftover.** No create-time startup command: [#397](https://github.com/AkaraChen/2code/issues/397). This stack already sends init/startup after create. |
| 18 | Expose runtime health and recovery | **#394 leftover, not this plan.** Controller takeover strings stay recorded above. |
| 19 | Implement legacy-session migration and rollback | **#394 leftover.** One-shot leftover extra import is **#436 Task 5**; then sqlite profiles are ignored. |
| 20 | Add migration acceptance coverage | **#394 leftover, not this plan.** |
| 21 | Make Herdr the default runtime | **#436 Task 2 (done).** `RuntimeRouter::new` selects Herdr. Local is `TWOCODE_RUNTIME=local` only. |
| 22 | Remove the local agent detector | **#394 leftover, not this plan.** |
| 23 | Remove the legacy PTY runtime | **#436 Task 9.** Not this branch. |

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

Packaged and `tauri dev` / `tauri build` acquisition uses the same pin via `bun ./scripts/herdr-sidecar.mjs` (also run from `scripts/tauri-before.mjs`). That copies a checksum-verified file to gitignored `src-tauri/binaries/herdr-<rustc-triple>` for Tauri `bundle.externalBin` (`binaries/herdr`). `infra::herdr` resolves that layout (or a packaged sibling named `herdr`) and runs `herdr --version` only. It does not start `herdr server`. Apache-2.0 text for the sidecar is in `src-tauri/licenses/herdr-0.9.0/`. Windows ARM64 is unsupported.

## Isolated reproduction

Prerequisites: the pinned binary (checksum-verified), `git`, and `python3` with the `termios` and `tty` modules (used for DSR/DA).

Acceptance command — **require** the binary so a missing sidecar cannot skip into a green run:

```bash
cd src-tauri
HERDR_CONTRACT_REQUIRED=1 cargo test -p infra --test herdr_contract -- --nocapture --test-threads=1
```

Offline join-key fixtures (no Herdr binary):

```bash
cd src-tauri
cargo test -p infra --test herdr_contract \
  join_key_fixtures_record_path_to_workspace_binding -- --nocapture
```

Client-mode join probe only (live JSON `worktree.list` / `workspace.list` / `session.snapshot`):

```bash
cd src-tauri
HERDR_CONTRACT_REQUIRED=1 cargo test -p infra --test herdr_contract \
  client_mode_path_join_lists_open_workspaces_as_profiles \
  -- --nocapture --test-threads=1
```

Optional: `HERDR_CONTRACT_DUMP=1` prints **live** (unsanitized temp-path) JSON for empty / primary / linked / second-repo / non-git stages. Committed excerpts in `tests/fixtures/herdr/lists/join-key.json` replace those paths with `/tmp/contract-*`. The dump still uses the fixture socket, never the user default session.

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
# tempfile harness dirs are under TMPDIR; remove the leftover /tmp/.tmpXXXX if Drop did not
```

Find leftover **fixture** sockets (names are `/tmp/2c<pid><seq>.sock`, not `~/.config/herdr`):

```bash
ls /tmp/2c*.sock /tmp/2c*-client.sock 2>/dev/null
ss -xlp | grep '/tmp/2c' || true
```

To stop one leftover fixture server, pass **that** socket as `HERDR_SOCKET_PATH` (same binary pin). Do **not** run `herdr server stop` without `HERDR_SOCKET_PATH`; that targets the user’s default session. Do not `server.stop` a non-fixture socket from this probe.

`herdr server` stays in the foreground. Status reports `detached_server_daemon: false` for that launch. **#394 leftover Task 4 (shipped on this stack)** already detaches the sidecar so GUI exit does not take the server with it. Closing CLI clients does **not** stop this server. The probe does not use `--session` names for sockets; it uses `HERDR_SOCKET_PATH` so paths stay short.

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

An excerpt of methods and subscribe types is in `tests/fixtures/herdr/schema-excerpt.json` (102 methods, including required `worktree.list` and `workspace.list`). Terminal frame records are **not** in that schema.

| Method | Verified behavior |
| --- | --- |
| `ping` | `type: pong` plus version/protocol/capabilities |
| `session.snapshot` / `herdr api snapshot` | `{type: session_snapshot, snapshot: {version, protocol, workspaces, tabs, panes, layouts, agents}}`. Pane `cwd` joins non-git (and git) workspaces to a project folder. |
| `events.subscribe` | first line `{type: subscription_started}`; later lines `{event, data}`. Subscribe types use dots (`tab.created`); emitted `event` names use underscores (`tab_created`). Subscriptions do not replay history. |
| `workspace.create` | returns `workspace_created` with `workspace`, `tab`, `root_pane`. Works for git primary checkouts **and** non-git directories. |
| `workspace.list` / `get` / `rename` / `close` | list enumerates `workspace_id` but **omits checkout path** on v0.9.0; rename keeps `workspace_id`; last-tab/group rules below |
| `worktree.list` | JSON with absolute `cwd`: repo-scoped `worktree_list` plus `source.repo_key`. Profile ⇔ non-empty `open_workspace_id`. Non-git cwd → `not_git_worktree`. |
| `worktree.create` / `open` / `remove` | see worktree section |
| `tab.create` | returns `tab_created` with `tab` and `root_pane` |
| `pane.list` / `get` / `split` / `read` / `scroll` | see terminal section |
| `pane.send_text` / `send_keys` / `send_input` | JSON input. CLI `herdr pane run` is **not** a schema method; it maps to `pane.send_input` with the command plus a trailing newline (verified: creates a disposable file). `pane.send_text` is text without Enter; `pane.send_keys` sends named keys. |
| `server.stop` / `herdr session stop` | stops the named session |

Socket resolution (verified): `--session` wins; else `HERDR_SOCKET_PATH`; else `$XDG_CONFIG_HOME/herdr/herdr.sock`. Named sessions live at `.../herdr/sessions/<name>/herdr.sock`. The binary client socket is `herdr-client.sock` beside the API socket (or `*-client.sock` when `HERDR_SOCKET_PATH` ends in `.sock`).

`herdr status --json` reports client/server version, protocol 22, endpoint generation, socket path, and session name. Headless `herdr server` is ready once the API socket accepts a connection.

## Terminal frames

**Supported attach transport (#394 leftover, shipped; #436 Task 6 reuses it):** the pinned CLI helper, not the JSON API.

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

2code must not silently take control. Surfacing the conflict string and requiring explicit takeover is **#394 leftover, not this plan** (#394 Task 18 is runtime health/recovery).

## Workspace and worktree lifecycle

A workspace create also creates tab `wN:t1` and root pane `wN:p1` with a `terminal_id`. An empty server has no default workspace — and therefore **no profiles**.

Worktree commands need a git checkout. `--cwd` / `--path` on the socket API must be absolute (the CLI expands relatives). `--trust-repository` trusts that path for one request.

| Operation | Verified result |
| --- | --- |
| `workspace.create --cwd` on a dirty primary checkout | opens the existing repo; uncommitted files are preserved (not recreated) |
| `workspace.create --cwd` on a non-git directory | opens a workspace; `worktree` is absent; snapshot pane `cwd` is that directory |
| `worktree.list` on a git `cwd` with no open workspace | lists disk checkouts **without** `open_workspace_id` (not profiles) |
| `worktree.list` on a non-git `cwd` | `not_git_worktree` |
| `worktree.open --path` of an already-created primary | `already_open: true` with the **same** `workspace_id`; list/snapshot still key that id |
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
| `workspace_id` (`wN`) — **the profile id** | **verified** stable; not the label | **verified** restored from `session.json` |
| `tab_id` (`wN:tM`) | **verified** stable | **verified** restored (root tab and extra tab) |
| `pane_id` (`wN:pK`) | **verified** stable | **verified** restored (root, split, and extra-tab panes) |
| `terminal_id` (`term_<hex>`) | **verified** stable while the PTY lives | **verified** **new** (new process) for every restored pane |

Do not key 2code records on display names. After restart, reattach by `pane_id`; expect a new `terminal_id` and an empty screen unless pane history or native agent restore applies. Restored panes are new shells in the saved cwd — not the old processes.

Public IDs increment for new objects in a session (`w1` closed then created becomes `w2`). Internal `session.json` uses numeric pane ids, not public ids.

## Client-mode mapping (replaces #394 path-cache mapping)

**Verified:** `pane.split --direction right` creates `wN:p2` with its own `terminal_id` in the same tab and emits `pane_created` plus `layout_updated`. `pane.layout` / `session.snapshot.layouts` include pane rects and a `splits` array (`direction`, `ratio`, `rect`). `terminal session observe` can attach to that split pane. Closing the split pane emits `pane_closed`, leaves the original pane and workspace; closing the last remaining pane removes the workspace (`pane_not_found` afterward). Split pane ids survive server restart with new `terminal_id`s.

**Supported 2code mapping for #436:**

| Herdr | 2code |
| --- | --- |
| sqlite `projects` row + canonical `folder` | project |
| `worktree.list` `source.repo_key` | git repo group (not a project id) |
| open workspace (`workspace_id` / `open_workspace_id`) | **profile** (not a sqlite row) |
| every pane in that workspace (all tabs, including splits) | terminal tab, from snapshot (**#436 Task 6**), not `pty_sessions` |
| `pane_id` | terminal identity for attach/close |
| `terminal_id` | live PTY identity (do not persist across restart) |

Split **layout is flattened**: 2code does not reconstruct Herdr’s BSP grid. Every pane is still listed, selected, reattached, and closed. Closing a 2code tab maps to `pane.close`. Closing the last pane/tab of a workspace closes that workspace (Herdr CLI: last tab closes the workspace). If an external pane disappears, drop the 2code tab during snapshot/event reconcile — do not recreate it.

Herdr tabs in the same workspace are additional pane groups, still flattened into 2code terminal tabs. Zoomed splits stay in the layout snapshot (`zoomed`).

This task has **no UX**. Sidebar/profile switcher changes are **#436 Tasks 3–4 and 10**.

## Platform / capability matrix

| Capability | Linux x86_64 | Linux aarch64 | macOS | Windows x86_64 |
| --- | --- | --- | --- | --- |
| Release asset | **verified** (executed) | asset+checksum recorded | asset+checksum recorded | zip+checksum recorded |
| JSON API Unix socket | **verified** (executed) | documented | documented, **not executed** ([#401](https://github.com/AkaraChen/2code/issues/401), #394 leftover) | n/a |
| JSON API named pipe | n/a | n/a | n/a | documented, **unverified** ([#399](https://github.com/AkaraChen/2code/issues/399), #394 leftover) |
| `herdr server` + `HERDR_SOCKET_PATH` | **verified** | documented | documented, **not executed** ([#401](https://github.com/AkaraChen/2code/issues/401), #394 leftover) | documented |
| `terminal session control/observe` | **verified** | documented | documented, **not executed** ([#401](https://github.com/AkaraChen/2code/issues/401), #394 leftover) | **unsupported** ([#396](https://github.com/AkaraChen/2code/issues/396), #394 leftover) |
| Path join (`worktree.list` / snapshot `cwd`) | **verified** | — | — | — |
| Full vs incremental frames | **verified** | — | — | — |
| Unicode / SGR / alt-screen / DSR+DA | **verified** | — | — | — |
| Worktree create/open/remove + dirty primary | **verified** | documented | documented | documented (`--trust-repository` for other-SID repos) |
| Client disconnect keeps server | **verified** | documented | documented | documented |
| Server restart restores workspace/tab/pane ids, not processes | **verified** | documented | documented | documented |
| Agent detection live states | empty-shell `unknown` **verified** (`pane.get` in `herdr_contract.rs`); live CLIs **unverified** ([#398](https://github.com/AkaraChen/2code/issues/398), #394 leftover) | — | — | — |
| `live_handoff` | capability flag true; **not exercised** (not required for local #436 Tasks 2–10) | — | — | — |

## Later-task capabilities

| Need | Status |
| --- | --- |
| Shell | **Verified** to launch `/bin/sh` when the server process has `SHELL=/bin/sh` and `terminal.default_shell = "/bin/sh"`. Per-create shell is not a first-class field. |
| Working directory | `--cwd` on workspace/tab/worktree create **verified**. Snapshot pane `cwd` **verified** as the join key. `terminal.new_cwd = follow` when omitted (**documented**). |
| Environment | `--env CONTRACT_ENV=from_probe` on `workspace.create` **verified** (`printenv` returns `from_probe`). Herdr-injected `HERDR_*` variables are **documented**. |
| Startup command | **Not** a create parameter. Workaround after create: JSON `pane.send_input` with `text` ending in a newline, or CLI `herdr pane run` (not a schema method). #394 leftover: [#397](https://github.com/AkaraChen/2code/issues/397). `layout.apply` argv is **documented**, not probed. |
| Agent state | Idle shells **verified** `agent_status: "unknown"` via JSON `pane.get` (and empty `snapshot.agents`) before any command. Live agent CLIs **unverified**. #394 leftover (was Task 13): [#398](https://github.com/AkaraChen/2code/issues/398). |
| Subscriptions | `events.subscribe` ack + live `tab.created` **verified**. Full bootstrap race (subscribe → snapshot → drain) is **documented** by Herdr, not separately race-tested. |
| Scrollback search | `pane.read` snapshots **verified**; live search is a 2code UI concern. |

## Gaps (not silently “passing”)

| Gap | Blocks | Issue |
| --- | --- | --- |
| Windows live terminal attach / `terminal session` | #394 leftover (Windows attach). Does **not** block Linux #436 Tasks 2–10. | [#396](https://github.com/AkaraChen/2code/issues/396) |
| Windows named-pipe JSON transport unverified | #394 leftover (Windows JSON). Does **not** block Linux #436 Tasks 2–10. | [#399](https://github.com/AkaraChen/2code/issues/399) |
| macOS Unix sockets and `terminal session` attach not executed | #394 leftover (macOS). Does **not** block Linux #436 Tasks 2–10. | [#401](https://github.com/AkaraChen/2code/issues/401) |
| No create-time startup command / argv on `workspace.create` / `tab.create` | #394 leftover (was Task 17). This stack already injects after create. | [#397](https://github.com/AkaraChen/2code/issues/397) |
| Live agent detection (`working`/`blocked`/`done`) unverified | #394 leftover (was Task 13). Not a #436 Task 2–10 gate. | [#398](https://github.com/AkaraChen/2code/issues/398) |
| `workspace.list` omits checkout path | Does **not** block. Join uses `worktree.list` + snapshot `pane.cwd`. | none (recorded) |

Not blocking (recorded, no issue):

- No detached GPG/cosign on release assets — sidecar acquisition keeps using GitHub SHA-256 (#394 leftover Task 3, shipped).
- `herdr server` is foreground (`detached_server_daemon: false`) — **verified**. Detach is already implemented on this stack (#394 leftover Task 4).
- `live_handoff` advertised but not exercised — not required for local #436 Tasks 2–10.

None of the open #394 leftover issues block Linux **#436 Tasks 2–10**. Do not treat sqlite `profiles` as a fallback for any of those tasks.

## Scope vs the 200–400 line estimate

Issue [#437](https://github.com/AkaraChen/2code/issues/437) estimated 200–400 lines and required material growth to be tracked separately: [#438](https://github.com/AkaraChen/2code/issues/438). The Task 1 rewrite is larger because the live JSON join probe, sanitized list/snapshot fixtures, and #394→#436 remapping are all tests and docs. Task 1 did not switch the production `RuntimeRouter` default; **#436 Task 2** does. Splitting the extra evidence would leave #436 Tasks 3–4/7/10 without the path-join contract. #394 leftover line-count tracker: [#400](https://github.com/AkaraChen/2code/issues/400).

Issue [#443](https://github.com/AkaraChen/2code/issues/443) estimated 400–700 lines and required material growth to be tracked separately: [#444](https://github.com/AkaraChen/2code/issues/444). The Task 4 create/delete rewrite is larger because git vs non-git Herdr RPCs, Herdr-down fail-closed tests, Local-flag fallback, dual-backend refuse, leftover-branch delete, and frontend `workspace_id` routing are all in this task. Splitting them would leave Delete Profile unable to reuse a branch name.

Issue [#445](https://github.com/AkaraChen/2code/issues/445) did not need a growth tracker. The Task 5 rewrite is net-negative versus `task-4-herdr-create-delete` (identity/path/import inverted onto leftover sqlite instead of adding a parallel mapping cache).
