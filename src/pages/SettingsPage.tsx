import {
	Box,
	Field,
	Flex,
	Heading,
	NativeSelect,
	Skeleton,
	Stack,
	Tabs,
} from "@chakra-ui/react";
import { Suspense, useState } from "react";
import { FontPicker } from "@/components/settings/FontPicker";
import { FontSizePicker } from "@/components/settings/FontSizePicker";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { TerminalThemePicker } from "@/components/settings/TerminalThemePicker";
import { TerminalPreview } from "@/components/TerminalPreview";
import { useThemePreference } from "@/components/ThemeProvider";
import type { TerminalThemeId } from "@/lib/terminalThemes";
import * as m from "@/paraglide/messages.js";
import { getLocale, type Locale, setLocale } from "@/paraglide/runtime.js";

const localeNames: Record<Locale, string> = {
	en: "English",
	zh: "中文",
};

const LOCALES = ["en", "zh"] as const;

export default function SettingsPage() {
	const { preference, setPreference } = useThemePreference();
	const [previewThemeId, setPreviewThemeId] =
		useState<TerminalThemeId | null>(null);

	const themeOptions = [
		{ value: "system", text: m.themeSystem() },
		{ value: "light", text: m.themeLight() },
		{ value: "dark", text: m.themeDark() },
	] as const;

	return (
		<div className="page-padding">
			<Stack gap="6">
				<Heading size="2xl" fontWeight="bold">
					{m.settings()}
				</Heading>
				<Tabs.Root defaultValue="appearance" variant="plain">
					<Tabs.List bg="bg.muted" rounded="l3" p="1">
						<Tabs.Trigger value="appearance">
							{m.appearance()}
						</Tabs.Trigger>
						<Tabs.Trigger value="notification">
							{m.notification()}
						</Tabs.Trigger>
						<Tabs.Trigger value="profile">
							{m.profile()}
						</Tabs.Trigger>
						<Tabs.Indicator rounded="l2" />
					</Tabs.List>
					<Tabs.Content value="appearance">
						<Flex gap="8" align="flex-start">
							<Stack gap="6" flex="1" minW="0" maxW="md">
								<Field.Root>
									<Field.Label>{m.language()}</Field.Label>
									<NativeSelect.Root>
										<NativeSelect.Field
											defaultValue={getLocale()}
											onChange={(e) =>
												setLocale(
													e.target.value as Locale,
												)
											}
										>
											{LOCALES.map(
												(locale) => (
													<option
														key={locale}
														value={locale}
													>
														{localeNames[locale]}
													</option>
												),
											)}
										</NativeSelect.Field>
										<NativeSelect.Indicator />
									</NativeSelect.Root>
								</Field.Root>
								<Field.Root>
									<Field.Label>{m.theme()}</Field.Label>
									<NativeSelect.Root>
										<NativeSelect.Field
											value={preference}
											onChange={(e) =>
												setPreference(
													e.target.value as
														| "system"
														| "light"
														| "dark",
												)
											}
										>
											{themeOptions.map((opt) => (
												<option
													key={opt.value}
													value={opt.value}
												>
													{opt.text}
												</option>
											))}
										</NativeSelect.Field>
										<NativeSelect.Indicator />
									</NativeSelect.Root>
								</Field.Root>
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
