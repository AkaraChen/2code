import { FolderIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { open } from "@tauri-apps/plugin-dialog";
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
		<Field>
			<FieldLabel>{m.defaultWorktreeDir()}</FieldLabel>
			<FieldDescription>{m.defaultWorktreeDirDesc()}</FieldDescription>
			<div className="flex items-stretch gap-2">
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
					className="shrink-0"
				>
					<FolderIcon />
					{m.chooseFolder()}
				</Button>
				<Button
					aria-label={m.clearDefaultWorktreeDir()}
					variant="ghost"
					size="icon"
					onClick={clearDefaultWorktreeDir}
					disabled={!defaultWorktreeDir}
					className="shrink-0"
				>
					<XIcon />
				</Button>
			</div>
		</Field>
	);
}
