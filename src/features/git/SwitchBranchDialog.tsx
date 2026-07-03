import { useMemo, useState } from "react";
import { PiGitBranchFill } from "react-icons/pi";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { GitBranchInfo } from "@/generated";
import { cn } from "@/lib/utils";
import * as m from "@/paraglide/messages.js";
import { useCheckoutGitBranch, useGitBranches } from "./hooks";

interface SwitchBranchDialogProps {
	isOpen: boolean;
	onClose: () => void;
	profileId: string;
}

function BranchRow({
	branch,
	isPending,
	onCheckout,
}: {
	branch: GitBranchInfo;
	isPending: boolean;
	onCheckout: (branch: string) => void;
}) {
	const disabled = branch.is_current || branch.is_used || isPending;

	return (
		<button
			type="button"
			disabled={disabled}
			className={cn(
				"flex w-full min-w-0 select-none items-center gap-2 rounded-md px-3 py-2 text-left",
				branch.is_current
					? "bg-muted"
					: disabled
						? "opacity-60"
						: "hover:bg-muted/70",
			)}
			onClick={() => onCheckout(branch.name)}
		>
			<PiGitBranchFill className="size-3.5 shrink-0 text-muted-foreground" />
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-sm",
					branch.is_current && "font-medium",
				)}
			>
				{branch.name}
			</span>

			{branch.is_current && (
				<Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
					{m.branchCurrentLabel()}
				</Badge>
			)}
			{branch.is_trunk && (
				<Badge variant="outline" className="h-4 px-1.5 text-[10px]">
					{m.branchTrunkLabel()}
				</Badge>
			)}
			{branch.is_used && (
				<Badge
					variant="outline"
					className="h-4 border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-400"
				>
					{m.branchUsedLabel()}
				</Badge>
			)}

			{!branch.is_current && (branch.ahead > 0 || branch.behind > 0) && (
				<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
					{branch.ahead > 0 && (
						<span className="text-green-600 dark:text-green-500">
							↑{branch.ahead}
						</span>
					)}
					{branch.ahead > 0 && branch.behind > 0 && " "}
					{branch.behind > 0 && (
						<span className="text-red-600 dark:text-red-500">
							↓{branch.behind}
						</span>
					)}
				</span>
			)}
		</button>
	);
}

// Mounted only while the dialog is open — remounting resets the search query.
function SwitchBranchContent({
	onClose,
	profileId,
}: Pick<SwitchBranchDialogProps, "onClose" | "profileId">) {
	const { data: branches, isLoading } = useGitBranches(profileId);
	const checkoutBranch = useCheckoutGitBranch(profileId);
	const [query, setQuery] = useState("");

	const filteredBranches = useMemo(() => {
		if (!branches) return [];
		const needle = query.trim().toLowerCase();
		if (!needle) return branches;
		return branches.filter((branch) =>
			branch.name.toLowerCase().includes(needle),
		);
	}, [branches, query]);

	const handleCheckout = (branch: string) => {
		checkoutBranch.mutate(
			{ branch },
			{
				onSuccess: () => {
					toast.success(m.gitCheckoutSuccessTitle({ branch }));
					onClose();
				},
				onError: (error) => {
					toast.error(m.gitCheckoutErrorTitle(), {
						description:
							error instanceof Error ? error.message : String(error),
					});
				},
			},
		);
	};

	return (
		<>
			<DialogHeader className="border-b px-4 py-3">
				<DialogTitle className="text-sm">
					{m.switchBranchTitle()}
				</DialogTitle>
			</DialogHeader>

			<div className="px-3 py-2">
				<Input
					autoFocus
					className="h-8 text-sm"
					placeholder={m.searchBranchesPlaceholder()}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</div>

			<div className="max-h-[min(60dvh,24rem)] overflow-y-auto p-1.5 pt-0">
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<Spinner />
					</div>
				) : filteredBranches.length === 0 ? (
					<p className="py-8 text-center text-sm text-muted-foreground">
						{m.noBranchesFound()}
					</p>
				) : (
					filteredBranches.map((branch) => (
						<BranchRow
							key={branch.name}
							branch={branch}
							isPending={checkoutBranch.isPending}
							onCheckout={handleCheckout}
						/>
					))
				)}
			</div>
		</>
	);
}

export default function SwitchBranchDialog({
	isOpen,
	onClose,
	profileId,
}: SwitchBranchDialogProps) {
	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-w-md gap-0 p-0">
				{isOpen && (
					<SwitchBranchContent onClose={onClose} profileId={profileId} />
				)}
			</DialogContent>
		</Dialog>
	);
}
