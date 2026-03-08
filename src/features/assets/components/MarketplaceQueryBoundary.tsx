import { Button, EmptyState, Text } from "@chakra-ui/react";
import { QueryErrorResetBoundary } from "@tanstack/react-query";
import * as React from "react";
import { Suspense } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import * as m from "@/paraglide/messages.js";

function MarketplaceErrorFallback({
	error,
	resetErrorBoundary,
}: FallbackProps) {
	const message = error instanceof Error ? error.message : String(error);

	return (
		<EmptyState.Root>
			<EmptyState.Content>
				<EmptyState.Description>
					{m.somethingWentWrong()}
				</EmptyState.Description>
				<Text fontSize="sm" color="fg.muted">
					{message}
				</Text>
				<Button size="sm" onClick={resetErrorBoundary}>
					{m.tryAgain()}
				</Button>
			</EmptyState.Content>
		</EmptyState.Root>
	);
}

export function MarketplaceQueryBoundary({
	children,
	loadingFallback,
}: {
	children: React.ReactNode;
	loadingFallback: React.ReactNode;
}) {
	return (
		<QueryErrorResetBoundary>
			{({ reset }) => (
				<ErrorBoundary
					onReset={reset}
					FallbackComponent={MarketplaceErrorFallback}
				>
					<Suspense fallback={loadingFallback}>{children}</Suspense>
				</ErrorBoundary>
			)}
		</QueryErrorResetBoundary>
	);
}
