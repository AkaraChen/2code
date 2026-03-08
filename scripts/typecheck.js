#!/usr/bin/env zx

console.log(chalk.blue("Running typecheck..."));

await Promise.all([$`pnpm tsc --noEmit`, $`cd src-tauri && cargo check`]);

console.log(chalk.green("Typecheck passed!"));
