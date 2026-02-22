import { IconButton } from "@chakra-ui/react";
import { RiBugLine } from "react-icons/ri";
import { useShallow } from "zustand/react/shallow";
import * as m from "@/paraglide/messages.js";
import DebugLogDialog from "./DebugLogDialog";
import { useDebugStore } from "./debugStore";

export default function DebugFloat() {
	const { enabled, panelOpen } = useDebugStore(
		useShallow((s) => ({ enabled: s.enabled, panelOpen: s.panelOpen })),
	);

	if (!enabled) return null;

	return (
		<>
			<IconButton
				aria-label={m.debugLog()}
				position="fixed"
				bottom="4"
				right="4"
				zIndex="overlay"
				rounded="full"
				size="sm"
				colorPalette="orange"
				variant="solid"
				onClick={() => useDebugStore.getState().setPanelOpen(true)}
			>
				<RiBugLine />
			</IconButton>
			<DebugLogDialog
				isOpen={panelOpen}
				onClose={() => useDebugStore.getState().setPanelOpen(false)}
			/>
		</>
	);
}
