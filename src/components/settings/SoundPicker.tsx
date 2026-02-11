import { Field, Flex, IconButton, NativeSelect } from "@chakra-ui/react";
import { use } from "react";
import { RiVolumeUpLine } from "react-icons/ri";
import { notificationApi } from "@/api/notification";
import { createCachedPromise } from "@/lib/cachedPromise";
import * as m from "@/paraglide/messages.js";
import { useNotificationStore } from "@/stores/notificationStore";

const getSoundsPromise = createCachedPromise<string[]>(() =>
	notificationApi.listSystemSounds(),
);

export function SoundPicker() {
	const sounds = use(getSoundsPromise());
	const { enabled, sound, setSound } = useNotificationStore();

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
					disabled={!enabled || !sound}
					onClick={() => {
						if (sound) notificationApi.playSystemSound(sound);
					}}
				>
					<RiVolumeUpLine />
				</IconButton>
			</Flex>
			<NativeSelect.Root disabled={!enabled}>
				<NativeSelect.Field
					value={sound}
					onChange={(e) => setSound(e.target.value)}
				>
					<option value="">{m.notificationSoundNone()}</option>
					{sounds.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</NativeSelect.Field>
				<NativeSelect.Indicator />
			</NativeSelect.Root>
		</Field.Root>
	);
}
