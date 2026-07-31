import type { Metadata } from 'next'
import { getMessages, type AppLocale } from './i18n/resources'
import { siteConfig } from './site-config'

/*
  Every HTML page has a Markdown twin for AI crawlers. The two homepages ship
  theirs from /public; blog pages get theirs emitted into `out/` after the build
  (see scripts/emit-blog-markdown.mjs), so this map only needs the static pair.
*/
const markdownByPath: Record<string, string> = {
  '/': siteConfig.markdownHomePath,
  '/zh-cn': siteConfig.markdownZhPath,
}

const defaultLanguages = {
  en: '/',
  'zh-CN': '/zh-cn',
  'x-default': '/',
} as const

export type PageMetadataOptions = Readonly<{
  /** Root-relative path of this page, e.g. `/`, `/zh-cn/blog`, `/blog/a-post`. */
  pathname: string
  title?: string
  description?: string
  keywords?: readonly string[]
  /** Root-relative `.md` alternate; `null` opts out, omitted falls back to the map. */
  markdownPath?: string | null
  /** hreflang map for this page; defaults to the two homepages. */
  languages?: Readonly<Record<string, string>>
  image?: Readonly<{
    url: string
    width?: number
    height?: number
    alt?: string
  }>
  /** Present only on blog posts — switches the OG object to `type: 'article'`. */
  article?: Readonly<{
    publishedTime: string
    tags?: readonly string[]
  }>
  /** Overrides the site-wide `index, follow` — used for draft posts. */
  noIndex?: boolean
}>

export function buildPageMetadata(
  locale: AppLocale,
  options: PageMetadataOptions,
): Metadata {
  const messages = getMessages(locale)
  const { pathname } = options

  const title = options.title ?? messages.metadata.title
  const description = options.description ?? messages.metadata.description
  const markdownPath =
    options.markdownPath === undefined
      ? markdownByPath[pathname]
      : options.markdownPath
  const absoluteUrl =
    pathname === '/' ? siteConfig.url : `${siteConfig.url}${pathname}`

  const image = options.image ?? {
    url: siteConfig.ogImage,
    width: siteConfig.ogImageWidth,
    height: siteConfig.ogImageHeight,
    alt: title,
  }

  const openGraphBase = {
    url: absoluteUrl,
    siteName: siteConfig.name,
    title,
    description,
    images: [
      {
        url: image.url,
        width: image.width,
        height: image.height,
        alt: image.alt ?? title,
      },
    ],
    locale: locale === 'zh-cn' ? 'zh_CN' : 'en_US',
    alternateLocale: locale === 'zh-cn' ? ['en_US'] : ['zh_CN'],
  }

  return {
    title,
    description,
    keywords: [...(options.keywords ?? messages.metadata.keywords)],
    applicationName: siteConfig.name,
    authors: [{ name: siteConfig.name, url: siteConfig.githubUrl }],
    creator: siteConfig.name,
    publisher: siteConfig.name,
    category: 'technology',
    ...(options.noIndex ? { robots: { index: false, follow: false } } : {}),
    alternates: {
      canonical: pathname,
      languages: { ...(options.languages ?? defaultLanguages) },
      ...(markdownPath ? { types: { 'text/markdown': markdownPath } } : {}),
    },
    openGraph: options.article
      ? {
          ...openGraphBase,
          type: 'article',
          publishedTime: options.article.publishedTime,
          authors: [siteConfig.name],
          tags: options.article.tags ? [...options.article.tags] : undefined,
        }
      : { ...openGraphBase, type: 'website' },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image.url],
    },
  }
}
