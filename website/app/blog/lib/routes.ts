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

/** Markdown alternate of a page, served via the `middleware.ts` rewrite. */
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

/*
  The scheduled badge is a preview-only affordance, so it reports the publish
  instant in UTC — the same frame the frontmatter is interpreted in, and the one
  the rebuild schedule runs on. A publishAt that carries an hour shows that hour;
  a bare date stays a bare date.
*/
export function formatScheduledFor(
  template: string,
  locale: AppLocale,
  isoDate: string,
): string {
  const date = new Date(isoDate)
  const atUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0

  const formatted = atUtcMidnight
    ? formatPostDate(locale, isoDate)
    : new Intl.DateTimeFormat(locale === 'zh-cn' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
      }).format(date)

  return template.replace('{date}', formatted)
}
