import * as m from "@/paraglide/messages.js";
import { getLocale, setLocale, type Locale } from "@/paraglide/runtime.js";
import { Select, SelectItem } from "@carbon/react";

const localeNames: Record<Locale, string> = {
  en: "English",
  zh: "中文",
};

export default function SettingsPage() {
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
          <SelectItem key={locale} value={locale} text={localeNames[locale]} />
        ))}
      </Select>
    </div>
  );
}
