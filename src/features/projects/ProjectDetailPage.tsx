import { useMemo } from "react";
import { FiChevronDown, FiPlus, FiTerminal } from "react-icons/fi";
import { Navigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import ProfileLayout from "@/features/projects/ProfileLayout";
import { useProject, useProjectProfiles } from "@/features/projects/hooks";
import { useTerminalStore } from "@/features/terminal/store";
import { TerminalTemplateDropdownContent } from "@/features/terminal/TerminalTemplateMenu";
import { useTerminalTemplateActions } from "@/features/terminal/terminalTemplateActions";
import TerminalTabs from "@/features/terminal/TerminalTabs";
import * as m from "@/paraglide/messages.js";

export default function ProjectDetailPage() {
	const { id, profileId } = useParams<{
		id: string;
		profileId: string;
	}>();
	const project = useProject(id!);
	const profiles = useProjectProfiles(id!);
	const profile = useMemo(
		() => profiles.find((p) => p.id === profileId),
		[profiles, profileId],
	);

	const hasTabs = useTerminalStore(
		(s) => (s.profiles[profileId ?? ""]?.tabs.length ?? 0) > 0,
	);
	const hasFileTabs = useFileViewerTabsStore(
		(s) => (s.profiles[profileId ?? ""]?.tabs.length ?? 0) > 0,
	);
	const terminalTemplateActions = useTerminalTemplateActions({
		profileId: profile?.id ?? "",
		cwd: profile?.worktree_path ?? "",
		projectId: project?.id ?? "",
	});
	const { createTab, hasTemplates } = terminalTemplateActions;

	if (!project) {
		return <Navigate to="/" replace />;
	}

	if (!profile) {
		const fallbackProfile =
			profiles.find((item) => item.is_default) ?? profiles[0];

		if (fallbackProfile) {
			return (
				<Navigate
					to={`/projects/${project.id}/profiles/${fallbackProfile.id}`}
					replace
				/>
			);
		}

		return <Navigate to="/" replace />;
	}

	const shouldRenderEmptyState = !hasTabs && !hasFileTabs;
	const emptyTerminalState = (
		<div className="flex h-full items-center justify-center">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<FiTerminal />
					</EmptyMedia>
					<EmptyTitle>{m.noTerminalsOpen()}</EmptyTitle>
					<EmptyDescription>
						{m.noTerminalsOpenDescription()}
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<div className="flex">
						<Button
							disabled={createTab.isPending}
							className={hasTemplates ? "rounded-r-none" : undefined}
							onClick={terminalTemplateActions.createDefaultTerminal}
						>
							<FiPlus />
							{m.newTerminal()}
						</Button>
						{hasTemplates ? (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											disabled={createTab.isPending}
											className="-ml-px rounded-l-none"
											size="icon"
											aria-label="Choose template"
										/>
									}
								>
									<FiChevronDown />
								</DropdownMenuTrigger>
								<DropdownMenuContent className="min-w-56 p-1">
									<TerminalTemplateDropdownContent
										projectTemplates={
											terminalTemplateActions.projectTemplates
										}
										globalTemplates={
											terminalTemplateActions.globalTemplates
										}
										isPending={
											terminalTemplateActions.createTab.isPending
										}
										showEmptyState={false}
										onTemplateClick={(template, scope) => {
											void terminalTemplateActions
												.createTemplateTerminal(template, scope);
										}}
									/>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</div>
				</EmptyContent>
			</Empty>
		</div>
	);

	return (
		<>
			{shouldRenderEmptyState ? (
				<ProfileLayout
					projectId={project.id}
					projectName={project.name}
					profile={profile}
					isActive
				>
					<TerminalTabs
						projectId={project.id}
						profileId={profile.id}
						cwd={profile.worktree_path}
						profile={profile}
						isActive
						emptyFallback={emptyTerminalState}
					/>
				</ProfileLayout>
			) : null}
		</>
	);
}
