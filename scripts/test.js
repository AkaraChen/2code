#!/usr/bin/env zx

console.log(chalk.blue("Running tests..."));

await Promise.all([$`pnpm test`, $`cd src-tauri && cargo nextest run`]);

console.log(chalk.green("Tests passed!"));
