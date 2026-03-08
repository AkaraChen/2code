#!/usr/bin/env zx

import { labeled } from "./_utils.js";

console.log(chalk.blue("Running lint..."));

await Promise.all([
	labeled("Running eslint", $`bunx eslint --fix`),
	labeled("Running clippy", $`cd src-tauri && cargo clippy -- -D warnings`),
]);

console.log(chalk.green("Lint passed!"));
