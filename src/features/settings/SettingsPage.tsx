import {
	Box,
	createListCollection,
	Field,
	Flex,
	Heading,
	Portal,
	Select,
	Skeleton,
	Stack,
	Switch,
	Tabs,
	Text,
} from "@chakra-ui/react";
import { use, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useDebugStore } from "@/features/debug/debugStore";
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

const localeCollection = createListCollection({
	items: [
		{ value: "en", label: "English" },
		{ value: "zh", label: "中文" },
	],
});

const settingsTabs = [
	"general",
	"terminal",
	"template",
	"notification",
	"topbar",
	"about",
] as const;

type SettingsTab = (typeof settingsTabs)[number];

function readSettingsTab(value: string | null): SettingsTab {
	return settingsTabs.includes(value as SettingsTab)
		? (value as SettingsTab)
		: "general";
}

export default function SettingsPage() {
	const { preference, setPreference } = use(ThemeContext);
	const { enabled: debugEnabled, setEnabled: setDebugEnabled } =
		useDebugStore();
	const locale = useLocale();
	const [searchParams, setSearchParams] = useSearchParams();
	const activeTab = readSettingsTab(searchParams.get("tab"));
	const [previewThemeId, setPreviewThemeId] =
		useState<TerminalThemeId | null>(null);

	const themeCollection = useMemo(() => {
		void locale;
		return createListCollection({
			items: [
				{ value: "system", label: m.themeSystem() },
				{ value: "light", label: m.themeLight() },
				{ value: "dark", label: m.themeDark() },
			],
		});
	}, [locale]);

	return (
		<Box p="8" pt="16">
			<Stack gap="6">
				<Heading size="2xl" fontWeight="bold">
					{m.settings()}
				</Heading>
				<Tabs.Root
					value={activeTab}
					onValueChange={(e) => {
						const nextTab = readSettingsTab(e.value);
						setSearchParams(
							nextTab === "general" ? {} : { tab: nextTab },
							{ replace: true },
						);
					}}
					variant="plain"
				>
					<Tabs.List bg="bg.muted" rounded="l3" p="1">
						<Tabs.Trigger value="general">
							{m.general()}
						</Tabs.Trigger>
						<Tabs.Trigger value="terminal">
							{m.terminal()}
						</Tabs.Trigger>
						<Tabs.Trigger value="template">
							{m.terminalTemplates()}
						</Tabs.Trigger>
						<Tabs.Trigger value="notification">
							{m.notification()}
						</Tabs.Trigger>
						<Tabs.Trigger value="topbar">{m.topbar()}</Tabs.Trigger>
						<Tabs.Trigger value="about">{m.about()}</Tabs.Trigger>
						<Tabs.Indicator rounded="l2" />
					</Tabs.List>
					<Tabs.Content value="general">
						<Stack gap="6" maxW="md">
							<Field.Root>
								<Field.Label>{m.language()}</Field.Label>
								<Select.Root
									collection={localeCollection}
									value={[locale]}
									onValueChange={(e) =>
										setAppLocale(e.value[0] as Locale)
									}
									size="sm"
								>
									<Select.HiddenSelect />
									<Select.Control>
										<Select.Trigger>
											<Select.ValueText />
										</Select.Trigger>
										<Select.IndicatorGroup>
											<Select.Indicator />
										</Select.IndicatorGroup>
									</Select.Control>
									<Portal>
										<Select.Positioner>
											<Select.Content>
												{localeCollection.items.map(
													(item) => (
														<Select.Item
															item={item}
															key={item.value}
														>
															{item.label}
															<Select.ItemIndicator />
														</Select.Item>
													),
												)}
											</Select.Content>
										</Select.Positioner>
									</Portal>
								</Select.Root>
							</Field.Root>
							<Field.Root>
								<Field.Label>{m.theme()}</Field.Label>
								<Select.Root
									collection={themeCollection}
									value={[preference]}
									onValueChange={(e) =>
										setPreference(
											e.value[0] as
												| "system"
												| "light"
												| "dark",
										)
									}
									size="sm"
								>
									<Select.HiddenSelect />
									<Select.Control>
										<Select.Trigger>
											<Select.ValueText />
										</Select.Trigger>
										<Select.IndicatorGroup>
											<Select.Indicator />
										</Select.IndicatorGroup>
									</Select.Control>
									<Portal>
										<Select.Positioner>
											<Select.Content>
												{themeCollection.items.map(
													(item) => (
														<Select.Item
															item={item}
															key={item.value}
														>
															{item.label}
															<Select.ItemIndicator />
														</Select.Item>
													),
												)}
											</Select.Content>
										</Select.Positioner>
									</Portal>
								</Select.Root>
							</Field.Root>
							<BorderRadiusPicker />
							<Field.Root>
								<Field.Label>{m.debugMode()}</Field.Label>
								<Switch.Root
									checked={debugEnabled}
									onCheckedChange={(e) =>
										setDebugEnabled(!!e.checked)
									}
								>
									<Switch.HiddenInput />
									<Switch.Control />
									<Switch.Label>
										<Text fontSize="sm" color="fg.muted">
											{m.debugModeDescription()}
										</Text>
									</Switch.Label>
								</Switch.Root>
							</Field.Root>
							<SidebarAppearanceSettings />
						</Stack>
					</Tabs.Content>
					<Tabs.Content value="terminal">
						<Flex gap="8" align="flex-start">
							<Stack gap="6" flex="1" minW="0" maxW="md">
								<TerminalThemePicker
									onPreview={setPreviewThemeId}
								/>
								<AsyncBoundary
									fallback={<Skeleton height="70px" />}
									errorFallback={({ error, onRetry }) => (
										<InlineError error={error} height="70px" onRetry={onRetry} />
									)}
								>
									<ShellPicker />
								</AsyncBoundary>
								<AsyncBoundary
									fallback={<Skeleton height="70px" />}
									errorFallback={({ error, onRetry }) => (
										<InlineError error={error} height="70px" onRetry={onRetry} />
									)}
								>
									<FontPicker />
								</AsyncBoundary>
								<FontSizePicker />
							</Stack>
							<Box flex="1" minW="0">
								<TerminalPreview themeId={previewThemeId} />
							</Box>
						</Flex>
					</Tabs.Content>
					<Tabs.Content value="template">
						<Stack gap="6" maxW="2xl">
							<GlobalTerminalTemplatesSettings />
						</Stack>
					</Tabs.Content>
					<Tabs.Content value="notification">
						<NotificationSettings />
					</Tabs.Content>
					<Tabs.Content value="topbar">
						<TopBarSettings />
					</Tabs.Content>
					<Tabs.Content value="about">
						<AboutSettings />
					</Tabs.Content>
				</Tabs.Root>
			</Stack>
		</Box>
	);
}
