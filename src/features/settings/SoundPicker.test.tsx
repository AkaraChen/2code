import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as m from "@/paraglide/messages.js";
import { SoundPicker } from "./SoundPicker";
import { useNotificationStore } from "./stores/notificationStore";

const { listSystemSoundsMock, playSystemSoundMock } = vi.hoisted(() => ({
	listSystemSoundsMock: vi.fn(),
	playSystemSoundMock: vi.fn(),
}));

vi.mock("@/generated", async () => {
	const actual = await vi.importActual<typeof import("@/generated")>(
		"@/generated",
	);
	return {
		...actual,
		listSystemSounds: listSystemSoundsMock,
		playSystemSound: playSystemSoundMock,
	};
});

async function renderSoundPicker() {
	await act(async () => {
		render(
			<Suspense fallback={null}>
				<SoundPicker />
			</Suspense>,
		);
	});
}

describe("soundPicker", () => {
	beforeEach(() => {
		listSystemSoundsMock.mockReset();
		playSystemSoundMock.mockReset();
		useNotificationStore.setState({ enabled: true, sound: "Ping" });
	});

	it("renders a disabled empty state when no system sounds are returned", async () => {
		listSystemSoundsMock.mockResolvedValue([]);

		await renderSoundPicker();

		expect(
			await screen.findByText(m.soundPickerUnavailableDescription()),
		).toBeInTheDocument();
		expect(screen.getByRole("combobox")).toBeDisabled();
		expect(screen.getByRole("button", { name: m.preview() })).toBeDisabled();
	});
});
