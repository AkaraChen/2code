import { listPosts } from '../blog/lib/posts'
import {
  blogFeedPath,
  blogListMarkdownPath,
  blogListPath,
  blogPostMarkdownPath,
  blogPostPath,
  homePath,
} from '../blog/lib/routes'
import { getMessages, supportedLocales, type AppLocale } from '../i18n/resources'
import { siteConfig } from '../site-config'
import {
  PRODUCT_PAGE_IDS,
  productMarkdownPath,
  productPageCopy,
  productPath,
} from './product-pages'

export type PublicPageKind = 'home' | 'product' | 'blog-index' | 'blog-post'

export type PublicPage = Readonly<{
  kind: PublicPageKind
  locale: AppLocale
  title: string
  description: string
  htmlPath: string
  markdownPath: string
  lastModified?: Date
  changeFrequency: 'weekly' | 'monthly'
  priority: number
}>

function homeTitle(locale: AppLocale): string {
  return locale === 'zh-cn' ? '2code（中文）' : '2code'
}

/**
 * Every HTML page that should appear in the sitemap and in `/llms.txt`.
 * Blog indexes/posts stay on `/blog` for humans; product pages exist so
 * agent crawlers that skip `/blog` still see a real documentation set.
 */
export async function listPublicPages(): Promise<PublicPage[]> {
  const pages: PublicPage[] = []

  for (const locale of supportedLocales) {
    const messages = getMessages(locale)
    const htmlPath = homePath(locale)

    pages.push({
      kind: 'home',
      locale,
      title: homeTitle(locale),
      description: messages.metadata.description,
      htmlPath,
      markdownPath:
        locale === 'zh-cn'
          ? siteConfig.markdownZhPath
          : siteConfig.markdownHomePath,
      changeFrequency: 'weekly',
      priority: locale === 'en' ? 1 : 0.9,
    })

    for (const id of PRODUCT_PAGE_IDS) {
      const copy = productPageCopy(locale, id)

      pages.push({
        kind: 'product',
        locale,
        title: copy.metadataTitle,
        description: copy.metadataDescription,
        htmlPath: productPath(locale, id),
        markdownPath: productMarkdownPath(locale, id),
        changeFrequency: 'weekly',
        priority: 0.75,
      })
    }

    pages.push({
      kind: 'blog-index',
      locale,
      title: messages.blog.metadataTitle,
      description: messages.blog.metadataDescription,
      htmlPath: blogListPath(locale),
      markdownPath: blogListMarkdownPath(locale),
      changeFrequency: 'weekly',
      priority: 0.8,
    })

    for (const post of await listPosts(locale)) {
      if (post.draft || post.scheduled) {
        continue
      }

      pages.push({
        kind: 'blog-post',
        locale,
        title: post.title,
        description: post.description,
        htmlPath: blogPostPath(locale, post.slug),
        markdownPath: blogPostMarkdownPath(locale, post.slug),
        lastModified: new Date(post.date),
        changeFrequency: 'monthly',
        priority: 0.7,
      })
    }
  }

  return pages
}

export function absoluteUrl(pathname: string): string {
  return pathname === '/' ? siteConfig.url : `${siteConfig.url}${pathname}`
}

export function feedSitemapPaths(): readonly string[] {
  return supportedLocales.map((locale) => blogFeedPath(locale))
}
