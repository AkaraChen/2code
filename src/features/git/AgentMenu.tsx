import { Button, Group, IconButton, Menu, Portal } from "@chakra-ui/react";
import { SiClaude, SiCursor } from "@icons-pack/react-simple-icons";
import type { ComponentType, ReactNode } from "react";
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

function AgentDropdown({
	agents,
	onSelect,
	trigger,
}: {
	agents: AgentStatusInfo[];
	onSelect: (agentId: string) => void;
	trigger: ReactNode;
}) {
	if (agents.length === 0) return null;
	return (
		<Menu.Root>
			<Menu.Trigger asChild>{trigger}</Menu.Trigger>
			<Portal>
				<Menu.Positioner>
					<Menu.Content>
						{agents.map((agent) => {
							const Icon = getAgentIcon(agent.id);
							return (
								<Menu.Item key={agent.id} value={agent.id} onClick={() => onSelect(agent.id)}>
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

export default function AgentMenu({ agents, profile, isPending, onCreateTab }: AgentMenuProps) {
	const defaultAgentId = useAgentSettingsStore((s) => s.defaultAgent);

	if (agents.length === 0) return null;

	const createWith = (agentId: string) =>
		onCreateTab({ type: "agent", profileId: profile.id, cwd: profile.worktree_path, agent: agentId });

	const defaultAgent = agents.find((a) => a.id === defaultAgentId);

	if (!defaultAgent) {
		return (
			<AgentDropdown
				agents={agents}
				onSelect={createWith}
				trigger={
					<Button size="xs" variant="subtle" disabled={isPending}>
						<RiRobot2Line />
						<RiAddLine />
					</Button>
				}
			/>
		);
	}

	const DefaultIcon = getAgentIcon(defaultAgent.id);
	const otherAgents = agents.filter((a) => a.id !== defaultAgentId);

	return (
		<Group attached>
			<Button size="xs" variant="subtle" disabled={isPending} onClick={() => createWith(defaultAgent.id)}>
				<DefaultIcon size={14} />
				<RiAddLine />
			</Button>
			<AgentDropdown
				agents={otherAgents}
				onSelect={createWith}
				trigger={
					<IconButton size="xs" variant="subtle" disabled={isPending} aria-label="Select agent">
						<RiArrowDownSLine />
					</IconButton>
				}
			/>
		</Group>
	);
}
