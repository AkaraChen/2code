import {
	Badge,
	Box,
	Button,
	Card,
	HStack,
	Input,
	InputGroup,
	SimpleGrid,
	Skeleton,
	Stack,
	Text,
} from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useState } from "react";
import { useDebouncedValue } from "rooks";
import { RiDownloadLine, RiSearchLine } from "react-icons/ri";
import {
	useInstallSkill,
	useSkillSearch,
	useSkills,
} from "@/features/assets/hooks/useSkills";
import type { SearchSkillResult } from "@/generated/types";

function formatInstalls(count: number): string {
	if (!count || count <= 0) return "";
	if (count >= 1_000_000)
		return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (count >= 1_000)
		return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
	return String(count);
}

// ─── Search Results ───────────────────────────────────────────────────────────

function SearchResultCard({
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

function SearchResultList({
	query,
	installedNames,
}: {
	query: string;
	installedNames: Set<string>;
}) {
	const { data: results, isLoading, isFetching } = useSkillSearch(query);

	if (isLoading || isFetching) {
		return (
			<SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4">
				{Array.from({ length: 6 }).map((_, i) => (
					<Skeleton key={i} h="100px" borderRadius="md" />
				))}
			</SimpleGrid>
		);
	}

	if (!results || results.length === 0) {
		return (
			<Text fontSize="sm" color="fg.muted" py="4">
				{m.skillsNoResults({ query })}
			</Text>
		);
	}

	return (
		<SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4">
			{results.map((skill) => (
				<SearchResultCard
					key={skill.slug}
					skill={skill}
					installedNames={installedNames}
				/>
			))}
		</SimpleGrid>
	);
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export function SkillsMarketplace() {
	const [inputValue, setInputValue] = useState("");
	const [query] = useDebouncedValue(inputValue, 300);
	const { data: installedSkills } = useSkills();
	const installedNames = new Set(installedSkills.map((s) => s.name));
	const showResults = query.trim().length >= 2;

	return (
		<Stack gap="6">
			<Box maxW="lg">
				<InputGroup startElement={<RiSearchLine />} w="full">
					<Input
						placeholder={m.skillsSearchPlaceholder()}
						value={inputValue}
						onChange={(e) => setInputValue(e.target.value)}
						size="sm"
					/>
				</InputGroup>
			</Box>

			{showResults && (
				<SearchResultList query={query} installedNames={installedNames} />
			)}
		</Stack>
	);
}
