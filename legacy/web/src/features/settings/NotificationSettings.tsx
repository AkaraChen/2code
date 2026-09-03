import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "@/components/ui/field";
import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";
import * as m from "@/paraglide/messages.js";
import { AsyncBoundary, InlineError } from "@/shared/components/Fallbacks";
import { SoundPicker } from "./SoundPicker";
import { useNotificationStore } from "./stores/notificationStore";

export function NotificationSettings() {
	const enabled = useNotificationStore((state) => state.enabled);
	const setEnabled = useNotificationStore((state) => state.setEnabled);

	const handleToggle = async (checked: boolean) => {
		if (checked) {
			const granted = await isPermissionGranted();
			if (!granted) {
				const permission = await requestPermission();
				if (permission !== "granted") {
					return;
				}
			}
		}
		setEnabled(checked);
	};

	return (
		<div className="flex max-w-md flex-col gap-6">
			<Field orientation="horizontal">
				<FieldContent>
					<FieldLabel>{m.notificationEnabled()}</FieldLabel>
					<FieldDescription>
						{m.notificationEnabledDescription()}
					</FieldDescription>
				</FieldContent>
				<Switch
					checked={enabled}
					onCheckedChange={(checked) => void handleToggle(checked)}
				/>
			</Field>
			<AsyncBoundary
				fallback={<Skeleton className="h-[70px]" />}
				errorFallback={({ error, onRetry }) => (
					<InlineError error={error} height="70px" onRetry={onRetry} />
				)}
			>
				<SoundPicker />
			</AsyncBoundary>
		</div>
	);
}
