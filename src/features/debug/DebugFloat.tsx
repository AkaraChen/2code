import { IconButton } from "@chakra-ui/react";
import { useCallback } from "react";
import { FiTool } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import DebugLogDialog from "./DebugLogDialog";
import { useDebugStore } from "./debugStore";

export default function DebugFloat() {
	const enabled = useDebugStore((s) => s.enabled);
	const panelOpen = useDebugStore((s) => s.panelOpen);
	const setPanelOpen = useDebugStore((s) => s.setPanelOpen);
	const openPanel = useCallback(() => setPanelOpen(true), [setPanelOpen]);
	const closePanel = useCallback(() => setPanelOpen(false), [setPanelOpen]);

	if (!enabled) return null;

	return (
		<>
			<IconButton
				aria-label={m.debugLog()}
				position="fixed"
				bottom="4"
				right="16"
				zIndex="overlay"
				rounded="full"
				size="sm"
				colorPalette="orange"
				variant="solid"
				onClick={openPanel}
			>
				<FiTool />
			</IconButton>
			<DebugLogDialog
				isOpen={panelOpen}
				onClose={closePanel}
			/>
		</>
	);
}
