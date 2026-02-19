import { Button, HStack } from "@chakra-ui/react";
import { useNavigate } from "react-router";
import { LuPlus, LuSettings } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import { useDialogState } from "@/shared/hooks/useDialogState";
import CreateProjectDialog from "@/features/projects/CreateProjectDialog";

export function QuickActions() {
	const navigate = useNavigate();
	const createDialog = useDialogState();

	return (
		<>
			<HStack gap="2">
				<Button size="sm" variant="outline" onClick={createDialog.onOpen}>
					<LuPlus />
					{m.newProject()}
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => navigate("/settings")}
				>
					<LuSettings />
					{m.settings()}
				</Button>
			</HStack>
			<CreateProjectDialog
				isOpen={createDialog.isOpen}
				onClose={createDialog.onClose}
			/>
		</>
	);
}
