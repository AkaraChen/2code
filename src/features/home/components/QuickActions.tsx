import { Button, HStack } from "@chakra-ui/react";
import { Link } from "react-router";
import { LuPlus, LuSettings } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import { useDialogState } from "@/shared/hooks/useDialogState";
import CreateProjectDialog from "@/features/projects/CreateProjectDialog";

export function QuickActions() {
	const createDialog = useDialogState();

	return (
		<>
			<HStack gap="2">
				<Button size="sm" variant="outline" onClick={createDialog.onOpen}>
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
