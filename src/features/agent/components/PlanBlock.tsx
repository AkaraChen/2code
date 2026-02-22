import { Box, Flex, Icon, Text, VStack } from "@chakra-ui/react";
import { LuClipboardList } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import type { Plan } from "../types";

const STATUS_ICON = {
	pending: "⏸️",
	in_progress: "▶️",
	completed: "✅",
};

const PRIORITY_ICON = {
	high: "🔴",
	medium: "🟡",
	low: "🟢",
};

interface PlanBlockProps {
	plan: Plan;
}

export function PlanBlock({ plan }: PlanBlockProps) {
	return (
		<Box w="full" border="1px solid" borderColor="border.subtle" borderRadius="md" overflow="hidden">
			<Box px="4" py="3" bg="bg.muted">
				<Flex align="center" gap="2" mb="3">
					<Icon fontSize="md" color="fg.default">
						<LuClipboardList />
					</Icon>
					<Text fontSize="sm" fontWeight="semibold" color="fg.default">
						{m.agentPlan()}
					</Text>
				</Flex>

				<VStack align="stretch" gap="2">
					{plan.entries.map((entry) => (
						<Flex
							key={entry.content}
							px="3"
							py="2"
							bg="bg.panel"
							border="1px solid"
							borderColor="border.subtle"
							borderRadius="sm"
							align="center"
							gap="3"
						>
							<Text fontSize="lg">{STATUS_ICON[entry.status]}</Text>
							<Text fontSize="lg">{PRIORITY_ICON[entry.priority]}</Text>
							<Text flex="1" fontSize="sm">
								{entry.content}
							</Text>
						</Flex>
					))}
				</VStack>
			</Box>
		</Box>
	);
}
