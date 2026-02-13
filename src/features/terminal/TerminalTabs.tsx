import { Box, Button, Circle, CloseButton, Flex, HStack, Tabs } from "@chakra-ui/react";
import { RiAddLine, RiTerminalBoxLine } from "react-icons/ri";
import { useShallow } from "zustand/react/shallow";
import * as m from "@/paraglide/messages.js";
import { useCloseTerminalTab, useCreateTerminalTab } from "./hooks";
import { useTerminalStore } from "./store";
import { Terminal } from "./Terminal";

interface TerminalTabsProps {
	profileId: string;
	cwd: string;
}

export default function TerminalTabs({ profileId, cwd }: TerminalTabsProps) {
	const { tabs, activeTabId } = useTerminalStore(
		useShallow(
			(s) => s.profiles[profileId] ?? { tabs: [], activeTabId: null },
		),
	);
	const notifiedTabs = useTerminalStore((s) => s.notifiedTabs);
	const setActiveTab = useTerminalStore((s) => s.setActiveTab);
	const createTab = useCreateTerminalTab();
	const closeTab = useCloseTerminalTab();

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
							<RiTerminalBoxLine />
							<HStack gap="2">
								{tab.title}
								{notifiedTabs.has(tab.id) && tab.id !== activeTabId && (
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
											sessionId: tab.id,
										});
									}}
								/>
							</HStack>
						</Tabs.Trigger>
					))}
					<Button
						alignSelf="center"
						ms="2"
						size="2xs"
						variant="ghost"
						disabled={createTab.isPending}
						onClick={() => createTab.mutate({ profileId, cwd })}
					>
						<RiAddLine /> {m.newTerminal()}
					</Button>
				</Tabs.List>
			</Tabs.Root>

			{/* Terminal area — all terminals stay mounted, hidden via CSS */}
			<Box flex="1" minH="0" position="relative">
				{tabs.map((tab) => (
					<Box
						key={tab.id}
						position="absolute"
						inset="0"
						display={tab.id === activeTabId ? "block" : "none"}
					>
						<Terminal
							profileId={profileId}
							sessionId={tab.id}
							restoreFrom={tab.restoreFrom}
						/>
					</Box>
				))}
			</Box>
		</Flex>
	);
}
