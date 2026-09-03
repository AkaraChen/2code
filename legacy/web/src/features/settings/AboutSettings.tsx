import {
	ArrowClockwiseIcon,
	ArrowUpRightIcon,
	DownloadSimpleIcon,
	GithubLogoIcon,
	TagIcon,
} from "@phosphor-icons/react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import appIcon from "@/assets/app-icon.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useUpdaterSettingsStore } from "@/features/updater/settingsStore";
import {
	checkForUpdate,
	downloadAndInstallUpdate,
	useUpdaterStore,
} from "@/features/updater/store";
import * as m from "@/paraglide/messages.js";
import { useLocale } from "@/shared/lib/locale";
import { formatReleaseDate } from "./releaseDate";

const REPO_URL = "https://github.com/AkaraChen/2code";
const RELEASES_URL = `${REPO_URL}/releases`;
const AUTHOR_NAME = "AkaraChen";
const AUTHOR_URL = `https://github.com/${AUTHOR_NAME}`;
const AUTHOR_AVATAR_URL = `https://github.com/${AUTHOR_NAME}.png?size=96`;
const COPYRIGHT_YEAR = new Date().getFullYear();

function openExternal(url: string) {
	void open(url).catch(() => {});
}

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

	const copyVersion = async () => {
		if (!appVersion) return;
		try {
			await writeText(appVersion);
			toast(m.aboutVersionCopied());
		} catch {
			// Clipboard unavailable — nothing actionable for the user.
		}
	};

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
		<div className="flex max-w-2xl flex-col gap-8">
			<section className="flex items-center gap-5">
				<img
					src={appIcon}
					alt="2code"
					draggable={false}
					className="size-20 shrink-0 select-none drop-shadow-md"
				/>
				<div className="flex min-w-0 flex-col gap-1.5">
					<div className="flex flex-wrap items-center gap-2.5">
						<h2 className="text-2xl font-semibold tracking-tight">
							2code
						</h2>
						{appVersion ? (
							<button
								type="button"
								onClick={copyVersion}
								className="cursor-pointer"
								title={appVersion}
							>
								<Badge variant="secondary">
									{m.currentVersion({ version: appVersion })}
								</Badge>
							</button>
						) : (
							<Skeleton className="h-5 w-24 rounded-full" />
						)}
					</div>
					<p className="text-pretty text-sm text-muted-foreground">
						{m.aboutAppDescription()}
					</p>
				</div>
			</section>

			<section className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					onClick={() => openExternal(REPO_URL)}
				>
					<GithubLogoIcon />
					{m.repository()}
					<ArrowUpRightIcon className="text-muted-foreground" />
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => openExternal(RELEASES_URL)}
				>
					<TagIcon />
					{m.releases()}
					<ArrowUpRightIcon className="text-muted-foreground" />
				</Button>
			</section>

			<section className="overflow-hidden rounded-xl border">
				<header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
					<h3 className="text-sm font-medium">{m.update()}</h3>
					{update ? (
						<Badge>
							{m.updateAvailableTitle({
								version: update.version,
							})}
						</Badge>
					) : status === "notAvailable" ? (
						<Badge
							variant="outline"
							className="text-muted-foreground"
						>
							{m.updateNotAvailableTitle()}
						</Badge>
					) : null}
				</header>
				<div className="flex flex-col gap-4 p-4">
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

					<div className="flex flex-col gap-1">
						{update ? (
							<>
								<p className="text-sm">
									{m.updateAvailableDescription({
										currentVersion: update.currentVersion,
										version: update.version,
									})}
								</p>
								{releaseDate ? (
									<p className="text-sm text-muted-foreground">
										{m.updateReleasedAt({
											date: releaseDate,
										})}
									</p>
								) : null}
							</>
						) : (
							<p className="text-sm text-muted-foreground">
								{status === "notAvailable"
									? m.updateNotAvailableDescription()
									: m.updateIdleDescription()}
							</p>
						)}
						{status === "error" && error ? (
							<p className="text-sm text-destructive">{error}</p>
						) : null}
					</div>

					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={isChecking || isDownloading}
							onClick={checkUpdate}
						>
							{isChecking ? <Spinner /> : <ArrowClockwiseIcon />}
							{m.checkForUpdates()}
						</Button>
						{showInstallUpdate ? (
							<Button
								size="sm"
								disabled={!canInstall || isDownloading}
								onClick={installUpdate}
							>
								{isDownloading ? (
									<Spinner />
								) : (
									<DownloadSimpleIcon />
								)}
								{m.installUpdate({ version: update.version })}
							</Button>
						) : null}
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-2">
				<h3 className="text-sm font-medium">{m.contributors()}</h3>
				<button
					type="button"
					onClick={() => openExternal(AUTHOR_URL)}
					className="group flex w-fit cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/60"
				>
					<img
						src={AUTHOR_AVATAR_URL}
						alt={AUTHOR_NAME}
						draggable={false}
						className="size-9 rounded-full border"
					/>
					<span className="flex flex-col">
						<span className="text-sm font-medium">
							{AUTHOR_NAME}
						</span>
						<span className="text-xs text-muted-foreground">
							{m.primaryContributorDescription()}
						</span>
					</span>
					<ArrowUpRightIcon className="ml-1 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
				</button>
			</section>

			<p className="text-xs text-muted-foreground">
				© {COPYRIGHT_YEAR} {AUTHOR_NAME}
			</p>
		</div>
	);
}
