import { motion, useReducedMotion } from "motion/react";
import { lazy, useState, type ReactNode } from "react";
import SidebarGitPanel from "@/features/git/components/SidebarGitPanel";
import FileTreePanel from "@/features/projects/FileTreePanel";
import type { ProfileSidebarMode } from "@/features/projects/SidebarModeSwitch";
import type { Profile } from "@/generated";
import {
	AsyncBoundary,
	LoadingError,
	LoadingSpinner,
} from "@/shared/components/Fallbacks";

const ProfileNotesEditor = lazy(
	() => import("@/features/profiles/ProfileNotesEditor"),
);

const SIDEBAR_PANEL_TRANSITION = {
	type: "spring",
	stiffness: 320,
	damping: 34,
	mass: 0.9,
} as const;
// Mirrors FileTreePanel's persisted width so all sidebar modes line up.
const SIDEBAR_PANEL_MIN_WIDTH = 180;
const SIDEBAR_PANEL_MAX_WIDTH = 560;
const DEFAULT_SIDEBAR_PANEL_WIDTH = 208;
const SIDEBAR_PANEL_STORAGE_KEY = "file-tree-panel";

function readStoredSidebarPanelWidth() {
	if (typeof window === "undefined") return DEFAULT_SIDEBAR_PANEL_WIDTH;
	try {
		const raw = window.localStorage.getItem(SIDEBAR_PANEL_STORAGE_KEY);
		if (!raw) return DEFAULT_SIDEBAR_PANEL_WIDTH;
		const parsed = JSON.parse(raw) as {
			panelWidth?: unknown;
			state?: { panelWidth?: unknown };
		};
		const width = parsed.state?.panelWidth ?? parsed.panelWidth;
		return typeof width === "number" && Number.isFinite(width)
			? Math.min(
					SIDEBAR_PANEL_MAX_WIDTH,
					Math.max(SIDEBAR_PANEL_MIN_WIDTH, width),
				)
			: DEFAULT_SIDEBAR_PANEL_WIDTH;
	} catch {
		return DEFAULT_SIDEBAR_PANEL_WIDTH;
	}
}

// Fixed-width sibling of FileTreePanel for the non-tree sidebar modes,
// matching its stored width and open/close animation.
function SidebarAltPanel({
	isOpen,
	children,
}: {
	isOpen: boolean;
	children: ReactNode;
}) {
	const prefersReducedMotion = useReducedMotion() ?? false;
	// Read once per mount — mode switches remount and pick up resizes.
	const [panelWidth] = useState(readStoredSidebarPanelWidth);

	return (
		<div
			className="h-full shrink-0"
			style={{ pointerEvents: isOpen ? "auto" : "none" }}
			aria-hidden={!isOpen}
		>
			<motion.div
				initial={false}
				animate={{ width: isOpen ? panelWidth : 0 }}
				transition={
					prefersReducedMotion ? { duration: 0 } : SIDEBAR_PANEL_TRANSITION
				}
				style={{
					display: "flex",
					height: "100%",
					minWidth: 0,
					overflow: "hidden",
				}}
			>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r">
					<AsyncBoundary
						fallback={<LoadingSpinner />}
						errorFallback={({ error, onRetry }) => (
							<LoadingError error={error} onRetry={onRetry} />
						)}
					>
						{children}
					</AsyncBoundary>
				</div>
			</motion.div>
		</div>
	);
}

interface ProfileSidebarProps {
	profile: Profile;
	mode: ProfileSidebarMode;
	isOpen: boolean;
	isActive?: boolean;
	onOpenFile: (filePath: string) => void;
}

export default function ProfileSidebar({
	profile,
	mode,
	isOpen,
	isActive,
	onOpenFile,
}: ProfileSidebarProps) {
	const isFilesMode = mode === "files";

	return (
		<div className="flex h-full shrink-0 flex-col">
			{/* File tree stays mounted across mode switches to keep expansion
			    and selection state — hidden via CSS only */}
			<div
				className="min-h-0 flex-1"
				style={{ display: isFilesMode ? "block" : "none" }}
			>
				<FileTreePanel
					profileId={profile.id}
					rootPath={profile.worktree_path}
					isOpen={isOpen}
					isActive={isActive && isFilesMode}
					onOpenFile={onOpenFile}
				/>
			</div>

			{mode === "git" && (
				<SidebarAltPanel isOpen={isOpen}>
					<SidebarGitPanel
						profileId={profile.id}
						worktreePath={profile.worktree_path}
						onOpenFile={onOpenFile}
					/>
				</SidebarAltPanel>
			)}

			{mode === "notes" && (
				<SidebarAltPanel isOpen={isOpen}>
					<div className="min-h-0 flex-1 overflow-hidden">
						<ProfileNotesEditor profile={profile} />
					</div>
				</SidebarAltPanel>
			)}
		</div>
	);
}
