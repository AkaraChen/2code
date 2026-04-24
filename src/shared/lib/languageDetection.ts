const EXT_MAP: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	mts: "tsx",
	cts: "typescript",
	mtsx: "tsx",
	ctsx: "tsx",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "jsx",
	rs: "rust",
	py: "python",
	rb: "ruby",
	go: "go",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	c: "c",
	cpp: "cpp",
	cc: "cpp",
	h: "c",
	cs: "csharp",
	sh: "bash",
	zsh: "bash",
	fish: "bash",
	toml: "toml",
	yaml: "yaml",
	yml: "yaml",
	json: "json",
	md: "markdown",
	mdx: "markdown",
	html: "html",
	css: "css",
	scss: "scss",
	sass: "scss",
	sql: "sql",
	graphql: "graphql",
	gql: "graphql",
	xml: "xml",
	dockerfile: "docker",
	tf: "hcl",
	hcl: "hcl",
	lua: "lua",
	php: "php",
	r: "r",
	ex: "elixir",
	exs: "elixir",
	erl: "erlang",
	hs: "haskell",
	elm: "elm",
	clj: "clojure",
	cljs: "clojure",
	vue: "markup",
	svelte: "markup",
	dart: "dart",
	proto: "protobuf",
};

const NAME_MAP: Record<string, string> = {
	dockerfile: "docker",
	makefile: "makefile",
	justfile: "makefile",
	".env": "bash",
	".gitignore": "bash",
	".gitattributes": "bash",
};

export function detectLanguage(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	const baseName = filename.toLowerCase();
	return NAME_MAP[baseName] ?? EXT_MAP[ext] ?? "text";
}

const MONACO_LANGUAGE_OVERRIDES: Record<string, string> = {
	bash: "shell",
	docker: "dockerfile",
	jsx: "javascript",
	markup: "html",
	text: "plaintext",
	tsx: "typescript",
};

export function detectMonacoLanguage(filename: string): string {
	const language = detectLanguage(filename);
	return MONACO_LANGUAGE_OVERRIDES[language] ?? language;
}
