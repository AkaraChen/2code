import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { memo } from "react";
import { RiGitCommitLine } from "react-icons/ri";
import { P, match } from "ts-pattern";
import type { GitCommit } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useScrollIntoView } from "@/shared/hooks/useScrollIntoView";

function formatRelativeTime(isoDate: string): string {
	const now = Date.now();
	const then = new Date(isoDate).getTime();
	const diffSec = Math.floor((now - then) / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHr = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHr / 24);
	const diffMonth = Math.floor(diffDay / 30);
	const diffYear = Math.floor(diffMonth / 12);

	return match(diffSec)
		.with(P.when((s) => s < 60), () => m.timeJustNow())
		.with(P.when(() => diffMin < 60), () => m.timeMinutesAgo({ n: String(diffMin) }))
		.with(P.when(() => diffHr < 24), () => m.timeHoursAgo({ n: String(diffHr) }))
		.with(P.when(() => diffDay < 30), () => m.timeDaysAgo({ n: String(diffDay) }))
		.with(P.when(() => diffMonth < 12), () => m.timeMonthsAgo({ n: String(diffMonth) }))
		.otherwise(() => m.timeYearsAgo({ n: String(diffYear) }));
}

interface CommitItemProps {
	commit: GitCommit;
	index: number;
	isSelected: boolean;
	onSelect: (commit: GitCommit, index: number) => void;
}

const CommitItem = memo(({
	commit,
	index,
	isSelected,
	onSelect,
}: CommitItemProps) => {
	return (
		<VStack
			data-index={index}
			align="stretch"
			px="3"
			py="1.5"
			cursor="pointer"
			bg={isSelected ? "bg.emphasized" : "transparent"}
			_hover={{ bg: isSelected ? "bg.emphasized" : "bg.muted" }}
			onClick={() => onSelect(commit, index)}
			gap="0.5"
			userSelect="none"
		>
			<Text fontSize="sm" lineClamp={1}>
				{commit.message}
			</Text>
			<HStack gap="2" fontSize="xs" color="fg.muted">
				<HStack gap="1">
					<Icon fontSize="xs">
						<RiGitCommitLine />
					</Icon>
					<Text fontFamily="mono">{commit.hash}</Text>
				</HStack>
				<Text truncate flex="1">
					{commit.author.name}
				</Text>
				<Text flexShrink={0}>
					{formatRelativeTime(commit.date)}
				</Text>
			</HStack>
			<HStack gap="2" fontSize="xs">
				{commit.files_changed > 0 && (
					<Text color="fg.muted">
						{commit.files_changed}{" "}
						{commit.files_changed === 1
							? m.fileChanged()
							: m.filesChanged()}
					</Text>
				)}
				{commit.insertions > 0 && (
					<Text color="green.solid">
						+{commit.insertions}
					</Text>
				)}
				{commit.deletions > 0 && (
					<Text color="red.solid">-{commit.deletions}</Text>
				)}
			</HStack>
		</VStack>
	);
});

interface CommitListProps {
	commits: GitCommit[];
	selectedIndex: number;
	onCommitSelect: (commit: GitCommit, index: number) => void;
}

export default function CommitList({
	commits,
	selectedIndex,
	onCommitSelect,
}: CommitListProps) {
	const { ref: containerRef } =
		useScrollIntoView<HTMLDivElement>(selectedIndex);

	return (
		<Box ref={containerRef} flex="1" overflowY="auto" minH="0">
			{commits.map((commit, index) => (
				<CommitItem
					key={commit.full_hash}
					commit={commit}
					index={index}
					isSelected={selectedIndex === index}
					onSelect={onCommitSelect}
				/>
			))}
		</Box>
	);
}
