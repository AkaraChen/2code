import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as m from "@/paraglide/messages.js";
import { FontPicker } from "./FontPicker";
import { useTerminalSettingsStore } from "./stores/terminalSettingsStore";

const { listSystemFontsMock } = vi.hoisted(() => ({
	listSystemFontsMock: vi.fn(),
}));

vi.mock("@/generated", async () => {
	const actual = await vi.importActual<typeof import("@/generated")>(
		"@/generated",
	);
	return {
		...actual,
		listSystemFonts: listSystemFontsMock,
	};
});

async function renderFontPicker() {
	await act(async () => {
		render(
			<Suspense fallback={null}>
				<FontPicker />
			</Suspense>,
		);
	});
}

describe("fontPicker", () => {
	beforeEach(() => {
		listSystemFontsMock.mockReset();
		useTerminalSettingsStore.setState({
			fontFamily: "JetBrains Mono",
			showAllFonts: false,
		});
	});

	it("renders a disabled empty state when no system fonts are returned", async () => {
		listSystemFontsMock.mockResolvedValue([]);

		await renderFontPicker();

		expect(
			await screen.findByText(m.fontPickerUnavailableDescription()),
		).toBeInTheDocument();
		expect(screen.getByRole("combobox")).toBeDisabled();
	});
});
