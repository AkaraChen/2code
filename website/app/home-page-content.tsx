import { AgentDirective } from './agent-directive'
import { ChapterRail } from './chapter-rail'
import { CHAPTER_IDS, type AppLocale, type Messages } from './i18n/resources'
import { PageEffects } from './page-effects'
import { RichText } from './rich-text'
import {
  ChapterHeading,
  FaqList,
  FeatureChapters,
  InstallPrompt,
  InstallSteps,
} from './sections'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'
import { siteConfig } from './site-config'
import { htmlLang, organizationNode } from './structured-data'

const HERO_SHOT = '/screenshots/terminal-tabs.png'
const SCREENSHOT_WIDTH = 2560
const SCREENSHOT_HEIGHT = 1640

type HomePageContentProps = Readonly<{
  locale: AppLocale
  messages: Messages
}>

/*
  "Lanes & Signals": the page reads like 2code's own window. A two-tone
  headline (Herdr's own line in gray, 2code's answer in ink) over the real
  product, then chapters drawn as worktrees in a sidebar,
  each with a piece of the app drawn in HTML. The only colour on the page is
  the agent status palette from themes/2code-*.json.
*/
export function HomePageContent({ locale, messages }: HomePageContentProps) {
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
        applicationSubCategory: 'Herdr layout',
        operatingSystem: 'macOS, Linux, Windows (with Herdr)',
        description: t.metadata.description,
        url: pageUrl,
        downloadUrl: siteConfig.installUrl,
        installUrl: siteConfig.installUrl,
        softwareVersion: 'latest',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: siteConfig.installUrl,
        },
        screenshot: [`${siteConfig.url}${HERO_SHOT}`],
        sameAs: [siteConfig.githubUrl],
        featureList: CHAPTER_IDS.map((id) => t.chapters.items[id].title),
      },
    ],
  }

  const lanes = [
    ...CHAPTER_IDS.map((id) => ({ id, label: t.chapters.items[id].nav })),
    { id: 'faq', label: t.faq.heading },
    { id: 'install', label: t.footer.install, badge: t.mock.needsYou },
  ]

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
        <section className="hero shell" id="hero">
          <p className="hero-eyebrow">
            <span className="status-dot is-working" aria-hidden="true" />
            {t.hero.eyebrow}
            {t.hero.eyebrowTags.map((tag) => (
              <span key={tag}>
                <span className="hero-eyebrow-sep" aria-hidden="true">
                  ·
                </span>
                {tag}
              </span>
            ))}
          </p>

          <h1 className="two-tone">
            <span className="two-tone-dim">{t.hero.titleLineOne}</span>{' '}
            <span>{t.hero.titleLineTwo}</span>
          </h1>

          <div className="hero-sub">
            <div>
              <p className="hero-lede">
                <RichText text={t.hero.lede} />
              </p>
              <div className="hero-actions">
                <a
                  id="cta-download"
                  className="button button-primary"
                  href="#install"
                  aria-keyshortcuts="d"
                >
                  {t.hero.primaryCta}
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
                  {t.hero.secondaryCta}
                  <kbd className="keycap" aria-hidden="true" data-markdown-ignore>
                    F
                  </kbd>
                </a>
              </div>
            </div>
            <InstallPrompt messages={t} />
          </div>

          <figure className="hero-shot" data-markdown-ignore>
            <img
              src={HERO_SHOT}
              alt={t.hero.shotAlt}
              width={SCREENSHOT_WIDTH}
              height={SCREENSHOT_HEIGHT}
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
          </figure>
        </section>

        <section className="lanes shell" id="features">
          <div data-markdown-ignore className="lanes-rail">
            <ChapterRail
              label={t.chapters.railLabel}
              project={t.chapters.railProject}
              lanes={lanes}
              legend={t.chapters.legend}
            />
          </div>

          <div className="chapters">
            <FeatureChapters messages={t} />

            <section className="chapter" id="faq">
              <ChapterHeading>{t.faq.heading}</ChapterHeading>
              <FaqList messages={t} />
            </section>
          </div>
        </section>

        <section className="closing" id="install">
          <div className="shell">
            <h2 className="two-tone reveal">
              <span className="two-tone-dim">{t.hero.titleLineOne}</span>{' '}
              <span>{t.hero.titleLineTwo}</span>
            </h2>
            <InstallSteps messages={t} />
          </div>
        </section>
      </main>

      <SiteFooter locale={locale} messages={t} />
    </div>
  )
}
