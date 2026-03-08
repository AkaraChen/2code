#!/usr/bin/env zx

console.log(chalk.blue("Running lint..."));

await Promise.all([
	$`pnpm lint:check`,
	$`cd src-tauri && cargo clippy -- -D warnings`,
]);

console.log(chalk.green("Lint passed!"));
