import { Badge, Button, Card, HStack, Stack, Text } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import numeral from "numeral";
import { RiDownloadLine } from "react-icons/ri";
import { useInstallSkill } from "@/features/assets/hooks/useSkills";
import type { SearchSkillResult } from "@/generated/types";

function formatInstalls(count: number): string {
	if (!count || count <= 0) return "";
	return numeral(count).format("0.[0]a").toUpperCase();
}

export function SkillSearchResultCard({
	skill,
	installedNames,
}: {
	skill: SearchSkillResult;
	installedNames: Set<string>;
}) {
	const install = useInstallSkill();
	const isInstalled = installedNames.has(skill.name);
	const installs = formatInstalls(skill.installs);
	const isLoading =
		install.isPending && install.variables?.skill === skill.name;

	return (
		<Card.Root
			key={skill.slug}
			size="sm"
			variant="outline"
			bg="bg.panel"
			overflow="hidden"
		>
			<Card.Body gap="3" p="4">
				<HStack justify="space-between" align="center">
					<Card.Title
						fontSize="sm"
						fontWeight="semibold"
						lineClamp={1}
						flex="1"
						mr="2"
					>
						{skill.name}
					</Card.Title>

					{isInstalled ? (
						<Badge
							size="sm"
							color="fg.success"
							bg="bg.success.subtle"
							variant="subtle"
							flexShrink={0}
							h="24px"
							px="2"
							display="inline-flex"
							alignItems="center"
							rounded="sm"
						>
							{m.skillInstalled()}
						</Badge>
					) : (
						<Button
							size="2xs"
							minH="24px"
							variant="outline"
							loading={isLoading}
							disabled={install.isPending}
							onClick={() =>
								install.mutate({
									source: skill.source || skill.slug,
									skill: skill.name,
								})
							}
							aria-label={`${m.skillInstall()} ${skill.name}`}
							flexShrink={0}
						>
							<RiDownloadLine />
							{m.skillInstall()}
						</Button>
					)}
				</HStack>

				<HStack justify="space-between" align="flex-end" mt="auto">
					<Stack gap="1">
						{skill.source && (
							<Text fontSize="xs" color="fg.muted" lineClamp={1}>
								{skill.source}
							</Text>
						)}
					</Stack>
					{installs && (
						<Badge
							size="sm"
							variant="subtle"
							color="fg.muted"
							bg="bg.subtle"
						>
							{m.skillInstalls({ n: installs })}
						</Badge>
					)}
				</HStack>
			</Card.Body>
		</Card.Root>
	);
}
