import antfu from "@antfu/eslint-config";

export default antfu({
	stylistic: false,
	react: true,
	imports: false,
})
	.append({
		ignores: ["**/*.md", "./src-tauri/target/**", "./scripts/**"],
	})
	.append({
		rules: {
			"perfectionist/sort-imports": "off",
			"perfectionist/sort-named-exports": "off",
			"perfectionist/sort-named-imports": "off",
			"sort-imports": "off",
		},
	});
