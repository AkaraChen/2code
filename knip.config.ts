import type { KnipConfig } from "knip";

const config: KnipConfig = {
	project: ["src/**/*.{ts,tsx}"],
	ignore: ["src/generated/**", "src/vite-env.d.ts"],
	ignoreDependencies: ["babel-plugin-react-compiler"],
};

export default config;
