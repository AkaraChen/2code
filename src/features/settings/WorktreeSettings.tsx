import {
	Button,
	Field,
	HStack,
	IconButton,
	Input,
	Text,
} from "@chakra-ui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { FiFolder, FiX } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import { useWorktreeSettingsStore } from "./stores/worktreeSettingsStore";

export function WorktreeSettings() {
	const defaultWorktreeDir = useWorktreeSettingsStore(
		(state) => state.defaultWorktreeDir,
	);
	const setDefaultWorktreeDir = useWorktreeSettingsStore(
		(state) => state.setDefaultWorktreeDir,
	);
	const clearDefaultWorktreeDir = useWorktreeSettingsStore(
		(state) => state.clearDefaultWorktreeDir,
	);

	const handleChooseFolder = async () => {
		const selected = await open({ directory: true });
		if (typeof selected === "string") {
			setDefaultWorktreeDir(selected);
		}
	};

	return (
		<Field.Root>
			<Field.Label>{m.defaultWorktreeDir()}</Field.Label>
			<Text fontSize="xs" color="fg.muted" mb="1">
				{m.defaultWorktreeDirDesc()}
			</Text>
			<HStack align="stretch">
				<Input
					value={defaultWorktreeDir}
					onChange={(event) =>
						setDefaultWorktreeDir(event.target.value)
					}
					placeholder={m.defaultWorktreeDirPlaceholder()}
				/>
				<Button
					variant="outline"
					onClick={handleChooseFolder}
					flexShrink={0}
				>
					<FiFolder />
					{m.chooseFolder()}
				</Button>
				<IconButton
					aria-label={m.clearDefaultWorktreeDir()}
					variant="ghost"
					onClick={clearDefaultWorktreeDir}
					disabled={!defaultWorktreeDir}
					flexShrink={0}
				>
					<FiX />
				</IconButton>
			</HStack>
		</Field.Root>
	);
}
