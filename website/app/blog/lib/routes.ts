import type { AppLocale } from '../../i18n/resources'

/*
  Blog is the first multi-page area of the site, so path construction lives in
  one place instead of being spelled out at each call site. `en` is unprefixed
  and `zh-cn` is prefixed, matching the existing `/` + `/zh-cn` homepages.
*/
export function localeRoot(locale: AppLocale): string {
  return locale === 'zh-cn' ? '/zh-cn' : ''
}

export function homePath(locale: AppLocale): string {
  return locale === 'zh-cn' ? '/zh-cn' : '/'
}

export function blogListPath(locale: AppLocale): string {
  return `${localeRoot(locale)}/blog`
}

export function blogPostPath(locale: AppLocale, slug: string): string {
  return `${blogListPath(locale)}/${slug}`
}

export function blogFeedPath(locale: AppLocale): string {
  return `${blogListPath(locale)}/feed.xml`
}

/** Markdown alternate of a page, emitted into `out/` after the Next build. */
export function blogListMarkdownPath(locale: AppLocale): string {
  return `${blogListPath(locale)}.md`
}

export function blogPostMarkdownPath(locale: AppLocale, slug: string): string {
  return `${blogPostPath(locale, slug)}.md`
}

export function formatPostDate(locale: AppLocale, isoDate: string): string {
  return new Intl.DateTimeFormat(locale === 'zh-cn' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(isoDate))
}

export function formatReadingTime(template: string, minutes: number): string {
  return template.replace('{minutes}', String(minutes))
}
