import { Box } from "@chakra-ui/react";
import { motion, useReducedMotion } from "motion/react";

const SIDEBAR_ACTIVE_INDICATOR_ID = "sidebar-active-indicator";
const SIDEBAR_ACTIVE_INDICATOR_TRANSITION = {
	type: "spring",
	stiffness: 520,
	damping: 38,
	mass: 0.35,
} as const;

export function SidebarActiveIndicator({
	insetInlineStart,
	insetBlock = "1.5",
	width = "2px",
}: {
	insetInlineStart: string;
	insetBlock?: string;
	width?: string;
}) {
	const prefersReducedMotion = useReducedMotion();

	return (
		<Box
			asChild
			position="absolute"
			insetInlineStart={insetInlineStart}
			insetBlock={insetBlock}
			width={width}
			borderRadius="full"
			bg="colorPalette.solid"
			pointerEvents="none"
			aria-hidden="true"
		>
			<motion.div
				layoutId={SIDEBAR_ACTIVE_INDICATOR_ID}
				transition={
					prefersReducedMotion
						? { duration: 0 }
						: SIDEBAR_ACTIVE_INDICATOR_TRANSITION
				}
			/>
		</Box>
	);
}
