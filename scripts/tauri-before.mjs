import { execFileSync } from "node:child_process";

const mode = process.argv[2];
const bun = process.env.BUN || "bun";

if (mode === "dev") {
	execFileSync(bun, ["./scripts/build-helper.mjs", "debug"], {
		stdio: "inherit",
	});
	execFileSync(bun, ["run", "dev"], { stdio: "inherit" });
} else if (mode === "build") {
	execFileSync(bun, ["./scripts/build-helper.mjs", "release"], {
		stdio: "inherit",
	});
	execFileSync(bun, ["run", "build"], { stdio: "inherit" });
} else {
	throw new Error("Usage: bun ./scripts/tauri-before.mjs <dev|build>");
}
