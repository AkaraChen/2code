import { describe, expect, it } from "vitest";
import { parseDiffFiles } from "./patchFiles";

const patch = `diff --git a/a.ts b/a.ts
index 587be6b..f9264f7 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
-old
+new
+line
`;

describe("parseDiffFiles", () => {
	it("reuses parsed file metadata for the same patch text", () => {
		const first = parseDiffFiles(patch);
		const second = parseDiffFiles(patch);

		expect(second).toBe(first);
		expect(first).toHaveLength(1);
	});
});
