export interface TerminalTheme {
	background: string;
	foreground: string;
	cursor: string;
	selectionBackground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
}

export type TerminalThemeId =
	| "github-dark"
	| "github-light"
	| "dracula"
	| "ayu-dark"
	| "ayu-light"
	| "solarized-dark"
	| "solarized-light"
	| "one-dark"
	| "one-light";

export const terminalThemeNames: Record<TerminalThemeId, string> = {
	"github-dark": "GitHub Dark",
	"github-light": "GitHub Light",
	dracula: "Dracula",
	"ayu-dark": "Ayu Dark",
	"ayu-light": "Ayu Light",
	"solarized-dark": "Solarized Dark",
	"solarized-light": "Solarized Light",
	"one-dark": "One Dark",
	"one-light": "One Light",
};

export const terminalThemeIds: TerminalThemeId[] = Object.keys(
	terminalThemeNames,
) as TerminalThemeId[];

export const terminalThemes: Record<TerminalThemeId, TerminalTheme> = {
	"github-dark": {
		background: "#161616",
		foreground: "#BFD4E1",
		cursor: "#f0f3bd",
		selectionBackground: "#353535",
		black: "#353535",
		red: "#d97397",
		green: "#CEE397",
		yellow: "#E9CA5C",
		blue: "#63B0C6",
		magenta: "#E9AEBA",
		cyan: "#70C1B3",
		white: "#BFD4E1",
		brightBlack: "#729098",
		brightRed: "#ffadad",
		brightGreen: "#caffbf",
		brightYellow: "#f0f3bd",
		brightBlue: "#9bf6ff",
		brightMagenta: "#ffc6ff",
		brightCyan: "#a8dadc",
		brightWhite: "#ffffff",
	},
	"github-light": {
		background: "#ffffff",
		foreground: "#24292f",
		cursor: "#0969da",
		selectionBackground: "#bbd6f0",
		black: "#24292f",
		red: "#cf222e",
		green: "#116329",
		yellow: "#4d2d00",
		blue: "#0969da",
		magenta: "#8250df",
		cyan: "#1b7c83",
		white: "#6e7781",
		brightBlack: "#57606a",
		brightRed: "#a40e26",
		brightGreen: "#1a7f37",
		brightYellow: "#633c01",
		brightBlue: "#218bff",
		brightMagenta: "#a475f9",
		brightCyan: "#3192aa",
		brightWhite: "#8c959f",
	},
	dracula: {
		background: "#282a36",
		foreground: "#f8f8f2",
		cursor: "#f8f8f2",
		selectionBackground: "#44475a",
		black: "#21222c",
		red: "#ff5555",
		green: "#50fa7b",
		yellow: "#f1fa8c",
		blue: "#bd93f9",
		magenta: "#ff79c6",
		cyan: "#8be9fd",
		white: "#f8f8f2",
		brightBlack: "#6272a4",
		brightRed: "#ff6e6e",
		brightGreen: "#69ff94",
		brightYellow: "#ffffa5",
		brightBlue: "#d6acff",
		brightMagenta: "#ff92df",
		brightCyan: "#a4ffff",
		brightWhite: "#ffffff",
	},
	"ayu-dark": {
		background: "#0d1017",
		foreground: "#bfbdb6",
		cursor: "#e6b450",
		selectionBackground: "#273747",
		black: "#01060e",
		red: "#ea6c73",
		green: "#91b362",
		yellow: "#f9af4f",
		blue: "#53bdfa",
		magenta: "#fae994",
		cyan: "#90e1c6",
		white: "#c7c7c7",
		brightBlack: "#686868",
		brightRed: "#f07178",
		brightGreen: "#c2d94c",
		brightYellow: "#ffb454",
		brightBlue: "#59c2ff",
		brightMagenta: "#ffee99",
		brightCyan: "#95e6cb",
		brightWhite: "#ffffff",
	},
	"ayu-light": {
		background: "#fafafa",
		foreground: "#575f66",
		cursor: "#ff6a00",
		selectionBackground: "#d1e4f4",
		black: "#000000",
		red: "#f51818",
		green: "#86b300",
		yellow: "#f29718",
		blue: "#41a6d9",
		magenta: "#a37acc",
		cyan: "#4dbf99",
		white: "#abb0b6",
		brightBlack: "#828c99",
		brightRed: "#ff3333",
		brightGreen: "#a6cc70",
		brightYellow: "#ffaa33",
		brightBlue: "#73d0ff",
		brightMagenta: "#d4bfff",
		brightCyan: "#5ccfe6",
		brightWhite: "#ffffff",
	},
	"solarized-dark": {
		background: "#002b36",
		foreground: "#839496",
		cursor: "#93a1a1",
		selectionBackground: "#073642",
		black: "#073642",
		red: "#dc322f",
		green: "#859900",
		yellow: "#b58900",
		blue: "#268bd2",
		magenta: "#d33682",
		cyan: "#2aa198",
		white: "#eee8d5",
		brightBlack: "#586e75",
		brightRed: "#cb4b16",
		brightGreen: "#586e75",
		brightYellow: "#657b83",
		brightBlue: "#839496",
		brightMagenta: "#6c71c4",
		brightCyan: "#93a1a1",
		brightWhite: "#fdf6e3",
	},
	"solarized-light": {
		background: "#fdf6e3",
		foreground: "#657b83",
		cursor: "#586e75",
		selectionBackground: "#eee8d5",
		black: "#073642",
		red: "#dc322f",
		green: "#859900",
		yellow: "#b58900",
		blue: "#268bd2",
		magenta: "#d33682",
		cyan: "#2aa198",
		white: "#eee8d5",
		brightBlack: "#002b36",
		brightRed: "#cb4b16",
		brightGreen: "#586e75",
		brightYellow: "#657b83",
		brightBlue: "#839496",
		brightMagenta: "#6c71c4",
		brightCyan: "#93a1a1",
		brightWhite: "#fdf6e3",
	},
	"one-dark": {
		background: "#282c34",
		foreground: "#abb2bf",
		cursor: "#528bff",
		selectionBackground: "#3e4451",
		black: "#282c34",
		red: "#e06c75",
		green: "#98c379",
		yellow: "#e5c07b",
		blue: "#61afef",
		magenta: "#c678dd",
		cyan: "#56b6c2",
		white: "#abb2bf",
		brightBlack: "#5c6370",
		brightRed: "#be5046",
		brightGreen: "#98c379",
		brightYellow: "#d19a66",
		brightBlue: "#61afef",
		brightMagenta: "#c678dd",
		brightCyan: "#56b6c2",
		brightWhite: "#ffffff",
	},
	"one-light": {
		background: "#fafafa",
		foreground: "#383a42",
		cursor: "#526fff",
		selectionBackground: "#e5e5e6",
		black: "#383a42",
		red: "#e45649",
		green: "#50a14f",
		yellow: "#c18401",
		blue: "#4078f2",
		magenta: "#a626a4",
		cyan: "#0184bc",
		white: "#a0a1a7",
		brightBlack: "#696c77",
		brightRed: "#ca1243",
		brightGreen: "#50a14f",
		brightYellow: "#c18401",
		brightBlue: "#4078f2",
		brightMagenta: "#a626a4",
		brightCyan: "#0184bc",
		brightWhite: "#ffffff",
	},
};
