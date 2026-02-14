import { Box, Circle, CloseButton, Flex, HStack, Tabs } from "@chakra-ui/react";
import { RiRobot2Line, RiTerminalBoxLine } from "react-icons/ri";
import { useShallow } from "zustand/react/shallow";
import { AgentChat } from "@/features/agent/AgentChat";
import { useCloseTab } from "@/features/tabs/hooks";
import { useTabStore } from "@/features/tabs/store";
import { Terminal } from "./Terminal";

interface TerminalTabsProps {
	profileId: string;
}

export default function TerminalTabs({ profileId }: TerminalTabsProps) {
	const { tabs, activeTabId } = useTabStore(
		useShallow(
			(s) => s.profiles[profileId] ?? { tabs: [], activeTabId: null },
		),
	);
	const notifiedTabs = useTabStore((s) => s.notifiedTabs);
	const setActiveTab = useTabStore((s) => s.setActiveTab);
	const closeTab = useCloseTab();

	if (tabs.length === 0) return null;

	return (
		<Flex direction="column" h="full" w="full">
			<Tabs.Root
				size="sm"
				value={activeTabId}
				onValueChange={(e) => setActiveTab(profileId, e.value)}
			>
				<Tabs.List>
					{tabs.map((tab) => (
						<Tabs.Trigger key={tab.id} value={tab.id}>
							{tab.type === "agent" ? (
								<RiRobot2Line />
							) : (
								<RiTerminalBoxLine />
							)}
							<HStack gap="2">
								{tab.title}
								{notifiedTabs.has(tab.id) &&
									tab.id !== activeTabId && (
										<Circle size="2" bg="green.500" />
									)}
								<CloseButton
									as="span"
									role="button"
									size="2xs"
									onClick={(e) => {
										e.stopPropagation();
										closeTab.mutate({
											profileId,
											tabId: tab.id,
										});
									}}
								/>
							</HStack>
						</Tabs.Trigger>
					))}
				</Tabs.List>
			</Tabs.Root>

			{/* Content area — all tabs stay mounted, hidden via CSS */}
			<Box flex="1" minH="0" position="relative">
				{tabs.map((tab) => (
					<Box
						key={tab.id}
						position="absolute"
						inset="0"
						display={tab.id === activeTabId ? "block" : "none"}
					>
						{tab.type === "agent" ? (
							<AgentChat sessionId={tab.id} />
						) : (
							<Terminal
								profileId={profileId}
								sessionId={tab.id}
							/>
						)}
					</Box>
				))}
			</Box>
		</Flex>
	);
}
