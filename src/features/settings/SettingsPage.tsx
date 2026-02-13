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
import { Suspense, useMemo, useState } from "react";
import { useDebugStore } from "@/features/debug/debugStore";
import { TerminalPreview } from "@/features/terminal/TerminalPreview";
import type { TerminalThemeId } from "@/features/terminal/themes";
import * as m from "@/paraglide/messages.js";
import type { Locale } from "@/paraglide/runtime.js";
import { getLocale, setLocale } from "@/paraglide/runtime.js";
import { useThemePreference } from "@/shared/providers/ThemeProvider";
import { AccentColorPicker } from "./AccentColorPicker";
import { BorderRadiusPicker } from "./BorderRadiusPicker";
import { FontPicker } from "./FontPicker";
import { FontSizePicker } from "./FontSizePicker";
import { NotificationSettings } from "./NotificationSettings";
import { TerminalThemePicker } from "./TerminalThemePicker";

const localeCollection = createListCollection({
	items: [
		{ value: "en", label: "English" },
		{ value: "zh", label: "中文" },
	],
});

export default function SettingsPage() {
	const { preference, setPreference } = useThemePreference();
	const { enabled: debugEnabled, setEnabled: setDebugEnabled } =
		useDebugStore();
	const [previewThemeId, setPreviewThemeId] =
		useState<TerminalThemeId | null>(null);

	const themeCollection = useMemo(
		() =>
			createListCollection({
				items: [
					{ value: "system", label: m.themeSystem() },
					{ value: "light", label: m.themeLight() },
					{ value: "dark", label: m.themeDark() },
				],
			}),
		[],
	);

	return (
		<Box p="8" pt="16">
			<Stack gap="6">
				<Heading size="2xl" fontWeight="bold">
					{m.settings()}
				</Heading>
				<Tabs.Root defaultValue="general" variant="plain">
					<Tabs.List bg="bg.muted" rounded="l3" p="1">
						<Tabs.Trigger value="general">
							{m.general()}
						</Tabs.Trigger>
						<Tabs.Trigger value="terminal">
							{m.terminal()}
						</Tabs.Trigger>
						<Tabs.Trigger value="notification">
							{m.notification()}
						</Tabs.Trigger>
						<Tabs.Trigger value="profile">
							{m.profile()}
						</Tabs.Trigger>
						<Tabs.Indicator rounded="l2" />
					</Tabs.List>
					<Tabs.Content value="general">
						<Stack gap="6" maxW="md">
							<Field.Root>
								<Field.Label>{m.language()}</Field.Label>
								<Select.Root
									collection={localeCollection}
									defaultValue={[getLocale()]}
									onValueChange={(e) =>
										setLocale(e.value[0] as Locale)
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
							<AccentColorPicker />
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
						</Stack>
					</Tabs.Content>
					<Tabs.Content value="terminal">
						<Flex gap="8" align="flex-start">
							<Stack gap="6" flex="1" minW="0" maxW="md">
								<TerminalThemePicker
									onPreview={setPreviewThemeId}
								/>
								<Suspense fallback={<Skeleton height="70px" />}>
									<FontPicker />
								</Suspense>
								<FontSizePicker />
							</Stack>
							<Box flex="1" minW="0">
								<TerminalPreview themeId={previewThemeId} />
							</Box>
						</Flex>
					</Tabs.Content>
					<Tabs.Content value="notification">
						<NotificationSettings />
					</Tabs.Content>
					<Tabs.Content value="profile" />
				</Tabs.Root>
			</Stack>
		</Box>
	);
}
