export async function labeled(text, p) {
	console.log(chalk.blue(text));
	await p;
	console.log(chalk.green(`${text} completed!`));
}
