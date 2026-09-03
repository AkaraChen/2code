/**
 * xterm.js link provider for file paths in terminal output.
 *
 * Detects file-path:line:col patterns and opens them in the 2code file viewer.
 */
import type { IBufferRange, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import consola from "consola";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import { resolveTerminalFilePath } from "@/generated";
import { FILE_LINK_REGEX, parseFileLink } from "./fileLinks";
import { useFileLinkPickerStore } from "./fileLinkPickerStore";

interface FileLinkProviderOptions {
	profileId: string;
}

export class FileLinkProvider implements ILinkProvider {
	private readonly profileId: string;

	constructor(options: FileLinkProviderOptions) {
		this.profileId = options.profileId;
	}

	provideLinks(
		bufferLineNumber: number,
		callback: (links: ILink[] | undefined) => void,
	): void {
		const lineText = this.getLineText(bufferLineNumber);
		if (!lineText) {
			callback(undefined);
			return;
		}

		const links: ILink[] = [];
		const regex = new RegExp(FILE_LINK_REGEX.source, "g");

		for (
			let match = regex.exec(lineText);
			match !== null;
			match = regex.exec(lineText)
		) {
			const text = match[0];
			const parsed = parseFileLink(text);
			if (!parsed) continue;

			// Ignore URL-like paths (http:// or https://)
			if (
				parsed.filePath.startsWith("http://") ||
				parsed.filePath.startsWith("https://")
			) {
				continue;
			}

			const startX = match.index + 1; // 1-based
			const endX = startX + text.length - 1;

			const range: IBufferRange = {
				start: { x: startX, y: bufferLineNumber },
				end: { x: endX, y: bufferLineNumber },
			};

			const profileId = this.profileId;

			links.push({
				range,
				text,
				activate(_event: MouseEvent, linkText: string) {
					const location = parseFileLink(linkText);
					if (!location) return;

					void resolveTerminalFilePath({
						profileId,
						filePath: location.filePath,
					})
						.then((result) => {
							if (result.type === "exact") {
								useFileViewerTabsStore
									.getState()
									.openFile(profileId, result.path);
							} else if (
								result.type === "fuzzy" &&
								result.candidates.length > 0
							) {
								useFileLinkPickerStore.getState().show(
									profileId,
									result.candidates,
								);
							}
						})
						.catch((error) => {
							consola.warn(
								`[file-link] Could not open "${location.filePath}":`,
								error,
							);
						});
				},
			});
		}

		callback(links.length > 0 ? links : undefined);
	}

	// Terminal reference, set externally after construction
	private terminal: Terminal | null = null;

	setTerminal(terminal: Terminal): void {
		this.terminal = terminal;
	}

	private getLineText(lineNumber: number): string | null {
		if (!this.terminal) return null;
		const buffer = this.terminal.buffer.active;
		const line = buffer.getLine(lineNumber - 1); // 0-based buffer index
		return line ? line.translateToString(true) : null;
	}
}
