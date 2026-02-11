import { Suspense } from "react";
import { RiGitBranchLine, RiGitPullRequestLine } from "react-icons/ri";
import { useGitBranch } from "@/hooks/useProjects";

function GitBranch({ cwd }: { cwd: string }) {
	const { data: branch } = useGitBranch(cwd);
	if (!branch) return null;
	return (
		<span className="flex items-center gap-1 opacity-60">
			<RiGitBranchLine />
			{branch}
		</span>
	);
}

interface ProjectTopBarProps {
	projectName: string;
	profileBranchName?: string;
	cwd: string;
}

export default function ProjectTopBar({
	projectName,
	profileBranchName,
	cwd,
}: ProjectTopBarProps) {
	return (
		<div className="flex items-center justify-between px-3 py-1 text-xs">
			<div className="flex items-center gap-2">
				<span className="font-medium">{projectName}</span>
				{profileBranchName ? (
					<span className="flex items-center gap-1 opacity-60">
						<RiGitBranchLine />
						{profileBranchName}
					</span>
				) : (
					<Suspense>
						<GitBranch cwd={cwd} />
					</Suspense>
				)}
			</div>
			<button
				type="button"
				className="opacity-40 hover:opacity-80 transition-opacity"
			>
				<RiGitPullRequestLine />
			</button>
		</div>
	);
}
