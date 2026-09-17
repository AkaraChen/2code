import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
	closeTerminalSession,
	createTerminalSession,
} from "@/generated";
import { ThemeContext } from "@/shared/providers/themeContext";
import {
	DEFAULT_TERMINAL_SHELL,
	useCloseTerminalTab,
	useCreateTerminalTab,
	useTerminalTheme,
	useTerminalThemeId,
} from "./hooks";
import { useTerminalStore } from "./store";
import { terminalThemes } from "./themes";

const createTerminalSessionMock = createTerminalSession as unknown as Mock;
const closeTerminalSessionMock = closeTerminalSession as unknown as Mock;

const { toastErrorMock } = vi.hoisted(() => ({
	toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: vi.fn(),
	},
}));

function createWrapper(isDark = true) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	return ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<ThemeContext
				value={{
					preference: isDark ? "dark" : "light",
					setPreference: () => {},
					isDark,
				}}
			>
				{children}
			</ThemeContext>
		</QueryClientProvider>
	);
}

function resetStores() {
	useTerminalStore.setState({
		profiles: {},
		agentStatuses: {},
		agentCompletions: {},
		sessionProfileIds: {},
	});
	useFileViewerTabsStore.setState({ profiles: {} });
	useTerminalSettingsStore.setState({
		fontFamily: "JetBrains Mono",
		fontSize: 13,
		defaultShell: DEFAULT_TERMINAL_SHELL,
		showAllFonts: false,
		darkTerminalTheme: "one-dark",
		lightTerminalTheme: "github-light",
		syncTerminalTheme: false,
	});
	localStorage.clear();
	createTerminalSessionMock.mockClear();
	closeTerminalSessionMock.mockClear();
	toastErrorMock.mockClear();
}

describe("terminal hooks", () => {
	beforeEach(() => {
		resetStores();
		createTerminalSessionMock.mockResolvedValue("mock-session-id");
		closeTerminalSessionMock.mockResolvedValue(undefined);
	});

	it("creates terminal tabs with the next default title and stores them on success", async () => {
		useTerminalStore
			.getState()
			.addTab("profile-1", "existing-session", "Terminal 1");
		useFileViewerTabsStore
			.getState()
			.openFile("profile-1", "/repo/src/main.tsx");

		const { result } = renderHook(() => useCreateTerminalTab(), {
			wrapper: createWrapper(),
		});

		await act(async () => {
			await result.current.mutateAsync({
				profileId: "profile-1",
				cwd: "/repo",
				startupCommands: ["bun dev"],
			});
		});

		expect(createTerminalSessionMock).toHaveBeenCalledWith({
			meta: {
				profileId: "profile-1",
				title: "Terminal 2",
			},
			config: {
				shell: DEFAULT_TERMINAL_SHELL,
				cwd: "/repo",
				rows: 24,
				cols: 80,
				startupCommands: ["bun dev"],
			},
		});
		expect(useTerminalStore.getState().profiles["profile-1"].tabs).toEqual([
			{
				id: "existing-session",
				title: "Terminal 1",
			},
			{
				id: "mock-session-id",
				title: "Terminal 2",
			},
		]);
		expect(
			useFileViewerTabsStore.getState().profiles["profile-1"].fileTabActive,
		).toBe(false);
	});

	it("toasts the fail-closed Herdr error when New Tab cannot attach", async () => {
		const message =
			"Herdr server is incompatible: found Herdr 0.8.2 protocol 20; required Herdr >= 0.9.0 / protocol >= 22; run `herdr update`";
		createTerminalSessionMock.mockRejectedValue(message);

		const { result } = renderHook(() => useCreateTerminalTab(), {
			wrapper: createWrapper(),
		});

		await act(async () => {
			await result.current.mutateAsync({
				profileId: "profile-1",
				cwd: "/repo",
			}).catch(() => undefined);
		});

		expect(toastErrorMock).toHaveBeenCalledWith(message);
	});

	it("closes the last terminal tab and re-activates the current file tab when one exists", async () => {
		useTerminalStore
			.getState()
			.addTab("profile-1", "session-1", "Terminal 1");
		useFileViewerTabsStore
			.getState()
			.openFile("profile-1", "/repo/src/main.tsx");
		useFileViewerTabsStore.getState().setTerminalActive("profile-1");

		const { result } = renderHook(() => useCloseTerminalTab(), {
			wrapper: createWrapper(),
		});

		await act(async () => {
			await result.current.mutateAsync({
				profileId: "profile-1",
				sessionId: "session-1",
			});
		});

		expect(closeTerminalSessionMock).toHaveBeenCalledWith({
			sessionId: "session-1",
		});
		expect(useTerminalStore.getState().profiles["profile-1"]).toBeUndefined();
		expect(
			useFileViewerTabsStore.getState().profiles["profile-1"],
		).toMatchObject({
			activeFilePath: "/repo/src/main.tsx",
			fileTabActive: true,
		});
	});

	it("selects the dark or light theme id from ThemeContext unless syncing is enabled", () => {
		const darkHook = renderHook(() => useTerminalThemeId(), {
			wrapper: createWrapper(true),
		});
		expect(darkHook.result.current).toBe("one-dark");

		const lightHook = renderHook(() => useTerminalThemeId(), {
			wrapper: createWrapper(false),
		});
		expect(lightHook.result.current).toBe("github-light");

		useTerminalSettingsStore.getState().setSyncTerminalTheme(true);
		lightHook.rerender();
		expect(lightHook.result.current).toBe("one-dark");
	});

	it("returns the resolved xterm theme object for the selected theme id", () => {
		const { result } = renderHook(() => useTerminalTheme(), {
			wrapper: createWrapper(false),
		});

		expect(result.current).toBe(terminalThemes["github-light"]);
	});
});
