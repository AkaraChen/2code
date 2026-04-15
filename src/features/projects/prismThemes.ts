import type { CSSProperties } from "react";
import type { TerminalThemeId } from "@/features/terminal/themes";

export type PrismThemeStyle = Record<string, CSSProperties>;

interface PrismThemePalette {
	background: string;
	foreground: string;
	selection: string;
	inlineBackground: string;
	inlineBorder: string;
	comment: string;
	punctuation: string;
	keyword: string;
	operator: string;
	string: string;
	number: string;
	property: string;
	variable: string;
	function: string;
	className: string;
	tag: string;
	attrName: string;
	attrValue: string;
	regex: string;
	builtin: string;
	important: string;
	inserted: string;
	deleted: string;
}

const baseCodeStyle: CSSProperties = {
	direction: "ltr",
	textAlign: "left",
	whiteSpace: "pre",
	wordSpacing: "normal",
	wordBreak: "normal",
	lineHeight: "1.5",
	MozTabSize: 2,
	OTabSize: 2,
	tabSize: 2,
	WebkitHyphens: "none",
	MozHyphens: "none",
	msHyphens: "none",
	hyphens: "none",
};

function addStyles(
	theme: PrismThemeStyle,
	selectors: string[],
	style: CSSProperties,
) {
	for (const selector of selectors) {
		theme[selector] = { ...style };
	}
}

function createPrismTheme(palette: PrismThemePalette): PrismThemeStyle {
	const theme: PrismThemeStyle = {
		'code[class*="language-"]': {
			...baseCodeStyle,
			background: palette.background,
			color: palette.foreground,
			textShadow: "none",
		},
		'pre[class*="language-"]': {
			...baseCodeStyle,
			background: palette.background,
			color: palette.foreground,
			textShadow: "none",
			padding: "1em",
			margin: "0.5em 0",
			overflow: "auto",
			borderRadius: "0.3em",
		},
		':not(pre) > code[class*="language-"]': {
			background: palette.inlineBackground,
			border: `1px solid ${palette.inlineBorder}`,
			borderRadius: "0.35em",
			padding: "0.15em 0.3em",
			whiteSpace: "normal",
		},
	};

	addStyles(theme, ["namespace"], { opacity: 0.7 });
	addStyles(theme, ["comment", "block-comment", "prolog", "doctype", "cdata"], {
		color: palette.comment,
		fontStyle: "italic",
	});
	addStyles(theme, ["punctuation", "imports.punctuation"], {
		color: palette.punctuation,
	});
	addStyles(
		theme,
		[
			"operator",
			"operator.arrow",
			"arrow",
			"selector.attribute.operator",
			"template-string.interpolation.interpolation-punctuation.punctuation",
			"tag.script.language-javascript.operator",
		],
		{ color: palette.operator },
	);
	addStyles(
		theme,
		[
			"keyword",
			"keyword-array",
			"keyword-this",
			"keyword.module",
			"keyword.control-flow",
			"null",
			"this",
			"important",
			"title.important",
			"code-snippet.code.keyword",
		],
		{ color: palette.keyword },
	);
	addStyles(
		theme,
		["property", "key", "constant", "symbol", "atrule", "key.atrule", "key.property"],
		{ color: palette.property },
	);
	addStyles(theme, ["number", "boolean", "boolean.important", "unit"], {
		color: palette.number,
	});
	addStyles(
		theme,
		[
			"string",
			"char",
			"template-string",
			"template-string.template-punctuation.string",
			"code-snippet",
			"tag.script.language-javascript.string",
		],
		{ color: palette.string },
	);
	addStyles(
		theme,
		["attr-value", "tag.attr-value", "selector.attribute.attr-value"],
		{ color: palette.attrValue },
	);
	addStyles(theme, ["deleted"], { color: palette.deleted });
	addStyles(theme, ["variable", "parameter", "parameter.variable"], {
		color: palette.variable,
	});
	addStyles(
		theme,
		[
			"interpolation",
			"string.variable",
			"assign-left.variable",
			"property-access",
			"function-variable",
		],
		{ color: palette.variable },
	);
	addStyles(
		theme,
		[
			"function",
			"method",
			"generic-function",
			"function-name",
			"definition-query",
			"definition-query.function",
			"function-definition",
			"function-definition.function",
			"function-variable.function",
			"method.function.property-access",
		],
		{ color: palette.function },
	);
	addStyles(
		theme,
		[
			"class-name",
			"maybe-class-name",
			"known-class-name",
			"builtin.class-name",
			"type-definition.class-name",
			"imports.maybe-class-name",
			"exports.maybe-class-name",
			"console.class-name",
			"table.class-name",
			"tag.class-name",
		],
		{ color: palette.className },
	);
	addStyles(
		theme,
		[
			"tag",
			"selector",
			"selector.class",
			"selector.id",
			"pseudo-class",
			"selector.pseudo-class",
			"pseudo-element",
			"tag.script.language-javascript",
		],
		{ color: palette.tag },
	);
	addStyles(
		theme,
		[
			"attr-name",
			"tag.attr-name",
			"selector.attribute.attr-name",
			"attribute",
		],
		{ color: palette.attrName },
	);
	addStyles(
		theme,
		[
			"tag.punctuation",
			"selector.attribute.punctuation",
			"script-punctuation",
			"interpolation-punctuation",
			"template-punctuation",
			"attr-value.punctuation",
			"attr-value.punctuation.attr-equals",
			"tag.attr-value.punctuation",
			"tag.attr-value.punctuation.attr-equals",
			"title.important.punctuation",
			"tag.script.language-javascript.punctuation",
			"tag.script.language-javascript.script-punctuation",
		],
		{ color: palette.punctuation },
	);
	addStyles(
		theme,
		[
			"builtin",
			"console",
			"directive",
			"directive.tag.tag",
			"title",
			"package",
			"scalar",
			"content",
		],
		{ color: palette.builtin },
	);
	addStyles(theme, ["regex", "escape", "entity", "url", "url.content", "hexcode", "color"], {
		color: palette.regex,
	});
	addStyles(theme, ["inserted"], { color: palette.inserted });
	addStyles(theme, ["important", "delimiter.important"], {
		color: palette.important,
		fontWeight: "600",
	});
	addStyles(theme, ["bold"], { fontWeight: "700" });
	addStyles(theme, ["italic"], { fontStyle: "italic" });

	return theme;
}

const prismPalettes: Record<TerminalThemeId, PrismThemePalette> = {
	"github-dark": {
		background: "#161616",
		foreground: "#bfd4e1",
		selection: "#353535",
		inlineBackground: "#20252a",
		inlineBorder: "#353535",
		comment: "#729098",
		punctuation: "#bfd4e1",
		keyword: "#d97397",
		operator: "#e9aeba",
		string: "#cee397",
		number: "#63b0c6",
		property: "#63b0c6",
		variable: "#e9ca5c",
		function: "#f0f3bd",
		className: "#9bf6ff",
		tag: "#70c1b3",
		attrName: "#63b0c6",
		attrValue: "#cee397",
		regex: "#a8dadc",
		builtin: "#9bf6ff",
		important: "#ffadad",
		inserted: "#caffbf",
		deleted: "#ffadad",
	},
	"github-light": {
		background: "#ffffff",
		foreground: "#24292f",
		selection: "#bbd6f0",
		inlineBackground: "#f6f8fa",
		inlineBorder: "#d0d7de",
		comment: "#6e7781",
		punctuation: "#24292f",
		keyword: "#cf222e",
		operator: "#cf222e",
		string: "#0a3069",
		number: "#0550ae",
		property: "#953800",
		variable: "#953800",
		function: "#8250df",
		className: "#953800",
		tag: "#116329",
		attrName: "#0550ae",
		attrValue: "#0a3069",
		regex: "#1b7c83",
		builtin: "#8250df",
		important: "#a40e26",
		inserted: "#1a7f37",
		deleted: "#cf222e",
	},
	dracula: {
		background: "#282a36",
		foreground: "#f8f8f2",
		selection: "#44475a",
		inlineBackground: "#343746",
		inlineBorder: "#44475a",
		comment: "#6272a4",
		punctuation: "#f8f8f2",
		keyword: "#ff79c6",
		operator: "#ff79c6",
		string: "#f1fa8c",
		number: "#bd93f9",
		property: "#8be9fd",
		variable: "#ffb86c",
		function: "#50fa7b",
		className: "#8be9fd",
		tag: "#ff79c6",
		attrName: "#50fa7b",
		attrValue: "#f1fa8c",
		regex: "#ffb86c",
		builtin: "#8be9fd",
		important: "#ff5555",
		inserted: "#50fa7b",
		deleted: "#ff5555",
	},
	"ayu-dark": {
		background: "#0d1017",
		foreground: "#bfbdb6",
		selection: "#273747",
		inlineBackground: "#171b24",
		inlineBorder: "#273747",
		comment: "#5c6773",
		punctuation: "#bfbdb6",
		keyword: "#ff8f40",
		operator: "#f07178",
		string: "#aad94c",
		number: "#d2a6ff",
		property: "#59c2ff",
		variable: "#ffcc66",
		function: "#ffd580",
		className: "#73d0ff",
		tag: "#f07178",
		attrName: "#59c2ff",
		attrValue: "#aad94c",
		regex: "#95e6cb",
		builtin: "#95e6cb",
		important: "#ffb454",
		inserted: "#c2d94c",
		deleted: "#f07178",
	},
	"ayu-light": {
		background: "#fafafa",
		foreground: "#575f66",
		selection: "#d1e4f4",
		inlineBackground: "#f2f4f5",
		inlineBorder: "#d8dee4",
		comment: "#8a9199",
		punctuation: "#575f66",
		keyword: "#fa8d3e",
		operator: "#ed9366",
		string: "#86b300",
		number: "#a37acc",
		property: "#41a6d9",
		variable: "#f29718",
		function: "#f2ae49",
		className: "#41a6d9",
		tag: "#f51818",
		attrName: "#41a6d9",
		attrValue: "#86b300",
		regex: "#4dbf99",
		builtin: "#4dbf99",
		important: "#ff6a00",
		inserted: "#86b300",
		deleted: "#f51818",
	},
	"solarized-dark": {
		background: "#002b36",
		foreground: "#839496",
		selection: "#073642",
		inlineBackground: "#073642",
		inlineBorder: "#586e75",
		comment: "#586e75",
		punctuation: "#839496",
		keyword: "#859900",
		operator: "#6c71c4",
		string: "#2aa198",
		number: "#d33682",
		property: "#268bd2",
		variable: "#cb4b16",
		function: "#268bd2",
		className: "#b58900",
		tag: "#859900",
		attrName: "#b58900",
		attrValue: "#2aa198",
		regex: "#2aa198",
		builtin: "#268bd2",
		important: "#dc322f",
		inserted: "#859900",
		deleted: "#dc322f",
	},
	"solarized-light": {
		background: "#fdf6e3",
		foreground: "#657b83",
		selection: "#eee8d5",
		inlineBackground: "#f4eedb",
		inlineBorder: "#d6cfbb",
		comment: "#93a1a1",
		punctuation: "#657b83",
		keyword: "#859900",
		operator: "#6c71c4",
		string: "#2aa198",
		number: "#d33682",
		property: "#268bd2",
		variable: "#cb4b16",
		function: "#268bd2",
		className: "#b58900",
		tag: "#859900",
		attrName: "#b58900",
		attrValue: "#2aa198",
		regex: "#2aa198",
		builtin: "#268bd2",
		important: "#dc322f",
		inserted: "#859900",
		deleted: "#dc322f",
	},
	"one-dark": {
		background: "#282c34",
		foreground: "#abb2bf",
		selection: "#3e4451",
		inlineBackground: "#323842",
		inlineBorder: "#3e4451",
		comment: "#5c6370",
		punctuation: "#abb2bf",
		keyword: "#c678dd",
		operator: "#56b6c2",
		string: "#98c379",
		number: "#d19a66",
		property: "#e06c75",
		variable: "#e06c75",
		function: "#61afef",
		className: "#e5c07b",
		tag: "#e06c75",
		attrName: "#d19a66",
		attrValue: "#98c379",
		regex: "#56b6c2",
		builtin: "#56b6c2",
		important: "#c678dd",
		inserted: "#98c379",
		deleted: "#e06c75",
	},
	"one-light": {
		background: "#fafafa",
		foreground: "#383a42",
		selection: "#e5e5e6",
		inlineBackground: "#f1f2f3",
		inlineBorder: "#d8d9dc",
		comment: "#a0a1a7",
		punctuation: "#383a42",
		keyword: "#a626a4",
		operator: "#0184bc",
		string: "#50a14f",
		number: "#986801",
		property: "#e45649",
		variable: "#e45649",
		function: "#4078f2",
		className: "#c18401",
		tag: "#e45649",
		attrName: "#986801",
		attrValue: "#50a14f",
		regex: "#0184bc",
		builtin: "#0184bc",
		important: "#a626a4",
		inserted: "#50a14f",
		deleted: "#e45649",
	},
};

const prismThemesByTerminalTheme: Record<TerminalThemeId, PrismThemeStyle> = {
	"github-dark": createPrismTheme(prismPalettes["github-dark"]),
	"github-light": createPrismTheme(prismPalettes["github-light"]),
	dracula: createPrismTheme(prismPalettes.dracula),
	"ayu-dark": createPrismTheme(prismPalettes["ayu-dark"]),
	"ayu-light": createPrismTheme(prismPalettes["ayu-light"]),
	"solarized-dark": createPrismTheme(prismPalettes["solarized-dark"]),
	"solarized-light": createPrismTheme(prismPalettes["solarized-light"]),
	"one-dark": createPrismTheme(prismPalettes["one-dark"]),
	"one-light": createPrismTheme(prismPalettes["one-light"]),
};

export function getPrismTheme(themeId: TerminalThemeId): PrismThemeStyle {
	return prismThemesByTerminalTheme[themeId];
}
