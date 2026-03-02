import { Field, Skeleton, Stack, Switch, Text } from "@chakra-ui/react";
import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";
import { Suspense } from "react";
import * as m from "@/paraglide/messages.js";
import { SoundPicker } from "./SoundPicker";
import { useSettingsStore } from "./stores";

export function NotificationSettings() {
	const notificationEnabled = useSettingsStore((s) => s.notificationEnabled);
	const setNotificationEnabled = useSettingsStore((s) => s.setNotificationEnabled);

	const handleToggle = async (checked: boolean) => {
		if (checked) {
			const permission = await isPermissionGranted();
			if (!permission) {
				const granted = await requestPermission();
				if (!granted) {
					console.warn("Notification permission denied");
					setNotificationEnabled(false);
					return;
				}
			}
		}
		setNotificationEnabled(checked);
	};

	return (
		<Stack gap="6" maxW="md">
			<Field.Root>
				<Field.Label>{m.notificationEnabled()}</Field.Label>
				<Switch.Root
					checked={notificationEnabled}
					onCheckedChange={(e) => handleToggle(!!e.checked)}
				>
					<Switch.HiddenInput />
					<Switch.Control />
					<Switch.Label>
						<Text fontSize="sm" color="fg.muted">
							{m.notificationEnabledDescription()}
						</Text>
					</Switch.Label>
				</Switch.Root>
			</Field.Root>
			<Suspense fallback={<Skeleton height="70px" />}>
				<SoundPicker />
			</Suspense>
		</Stack>
	);
}
