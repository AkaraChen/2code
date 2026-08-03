import { supportedLocales, type AppLocale } from '../../i18n/resources'

/** Narrows a raw route param to a supported locale, or null for anything else. */
export function parseLocale(value: string): AppLocale | null {
  return (supportedLocales as readonly string[]).includes(value)
    ? (value as AppLocale)
    : null
}
