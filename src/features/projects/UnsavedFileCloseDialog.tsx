import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import * as m from "@/paraglide/messages.js";

interface UnsavedFileCloseDialogProps {
	fileName: string;
	isOpen: boolean;
	onCancel: () => void;
	onDiscard: () => void;
}

export default function UnsavedFileCloseDialog({
	fileName,
	isOpen,
	onCancel,
	onDiscard,
}: UnsavedFileCloseDialogProps) {
	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.closeUnsavedFileTitle()}</DialogTitle>
				</DialogHeader>
				<p className="text-sm">
					{m.closeUnsavedFileDescription({ file: fileName })}
				</p>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						{m.cancel()}
					</Button>
					<Button variant="destructive" onClick={onDiscard}>
						{m.discardChanges()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
