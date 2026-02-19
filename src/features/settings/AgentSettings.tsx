import {
	Portal,
	Select,
	Stack,
	Text,
	createListCollection,
} from "@chakra-ui/react";
import { useMemo } from "react";
import * as m from "@/paraglide/messages.js";
import { AgentCard } from "./components/AgentCard";
import { AgentSummaryBar } from "./components/AgentSummaryBar";
import { CredentialSection } from "./components/CredentialSection";
import { useAgentStatus, useCredentials } from "./hooks/useAgentData";
import { useAgentSettingsStore } from "./stores/agentSettingsStore";

export function AgentSettings() {
	const { data: agents } = useAgentStatus();
	const { data: credentials } = useCredentials();
	const defaultAgent = useAgentSettingsStore((s) => s.defaultAgent);
	const setDefaultAgent = useAgentSettingsStore((s) => s.setDefaultAgent);

	const collection = useMemo(
		() =>
			createListCollection({
				items: agents.map((agent) => ({
					label: agent.display_name,
					value: agent.id,
					disabled: !agent.ready,
				})),
			}),
		[agents],
	);

	return (
		<Stack gap="6" maxW="2xl">
			<AgentSummaryBar
				agents={agents}
				anthropic={credentials.anthropic}
				openai={credentials.openai}
			/>

			<Stack gap="2">
				<Text fontWeight="semibold" fontSize="sm">
					{m.defaultAgent()}
				</Text>
				<Text fontSize="xs" color="fg.muted">
					{m.defaultAgentDescription()}
				</Text>
				<Select.Root
					collection={collection}
					size="sm"
					maxW="xs"
					value={[defaultAgent]}
					onValueChange={(e) => setDefaultAgent(e.value[0])}
				>
					<Select.HiddenSelect />
					<Select.Control>
						<Select.Trigger>
							<Select.ValueText placeholder={m.defaultAgentNone()} />
						</Select.Trigger>
						<Select.IndicatorGroup>
							<Select.Indicator />
						</Select.IndicatorGroup>
					</Select.Control>
					<Portal>
						<Select.Positioner>
							<Select.Content>
								{collection.items.map((item) => (
									<Select.Item item={item} key={item.value}>
										{item.label}
										<Select.ItemIndicator />
									</Select.Item>
								))}
							</Select.Content>
						</Select.Positioner>
					</Portal>
				</Select.Root>
			</Stack>

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
