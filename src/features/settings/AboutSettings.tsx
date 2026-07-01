import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { FiDownload, FiRefreshCw } from "react-icons/fi";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
	checkForUpdate,
	downloadAndInstallUpdate,
	useUpdaterStore,
} from "@/features/updater/store";
import { useUpdaterSettingsStore } from "@/features/updater/settingsStore";
import * as m from "@/paraglide/messages.js";
import { useLocale } from "@/shared/lib/locale";
import { formatReleaseDate } from "./releaseDate";

export function AboutSettings() {
	const status = useUpdaterStore((state) => state.status);
	const update = useUpdaterStore((state) => state.update);
	const error = useUpdaterStore((state) => state.error);
	const acceptBetaUpdates = useUpdaterSettingsStore(
		(state) => state.acceptBetaUpdates,
	);
	const setAcceptBetaUpdates = useUpdaterSettingsStore(
		(state) => state.setAcceptBetaUpdates,
	);
	const locale = useLocale();
	const [appVersion, setAppVersion] = useState<string | null>(() =>
		isTauri() ? null : "dev",
	);

	useEffect(() => {
		if (!isTauri()) return;

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
			toast(
				nextUpdate
					? m.updateAvailableTitle({ version: nextUpdate.version })
					: m.updateNotAvailableTitle(),
				{
					description: nextUpdate
						? m.updateAvailableDescription({
								currentVersion: nextUpdate.currentVersion,
								version: nextUpdate.version,
							})
						: m.updateNotAvailableDescription(),
				},
			);
		} catch (checkError) {
			toast.error(m.updateCheckFailedTitle(), {
				description:
					checkError instanceof Error
						? checkError.message
						: String(checkError),
			});
		}
	};

	const installUpdate = async () => {
		try {
			await downloadAndInstallUpdate();
		} catch (installError) {
			toast.error(m.updateInstallFailedTitle(), {
				description:
					installError instanceof Error
						? installError.message
						: String(installError),
			});
		}
	};

	const releaseDate = formatReleaseDate(update?.date, locale);
	const isChecking = status === "checking";
	const isDownloading = status === "downloading";
	const canInstall = status === "available" || status === "error";
	const showInstallUpdate = !!update && (canInstall || isDownloading);

	return (
		<div className="flex max-w-2xl flex-col gap-6">
			<section className="flex flex-col gap-2">
				<div className="flex flex-wrap items-baseline gap-3">
					<h2 className="text-2xl font-semibold">2code</h2>
					<Badge variant="secondary">
						{appVersion
							? m.currentVersion({ version: appVersion })
							: m.fileTreeLoading()}
					</Badge>
				</div>
				<p className="text-sm text-muted-foreground">
					{m.aboutAppDescription()}
				</p>
			</section>

			<Separator />

			<section className="flex flex-col gap-3">
				<h3 className="font-medium">{m.update()}</h3>
				<Field orientation="horizontal">
					<FieldContent>
						<FieldLabel>{m.acceptBetaUpdates()}</FieldLabel>
						<FieldDescription>
							{m.acceptBetaUpdatesDescription()}
						</FieldDescription>
					</FieldContent>
					<Switch
						checked={acceptBetaUpdates}
						onCheckedChange={setAcceptBetaUpdates}
					/>
				</Field>
				<div>
					{update ? (
						<div className="flex flex-col gap-1">
							<p className="text-sm">
								{m.updateAvailableDescription({
									currentVersion: update.currentVersion,
									version: update.version,
								})}
							</p>
							{releaseDate ? (
								<p className="text-sm text-muted-foreground">
									{m.updateReleasedAt({ date: releaseDate })}
								</p>
							) : null}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							{status === "notAvailable"
								? m.updateNotAvailableDescription()
								: m.updateIdleDescription()}
						</p>
					)}
					{status === "error" && error ? (
						<p className="mt-2 text-sm text-destructive">{error}</p>
					) : null}
				</div>

				<div className="flex flex-wrap gap-3">
					<Button
						size="sm"
						variant="outline"
						disabled={isChecking || isDownloading}
						onClick={checkUpdate}
					>
						{isChecking ? <Spinner /> : <FiRefreshCw />}
						{m.checkForUpdates()}
					</Button>
					{showInstallUpdate ? (
						<Button
							size="sm"
							disabled={!canInstall || isDownloading}
							onClick={installUpdate}
						>
							{isDownloading ? <Spinner /> : <FiDownload />}
							{m.installUpdate({ version: update.version })}
						</Button>
					) : null}
				</div>
			</section>
		</div>
	);
}
