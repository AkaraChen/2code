import { SimpleGrid, Skeleton, Text } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useSkillSearch } from "@/features/assets/hooks/useSkills";
import { SkillSearchResultCard } from "./SkillSearchResultCard";

export function SkillSearchResultList({
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
				<SkillSearchResultCard
					key={skill.slug}
					skill={skill}
					installedNames={installedNames}
				/>
			))}
		</SimpleGrid>
	);
}
