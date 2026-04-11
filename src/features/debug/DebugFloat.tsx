import { IconButton } from "@chakra-ui/react";
import { FiTool } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import DebugLogDialog from "./DebugLogDialog";
import { useDebugStore } from "./debugStore";

export default function DebugFloat() {
	const enabled = useDebugStore((s) => s.enabled);
	const panelOpen = useDebugStore((s) => s.panelOpen);
	const setPanelOpen = useDebugStore((s) => s.setPanelOpen);

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
				onClick={() => setPanelOpen(true)}
			>
				<FiTool />
			</IconButton>
			<DebugLogDialog
				isOpen={panelOpen}
				onClose={() => setPanelOpen(false)}
			/>
		</>
	);
}
