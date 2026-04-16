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
	closePtySession,
	createPtySession,
	deletePtySessionRecord,
} from "@/generated";
import { ThemeContext } from "@/shared/providers/themeContext";
import {
	useCloseTerminalTab,
	useCreateTerminalTab,
	useTerminalTheme,
	useTerminalThemeId,
} from "./hooks";
import { useTerminalStore } from "./store";
import { terminalThemes } from "./themes";

const createPtySessionMock = createPtySession as unknown as Mock;
const closePtySessionMock = closePtySession as unknown as Mock;
const deletePtySessionRecordMock = deletePtySessionRecord as unknown as Mock;

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
		notifiedTabs: new Set<string>(),
	});
	useFileViewerTabsStore.setState({ profiles: {} });
	useTerminalSettingsStore.setState({
		fontFamily: "JetBrains Mono",
		fontSize: 13,
		showAllFonts: false,
		darkTerminalTheme: "one-dark",
		lightTerminalTheme: "github-light",
		syncTerminalTheme: false,
	});
	localStorage.clear();
	createPtySessionMock.mockClear();
	closePtySessionMock.mockClear();
	deletePtySessionRecordMock.mockClear();
}

describe("terminal hooks", () => {
	beforeEach(() => {
		resetStores();
		createPtySessionMock.mockResolvedValue("mock-session-id");
		closePtySessionMock.mockResolvedValue(undefined);
		deletePtySessionRecordMock.mockResolvedValue(undefined);
	});

	it("creates terminal tabs with the next default title and stores them on success", async () => {
		useTerminalStore
			.getState()
			.addTab("profile-1", "existing-session", "Terminal 1");

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

		expect(createPtySessionMock).toHaveBeenCalledWith({
			meta: {
				profileId: "profile-1",
				title: "Terminal 2",
			},
			config: {
				shell: "/bin/zsh",
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

		expect(closePtySessionMock).toHaveBeenCalledWith({
			sessionId: "session-1",
		});
		expect(deletePtySessionRecordMock).toHaveBeenCalledWith({
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
