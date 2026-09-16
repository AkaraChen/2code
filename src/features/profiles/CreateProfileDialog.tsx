import { GitBranchIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { listProjects, type ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { queryKeys } from "@/shared/lib/queryKeys";
import { liveProfileMatchingCreate, useCreateProfile } from "./hooks";

interface CreateProfileDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
}

interface FormValues {
	branchName: string;
}

export default function CreateProfileDialog({
	isOpen,
	onClose,
	projectId,
}: CreateProfileDialogProps) {
	const form = useForm<FormValues>({
		defaultValues: { branchName: "" },
	});
	const createProfile = useCreateProfile();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const handleClose = () => {
		form.reset();
		onClose();
	};

	const handleCreate = form.handleSubmit(async (data) => {
		const created = await createProfile.mutateAsync({
			projectId,
			branchName: data.branchName,
		});
		const projects =
			queryClient.getQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
			) ??
			(await queryClient.fetchQuery({
				queryKey: queryKeys.projects.all,
				queryFn: listProjects,
			}));
		const live = liveProfileMatchingCreate(projects, created);
		handleClose();
		if (live) {
			navigate(`/projects/${projectId}/profiles/${live.id}`);
			return;
		}
		navigate(`/projects/${projectId}`);
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
					<DialogTitle className="flex items-center gap-2">
						<GitBranchIcon className="size-4 shrink-0" />
						{m.createProfile()}
					</DialogTitle>
				</DialogHeader>
				<Field>
					<FieldLabel>{m.branchName()}</FieldLabel>
					<Input
						placeholder={m.branchNamePlaceholder()}
						{...form.register("branchName")}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !createProfile.isPending) {
								handleCreate();
							}
						}}
					/>
				</Field>
				<DialogFooter>
					<Button variant="outline" onClick={handleClose}>
						{m.cancel()}
					</Button>
					<Button
						disabled={createProfile.isPending}
						onClick={handleCreate}
					>
						{createProfile.isPending ? <Spinner /> : null}
						{m.create()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
