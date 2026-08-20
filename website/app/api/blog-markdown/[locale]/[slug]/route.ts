import { renderBlogPostMarkdown } from '../../../../lib/page-markdown'
import { textResponse } from '../../../../lib/agent-docs'
import { getPost, listPosts } from '../../../../blog/lib/posts'
import { supportedLocales } from '../../../../i18n/resources'
import { parseLocale } from '../../locale'

/*
  Serves `/blog/<slug>.md` and `/zh-cn/blog/<slug>.md`, rewritten here by
  `middleware.ts`. Published posts are prerendered; a scheduled one renders on
  first request after its publishAt, exactly like its HTML page.
*/
export const revalidate = 300

export async function generateStaticParams() {
  const perLocale = await Promise.all(
    supportedLocales.map(async (locale) =>
      (await listPosts(locale)).map((post) => ({ locale, slug: post.slug })),
    ),
  )

  return perLocale.flat()
}

type RouteContext = Readonly<{
  params: Promise<{ locale: string; slug: string }>
}>

export async function GET(_request: Request, { params }: RouteContext) {
  const { locale: rawLocale, slug } = await params
  const locale = parseLocale(rawLocale)
  const post = locale ? await getPost(locale, slug) : null

  if (!locale || !post) {
    return new Response('Not found', { status: 404 })
  }

  return textResponse(renderBlogPostMarkdown(locale, post), 'text/markdown')
}
