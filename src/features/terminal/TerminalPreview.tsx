import { useFontStore } from "@/features/settings/stores/fontStore";
import { useTerminalTheme } from "./hooks";
import { type TerminalThemeId, terminalThemes } from "./themes";

const lines = [
	{ prompt: true, text: "whoami" },
	{ prompt: false, text: "akrc" },
	{ prompt: true, text: "ls" },
	{ prompt: false, text: "Desktop    Documents    Downloads    Projects" },
	{ prompt: false, text: "Music      Pictures     Videos" },
	{ prompt: true, text: 'echo "Hello, 2code!"' },
	{ prompt: false, text: "Hello, 2code!" },
	{ prompt: true, text: "" },
];

export function TerminalPreview({
	themeId,
}: {
	themeId?: TerminalThemeId | null;
}) {
	const fontFamily = useFontStore((s) => s.fontFamily);
	const fontSize = useFontStore((s) => s.fontSize);
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
					<div key={i}>
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
			<style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
		</div>
	);
}
