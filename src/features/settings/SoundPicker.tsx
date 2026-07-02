import { Button } from "@/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { use } from "react";
import { FiVolume2 } from "react-icons/fi";
import { listSystemSounds, playSystemSound } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { createCachedPromise } from "@/shared/lib/cachedPromise";
import { useNotificationStore } from "./stores/notificationStore";

const getSoundsPromise = createCachedPromise<string[]>(() =>
	listSystemSounds(),
);

export function SoundPicker() {
	const sounds = use(getSoundsPromise());
	const enabled = useNotificationStore((state) => state.enabled);
	const sound = useNotificationStore((state) => state.sound);
	const setSound = useNotificationStore((state) => state.setSound);
	const hasSounds = sounds.length > 0;

	return (
		<Field>
			<div className="flex items-center gap-2">
				<FieldLabel className="mb-0">{m.notificationSound()}</FieldLabel>
				<Button
					aria-label={m.preview()}
					size="icon-xs"
					variant="ghost"
					className="ml-auto opacity-60 hover:opacity-100"
					disabled={!enabled || !sound || !hasSounds}
					onClick={() => {
						if (sound) playSystemSound({ name: sound });
					}}
				>
					<FiVolume2 />
				</Button>
			</div>
			<NativeSelect
				value={hasSounds ? sound : ""}
				onChange={(event) => setSound(event.target.value)}
				disabled={!enabled || !hasSounds}
				size="sm"
			>
				{hasSounds ? (
					<>
						<NativeSelectOption value="">
							{m.notificationSoundNone()}
						</NativeSelectOption>
						{sounds.map((item) => (
							<NativeSelectOption key={item} value={item}>
								{item}
							</NativeSelectOption>
						))}
					</>
				) : (
					<NativeSelectOption value="">
						{m.soundPickerUnavailable()}
					</NativeSelectOption>
				)}
			</NativeSelect>
			{!hasSounds && (
				<FieldDescription>
					{m.soundPickerUnavailableDescription()}
				</FieldDescription>
			)}
		</Field>
	);
}
