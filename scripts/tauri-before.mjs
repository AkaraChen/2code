import { execFileSync } from "node:child_process";
import { argv, env } from "node:process";

const mode = argv[2];
const bun = env.BUN || "bun";

if (mode === "dev") {
	execFileSync(bun, ["run", "dev"], { stdio: "inherit" });
} else if (mode === "build") {
	execFileSync(bun, ["run", "build"], { stdio: "inherit" });
} else {
	throw new Error("Usage: bun ./scripts/tauri-before.mjs <dev|build>");
}
