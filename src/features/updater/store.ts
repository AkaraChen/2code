import { Channel, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
	checkUpdate as checkUpdateCommand,
	installUpdate as installUpdateCommand,
} from "@/generated";
import type {
	UpdateDownloadEvent,
	UpdateMetadata,
} from "@/generated/types";
import { useUpdaterSettingsStore } from "./settingsStore";

type UpdateChannel = "stable" | "beta";

export type UpdaterStatus =
	| "idle"
	| "checking"
	| "available"
	| "notAvailable"
	| "downloading"
	| "readyToRelaunch"
	| "error";

export type AvailableUpdateInfo = UpdateMetadata;

interface UpdaterStore {
	status: UpdaterStatus;
	update: AvailableUpdateInfo | null;
	error: string | null;
	downloaded: number;
	contentLength: number | null;
}

let hasPendingUpdate = false;
let checkingPromise: Promise<AvailableUpdateInfo | null> | null = null;
let pendingChannel: UpdateChannel | null = null;

export const useUpdaterStore = create<UpdaterStore>()(() => ({
	status: "idle",
	update: null,
	error: null,
	downloaded: 0,
	contentLength: null,
}));

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function resolveChannel(acceptBeta?: boolean): UpdateChannel {
	return acceptBeta ?? useUpdaterSettingsStore.getState().acceptBetaUpdates
		? "beta"
		: "stable";
}

function setDownloadProgress(
	event: UpdateDownloadEvent,
	state: { downloaded: number },
) {
	switch (event.event) {
		case "Started":
			useUpdaterStore.setState({
				contentLength: event.content_length ?? null,
				downloaded: 0,
			});
			break;
		case "Progress":
			state.downloaded += event.chunk_length;
			useUpdaterStore.setState({ downloaded: state.downloaded });
			break;
		case "Finished":
			useUpdaterStore.setState((current) => ({
				downloaded: current.contentLength ?? current.downloaded,
			}));
			break;
	}
}

export async function checkForUpdate(options: {
	acceptBeta?: boolean;
	force?: boolean;
	silent?: boolean;
	throwOnError?: boolean;
} = {}) {
	if (!isTauri()) {
		useUpdaterStore.setState({ status: "notAvailable", error: null });
		return null;
	}

	const channel = resolveChannel(options.acceptBeta);

	if (hasPendingUpdate && pendingChannel === channel && !options.force) {
		return useUpdaterStore.getState().update;
	}

	if (checkingPromise && !options.force) {
		return checkingPromise;
	}

	hasPendingUpdate = false;
	pendingChannel = null;

	useUpdaterStore.setState({
		status: "checking",
		error: null,
		downloaded: 0,
		contentLength: null,
	});

	const promise = checkUpdateCommand({ acceptBeta: channel === "beta" })
		.then((update) => {
			if (!update) {
				useUpdaterStore.setState({
					status: "notAvailable",
					update: null,
					error: null,
				});
				return null;
			}

			hasPendingUpdate = true;
			pendingChannel = channel;
			const info = update;
			useUpdaterStore.setState({
				status: "available",
				update: info,
				error: null,
			});
			return info;
		})
		.catch((error: unknown) => {
			if (!options.silent) {
				useUpdaterStore.setState({
					status: "error",
					error: getErrorMessage(error),
					update: null,
				});
			}
			else {
				useUpdaterStore.setState({
					status: "idle",
					error: null,
					update: null,
				});
			}
			hasPendingUpdate = false;
			pendingChannel = null;
			if (options.throwOnError) {
				throw error;
			}
			return null;
		})
		.finally(() => {
			if (checkingPromise === promise) {
				checkingPromise = null;
			}
		});

	checkingPromise = promise;
	return promise;
}

export async function downloadAndInstallUpdate() {
	if (!isTauri()) {
		const error = "Updater is only available inside the desktop app.";
		useUpdaterStore.setState({ status: "error", error });
		throw new Error(error);
	}

	if (!hasPendingUpdate) {
		await checkForUpdate({ force: true, throwOnError: true });
	}

	if (!hasPendingUpdate) {
		const error = "There is no update available to install.";
		useUpdaterStore.setState({ status: "notAvailable", error });
		throw new Error(error);
	}

	const progressState = { downloaded: 0 };
	const channel = new Channel<UpdateDownloadEvent>();
	channel.onmessage = (event) => {
		setDownloadProgress(event, progressState);
	};

	useUpdaterStore.setState({
		status: "downloading",
		error: null,
		downloaded: 0,
		contentLength: null,
	});

	try {
		await installUpdateCommand({ onEvent: channel });
		hasPendingUpdate = false;
		pendingChannel = null;
		useUpdaterStore.setState({
			status: "readyToRelaunch",
			error: null,
		});
	}
	catch (error) {
		useUpdaterStore.setState({
			status: "error",
			error: getErrorMessage(error),
		});
		throw error;
	}
}
