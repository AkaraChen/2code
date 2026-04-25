import { FiFolder, FiPackage } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import { OpenWithControl, RevealInFinderControl } from "./controls";
import type { ControlDefinition, ControlId } from "./types";

const definitions: ControlDefinition[] = [
	{
		id: "open-with",
		kind: "static",
		label: () => m.topbarOpenWith(),
		icon: FiPackage,
		optionFields: [],
		component: OpenWithControl,
	},
	{
		id: "reveal-in-finder",
		kind: "static",
		label: () => m.revealInFinder(),
		icon: FiFolder,
		optionFields: [],
		component: RevealInFinderControl,
	},
];

export const controlRegistry = new Map<ControlId, ControlDefinition>(
	definitions.map((d) => [d.id, d]),
);

export const allControlIds: ControlId[] = definitions.map((d) => d.id);

export function getSupportedControlIds() {
	return definitions.map((def) => def.id);
}
