import { Flex, Text, VStack } from "@chakra-ui/react";
import type { ToolCallLocation } from "../types";

interface FileLocationsListProps {
	locations: ToolCallLocation[];
}

export function FileLocationsList({ locations }: FileLocationsListProps) {
	if (locations.length === 0) return null;

	return (
		<VStack align="stretch" gap="1" mb="2">
			<Text fontSize="xs" fontWeight="medium" color="fg.muted">
				Affected Files:
			</Text>
			{locations.map((loc, i) => (
				<Flex
					key={i}
					px="2"
					py="1"
					bg="bg.subtle"
					borderRadius="sm"
					fontSize="xs"
					fontFamily="mono"
					gap="2"
				>
					<Text flex="1" truncate>
						{loc.path}
					</Text>
					{loc.line !== null && loc.line !== undefined && (
						<Text color="fg.muted">:{loc.line}</Text>
					)}
				</Flex>
			))}
		</VStack>
	);
}
