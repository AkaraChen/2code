import { Switch } from "@/components/ui/switch";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "@/components/ui/field";
import * as m from "@/paraglide/messages.js";
import { useSidebarSettingsStore } from "./stores/sidebarSettingsStore";

export function SidebarAppearanceSettings() {
	const showProjectAvatars = useSidebarSettingsStore(
		(state) => state.showProjectAvatars,
	);
	const setShowProjectAvatars = useSidebarSettingsStore(
		(state) => state.setShowProjectAvatars,
	);

	return (
		<Field orientation="horizontal">
			<FieldContent>
				<FieldLabel>{m.showProjectAvatars()}</FieldLabel>
				<FieldDescription>
					{m.showProjectAvatarsDescription()}
				</FieldDescription>
			</FieldContent>
			<Switch
				checked={showProjectAvatars}
				onCheckedChange={setShowProjectAvatars}
			/>
		</Field>
	);
}
