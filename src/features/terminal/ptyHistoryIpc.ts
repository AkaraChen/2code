import { invoke } from "@tauri-apps/api/core";

export async function fetchPtySessionHistory(
	sessionId: string,
): Promise<Uint8Array> {
	const buffer = await invoke<ArrayBuffer>("get_pty_session_history", {
		sessionId,
	});
	return new Uint8Array(buffer);
}

export async function takeRestoredHistory(
	sessionId: string,
): Promise<Uint8Array> {
	const buffer = await invoke<ArrayBuffer>("take_restored_history", {
		sessionId,
	});
	return new Uint8Array(buffer);
}
