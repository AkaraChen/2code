import { useCallback, useState } from "react";

export function useDialogState(initial = false) {
	const [isOpen, setIsOpen] = useState(initial);
	const onOpen = useCallback(() => setIsOpen(true), []);
	const onClose = useCallback(() => setIsOpen(false), []);
	return { isOpen, onOpen, onClose };
}
