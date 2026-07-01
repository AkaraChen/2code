import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileDiffMetadata } from "@pierre/diffs";
import { useMemo } from "react";
import { Spinner } from "@/components/ui/spinner";
import * as m from "@/paraglide/messages.js";
import { useGitBinaryPreview } from "../hooks";
import {
	type GitBinaryPreviewSource,
	getGitBinaryPreviewPath,
	getGitBinaryPreviewRevision,
	getPreviewableImageMimeType,
	gitBinaryPreviewSources,
} from "../utils";

export interface GitPreviewContextWorkingTree {
	kind: "working-tree";
	profileId: string;
}

export interface GitPreviewContextCommit {
	kind: "commit";
	profileId: string;
	commitHash: string;
}

export type GitPreviewContext =
	| GitPreviewContextWorkingTree
	| GitPreviewContextCommit;

function useBinaryPreviewUrl({
	profileId,
	path,
	source,
	commitHash,
	revision,
	mimeType,
}: {
	profileId: string;
	path: string | null;
	source: GitBinaryPreviewSource;
	commitHash?: string;
	revision: string | null;
	mimeType: string | null;
}) {
	const previewQuery = useGitBinaryPreview(
		path && mimeType && revision
			? { profileId, path, source, commitHash, revision }
			: null,
	);

	const assetUrl = useMemo(() => {
		if (!previewQuery.data?.file_path || revision == null) {
			return null;
		}

		const baseUrl = convertFileSrc(previewQuery.data.file_path);
		const separator = baseUrl.includes("?") ? "&" : "?";

		return `${baseUrl}${separator}v=${encodeURIComponent(revision)}`;
	}, [previewQuery.data, revision]);

	return { ...previewQuery, assetUrl };
}

function BinaryPreviewPane({
	error,
	label,
	path,
	assetUrl,
	isError,
	isLoading,
}: {
	error: unknown;
	label: string;
	path: string;
	assetUrl: string | null;
	isError: boolean;
	isLoading: boolean;
}) {
	return (
		<div className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-lg border bg-card lg:min-h-96">
			<div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-3 py-2.5">
				<p className="text-xs font-semibold uppercase text-muted-foreground">
					{label}
				</p>
				<p className="truncate font-mono text-xs text-muted-foreground">
					{path}
				</p>
			</div>

			<div
				className="flex min-h-0 flex-1 items-center justify-center p-4"
				style={{
					backgroundImage: [
					"linear-gradient(45deg, rgba(127, 127, 127, 0.08) 25%, transparent 25%)",
					"linear-gradient(-45deg, rgba(127, 127, 127, 0.08) 25%, transparent 25%)",
					"linear-gradient(45deg, transparent 75%, rgba(127, 127, 127, 0.08) 75%)",
					"linear-gradient(-45deg, transparent 75%, rgba(127, 127, 127, 0.08) 75%)",
					].join(", "),
					backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
					backgroundSize: "16px 16px",
				}}
			>
				{isLoading ? (
					<Spinner className="size-4" />
				) : isError ? (
					<p className="text-center text-sm text-muted-foreground">
						{error instanceof Error ? error.message : String(error)}
					</p>
				) : assetUrl ? (
					<img
						src={assetUrl}
						alt={path}
						style={{
							maxWidth: "100%",
							maxHeight: "70vh",
							objectFit: "contain",
							borderRadius: "0.375rem",
							boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
						}}
					/>
				) : (
					<p className="text-sm text-muted-foreground">
						{m.gitDiffImagePreviewUnavailable()}
					</p>
				)}
			</div>
		</div>
	);
}

export function BinaryImageDiffPreview({
	file,
	previewContext,
}: {
	file: FileDiffMetadata;
	previewContext: GitPreviewContext;
}) {
	const beforePath = getGitBinaryPreviewPath(file, "before");
	const afterPath = getGitBinaryPreviewPath(file, "after");
	const beforeMimeType =
		beforePath == null ? null : getPreviewableImageMimeType(beforePath);
	const afterMimeType =
		afterPath == null ? null : getPreviewableImageMimeType(afterPath);
	const beforeRevision =
		beforePath == null ? null : getGitBinaryPreviewRevision(file, "before");
	const afterRevision =
		afterPath == null ? null : getGitBinaryPreviewRevision(file, "after");

	const beforePreview = useBinaryPreviewUrl({
		profileId: previewContext.profileId,
		path: beforePath,
		source:
			previewContext.kind === "working-tree"
				? gitBinaryPreviewSources.head
				: gitBinaryPreviewSources.parentCommit,
		commitHash:
			previewContext.kind === "commit" ? previewContext.commitHash : undefined,
		revision: beforeRevision,
		mimeType: beforeMimeType,
	});
	const afterPreview = useBinaryPreviewUrl({
		profileId: previewContext.profileId,
		path: afterPath,
		source:
			previewContext.kind === "working-tree"
				? gitBinaryPreviewSources.workingTree
				: gitBinaryPreviewSources.commit,
		commitHash:
			previewContext.kind === "commit" ? previewContext.commitHash : undefined,
		revision: afterRevision,
		mimeType: afterMimeType,
	});

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 xl:flex-row">
			{beforePath && beforeMimeType ? (
				<BinaryPreviewPane
					label={m.gitDiffImagePreviewBefore()}
					path={beforePath}
					assetUrl={beforePreview.assetUrl}
					error={beforePreview.error}
					isError={beforePreview.isError}
					isLoading={beforePreview.isLoading}
				/>
			) : null}

			{afterPath && afterMimeType ? (
				<BinaryPreviewPane
					label={m.gitDiffImagePreviewAfter()}
					path={afterPath}
					assetUrl={afterPreview.assetUrl}
					error={afterPreview.error}
					isError={afterPreview.isError}
					isLoading={afterPreview.isLoading}
				/>
			) : null}
		</div>
	);
}
