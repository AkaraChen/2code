import { Badge, Box, Card, HStack, Link, Stack, Text } from "@chakra-ui/react";
import { LuExternalLink } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import { AgentIcon } from "@/shared/components/AgentIcon";
import { ICON_CONTAINER_STYLE } from "./shared";
import type { ReactNode } from "react";

interface AgentCardProps {
	name: string;
	version: string;
	description?: string | null;
	iconUrl?: string | null;
	authors: string[];
	repository?: string | null;
	action?: ReactNode;
}

export function AgentCard({
	name,
	version,
	description,
	iconUrl,
	authors,
	repository,
	action,
}: AgentCardProps) {
	return (
		<Card.Root height="full" size="md" variant="outline" bg="bg.panel">
			<Card.Body gap="2" p="3" flex="1">
				<HStack gap="3" align="flex-start" justify="space-between">
					<HStack gap="3" align="flex-start" flex="1" minW="0">
						<div style={ICON_CONTAINER_STYLE}>
							<AgentIcon iconUrl={iconUrl} size={24} alt={name} />
						</div>
						<Stack gap="0" flex="1" minW="0">
							<HStack gap="1" align="baseline">
								<Card.Title fontSize="sm" lineClamp={1}>
									{name}
								</Card.Title>
								<Badge
									size="sm"
									variant="outline"
									flexShrink={0}
									fontFamily="mono"
									fontSize="2xs"
									px="1"
								>
									{m.marketplaceVersion({
										version,
									})}
								</Badge>
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
					<Box flexShrink={0}>{action}</Box>
				</HStack>

				{description && (
					<Card.Description fontSize="xs" lineClamp={1}>
						{description}
					</Card.Description>
				)}

				<HStack justify="space-between" align="center" mt="auto">
					{repository ? (
						<Link
							href={repository}
							target="_blank"
							rel="noopener noreferrer"
							fontSize="xs"
							color="fg.muted"
							display="flex"
							alignItems="center"
							gap="1"
						>
							<LuExternalLink size={10} />
							Repository
						</Link>
					) : (
						<Box />
					)}
				</HStack>
			</Card.Body>
		</Card.Root>
	);
}
