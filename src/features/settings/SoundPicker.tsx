import {
	createListCollection,
	Field,
	Flex,
	IconButton,
	Portal,
	Select,
} from "@chakra-ui/react";
import { use, useMemo } from "react";
import { RiVolumeUpLine } from "react-icons/ri";
import { listSystemSounds, playSystemSound } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { createCachedPromise } from "@/shared/lib/cachedPromise";
import { useSettingsStore } from "./stores";

const getSoundsPromise = createCachedPromise<string[]>(() =>
	listSystemSounds(),
);

export function SoundPicker() {
	const sounds = use(getSoundsPromise());
	const notificationEnabled = useSettingsStore((s) => s.notificationEnabled);
	const notificationSound = useSettingsStore((s) => s.notificationSound);
	const setNotificationSound = useSettingsStore((s) => s.setNotificationSound);

	const soundCollection = useMemo(
		() =>
			createListCollection({
				items: [
					{ value: "", label: m.notificationSoundNone() },
					...sounds.map((s) => ({ value: s, label: s })),
				],
			}),
		[sounds],
	);

	return (
		<Field.Root>
			<Flex align="center">
				<Field.Label mb="0">{m.notificationSound()}</Field.Label>
				<IconButton
					aria-label={m.preview()}
					size="2xs"
					variant="ghost"
					ml="auto"
					opacity={0.5}
					_hover={{ opacity: 1 }}
					disabled={!notificationEnabled || !sound}
					onClick={() => {
						if (sound) playSystemSound({ name: sound });
					}}
				>
					<RiVolumeUpLine />
				</IconButton>
			</Flex>
			<Select.Root
				collection={soundCollection}
				value={notificationSound ? [notificationSound] : []}
				onValueChange={(e) => {
					setNotificationSound(e.value[0]);
					if (e.value[0]) playSystemSound({ name: e.value[0] });
				}}
				disabled={!notificationEnabled}
				size="sm"
			>
				<Select.HiddenSelect />
				<Select.Control>
					<Select.Trigger>
						<Select.ValueText />
					</Select.Trigger>
					<Select.IndicatorGroup>
						<Select.Indicator />
					</Select.IndicatorGroup>
				</Select.Control>
				<Portal>
					<Select.Positioner>
						<Select.Content>
							{soundCollection.items.map((item) => (
								<Select.Item item={item} key={item.value}>
									{item.label}
									<Select.ItemIndicator />
								</Select.Item>
							))}
						</Select.Content>
					</Select.Positioner>
				</Portal>
			</Select.Root>
		</Field.Root>
	);
}
