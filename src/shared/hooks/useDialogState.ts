import { useCallback, useMemo, useState } from "react";

export function useDialogState(initial = false) {
	const [isOpen, setIsOpen] = useState(initial);
	const onOpen = useCallback(() => setIsOpen(true), []);
	const onClose = useCallback(() => setIsOpen(false), []);
	return useMemo(
		() => ({
			isOpen,
			onOpen,
			onClose,
		}),
		[isOpen, onClose, onOpen],
	);
}
