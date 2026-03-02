import { Button, HStack } from "@chakra-ui/react";
import { LuPlus, LuSettings } from "react-icons/lu";
import { Link } from "react-router";
import CreateProjectDialog from "@/features/projects/CreateProjectDialog";
import * as m from "@/paraglide/messages.js";
import { useDialogState } from "@/shared/hooks/useDialogState";

export function QuickActions() {
	const createDialog = useDialogState();

	return (
		<>
			<HStack gap="2">
				<Button
					size="sm"
					variant="outline"
					onClick={createDialog.onOpen}
				>
					<LuPlus />
					{m.newProject()}
				</Button>
				<Button asChild size="sm" variant="ghost">
					<Link to="/settings">
						<LuSettings />
						{m.settings()}
					</Link>
				</Button>
			</HStack>
			<CreateProjectDialog
				isOpen={createDialog.isOpen}
				onClose={createDialog.onClose}
			/>
		</>
	);
}
