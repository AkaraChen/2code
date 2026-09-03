import { describe, expect, it } from "vitest";
import { shouldNotifyAgentWaiting } from "./agentNotification";

describe("shouldNotifyAgentWaiting", () => {
	it.each([
		{
			name: "notifies on a waiting edge when notifications are enabled and window is unfocused",
			input: {
				status: "waiting",
				previousStatus: "running",
				notificationsEnabled: true,
				windowFocused: false,
			},
			expected: true,
		},
		{
			name: "does not notify when already waiting",
			input: {
				status: "waiting",
				previousStatus: "waiting",
				notificationsEnabled: true,
				windowFocused: false,
			},
			expected: false,
		},
		{
			name: "does not notify while focused",
			input: {
				status: "waiting",
				previousStatus: "running",
				notificationsEnabled: true,
				windowFocused: true,
			},
			expected: false,
		},
		{
			name: "does not notify when notifications are disabled",
			input: {
				status: "waiting",
				previousStatus: "running",
				notificationsEnabled: false,
				windowFocused: false,
			},
			expected: false,
		},
		{
			name: "does not notify for idle status",
			input: {
				status: null,
				previousStatus: "running",
				notificationsEnabled: true,
				windowFocused: false,
			},
			expected: false,
		},
	] as const)("$name", ({ input, expected }) => {
		expect(shouldNotifyAgentWaiting(input)).toBe(expected);
	});
});
