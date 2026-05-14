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
}

let hasPendingUpdate = false;
let checkingPromise: Promise<AvailableUpdateInfo | null> | null = null;
let pendingChannel: UpdateChannel | null = null;

export const useUpdaterStore = create<UpdaterStore>()(() => ({
	status: "idle",
	update: null,
	error: null,
}));

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function resolveChannel(acceptBeta?: boolean): UpdateChannel {
	return acceptBeta ?? useUpdaterSettingsStore.getState().acceptBetaUpdates
		? "beta"
		: "stable";
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

	const channel = new Channel<UpdateDownloadEvent>();

	useUpdaterStore.setState({
		status: "downloading",
		error: null,
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
