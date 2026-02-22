import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { memo, use, useMemo } from "react";
import { ThemeContext } from "@/shared/providers/themeContext";

const COLORS = {
	light: { base: "#71717a", highlight: "#ffffff" },
	dark: { base: "#a1a1aa", highlight: "#09090b" },
};

interface TextShimmerProps {
	children: string;
	duration?: number;
	spread?: number;
}

/**
 * Animated text shimmer effect.
 * Adapted from https://github.com/vercel/ai-elements/blob/main/packages/elements/src/shimmer.tsx
 */
const TextShimmerComponent = ({
	children,
	duration = 2,
	spread = 2,
}: TextShimmerProps) => {
	const { isDark } = use(ThemeContext);
	const colors = isDark ? COLORS.dark : COLORS.light;

	const dynamicSpread = useMemo(
		() => (children?.length ?? 0) * spread,
		[children, spread],
	);

	return (
		<motion.p
			animate={{ backgroundPosition: "0% center" }}
			initial={{ backgroundPosition: "100% center" }}
			transition={{
				duration,
				ease: "linear",
				repeat: Number.POSITIVE_INFINITY,
			}}
			style={
				{
					"--spread": `${dynamicSpread}px`,
					backgroundImage: `linear-gradient(90deg, #0000 calc(50% - var(--spread)), ${colors.highlight}, #0000 calc(50% + var(--spread))), linear-gradient(${colors.base}, ${colors.base})`,
					backgroundSize: "250% 100%, auto",
					backgroundRepeat: "no-repeat, padding-box",
					backgroundClip: "text",
					WebkitBackgroundClip: "text",
					color: "transparent",
					display: "inline-block",
					fontSize: "var(--chakra-font-sizes-sm)",
				} as CSSProperties
			}
		>
			{children}
		</motion.p>
	);
};

export const TextShimmer = memo(TextShimmerComponent);
