import {
	Box,
	Checkbox,
	Field,
	Flex,
	NativeSelect,
	Skeleton,
	Stack,
	Heading,
	Tabs,
} from "@chakra-ui/react";
import { Suspense, use, useMemo } from "react";
import { fontsApi, type SystemFont } from "@/api/fonts";
import { TerminalPreview } from "@/components/TerminalPreview";
import { useThemePreference } from "@/components/ThemeProvider";
import * as m from "@/paraglide/messages.js";
import { getLocale, type Locale, setLocale } from "@/paraglide/runtime.js";
import { useFontStore } from "@/stores/fontStore";

const localeNames: Record<Locale, string> = {
	en: "English",
	zh: "中文",
};

// Cached promise — created once, shared across renders
let fontsPromise: Promise<SystemFont[]> | null = null;
function getFontsPromise() {
	if (!fontsPromise) {
		fontsPromise = fontsApi.listSystemFonts();
	}
	return fontsPromise;
}

function FontPicker() {
	const fonts = use(getFontsPromise());
	const { fontFamily, showAllFonts, setFontFamily, setShowAllFonts } =
		useFontStore();

	const visibleFonts = useMemo(
		() => (showAllFonts ? fonts : fonts.filter((f) => f.is_mono)),
		[fonts, showAllFonts],
	);

	return (
		<>
			<Field.Root>
				<Field.Label>{m.terminalFont()}</Field.Label>
				<NativeSelect.Root>
					<NativeSelect.Field
						value={fontFamily}
						onChange={(e) => setFontFamily(e.target.value)}
					>
						{visibleFonts.map((f) => (
							<option key={f.family} value={f.family}>
								{f.family}
							</option>
						))}
					</NativeSelect.Field>
					<NativeSelect.Indicator />
				</NativeSelect.Root>
			</Field.Root>
			<Checkbox.Root
				size="sm"
				checked={showAllFonts}
				onCheckedChange={(e) => setShowAllFonts(!!e.checked)}
			>
				<Checkbox.HiddenInput />
				<Checkbox.Control />
				<Checkbox.Label>{m.showAllFonts()}</Checkbox.Label>
			</Checkbox.Root>
		</>
	);
}

function FontSizePicker() {
	const { fontSize, setFontSize } = useFontStore();

	return (
		<Field.Root>
			<Field.Label>{m.fontSize()}</Field.Label>
			<NativeSelect.Root>
				<NativeSelect.Field
					value={fontSize}
					onChange={(e) => setFontSize(Number(e.target.value))}
				>
					{Array.from({ length: 11 }, (_, i) => i + 10).map(
						(size) => (
							<option key={size} value={size}>
								{size}px
							</option>
						),
					)}
				</NativeSelect.Field>
				<NativeSelect.Indicator />
			</NativeSelect.Root>
		</Field.Root>
	);
}

export default function SettingsPage() {
	const { preference, setPreference } = useThemePreference();

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
						<Tabs.Trigger value="profile">
							{m.profile()}
						</Tabs.Trigger>
						<Tabs.Indicator rounded="l2" />
					</Tabs.List>
					<Tabs.Content value="appearance">
						<Flex gap="8" align="flex-start">
							<Stack gap="6" flex="1" minW="0" maxW="md">
								<Field.Root>
									<Field.Label>
										{m.language()}
									</Field.Label>
									<NativeSelect.Root>
										<NativeSelect.Field
											defaultValue={getLocale()}
											onChange={(e) =>
												setLocale(
													e.target
														.value as Locale,
												)
											}
										>
											{(
												["en", "zh"] as const
											).map((locale) => (
												<option
													key={locale}
													value={locale}
												>
													{localeNames[locale]}
												</option>
											))}
										</NativeSelect.Field>
										<NativeSelect.Indicator />
									</NativeSelect.Root>
								</Field.Root>
								<Field.Root>
									<Field.Label>
										{m.theme()}
									</Field.Label>
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
								<Suspense
									fallback={
										<Skeleton height="70px" />
									}
								>
									<FontPicker />
								</Suspense>
								<FontSizePicker />
							</Stack>
							<Box flex="1" minW="0">
								<TerminalPreview />
							</Box>
						</Flex>
					</Tabs.Content>
					<Tabs.Content value="profile" />
				</Tabs.Root>
			</Stack>
		</div>
	);
}
