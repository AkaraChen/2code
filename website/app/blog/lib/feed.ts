import { getMessages, type AppLocale } from '../../i18n/resources'
import { siteConfig } from '../../site-config'
import { listPosts } from './posts'
import { blogFeedPath, blogListPath, blogPostPath } from './routes'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/*
  RSS 2.0 rather than Atom: it is what feed readers and the AI crawlers that
  poll for new posts already expect, and it is short enough to hand-render
  without pulling in a feed library. Emitted by a `force-static` route handler,
  so it lands in `out/blog/feed.xml` like any other file.
*/
export async function renderFeed(locale: AppLocale): Promise<string> {
  const messages = getMessages(locale)
  const posts = await listPosts(locale)
  const listUrl = `${siteConfig.url}${blogListPath(locale)}`
  const feedUrl = `${siteConfig.url}${blogFeedPath(locale)}`
  const language = locale === 'zh-cn' ? 'zh-CN' : 'en'

  const items = posts
    // A draft build still emits a public feed: neither drafts nor posts whose
    // publishAt has not arrived belong in it.
    .filter((post) => !post.draft && !post.scheduled)
    .map((post) => {
      const url = `${siteConfig.url}${blogPostPath(locale, post.slug)}`

      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <pubDate>${new Date(post.date).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(post.description)}</description>`,
        ...post.tags.map(
          (tag) => `      <category>${escapeXml(tag)}</category>`,
        ),
        '    </item>',
      ].join('\n')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(messages.blog.metadataTitle)}</title>`,
    `    <link>${escapeXml(listUrl)}</link>`,
    `    <description>${escapeXml(messages.blog.metadataDescription)}</description>`,
    `    <language>${language}</language>`,
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    // Empty when nothing is published — an empty channel is still a valid feed.
    ...(items ? [items] : []),
    '  </channel>',
    '</rss>',
  ].join('\n')
}
