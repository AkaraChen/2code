import type { ReactNode } from 'react'
import { AgentDirective } from '../agent-directive'
import { type AppLocale, type resources } from '../i18n/resources'
import { SiteFooter } from '../site-footer'
import { SiteHeader } from '../site-header'
import { htmlLang, organizationNode } from '../structured-data'

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
  // Publisher @id on Blog/BlogPosting JSON-LD resolves only when this node is
  // present on the same page — homepage already emits it; blog pages did not.
  const organizationData = {
    '@context': 'https://schema.org',
    ...organizationNode(),
  }

  return (
    <div className="page-shell" lang={htmlLang(locale)}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData) }}
      />

      <AgentDirective locale={locale} />
      <div data-markdown-ignore>
        <SiteHeader locale={locale} messages={messages} />
      </div>

      <main>{children}</main>

      <SiteFooter locale={locale} messages={messages} localeHrefs={localeHrefs} />
    </div>
  )
}
