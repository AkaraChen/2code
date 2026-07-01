import { basename } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useForm, useWatch } from "react-hook-form";
import { FiEdit2, FiFolder } from "react-icons/fi";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import * as m from "@/paraglide/messages.js";
import { useCreateProject } from "./hooks";

interface CreateProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

interface FormValues {
	name: string;
	folder: string | null;
}

function getProjectNameHint(folder: string | null, name: string) {
	const hasName = !!name.trim();

	if (!folder) {
		return m.createProjectChooseFolderHint();
	}
	if (!hasName) {
		return m.createProjectHintFolderEmpty();
	}
	return m.createProjectHintFolderNamed();
}

export default function CreateProjectDialog({
	isOpen,
	onClose,
}: CreateProjectDialogProps) {
	const form = useForm<FormValues>({
		defaultValues: { name: "", folder: null },
	});
	const navigate = useNavigate();
	const folder = useWatch({ control: form.control, name: "folder" });
	const name = useWatch({ control: form.control, name: "name" });

	const handleClose = () => {
		form.reset();
		onClose();
	};

	const handleChooseFolder = async () => {
		const selected = await open({ directory: true });
		if (selected) {
			form.setValue("folder", selected);
			if (!form.getValues("name").trim()) {
				form.setValue("name", await basename(selected));
			}
		}
	};

	const createProject = useCreateProject({
		onSuccess: (project) => {
			handleClose();
			if (project.profiles.length > 0) {
				const defaultProfile = project.profiles[0];
				navigate(`/projects/${project.id}/profiles/${defaultProfile.id}`);
			}
		},
	});

	const handleCreate = form.handleSubmit(async (data) => {
		if (!data.folder) return;

		const name = data.name.trim();
		await createProject.mutateAsync({
			name: name || undefined,
			folder: data.folder,
		});
	});

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) handleClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.createProject()}</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-5">
					{!folder ? (
						<button
							type="button"
							className="rounded-lg border border-dashed px-4 py-6 transition-colors hover:bg-muted"
							onClick={handleChooseFolder}
						>
							<div className="flex flex-col items-center gap-2">
								<FiFolder className="size-6 text-muted-foreground" />
								<span className="text-sm text-muted-foreground">
									{m.chooseFolder()}
								</span>
							</div>
						</button>
					) : (
						<div>
							<div className="mb-1.5 flex items-center justify-between gap-3">
								<div className="text-xs font-medium text-muted-foreground">
									{m.folder()}
								</div>
								<Button
									variant="outline"
									size="xs"
									onClick={handleChooseFolder}
								>
									<FiEdit2 />
									{m.chooseFolder()}
								</Button>
							</div>
							<code className="block truncate rounded-md border bg-muted px-3 py-2 text-sm">
								{folder}
							</code>
						</div>
					)}

					<Field>
						<FieldLabel>{m.projectName()}</FieldLabel>
						<Input
							placeholder={m.projectNamePlaceholderFolder()}
							{...form.register("name")}
							onKeyDown={(event) => {
								if (event.key === "Enter") handleCreate();
							}}
						/>
						<FieldDescription>
							{getProjectNameHint(folder, name)}
						</FieldDescription>
					</Field>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={handleClose}>
						{m.cancel()}
					</Button>
					<Button
						onClick={handleCreate}
						disabled={!folder || createProject.isPending}
					>
						{createProject.isPending ? <Spinner /> : null}
						{m.create()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
