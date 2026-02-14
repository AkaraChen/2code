// Re-export from the unified tab store for backward compatibility
export {
	useTabStore as useTerminalStore,
	useTabProfileIds as useTerminalProfileIds,
	useProfileHasNotification,
} from "@/features/tabs/store";
