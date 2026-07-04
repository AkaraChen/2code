import { render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openUpdatePage } from "@/generated";
import StartupUpdateCheck from "./StartupUpdateCheck";

const mocks = vi.hoisted(() => ({
	checkForUpdate: vi.fn(),
}));

vi.mock("./store", () => ({
	checkForUpdate: mocks.checkForUpdate,
}));

vi.mock("sonner", () => ({
	toast: {
		info: vi.fn(),
	},
}));

describe("startup update check", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("opens the dedicated update page from the update toast", async () => {
		mocks.checkForUpdate.mockResolvedValue({
			currentVersion: "1.0.0",
			version: "1.1.0",
		});

		render(<StartupUpdateCheck />);

		await waitFor(() => expect(toast.info).toHaveBeenCalled());

		const options = vi.mocked(toast.info).mock.calls[0]?.[1] as {
			action?: { onClick?: () => void };
		};
		options.action?.onClick?.();

		expect(openUpdatePage).toHaveBeenCalledTimes(1);
	});
});
