import {
  CHAPTER_IDS,
  FAQ_IDS,
  getMessages,
  type AppLocale,
  type Messages,
} from '../i18n/resources'
import { siteConfig } from '../site-config'
import { listPosts } from '../blog/lib/posts'
import {
  blogFeedPath,
  blogListPath,
  blogPostPath,
  formatPostDate,
  formatReadingTime,
  homePath,
} from '../blog/lib/routes'
import { agentMarkdownDirective } from './agent-docs'
import {
  productPageCopy,
  type ProductPageId,
} from './product-pages'

/** The feature chapters, shared by the homepage and /features twins. */
function chapterLines(t: Messages): string[] {
  return CHAPTER_IDS.flatMap((id) => {
    const item = t.chapters.items[id]
    return [`### ${item.title}`, '', item.body, '']
  })
}

function installLines(t: Messages): string[] {
  return [
    `1. **${t.install.herdrTitle}** — ${t.install.herdrBody} ${siteConfig.herdrDownloadUrl}`,
    `2. **${t.install.layoutTitle}** — ${t.pages.install.layoutBody}`,
    '',
    '```',
    siteConfig.installPrompt,
    '```',
    '',
    t.pages.install.switchBody,
    '',
  ]
}

function directiveBlock(): string {
  return agentMarkdownDirective(`${siteConfig.url}${siteConfig.llmsTxtPath}`)
}

function isoDay(iso: string): string {
  return iso.slice(0, 10)
}

/** Markdown twin of a homepage — same strings as `HomePageContent`. */
export function renderHomeMarkdown(locale: AppLocale): string {
  const t = getMessages(locale)
  const home = homePath(locale)
  const url = home === '/' ? siteConfig.url : `${siteConfig.url}${home}`
  const otherHome =
    locale === 'zh-cn' ? siteConfig.url : `${siteConfig.url}/zh-cn`

  return [
    directiveBlock(),
    '',
    `# ${t.hero.titleLineOne} ${t.hero.titleLineTwo}`,
    '',
    `> ${t.hero.lede}`,
    '',
    `- **${[t.hero.eyebrow, ...t.hero.eyebrowTags].join(' · ')}**`,
    `- **${t.hero.primaryCta}:** ${url}#install`,
    `- **${t.hero.secondaryCta}:** ${url}#features`,
    locale === 'zh-cn'
      ? `- **English:** ${otherHome}`
      : `- **中文:** ${otherHome}`,
    `- **GitHub:** ${siteConfig.githubUrl}`,
    '',
    `## ${t.nav.features}`,
    '',
    ...chapterLines(t),
    `## ${t.faq.heading}`,
    '',
    ...FAQ_IDS.flatMap((id) => [
      `### ${t.faq.items[id].question}`,
      '',
      t.faq.items[id].answer,
      '',
    ]),
    `## ${t.footer.install}`,
    '',
    ...installLines(t),
    `2code — ${t.footer.tagline}`,
    '',
  ].join('\n')
}

export function renderProductMarkdown(
  locale: AppLocale,
  id: ProductPageId,
): string {
  const t = getMessages(locale)
  const copy = productPageCopy(locale, id)

  const body = (() => {
    switch (id) {
      case 'features':
        return [
          `## ${copy.heading}`,
          '',
          copy.lede,
          '',
          ...chapterLines(t),
        ]
      case 'faq':
        return [
          `## ${t.faq.title}`,
          '',
          copy.lede,
          '',
          ...FAQ_IDS.flatMap((faqId) => [
            `### ${t.faq.items[faqId].question}`,
            '',
            t.faq.items[faqId].answer,
            '',
          ]),
          t.faq.cta,
          '',
          `[${t.hero.primaryCta}](${siteConfig.installUrl})`,
          '',
        ]
      case 'install':
        return [
          copy.lede,
          '',
          `## ${t.pages.install.herdrHeading}`,
          '',
          t.pages.install.herdrBody,
          '',
          `[${t.pages.install.herdrCta}](${siteConfig.herdrDownloadUrl})`,
          '',
          `## ${t.pages.install.layoutHeading}`,
          '',
          t.pages.install.layoutBody,
          '',
          '```',
          siteConfig.installPrompt,
          '```',
          '',
          `## ${t.pages.install.scriptHeading}`,
          '',
          '```bash',
          siteConfig.installScript,
          '```',
          '',
          t.pages.install.switchBody,
          '',
          `### ${t.faq.items.platforms.question}`,
          '',
          t.faq.items.platforms.answer,
          '',
        ]
      case 'getting-started':
        return [
          copy.lede,
          '',
          `## ${t.faq.items.audience.question}`,
          '',
          t.faq.items.audience.answer,
          '',
          `## ${t.pages.install.herdrHeading}`,
          '',
          `${t.pages.install.herdrBody} ${siteConfig.herdrDownloadUrl}`,
          '',
          `## ${t.pages.install.layoutHeading}`,
          '',
          t.pages.install.layoutBody,
          '',
          '```',
          siteConfig.installPrompt,
          '```',
          '',
          `[${t.hero.primaryCta}](${siteConfig.installUrl})`,
          '',
          `## ${t.faq.items.platforms.question}`,
          '',
          t.faq.items.platforms.answer,
          '',
          `## ${t.faq.items.terminal.question}`,
          '',
          t.faq.items.terminal.answer,
          '',
        ]
    }
  })()

  return [
    directiveBlock(),
    '',
    `# ${copy.title}`,
    '',
    `> ${copy.lede}`,
    '',
    ...body,
  ].join('\n')
}

export async function renderBlogIndexMarkdown(locale: AppLocale): Promise<string> {
  const messages = getMessages(locale)
  const posts = await listPosts(locale)
  const url = `${siteConfig.url}${blogListPath(locale)}`

  return [
    directiveBlock(),
    '',
    `# ${messages.blog.title}`,
    '',
    `> ${messages.blog.lede}`,
    '',
    `- **${messages.blog.kicker}**`,
    `- **Canonical:** ${url}`,
    `- **Feed:** ${siteConfig.url}${blogFeedPath(locale)}`,
    '',
    '---',
    '',
    ...(posts.length === 0
      ? [messages.blog.emptyTitle, '', messages.blog.emptyBody, '']
      : posts.flatMap((post) => [
          `## [${post.title}](${siteConfig.url}${blogPostPath(locale, post.slug)})`,
          '',
          `${formatPostDate(locale, post.date)} · ${formatReadingTime(messages.blog.readingTime, post.readingMinutes)}${post.tags.length > 0 ? ` · ${post.tags.join(', ')}` : ''}`,
          '',
          post.description,
          '',
        ])),
  ].join('\n')
}

export function renderBlogPostMarkdown(
  locale: AppLocale,
  post: {
    title: string
    description: string
    date: string
    tags: readonly string[]
    markdown: string
    slug: string
    readingMinutes: number
  },
): string {
  const messages = getMessages(locale)
  const url = `${siteConfig.url}${blogPostPath(locale, post.slug)}`

  return [
    directiveBlock(),
    '',
    `# ${post.title}`,
    '',
    `> ${post.description}`,
    '',
    `- **Published:** ${isoDay(post.date)}`,
    `- **${formatReadingTime(messages.blog.readingTime, post.readingMinutes)}**`,
    ...(post.tags.length > 0 ? [`- **Tags:** ${post.tags.join(', ')}`] : []),
    `- **Canonical:** ${url}`,
    '',
    '---',
    '',
    post.markdown,
    '',
  ].join('\n')
}
