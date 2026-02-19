import {
	Badge,
	Button,
	Card,
	HStack,
	Separator,
	Text,
	VStack,
} from "@chakra-ui/react";
import { match } from "ts-pattern";
import type { AgentStatusInfo } from "@/generated/types";
import * as m from "@/paraglide/messages.js";
import { AGENT_META } from "../constants/agentMeta";
import { useAgentInstall } from "../hooks/useAgentInstall";

interface AgentCardProps {
	agent: AgentStatusInfo;
}

/**
 * Agent 卡片
 * 显示单个 Agent 的安装状态和详细信息
 */
export function AgentCard({ agent }: AgentCardProps) {
	const { mutate: install, isPending } = useAgentInstall();
	const meta = AGENT_META[agent.id];

	const { statusColor, statusLabel } = match(agent)
		.with({ ready: true }, () => ({
			statusColor: "green",
			statusLabel: m.agentReady(),
		}))
		.with({ native_required: true, native_installed: false }, () => ({
			statusColor: "red",
			statusLabel: m.agentNativeNotInstalled(),
		}))
		.with({ acp_installed: true }, () => ({
			statusColor: "yellow",
			statusLabel: m.agentPartial(),
		}))
		.otherwise(() => ({
			statusColor: "gray",
			statusLabel: m.agentNotInstalled(),
		}));

	const statusBadge = (
		<Badge colorPalette={statusColor} variant="subtle" size="sm">
			{statusLabel}
		</Badge>
	);

	return (
		<Card.Root size="sm">
			<Card.Body>
				<VStack align="stretch" gap="3">
					<HStack justify="space-between">
						<HStack gap="2">
							<Text fontWeight="semibold">
								{agent.display_name}
							</Text>
							{meta && (
								<Badge
									variant="outline"
									size="sm"
									colorPalette="gray"
								>
									{meta.provider()}
								</Badge>
							)}
						</HStack>
						{statusBadge}
					</HStack>

					{meta && (
						<Text fontSize="xs" color="fg.muted">
							{meta.description()}
						</Text>
					)}

					<Separator />

					<HStack justify="space-between">
						<HStack gap="4">
							<HStack gap="1.5">
								<Text fontSize="xs" color="fg.muted">
									{m.agentNativeCli()}
								</Text>
								{!agent.native_required ? (
									<Text fontSize="xs" color="fg.muted">
										{m.agentNativeNotRequired()}
									</Text>
								) : (
									<Badge
										size="sm"
										variant="subtle"
										colorPalette={
											agent.native_installed
												? "green"
												: "red"
										}
									>
										{agent.native_version ??
											m.agentNotInstalled()}
									</Badge>
								)}
							</HStack>
							<Separator orientation="vertical" height="3" />
							<HStack gap="1.5">
								<Text fontSize="xs" color="fg.muted">
									{m.agentAcpBridge()}
								</Text>
								<Badge
									size="sm"
									variant="subtle"
									colorPalette={
										agent.acp_installed ? "green" : "gray"
									}
								>
									{agent.acp_version ?? m.agentNotInstalled()}
								</Badge>
							</HStack>
						</HStack>
						{(!agent.native_required || agent.native_installed) && (
							<Button
								size="xs"
								variant="outline"
								loading={isPending}
								onClick={() =>
									install({
										id: agent.id,
										displayName: agent.display_name,
									})
								}
							>
								{agent.acp_installed
									? m.agentReinstall()
									: m.agentInstall()}
							</Button>
						)}
					</HStack>
				</VStack>
			</Card.Body>
		</Card.Root>
	);
}
