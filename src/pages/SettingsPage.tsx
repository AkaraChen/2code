import { Field, NativeSelect } from "@chakra-ui/react";
import { useThemePreference } from "@/components/ThemeProvider";
import * as m from "@/paraglide/messages.js";
import { getLocale, type Locale, setLocale } from "@/paraglide/runtime.js";

const localeNames: Record<Locale, string> = {
	en: "English",
	zh: "中文",
};

export default function SettingsPage() {
	const { preference, setPreference } = useThemePreference();

	const themeOptions = [
		{ value: "system", text: m.themeSystem() },
		{ value: "light", text: m.themeLight() },
		{ value: "dark", text: m.themeDark() },
	] as const;

	return (
		<div>
			<h1>{m.settings()}</h1>
			<Field.Root>
				<Field.Label>{m.language()}</Field.Label>
				<NativeSelect.Root>
					<NativeSelect.Field
						defaultValue={getLocale()}
						onChange={(e) =>
							setLocale(e.target.value as Locale)
						}
					>
						{(["en", "zh"] as const).map((locale) => (
							<option key={locale} value={locale}>
								{localeNames[locale]}
							</option>
						))}
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
							<option key={opt.value} value={opt.value}>
								{opt.text}
							</option>
						))}
					</NativeSelect.Field>
					<NativeSelect.Indicator />
				</NativeSelect.Root>
			</Field.Root>
		</div>
	);
}
