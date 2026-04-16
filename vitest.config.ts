import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: "@/paraglide/messages.js",
				replacement: path.resolve(
					__dirname,
					"./src/test/paraglide/messages.ts",
				),
			},
			{
				find: "@/paraglide/runtime.js",
				replacement: path.resolve(
					__dirname,
					"./src/test/paraglide/runtime.ts",
				),
			},
			{
				find: "@",
				replacement: path.resolve(__dirname, "./src"),
			},
		],
	},
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
