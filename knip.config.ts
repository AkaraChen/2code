import type { KnipConfig } from "knip";

const config: KnipConfig = {
	project: ["src/**/*.{ts,tsx}"],
	ignore: [
		"src/generated/**",
		"src/paraglide/**",
		"src/vite-env.d.ts",
		// shadcn/ui primitives are intentionally kept regenerable.
		"src/components/ui/**",
		// Vite aliases node:diagnostics_channel to this browser stub.
		"src/shared/lib/node-stubs/diagnostics-channel.ts",
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
