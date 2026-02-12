import { Field, Skeleton, Stack, Switch, Text } from "@chakra-ui/react";
import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";
import { Suspense } from "react";
import * as m from "@/paraglide/messages.js";
import { SoundPicker } from "./SoundPicker";
import { useNotificationStore } from "./stores/notificationStore";

export function NotificationSettings() {
	const { enabled, setEnabled } = useNotificationStore();

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
		<Stack gap="6" maxW="md">
			<Field.Root>
				<Field.Label>{m.notificationEnabled()}</Field.Label>
				<Switch.Root
					checked={enabled}
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
