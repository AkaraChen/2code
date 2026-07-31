import { type AppLocale, type resources } from '../i18n/resources'
import { siteConfig } from '../site-config'
import { BlogShell } from './blog-shell'
import type { BlogPostMeta } from './lib/posts'
import {
  blogListPath,
  blogPostPath,
  formatPostDate,
  formatReadingTime,
  formatScheduledFor,
} from './lib/routes'

type Messages = (typeof resources)[AppLocale]

type BlogListContentProps = Readonly<{
  locale: AppLocale
  messages: Messages
  posts: readonly BlogPostMeta[]
}>

export function BlogListContent({
  locale,
  messages,
  posts,
}: BlogListContentProps) {
  const t = messages
  const listUrl = `${siteConfig.url}${blogListPath(locale)}`

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${listUrl}#blog`,
    url: listUrl,
    name: t.blog.metadataTitle,
    description: t.blog.metadataDescription,
    inLanguage: locale === 'zh-cn' ? 'zh-CN' : 'en',
    publisher: { '@id': `${siteConfig.url}/#organization` },
    blogPost: posts.map((post) => ({
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      url: `${siteConfig.url}${blogPostPath(locale, post.slug)}`,
      keywords: [...post.tags],
    })),
  }

  return (
    <BlogShell
      locale={locale}
      messages={t}
      localeHrefs={{ en: blogListPath('en'), 'zh-cn': blogListPath('zh-cn') }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section className="blog-header shell">
        <p className="label">{t.blog.kicker}</p>
        <h1>{t.blog.title}</h1>
        <p className="blog-lede">{t.blog.lede}</p>
      </section>

      {/* The list's own hairline is the section boundary — no second rule. */}
      <section className="blog-section shell">
        {posts.length === 0 ? (
          /*
            The empty state is the shipped default: this section exists before
            any post does, so it has to read as a deliberate "not yet" rather
            than a broken page.
          */
          <div className="blog-empty">
            <h2>{t.blog.emptyTitle}</h2>
            <p>{t.blog.emptyBody}</p>
            <a
              className="button button-secondary"
              href={siteConfig.githubUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t.blog.emptyCta}
            </a>
          </div>
        ) : (
          <ol className="post-list">
            {posts.map((post) => (
              <li className="post-row" key={post.slug}>
                <a
                  className="post-row-link"
                  href={blogPostPath(locale, post.slug)}
                >
                  <div className="post-row-meta">
                    <time dateTime={post.date}>
                      {formatPostDate(locale, post.date)}
                    </time>
                    <span aria-hidden="true">·</span>
                    <span>
                      {formatReadingTime(
                        t.blog.readingTime,
                        post.readingMinutes,
                      )}
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

                  <h2 className="post-row-title">{post.title}</h2>
                  <p className="post-row-description">{post.description}</p>

                  {post.tags.length > 0 ? (
                    <ul className="post-tags" aria-label={t.blog.tagsLabel}>
                      {post.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  ) : null}
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </BlogShell>
  )
}
