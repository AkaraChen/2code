import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { RiGitCommitLine } from "react-icons/ri";
import type { GitCommit } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useScrollIntoView } from "@/shared/hooks/useScrollIntoView";

function formatRelativeTime(isoDate: string): string {
	const now = Date.now();
	const then = new Date(isoDate).getTime();
	const diffSec = Math.floor((now - then) / 1000);

	if (diffSec < 60) return m.timeJustNow();
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return m.timeMinutesAgo({ n: String(diffMin) });
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return m.timeHoursAgo({ n: String(diffHr) });
	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 30) return m.timeDaysAgo({ n: String(diffDay) });
	const diffMonth = Math.floor(diffDay / 30);
	if (diffMonth < 12) return m.timeMonthsAgo({ n: String(diffMonth) });
	const diffYear = Math.floor(diffMonth / 12);
	return m.timeYearsAgo({ n: String(diffYear) });
}

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
				<VStack
					key={commit.full_hash}
					data-index={index}
					align="stretch"
					px="3"
					py="1.5"
					cursor="pointer"
					bg={
						selectedIndex === index
							? "bg.emphasized"
							: "transparent"
					}
					_hover={{
						bg:
							selectedIndex === index
								? "bg.emphasized"
								: "bg.muted",
					}}
					onClick={() => onCommitSelect(commit, index)}
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
			))}
		</Box>
	);
}
