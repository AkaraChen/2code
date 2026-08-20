import { renderBlogIndexMarkdown } from '../../../lib/page-markdown'
import { textResponse } from '../../../lib/agent-docs'
import { parseLocale } from '../locale'

/*
  Serves `/blog.md` and `/zh-cn/blog.md`, which `middleware.ts` rewrites here.
  Prerendered per locale and re-rendered on the same window as the blog index,
  so a post that has just reached its publishAt shows up in both.
*/
export const revalidate = 300

export function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'zh-cn' }]
}

type RouteContext = Readonly<{ params: Promise<{ locale: string }> }>

export async function GET(_request: Request, { params }: RouteContext) {
  const locale = parseLocale((await params).locale)

  if (!locale) {
    return new Response('Not found', { status: 404 })
  }

  return textResponse(await renderBlogIndexMarkdown(locale), 'text/markdown')
}
