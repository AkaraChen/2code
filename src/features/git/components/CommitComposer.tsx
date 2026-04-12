import {
	Box,
	Button,
	Field,
	Input,
	Text,
	Textarea,
	VStack,
} from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";

interface CommitComposerProps {
	commitMessage: string;
	commitBody: string;
	includedCount: number;
	totalCount: number;
	isPending: boolean;
	onMessageChange: (value: string) => void;
	onBodyChange: (value: string) => void;
	onSubmit: () => void;
}

export default function CommitComposer({
	commitMessage,
	commitBody,
	includedCount,
	totalCount,
	isPending,
	onMessageChange,
	onBodyChange,
	onSubmit,
}: CommitComposerProps) {
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
		<Box
			flexShrink={0}
			borderTopWidth="1px"
			borderColor="border.subtle"
			bg="bg"
			px="3"
			py="3"
		>
			<VStack align="stretch" gap="3">
				<Text
					fontSize="xs"
					fontWeight="medium"
					letterSpacing="widest"
					textTransform="uppercase"
					color="fg.muted"
				>
					{m.gitCommitSectionTitle()}
				</Text>

				<Field.Root required>
					<Field.Label>{m.gitCommitSummary()}</Field.Label>
					<Input
						size="sm"
						value={commitMessage}
						disabled={isDisabled}
						placeholder={m.gitCommitSummaryPlaceholder()}
						onChange={(event) => onMessageChange(event.target.value)}
						onKeyDown={handleSubmitKeyDown}
					/>
				</Field.Root>

				<Field.Root>
					<Field.Label>{m.gitCommitBody()}</Field.Label>
					<Textarea
						size="sm"
						rows={4}
						value={commitBody}
						disabled={isDisabled}
						placeholder={m.gitCommitBodyPlaceholder()}
						onChange={(event) => onBodyChange(event.target.value)}
						onKeyDown={handleSubmitKeyDown}
						resize="vertical"
					/>
				</Field.Root>

				<Text fontSize="xs" color="fg.muted">
					{m.gitCommitIncludedCount({
						includedCount,
						totalCount,
					})}
					{" • "}
					{m.gitCommitShortcutHint()}
				</Text>

				<Button
					size="sm"
					width="full"
					loading={isPending}
					disabled={!canSubmit || isPending}
					onClick={onSubmit}
				>
					{m.gitCommitButton()}
				</Button>
			</VStack>
		</Box>
	);
}
