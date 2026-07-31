import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMessages, type AppLocale } from '../../i18n/resources'
import { buildPageMetadata } from '../../page-metadata'
import { siteConfig } from '../../site-config'
import { BlogListContent } from '../blog-list-content'
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
  `output: 'export'` refuses a dynamic route whose generateStaticParams returns
  nothing (Next error E87), so a blog with no published posts would fail the
  build outright. Rather than forcing a permanent placeholder article, an empty
  locale prerenders this one stub URL: it renders the same empty state as the
  index, is marked noindex, and is linked from nowhere — no sitemap, no feed, no
  nav. The moment a real post exists it disappears.
*/
export const EMPTY_BLOG_SLUG = 'no-posts-yet'

export async function generatePostParams(locale: AppLocale) {
  const posts = await listPosts(locale)

  if (posts.length === 0) {
    return [{ slug: EMPTY_BLOG_SLUG }]
  }

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
    // Drafts only render in dev / draft builds, but keep them out of indexes.
    noIndex: post.draft,
  })
}

export async function renderPostPage(locale: AppLocale, params: RouteParams) {
  const { slug } = await params
  const post = await getPost(locale, slug)

  if (!post) {
    if (slug !== EMPTY_BLOG_SLUG) {
      notFound()
    }

    return (
      <BlogListContent
        locale={locale}
        messages={getMessages(locale)}
        posts={[]}
      />
    )
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
