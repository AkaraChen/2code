import { Field, Switch, Text } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useSidebarSettingsStore } from "./stores/sidebarSettingsStore";

export function SidebarAppearanceSettings() {
	const { showProjectAvatars, setShowProjectAvatars } =
		useSidebarSettingsStore();

	return (
		<Field.Root>
			<Field.Label>{m.showProjectAvatars()}</Field.Label>
			<Switch.Root
				checked={showProjectAvatars}
				onCheckedChange={(e) =>
					setShowProjectAvatars(!!e.checked)
				}
			>
				<Switch.HiddenInput />
				<Switch.Control />
				<Switch.Label>
					<Text fontSize="sm" color="fg.muted">
						{m.showProjectAvatarsDescription()}
					</Text>
				</Switch.Label>
			</Switch.Root>
		</Field.Root>
	);
}
