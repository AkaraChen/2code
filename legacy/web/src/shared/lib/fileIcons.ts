import {
	getIconForFile,
	getIconForFolder,
	getIconForOpenFolder,
} from "vscode-icons-js";

const FILE_ICONS_BASE_PATH = `${import.meta.env.BASE_URL}file-icons`;

export function getFileIconUrl(name: string) {
	return `${FILE_ICONS_BASE_PATH}/${getIconForFile(name) ?? "default_file.svg"}`;
}

export function getFolderIconUrl(name: string, isOpen: boolean) {
	const icon = isOpen ? getIconForOpenFolder(name) : getIconForFolder(name);
	return `${FILE_ICONS_BASE_PATH}/${icon}`;
}
