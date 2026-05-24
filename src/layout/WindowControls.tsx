import { Box, HStack } from "@chakra-ui/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

const DOT_SIZE = "12px";
const DOT_GAP = "8px";
const PADDING_X = "12px";

type ControlKind = "close" | "minimize" | "maximize";

const COLORS: Record<ControlKind, { base: string; symbol: string }> = {
	close: { base: "#FF5F57", symbol: "#4D0000" },
	minimize: { base: "#FEBC2E", symbol: "#995700" },
	maximize: { base: "#28C840", symbol: "#006500" },
};

interface TrafficLightProps {
	kind: ControlKind;
	label: string;
	onClick: () => void;
	showSymbol: boolean;
	isMaximized?: boolean;
}

function TrafficLight({
	kind,
	label,
	onClick,
	showSymbol,
	isMaximized = false,
}: TrafficLightProps) {
	const { base, symbol } = COLORS[kind];

	return (
		<Box
			as="button"
			aria-label={label}
			onClick={onClick}
			w={DOT_SIZE}
			h={DOT_SIZE}
			borderRadius="full"
			bg={base}
			border="1px solid"
			borderColor="blackAlpha.300"
			display="grid"
			placeItems="center"
			cursor="default"
			transition="opacity 0.12s ease"
			_focusVisible={{ outline: "none", opacity: 0.85 }}
			css={{ WebkitAppRegion: "no-drag" }}
		>
			{showSymbol && (
				<Box
					as="span"
					color={symbol}
					fontSize="9px"
					fontWeight="bold"
					lineHeight="1"
					userSelect="none"
				>
					{kind === "close" && "×"}
					{kind === "minimize" && "−"}
					{kind === "maximize" && (isMaximized ? "⤡" : "+")}
				</Box>
			)}
		</Box>
	);
}

export default function WindowControls() {
	const [isMaximized, setIsMaximized] = useState(false);
	const [hovering, setHovering] = useState(false);

	useEffect(() => {
		const window = getCurrentWindow();
		let unlisten: (() => void) | undefined;

		window.isMaximized().then(setIsMaximized);

		window
			.onResized(() => {
				window.isMaximized().then(setIsMaximized);
			})
			.then((fn) => {
				unlisten = fn;
			});

		return () => {
			unlisten?.();
		};
	}, []);

	const handleClose = () => {
		getCurrentWindow().close();
	};
	const handleMinimize = () => {
		getCurrentWindow().minimize();
	};
	const handleToggleMaximize = () => {
		getCurrentWindow().toggleMaximize();
	};

	return (
		<HStack
			gap={DOT_GAP}
			position="fixed"
			top="0"
			right="0"
			zIndex="banner"
			h="28px"
			px={PADDING_X}
			align="center"
			onMouseEnter={() => setHovering(true)}
			onMouseLeave={() => setHovering(false)}
			data-window-controls
		>
			<TrafficLight
				kind="close"
				label="Close"
				onClick={handleClose}
				showSymbol={hovering}
			/>
			<TrafficLight
				kind="minimize"
				label="Minimize"
				onClick={handleMinimize}
				showSymbol={hovering}
			/>
			<TrafficLight
				kind="maximize"
				label={isMaximized ? "Restore" : "Maximize"}
				onClick={handleToggleMaximize}
				showSymbol={hovering}
				isMaximized={isMaximized}
			/>
		</HStack>
	);
}

export const WINDOW_CONTROLS_WIDTH = 12 * 3 + 8 * 2 + 12 * 2;
export const WINDOW_CONTROLS_HEIGHT = 28;
