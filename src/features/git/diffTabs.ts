// Encoding for read-only diff tabs that live alongside regular file tabs.
//
// Diff tabs reuse the FileViewerTabsStore so they get tabs, reordering,
// close, and "never unmount" persistence for free. We just give them a
// synthetic path with a recognizable scheme so the renderer can dispatch.
//
// Format:  2code-diff://<staged|unstaged>/<repo-relative-path>
// Title:   "<basename> · diff [staged]"

const SCHEME = "2code-diff://";

export type DiffSide = "staged" | "unstaged";

export function isDiffTabPath(path: string): boolean {
	return path.startsWith(SCHEME);
}

export function buildDiffTabPath(side: DiffSide, filePath: string): string {
	return `${SCHEME}${side}/${filePath}`;
}

export interface ParsedDiffTab {
	side: DiffSide;
	filePath: string;
}

export function parseDiffTabPath(path: string): ParsedDiffTab | null {
	if (!path.startsWith(SCHEME)) return null;
	const rest = path.slice(SCHEME.length);
	const slash = rest.indexOf("/");
	if (slash < 0) return null;
	const side = rest.slice(0, slash);
	if (side !== "staged" && side !== "unstaged") return null;
	const filePath = rest.slice(slash + 1);
	if (!filePath) return null;
	return { side: side as DiffSide, filePath };
}

export function diffTabTitle(side: DiffSide, filePath: string): string {
	const basename = filePath.split("/").pop() ?? filePath;
	return `${basename} · diff${side === "staged" ? " [staged]" : ""}`;
}

// ── Commit detail tabs ──
//
// Format:  2code-commit://<hash1>+<hash2>+.../
// One entry per selected commit, oldest → newest. The trailing slash keeps
// the path scheme symmetric with diff tabs and avoids a special case for
// the "no path" portion.

const COMMIT_SCHEME = "2code-commit://";

export function isCommitTabPath(path: string): boolean {
	return path.startsWith(COMMIT_SCHEME);
}

export function buildCommitTabPath(commitHashes: string[]): string {
	return `${COMMIT_SCHEME}${commitHashes.join("+")}/`;
}

export function parseCommitTabPath(path: string): string[] | null {
	if (!path.startsWith(COMMIT_SCHEME)) return null;
	const rest = path.slice(COMMIT_SCHEME.length).replace(/\/$/, "");
	if (!rest) return null;
	return rest.split("+").filter(Boolean);
}

export function commitTabTitle(
	commitHashes: string[],
	primarySubject: string | null | undefined,
): string {
	if (commitHashes.length === 0) return "commit";
	if (commitHashes.length === 1) {
		const short = commitHashes[0].slice(0, 7);
		return primarySubject ? `${short} · ${primarySubject}` : short;
	}
	return `${commitHashes.length} commits · ${commitHashes[0].slice(0, 7)}…`;
}
