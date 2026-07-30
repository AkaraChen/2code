import { type AppLocale, type resources } from './i18n/resources'
import { LocaleSwitch } from './locale-switch'
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

const SCREENSHOT_WIDTH = 2722
const SCREENSHOT_HEIGHT = 2026

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

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteConfig.url}/#organization`,
        name: siteConfig.name,
        url: siteConfig.url,
        sameAs: [siteConfig.githubUrl],
      },
      {
        '@type': 'WebSite',
        '@id': `${siteConfig.url}/#website`,
        name: siteConfig.name,
        url: locale === 'zh-cn' ? `${siteConfig.url}/zh-cn` : siteConfig.url,
        description: t.metadata.description,
        publisher: {
          '@id': `${siteConfig.url}/#organization`,
        },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${siteConfig.url}/#software`,
        name: siteConfig.name,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS',
        description: t.metadata.description,
        url: locale === 'zh-cn' ? `${siteConfig.url}/zh-cn` : siteConfig.url,
        screenshot: features.map(
          (feature) => `${siteConfig.url}${feature.screenshotSrc}`,
        ),
        sameAs: [siteConfig.githubUrl],
      },
    ],
  }

  return (
    <div className="page-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <SiteHeader messages={t} />
      <PageEffects />

      <main>
        <section className="hero-section shell" id="hero">
          <div className="hero-copy">
            <p className="label hero-badge">
              <span className="status-dot" aria-hidden="true" />
              <span className="marker">{t.hero.status}</span>
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
                <kbd className="keycap" aria-hidden="true">
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
                <kbd className="keycap" aria-hidden="true">
                  F
                </kbd>
              </a>
            </div>
          </div>

          <div className="hero-shot reveal">
            <figure className="shot-frame">
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

        {/* Spec sheet: only facts that hold today, no invented metrics. */}
        <section className="spec-section shell ruled-top">
          <dl className="spec-grid">
            {t.spec.items.map((item) => (
              <div className="spec-cell" key={item.label}>
                <dt className="label">{item.label}</dt>
                <dd className="spec-value">{item.value}</dd>
              </div>
            ))}
          </dl>
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
                  <figure className="shot-frame">
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

      <footer className="site-footer">
        <div className="shell footer-inner">
          <p className="caption">2code — {t.footer.tagline}</p>

          <div className="footer-links">
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
