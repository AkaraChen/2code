import { Image } from "@chakra-ui/react";
import { use, useState } from "react";
import { RiRobot2Line } from "react-icons/ri";
import { ThemeContext } from "@/shared/providers/themeContext";

interface AgentIconProps {
	iconUrl?: string | null;
	size?: number | string;
	alt?: string;
}

export function AgentIcon({ iconUrl, size = 16, alt = "" }: AgentIconProps) {
	const { isDark } = use(ThemeContext);
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const imageSize = typeof size === "number" ? `${size}px` : size;

	const failed = iconUrl === failedUrl && iconUrl !== null;

	if (!iconUrl || failed) {
		return <RiRobot2Line size={size} />;
	}

	return (
		<Image
			src={iconUrl}
			width={imageSize}
			height={imageSize}
			objectFit="contain"
			filter={isDark ? "invert(1)" : "none"}
			onError={() => setFailedUrl(iconUrl ?? null)}
			alt={alt}
		/>
	);
}
