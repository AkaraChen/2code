import {
	Badge,
	Box,
	EmptyState,
	Heading,
	HStack,
	SegmentGroup,
	Skeleton,
	Stack,
	Tooltip,
} from "@chakra-ui/react";
import { Suspense, useState } from "react";
import * as m from "@/paraglide/messages.js";
import { AgentsTab } from "./AgentsTab";
import { SkillsTab } from "./SkillsTab";
import { SnippetsTab } from "./SnippetsTab";
import { SkillsMarketplace } from "@/features/settings/tabs/SkillsMarketplace";

type Mode = "manage" | "store";
type Filter = "skills" | "snippets" | "agents";

function WipSection({ title }: { title?: string }) {
	return (
		<EmptyState.Root>
			<EmptyState.Content>
				{title && <EmptyState.Title>{title}</EmptyState.Title>}
				<EmptyState.Description>
					<Badge variant="outline">{m.wip()}</Badge>
				</EmptyState.Description>
			</EmptyState.Content>
		</EmptyState.Root>
	);
}

export default function AssetsPage() {
	const [mode, setMode] = useState<Mode>("manage");
	const [filter, setFilter] = useState<Filter>("skills");

	const handleModeChange = (value: Mode) => {
		setMode(value);
		// When switching to store mode, default to agents tab
		if (value === "store") {
			setFilter("agents");
		}
	};

	return (
		<Box p="8" pt="16">
			<Stack gap="6">
				<Heading size="2xl" fontWeight="bold">
					{m.assets()}
				</Heading>

				<HStack justify="space-between" align="center">
					<SegmentGroup.Root
						size="sm"
						width="fit-content"
						value={filter}
						onValueChange={(e) =>
							e.value && setFilter(e.value as Filter)
						}
					>
						<SegmentGroup.Indicator />
						{mode === "store" ? (
							<>
								<SegmentGroup.Item value="skills">
									<SegmentGroup.ItemText>{m.skills()}</SegmentGroup.ItemText>
									<SegmentGroup.ItemHiddenInput />
								</SegmentGroup.Item>
								<Tooltip.Root>
									<Tooltip.Trigger asChild>
										<SegmentGroup.Item
											value="snippets"
											disabled
										>
											<SegmentGroup.ItemText>{m.snippets()}</SegmentGroup.ItemText>
											<SegmentGroup.ItemHiddenInput />
										</SegmentGroup.Item>
									</Tooltip.Trigger>
									<Tooltip.Positioner>
										<Tooltip.Content>
											{m.wip()}
										</Tooltip.Content>
									</Tooltip.Positioner>
								</Tooltip.Root>
								<SegmentGroup.Item value="agents">
									<SegmentGroup.ItemText>{m.agents()}</SegmentGroup.ItemText>
									<SegmentGroup.ItemHiddenInput />
								</SegmentGroup.Item>
							</>
						) : (
							<SegmentGroup.Items
								items={[
									{ value: "skills", label: m.skills() },
									{ value: "snippets", label: m.snippets() },
									{ value: "agents", label: m.agents() },
								]}
							/>
						)}
					</SegmentGroup.Root>

					<SegmentGroup.Root
						size="sm"
						width="fit-content"
						value={mode}
						onValueChange={(e) =>
							e.value && handleModeChange(e.value as Mode)
						}
					>
						<SegmentGroup.Indicator />
						<SegmentGroup.Items
							items={[
								{ value: "manage", label: m.management() },
								{ value: "store", label: m.store() },
							]}
						/>
					</SegmentGroup.Root>
				</HStack>

				{mode === "manage" && (
					<>
						{filter === "skills" && (
							<Suspense fallback={<Skeleton height="200px" />}>
								<SkillsTab />
							</Suspense>
						)}
						{filter === "snippets" && (
							<Suspense fallback={<Skeleton height="200px" />}>
								<SnippetsTab />
							</Suspense>
						)}
						{filter === "agents" && <AgentsTab mode="manage" />}
					</>
				)}

				{mode === "store" && (
					<Box>
						{filter === "agents" && <AgentsTab mode="store" />}
						{filter === "skills" && <SkillsMarketplace />}
						{filter === "snippets" && <WipSection title={m.snippets()} />}
					</Box>
				)}
			</Stack>
		</Box>
	);
}
