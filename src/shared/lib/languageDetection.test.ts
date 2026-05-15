import { describe, expect, it } from "vitest";
import { detectLanguage, detectMonacoLanguage } from "./languageDetection";

describe("languageDetection", () => {
	it("detects languages by extension and known file names", () => {
		expect(detectLanguage("App.tsx")).toBe("tsx");
		expect(detectLanguage("main.rs")).toBe("rust");
		expect(detectLanguage("Dockerfile")).toBe("docker");
		expect(detectLanguage(".env")).toBe("bash");
		expect(detectLanguage("unknown.ext")).toBe("text");
	});

	it("maps Prism language ids to Monaco ids", () => {
		expect(detectMonacoLanguage("App.tsx")).toBe("typescript");
		expect(detectMonacoLanguage("script.sh")).toBe("shell");
		expect(detectMonacoLanguage("README.unknown")).toBe("plaintext");
	});
});
