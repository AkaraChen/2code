import { attachConsole } from "@tauri-apps/plugin-log";

/**
 * Initialize Tauri logger to forward console logs to backend.
 *
 * After calling this, all console.log/info/warn/error calls are
 * automatically forwarded to the Tauri backend and written to:
 * - stdout (always)
 * - app.log file (dev mode only)
 */
export function initLogger(): void {
	attachConsole();
}
