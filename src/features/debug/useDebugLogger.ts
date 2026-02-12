import { Channel } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { startDebugLog, stopDebugLog } from "@/generated";
import type { LogEntry } from "@/generated/types";
import { useDebugLogStore } from "./debugLogStore";
import { useDebugStore } from "./debugStore";

export function useDebugLogger() {
	const enabled = useDebugStore((s) => s.enabled);

	useEffect(() => {
		if (!enabled) return;

		const channel = new Channel<LogEntry>();
		channel.onmessage = (entry) => {
			useDebugLogStore.getState().addLog(entry);
		};

		startDebugLog({ onEvent: channel });

		return () => {
			stopDebugLog();
		};
	}, [enabled]);
}
