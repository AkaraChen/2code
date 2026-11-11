import { BlogShell } from './blog/blog-shell'
import { homePath } from './blog/lib/routes'
import { type AppLocale, type Messages } from './i18n/resources'
import {
  productPageCopy,
  productPath,
  type ProductPageId,
} from './lib/product-pages'
import { PageEffects } from './page-effects'
import {
  FaqList,
  FeatureChapters,
  InstallPrompt,
  InstallSteps,
} from './sections'
import { siteConfig } from './site-config'

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
    >
      <PageEffects />
      <article className="page shell">
        <header className="page-header">
          {copy.heading !== copy.title ? (
            <p className="label">{copy.heading}</p>
          ) : null}
          <h1>{copy.title}</h1>
          <p className="page-lede">{copy.lede}</p>
        </header>

        <div className="page-body">
          {pageId === 'features' ? <FeatureChapters messages={t} /> : null}
          {pageId === 'faq' ? <FaqBody locale={locale} messages={t} /> : null}
          {pageId === 'install' ? <InstallBody messages={t} /> : null}
          {pageId === 'getting-started' ? (
            <GettingStartedBody locale={locale} messages={t} />
          ) : null}
        </div>
      </article>
    </BlogShell>
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
    <>
      <FaqList messages={t} open />
      <div className="page-cta">
        <p>{t.faq.cta}</p>
        <a className="button button-primary" href={productPath(locale, 'install')}>
          {t.hero.primaryCta}
        </a>
      </div>
    </>
  )
}

function InstallBody({ messages }: { messages: Messages }) {
  const t = messages
  const install = t.pages.install

  return (
    <>
      <InstallSteps messages={t} />
      <div className="prose page-prose">
        <h2>{install.scriptHeading}</h2>
        <pre>
          <code>{siteConfig.installScript}</code>
        </pre>
        <h2>{t.faq.items.platforms.question}</h2>
        <p>{t.faq.items.platforms.answer}</p>
        <p>
          <a href={siteConfig.githubReleaseUrl} target="_blank" rel="noreferrer">
            {install.legacyNote}
          </a>
        </p>
      </div>
    </>
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
    <div className="prose page-prose">
      <h2>{t.faq.items.audience.question}</h2>
      <p>{t.faq.items.audience.answer}</p>
      <h2>{t.pages.install.herdrHeading}</h2>
      <p>
        {t.pages.install.herdrBody}{' '}
        <a href={siteConfig.herdrDownloadUrl} target="_blank" rel="noreferrer">
          {t.pages.install.herdrCta}
        </a>
      </p>
      <h2>{t.pages.install.layoutHeading}</h2>
      <p>{t.pages.install.layoutBody}</p>
      <InstallPrompt messages={t} />
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
