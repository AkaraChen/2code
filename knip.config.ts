import type { KnipConfig } from "knip";

const config: KnipConfig = {
	project: ["src/**/*.{ts,tsx}"],
	ignore: ["src/generated/**", "src/paraglide/**", "src/vite-env.d.ts"],
};

export default config;
