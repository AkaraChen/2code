import { Button, CloseButton, Tabs } from "@chakra-ui/react";
import { RiAddLine, RiTerminalBoxLine } from "react-icons/ri";
import { useShallow } from "zustand/react/shallow";
import { useCloseTerminalTab } from "@/hooks/useCloseTerminalTab";
import { useCreateTerminalTab } from "@/hooks/useCreateTerminalTab";
import * as m from "@/paraglide/messages.js";
import { useTerminalStore } from "@/stores/terminalStore";
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
		<div className="flex flex-col h-full w-full">
			<Tabs.Root
				size="sm"
				value={activeTabId}
				onValueChange={(e) => setActiveTab(contextId, e.value)}
			>
				<Tabs.List>
					{tabs.map((tab) => (
						<Tabs.Trigger key={tab.id} value={tab.id}>
							<RiTerminalBoxLine />
							<span className="flex items-center gap-2">
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
							</span>
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
			<div className="flex-1 min-h-0 relative">
				{tabs.map((tab) => (
					<div
						key={tab.id}
						className="absolute inset-0"
						style={{
							display: tab.id === activeTabId ? "block" : "none",
						}}
					>
						<Terminal
							projectId={contextId}
							sessionId={tab.id}
							restoreFrom={tab.restoreFrom}
							className="h-full"
						/>
					</div>
				))}
			</div>
		</div>
	);
}
