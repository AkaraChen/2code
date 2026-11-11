import { blogListPath, homePath } from './blog/lib/routes'
import { type AppLocale, type resources } from './i18n/resources'
import { siteConfig } from './site-config'
import { ThemeToggle } from './theme-toggle'

type Messages = (typeof resources)[AppLocale]

type SiteHeaderProps = Readonly<{
  locale: AppLocale
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
  A ruled bar pinned to the top of the document, like the app's own top bar:
  the brand, a few quiet links and the theme switch. No scroll listener needed.

  Section links are absolute (`/#features`, `/zh-cn#features`) rather than bare
  fragments: the same header renders on blog pages, where `#features` would
  scroll nowhere.
*/
export function SiteHeader({ locale, messages }: SiteHeaderProps) {
  const home = homePath(locale)

  return (
    <header className="topbar">
      <div className="shell topbar-inner">
        <a
          className="brand"
          href={`${home}#hero`}
          aria-label={messages.nav.home}
        >
          {/* The shipped app icon, so the site and the dock show the same mark. */}
          <img
            className="brand-icon"
            src="/app-icon.png"
            alt=""
            width={26}
            height={26}
            decoding="async"
          />
          <span className="brand-name">2code</span>
          <span className="brand-for">{messages.nav.forHerdr}</span>
        </a>

        <nav className="topnav" aria-label={messages.nav.primary}>
          <a href={`${home}#features`} data-nav="features">
            {messages.nav.features}
          </a>
          <a href={`${home}#faq`}>{messages.nav.faq}</a>
          <a href={blogListPath(locale)}>{messages.nav.blog}</a>
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
