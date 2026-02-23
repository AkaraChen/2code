import { Box, Circle, CloseButton, Flex, HStack, Tabs } from "@chakra-ui/react";
import { RiTerminalBoxLine } from "react-icons/ri";
import { match } from "ts-pattern";
import { useShallow } from "zustand/react/shallow";
import { AgentChat } from "@/features/agent/AgentChat";
import { useCloseTab } from "@/features/tabs/hooks";
import { isPending } from "@/features/tabs/pendingDeletions";
import { useTabStore } from "@/features/tabs/store";
import { AgentIcon } from "@/shared/components/AgentIcon";
import { SplitTerminal } from "./SplitTerminal";

interface TerminalTabsProps {
	profileId: string;
	cwd: string;
}

export default function TerminalTabs({ profileId, cwd }: TerminalTabsProps) {
	const { tabs, activeTabId } = useTabStore(
		useShallow(
			(s) => s.profiles[profileId] ?? { tabs: [], activeTabId: null },
		),
	);
	const notifiedTabs = useTabStore((s) => s.notifiedTabs);
	const closeTab = useCloseTab();

	if (tabs.length === 0) return null;

	const hasTabNotification = (tab: (typeof tabs)[number]): boolean =>
		match(tab)
			.with({ type: "terminal" }, (t) =>
				t.panes.some((p) => notifiedTabs.has(p.sessionId)),
			)
			.with({ type: "agent" }, (t) => notifiedTabs.has(t.sessionId))
			.exhaustive();

	return (
		<Flex direction="column" h="full" w="full">
			<Tabs.Root
				size="sm"
				value={activeTabId}
				onValueChange={(e) => useTabStore.getState().setActiveTab(profileId, e.value)}
			>
				<Tabs.List>
					{tabs.map((tab) => (
						<Tabs.Trigger key={tab.id} value={tab.id}>
							{match(tab)
								.with({ type: "agent" }, (t) => (
									<AgentIcon iconUrl={t.iconUrl} alt={t.title} />
								))
								.with({ type: "terminal" }, () => (
									<RiTerminalBoxLine />
								))
								.exhaustive()}
							<HStack gap="2">
								{tab.title}
								{hasTabNotification(tab) &&
									tab.id !== activeTabId && (
										<Circle size="2" bg="green.500" />
									)}
								<CloseButton
									as="span"
									role="button"
									size="2xs"
									disabled={isPending(tab.id)}
									onClick={(e) => {
										e.stopPropagation();
										if (!isPending(tab.id)) {
											closeTab.mutate({
												profileId,
												tabId: tab.id,
											});
										}
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
						{match(tab)
							.with({ type: "agent" }, (t) => (
								<AgentChat
									sessionId={t.sessionId}
									isActive={t.id === activeTabId}
								/>
							))
							.with({ type: "terminal" }, (t) => (
								<SplitTerminal
									profileId={profileId}
									tab={t}
									cwd={cwd}
								/>
							))
							.exhaustive()}
					</Box>
				))}
			</Box>
		</Flex>
	);
}
