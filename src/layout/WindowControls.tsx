import { Box, HStack } from "@chakra-ui/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

const BUTTON_WIDTH = "36px";
const BUTTON_HEIGHT = "28px";

type ControlKind = "minimize" | "maximize" | "close";

interface ControlButtonProps {
	kind: ControlKind;
	label: string;
	onClick: () => void;
	isMaximized?: boolean;
}

function ControlIcon({
	kind,
	isMaximized,
}: {
	kind: ControlKind;
	isMaximized: boolean;
}) {
	if (kind === "minimize") {
		return (
			<svg
				aria-hidden="true"
				width="9"
				height="9"
				viewBox="0 0 10 10"
				fill="none"
			>
				<title>minimize</title>
				<path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
			</svg>
		);
	}
	if (kind === "maximize") {
		if (isMaximized) {
			return (
				<svg
					aria-hidden="true"
					width="10"
					height="10"
					viewBox="0 0 10 10"
					fill="none"
				>
					<title>restore</title>
					<path
						d="M2 0h8v8H8M0 2h8v8H0V2z"
						stroke="currentColor"
						strokeWidth="1"
						fill="none"
					/>
				</svg>
			);
		}
		return (
			<svg
				aria-hidden="true"
				width="9"
				height="9"
				viewBox="0 0 10 10"
				fill="none"
			>
				<title>maximize</title>
				<rect
					x="0.5"
					y="0.5"
					width="9"
					height="9"
					stroke="currentColor"
					strokeWidth="1"
					fill="none"
				/>
			</svg>
		);
	}
	return (
		<svg
			aria-hidden="true"
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
		>
			<title>close</title>
			<path
				d="M0 0l10 10M10 0L0 10"
				stroke="currentColor"
				strokeWidth="1"
			/>
		</svg>
	);
}

function ControlButton({
	kind,
	label,
	onClick,
	isMaximized = false,
}: ControlButtonProps) {
	const hoverBg =
		kind === "close" ? "#c42b1c" : "rgba(127, 127, 127, 0.18)";
	const hoverColor = kind === "close" ? "white" : undefined;
	const activeBg =
		kind === "close" ? "#b32717" : "rgba(127, 127, 127, 0.28)";

	return (
		<Box
			as="button"
			aria-label={label}
			onClick={onClick}
			w={BUTTON_WIDTH}
			h={BUTTON_HEIGHT}
			display="grid"
			placeItems="center"
			bg="transparent"
			color="fg.muted"
			borderRadius="0"
			transition="background-color 0.08s ease, color 0.08s ease"
			_hover={{ bg: hoverBg, color: hoverColor }}
			_active={{ bg: activeBg }}
			_focusVisible={{ outline: "none", bg: hoverBg, color: hoverColor }}
			css={{ WebkitAppRegion: "no-drag" }}
		>
			<ControlIcon kind={kind} isMaximized={isMaximized} />
		</Box>
	);
}

export default function WindowControls() {
	const [isMaximized, setIsMaximized] = useState(false);

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

	const handleMinimize = () => {
		getCurrentWindow().minimize();
	};
	const handleToggleMaximize = () => {
		getCurrentWindow().toggleMaximize();
	};
	const handleClose = () => {
		getCurrentWindow().close();
	};

	return (
		<HStack
			gap="0"
			position="fixed"
			top="0"
			right="0"
			zIndex="banner"
			h={BUTTON_HEIGHT}
			data-window-controls
		>
			<ControlButton
				kind="minimize"
				label="Minimize"
				onClick={handleMinimize}
			/>
			<ControlButton
				kind="maximize"
				label={isMaximized ? "Restore" : "Maximize"}
				onClick={handleToggleMaximize}
				isMaximized={isMaximized}
			/>
			<ControlButton kind="close" label="Close" onClick={handleClose} />
		</HStack>
	);
}

export const WINDOW_CONTROLS_WIDTH = 36 * 3;
export const WINDOW_CONTROLS_HEIGHT = 28;
