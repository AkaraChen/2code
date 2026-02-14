import {
	Badge,
	Button,
	Card,
	HStack,
	ProgressCircle,
	Separator,
	SimpleGrid,
	Stack,
	Status,
	Text,
	VStack,
} from "@chakra-ui/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	detectCredentials,
	installAgent,
	listAgentStatus,
} from "@/generated";
import type { AgentStatusInfo, CredentialEntry } from "@/generated/types";
import * as m from "@/paraglide/messages.js";
import { queryKeys } from "@/shared/lib/queryKeys";

const AGENT_META: Record<string, { provider: string; description: string }> = {
	claude: {
		provider: "Anthropic",
		description: "Agentic coding by Anthropic",
	},
	codex: { provider: "OpenAI", description: "OpenAI's coding agent" },
	opencode: {
		provider: "Open Source",
		description: "Open-source terminal coding agent",
	},
	amp: {
		provider: "Sourcegraph",
		description: "Sourcegraph's AI coding agent",
	},
	pi: {
		provider: "Open Source",
		description: "Lightweight terminal-first agent",
	},
	cursor: {
		provider: "Anysphere",
		description: "AI-first code editor agent",
	},
};

function useAgentStatus() {
	return useSuspenseQuery({
		queryKey: queryKeys.agent.status(),
		queryFn: listAgentStatus,
	});
}

function useCredentials() {
	return useSuspenseQuery({
		queryKey: queryKeys.agent.credentials(),
		queryFn: detectCredentials,
	});
}

function useInstallAgent() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (agent: string) => installAgent({ agent }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.agent.status(),
			});
		},
	});
}

function AgentSummaryBar({
	agents,
	anthropic,
	openai,
}: {
	agents: AgentStatusInfo[];
	anthropic: CredentialEntry | null | undefined;
	openai: CredentialEntry | null | undefined;
}) {
	const readyCount = agents.filter((a) => a.ready).length;
	const total = agents.length;
	const percent = total > 0 ? (readyCount / total) * 100 : 0;

	return (
		<Card.Root variant="subtle" size="sm">
			<Card.Body>
				<HStack gap="4">
					<ProgressCircle.Root
						size="sm"
						value={percent}
						colorPalette={
							readyCount === total ? "green" : "blue"
						}
					>
						<ProgressCircle.Circle>
							<ProgressCircle.Track />
							<ProgressCircle.Range strokeLinecap="round" />
						</ProgressCircle.Circle>
					</ProgressCircle.Root>
					<Text fontSize="sm" fontWeight="medium">
						{m.agentSummary({
							ready: String(readyCount),
							total: String(total),
						})}
					</Text>
					<Separator orientation="vertical" height="4" />
					<HStack gap="3">
						<Status.Root
							colorPalette={anthropic ? "green" : "gray"}
						>
							<Status.Indicator />
							Anthropic
						</Status.Root>
						<Status.Root
							colorPalette={openai ? "green" : "gray"}
						>
							<Status.Indicator />
							OpenAI
						</Status.Root>
					</HStack>
				</HStack>
			</Card.Body>
		</Card.Root>
	);
}

function CredentialCard({
	provider,
	entry,
}: {
	provider: string;
	entry: CredentialEntry | null | undefined;
}) {
	return (
		<Card.Root size="sm" flex="1">
			<Card.Body>
				<HStack justify="space-between" mb="1">
					<Text fontSize="sm" fontWeight="semibold">
						{entry?.provider ?? provider}
					</Text>
					{entry ? (
						<Badge
							colorPalette="green"
							variant="subtle"
							size="sm"
						>
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

function AgentCard({ agent }: { agent: AgentStatusInfo }) {
	const { mutate: install, isPending } = useInstallAgent();
	const meta = AGENT_META[agent.id];

	const statusBadge = agent.ready ? (
		<Badge colorPalette="green" variant="subtle" size="sm">
			{m.agentReady()}
		</Badge>
	) : agent.native_required && !agent.native_installed ? (
		<Badge colorPalette="red" variant="subtle" size="sm">
			{m.agentNativeNotInstalled()}
		</Badge>
	) : agent.acp_installed ? (
		<Badge colorPalette="yellow" variant="subtle" size="sm">
			{m.agentPartial()}
		</Badge>
	) : (
		<Badge colorPalette="gray" variant="subtle" size="sm">
			{m.agentNotInstalled()}
		</Badge>
	);

	return (
		<Card.Root size="sm">
			<Card.Body>
				<VStack align="stretch" gap="3">
					<HStack justify="space-between">
						<HStack gap="2">
							<Text fontWeight="semibold">
								{agent.display_name}
							</Text>
							{meta && (
								<Badge
									variant="outline"
									size="sm"
									colorPalette="gray"
								>
									{meta.provider}
								</Badge>
							)}
						</HStack>
						{statusBadge}
					</HStack>

					{meta && (
						<Text fontSize="xs" color="fg.muted">
							{meta.description}
						</Text>
					)}

					<Separator />

					<HStack justify="space-between">
						<HStack gap="4">
							<HStack gap="1.5">
								<Text fontSize="xs" color="fg.muted">
									{m.agentNativeCli()}
								</Text>
								{!agent.native_required ? (
									<Text fontSize="xs" color="fg.muted">
										{m.agentNativeNotRequired()}
									</Text>
								) : (
									<Badge
										size="sm"
										variant="subtle"
										colorPalette={
											agent.native_installed
												? "green"
												: "red"
										}
									>
										{agent.native_version ??
											m.agentNotInstalled()}
									</Badge>
								)}
							</HStack>
							<Separator
								orientation="vertical"
								height="3"
							/>
							<HStack gap="1.5">
								<Text fontSize="xs" color="fg.muted">
									{m.agentAcpBridge()}
								</Text>
								<Badge
									size="sm"
									variant="subtle"
									colorPalette={
										agent.acp_installed
											? "green"
											: "gray"
									}
								>
									{agent.acp_version ??
										m.agentNotInstalled()}
								</Badge>
							</HStack>
						</HStack>
						{(!agent.native_required ||
							agent.native_installed) && (
							<Button
								size="xs"
								variant="outline"
								loading={isPending}
								onClick={() => install(agent.id)}
							>
								{agent.acp_installed
									? m.agentReinstall()
									: m.agentInstall()}
							</Button>
						)}
					</HStack>
				</VStack>
			</Card.Body>
		</Card.Root>
	);
}

export function AgentSettings() {
	const { data: agents } = useAgentStatus();
	const { data: credentials } = useCredentials();

	return (
		<Stack gap="6" maxW="2xl">
			<AgentSummaryBar
				agents={agents}
				anthropic={credentials.anthropic}
				openai={credentials.openai}
			/>

			<Stack gap="2">
				<Text fontWeight="semibold" fontSize="sm">
					{m.agentCredentials()}
				</Text>
				<SimpleGrid columns={2} gap="3">
					<CredentialCard
						provider="Anthropic"
						entry={credentials.anthropic}
					/>
					<CredentialCard
						provider="OpenAI"
						entry={credentials.openai}
					/>
				</SimpleGrid>
			</Stack>

			<Stack gap="2">
				<Text fontWeight="semibold" fontSize="sm">
					{m.agents()}
				</Text>
				<Stack gap="3">
					{agents.map((agent) => (
						<AgentCard key={agent.id} agent={agent} />
					))}
				</Stack>
			</Stack>
		</Stack>
	);
}
