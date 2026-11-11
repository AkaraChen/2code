import { blogFeedPath, blogListPath, homePath } from './blog/lib/routes'
import type { AppLocale, Messages } from './i18n/resources'
import { productPath } from './lib/product-pages'
import { LocaleSwitch } from './locale-switch'
import { siteConfig } from './site-config'

type SiteFooterProps = Readonly<{
  locale: AppLocale
  messages: Messages
  /** Language-switch targets for this page; the two homepages by default. */
  localeHrefs?: Readonly<Record<AppLocale, string>>
}>

export function SiteFooter({ locale, messages, localeHrefs }: SiteFooterProps) {
  const t = messages

  return (
    <footer className="site-footer" data-markdown-ignore>
      <div className="shell footer-grid">
        <div className="footer-brand">
          <a className="brand" href={homePath(locale)} aria-label={t.nav.home}>
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
          <p className="footer-tagline">
            {t.footer.tagline}
            <br />
            {t.footer.openSource}
          </p>
          <LocaleSwitch locale={locale} messages={t} hrefs={localeHrefs} />
        </div>

        <div className="footer-col">
          <h2>{t.footer.product}</h2>
          <a href={productPath(locale, 'features')}>{t.nav.features}</a>
          <a href={productPath(locale, 'install')}>{t.footer.install}</a>
          <a href={productPath(locale, 'getting-started')}>
            {t.footer.gettingStarted}
          </a>
          <a href={productPath(locale, 'faq')}>{t.nav.faq}</a>
        </div>

        <div className="footer-col">
          <h2>{t.footer.learn}</h2>
          <a href={blogListPath(locale)}>{t.nav.blog}</a>
          <a href={blogFeedPath(locale)}>{t.blog.feed}</a>
          <a href={siteConfig.llmsTxtPath}>llms.txt</a>
        </div>

        <div className="footer-col">
          <h2>{t.footer.project}</h2>
          <a href={siteConfig.githubUrl} target="_blank" rel="noreferrer">
            {t.nav.github}
          </a>
          <a href="https://herdr.dev" target="_blank" rel="noreferrer">
            Herdr
          </a>
          <a href={siteConfig.githubReleaseUrl} target="_blank" rel="noreferrer">
            {t.footer.releases}
          </a>
        </div>
      </div>
    </footer>
  )
}
