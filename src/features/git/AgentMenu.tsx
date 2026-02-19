import { Button, Group, IconButton, Menu, Portal } from "@chakra-ui/react";
import { SiClaude, SiCursor } from "@icons-pack/react-simple-icons";
import type { ComponentType } from "react";
import { RiAddLine, RiArrowDownSLine, RiRobot2Line } from "react-icons/ri";
import { SiOpenai } from "react-icons/si";
import { useAgentSettingsStore } from "@/features/settings/stores/agentSettingsStore";
import type { AgentStatusInfo, Profile } from "@/generated";

const AGENT_ICONS: Record<string, ComponentType<{ size?: number }>> = {
	claude: SiClaude,
	cursor: SiCursor,
	codex: SiOpenai,
};

function getAgentIcon(agentId: string) {
	return AGENT_ICONS[agentId] ?? RiRobot2Line;
}

interface AgentMenuProps {
	agents: AgentStatusInfo[];
	profile: Profile;
	isPending: boolean;
	onCreateTab: (params: {
		type: "agent";
		profileId: string;
		cwd: string;
		agent: string;
	}) => void;
}

export default function AgentMenu({
	agents,
	profile,
	isPending,
	onCreateTab,
}: AgentMenuProps) {
	const defaultAgentId = useAgentSettingsStore((s) => s.defaultAgent);

	if (agents.length === 0) return null;

	const defaultAgent = agents.find((a) => a.id === defaultAgentId);

	const createWith = (agentId: string) =>
		onCreateTab({
			type: "agent",
			profileId: profile.id,
			cwd: profile.worktree_path,
			agent: agentId,
		});

	// If no default agent is ready, fall back to dropdown-only
	if (!defaultAgent) {
		return (
			<Menu.Root>
				<Menu.Trigger asChild>
					<Button size="xs" variant="subtle" disabled={isPending}>
						<RiRobot2Line />
						<RiAddLine />
					</Button>
				</Menu.Trigger>
				<Portal>
					<Menu.Positioner>
						<Menu.Content>
							{agents.map((agent) => {
								const Icon = getAgentIcon(agent.id);
								return (
									<Menu.Item
										key={agent.id}
										value={agent.id}
										onClick={() => createWith(agent.id)}
									>
										<Icon size={16} />
										{agent.display_name}
									</Menu.Item>
								);
							})}
						</Menu.Content>
					</Menu.Positioner>
				</Portal>
			</Menu.Root>
		);
	}

	const DefaultIcon = getAgentIcon(defaultAgent.id);
	const otherAgents = agents.filter((a) => a.id !== defaultAgentId);

	return (
		<Group attached>
			<Button
				size="xs"
				variant="subtle"
				disabled={isPending}
				onClick={() => createWith(defaultAgent.id)}
			>
				<DefaultIcon size={14} />
				<RiAddLine />
			</Button>
			{otherAgents.length > 0 && (
				<Menu.Root>
					<Menu.Trigger asChild>
						<IconButton
							size="xs"
							variant="subtle"
							disabled={isPending}
							aria-label="Select agent"
						>
							<RiArrowDownSLine />
						</IconButton>
					</Menu.Trigger>
					<Portal>
						<Menu.Positioner>
							<Menu.Content>
								{otherAgents.map((agent) => {
									const Icon = getAgentIcon(agent.id);
									return (
										<Menu.Item
											key={agent.id}
											value={agent.id}
											onClick={() => createWith(agent.id)}
										>
											<Icon size={16} />
											{agent.display_name}
										</Menu.Item>
									);
								})}
							</Menu.Content>
						</Menu.Positioner>
					</Portal>
				</Menu.Root>
			)}
		</Group>
	);
}
