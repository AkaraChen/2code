import { Button, CloseButton, Tabs } from "@chakra-ui/react";
import { LuPlus, LuTerminal } from "react-icons/lu";
import { Terminal } from "./Terminal";
import { useTerminalStore } from "@/stores/terminalStore";
import { useShallow } from "zustand/react/shallow";
import * as m from "@/paraglide/messages.js";

const DEFAULT_SHELL = "/bin/zsh";

interface TerminalTabsProps {
	projectId: string;
	cwd: string;
}

export default function TerminalTabs({ projectId, cwd }: TerminalTabsProps) {
	const { tabs, activeTabId } = useTerminalStore(
		useShallow((s) => s.projects[projectId] ?? { tabs: [], activeTabId: null }),
	);
	const createTab = useTerminalStore((s) => s.createTab);
	const closeTab = useTerminalStore((s) => s.closeTab);
	const setActiveTab = useTerminalStore((s) => s.setActiveTab);

	if (tabs.length === 0) return null;

	return (
		<div className="flex flex-col h-full w-full">
			<Tabs.Root
				variant="outline"
				size="sm"
				value={activeTabId}
				onValueChange={(e) => setActiveTab(projectId, e.value)}
			>
				<Tabs.List>
					{tabs.map((tab) => (
						<Tabs.Trigger key={tab.id} value={tab.id}>
							<LuTerminal />
							<span className="flex items-center gap-2">
								{tab.title}
								<CloseButton
									as="span"
									role="button"
									size="2xs"
									onClick={(e) => {
										e.stopPropagation();
										closeTab(projectId, tab.id);
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
						onClick={() => createTab(projectId)}
					>
						<LuPlus /> {m.newTerminal()}
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
							shell={DEFAULT_SHELL}
							cwd={cwd}
							className="h-full"
						/>
					</div>
				))}
			</div>
		</div>
	);
}
