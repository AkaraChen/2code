'use client'

import Link from 'next/link'
import { type AppLocale, type resources } from './i18n/resources'

type Messages = (typeof resources)[AppLocale]

type LocaleSwitchProps = Readonly<{
  locale: AppLocale
  messages: Messages
  /**
   * Where each language link points. Defaults to the two homepages; blog pages
   * pass the counterpart post, or that language's blog index when the post has
   * no translation — switching language should never land on a 404.
   */
  hrefs?: Readonly<Record<AppLocale, string>>
}>

const LOCALE_STORAGE_KEY = '2code-locale'

const homeHrefs = { en: '/', 'zh-cn': '/zh-cn' } as const

/*
  Picking a language has to be sticky. Middleware reads the same cookie to
  issue a same-host 302, so an "English" click must win over Accept-Language.
*/
export function LocaleSwitch({
  locale,
  messages,
  hrefs = homeHrefs,
}: LocaleSwitchProps) {
  const remember = (choice: AppLocale) => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, choice)
    } catch {
      // A blocked storage write only costs stickiness, not navigation.
    }

    try {
      document.cookie = `${LOCALE_STORAGE_KEY}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`
    } catch {
      // Cookie write is best-effort; middleware then falls back to Accept-Language.
    }
  }

  return (
    <div className="footer-links" aria-label={messages.footer.languageLabel}>
      <Link
        href={hrefs.en}
        onClick={() => remember('en')}
        aria-current={locale === 'en' ? 'true' : undefined}
      >
        {messages.footer.english}
      </Link>
      <Link
        href={hrefs['zh-cn']}
        onClick={() => remember('zh-cn')}
        aria-current={locale === 'zh-cn' ? 'true' : undefined}
      >
        {messages.footer.chinese}
      </Link>
    </div>
  )
}
