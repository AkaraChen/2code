import { type AppLocale, type resources } from './i18n/resources'
import { siteConfig } from './site-config'
import { ThemeToggle } from './theme-toggle'

type Messages = (typeof resources)[AppLocale]

type SiteHeaderProps = Readonly<{
  messages: Messages
}>

function ExternalIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4h6v6" />
      <path d="m5 11 7-7" />
    </svg>
  )
}

/*
  A ruled bar pinned to the top of the document instead of a floating pill: the
  hairline border is the same structural device every section below uses, so the
  header reads as the document's header row. No scroll listener needed.
*/
export function SiteHeader({ messages }: SiteHeaderProps) {
  return (
    <header className="topbar">
      <div className="shell topbar-inner">
        <a className="brand" href="#hero" aria-label={messages.nav.home}>
          {/* The shipped app icon, so the site and the dock show the same mark. */}
          <img
            className="brand-icon"
            src="/app-icon.png"
            alt=""
            width={24}
            height={24}
            decoding="async"
          />
          <span className="brand-name">2code</span>
        </a>

        <nav className="topnav" aria-label={messages.nav.primary}>
          <a href="#features" data-nav="features">
            {messages.nav.features}
          </a>
          <a href="#faq">{messages.nav.faq}</a>
          <a
            id="cta-github"
            href={siteConfig.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-keyshortcuts="g"
          >
            <span>{messages.nav.github}</span>
            <ExternalIcon />
          </a>
          <ThemeToggle label={messages.nav.theme} />
        </nav>
      </div>
    </header>
  )
}
