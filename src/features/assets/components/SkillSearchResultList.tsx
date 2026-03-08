import { Box, SimpleGrid, Skeleton, Text } from "@chakra-ui/react";
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
			<SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4" w="full">
				{Array.from({ length: 6 }).map((_, i) => (
					<Box 
						key={i} 
						p="4"
						borderWidth="1px" 
						borderColor="border.subtle"
						rounded="md"
					>
						<Skeleton h="20px" w="1/2" mb="3" />
						<Skeleton h="16px" w="1/3" />
					</Box>
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
		<SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4" w="full">
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
