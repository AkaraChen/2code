import { FolderSimpleIcon, GitBranchIcon, NoteIcon } from "@phosphor-icons/react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGitDiffStats } from "@/features/git/hooks";
import * as m from "@/paraglide/messages.js";

export type ProfileSidebarMode = "files" | "git" | "notes";

const MODE_ITEMS = [
	{ value: "files", icon: FolderSimpleIcon, label: m.sidebarFilesTab },
	{ value: "git", icon: GitBranchIcon, label: m.sidebarGitTab },
	{ value: "notes", icon: NoteIcon, label: m.notes },
] as const;

interface SidebarModeSwitchProps {
	profileId: string;
	isActive?: boolean;
	isOpen?: boolean;
	mode: ProfileSidebarMode;
	onModeChange: (mode: ProfileSidebarMode) => void;
}

export default function SidebarModeSwitch({
	profileId,
	isActive = false,
	isOpen = true,
	mode,
	onModeChange,
}: SidebarModeSwitchProps) {
	const diffStats = useGitDiffStats(profileId, isActive);

	return (
		<Tabs
			value={isOpen ? mode : null}
			onValueChange={(value) => {
				if (value != null) onModeChange(value as ProfileSidebarMode);
			}}
		>
			<TabsList className="h-7">
				{MODE_ITEMS.map(({ value, icon: Icon, label }) => (
					<Tooltip key={value}>
						<TooltipTrigger
							render={(
								<TabsTrigger
									value={value}
									aria-label={label()}
									className="px-2"
									onClick={() => onModeChange(value)}
								/>
							)}
						>
							<Icon className="size-3.5" />
							{value === "git" && diffStats && (
								<>
									<span className="text-xs text-green-500">
										+{diffStats.additions}
									</span>
									<span className="text-xs text-red-500">
										-{diffStats.deletions}
									</span>
								</>
							)}
						</TooltipTrigger>
						<TooltipContent>{label()}</TooltipContent>
					</Tooltip>
				))}
			</TabsList>
		</Tabs>
	);
}
