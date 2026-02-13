import antfu from "@antfu/eslint-config";

export default antfu({
	stylistic: false,
	react: true,
	imports: false,
}).overrideRules({
	"perfectionist/sort-imports": "off",
});
