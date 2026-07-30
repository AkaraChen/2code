'use client'

import Link from 'next/link'
import { type AppLocale, type resources } from './i18n/resources'

type Messages = (typeof resources)[AppLocale]

type LocaleSwitchProps = Readonly<{
  locale: AppLocale
  messages: Messages
}>

const LOCALE_STORAGE_KEY = '2code-locale'

/*
  Picking a language has to be sticky. The boot script sends zh-CN browsers from
  / to /zh-cn/, so without a stored choice an "English" link would bounce a
  Chinese-locale visitor straight back to the Chinese page.
*/
export function LocaleSwitch({ locale, messages }: LocaleSwitchProps) {
  const remember = (choice: AppLocale) => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, choice)
    } catch {
      // A blocked storage write only costs stickiness, not navigation.
    }
  }

  return (
    <div className="footer-links" aria-label={messages.footer.languageLabel}>
      <Link
        href="/"
        onClick={() => remember('en')}
        aria-current={locale === 'en' ? 'true' : undefined}
      >
        {messages.footer.english}
      </Link>
      <Link
        href="/zh-cn"
        onClick={() => remember('zh-cn')}
        aria-current={locale === 'zh-cn' ? 'true' : undefined}
      >
        {messages.footer.chinese}
      </Link>
    </div>
  )
}
