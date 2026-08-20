import {
  renderHomeMarkdown,
  renderProductMarkdown,
} from '../../../lib/page-markdown'
import { textResponse } from '../../../lib/agent-docs'
import { isProductPageId } from '../../../lib/product-pages'
import type { AppLocale } from '../../../i18n/resources'

export const revalidate = 300

export function generateStaticParams() {
  const english = ['features', 'faq', 'install', 'getting-started'].map((id) => ({
    path: [`${id}.md`],
  }))
  const chinese = ['features', 'faq', 'install', 'getting-started'].map((id) => ({
    path: ['zh-cn', `${id}.md`],
  }))

  return [{ path: ['index.md'] }, { path: ['zh-cn.md'] }, ...english, ...chinese]
}

function parseMarkdownPath(
  segments: readonly string[],
): { locale: AppLocale; kind: 'home' | 'product'; id?: string } | null {
  const joined = `/${segments.join('/')}`

  if (joined === '/index.md') {
    return { locale: 'en', kind: 'home' }
  }

  if (joined === '/zh-cn.md') {
    return { locale: 'zh-cn', kind: 'home' }
  }

  const product = /^(?:\/zh-cn)?\/([^/]+)\.md$/.exec(joined)
  const id = product?.[1]

  if (id && isProductPageId(id)) {
    return {
      locale: joined.startsWith('/zh-cn/') ? 'zh-cn' : 'en',
      kind: 'product',
      id,
    }
  }

  return null
}

type RouteContext = Readonly<{
  params: Promise<{ path: string[] }>
}>

export async function GET(_request: Request, { params }: RouteContext) {
  const parsed = parseMarkdownPath((await params).path)

  if (!parsed) {
    return new Response('Not found', { status: 404 })
  }

  if (parsed.kind === 'home') {
    return textResponse(renderHomeMarkdown(parsed.locale), 'text/markdown')
  }

  if (parsed.id && isProductPageId(parsed.id)) {
    return textResponse(
      renderProductMarkdown(parsed.locale, parsed.id),
      'text/markdown',
    )
  }

  return new Response('Not found', { status: 404 })
}
