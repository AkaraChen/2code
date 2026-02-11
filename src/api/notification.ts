import { invoke } from "@tauri-apps/api/core";

export {
	isPermissionGranted,
	requestPermission,
	sendNotification,
} from "@tauri-apps/plugin-notification";

export const notificationApi = {
	listSystemSounds: () => invoke<string[]>("list_system_sounds"),
	playSystemSound: (name: string) =>
		invoke<void>("play_system_sound", { name }),
};
