import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: path.resolve(__dirname),
	resolve: {
		alias: [
			{
				find: "@",
				replacement: path.resolve(__dirname, "./src"),
			},
		],
	},
	test: {
		globals: true,
		environment: "jsdom",
		pool: "threads",
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
