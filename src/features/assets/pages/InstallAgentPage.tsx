import {
	Badge,
	Box,
	Button,
	Card,
	Center,
	EmptyState,
	HStack,
	Link,
	SimpleGrid,
	Spinner,
	Stack,
	Text,
	VStack,
} from "@chakra-ui/react";
import { LuExternalLink } from "react-icons/lu";
import type { RegistryAgentInfo } from "@/generated/types";
import * as m from "@/paraglide/messages.js";
import { AgentIcon } from "@/shared/components/AgentIcon";
import {
	useAddMarketplaceAgent,
	useMarketplaceAgents,
	useRegistryAgents,
} from "@/features/assets/hooks/useMarketplace";
import { ICON_CONTAINER_STYLE } from "../components/shared";
import { MarketplaceQueryBoundary } from "../components/MarketplaceQueryBoundary";

function RegistryAgentCard({
	agent,
	isAdded,
	onAdd,
	isPending,
}: {
	agent: RegistryAgentInfo;
	isAdded: boolean;
	onAdd: (agent: RegistryAgentInfo) => void;
	isPending: boolean;
}) {
	return (
		<Card.Root>
			<Card.Body gap="3">
				<HStack gap="3" align="flex-start">
					<div style={ICON_CONTAINER_STYLE}>
						<AgentIcon
							iconUrl={agent.icon}
							size={28}
							alt={agent.name}
						/>
					</div>
					<Stack gap="0" flex="1" minW="0">
						<HStack justify="space-between" align="flex-start">
							<Card.Title fontSize="sm" lineClamp={1}>
								{agent.name}
							</Card.Title>
							<Badge
								size="sm"
								variant="outline"
								flexShrink={0}
								fontFamily="mono"
							>
								{m.marketplaceVersion({
									version: agent.version,
								})}
							</Badge>
						</HStack>
						{agent.authors.length > 0 && (
							<Text fontSize="xs" color="fg.muted" lineClamp={1}>
								{m.marketplaceBy({
									authors: agent.authors.join(", "),
								})}
							</Text>
						)}
					</Stack>
				</HStack>

				{agent.description && (
					<Card.Description fontSize="xs" lineClamp={2}>
						{agent.description}
					</Card.Description>
				)}

				<HStack justify="space-between" align="center">
					{agent.repository ? (
						<Link
							href={agent.repository}
							target="_blank"
							rel="noopener noreferrer"
							fontSize="xs"
							color="fg.muted"
							display="flex"
							alignItems="center"
							gap="1"
						>
							<LuExternalLink size={10} />
							Repo
						</Link>
					) : (
						<Box />
					)}
					<Button
						size="xs"
						variant={isAdded ? "subtle" : "solid"}
						colorPalette={isAdded ? "gray" : "blue"}
						disabled={isAdded || isPending}
						loading={isPending}
						onClick={() => !isAdded && onAdd(agent)}
					>
						{isAdded ? m.marketplaceAdded() : m.marketplaceAdd()}
					</Button>
				</HStack>
			</Card.Body>
		</Card.Root>
	);
}

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
		<SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4">
			{registry.map((agent) => (
				<RegistryAgentCard
					key={agent.id}
					agent={agent}
					isAdded={installedIds.has(agent.id)}
					onAdd={handleAdd}
					isPending={
						addMutation.isPending &&
						addMutation.variables?.id === agent.id
					}
				/>
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
