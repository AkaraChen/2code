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
	Tabs,
} from "@chakra-ui/react";
import { Suspense, useState } from "react";
import { AccentColorPicker } from "@/components/settings/AccentColorPicker";
import { BorderRadiusPicker } from "@/components/settings/BorderRadiusPicker";
import { FontPicker } from "@/components/settings/FontPicker";
import { FontSizePicker } from "@/components/settings/FontSizePicker";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { TerminalThemePicker } from "@/components/settings/TerminalThemePicker";
import { TerminalPreview } from "@/components/TerminalPreview";
import { useThemePreference } from "@/components/ThemeProvider";
import type { TerminalThemeId } from "@/lib/terminalThemes";
import * as m from "@/paraglide/messages.js";
import { getLocale, type Locale, setLocale } from "@/paraglide/runtime.js";

const localeCollection = createListCollection({
	items: [
		{ value: "en", label: "English" },
		{ value: "zh", label: "中文" },
	],
});

export default function SettingsPage() {
	const { preference, setPreference } = useThemePreference();
	const [previewThemeId, setPreviewThemeId] =
		useState<TerminalThemeId | null>(null);

	const themeCollection = createListCollection({
		items: [
			{ value: "system", label: m.themeSystem() },
			{ value: "light", label: m.themeLight() },
			{ value: "dark", label: m.themeDark() },
		],
	});

	return (
		<div className="page-padding">
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
		</div>
	);
}
