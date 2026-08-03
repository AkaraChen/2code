import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMessages, type AppLocale } from '../../i18n/resources'
import { buildPageMetadata } from '../../page-metadata'
import { siteConfig } from '../../site-config'
import { BlogPostContent } from '../blog-post-content'
import { getPost, hasTranslation, listPosts } from './posts'
import { blogListPath, blogPostMarkdownPath, blogPostPath } from './routes'

/*
  Both language variants of `/blog/[slug]` are the same page against a different
  locale, so the whole route body lives here and each route file is a four-line
  binding. Keeps hreflang and the language-switch fallback in one place.
*/

type RouteParams = Promise<{ slug: string }>

function otherLocale(locale: AppLocale): AppLocale {
  return locale === 'zh-cn' ? 'en' : 'zh-cn'
}

/*
  Posts are written per language, not translated in pairs. When the counterpart
  slug does not exist, both the hreflang link and the footer language switch
  point at that language's blog index instead of a URL that would 404.
*/
async function counterpartPath(locale: AppLocale, slug: string) {
  const other = otherLocale(locale)
  const translated = await hasTranslation(other, slug)

  return translated ? blogPostPath(other, slug) : blogListPath(other)
}

/*
  Only published posts are prerendered. Anything else — a slug that does not
  exist, or a post whose publishAt has not arrived — is resolved per request:
  the first hit after a publish instant renders the post and caches it, which is
  how a scheduled post goes live without a deploy. An empty blog prerenders
  nothing at all, which a server runtime is fine with.
*/
export async function generatePostParams(locale: AppLocale) {
  const posts = await listPosts(locale)

  return posts.map((post) => ({ slug: post.slug }))
}

export async function generatePostMetadata(
  locale: AppLocale,
  params: RouteParams,
): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(locale, slug)

  if (!post) {
    return buildPageMetadata(locale, {
      pathname: blogListPath(locale),
      title: getMessages(locale).blog.metadataTitle,
      description: getMessages(locale).blog.metadataDescription,
      markdownPath: null,
      noIndex: true,
    })
  }

  const counterpart = await counterpartPath(locale, slug)
  const selfPath = blogPostPath(locale, slug)
  const enPath = locale === 'en' ? selfPath : counterpart
  const zhPath = locale === 'zh-cn' ? selfPath : counterpart
  const image = post.coverImage ?? post.ogImage

  return buildPageMetadata(locale, {
    pathname: selfPath,
    title: `${post.title} | ${siteConfig.name}`,
    description: post.description,
    keywords: post.tags.length > 0 ? post.tags : undefined,
    markdownPath: blogPostMarkdownPath(locale, slug),
    languages: { en: enPath, 'zh-CN': zhPath, 'x-default': enPath },
    // No cover image means the product screenshot, same as every other page.
    image: image ? { url: image, alt: post.title } : undefined,
    article: { publishedTime: post.date, tags: post.tags },
    // Drafts and not-yet-published posts only render in preview builds, but
    // keep them out of indexes in case such a build is ever served.
    noIndex: post.draft || post.scheduled,
  })
}

export async function renderPostPage(locale: AppLocale, params: RouteParams) {
  const { slug } = await params
  const post = await getPost(locale, slug)

  if (!post) {
    notFound()
  }

  const counterpart = await counterpartPath(locale, slug)
  const selfPath = blogPostPath(locale, slug)

  return (
    <BlogPostContent
      locale={locale}
      messages={getMessages(locale)}
      post={post}
      localeHrefs={{
        en: locale === 'en' ? selfPath : counterpart,
        'zh-cn': locale === 'zh-cn' ? selfPath : counterpart,
      }}
    />
  )
}
