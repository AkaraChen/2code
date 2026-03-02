import { Button, Group, IconButton, Menu, Portal } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { RiAddLine, RiArrowDownSLine } from "react-icons/ri";
import { useSettingsStore } from "@/features/settings/stores";
import type { MarketplaceAgent, Profile } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { AgentIcon } from "@/shared/components/AgentIcon";

function AgentDropdown({
	agents,
	onSelect,
	trigger,
}: {
	agents: MarketplaceAgent[];
	onSelect: (agent: MarketplaceAgent) => void;
	trigger: ReactNode;
}) {
	const navigate = useNavigate();
	return (
		<Menu.Root>
			<Menu.Trigger asChild>{trigger}</Menu.Trigger>
			<Portal>
				<Menu.Positioner>
					<Menu.Content>
						{agents.map((agent) => (
							<Menu.Item key={agent.id} value={agent.id} onClick={() => onSelect(agent)}>
								<AgentIcon iconUrl={agent.icon_url} size={16} />
								{agent.name}
							</Menu.Item>
						))}
						{agents.length > 0 && <Menu.Separator />}
						<Menu.Item value="__marketplace__" onClick={() => navigate("/assets")}>
							<RiAddLine />
							{m.addAgent()}
						</Menu.Item>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu.Root>
	);
}

interface AgentMenuProps {
	agents: MarketplaceAgent[];
	profile: Profile;
	isPending: boolean;
	onCreateTab: (params: {
		type: "agent";
		profileId: string;
		cwd: string;
		agent: string;
		agentName: string;
		iconUrl?: string | null;
	}) => void;
}

export default function AgentMenu({ agents, profile, isPending, onCreateTab }: AgentMenuProps) {
	const navigate = useNavigate();
	const defaultAgent = useSettingsStore((s) => s.defaultAgent);

	const createWith = (agent: MarketplaceAgent) =>
		onCreateTab({
			type: "agent",
			profileId: profile.id,
			cwd: profile.worktree_path,
			agent: agent.id,
			agentName: agent.name,
			iconUrl: agent.icon_url,
		});

	// 0 agents: show "Add Agent" button
	if (agents.length === 0) {
		return (
			<Button
				size="xs"
				variant="subtle"
				aria-label={m.addAgent()}
				onClick={() => navigate("/assets")}
			>
				<AgentIcon />
				<RiAddLine />
			</Button>
		);
	}

	// Determine which agent is the "primary" action button:
	// prefer stored default, fall back to first agent (covers the 1-agent case)
	const primaryAgent =
		agents.find((a) => a.id === defaultAgent) ?? agents[0];
	const otherAgents = agents.filter((a) => a.id !== primaryAgent.id);

	return (
		<Group attached>
			<Button
				size="xs"
				variant="subtle"
				disabled={isPending}
				aria-label={primaryAgent.name}
				onClick={() => createWith(primaryAgent)}
			>
				<AgentIcon iconUrl={primaryAgent.icon_url} size={14} />
			</Button>
			<AgentDropdown
				agents={otherAgents}
				onSelect={createWith}
				trigger={
					<IconButton size="xs" variant="subtle" disabled={isPending} aria-label={m.agentSelect()}>
						<RiArrowDownSLine />
					</IconButton>
				}
			/>
		</Group>
	);
}
