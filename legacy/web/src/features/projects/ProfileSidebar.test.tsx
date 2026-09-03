import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/generated";
import ProfileSidebar from "./ProfileSidebar";

vi.mock("@/features/git/components/SidebarGitPanel", () => ({
	default: () => <div>Git panel</div>,
}));

vi.mock("@/features/profiles/ProfileNotesEditor", () => ({
	default: () => <div>Notes panel</div>,
}));

vi.mock("./FileTreePanel", () => ({
	default: () => <div>File tree</div>,
}));

const profile: Profile = {
	id: "profile-1",
	project_id: "project-1",
	branch_name: "main",
	worktree_path: "/tmp/project",
	created_at: "2026-08-09T00:00:00Z",
	is_default: true,
	notes: "",
};

describe("profileSidebar", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it.each(["files", "git", "notes"] as const)(
		"exposes the shared resize separator in %s mode",
		(mode) => {
			render(
				<ProfileSidebar
					profile={profile}
					mode={mode}
					isOpen
					isActive
					onOpenFile={vi.fn()}
				/>,
			);

			const separator = screen.getByRole("separator", {
				name: "Resize sidebar",
			});
			expect(separator).toHaveAttribute("aria-valuenow", "208");

			fireEvent.keyDown(separator, { key: "ArrowRight" });

			expect(separator).toHaveAttribute("aria-valuenow", "224");
			expect(JSON.parse(window.localStorage.getItem("file-tree-panel") ?? ""))
				.toMatchObject({ state: { panelWidth: 224 } });
		},
	);
});
