import SettingsPage from "./SettingsPage";
import { useLocale } from "@/shared/lib/locale";

// Root of the dedicated "settings" webview window — renders only the
// settings UI, without the sidebar, terminal layer, or file watcher.
export default function SettingsWindow() {
	useLocale();
	return (
		<div className="h-full bg-card text-foreground">
			<SettingsPage />
		</div>
	);
}
