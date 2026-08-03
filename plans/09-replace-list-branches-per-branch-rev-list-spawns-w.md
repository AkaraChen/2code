# Replace list_branches' per-branch rev-list spawns with a single for-each-ref ahead-behind query

> Cuts branch-switch dialog population from ~350 ms (101 branches) / ~1.6 s (501 branches) to ~18–35 ms by collapsing N `git rev-list` subprocesses into one `git for-each-ref %(ahead-behind:HEAD)` call | Severity: high | Category: performance

## Problem

`infra::git::list_branches` (`src-tauri/crates/infra/src/git.rs:732-775`) builds the branch list shown in the branch-switch dialog (`src/features/git/SwitchBranchDialog.tsx`, fetched via `useGitBranches` in `src/features/git/hooks.ts:127-135`). Its cost is **one subprocess per branch**:

- `git.rs:733-741` — one `git for-each-ref refs/heads --format=%(refname:short) --sort=-committerdate` to enumerate branch names.
- `git.rs:756-762` — inside the per-branch `.map()`, every non-current branch calls `branch_ahead_behind(folder, name)`:

  ```rust
  let (ahead, behind) = if is_current {
      (0, 0)
  } else {
      branch_ahead_behind(folder, name)
  };
  ```

- `branch_ahead_behind` (`git.rs:706-730`) spawns `git rev-list --left-right --count HEAD...{branch}` — a full history walk per branch. **Parse-order note:** in that function, `--left-right` prints left (=behind) first, then right (=ahead), see `git.rs:726-728`.
- Plus ~6 fixed spawns per call: `branch()` (`git.rs:108`, called at `git.rs:748`), `trunk_branch_name` (`git.rs:629-661`, up to 3 spawns: `symbolic-ref` + `show-ref` probes for main/master), and `branches_used_by_other_worktrees` (`git.rs:664-703`, 2 spawns: `rev-parse --show-toplevel` + `worktree list --porcelain`).

So a repo with N branches costs **N+6 sequential process spawns**, each doing real history walking. The frontend hook (`hooks.ts:127-135`) uses `refetchOnMount: "always"` with `staleTime: 10_000`, so this full cost is paid on essentially every dialog open. Measured baseline scales linearly at ~3.2 ms/branch (Linux, warm caches); it crosses the ~100 ms perception threshold at only ~30 local branches, and this app manufactures one branch per profile, so branch counts grow with normal usage. macOS process-spawn overhead makes it worse.

Git >= 2.41 provides the `%(ahead-behind:HEAD)` format atom for `for-each-ref`, which computes all ahead/behind counts against HEAD in a **single** process using one shared graph walk.

The handler (`src-tauri/src/handler/project.rs:259-271`, `list_git_branches`) already releases the DB mutex before the git work (the lock is scoped inside `profile_worktree_path`, `project.rs:12-18`) and runs in `run_blocking`, so this is purely dialog-population latency, not an app-wide DB stall. No handler change is needed.

## Evidence & Measurements

Verifier benchmark (verbatim):

> Environment: Linux container, git 2.43.0, cargo dev profile (profile irrelevant: >99% of time is git subprocess execution; Rust side is trivial string parsing). Test repo: 151 commits on master + 5-commit side lineage branching off mid-history; N bench branches cycled over 4 targets (behind 1 / behind 75 / behind 150 / ahead 5+behind 75). Harness: additive integration test calling the real infra::git::list_branches vs a reimplemented single-invocation for-each-ref %(ahead-behind:HEAD) variant that keeps the identical constant-cost calls (current branch, trunk detection, worktree listing); outputs asserted field-by-field identical at every scale before timing; 1 warmup + 10 iterations (5 at n=500) each. Results (mean, min in parens): 16 branches: baseline 59.15 ms (57.54) vs optimized 14.66 ms (14.03) = 4.0x. 101 branches: baseline 348.64 ms (328.62) vs optimized 18.27 ms (17.25) = 19.1x. 501 branches: baseline 1624.04 ms (1585.76) vs optimized 35.45 ms (34.60) = 45.8x. Baseline is linear at ~3.2 ms/branch; optimized is near-flat (~14 ms fixed overhead from the 6 constant spawns + one for-each-ref that grows mildly with N). Shell prototype additionally verified %(ahead-behind:HEAD) semantics: prints "ahead behind" and matches rev-list --left-right counts exactly (diverged branch: 3 2 in both).

Additional empirical facts verified in this container (git 2.43.0):

- `git for-each-ref refs/heads --format='%(refname:short)%09%(ahead-behind:HEAD)' --sort=-committerdate` on a normal repo prints e.g. `feat<TAB>0 1` / `master<TAB>0 0` — the atom prints **ahead first, then behind** (the OPPOSITE order of the existing `rev-list --left-right` parse at `git.rs:726-728`).
- On a freshly-initialized repo with an unborn HEAD (no commits), the same command **fails with exit 128** (`fatal: failed to find 'HEAD'`) even though `refs/heads` is empty — whereas the current implementation returns `Ok(vec![])` there. A fallback is therefore mandatory for correctness, not just for old git.
- Correctness of the replacement is proven: field-by-field identical `Vec<GitBranchInfo>` (name/is_current/ahead/behind/is_used/is_trunk) against the current implementation at 16/101/501 branches including diverged branches (ahead 5, behind 75).

Measured impact: 19.1x faster at 101 branches (349 ms → 18 ms) and 45.8x at 501 branches (1.62 s → 35 ms) per branch-dialog open, with output verified identical.

## Proposed Change

All code changes are in **one file**: `src-tauri/crates/infra/src/git.rs`. No frontend change: `src/features/git/hooks.ts:127-135` (`refetchOnMount: "always"`, `staleTime: 10_000`) is deliberate freshness behavior and simply becomes cheap. No handler, model, IPC-binding, or schema change — `GitBranchInfo` (`src-tauri/crates/model/src/project.rs:115-124`) and the command signature are untouched, so `cargo tauri-typegen generate` is NOT needed.

### Step 1 — Rename the current implementation to a private fallback

Rename the existing `pub fn list_branches` body (`git.rs:732-775`) to a private function, unchanged in behavior:

```rust
/// Legacy path: one `git rev-list` per branch. Used when the
/// %(ahead-behind:...) atom is unavailable (git < 2.41) or HEAD is
/// unresolvable (unborn HEAD in a freshly-initialized repo).
fn list_branches_per_branch(folder: &str) -> Result<Vec<GitBranchInfo>, AppError> {
    // ... exact current body of list_branches (git.rs:733-774), unmodified ...
}
```

Keep `branch_ahead_behind` (`git.rs:706-730`) exactly as-is — it is still used by this fallback.

### Step 2 — New `list_branches` fast path

Add the new public function in the same location:

```rust
pub fn list_branches(folder: &str) -> Result<Vec<GitBranchInfo>, AppError> {
    // Fast path: git >= 2.41 computes every branch's ahead/behind vs HEAD
    // in a single process via the %(ahead-behind:HEAD) format atom.
    let output = command_without_windows_console("git")
        .args([
            "for-each-ref",
            "refs/heads",
            "--format=%(refname:short)%09%(ahead-behind:HEAD)",
            "--sort=-committerdate",
        ])
        .current_dir(folder)
        .output()?;

    if !output.status.success() {
        // Two known failure modes, both handled by the legacy path:
        // 1. git < 2.41 rejects the ahead-behind atom (non-zero exit).
        // 2. Unborn HEAD (fresh `git init`, no commits): the atom fails with
        //    "fatal: failed to find 'HEAD'" (exit 128) even with zero
        //    branches, while the legacy path correctly returns Ok(vec![]).
        // A genuinely broken folder (not a repo) also lands here; the legacy
        // path then surfaces the same GitError the old code produced.
        return list_branches_per_branch(folder);
    }

    let current = branch(folder).unwrap_or_default();
    let trunk = trunk_branch_name(folder);
    let used = branches_used_by_other_worktrees(folder);

    let branches = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            let (name, counts) = line.split_once('\t').unwrap_or((line, ""));
            let name = name.trim();
            // %(ahead-behind:HEAD) prints "ahead behind" — ahead FIRST.
            // NOTE: this is the OPPOSITE of branch_ahead_behind's
            // rev-list --left-right output, where behind (left) comes first.
            let mut parts = counts.split_whitespace();
            let ahead: u32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let behind: u32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let is_current = name == current;
            GitBranchInfo {
                name: name.to_string(),
                is_current,
                // HEAD vs HEAD yields "0 0" from the atom anyway, but keep the
                // explicit zeroing to match the legacy path exactly.
                ahead: if is_current { 0 } else { ahead },
                behind: if is_current { 0 } else { behind },
                is_used: used.contains(name),
                is_trunk: trunk.as_deref() == Some(name),
            }
        })
        .collect();

    Ok(branches)
}
```

Implementation notes (do not skip):

1. **Order gotcha** — `%(ahead-behind:HEAD)` prints ahead first; the legacy `branch_ahead_behind` parse reads behind first from `--left-right`. Empirically verified on git 2.43.0. Getting this backwards passes compilation and superficially plausible output; only a diverged-branch test catches it.
2. **Tab separator** — use `%09` between name and counts and `split_once('\t')`. Git refnames cannot contain whitespace, but tab is the safest delimiter and makes the parse unambiguous.
3. **Keep `--sort=-committerdate`** on the combined invocation — the legacy enumeration already uses it, so UI ordering is unchanged.
4. **Fallback is mandatory** — both for git < 2.41 and for unborn-HEAD repos (see Step 2 comment). Fall back on any non-zero exit; do not try to distinguish the failure modes.
5. **Constant-cost helpers stay as-is** — `trunk_branch_name`, `branches_used_by_other_worktrees`, and `branch()` remain untouched (~6 fixed spawns, ~14 ms of the optimized total). They are not the bottleneck; do not fold them into the format string.
6. **Error-path equivalence** — for a non-repo folder, the fast for-each-ref fails → fallback runs → its plain for-each-ref fails → the same `AppError::GitError` the old code returned. One extra spawn on the error path is acceptable.

### Step 3 — Add integration tests for the infra crate

`src-tauri/crates/infra/tests/` does not exist yet; create it with one new file, e.g. `src-tauri/crates/infra/tests/git_list_branches.rs`. The infra crate already has `tempfile` as a regular dependency and `uuid` as a dev-dependency (`src-tauri/crates/infra/Cargo.toml`), so no manifest change is needed if you use `tempfile::TempDir`. Model the git helpers on `src-tauri/tests/common/mod.rs:26-66` (`create_temp_git_repo` / `add_commit` using `infra::no_window::command_without_windows_console`); that module belongs to the app crate's tests and cannot be imported here — copy the two small helpers into the new file.

Tests to write (all call the real `infra::git::list_branches`):

1. **Diverged ahead/behind counts** (catches the order gotcha): repo with `master` (say 4 commits); create `feat` at commit 2, add 3 commits on `feat`; check out `master`. Expect for `feat`: `ahead == 3`, `behind == 2`; for `master`: `is_current == true`, `ahead == 0`, `behind == 0`. Also assert exactly one `is_trunk` (on `master`/`main`) and sort order (most recent committerdate first).
2. **Purely-behind branch**: branch created at an ancestor with no unique commits → `ahead == 0`, `behind > 0`.
3. **Empty repo (unborn HEAD)**: `git init` with no commits → `list_branches` returns `Ok` with an empty vec (exercises the fallback trigger; on git >= 2.41 the fast path fails here and the legacy path must produce `Ok(vec![])`).
4. **Worktree flag**: `git worktree add <tmp>/wt feat` from the main repo, then `list_branches` on the main repo folder → `feat.is_used == true`, current branch `is_used == false`. (Clean up the worktree dir; `TempDir` drop handles it if both live under one `TempDir`.)
5. **Fast-vs-legacy equivalence** (replicates the verifier's proof): on the diverged repo from test 1, compare `list_branches(...)` against the legacy path field-by-field (name/is_current/ahead/behind/is_used/is_trunk). To make the legacy path reachable from an integration test, mark it `#[doc(hidden)] pub fn list_branches_per_branch(...)` instead of private (with a comment that it is public only for tests/fallback verification). If reviewers prefer it private, drop this test and rely on tests 1–4's hardcoded expected counts, which already pin both orders.

`GitBranchInfo` derives needed for `assert_eq!` on whole structs: check `src-tauri/crates/model/src/project.rs:115` — if it lacks `PartialEq`, compare field-by-field rather than adding derives to the model crate.

## Verification

All commands from repo root. **NEVER run plain `cargo build`/`cargo test` in src-tauri (full tauri app build fails in CI containers — missing GTK libs) and never `bun tauri ...`.**

```bash
# 1. Workspace crates still build and all existing tests pass (151 tests pre-change):
cd /home/user/2code/src-tauri && cargo test -p model -p repo -p service -p infra

# 2. New tests specifically:
cd /home/user/2code/src-tauri && cargo test -p infra --test git_list_branches

# 3. Frontend untouched, but confirm no regression in the git feature tests:
cd /home/user/2code && bunx vitest run src/features/git
```

Existing coverage of the area: `src-tauri/tests/integration_git.rs` covers `get_branch` (`:608-616`) but has **no** `list_branches` test, and it lives in the app crate whose test binary cannot build in this container — hence the new tests go in `crates/infra/tests/`. The in-crate `#[cfg(test)]` module in `git.rs` (`:1753+`) only covers pure parsing helpers.

Optional performance spot-check (proves the speedup without touching tracked files; delete afterwards): a throwaway script in scratch space that builds a repo with ~100 branches over real history and times `list_branches` before/after, expecting ~350 ms → ~20 ms. The verifier already measured 4.0x/19.1x/45.8x at 16/101/501 branches with identical output, so this is confirmation, not discovery.

Manual verification (only on a machine that can run the app; not possible in CI containers): `bun tauri dev`, open a project profile in a repo with many branches, open the branch-switch dialog (`SwitchBranchDialog.tsx`) — it should populate near-instantly and show identical ahead/behind badges as before.

## Risks & Constraints

- **Git version dependency**: `%(ahead-behind:HEAD)` requires git >= 2.41 (May 2023). Older gits reject the atom with a non-zero exit — the fallback path (Step 1) preserves exact old behavior there, so the floor requirement of the app does not change. Do not remove `branch_ahead_behind` or the legacy path.
- **Unborn-HEAD regression risk**: without the fallback, a freshly-initialized repo would turn `Ok(vec![])` into `Err(GitError)`, breaking the dialog for new projects. Test 3 pins this.
- **Ahead/behind order swap**: the single highest-risk detail. The atom prints ahead-first; the legacy rev-list parse is behind-first. Test 1 (diverged counts) is the guard — do not write it with symmetric counts (e.g. 2/2) or the swap is invisible.
- **CLAUDE.md invariants**: handlers stay thin (no change to `handler/project.rs`); business logic stays in infra (`git.rs` is the designated home for git command execution per `crates/infra/CLAUDE.md`); do not edit `src/generated/` or `src-tauri/src/schema.rs`; no IPC signature change so no `cargo tauri-typegen generate` needed; do not touch `project.inlang/` or `src/paraglide/`.
- **DB locking**: no change — `list_git_branches` already scopes the DB lock inside `profile_worktree_path` (`handler/project.rs:12-18`) and runs the git work in `run_blocking`. Do not move git calls under the DB mutex.
- **Sort-order regression**: keep `--sort=-committerdate` on the combined invocation; the dialog relies on the existing ordering.
- **Frontend behavior unchanged**: leave `useGitBranches` (`hooks.ts:127-135`) alone — `refetchOnMount: "always"` is intended freshness and is only a problem because the backend call was slow.
- **Windows**: keep using `command_without_windows_console` (as sketched) so no console window flashes on Windows.
- **Test hygiene**: new integration tests must create repos under `TempDir`/unique temp paths and clean up (worktrees included — `git worktree add` writes metadata into the main repo's `.git`, but deleting the whole temp tree removes everything).
