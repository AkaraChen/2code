/**
 * File path link detection for terminal output.
 *
 * Detects common source-location patterns emitted by compilers, test runners,
 * linters, and stack traces (e.g. `src/foo.ts:12:3`, `./src/foo.ts:12`).
 */

export interface FileLocation {
	/** The raw file path as found in the terminal output */
	filePath: string;
	/** 1-based line number, if detected */
	line: number | null;
	/** 1-based column number, if detected */
	column: number | null;
}

/**
 * Regex to detect file path locations in a single line of terminal text.
 *
 * Matches patterns like:
 * - `src/foo.ts:12:3`
 * - `./src/foo.ts:12`
 * - `/Users/me/project/src/main.ts:42:7`
 * - `src-tauri/crates/service/src/profile.rs:88:5`
 *
 * The path must contain at least one `/` (to avoid matching plain words),
 * must have a file extension, and must end with `:line` or `:line:col`.
 */
const FILE_LOCATION_REGEX =
	/(?:^|[\s"'(,])(\.\/?|\/)?([\w@.][\w@./\-]*\.[a-z0-9]+):(\d+)(?::(\d+))?/gi;

/**
 * Detects file path locations within a line of terminal text.
 * Returns all detected file locations.
 */
export function detectFileLocations(line: string): FileLocation[] {
	const results: FileLocation[] = [];
	FILE_LOCATION_REGEX.lastIndex = 0;

	for (
		let match = FILE_LOCATION_REGEX.exec(line);
		match !== null;
		match = FILE_LOCATION_REGEX.exec(line)
	) {
		const prefix = match[1] ?? "";
		const pathBody = match[2];
		const lineStr = match[3];
		const colStr = match[4];

		const filePath = prefix + pathBody;

		// Must contain at least one `/` to be a path (not just `file.ts:1`)
		if (!filePath.includes("/")) continue;

		// Ignore obvious non-file patterns
		if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
			continue;
		}

		results.push({
			filePath,
			line: lineStr ? Number.parseInt(lineStr, 10) : null,
			column: colStr ? Number.parseInt(colStr, 10) : null,
		});
	}

	return results;
}

/**
 * Regex used by the xterm link provider to identify clickable file-path regions.
 * This is a simpler variant that matches the full `path:line:col` token for
 * highlighting purposes.
 */
export const FILE_LINK_REGEX =
	/(?:\.\/?|\/)?[\w@.][\w@./\-]*\.[a-z0-9]+:\d+(?::\d+)?/i;

/**
 * Parse a matched file link string into its components.
 */
export function parseFileLink(link: string): FileLocation | null {
	const match = link.match(
		/^(\.\/?|\/)?([\w@.][\w@./\-]*\.[a-z0-9]+):(\d+)(?::(\d+))?$/i,
	);
	if (!match) return null;

	const prefix = match[1] ?? "";
	const pathBody = match[2];
	const lineStr = match[3];
	const colStr = match[4];

	const filePath = prefix + pathBody;

	// Must contain at least one `/` to be a path
	if (!filePath.includes("/")) return null;

	return {
		filePath,
		line: lineStr ? Number.parseInt(lineStr, 10) : null,
		column: colStr ? Number.parseInt(colStr, 10) : null,
	};
}
