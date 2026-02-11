import { Box, Button, Center, Skeleton, Stack, VStack } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";

export function SidebarSkeleton() {
	return (
		<Box
			w="256px"
			flexShrink={0}
			bg="bg.subtle"
			borderRight="1px solid"
			borderColor="border.subtle"
			p="4"
		>
			<Stack gap="3">
				<Skeleton height="8" width="full" />
				<Skeleton height="8" width="full" />
				<Skeleton height="6" width="3/4" ms="6" />
				<Skeleton height="6" width="3/4" ms="6" />
				<Skeleton height="6" width="3/4" ms="6" />
			</Stack>
		</Box>
	);
}

export function PageSkeleton() {
	return (
		<Box p="8">
			<Stack gap="4" maxW="md">
				<Skeleton height="8" width="48" />
				<Skeleton height="4" width="full" />
				<Skeleton height="4" width="3/4" />
			</Stack>
		</Box>
	);
}

export function PageError({
	error,
	onRetry,
}: {
	error: Error;
	onRetry: () => void;
}) {
	return (
		<Center h="full">
			<VStack gap="4">
				<Box color="fg.error" fontWeight="semibold">
					{m.somethingWentWrong()}
				</Box>
				<Box fontSize="sm" color="fg.muted">
					{error.message}
				</Box>
				<Button size="sm" onClick={onRetry}>
					{m.tryAgain()}
				</Button>
			</VStack>
		</Center>
	);
}
