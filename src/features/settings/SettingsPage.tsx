import { BellIcon, CodeIcon, GearSixIcon, InfoIcon, MonitorIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { use, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import { useDebugStore } from "@/features/debug/debugStore";
import { usePerformanceProfileStore } from "@/features/debug/performanceProfileStore";
import { TerminalPreview } from "@/features/terminal/TerminalPreview";
import type { TerminalThemeId } from "@/features/terminal/themes";
import { TopBarSettings } from "@/features/topbar/TopBarSettings";
import * as m from "@/paraglide/messages.js";
import type { Locale } from "@/paraglide/runtime.js";
import { AsyncBoundary, InlineError } from "@/shared/components/Fallbacks";
import { setAppLocale, useLocale } from "@/shared/lib/locale";
import { ThemeContext } from "@/shared/providers/themeContext";
import { AboutSettings } from "./AboutSettings";
import { BorderRadiusPicker } from "./BorderRadiusPicker";
import { FontPicker } from "./FontPicker";
import { FontSizePicker } from "./FontSizePicker";
import { GlobalTerminalTemplatesSettings } from "./GlobalTerminalTemplatesSettings";
import { NotificationSettings } from "./NotificationSettings";
import { SidebarAppearanceSettings } from "./SidebarAppearanceSettings";
import { ShellPicker } from "./ShellPicker";
import { TerminalThemePicker } from "./TerminalThemePicker";
import { WorktreeSettings } from "./WorktreeSettings";

const localeOptions: { value: Locale; label: string }[] = [
	{ value: "en", label: "English" },
	{ value: "zh", label: "中文" },
];

const settingsTabs = [
	"general",
	"terminal",
	"template",
	"notification",
	"topbar",
	"about",
] as const;

type SettingsTab = (typeof settingsTabs)[number];

const settingsTabIcons: Record<SettingsTab, ReactNode> = {
	general: <GearSixIcon />,
	terminal: <TerminalWindowIcon />,
	template: <CodeIcon />,
	notification: <BellIcon />,
	topbar: <MonitorIcon />,
	about: <InfoIcon />,
};

function readSettingsTab(value: string | null): SettingsTab {
	return settingsTabs.includes(value as SettingsTab)
		? (value as SettingsTab)
		: "general";
}

export default function SettingsPage() {
	const { preference, setPreference } = use(ThemeContext);
	const debugEnabled = useDebugStore((state) => state.enabled);
	const setDebugEnabled = useDebugStore((state) => state.setEnabled);
	const performanceProfileEnabled = usePerformanceProfileStore(
		(state) => state.enabled,
	);
	const setPerformanceProfileEnabled = usePerformanceProfileStore(
		(state) => state.setEnabled,
	);
	const locale = useLocale();
	const [searchParams, setSearchParams] = useSearchParams();
	const activeTab = readSettingsTab(searchParams.get("tab"));
	const [previewThemeId, setPreviewThemeId] =
		useState<TerminalThemeId | null>(null);

	const themeOptions = [
		{ value: "system", label: m.themeSystem() },
		{ value: "light", label: m.themeLight() },
		{ value: "dark", label: m.themeDark() },
	] as const;

	return (
		<div className="flex h-full flex-col">
			<header
				data-tauri-drag-region
				className="flex h-[52px] shrink-0 items-center gap-2 border-b px-5"
			>
				<GearSixIcon className="size-4 text-muted-foreground" />
				<h1 className="select-none text-sm font-semibold">{m.settings()}</h1>
			</header>
			<div className="min-h-0 flex-1 overflow-auto p-5">
				<Tabs
					value={activeTab}
					onValueChange={(value) => {
						const nextTab = readSettingsTab(String(value));
						setSearchParams(
							nextTab === "general" ? {} : { tab: nextTab },
							{ replace: true },
						);
					}}
				>
					<TabsList className="mb-5 max-w-full overflow-x-auto">
						{settingsTabs.map((tab) => (
							<TabsTrigger key={tab} value={tab}>
								{settingsTabIcons[tab]}
								{tab === "general"
									? m.general()
									: tab === "terminal"
										? m.terminal()
										: tab === "template"
											? m.terminalTemplates()
											: tab === "notification"
												? m.notification()
												: tab === "topbar"
													? m.topbar()
													: m.about()}
							</TabsTrigger>
						))}
					</TabsList>

					<TabsContent value="general">
						<div className="flex max-w-md flex-col gap-6">
							<Field>
								<FieldLabel>{m.language()}</FieldLabel>
								<NativeSelect
									value={locale}
									onChange={(event) =>
										setAppLocale(event.target.value as Locale)
									}
									size="sm"
								>
									{localeOptions.map((item) => (
										<NativeSelectOption
											key={item.value}
											value={item.value}
										>
											{item.label}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>

							<Field>
								<FieldLabel>{m.theme()}</FieldLabel>
								<NativeSelect
									value={preference}
									onChange={(event) =>
										setPreference(
											event.target.value as
												| "system"
												| "light"
												| "dark",
										)
									}
									size="sm"
								>
									{themeOptions.map((item) => (
										<NativeSelectOption
											key={item.value}
											value={item.value}
										>
											{item.label}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>

							<BorderRadiusPicker />
							<WorktreeSettings />

							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel>{m.debugMode()}</FieldLabel>
									<FieldDescription>
										{m.debugModeDescription()}
									</FieldDescription>
								</FieldContent>
								<Switch
									checked={debugEnabled}
									onCheckedChange={setDebugEnabled}
								/>
							</Field>

							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel>{m.performanceProfile()}</FieldLabel>
									<FieldDescription>
										{m.performanceProfileDescription()}
									</FieldDescription>
								</FieldContent>
								<Switch
									checked={performanceProfileEnabled}
									onCheckedChange={setPerformanceProfileEnabled}
								/>
							</Field>

							<SidebarAppearanceSettings />
						</div>
					</TabsContent>

					<TabsContent value="terminal">
						<div className="flex items-start gap-8">
							<div className="flex min-w-0 max-w-md flex-1 flex-col gap-6">
								<TerminalThemePicker onPreview={setPreviewThemeId} />
								<AsyncBoundary
									fallback={<Skeleton className="h-[70px]" />}
									errorFallback={({ error, onRetry }) => (
										<InlineError
											error={error}
											height="70px"
											onRetry={onRetry}
										/>
									)}
								>
									<ShellPicker />
								</AsyncBoundary>
								<AsyncBoundary
									fallback={<Skeleton className="h-[70px]" />}
									errorFallback={({ error, onRetry }) => (
										<InlineError
											error={error}
											height="70px"
											onRetry={onRetry}
										/>
									)}
								>
									<FontPicker />
								</AsyncBoundary>
								<FontSizePicker />
							</div>
							<div className="min-w-0 flex-1">
								<TerminalPreview themeId={previewThemeId} />
							</div>
						</div>
					</TabsContent>

					<TabsContent value="template">
						<div className="max-w-2xl">
							<GlobalTerminalTemplatesSettings />
						</div>
					</TabsContent>
					<TabsContent value="notification">
						<NotificationSettings />
					</TabsContent>
					<TabsContent value="topbar">
						<TopBarSettings />
					</TabsContent>
					<TabsContent value="about">
						<AboutSettings />
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
