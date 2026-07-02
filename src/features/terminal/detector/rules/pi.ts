import { defineRule, type Manifest } from "../types";

const pi: Manifest = {
	id: "pi",
	aliases: ["herdr:pi"],
	rules: [
		defineRule("working_literal", "working", 100, "whole_recent", {
			contains: ["Working..."],
		}, { visibleWorking: true }),
	],
};

export default pi;
