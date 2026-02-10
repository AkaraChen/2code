import { Button, Center, CloseButton, EmptyState, Tabs, VStack } from "@chakra-ui/react";
import { LuPlus, LuTerminal } from "react-icons/lu";
import { useCallback, useRef, useState } from "react";
import { Terminal } from "./Terminal";
import * as m from "@/paraglide/messages.js";

interface TerminalTab {
	id: string;
	title: string;
}

const DEFAULT_SHELL = "/bin/zsh";

interface TerminalTabsProps {
	cwd: string;
}

export default function TerminalTabs({ cwd }: TerminalTabsProps) {
	const [tabs, setTabs] = useState<TerminalTab[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const counterRef = useRef(0);

	const createTab = useCallback(() => {
		counterRef.current += 1;
		const id = crypto.randomUUID();
		const tab: TerminalTab = {
			id,
			title: `Terminal ${counterRef.current}`,
		};
		setTabs((prev) => [...prev, tab]);
		setActiveId(tab.id);
	}, []);

	const closeTab = useCallback(
		(tabId: string) => {
			setTabs((prev) => {
				const idx = prev.findIndex((t) => t.id === tabId);
				const next = prev.filter((t) => t.id !== tabId);

				if (next.length === 0) {
					setActiveId(null);
					return next;
				}

				if (tabId === activeId) {
					const newIdx = Math.min(idx, next.length - 1);
					setActiveId(next[newIdx].id);
				}

				return next;
			});
		},
		[activeId],
	);

	if (tabs.length === 0) {
		return (
			<Center h="full">
				<EmptyState.Root>
					<EmptyState.Content>
						<EmptyState.Indicator>
							<LuTerminal />
						</EmptyState.Indicator>
						<VStack textAlign="center">
							<EmptyState.Title>{m.noTerminalsOpen()}</EmptyState.Title>
							<EmptyState.Description>
								{m.noTerminalsOpenDescription()}
							</EmptyState.Description>
						</VStack>
						<Button onClick={createTab}>
							<LuPlus />
							{m.newTerminal()}
						</Button>
					</EmptyState.Content>
				</EmptyState.Root>
			</Center>
		);
	}

	return (
		<div className="flex flex-col h-full w-full">
			<Tabs.Root
				variant="outline"
				size="sm"
				value={activeId}
				onValueChange={(e) => setActiveId(e.value)}
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
										closeTab(tab.id);
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
						onClick={createTab}
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
							display: tab.id === activeId ? "block" : "none",
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
