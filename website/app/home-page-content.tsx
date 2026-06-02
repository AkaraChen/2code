import { HeroParallaxMedia } from './hero-parallax-media'
import { ScrollHeader } from './scroll-header'
import { type AppLocale, type resources } from './i18n/resources'
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
        screenshot: [
          `${siteConfig.url}/screenshots/terminal-tabs.png`,
          `${siteConfig.url}/screenshots/git-diff.png`,
          `${siteConfig.url}/screenshots/worktree.png`,
        ],
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
      <HeroParallaxMedia />

      <ScrollHeader messages={t} />

      <main>
        <section className="hero-section" id="hero">
          <div className="hero-copy reveal">
            <p className="section-kicker hero-kicker">{t.hero.kicker}</p>
            <h1>
              {t.hero.titleLineOne}
              <br />
              {t.hero.titleLineTwo}
            </h1>
            <p className="hero-lede">{t.hero.lede}</p>
            <p className="hero-supporting-copy">{t.hero.supporting}</p>

            <div className="hero-actions">
              <a
                className="button button-primary"
                href={siteConfig.githubReleaseUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t.hero.primaryCta}
              </a>
              <a className="button button-secondary" href="#features">
                {t.hero.secondaryCta}
              </a>
            </div>
          </div>
        </section>

        <div className="content-surface">
          <section className="features-section" id="features">
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
                        width={2722}
                        height={2026}
                        loading="lazy"
                        decoding="async"
                      />
                    </figure>
                  </div>
                </section>
              ))}
            </div>
          </section>

          <section className="faq-section reveal" id="faq">
            <div className="section-heading faq-heading">
              <p className="section-kicker">{t.faq.kicker}</p>
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

            <div className="faq-cta">
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
        </div>
      </main>
    </div>
  )
}
