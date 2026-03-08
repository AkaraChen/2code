import { Badge, Button, Card, HStack, Stack, Text } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { RiDownloadLine } from "react-icons/ri";
import { useInstallSkill } from "@/features/assets/hooks/useSkills";
import type { SearchSkillResult } from "@/generated/types";

function formatInstalls(count: number): string {
	if (!count || count <= 0) return "";
	if (count >= 1_000_000)
		return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (count >= 1_000)
		return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
	return String(count);
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
		<Card.Root key={skill.slug} size="sm">
			<Card.Body gap="2">
				<HStack justify="space-between" align="flex-start">
					<Card.Title>{skill.name}</Card.Title>
					{isInstalled ? (
						<Badge size="sm" colorPalette="green" variant="subtle">
							{m.skillInstalled()}
						</Badge>
					) : (
						<Button
							size="2xs"
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
						>
							<RiDownloadLine />
							{m.skillInstall()}
						</Button>
					)}
				</HStack>
				<Card.Description lineClamp={2}>
					<Stack gap="1" mt="1">
						{skill.source && (
							<Text fontSize="xs" color="fg.muted" lineClamp={1}>
								{skill.source}
							</Text>
						)}
						{installs && (
							<Badge
								size="sm"
								variant="subtle"
								colorPalette="gray"
								w="fit-content"
							>
								{m.skillInstalls({ n: installs })}
							</Badge>
						)}
					</Stack>
				</Card.Description>
			</Card.Body>
		</Card.Root>
	);
}
