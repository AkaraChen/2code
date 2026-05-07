import {
	Badge,
	Box,
	Button,
	Field,
	HStack,
	Progress,
	Separator,
	Stack,
	Switch,
	Text,
} from "@chakra-ui/react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useMemo, useState } from "react";
import { FiDownload, FiExternalLink, FiRefreshCw } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import { toaster } from "@/shared/providers/appToaster";
import {
	checkForUpdate,
	downloadAndInstallUpdate,
	useUpdaterStore,
} from "@/features/updater/store";
import { useUpdaterSettingsStore } from "@/features/updater/settingsStore";

const REPOSITORY_URL = "https://github.com/AkaraChen/2code";
const WEBSITE_URL = "https://2code.akr.moe/";

function formatReleaseDate(date: string | null | undefined) {
	if (!date) {
		return null;
	}

	const parsed = new Date(date);
	if (Number.isNaN(parsed.getTime())) {
		return date;
	}

	return parsed.toLocaleDateString();
}

export function AboutSettings() {
	const { status, update, error, downloaded, contentLength } = useUpdaterStore();
	const { acceptBetaUpdates, setAcceptBetaUpdates } = useUpdaterSettingsStore();
	const [appVersion, setAppVersion] = useState<string | null>(() =>
		isTauri() ? null : "dev",
	);

	useEffect(() => {
		if (!isTauri()) {
			return;
		}

		void getVersion()
			.then(setAppVersion)
			.catch(() => setAppVersion(null));
	}, []);

	const progressValue = useMemo(() => {
		if (!contentLength) {
			return null;
		}
		return Math.min(100, Math.round((downloaded / contentLength) * 100));
	}, [contentLength, downloaded]);

	const checkUpdate = async () => {
		try {
			const nextUpdate = await checkForUpdate({
				force: true,
				throwOnError: true,
			});
			toaster.create({
				type: nextUpdate ? "info" : "success",
				title: nextUpdate
					? m.updateAvailableTitle({ version: nextUpdate.version })
					: m.updateNotAvailableTitle(),
				description: nextUpdate
					? m.updateAvailableDescription({
							currentVersion: nextUpdate.currentVersion,
							version: nextUpdate.version,
						})
					: m.updateNotAvailableDescription(),
				closable: true,
			});
		}
		catch (checkError) {
			toaster.create({
				type: "error",
				title: m.updateCheckFailedTitle(),
				description:
					checkError instanceof Error ? checkError.message : String(checkError),
				closable: true,
			});
		}
	};

	const installUpdate = async () => {
		try {
			await downloadAndInstallUpdate();
		}
		catch (installError) {
			toaster.create({
				type: "error",
				title: m.updateInstallFailedTitle(),
				description:
					installError instanceof Error
						? installError.message
						: String(installError),
				closable: true,
			});
		}
	};

	const openExternalUrl = async (url: string) => {
		if (isTauri()) {
			await open(url);
			return;
		}
		window.open(url, "_blank", "noopener,noreferrer");
	};

	const releaseDate = formatReleaseDate(update?.date);
	const isChecking = status === "checking";
	const isDownloading = status === "downloading";
	const canInstall = status === "available" || status === "error";

	return (
		<Stack gap="6" maxW="2xl">
			<Stack gap="2">
				<HStack gap="3" align="baseline" wrap="wrap">
					<Text fontSize="2xl" fontWeight="semibold">
						2code
					</Text>
					<Badge variant="subtle">
						{appVersion
							? m.currentVersion({ version: appVersion })
							: m.fileTreeLoading()}
					</Badge>
				</HStack>
				<Text color="fg.muted">{m.aboutAppDescription()}</Text>
			</Stack>

			<Separator />

			<Stack gap="3">
				<Text fontWeight="medium">{m.update()}</Text>
				<Field.Root>
					<Field.Label>{m.acceptBetaUpdates()}</Field.Label>
					<Switch.Root
						checked={acceptBetaUpdates}
						onCheckedChange={(e) => setAcceptBetaUpdates(!!e.checked)}
					>
						<Switch.HiddenInput />
						<Switch.Control />
						<Switch.Label>
							<Text fontSize="sm" color="fg.muted">
								{m.acceptBetaUpdatesDescription()}
							</Text>
						</Switch.Label>
					</Switch.Root>
				</Field.Root>
				<Box>
					{update ? (
						<Stack gap="1">
							<Text fontSize="sm">
								{m.updateAvailableDescription({
									currentVersion: update.currentVersion,
									version: update.version,
								})}
							</Text>
							{releaseDate && (
								<Text fontSize="sm" color="fg.muted">
									{m.updateReleasedAt({ date: releaseDate })}
								</Text>
							)}
							{update.body && (
								<Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap">
									{update.body}
								</Text>
							)}
						</Stack>
					) : (
						<Text fontSize="sm" color="fg.muted">
							{status === "notAvailable"
								? m.updateNotAvailableDescription()
								: m.updateIdleDescription()}
						</Text>
					)}
					{status === "error" && error && (
						<Text mt="2" fontSize="sm" color="red.fg">
							{error}
						</Text>
					)}
				</Box>

				{isDownloading && (
					<Progress.Root value={progressValue ?? undefined} size="sm">
						<Progress.Track>
							<Progress.Range />
						</Progress.Track>
					</Progress.Root>
				)}

				<HStack gap="3" wrap="wrap">
					<Button
						size="sm"
						variant="outline"
						loading={isChecking}
						disabled={isDownloading}
						onClick={checkUpdate}
					>
						<FiRefreshCw />
						{m.checkForUpdates()}
					</Button>
					<Button
						size="sm"
						disabled={!canInstall || !update}
						loading={isDownloading}
						onClick={installUpdate}
					>
						<FiDownload />
						{update
							? m.installUpdate({ version: update.version })
							: m.installUpdateUnavailable()}
					</Button>
				</HStack>
			</Stack>

			<Separator />

			<Stack gap="3">
				<Text fontWeight="medium">{m.contributors()}</Text>
				<Stack gap="1">
					<Text fontSize="sm" fontWeight="medium">
						AkaraChen
					</Text>
					<Text fontSize="sm" color="fg.muted">
						{m.primaryContributorDescription()}
					</Text>
				</Stack>
				<HStack gap="3" wrap="wrap">
					<Button
						size="sm"
						variant="outline"
						onClick={() => void openExternalUrl(REPOSITORY_URL)}
					>
						<FiExternalLink />
						{m.repository()}
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => void openExternalUrl(WEBSITE_URL)}
					>
						<FiExternalLink />
						{m.website()}
					</Button>
				</HStack>
			</Stack>
		</Stack>
	);
}
