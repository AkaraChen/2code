import { type AppLocale, type resources } from '../i18n/resources'
import { siteConfig } from '../site-config'
import { htmlLang } from '../structured-data'
import { BlogShell } from './blog-shell'
import type { BlogPost } from './lib/posts'
import {
  blogListPath,
  blogPostPath,
  formatPostDate,
  formatReadingTime,
  formatScheduledFor,
} from './lib/routes'

type Messages = (typeof resources)[AppLocale]

type BlogPostContentProps = Readonly<{
  locale: AppLocale
  messages: Messages
  post: BlogPost
  /** Language-switch targets, resolved by the page against the other locale. */
  localeHrefs: Readonly<Record<AppLocale, string>>
}>

export function BlogPostContent({
  locale,
  messages,
  post,
  localeHrefs,
}: BlogPostContentProps) {
  const t = messages
  const postUrl = `${siteConfig.url}${blogPostPath(locale, post.slug)}`
  const imageUrl = `${siteConfig.url}${post.coverImage ?? post.ogImage ?? siteConfig.ogImage}`

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${postUrl}#post`,
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    url: postUrl,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': postUrl,
    },
    image: [imageUrl],
    keywords: [...post.tags],
    inLanguage: htmlLang(locale),
    author: {
      '@type': 'Organization',
      '@id': `${siteConfig.url}/#organization`,
      name: siteConfig.name,
    },
    publisher: { '@id': `${siteConfig.url}/#organization` },
    isPartOf: { '@id': `${siteConfig.url}${blogListPath(locale)}#blog` },
  }

  return (
    <BlogShell locale={locale} messages={t} localeHrefs={localeHrefs}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <article className="post shell">
        <header className="post-header">
          <a className="post-back" href={blogListPath(locale)}>
            {t.blog.backToList}
          </a>

          <div className="post-row-meta">
            <time dateTime={post.date}>{formatPostDate(locale, post.date)}</time>
            <span aria-hidden="true">·</span>
            <span>
              {formatReadingTime(t.blog.readingTime, post.readingMinutes)}
            </span>
            {post.draft ? (
              <span className="post-draft">{t.blog.draftBadge}</span>
            ) : null}
            {post.scheduled ? (
              <span className="post-draft">
                {formatScheduledFor(
                  t.blog.scheduledBadge,
                  locale,
                  post.publishAt,
                )}
              </span>
            ) : null}
          </div>

          <h1>{post.title}</h1>
          <p className="post-description">{post.description}</p>

          {post.tags.length > 0 ? (
            <ul className="post-tags" aria-label={t.blog.tagsLabel}>
              {post.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          ) : null}
        </header>

        {post.coverImage ? (
          <figure className="post-cover">
            <img src={post.coverImage} alt="" decoding="async" />
          </figure>
        ) : null}

        {/*
          The Markdown is authored in-repo and rendered at build time, so there
          is no untrusted input path here; `html: true` in the renderer is what
          lets a post drop in a raw <figure> or <kbd> when it needs one.
        */}
        <div
          className="prose"
          dangerouslySetInnerHTML={{ __html: post.html }}
        />

        <footer className="post-footer ruled-top">
          <a className="post-back" href={blogListPath(locale)}>
            {t.blog.backToList}
          </a>
        </footer>
      </article>
    </BlogShell>
  )
}
