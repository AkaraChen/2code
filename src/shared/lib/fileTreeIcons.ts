import {
	createFileTreeIconResolver,
	getBuiltInSpriteSheet,
} from "@pierre/trees";

const FILE_TREE_ICON_NAME = "file-tree-icon-file";
const FILE_TREE_ICON_RESOLVER = createFileTreeIconResolver("complete");
const FILE_TREE_ICON_SPRITE = getBuiltInSpriteSheet("complete");
const LEADING_HASH_RE = /^#/;
const REGEXP_SPECIAL_CHARS_RE = /[.*+?^${}()|[\]\\]/g;

interface FileTreeIconSymbol {
	body: string;
	viewBox: string;
}

const DEFAULT_SYMBOL: FileTreeIconSymbol = {
	body: "",
	viewBox: "0 0 16 16",
};

const symbolCache = new Map<string, FileTreeIconSymbol>();

function escapeRegExp(value: string) {
	return value.replace(REGEXP_SPECIAL_CHARS_RE, "\\$&");
}

export function resolveFileTreeFileIcon(fileName: string) {
	return FILE_TREE_ICON_RESOLVER.resolveIcon(FILE_TREE_ICON_NAME, fileName);
}

export function getFileTreeIconSymbol(iconName: string): FileTreeIconSymbol {
	const normalizedName = iconName.replace(LEADING_HASH_RE, "");
	const cachedSymbol = symbolCache.get(normalizedName);
	if (cachedSymbol) return cachedSymbol;

	const match = FILE_TREE_ICON_SPRITE.match(
		new RegExp(
			`<symbol\\b(?=[^>]*\\bid="${escapeRegExp(normalizedName)}")[^>]*\\bviewBox="([^"]+)"[^>]*>([\\s\\S]*?)<\\/symbol>`,
		),
	);
	let symbol: FileTreeIconSymbol;
	if (match) {
		symbol = { body: match[2].trim(), viewBox: match[1] };
	} else if (normalizedName === FILE_TREE_ICON_NAME) {
		symbol = DEFAULT_SYMBOL;
	} else {
		symbol = getFileTreeIconSymbol(FILE_TREE_ICON_NAME);
	}

	symbolCache.set(normalizedName, symbol);
	return symbol;
}
