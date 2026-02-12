import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { RiGitCommitLine } from "react-icons/ri";
import type { GitCommit } from "@/generated";

function formatRelativeTime(isoDate: string): string {
	const now = Date.now();
	const then = new Date(isoDate).getTime();
	const diffSec = Math.floor((now - then) / 1000);

	if (diffSec < 60) return "just now";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 30) return `${diffDay}d ago`;
	const diffMonth = Math.floor(diffDay / 30);
	if (diffMonth < 12) return `${diffMonth}mo ago`;
	const diffYear = Math.floor(diffMonth / 12);
	return `${diffYear}y ago`;
}

export interface CommitListProps {
	commits: GitCommit[];
	onCommitSelect: (commit: GitCommit) => void;
}

export default function CommitList({
	commits,
	onCommitSelect,
}: CommitListProps) {
	return (
		<Box flex="1" overflowY="auto" minH="0">
			{commits.map((commit) => (
				<VStack
					key={commit.full_hash}
					align="stretch"
					px="3"
					py="1.5"
					cursor="pointer"
					_hover={{ bg: "bg.muted" }}
					onClick={() => onCommitSelect(commit)}
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
								{commit.files_changed === 1 ? "file" : "files"}
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
