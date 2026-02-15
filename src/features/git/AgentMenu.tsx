import { Button, Menu, Portal } from "@chakra-ui/react";
import { SiClaude, SiCursor } from "@icons-pack/react-simple-icons";
import type { ComponentType } from "react";
import { RiAddLine, RiRobot2Line } from "react-icons/ri";
import { SiOpenai } from "react-icons/si";
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
	if (agents.length === 0) return null;

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
									onClick={() =>
										onCreateTab({
											type: "agent",
											profileId: profile.id,
											cwd: profile.worktree_path,
											agent: agent.id,
										})
									}
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
