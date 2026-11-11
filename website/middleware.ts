import { NextResponse, type NextRequest } from 'next/server'
import { markdownAlternatePath, prefersMarkdown } from './app/lib/agent-docs'
import { LOCALE_COOKIE, localeRedirectPath } from './app/lib/locale-redirect'

/*
  Three jobs, in order:

  1. Same-host HTTP 302 for the Chinese locale preference (replaces the old
     `window.location.replace` boot script). Crawlers are not redirected.
  2. Honor `Accept: text/markdown` by serving the `.md` twin when one exists.
  3. Rewrite `.md` URLs onto route handlers. The App Router cannot own a
     dynamic `*.md` segment — `/blog/[slug]` would swallow `/blog/foo.md`.
*/

const BLOG_MARKDOWN = /^(\/zh-cn)?\/blog(?:\/([^/]+))?\.md$/
const PAGE_MARKDOWN =
  /^\/(?:index|zh-cn|(?:zh-cn\/)?(?:features|faq|install|getting-started))\.md$/

function rewriteMarkdown(request: NextRequest, pathname: string): NextResponse {
  const blogMatch = BLOG_MARKDOWN.exec(pathname)

  if (blogMatch) {
    const [, zhPrefix, slug] = blogMatch
    const locale = zhPrefix ? 'zh-cn' : 'en'
    const url = request.nextUrl.clone()
    url.pathname = slug
      ? `/api/blog-markdown/${locale}/${slug}`
      : `/api/blog-markdown/${locale}`
    const response = NextResponse.rewrite(url)
    response.headers.append('Vary', 'Accept')
    return response
  }

  if (PAGE_MARKDOWN.test(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = `/api/page-markdown${pathname}`
    const response = NextResponse.rewrite(url)
    response.headers.append('Vary', 'Accept')
    return response
  }

  return NextResponse.next()
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  const localeTarget = localeRedirectPath(
    pathname,
    request.cookies.get(LOCALE_COOKIE)?.value,
    request.headers.get('accept-language'),
    request.headers.get('user-agent'),
  )

  if (localeTarget) {
    const url = request.nextUrl.clone()
    url.pathname = localeTarget
    const response = NextResponse.redirect(url, 302)
    response.headers.set('Vary', 'Accept-Language, Cookie')
    return response
  }

  if (pathname.endsWith('.md')) {
    return rewriteMarkdown(request, pathname)
  }

  if (prefersMarkdown(request.headers.get('accept'))) {
    const markdownPath = markdownAlternatePath(pathname)

    if (markdownPath) {
      return rewriteMarkdown(request, markdownPath)
    }
  }

  const response = NextResponse.next()
  response.headers.append('Vary', 'Accept')
  return response
}

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|api/|screenshots/|favicon.ico|icon-|apple-touch|app-icon|icons.svg).*)',
  ],
}
