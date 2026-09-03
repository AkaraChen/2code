import { CopySimpleIcon, MinusIcon, SquareIcon, XIcon } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

const ICON_SIZE = 12;

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
		return <MinusIcon size={ICON_SIZE} />;
	}
	if (kind === "maximize") {
		return isMaximized ? (
			<CopySimpleIcon size={ICON_SIZE} />
		) : (
			<SquareIcon size={ICON_SIZE} />
		);
	}
	return <XIcon size={ICON_SIZE} />;
}

function ControlButton({
	kind,
	label,
	onClick,
	isMaximized = false,
}: ControlButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onClick}
			className={
				kind === "close"
					? "grid h-7 w-9 place-items-center text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-[#c42b1c] hover:text-white active:bg-[#b32717] focus-visible:bg-[#c42b1c] focus-visible:text-white focus-visible:outline-none"
					: "grid h-7 w-9 place-items-center text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-muted active:bg-muted focus-visible:bg-muted focus-visible:outline-none"
			}
		>
			<ControlIcon kind={kind} isMaximized={isMaximized} />
		</button>
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
		<div
			className="fixed top-0 right-0 flex h-7"
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
		</div>
	);
}
