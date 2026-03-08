import {
	Box,
	Button,
	Center,
	EmptyState,
	SimpleGrid,
	Spinner,
	Text,
	VStack,
} from "@chakra-ui/react";
import type { RegistryAgentInfo } from "@/generated/types";
import * as m from "@/paraglide/messages.js";
import {
	useAddMarketplaceAgent,
	useMarketplaceAgents,
	useRegistryAgents,
} from "@/features/assets/hooks/useMarketplace";
import { MarketplaceQueryBoundary } from "../components/MarketplaceQueryBoundary";
import { AgentCard } from "../components/AgentCard";

function RegistryList() {
	const { data: registry } = useRegistryAgents();
	const { data: installedAgents } = useMarketplaceAgents();
	const addMutation = useAddMarketplaceAgent();

	const installedIds = new Set(installedAgents.map((a) => a.id));

	const handleAdd = (agent: RegistryAgentInfo) => {
		addMutation.mutate({
			id: agent.id,
			name: agent.name,
			version: agent.version,
			description: agent.description,
			iconUrl: agent.icon,
			repository: agent.repository,
			license: agent.license,
			authors: agent.authors,
			distribution: agent.distribution,
		});
	};

	if (registry.length === 0) {
		return (
			<EmptyState.Root>
				<EmptyState.Content>
					<EmptyState.Description>
						{m.marketplaceRegistryError()}
					</EmptyState.Description>
				</EmptyState.Content>
			</EmptyState.Root>
		);
	}

	return (
		<SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4" w="full">
			{registry.map((agent) => (
				<Box key={agent.id} display="flex" flexDirection="column">
					<AgentCard
						name={agent.name}
						version={agent.version}
						description={agent.description}
						iconUrl={agent.icon}
						authors={agent.authors}
						repository={agent.repository}
						action={
							<Button
								size="xs"
								variant={
									installedIds.has(agent.id)
										? "subtle"
										: "solid"
								}
								colorPalette={
									installedIds.has(agent.id)
										? "gray"
										: undefined
								}
								disabled={
									installedIds.has(agent.id) ||
									(addMutation.isPending &&
										addMutation.variables?.id === agent.id)
								}
								loading={
									addMutation.isPending &&
									addMutation.variables?.id === agent.id
								}
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									!installedIds.has(agent.id) &&
										handleAdd(agent);
								}}
							>
								{installedIds.has(agent.id)
									? m.marketplaceAdded()
									: m.marketplaceAdd()}
							</Button>
						}
					/>
				</Box>
			))}
		</SimpleGrid>
	);
}

export default function InstallAgentPage() {
	return (
		<MarketplaceQueryBoundary
			loadingFallback={
				<Center minH="50vh">
					<VStack gap={4}>
						<Spinner size="xl" />
						<Text>{m.marketplaceLoadingRegistry()}</Text>
					</VStack>
				</Center>
			}
		>
			<RegistryList />
		</MarketplaceQueryBoundary>
	);
}
