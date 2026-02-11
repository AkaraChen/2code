## Why

Projects often require working on multiple branches simultaneously. Currently there's no structured way to manage branch-based workspaces. Profile adds backend support for Git worktree-based workspaces with lifecycle scripts, laying the groundwork for future PTY integration (creating terminals scoped to a profile's worktree directory).

## What Changes

- New `profiles` database table tracking per-project branch workspaces (profile ID, project ID, branch name, worktree path, status)
- Git worktree creation/removal managed by backend, stored at `~/.2code/workspace/{profile_id}/`
- `2code.json` project config file (in project root) defining `setup_script` and `teardown_script` (both `string[]`) executed during profile lifecycle
- Backend CRUD commands for profiles: create, list, get, update, delete — all with tests
- Profile creation runs `git worktree add` + `setup_script`; deletion runs `teardown_script` + `git worktree remove`

## Capabilities

### New Capabilities

- `profile-management`: CRUD operations for profiles — create (with branch name + git worktree), list, get, update, delete (with worktree cleanup). Database schema, models, and Tauri commands with full test coverage.
- `project-config`: Reading `2code.json` from the project directory. Parsing setup/teardown scripts and executing them during profile lifecycle.

### Modified Capabilities

_(none — PTY integration with profile context is deferred to a future change)_

## Impact

- **Database**: New `profiles` table with foreign key to `projects`
- **Backend**: New `profile/` module (models, commands), new config module for `2code.json` parsing, git worktree operations via `std::process::Command`
- **Dependencies**: No new crate dependencies expected (git CLI via `Command`, serde for JSON config)
- **Filesystem**: Creates `~/.2code/workspace/` directory structure; reads `2code.json` from project roots
- **Testing**: Integration tests for all CRUD operations, worktree lifecycle, and config parsing
