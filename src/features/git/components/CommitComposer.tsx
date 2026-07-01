import { useId } from "react";
import { FiUpload } from "react-icons/fi";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import * as m from "@/paraglide/messages.js";

interface CommitComposerProps {
	commitMessage: string;
	commitBody: string;
	includedCount: number;
	totalCount: number;
	isPending: boolean;
	aheadCount: number;
	isPushing: boolean;
	onMessageChange: (value: string) => void;
	onBodyChange: (value: string) => void;
	onSubmit: () => void;
	onPush: () => void;
}

export default function CommitComposer({
	commitMessage,
	commitBody,
	includedCount,
	totalCount,
	isPending,
	aheadCount,
	isPushing,
	onMessageChange,
	onBodyChange,
	onSubmit,
	onPush,
}: CommitComposerProps) {
	const summaryId = useId();
	const bodyId = useId();
	const isDisabled = totalCount === 0;
	const canSubmit =
		!isDisabled && includedCount > 0 && commitMessage.trim().length > 0;

	const handleSubmitKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
			event.preventDefault();
			onSubmit();
		}
	};

	return (
		<div className="shrink-0 border-t px-2.5 py-2">
			<div className="flex flex-col gap-2">
				<p className="text-xs font-medium uppercase text-muted-foreground">
					{m.gitCommitSectionTitle()}
				</p>

				<Field>
					<FieldLabel htmlFor={summaryId} className="text-xs">
						{m.gitCommitSummary()}
					</FieldLabel>
					<Input
						id={summaryId}
						className="h-7 text-xs"
						value={commitMessage}
						disabled={isDisabled}
						placeholder={m.gitCommitSummaryPlaceholder()}
						onChange={(event) => onMessageChange(event.target.value)}
						onKeyDown={handleSubmitKeyDown}
					/>
				</Field>

				<Field>
					<FieldLabel htmlFor={bodyId} className="text-xs">
						{m.gitCommitBody()}
					</FieldLabel>
					<Textarea
						id={bodyId}
						className="min-h-[4.5rem] resize-y text-xs"
						rows={3}
						value={commitBody}
						disabled={isDisabled}
						placeholder={m.gitCommitBodyPlaceholder()}
						onChange={(event) => onBodyChange(event.target.value)}
						onKeyDown={handleSubmitKeyDown}
					/>
				</Field>

				<div className="flex items-center justify-between gap-2">
					{isDisabled ? (
						<p className="flex-1 text-xs leading-snug text-muted-foreground">
							{m.gitCommitShortcutHint()}
						</p>
					) : (
						<p className="flex-1 text-xs leading-snug text-muted-foreground">
							{m.gitCommitIncludedCount({
								includedCount,
								totalCount,
							})}
							{" • "}
							{m.gitCommitShortcutHint()}
						</p>
					)}

					{isDisabled ? (
						<Button
							size="xs"
							className="shrink-0"
							disabled={isPushing || aheadCount === 0}
							onClick={onPush}
						>
							{aheadCount > 0 && (
								<span>
									{aheadCount}
								</span>
							)}
							{isPushing ? <Spinner className="size-3" /> : <FiUpload />}
							{m.gitPushButton()}
						</Button>
					) : (
						<Button
							size="xs"
							className="shrink-0"
							disabled={!canSubmit || isPending}
							onClick={onSubmit}
						>
							{isPending ? <Spinner className="size-3" /> : null}
							{m.gitCommitButton()}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
