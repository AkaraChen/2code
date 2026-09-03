import type { KnipConfig } from "knip";

const config: KnipConfig = {
	project: ["legacy/web/src/**/*.{ts,tsx}"],
	ignore: [
		"legacy/web/src/generated/**",
		"legacy/web/src/paraglide/**",
		"legacy/web/src/vite-env.d.ts",
		"legacy/web/src/components/ui/**",
		"legacy/web/src/shared/lib/node-stubs/diagnostics-channel.ts",
	],
	ignoreDependencies: [
		"react-grab",
		"@fontsource-variable/geist",
		"@fontsource-variable/inter",
		"tw-animate-css",
		"tailwindcss",
		"shadcn",
	],
	ignoreBinaries: ["just"],
};

export default config;
