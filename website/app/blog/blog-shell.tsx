import type { ReactNode } from 'react'
import { type AppLocale, type resources } from '../i18n/resources'
import { LocaleSwitch } from '../locale-switch'
import { SiteHeader } from '../site-header'
import { siteConfig } from '../site-config'
import { blogFeedPath } from './lib/routes'

type Messages = (typeof resources)[AppLocale]

type BlogShellProps = Readonly<{
  locale: AppLocale
  messages: Messages
  /** Language-switch targets for this page; the blog index by default. */
  localeHrefs: Readonly<Record<AppLocale, string>>
  children: ReactNode
}>

/*
  Header + footer chrome shared by the blog index and the article pages, so the
  two routes differ only in their <main>. Same markup as the homepage shell —
  the blog is another page of the same document, not a sub-site.
*/
export function BlogShell({
  locale,
  messages,
  localeHrefs,
  children,
}: BlogShellProps) {
  return (
    <div className="page-shell">
      <SiteHeader locale={locale} messages={messages} />

      <main>{children}</main>

      <footer className="site-footer">
        <div className="shell footer-inner">
          <p className="caption">2code — {messages.footer.tagline}</p>

          <div className="footer-links">
            <a href={blogFeedPath(locale)}>{messages.blog.feed}</a>
            <a href={siteConfig.githubUrl} target="_blank" rel="noreferrer">
              {messages.nav.github}
            </a>
            <a
              href={siteConfig.githubReleaseUrl}
              target="_blank"
              rel="noreferrer"
            >
              {messages.footer.releases}
            </a>
          </div>

          <LocaleSwitch
            locale={locale}
            messages={messages}
            hrefs={localeHrefs}
          />
        </div>
      </footer>
    </div>
  )
}
