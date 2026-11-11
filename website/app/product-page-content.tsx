import { BlogShell } from './blog/blog-shell'
import { homePath } from './blog/lib/routes'
import { type AppLocale, type resources } from './i18n/resources'
import {
  productPageCopy,
  productPath,
  type ProductPageId,
} from './lib/product-pages'
import { siteConfig } from './site-config'

const FEATURE_IDS = ['terminals', 'git', 'profiles'] as const
const FAQ_IDS = [
  'audience',
  'terminal',
  'agents',
  'templates',
  'restore',
  'platforms',
  'production',
] as const

const SCREENSHOT_WIDTH = 2560
const SCREENSHOT_HEIGHT = 1640

const FEATURE_SHOTS: Record<
  (typeof FEATURE_IDS)[number],
  { src: string }
> = {
  terminals: { src: '/screenshots/terminal-tabs.png' },
  git: { src: '/screenshots/git-diff.png' },
  profiles: { src: '/screenshots/worktree.png' },
}

type Messages = (typeof resources)[AppLocale]

type ProductPageContentProps = Readonly<{
  locale: AppLocale
  messages: Messages
  pageId: ProductPageId
}>

export function ProductPageContent({
  locale,
  messages,
  pageId,
}: ProductPageContentProps) {
  const t = messages
  const copy = productPageCopy(locale, pageId)

  return (
    <BlogShell
      locale={locale}
      messages={t}
      localeHrefs={{
        en: productPath('en', pageId),
        'zh-cn': productPath('zh-cn', pageId),
      }}
      showFeed={false}
    >
      <article className="post shell">
        <header className="post-header">
          <p className="label">{copy.heading}</p>
          <h1>{copy.title}</h1>
          <p className="post-description">{copy.lede}</p>
        </header>

        {pageId === 'features' ? <FeaturesBody messages={t} /> : null}
        {pageId === 'faq' ? <FaqBody locale={locale} messages={t} /> : null}
        {pageId === 'install' ? <InstallBody messages={t} /> : null}
        {pageId === 'getting-started' ? (
          <GettingStartedBody locale={locale} messages={t} />
        ) : null}
      </article>
    </BlogShell>
  )
}

function FeaturesBody({ messages }: { messages: Messages }) {
  const t = messages

  return (
    <div className="feature-list product-feature-list">
      {FEATURE_IDS.map((id, index) => (
        <section
          className={`feature-row ${index % 2 === 1 ? 'feature-row-reverse' : ''}`}
          key={id}
        >
          <div className="feature-copy">
            <p className="label">{t.features.items[id].eyebrow}</p>
            <h2>{t.features.items[id].title}</h2>
            <p className="feature-body">{t.features.items[id].copy}</p>
            <ul className="feature-points">
              {t.features.items[id].points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
          <div className="feature-shot">
            <figure className="shot-frame" data-markdown-ignore>
              <img
                className="feature-image"
                src={FEATURE_SHOTS[id].src}
                alt={t.features.items[id].imageAlt}
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
  )
}

function FaqBody({
  locale,
  messages,
}: {
  locale: AppLocale
  messages: Messages
}) {
  const t = messages

  return (
    <div className="faq-list">
      {FAQ_IDS.map((id) => (
        <section className="faq-item" key={id}>
          <h2>{t.faq.items[id].question}</h2>
          <p>{t.faq.items[id].answer}</p>
        </section>
      ))}
      <p>{t.faq.cta}</p>
      <p>
        <a className="button button-primary" href={productPath(locale, 'install')}>
          {t.hero.primaryCta}
        </a>
      </p>
    </div>
  )
}

function InstallBody({ messages }: { messages: Messages }) {
  const t = messages
  const install = t.pages.install

  return (
    <div className="prose">
      <h2>{install.herdrHeading}</h2>
      <p>{install.herdrBody}</p>
      <p>
        <a
          className="button button-primary"
          href={siteConfig.herdrDownloadUrl}
          target="_blank"
          rel="noreferrer"
        >
          {install.herdrCta}
        </a>
      </p>
      <h2>{install.layoutHeading}</h2>
      <p>{install.layoutBody}</p>
      <pre>
        <code>{siteConfig.installPrompt}</code>
      </pre>
      <h2>{install.scriptHeading}</h2>
      <pre>
        <code>{siteConfig.installScript}</code>
      </pre>
      <p>{install.switchBody}</p>
      <h2>{t.faq.items.platforms.question}</h2>
      <p>{t.faq.items.platforms.answer}</p>
      <p>
        <a href={siteConfig.githubReleaseUrl} target="_blank" rel="noreferrer">
          {install.legacyNote}
        </a>
      </p>
    </div>
  )
}

function GettingStartedBody({
  locale,
  messages,
}: {
  locale: AppLocale
  messages: Messages
}) {
  const t = messages

  return (
    <div className="prose">
      <h2>{t.faq.items.audience.question}</h2>
      <p>{t.faq.items.audience.answer}</p>
      <h2>{t.pages.install.herdrHeading}</h2>
      <p>{t.pages.install.herdrBody}</p>
      <h2>{t.pages.install.layoutHeading}</h2>
      <p>{t.pages.install.layoutBody}</p>
      <pre>
        <code>{siteConfig.installPrompt}</code>
      </pre>
      <p>
        <a className="button button-primary" href={productPath(locale, 'install')}>
          {t.hero.primaryCta}
        </a>
      </p>
      <h2>{t.faq.items.platforms.question}</h2>
      <p>{t.faq.items.platforms.answer}</p>
      <h2>{t.faq.items.terminal.question}</h2>
      <p>{t.faq.items.terminal.answer}</p>
      <p>
        <a href={homePath(locale)}>{t.nav.home}</a>
        {' · '}
        <a href={productPath(locale, 'features')}>{t.nav.features}</a>
        {' · '}
        <a href={productPath(locale, 'faq')}>{t.nav.faq}</a>
      </p>
    </div>
  )
}

export function productLocaleMap(pageId: ProductPageId) {
  return {
    en: productPath('en', pageId),
    'zh-CN': productPath('zh-cn', pageId),
    'x-default': productPath('en', pageId),
  }
}
