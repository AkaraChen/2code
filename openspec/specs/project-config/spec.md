## ADDED Requirements

### Requirement: Parse 2code.json from project directory

The system SHALL read and parse `2code.json` from a project's root folder. The file format is a JSON object with two optional fields: `setup_script` (array of strings) and `teardown_script` (array of strings). Each string represents a complete shell command.

#### Scenario: Valid config file exists

- **WHEN** `2code.json` exists at `{project.folder}/2code.json` with valid JSON content
- **THEN** the system parses it and returns the config with setup_script and teardown_script arrays

#### Scenario: Config file does not exist

- **WHEN** `2code.json` does not exist at `{project.folder}/2code.json`
- **THEN** the system SHALL return a default config with empty setup_script and teardown_script arrays (no error)

#### Scenario: Config file has missing fields

- **WHEN** `2code.json` exists but omits `setup_script` or `teardown_script`
- **THEN** the missing fields SHALL default to empty arrays

#### Scenario: Config file has invalid JSON

- **WHEN** `2code.json` exists but contains invalid JSON
- **THEN** the system SHALL return an error indicating the config file could not be parsed

### Requirement: Execute setup scripts

The system SHALL execute setup scripts sequentially in the worktree directory during profile creation. Each script string is executed via `sh -c "<command>"` with the working directory set to the worktree path.

#### Scenario: All scripts succeed

- **WHEN** `setup_script` contains ["npm install", "cp .env.example .env"] and both commands succeed
- **THEN** both commands are executed sequentially in the worktree directory

#### Scenario: A script fails

- **WHEN** a setup script command fails (non-zero exit code)
- **THEN** the system SHALL log a warning with the failed command and its stderr, skip remaining scripts, and return without error (profile creation continues)

#### Scenario: No setup scripts configured

- **WHEN** `setup_script` is empty or `2code.json` does not exist
- **THEN** no scripts are executed and the operation proceeds normally

### Requirement: Execute teardown scripts

The system SHALL execute teardown scripts sequentially in the worktree directory during profile deletion. Each script string is executed via `sh -c "<command>"` with the working directory set to the worktree path.

#### Scenario: All scripts succeed

- **WHEN** `teardown_script` contains ["rm -rf node_modules"] and the command succeeds
- **THEN** the command is executed in the worktree directory before worktree removal

#### Scenario: A script fails

- **WHEN** a teardown script command fails (non-zero exit code)
- **THEN** the system SHALL log a warning and continue with worktree removal and database cleanup

#### Scenario: Worktree directory does not exist

- **WHEN** teardown scripts need to run but the worktree directory has already been manually deleted
- **THEN** the system SHALL skip script execution and proceed with database cleanup
