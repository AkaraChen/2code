import { SimpleGrid, Stack, Text } from "@chakra-ui/react";
import type { CredentialEntry } from "@/generated/types";
import * as m from "@/paraglide/messages.js";
import { CredentialCard } from "./CredentialCard";

interface CredentialSectionProps {
	anthropic: CredentialEntry | null | undefined;
	openai: CredentialEntry | null | undefined;
}

/**
 * 凭证区域容器
 * 显示 Anthropic 和 OpenAI 凭证状态
 */
export function CredentialSection({
	anthropic,
	openai,
}: CredentialSectionProps) {
	return (
		<Stack gap="2">
			<Text fontWeight="semibold" fontSize="sm">
				{m.agentCredentials()}
			</Text>
			<SimpleGrid columns={2} gap="3">
				<CredentialCard provider="Anthropic" entry={anthropic} />
				<CredentialCard provider="OpenAI" entry={openai} />
			</SimpleGrid>
		</Stack>
	);
}
