import { WrenchIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
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
			<Button
				aria-label={m.debugLog()}
				size="icon"
				className="fixed right-16 bottom-4 z-50 rounded-full"
				onClick={openPanel}
			>
				<WrenchIcon />
			</Button>
			<DebugLogDialog
				isOpen={panelOpen}
				onClose={closePanel}
			/>
		</>
	);
}
