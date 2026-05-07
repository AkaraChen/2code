import {
	Badge,
	Box,
	Button,
	Field,
	HStack,
	Separator,
	Stack,
	Switch,
	Text,
} from "@chakra-ui/react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { FiDownload, FiRefreshCw } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import { toaster } from "@/shared/providers/appToaster";
import {
	checkForUpdate,
	downloadAndInstallUpdate,
	useUpdaterStore,
} from "@/features/updater/store";
import { useUpdaterSettingsStore } from "@/features/updater/settingsStore";
import { useLocale } from "@/shared/lib/locale";

function getRelativeTimeValue(date: Date) {
	const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
	const absSeconds = Math.abs(diffSeconds);

	if (absSeconds < 60) {
		return { value: diffSeconds, unit: "second" as const };
	}
	if (absSeconds < 60 * 60) {
		return { value: Math.round(diffSeconds / 60), unit: "minute" as const };
	}
	if (absSeconds < 60 * 60 * 24) {
		return { value: Math.round(diffSeconds / (60 * 60)), unit: "hour" as const };
	}
	if (absSeconds < 60 * 60 * 24 * 30) {
		return {
			value: Math.round(diffSeconds / (60 * 60 * 24)),
			unit: "day" as const,
		};
	}
	if (absSeconds < 60 * 60 * 24 * 365) {
		return {
			value: Math.round(diffSeconds / (60 * 60 * 24 * 30)),
			unit: "month" as const,
		};
	}
	return {
		value: Math.round(diffSeconds / (60 * 60 * 24 * 365)),
		unit: "year" as const,
	};
}

function formatReleaseDate(date: string | null | undefined, locale: string) {
	if (!date) {
		return null;
	}

	const parsed = new Date(date);
	if (Number.isNaN(parsed.getTime())) {
		return date;
	}

	const absoluteDate = new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
	}).format(parsed);
	const relativeTimeValue = getRelativeTimeValue(parsed);
	const relativeTime = new Intl.RelativeTimeFormat(locale, {
		numeric: "auto",
		style: "long",
	}).format(relativeTimeValue.value, relativeTimeValue.unit);

	return `${absoluteDate} (${relativeTime})`;
}

export function AboutSettings() {
	const { status, update, error } = useUpdaterStore();
	const { acceptBetaUpdates, setAcceptBetaUpdates } = useUpdaterSettingsStore();
	const locale = useLocale();
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

	const releaseDate = formatReleaseDate(update?.date, locale);
	const isChecking = status === "checking";
	const isDownloading = status === "downloading";
	const canInstall = status === "available" || status === "error";
	const showInstallUpdate = !!update && (canInstall || isDownloading);

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
					{showInstallUpdate && (
						<Button
							size="sm"
							disabled={!canInstall}
							loading={isDownloading}
							onClick={installUpdate}
						>
							<FiDownload />
							{m.installUpdate({ version: update.version })}
						</Button>
					)}
				</HStack>
			</Stack>
		</Stack>
	);
}
