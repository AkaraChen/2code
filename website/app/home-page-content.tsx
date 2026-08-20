import { AgentDirective } from './agent-directive'
import { blogListPath } from './blog/lib/routes'
import { type AppLocale, type resources } from './i18n/resources'
import { productPath } from './lib/product-pages'
import { LocaleSwitch } from './locale-switch'
import { htmlLang, organizationNode } from './structured-data'
import { PageEffects } from './page-effects'
import { SiteHeader } from './site-header'
import { siteConfig } from './site-config'

const features = [
  {
    id: 'terminals',
    screenshotSrc: '/screenshots/terminal-tabs.png',
  },
  {
    id: 'git',
    screenshotSrc: '/screenshots/git-diff.png',
  },
  {
    id: 'profiles',
    screenshotSrc: '/screenshots/worktree.png',
  },
] as const

const faqs = [
  'audience',
  'terminal',
  'agents',
  'templates',
  'restore',
  'platforms',
  'production',
] as const

const SCREENSHOT_WIDTH = 2498
const SCREENSHOT_HEIGHT = 1802

type Messages = (typeof resources)[AppLocale]

type HomePageContentProps = Readonly<{
  locale: AppLocale
  messages: Messages
}>

export function HomePageContent({
  locale,
  messages,
}: HomePageContentProps) {
  const t = messages

  const pageUrl =
    locale === 'zh-cn' ? `${siteConfig.url}/zh-cn` : siteConfig.url
  const markdownUrl =
    locale === 'zh-cn'
      ? `${siteConfig.url}${siteConfig.markdownZhPath}`
      : `${siteConfig.url}${siteConfig.markdownHomePath}`

  // JSON-LD kept for Bing/Copilot enrichment; visible page content remains source of truth.
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      organizationNode(),
      {
        '@type': 'WebSite',
        '@id': `${siteConfig.url}/#website`,
        name: siteConfig.name,
        url: pageUrl,
        description: t.metadata.description,
        inLanguage: htmlLang(locale),
        publisher: {
          '@id': `${siteConfig.url}/#organization`,
        },
      },
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        url: pageUrl,
        name: t.metadata.title,
        description: t.metadata.description,
        isPartOf: { '@id': `${siteConfig.url}/#website` },
        about: { '@id': `${siteConfig.url}/#software` },
        inLanguage: htmlLang(locale),
        // Machine-readable alternate (GEO: rel=alternate type=text/markdown)
        encodingFormat: 'text/html',
        relatedLink: [
          markdownUrl,
          `${siteConfig.url}${siteConfig.llmsTxtPath}`,
          `${siteConfig.url}${siteConfig.llmsFullTxtPath}`,
        ],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${siteConfig.url}/#software`,
        name: siteConfig.name,
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'Terminal workstation',
        operatingSystem: 'macOS, Windows (experimental), Linux (experimental)',
        description: t.metadata.description,
        url: pageUrl,
        downloadUrl: siteConfig.githubReleaseUrl,
        installUrl: siteConfig.githubReleaseUrl,
        softwareVersion: 'latest',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: siteConfig.githubReleaseUrl,
        },
        screenshot: features.map(
          (feature) => `${siteConfig.url}${feature.screenshotSrc}`,
        ),
        sameAs: [siteConfig.githubUrl],
        featureList: [
          t.features.items.terminals.title,
          t.features.items.git.title,
          t.features.items.profiles.title,
        ],
      },
    ],
  }

  return (
    <div className="page-shell" lang={htmlLang(locale)}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <AgentDirective locale={locale} />
      <div data-markdown-ignore>
        <SiteHeader locale={locale} messages={t} />
      </div>
      <PageEffects />

      <main>
        <section className="hero-section shell" id="hero">
          <div className="hero-copy">
            <p className="label hero-badge">
              <span className="marker">{t.hero.kicker}</span>
            </p>

            <h1>
              {t.hero.titleLineOne}
              <br />
              {t.hero.titleLineTwo}
            </h1>

            <p className="hero-lede">{t.hero.lede}</p>
            <p className="hero-supporting-copy">{t.hero.supporting}</p>

            <div className="hero-actions">
              <a
                id="cta-download"
                className="button button-primary"
                href={siteConfig.githubReleaseUrl}
                target="_blank"
                rel="noreferrer"
                aria-keyshortcuts="d"
              >
                <span>{t.hero.primaryCta}</span>
                <kbd className="keycap" aria-hidden="true" data-markdown-ignore>
                  D
                </kbd>
              </a>
              <a
                id="cta-features"
                className="button button-secondary"
                href="#features"
                aria-keyshortcuts="f"
              >
                <span>{t.hero.secondaryCta}</span>
                <kbd className="keycap" aria-hidden="true" data-markdown-ignore>
                  F
                </kbd>
              </a>
            </div>
          </div>

          <div className="hero-shot reveal">
            <figure className="shot-frame" data-markdown-ignore>
              <img
                src="/screenshots/terminal-tabs.png"
                alt={t.hero.shotAlt}
                width={SCREENSHOT_WIDTH}
                height={SCREENSHOT_HEIGHT}
                loading="eager"
                decoding="async"
              />
            </figure>
          </div>
        </section>

        <section className="features-section shell ruled-top" id="features">
          <div className="feature-list">
            {features.map((feature, index) => (
              <section
                className={`feature-row ${
                  index % 2 === 1 ? 'feature-row-reverse' : ''
                } reveal`}
                key={feature.id}
              >
                {/*
                  Keep the page structure static and swap only the route-level
                  content object so both locales export cleanly.
                */}
                <div className="feature-copy">
                  <p className="label">{t.features.items[feature.id].eyebrow}</p>
                  <h3>{t.features.items[feature.id].title}</h3>
                  <p className="feature-body">
                    {t.features.items[feature.id].copy}
                  </p>
                  <ul className="feature-points">
                    {t.features.items[feature.id].points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>

                <div className="feature-shot">
                  <figure className="shot-frame" data-markdown-ignore>
                    <img
                      className="feature-image"
                      src={feature.screenshotSrc}
                      alt={t.features.items[feature.id].imageAlt}
                      width={SCREENSHOT_WIDTH}
                      height={SCREENSHOT_HEIGHT}
                      loading="lazy"
                      decoding="async"
                    />
                  </figure>
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="faq-section shell ruled-top" id="faq">
          <div className="section-heading">
            <p className="label">{t.faq.kicker}</p>
            <h2>{t.faq.title}</h2>
          </div>

          <div className="faq-list">
            {faqs.map((id) => (
              <details className="faq-item" key={id}>
                <summary>{t.faq.items[id].question}</summary>
                <p>{t.faq.items[id].answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="cta-section shell">
          <div className="cta-panel">
            <p>{t.faq.cta}</p>
            <a
              className="button button-primary"
              href={siteConfig.githubReleaseUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t.hero.primaryCta}
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer" data-markdown-ignore>
        <div className="shell footer-inner">
          <p className="caption">2code — {t.footer.tagline}</p>

          <div className="footer-links">
            <a href={productPath(locale, 'faq')}>{t.nav.faq}</a>
            <a href={productPath(locale, 'install')}>{t.footer.install}</a>
            <a href={productPath(locale, 'getting-started')}>
              {t.footer.gettingStarted}
            </a>
            <a href={blogListPath(locale)}>{t.nav.blog}</a>
            <a href={siteConfig.githubUrl} target="_blank" rel="noreferrer">
              {t.nav.github}
            </a>
            <a
              href={siteConfig.githubReleaseUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t.footer.releases}
            </a>
          </div>

          <LocaleSwitch locale={locale} messages={t} />
        </div>
      </footer>
    </div>
  )
}
