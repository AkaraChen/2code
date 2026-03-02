import { useSettingsStore } from "@/features/settings/stores";
import { useTerminalTheme } from "./hooks";
import type { TerminalThemeId } from "./themes";
import { terminalThemes } from "./themes";

const lines = [
	{ id: "whoami", prompt: true, text: "whoami" },
	{ id: "whoami-out", prompt: false, text: "akrc" },
	{ id: "ls", prompt: true, text: "ls" },
	{
		id: "ls-out-1",
		prompt: false,
		text: "Desktop    Documents    Downloads    Projects",
	},
	{ id: "ls-out-2", prompt: false, text: "Music      Pictures     Videos" },
	{ id: "echo", prompt: true, text: 'echo "Hello, 2code!"' },
	{ id: "echo-out", prompt: false, text: "Hello, 2code!" },
	{ id: "prompt", prompt: true, text: "" },
];

export function TerminalPreview({
	themeId,
}: {
	themeId?: TerminalThemeId | null;
}) {
	const fontFamily = useSettingsStore((s) => s.fontFamily);
	const fontSize = useSettingsStore((s) => s.fontSize);
	const autoTheme = useTerminalTheme();
	const theme = themeId ? terminalThemes[themeId] : autoTheme;

	return (
		<div
			style={{
				background: theme.background,
				color: theme.foreground,
				fontFamily: `"${fontFamily}", monospace`,
				fontSize: `${fontSize}px`,
				lineHeight: 1.4,
				padding: "12px 16px",
				borderRadius: "8px",
				border: "0.5px solid var(--chakra-colors-border-subtle)",
				overflow: "hidden",
			}}
		>
			<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
				{lines.map((line, i) => (
					<div key={line.id}>
						{line.prompt && (
							<span style={{ color: theme.green }}>$ </span>
						)}
						<span>{line.text}</span>
						{i === lines.length - 1 && line.prompt && (
							<span
								style={{
									display: "inline-block",
									width: `${fontSize * 0.6}px`,
									height: `${fontSize}px`,
									background: theme.cursor,
									verticalAlign: "text-bottom",
									animation: "blink 1s step-end infinite",
								}}
							/>
						)}
					</div>
				))}
			</pre>
		</div>
	);
}
