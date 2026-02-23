import {
	Badge,
	Box,
	Button,
	Card,
	CloseButton,
	Dialog,
	EmptyState,
	HStack,
	Link,
	Portal,
	SimpleGrid,
	Stack,
	Text,
} from "@chakra-ui/react";
import React, { Suspense, useState } from "react";
import { LuExternalLink, LuTrash2 } from "react-icons/lu";
import { RiRobot2Line } from "react-icons/ri";
import type { RegistryAgentInfo } from "@/generated/types";
import * as m from "@/paraglide/messages.js";
import {
	useAddMarketplaceAgent,
	useMarketplaceAgents,
	useRegistryAgents,
	useRemoveMarketplaceAgent,
} from "./hooks/useMarketplace";

// ─── Shared: agent icon with SVG fallback ───────────────────────────────────

const ICON_SIZE = "40px";

function AgentIcon({
	icon,
	name,
}: {
	icon?: string | null;
	name: string;
}) {
	const [imgError, setImgError] = useState(false);

	const containerStyle = {
		width: ICON_SIZE,
		height: ICON_SIZE,
		flexShrink: 0,
		borderRadius: "var(--chakra-radii-md)",
		border: "1px solid var(--chakra-colors-border)",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: "6px",
		overflow: "hidden",
	} satisfies React.CSSProperties;

	if (!icon || imgError) {
		return (
			<div style={containerStyle}>
				<RiRobot2Line size={18} />
			</div>
		);
	}

	return (
		<div style={containerStyle}>
			<img
				src={icon}
				alt={name}
				onError={() => setImgError(true)}
				style={{
					width: "100%",
					height: "100%",
					objectFit: "contain",
				}}
			/>
		</div>
	);
}

// ─── Store mode: browse registry ────────────────────────────────────────────

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
					<AgentIcon icon={agent.icon} name={agent.name} />
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
								{m.marketplaceVersion({ version: agent.version })}
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

// ─── Manage mode: list added agents ─────────────────────────────────────────

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
					<AgentIcon icon={iconUrl} name={name} />
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
								<Dialog.Title>
									{m.removeAgent()}
								</Dialog.Title>
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

// ─── Public component ────────────────────────────────────────────────────────

export function AgentsTab({ mode }: { mode: "manage" | "store" }) {
	if (mode === "store") {
		return (
			<Suspense
				fallback={
					<Text color="fg.muted" fontSize="sm">
						{m.marketplaceLoadingRegistry()}
					</Text>
				}
			>
				<RegistryList />
			</Suspense>
		);
	}

	return (
		<Suspense fallback={null}>
			<InstalledList />
		</Suspense>
	);
}
