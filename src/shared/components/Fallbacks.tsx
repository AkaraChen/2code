import { QueryErrorResetBoundary } from "@tanstack/react-query";
import {
	Box,
	Button,
	Dialog,
	Flex,
	Skeleton,
	Spinner,
	Stack,
	Text,
	VStack,
} from "@chakra-ui/react";
import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import * as m from "@/paraglide/messages.js";

function asError(error: unknown) {
	return error instanceof Error ? error : new Error(String(error));
}

function ErrorStack({
	error,
	onRetry,
	buttonSize = "sm",
}: {
	error: Error;
	onRetry: () => void;
	buttonSize?: "2xs" | "xs" | "sm";
}) {
	return (
		<VStack gap="3" textAlign="center" maxW="md" minW="0">
			<Box color="fg.error" fontWeight="semibold">
				{m.somethingWentWrong()}
			</Box>
			<Box fontSize="sm" color="fg.muted" wordBreak="break-word">
				{error.message}
			</Box>
			<Button size={buttonSize} onClick={onRetry}>
				{m.tryAgain()}
			</Button>
		</VStack>
	);
}

export function getErrorMessage(error: unknown) {
	return asError(error).message;
}

export function AsyncBoundary({
	children,
	errorFallback,
	fallback = null,
}: {
	children: ReactNode;
	errorFallback: (props: { error: Error; onRetry: () => void }) => ReactNode;
	fallback?: ReactNode;
}) {
	return (
		<QueryErrorResetBoundary>
			{({ reset }) => (
				<ErrorBoundary
					onReset={reset}
					fallbackRender={({ error, resetErrorBoundary }) =>
						errorFallback({
							error: asError(error),
							onRetry: resetErrorBoundary,
						})}
				>
					<Suspense fallback={fallback}>{children}</Suspense>
				</ErrorBoundary>
			)}
		</QueryErrorResetBoundary>
	);
}

export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" }) {
	return (
		<Flex flex="1" align="center" justify="center">
			<Spinner size={size} color="colorPalette.500" />
		</Flex>
	);
}

export function LoadingError({
	error,
	onRetry,
	size = "md",
}: {
	error: Error;
	onRetry: () => void;
	size?: "sm" | "md";
}) {
	return (
		<Flex
			flex="1"
			align="center"
			justify="center"
			p={size === "sm" ? "2" : "4"}
		>
			<ErrorStack
				error={error}
				onRetry={onRetry}
				buttonSize={size === "sm" ? "2xs" : "sm"}
			/>
		</Flex>
	);
}

export function SidebarSkeleton() {
	return (
		<Box
			w="250px"
			flexShrink={0}
			bg="bg.subtle"
			borderRight="1px solid"
			borderColor="border.subtle"
			p="4"
		>
			<Stack gap="3">
				<Skeleton height="6" width="full" />
				<Skeleton height="3" width="1/2" mt="2" />
				<Skeleton height="5" width="3/4" ms="5" />
				<Skeleton height="5" width="3/4" ms="5" />
				<Skeleton height="5" width="3/4" ms="5" />
			</Stack>
		</Box>
	);
}

export function SidebarError({
	error,
	onRetry,
}: {
	error: Error;
	onRetry: () => void;
}) {
	return (
		<Box
			w="250px"
			flexShrink={0}
			bg="bg.subtle"
			borderRight="1px solid"
			borderColor="border.subtle"
			p="4"
		>
			<ErrorStack error={error} onRetry={onRetry} buttonSize="xs" />
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
		<Box p="8">
			<ErrorStack error={error} onRetry={onRetry} />
		</Box>
	);
}

export function InlineError({
	error,
	height,
	onRetry,
}: {
	error: Error;
	height: string;
	onRetry: () => void;
}) {
	return (
		<Flex
			h={height}
			minH={height}
			align="center"
			justify="space-between"
			gap="3"
			px="3"
		>
			<Box minW="0">
				<Text color="fg.error" fontSize="sm" fontWeight="semibold">
					{m.somethingWentWrong()}
				</Text>
				<Text color="fg.muted" fontSize="xs" truncate>
					{error.message}
				</Text>
			</Box>
			<Button size="xs" flexShrink={0} onClick={onRetry}>
				{m.tryAgain()}
			</Button>
		</Flex>
	);
}

export function DialogBodyError({
	error,
	minH = "200px",
	onRetry,
}: {
	error: Error;
	minH?: string;
	onRetry: () => void;
}) {
	return (
		<Dialog.Body>
			<Stack alignItems="center" justifyContent="center" minH={minH}>
				<ErrorStack error={error} onRetry={onRetry} />
			</Stack>
		</Dialog.Body>
	);
}
