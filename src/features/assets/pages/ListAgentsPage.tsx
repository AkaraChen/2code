import {
	Badge,
	Button,
	Card,
	CloseButton,
	Dialog,
	EmptyState,
	HStack,
	Portal,
	SimpleGrid,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import { AgentIcon } from "@/shared/components/AgentIcon";
import { useMarketplaceAgents, useRemoveMarketplaceAgent } from "@/features/assets/hooks/useMarketplace";
import { ICON_CONTAINER_STYLE } from "../components/shared";
import { MarketplaceQueryBoundary } from "../components/MarketplaceQueryBoundary";

function InstalledAgentCard({
	id,
	name,
	version,
	description,
	iconUrl,
	authors,
	onRemove,
}: {
	id: string;
	name: string;
	version: string;
	description?: string | null;
	iconUrl?: string | null;
	authors: string[];
	onRemove: (id: string) => void;
}) {
	return (
		<Card.Root>
			<Card.Body gap="3">
				<HStack gap="3" align="flex-start">
					<div style={ICON_CONTAINER_STYLE}>
						<AgentIcon iconUrl={iconUrl} size={28} alt={name} />
					</div>
					<Stack gap="0" flex="1" minW="0">
						<HStack justify="space-between" align="flex-start">
							<Card.Title fontSize="sm" lineClamp={1}>
								{name}
							</Card.Title>
							<HStack gap="2" flexShrink={0}>
								<Badge
									size="sm"
									variant="outline"
									fontFamily="mono"
								>
									{m.marketplaceVersion({ version })}
								</Badge>
								<Button
									size="xs"
									variant="ghost"
									colorPalette="red"
									onClick={() => onRemove(id)}
									aria-label={m.removeAgent()}
								>
									<LuTrash2 />
								</Button>
							</HStack>
						</HStack>
						{authors.length > 0 && (
							<Text fontSize="xs" color="fg.muted" lineClamp={1}>
								{m.marketplaceBy({
									authors: authors.join(", "),
								})}
							</Text>
						)}
					</Stack>
				</HStack>
				{description && (
					<Card.Description fontSize="xs" lineClamp={2}>
						{description}
					</Card.Description>
				)}
			</Card.Body>
		</Card.Root>
	);
}

function InstalledList() {
	const { data: agents } = useMarketplaceAgents();
	const removeMutation = useRemoveMarketplaceAgent();
	const [removeTarget, setRemoveTarget] = useState<string | null>(null);

	if (agents.length === 0) {
		return (
			<EmptyState.Root>
				<EmptyState.Content>
					<EmptyState.Description>
						{m.marketplaceNoAgentsInstalled()}
					</EmptyState.Description>
				</EmptyState.Content>
			</EmptyState.Root>
		);
	}

	return (
		<>
			<SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4">
				{agents.map((agent) => {
					const authors = (() => {
						try {
							return JSON.parse(agent.authors_json) as string[];
						} catch {
							return [];
						}
					})();
					return (
						<InstalledAgentCard
							key={agent.id}
							id={agent.id}
							name={agent.name}
							version={agent.version}
							description={agent.description}
							iconUrl={agent.icon_url}
							authors={authors}
							onRemove={setRemoveTarget}
						/>
					);
				})}
			</SimpleGrid>

			<Dialog.Root
				lazyMount
				open={removeTarget !== null}
				onOpenChange={(e) => {
					if (!e.open) setRemoveTarget(null);
				}}
			>
				<Portal>
					<Dialog.Backdrop />
					<Dialog.Positioner>
						<Dialog.Content>
							<Dialog.Header>
								<Dialog.Title>{m.removeAgent()}</Dialog.Title>
							</Dialog.Header>
							<Dialog.Body>
								<Text>{m.confirmRemoveAgent()}</Text>
							</Dialog.Body>
							<Dialog.Footer>
								<Dialog.ActionTrigger asChild>
									<Button variant="outline">
										{m.cancel()}
									</Button>
								</Dialog.ActionTrigger>
								<Button
									colorPalette="red"
									onClick={() => {
										if (removeTarget) {
											removeMutation.mutate(removeTarget);
										}
										setRemoveTarget(null);
									}}
								>
									{m.marketplaceRemove()}
								</Button>
							</Dialog.Footer>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Content>
					</Dialog.Positioner>
				</Portal>
			</Dialog.Root>
		</>
	);
}

export default function ListAgentsPage() {
	return (
		<MarketplaceQueryBoundary loadingFallback={null}>
			<InstalledList />
		</MarketplaceQueryBoundary>
	);
}
