import { Flex, Spinner, Text } from "@chakra-ui/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileDiffMetadata } from "@pierre/diffs";
import { useMemo } from "react";
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

		const baseUrl =
			typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
				? convertFileSrc(previewQuery.data.file_path)
				: previewQuery.data.file_path;
		const separator = baseUrl.includes("?") ? "&" : "?";

		return `${baseUrl}${separator}v=${encodeURIComponent(revision)}`;
	}, [previewQuery.data, revision]);

	return { ...previewQuery, assetUrl };
}

function BinaryPreviewPane({
	label,
	path,
	assetUrl,
	isLoading,
}: {
	label: string;
	path: string;
	assetUrl: string | null;
	isLoading: boolean;
}) {
	return (
		<Flex
			flex="1"
			minH={{ base: "18rem", lg: "24rem" }}
			direction="column"
			borderWidth="1px"
			borderColor="border.subtle"
			borderRadius="lg"
			overflow="hidden"
			bg="bg.panel"
		>
			<Flex
				align="center"
				justify="space-between"
				gap="3"
				px="3"
				py="2.5"
				borderBottomWidth="1px"
				borderColor="border.subtle"
				bg="bg.subtle"
			>
				<Text
					fontSize="xs"
					fontWeight="semibold"
					letterSpacing="widest"
					textTransform="uppercase"
					color="fg.muted"
				>
					{label}
				</Text>
				<Text fontSize="xs" fontFamily="mono" color="fg.muted" truncate>
					{path}
				</Text>
			</Flex>

			<Flex
				flex="1"
				align="center"
				justify="center"
				p="4"
				minH="0"
				bgImage={[
					"linear-gradient(45deg, rgba(127, 127, 127, 0.08) 25%, transparent 25%)",
					"linear-gradient(-45deg, rgba(127, 127, 127, 0.08) 25%, transparent 25%)",
					"linear-gradient(45deg, transparent 75%, rgba(127, 127, 127, 0.08) 75%)",
					"linear-gradient(-45deg, transparent 75%, rgba(127, 127, 127, 0.08) 75%)",
				].join(", ")}
				bgSize="16px 16px"
				css={{ backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0" }}
			>
				{isLoading ? (
					<Spinner size="sm" color="colorPalette.500" />
				) : assetUrl ? (
					<img
						src={assetUrl}
						alt={path}
						style={{
							maxWidth: "100%",
							maxHeight: "70vh",
							objectFit: "contain",
							borderRadius: "0.375rem",
							boxShadow:
								"var(--chakra-shadows-md, 0 4px 6px rgba(0, 0, 0, 0.1))",
						}}
					/>
				) : (
					<Text fontSize="sm" color="fg.muted">
						{m.gitDiffImagePreviewUnavailable()}
					</Text>
				)}
			</Flex>
		</Flex>
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
		<Flex
			flex="1"
			minH="0"
			direction={{ base: "column", xl: "row" }}
			gap="4"
			p="4"
			overflow="auto"
		>
			{beforePath && beforeMimeType ? (
				<BinaryPreviewPane
					label={m.gitDiffImagePreviewBefore()}
					path={beforePath}
					assetUrl={beforePreview.assetUrl}
					isLoading={beforePreview.isLoading}
				/>
			) : null}

			{afterPath && afterMimeType ? (
				<BinaryPreviewPane
					label={m.gitDiffImagePreviewAfter()}
					path={afterPath}
					assetUrl={afterPreview.assetUrl}
					isLoading={afterPreview.isLoading}
				/>
			) : null}
		</Flex>
	);
}
