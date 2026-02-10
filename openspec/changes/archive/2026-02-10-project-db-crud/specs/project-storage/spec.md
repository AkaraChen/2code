## ADDED Requirements

### Requirement: SQLite database initialization
The system SHALL create and connect to an SQLite database file named `app.db` in the Tauri app data directory on startup. The database connection SHALL be wrapped in `Arc<Mutex<SqliteConnection>>` and registered as Tauri managed state.

#### Scenario: First launch — database file does not exist
- **WHEN** the app starts and no `app.db` file exists in the app data directory
- **THEN** the system creates `app.db` and establishes a connection

#### Scenario: Subsequent launch — database file exists
- **WHEN** the app starts and `app.db` already exists in the app data directory
- **THEN** the system opens the existing database without data loss

### Requirement: Automatic migration on startup
The system SHALL run all pending Diesel embedded migrations automatically when the database connection is established. Migrations MUST be embedded in the binary via `diesel_migrations`.

#### Scenario: Fresh database with no tables
- **WHEN** the app connects to a new empty database
- **THEN** all migrations run and the `projects` table is created

#### Scenario: Database already up to date
- **WHEN** the app connects and all migrations have already been applied
- **THEN** no migrations run and the app starts normally

### Requirement: Projects table schema
The `projects` table SHALL have the following columns:
- `id` — TEXT, primary key (UUID v4 string)
- `name` — TEXT, not null
- `folder` — TEXT, not null (absolute filesystem path)
- `created_at` — TIMESTAMP, not null, default CURRENT_TIMESTAMP

#### Scenario: Table structure after migration
- **WHEN** the `create_projects` migration runs
- **THEN** the `projects` table exists with columns `id` (TEXT PK), `name` (TEXT NOT NULL), `folder` (TEXT NOT NULL), `created_at` (TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)

### Requirement: Diesel model structs
The system SHALL define a `Project` struct deriving `Queryable, Serialize` for reading rows, and a `NewProject` struct deriving `Insertable` for inserting rows. Both MUST correspond to the `projects` table schema.

#### Scenario: Querying a project row
- **WHEN** a row is fetched from the `projects` table
- **THEN** it deserializes into a `Project` struct with fields `id`, `name`, `folder`, `created_at`

#### Scenario: Inserting a new project
- **WHEN** a `NewProject` with `id`, `name`, `folder` is inserted
- **THEN** a new row is created with those values and `created_at` auto-populated
