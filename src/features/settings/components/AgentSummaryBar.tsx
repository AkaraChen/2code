import {
	Card,
	HStack,
	ProgressCircle,
	Separator,
	Status,
	Text,
} from "@chakra-ui/react";
import type { AgentStatusInfo, CredentialEntry } from "@/generated/types";
import * as m from "@/paraglide/messages.js";

interface AgentSummaryBarProps {
	agents: AgentStatusInfo[];
	anthropic: CredentialEntry | null | undefined;
	openai: CredentialEntry | null | undefined;
}

/**
 * Agent 概览统计栏
 * 显示就绪状态进度和凭证检测结果
 */
export function AgentSummaryBar({
	agents,
	anthropic,
	openai,
}: AgentSummaryBarProps) {
	const readyCount = agents.filter((a) => a.ready).length;
	const total = agents.length;
	const percent = total > 0 ? (readyCount / total) * 100 : 0;

	return (
		<Card.Root variant="subtle" size="sm">
			<Card.Body>
				<HStack gap="4">
					<ProgressCircle.Root
						size="sm"
						value={percent}
						colorPalette={readyCount === total ? "green" : "blue"}
					>
						<ProgressCircle.Circle>
							<ProgressCircle.Track />
							<ProgressCircle.Range strokeLinecap="round" />
						</ProgressCircle.Circle>
					</ProgressCircle.Root>
					<Text fontSize="sm" fontWeight="medium">
						{m.agentSummary({
							ready: String(readyCount),
							total: String(total),
						})}
					</Text>
					<Separator orientation="vertical" height="4" />
					<HStack gap="3">
						<Status.Root
							colorPalette={anthropic ? "green" : "gray"}
						>
							<Status.Indicator />
							{m.agentProviderAnthropic()}
						</Status.Root>
						<Status.Root colorPalette={openai ? "green" : "gray"}>
							<Status.Indicator />
							{m.agentProviderOpenAI()}
						</Status.Root>
					</HStack>
				</HStack>
			</Card.Body>
		</Card.Root>
	);
}
