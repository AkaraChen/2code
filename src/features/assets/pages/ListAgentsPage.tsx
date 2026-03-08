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
import { useMarketplaceAgents, useRemoveMarketplaceAgent } from "@/features/assets/hooks/useMarketplace";
import { MarketplaceQueryBoundary } from "../components/MarketplaceQueryBoundary";
import { AgentCard } from "../components/AgentCard";

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
						<AgentCard
							key={agent.id}
							name={agent.name}
							version={agent.version}
							description={agent.description}
							iconUrl={agent.icon_url}
							authors={authors}
							action={
								<Button
									size="xs"
									variant="ghost"
									colorPalette="red"
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										setRemoveTarget(agent.id);
									}}
									aria-label={m.removeAgent()}
								>
									<LuTrash2 />
								</Button>
							}
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
