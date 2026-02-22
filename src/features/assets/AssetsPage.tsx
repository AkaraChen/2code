import {
	Badge,
	Box,
	EmptyState,
	Heading,
	SegmentGroup,
	Skeleton,
	Stack,
} from "@chakra-ui/react";
import { Suspense, useState } from "react";
import * as m from "@/paraglide/messages.js";
import { SnippetsTab } from "./SnippetsTab";
import { SkillsTab } from "./SkillsTab";

export default function AssetsPage() {
	const [tab, setTab] = useState("skills");

	return (
		<Box p="8" pt="16">
			<Stack gap="6">
				<Heading size="2xl" fontWeight="bold">
					{m.assets()}
				</Heading>
				<SegmentGroup.Root
					size="sm"
					value={tab}
					onValueChange={(e) => e.value && setTab(e.value)}
				>
					<SegmentGroup.Indicator />
					<SegmentGroup.Items
						items={[
							{ value: "skills", label: m.skills() },
							{ value: "snippets", label: m.snippets() },
							{ value: "agents", label: m.agents() },
						]}
					/>
				</SegmentGroup.Root>

				{tab === "snippets" && (
					<Suspense fallback={<Skeleton height="200px" />}>
						<SnippetsTab />
					</Suspense>
				)}
				{tab === "skills" && (
					<Suspense fallback={<Skeleton height="200px" />}>
						<SkillsTab />
					</Suspense>
				)}
				{tab === "agents" && (
					<EmptyState.Root>
						<EmptyState.Content>
							<EmptyState.Title>
								{m.agents()}
							</EmptyState.Title>
							<EmptyState.Description>
								<Badge variant="outline">{m.wip()}</Badge>
							</EmptyState.Description>
						</EmptyState.Content>
					</EmptyState.Root>
				)}
			</Stack>
		</Box>
	);
}
