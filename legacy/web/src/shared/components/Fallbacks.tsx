import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { type ReactNode, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import * as m from "@/paraglide/messages.js";
import { asError } from "@/shared/lib/errors";

function ErrorStack({
	error,
	onRetry,
}: {
	error: Error;
	onRetry: () => void;
}) {
	return (
		<div className="flex min-w-0 max-w-md flex-col items-center gap-3 text-center">
			<div className="font-semibold text-destructive">
				{m.somethingWentWrong()}
			</div>
			<div className="break-words text-sm text-muted-foreground">
				{error.message}
			</div>
			<Button size="sm" onClick={onRetry}>
				{m.tryAgain()}
			</Button>
		</div>
	);
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
						})
					}
				>
					<Suspense fallback={fallback}>{children}</Suspense>
				</ErrorBoundary>
			)}
		</QueryErrorResetBoundary>
	);
}

export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" }) {
	return (
		<div className="flex flex-1 items-center justify-center">
			<Spinner className={size === "sm" ? "size-3.5" : "size-4"} />
		</div>
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
		<div className={size === "sm" ? "flex flex-1 items-center justify-center p-2" : "flex flex-1 items-center justify-center p-4"}>
			<ErrorStack error={error} onRetry={onRetry} />
		</div>
	);
}

export function SidebarSkeleton() {
	return (
		<aside className="w-[250px] shrink-0 border-r bg-muted/40 p-4">
			<div className="flex flex-col gap-3">
				<Skeleton className="h-6 w-full" />
				<Skeleton className="mt-2 h-3 w-1/2" />
				<Skeleton className="ml-5 h-5 w-3/4" />
				<Skeleton className="ml-5 h-5 w-3/4" />
				<Skeleton className="ml-5 h-5 w-3/4" />
			</div>
		</aside>
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
		<aside className="w-[250px] shrink-0 border-r bg-muted/40 p-4">
			<ErrorStack error={error} onRetry={onRetry} />
		</aside>
	);
}

export function PageSkeleton() {
	return (
		<div className="p-8">
			<div className="flex max-w-md flex-col gap-4">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
			</div>
		</div>
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
		<div className="p-8">
			<ErrorStack error={error} onRetry={onRetry} />
		</div>
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
		<div
			className="flex items-center justify-between gap-3 px-3"
			style={{ height, minHeight: height }}
		>
			<div className="min-w-0">
				<div className="text-sm font-semibold text-destructive">
					{m.somethingWentWrong()}
				</div>
				<div className="truncate text-xs text-muted-foreground">
					{error.message}
				</div>
			</div>
			<Button size="xs" className="shrink-0" onClick={onRetry}>
				{m.tryAgain()}
			</Button>
		</div>
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
		<div style={{ minHeight: minH }}>
			<div className="flex h-full items-center justify-center">
				<ErrorStack error={error} onRetry={onRetry} />
			</div>
		</div>
	);
}
