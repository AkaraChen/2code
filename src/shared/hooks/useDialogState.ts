import { useState } from "react";

export function useDialogState(initial = false) {
	const [isOpen, setIsOpen] = useState(initial);
	return {
		isOpen,
		onOpen: () => setIsOpen(true),
		onClose: () => setIsOpen(false),
	};
}
