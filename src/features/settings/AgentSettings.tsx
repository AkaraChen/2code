import { Stack, Text } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { AgentCard } from "./components/AgentCard";
import { AgentSummaryBar } from "./components/AgentSummaryBar";
import { CredentialSection } from "./components/CredentialSection";
import { useAgentStatus, useCredentials } from "./hooks/useAgentData";

/**
 * Agent 设置页面
 * 显示 Agent 状态、凭证检测和安装管理
 */
export function AgentSettings() {
	const { data: agents } = useAgentStatus();
	const { data: credentials } = useCredentials();

	return (
		<Stack gap="6" maxW="2xl">
			<AgentSummaryBar
				agents={agents}
				anthropic={credentials.anthropic}
				openai={credentials.openai}
			/>

			<CredentialSection
				anthropic={credentials.anthropic}
				openai={credentials.openai}
			/>

			<Stack gap="2">
				<Text fontWeight="semibold" fontSize="sm">
					{m.agents()}
				</Text>
				<Stack gap="3">
					{agents.map((agent) => (
						<AgentCard key={agent.id} agent={agent} />
					))}
				</Stack>
			</Stack>
		</Stack>
	);
}
