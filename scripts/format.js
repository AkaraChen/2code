#!/usr/bin/env zx

console.log(chalk.blue("Running format..."));

await Promise.all([$`bunx prettier --write .`, $`cd src-tauri && cargo fmt`]);

console.log(chalk.green("Format complete!"));
