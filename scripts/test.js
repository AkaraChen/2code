#!/usr/bin/env zx

console.log(chalk.blue("Running tests..."));

await Promise.all([$`pnpm vitest run`, $`cd src-tauri && cargo nextest run`]);

console.log(chalk.green("Tests passed!"));
