import { Box, Button, CloseButton, Flex, HStack, Tabs } from "@chakra-ui/react";
import { RiAddLine, RiTerminalBoxLine } from "react-icons/ri";
import { useShallow } from "zustand/react/shallow";
import * as m from "@/paraglide/messages.js";
import { useCloseTerminalTab, useCreateTerminalTab } from "./hooks";
import { useTerminalStore } from "./store";
import { Terminal } from "./Terminal";

interface TerminalTabsProps {
	contextId: string;
	projectId: string;
	cwd: string;
}

export default function TerminalTabs({
	contextId,
	projectId,
	cwd,
}: TerminalTabsProps) {
	const { tabs, activeTabId } = useTerminalStore(
		useShallow(
			(s) => s.projects[contextId] ?? { tabs: [], activeTabId: null },
		),
	);
	const setActiveTab = useTerminalStore((s) => s.setActiveTab);
	const createTab = useCreateTerminalTab();
	const closeTab = useCloseTerminalTab();

	if (tabs.length === 0) return null;

	return (
		<Flex direction="column" h="full" w="full">
			<Tabs.Root
				size="sm"
				value={activeTabId}
				onValueChange={(e) => setActiveTab(contextId, e.value)}
			>
				<Tabs.List>
					{tabs.map((tab) => (
						<Tabs.Trigger key={tab.id} value={tab.id}>
							<RiTerminalBoxLine />
							<HStack gap="2">
								{tab.title}
								<CloseButton
									as="span"
									role="button"
									size="2xs"
									onClick={(e) => {
										e.stopPropagation();
										closeTab.mutate({
											contextId,
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
						onClick={() =>
							createTab.mutate({ contextId, projectId, cwd })
						}
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
							contextId={contextId}
							sessionId={tab.id}
							restoreFrom={tab.restoreFrom}
						/>
					</Box>
				))}
			</Box>
		</Flex>
	);
}
