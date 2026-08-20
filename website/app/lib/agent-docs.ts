import { createHash } from 'node:crypto'
import { siteConfig } from '../site-config'

export const LOCALE_COOKIE = '2code-locale'
export const AGENT_CACHE_CONTROL = 'public, max-age=300, must-revalidate'

const BOT_UA =
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|linkedinbot|embedly|quora|pinterest|redditbot|google|bing|yandex|duckduck|baidu|semrush|ahrefs|petal|bytespider|afdocs|chatgpt|claude|gptbot|perplexity|anthropic/i

export function isCrawlerUserAgent(userAgent: string | null): boolean {
  return Boolean(userAgent && BOT_UA.test(userAgent))
}

type AcceptPart = Readonly<{ type: string; q: number }>

function parseAccept(header: string): AcceptPart[] {
  return header.split(',').flatMap((raw) => {
    const [typePart, ...params] = raw.trim().split(';')
    const type = typePart?.trim().toLowerCase()

    if (!type) {
      return []
    }

    const qParam = params.find((param) => param.trim().startsWith('q='))
    const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1

    return Number.isFinite(q) ? [{ type, q }] : [{ type, q: 0 }]
  })
}

function bestQuality(parts: readonly AcceptPart[], type: string): number {
  const exact = parts.find((part) => part.type === type)
  if (exact) {
    return exact.q
  }

  const subtype = type.slice(type.indexOf('/') + 1)
  const range = parts.find((part) => part.type === `text/*` && subtype)
  if (range && type.startsWith('text/')) {
    return range.q
  }

  const star = parts.find((part) => part.type === '*/*')
  return star ? star.q : 0
}

/** True when the client explicitly prefers markdown over HTML. */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) {
    return false
  }

  const parts = parseAccept(accept)
  if (parts.length === 0 || !parts.some((part) => part.type === 'text/markdown')) {
    return false
  }

  const markdownQ = bestQuality(parts, 'text/markdown')
  const htmlQ = parts.some((part) => part.type === 'text/html')
    ? bestQuality(parts, 'text/html')
    : 0

  return markdownQ > 0 && markdownQ >= htmlQ
}

export function markdownAlternatePath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, '') || '/'

  if (/\.(md|xml|txt|ico|png|svg|json|css|js)$/.test(normalized)) {
    return null
  }

  if (normalized === '/') {
    return siteConfig.markdownHomePath
  }

  return `${normalized}.md`
}

export function agentMarkdownDirective(llmsTxtUrl: string): string {
  return `> For AI agents: a documentation index is available at [llms.txt](${llmsTxtUrl}). Markdown versions are available at \`.md\` URLs or by sending \`Accept: text/markdown\`.`
}

export function textResponse(
  body: string,
  contentType: 'text/markdown' | 'text/plain',
): Response {
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`

  return new Response(body, {
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Cache-Control': AGENT_CACHE_CONTROL,
      ETag: etag,
      Vary: 'Accept',
    },
  })
}
