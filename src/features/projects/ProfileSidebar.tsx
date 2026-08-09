import { motion, useReducedMotion } from "motion/react";
import { lazy, useCallback, useState, type ReactNode } from "react";
import SidebarGitPanel from "@/features/git/components/SidebarGitPanel";
import FileTreePanel from "@/features/projects/FileTreePanel";
import type { ProfileSidebarMode } from "@/features/projects/SidebarModeSwitch";
import type { Profile } from "@/generated";
import {
	AsyncBoundary,
	LoadingError,
	LoadingSpinner,
} from "@/shared/components/Fallbacks";
import { useHorizontalResize } from "@/shared/hooks/useHorizontalResize";
import * as m from "@/paraglide/messages.js";

const ProfileNotesEditor = lazy(
	() => import("@/features/profiles/ProfileNotesEditor"),
);

const SIDEBAR_PANEL_TRANSITION = {
	type: "spring",
	stiffness: 320,
	damping: 34,
	mass: 0.9,
} as const;
const SIDEBAR_PANEL_MIN_WIDTH = 180;
const SIDEBAR_PANEL_MAX_WIDTH = 560;
const DEFAULT_SIDEBAR_PANEL_WIDTH = 208;
const SIDEBAR_PANEL_STORAGE_KEY = "file-tree-panel";

function clampSidebarPanelWidth(width: number) {
	return Math.min(
		SIDEBAR_PANEL_MAX_WIDTH,
		Math.max(SIDEBAR_PANEL_MIN_WIDTH, width),
	);
}

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
			? clampSidebarPanelWidth(width)
			: DEFAULT_SIDEBAR_PANEL_WIDTH;
	} catch {
		return DEFAULT_SIDEBAR_PANEL_WIDTH;
	}
}

function writeStoredSidebarPanelWidth(width: number) {
	try {
		window.localStorage.setItem(
			SIDEBAR_PANEL_STORAGE_KEY,
			JSON.stringify({ state: { panelWidth: width }, version: 2 }),
		);
	} catch {
		// Resizing should still work in-memory when storage is unavailable.
	}
}

function SidebarPanelContent({ children }: { children: ReactNode }) {
	return (
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
	const prefersReducedMotion = useReducedMotion() ?? false;
	const [panelWidth, setPanelWidth] = useState(readStoredSidebarPanelWidth);
	const updatePanelWidth = useCallback((width: number) => {
		const nextWidth = clampSidebarPanelWidth(width);
		setPanelWidth(nextWidth);
		writeStoredSidebarPanelWidth(nextWidth);
	}, []);
	const resize = useHorizontalResize({
		value: panelWidth,
		min: SIDEBAR_PANEL_MIN_WIDTH,
		max: SIDEBAR_PANEL_MAX_WIDTH,
		disabled: !isOpen,
		onChange: updatePanelWidth,
	});

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
					prefersReducedMotion || resize.isDragging
						? { duration: 0 }
						: SIDEBAR_PANEL_TRANSITION
				}
				className="relative flex h-full min-w-0 flex-col"
				style={{ overflow: "visible", willChange: "width" }}
			>
				{/* Keep the tree mounted across mode switches to preserve its UI state. */}
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
					<SidebarPanelContent>
						<SidebarGitPanel
							profileId={profile.id}
							worktreePath={profile.worktree_path}
						/>
					</SidebarPanelContent>
				)}

				{mode === "notes" && (
					<SidebarPanelContent>
						<div className="min-h-0 flex-1 overflow-hidden">
							<ProfileNotesEditor profile={profile} />
						</div>
					</SidebarPanelContent>
				)}

				{isOpen && (
					<div
						role="separator"
						aria-label={m.profileSidebarResizeSeparator()}
						aria-orientation="vertical"
						aria-valuemin={SIDEBAR_PANEL_MIN_WIDTH}
						aria-valuemax={SIDEBAR_PANEL_MAX_WIDTH}
						aria-valuenow={panelWidth}
						tabIndex={0}
						className="absolute top-0 -right-1 bottom-0 z-[1] w-2 cursor-col-resize focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)]"
						onPointerDown={resize.handlePointerDown}
						onKeyDown={resize.handleKeyDown}
					/>
				)}
			</motion.div>
		</div>
	);
}
