# Add a tuned [profile.release] to the src-tauri workspace (LTO, codegen-units=1, strip)

> Release builds ship with pure Cargo defaults (no LTO, 16 codegen units, unstripped symbols), inflating the DMG/NSIS/updater artifacts by an estimated 25-50% and leaving cross-crate inlining on the table. | Severity: medium | Category: performance

## Problem

The Cargo workspace root at `src-tauri/Cargo.toml` contains no `[profile.*]` section of any kind:

- `src-tauri/Cargo.toml:1-2` — `[workspace]` / `members = [ "crates/*" ]` makes this file the workspace root. Cargo **only honors profile sections in the workspace root manifest**, so even if a member crate declared one it would be ignored with a warning. No member crate declares one either: `grep -rn "\[profile" src-tauri/` matches only unrelated test helper calls named `profile(...)` in `src-tauri/crates/service/src/watcher.rs:393,398`.
- There is no `.cargo/config.toml` anywhere in the repo, and no `CARGO_PROFILE_*` / `RUSTFLAGS` environment overrides in any GitHub workflow (`.github/workflows/release.yml`, `tauri-smoke.yml`, `unit-tests.yml`).

Consequently every release build uses Cargo's stock release profile: `opt-level = 3`, `codegen-units = 16`, `lto = false`, `strip = "none"` (well, `false`), `panic = "unwind"`.

Why this matters for *this* app specifically:

1. **Binary size directly drives download size for every user, every update.** `src-tauri/tauri.conf.json:36` sets `"createUpdaterArtifacts": true`, and the updater endpoint (`tauri.conf.json:63-68`) points at GitHub releases — so the unstripped, non-LTO binary is what every auto-update downloads.
2. **The dependency graph is huge and statically linked**: `tauri` + `wry`, `diesel`/libsqlite3, `portable-pty`, `notify` (watcher), `reqwest` + rustls, plus six tauri plugins (`src-tauri/Cargo.toml:30-36,48,59`). Symbol stripping and LTO have outsized effect on this kind of binary.
3. **Hot paths cross crate boundaries.** PTY chunk handling flows handler → `service::pty` → `infra::pty`/`infra::pty_log` across separate workspace crates (`src-tauri/crates/service/src/pty.rs:333,602`; `src-tauri/crates/infra/src/pty.rs`). Without LTO, none of those cross-crate calls can be inlined.
4. **Four release targets pay/benefit**: `.github/workflows/release.yml:27-45` builds macOS arm64, macOS x64, Linux x64, and Windows x64 (NSIS) via `tauri-apps/tauri-action@v0` with `tauriScript: bun tauri` (`release.yml:114-135`).

The fix costs zero runtime code changes — it is a 5-line addition to one manifest.

## Evidence & Measurements

No runtime benchmarks apply (this is a build-configuration finding). Concrete code evidence:

- `src-tauri/Cargo.toml:1-2` — workspace root; entire file (65 lines) has no `[profile.release]` (verified by reading the file and by `grep -rn "\[profile" src-tauri/`, which returns only `crates/service/src/watcher.rs:393,398` — test helper function calls, not manifest sections).
- `src-tauri/tauri.conf.json:36` — `"createUpdaterArtifacts": true` → binary size == updater download size.
- `.github/workflows/release.yml:114-135` — release builds run through `tauri-apps/tauri-action@v0` with no `CARGO_PROFILE_*`/`RUSTFLAGS` in `env:`, so pure Cargo defaults ship today.
- `e2e-tests/test/smoke.test.mjs:172` — PR smoke gate builds with `bun tauri build --debug --no-bundle`, i.e. the **debug** profile. A heavier release profile therefore adds zero cost to PR CI; only the release pipeline (and the `smoke` job reused by `release.yml:15-17`, which also runs the debug build) is unaffected in day-to-day development.

Measured impact: not measurable in this container (the full Tauri app cannot build here — missing GTK system libs). Expected ~25-50% smaller release binary/DMG/updater download from `strip` + LTO + `codegen-units = 1`, the well-established range for statically linked Tauri binaries, plus a small runtime win from cross-crate inlining across the model/repo/service/infra boundaries.

## Proposed Change

### Step 1 — Add the profile to the workspace root

**File: `src-tauri/Cargo.toml`** — append at the end of the file (after the `[dev-dependencies]` section ending at line 65):

```toml
[profile.release]
codegen-units = 1
lto = "thin"
strip = true
```

Rationale for each choice (and deliberate omissions):

- `codegen-units = 1` — maximizes intra-crate optimization; slower compile, but only the release pipeline pays (see Evidence: smoke CI builds `--debug`).
- `lto = "thin"` — **start with thin LTO, not `lto = true` (fat)**. The release matrix builds 4 targets on 4 runners (`release.yml:27-45`); fat LTO combined with `codegen-units = 1` can multiply link times on those runners. Thin LTO captures most of the cross-crate-inlining and size win. Upgrade to `lto = true` in a follow-up only after observing acceptable release-job wall times.
- `strip = true` — strips symbols; the single biggest size lever, zero runtime risk. Note this removes symbolicated native backtraces from release builds (see Risks).
- **`panic = "abort"` is deliberately omitted.** It is a behavior change, not an optimization: `infra`/`service` spawn long-lived background threads — the PTY reader thread (`src-tauri/crates/service/src/pty.rs:333`), the log-persistence thread (`src-tauri/crates/service/src/pty.rs:602`), the watcher thread (`src-tauri/crates/service/src/watcher.rs:39`), and the logger thread (`src-tauri/crates/infra/src/logger.rs:44`). Today a panic in one of these kills only that thread; with `panic = "abort"` it would abort the entire app mid-session. Do not add it without first auditing those panic paths. Also note `crate-type` includes `"cdylib"`/`"staticlib"` (`src-tauri/Cargo.toml:17`), where `panic = "abort"` has additional unwind-across-FFI implications.
- **`opt-level = "s"` is deliberately omitted.** Keep the default `opt-level = 3`: the PTY output path (4KB chunk reads, vt100 `sanitize_history` replay of up to 10k scrollback lines on session restore) is throughput-sensitive, and `strip` + LTO alone capture most of the size win risk-free. Consider `"s"` only in a follow-up with before/after timing of the scrollback-restore path.

### Step 2 — Nothing else changes

- No CI workflow edits are needed: `tauri-action` runs `bun tauri build`, which uses `--release` by default and will pick up the new profile automatically.
- Do not add a `.cargo/config.toml`; keep the profile in the one place Cargo honors it (workspace root).
- Do not add profile sections to `src-tauri/crates/*/Cargo.toml` — Cargo ignores non-root profiles.

### Optional Step 3 — follow-ups (separate PRs, only if wanted)

1. If release-job link times are acceptable with thin LTO, try `lto = true` and compare both CI wall time and artifact sizes.
2. If further size reduction is desired, benchmark `opt-level = "s"` against PTY throughput / scrollback restore before adopting.

## Verification

**Important container constraint:** the full Tauri app cannot be built in typical CI/agent containers (missing GTK/webkit2gtk system libs). Never run bare `cargo build` / `cargo test` in the `src-tauri` workspace there. Final size verification must happen in the real release pipeline or on a dev machine with Tauri prerequisites installed.

### 1. Manifest sanity (works in any container, cheap)

```bash
cd /home/user/2code/src-tauri
# Parses the manifest tree; fails loudly on TOML/profile errors:
cargo metadata --format-version 1 --no-deps > /dev/null && echo MANIFEST_OK
```

Cargo also emits a warning like `warning: profiles for the non root package will be ignored` if the profile were misplaced — there should be **no** such warning.

### 2. Confirm the profile actually applies (container-safe)

Build only the leaf workspace crates in release mode (these compile without GTK):

```bash
cd /home/user/2code/src-tauri
cargo build --release -p model -p repo -p infra -p service
```

Then verify the compiler invocations carry the tuned flags:

```bash
cargo build --release -p model --verbose 2>&1 | grep -o "codegen-units=1\|lto" | sort -u
# expect: codegen-units=1 (thin LTO flags appear on the final binary link, not rlib builds)
```

### 3. Existing tests still pass (regression gate, container-safe)

```bash
cd /home/user/2code/src-tauri
cargo test -p model -p repo -p service -p infra          # 151 tests, debug profile
cargo test --release -p model -p repo -p service -p infra # same tests under the tuned profile
```

The `--release` run is the meaningful new check: it exercises `codegen-units = 1` + thin LTO codegen against the whole PTY/vt100/watcher test suite (including the scrollback `sanitize_history` tests in the service crate). Frontend is untouched, but `cd /home/user/2code && bunx vitest run` (671 tests) is a cheap belt-and-braces check.

### 4. Real release verification (dev machine or CI with Tauri prereqs — the authoritative check)

```bash
cd /home/user/2code
bun tauri build            # must complete; uses the new profile
```

Compare before/after:

- Raw binary: `ls -l src-tauri/target/release/code` (or the platform binary name) — expect a 25-50% reduction.
- Bundles/updater artifacts under `src-tauri/target/release/bundle/` — DMG (macOS), `.AppImage`/`.deb` (Linux), NSIS `.exe` (Windows), and the `*.tar.gz` / `*.zip` updater artifacts produced because `createUpdaterArtifacts` is true. Record sizes in the PR description.
- Confirm `strip` worked: `nm src-tauri/target/release/code 2>&1 | head` should report "no symbols" (Linux/macOS).
- Watch the release workflow wall time for the 4 matrix jobs (`.github/workflows/release.yml`) vs. the previous release; if link time ballooned, that is the signal to keep `lto = "thin"` rather than escalate to fat LTO.

### 5. Smoke gate unaffected

The PR smoke build uses `--debug --no-bundle` (`e2e-tests/test/smoke.test.mjs:172`), so its duration should be unchanged — verify the `tauri-smoke` job time on the PR is comparable to recent runs.

No new unit test is needed (there is no runtime code change); the new "test" is the `cargo test --release -p ...` invocation above plus the release-pipeline size comparison.

## Risks & Constraints

- **Do NOT add `panic = "abort"` in this change.** Background threads (PTY reader `service/src/pty.rs:333`, log persister `service/src/pty.rs:602`, watcher `service/src/watcher.rs:39`, logger `infra/src/logger.rs:44`) currently survive a sibling-thread panic; abort-on-panic would take down the whole app and every open terminal session. Treat it as a separate, audited change.
- **Stripped binaries lose symbolicated crash backtraces** in release builds. If native crash triage matters, either accept `strip = "debuginfo"` instead of `true` (keeps symbol table, still large win), or set up split-debuginfo/dSYM retention in the release workflow. Default recommendation stands at `strip = true` since there is no crash-reporting pipeline in the repo today.
- **Release CI time increases.** `codegen-units = 1` + LTO makes the release compile slower on all 4 matrix runners. Mitigations already in the plan: thin LTO first; `Swatinem/rust-cache` (`release.yml:83-88`) caches dependencies, though the final LTO link is never cached. This does not affect PR CI (smoke builds debug).
- **`lto` interacts with `crate-type = ["staticlib", "cdylib", "rlib"]`** (`src-tauri/Cargo.toml:12-17`). Thin LTO is fine here; if later upgrading to fat LTO, be aware fat LTO over cdylib outputs is where exotic linker issues occasionally surface (especially Windows NSIS target) — hence the "watch all 4 matrix jobs" verification step.
- **Container constraint (CLAUDE.md/environment):** never run plain `cargo build`/`cargo test` or `bun tauri ...` in the agent container — GTK libs are missing; use `-p model -p repo -p service -p infra` scoped commands only. Full-app verification belongs in the release pipeline.
- **CLAUDE.md invariants:** none oppose this change. Do not touch `src/generated/`, `src/paraglide/`, `project.inlang/settings.json`, or `src-tauri/src/schema.rs`; this change touches only `src-tauri/Cargo.toml`. `Cargo.lock` is unaffected (profiles do not alter the dependency graph).
- **Runtime behavior risk is minimal but nonzero:** `codegen-units = 1` + LTO can, rarely, surface latent UB or over-aggressive inlining bugs. The `cargo test --release` run over all four workspace crates (PTY, vt100 sanitize, watcher, slug, git, DB) is the guard; any release-only test failure is a hard blocker for merging.
