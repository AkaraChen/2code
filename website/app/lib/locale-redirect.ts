import { LOCALE_COOKIE, isCrawlerUserAgent } from './agent-docs'
import { PRODUCT_PAGE_IDS } from './product-pages'

function prefersChinese(
  cookie: string | undefined,
  acceptLanguage: string | null,
): boolean {
  if (cookie === 'en') {
    return false
  }

  if (cookie === 'zh-cn') {
    return true
  }

  const primary = acceptLanguage?.split(',')[0]?.trim() ?? ''
  return /^zh/i.test(primary)
}

/**
 * Same-host HTTP stand-in for the old `window.location.replace` locale hop.
 * Only the unprefixed English entry URLs redirect; crawlers are left alone.
 */
export function localeRedirectPath(
  pathname: string,
  cookie: string | undefined,
  acceptLanguage: string | null,
  userAgent: string | null,
): string | null {
  if (isCrawlerUserAgent(userAgent) || !prefersChinese(cookie, acceptLanguage)) {
    return null
  }

  const normalized = pathname.replace(/\/+$/, '') || '/'

  if (normalized === '/') {
    return '/zh-cn'
  }

  if (normalized === '/blog') {
    return '/zh-cn/blog'
  }

  if ((PRODUCT_PAGE_IDS as readonly string[]).some((id) => normalized === `/${id}`)) {
    return `/zh-cn${normalized}`
  }

  return null
}

export { LOCALE_COOKIE }
