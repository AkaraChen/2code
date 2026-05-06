import antfu from "@antfu/eslint-config";
import eslintReact from "@eslint-react/eslint-plugin";
import reactRefresh from "eslint-plugin-react-refresh";

const reactFiles = ["src/**/*.ts", "src/**/*.tsx"];
const reactComponentFiles = ["src/**/*.tsx"];

export default antfu({
	stylistic: false,
	react: false,
	imports: false,
})
	.append({
		ignores: [
			"**/*.md",
			"./src-tauri/target/**",
			"./src/generated/**",
			"./src/paraglide/**",
		],
	})
	.append({
		files: reactFiles,
		languageOptions: {
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
			},
			sourceType: "module",
		},
		plugins: eslintReact.configs["recommended-typescript"].plugins,
		rules: {
			...eslintReact.configs["recommended-typescript"].rules,
			"@eslint-react/dom-no-string-style-prop": "off",
			"@eslint-react/dom-no-unknown-property": "off",
		},
	})
	.append({
		files: reactComponentFiles,
		plugins: reactRefresh.configs.vite.plugins,
		rules: reactRefresh.configs.vite.rules,
	})
	.append({
		rules: {
			"perfectionist/sort-imports": "off",
			"perfectionist/sort-named-exports": "off",
			"perfectionist/sort-named-imports": "off",
			"sort-imports": "off",
		},
	});
