import {
	Badge,
	Box,
	EmptyState,
	HStack,
	Heading,
	SegmentGroup,
	Skeleton,
	Stack,
	Tag,
} from "@chakra-ui/react";
import { Suspense, useState } from "react";
import * as m from "@/paraglide/messages.js";
import { SnippetsTab } from "./SnippetsTab";
import { SkillsTab } from "./SkillsTab";

type Mode = "manage" | "store";
type Filter = "skills" | "snippets" | "agents";

const filters: { value: Filter; label: () => string }[] = [
	{ value: "skills", label: m.skills },
	{ value: "snippets", label: m.snippets },
	{ value: "agents", label: m.agents },
];

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

	return (
		<Box p="8" pt="16">
			<Stack gap="6">
				<Heading size="2xl" fontWeight="bold">
					{m.assets()}
				</Heading>

				<SegmentGroup.Root
					size="sm"
					width="fit-content"
					value={mode}
					onValueChange={(e) => e.value && setMode(e.value as Mode)}
				>
					<SegmentGroup.Indicator />
					<SegmentGroup.Items
						items={[
							{ value: "manage", label: m.management() },
							{ value: "store", label: m.store() },
						]}
					/>
				</SegmentGroup.Root>

				<HStack gap="2">
					{filters.map((f) => (
						<Tag.Root
							key={f.value}
							asChild
							size="xl"
							variant={filter === f.value ? "solid" : "outline"}
							cursor="pointer"
						>
							<button
								type="button"
								onClick={() => setFilter(f.value)}
							>
								<Tag.Label>{f.label()}</Tag.Label>
							</button>
						</Tag.Root>
					))}
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
						{filter === "agents" && <WipSection />}
					</>
				)}

				{mode === "store" && (
					<WipSection
						title={filters.find((f) => f.value === filter)?.label()}
					/>
				)}
			</Stack>
		</Box>
	);
}
