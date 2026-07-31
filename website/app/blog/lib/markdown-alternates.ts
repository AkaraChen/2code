import { getMessages, type AppLocale } from '../../i18n/resources'
import { siteConfig } from '../../site-config'
import { listPosts, type BlogPost } from './posts'
import { blogFeedPath, blogListPath, blogPostPath } from './routes'

/*
  The Markdown twin of every blog page (`/blog.md`, `/blog/<slug>.md`), which
  the HTML advertises through `rel="alternate" type="text/markdown"`.

  These used to be files written into `out/` after the export build, which meant
  the publish rules had to be reimplemented in a standalone script. Now they are
  rendered from the same `listPosts`/`getPost` the pages use, so a scheduled post
  appears in its Markdown twin exactly when it appears on the site.

  The App Router cannot own a URL ending in `.md` for a dynamic slug — `[slug]`
  swallows it — so `middleware.ts` rewrites these paths onto the route handlers
  under `/api/blog-markdown`.
*/

function isoDay(iso: string): string {
  return iso.slice(0, 10)
}

export function renderPostMarkdown(locale: AppLocale, post: BlogPost): string {
  const url = `${siteConfig.url}${blogPostPath(locale, post.slug)}`

  return [
    `# ${post.title}`,
    '',
    `> ${post.description}`,
    '',
    `- **Published:** ${isoDay(post.date)}`,
    ...(post.tags.length > 0 ? [`- **Tags:** ${post.tags.join(', ')}`] : []),
    `- **Canonical:** ${url}`,
    '',
    '---',
    '',
    post.markdown,
    '',
  ].join('\n')
}

export async function renderIndexMarkdown(locale: AppLocale): Promise<string> {
  const messages = getMessages(locale)
  const posts = await listPosts(locale)
  const url = `${siteConfig.url}${blogListPath(locale)}`

  return [
    `# ${messages.blog.metadataTitle}`,
    '',
    `> ${messages.blog.metadataDescription}`,
    '',
    `- **Canonical:** ${url}`,
    `- **Feed:** ${siteConfig.url}${blogFeedPath(locale)}`,
    '',
    '---',
    '',
    ...(posts.length === 0
      ? [messages.blog.emptyTitle, '']
      : posts.flatMap((post) => [
          `## [${post.title}](${siteConfig.url}${blogPostPath(locale, post.slug)})`,
          '',
          `${isoDay(post.date)}${post.tags.length > 0 ? ` · ${post.tags.join(', ')}` : ''}`,
          '',
          post.description,
          '',
        ])),
  ].join('\n')
}
