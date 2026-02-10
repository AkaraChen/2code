import { Select, SelectItem } from "@carbon/react";
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
			<Select
				id="language-select"
				labelText={m.language()}
				defaultValue={getLocale()}
				onChange={(e) => setLocale(e.target.value as Locale)}
			>
				{(["en", "zh"] as const).map((locale) => (
					<SelectItem
						key={locale}
						value={locale}
						text={localeNames[locale]}
					/>
				))}
			</Select>
			<Select
				id="theme-select"
				labelText={m.theme()}
				value={preference}
				onChange={(e) =>
					setPreference(e.target.value as "system" | "light" | "dark")
				}
			>
				{themeOptions.map((opt) => (
					<SelectItem
						key={opt.value}
						value={opt.value}
						text={opt.text}
					/>
				))}
			</Select>
		</div>
	);
}
