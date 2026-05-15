import { bench, describe } from "vitest";
import { buildSoundSelectItems } from "./soundOptions";

const sounds = Array.from({ length: 2_000 }, (_, index) => `Sound ${index}`);

function buildWithMapAndSpread() {
	return [
		{ value: "", label: "None" },
		...sounds.map((sound) => ({ value: sound, label: sound })),
	];
}

describe("sound select item construction", () => {
	bench("map plus spread sounds", () => {
		buildWithMapAndSpread();
	});

	bench("preallocated sounds", () => {
		buildSoundSelectItems(sounds, "None");
	});
});
