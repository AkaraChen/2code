import { Badge, Card, HStack, Text, VStack } from "@chakra-ui/react";
import type { CredentialEntry } from "@/generated/types";
import * as m from "@/paraglide/messages.js";

interface CredentialCardProps {
	provider: string;
	entry: CredentialEntry | null | undefined;
}

/**
 * 凭证卡片
 * 显示单个提供商的凭证检测状态
 */
export function CredentialCard({ provider, entry }: CredentialCardProps) {
	return (
		<Card.Root size="sm" flex="1">
			<Card.Body>
				<HStack justify="space-between" mb="1">
					<Text fontSize="sm" fontWeight="semibold">
						{entry?.provider ?? provider}
					</Text>
					{entry ? (
						<Badge colorPalette="green" variant="subtle" size="sm">
							{entry.auth_type === "oauth"
								? m.agentOAuth()
								: m.agentApiKey()}
						</Badge>
					) : (
						<Text fontSize="xs" color="fg.muted">
							{m.agentCredentialsNone()}
						</Text>
					)}
				</HStack>
				{entry && (
					<VStack align="start" gap="0.5">
						<Text fontSize="xs" fontFamily="mono">
							{entry.key_preview}
						</Text>
						<Text fontSize="xs" color="fg.muted">
							{m.agentCredentialsDetected({
								source: entry.source,
							})}
						</Text>
					</VStack>
				)}
			</Card.Body>
		</Card.Root>
	);
}
