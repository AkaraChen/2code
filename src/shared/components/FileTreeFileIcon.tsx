/* eslint-disable react/dom-no-dangerously-set-innerhtml -- Renders static SVG symbol markup from @pierre/trees. */
import { getBuiltInFileIconColor } from "@pierre/trees";
import type { CSSProperties, SVGProps } from "react";
import {
	getFileTreeIconSymbol,
	resolveFileTreeFileIcon,
} from "@/shared/lib/fileTreeIcons";

interface FileTreeFileIconProps
	extends Omit<
		SVGProps<SVGSVGElement>,
		"children" | "dangerouslySetInnerHTML" | "height" | "viewBox" | "width"
	> {
	fileName: string;
	size?: number;
}

export default function FileTreeFileIcon({
	fileName,
	size = 14,
	style,
	...props
}: FileTreeFileIconProps) {
	const icon = resolveFileTreeFileIcon(fileName);
	const symbol = getFileTreeIconSymbol(icon.name);
	const color = icon.token == null
		? undefined
		: getBuiltInFileIconColor(icon.token);
	const iconStyle = {
		color,
		display: "block",
		flexShrink: 0,
		...style,
	} satisfies CSSProperties;

	return (
		<svg
			{...props}
			aria-hidden="true"
			data-icon-name={icon.remappedFrom ?? icon.name}
			data-icon-token={icon.token}
			focusable="false"
			height={size}
			style={iconStyle}
			viewBox={icon.viewBox ?? symbol.viewBox}
			width={size}
			dangerouslySetInnerHTML={{ __html: symbol.body }}
		/>
	);
}
