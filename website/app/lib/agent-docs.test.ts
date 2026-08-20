import { describe, expect, test } from 'bun:test'
import {
  markdownAlternatePath,
  prefersMarkdown,
} from './agent-docs'
import { localeRedirectPath } from './locale-redirect'
import { renderHomeMarkdown } from './page-markdown'
import { listPublicPages } from './public-pages'
import { renderLlmsTxt } from '../llms-txt'
import { getMessages } from '../i18n/resources'
import { siteConfig } from '../site-config'

describe('prefersMarkdown', () => {
  test('honors Accept: text/markdown', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true)
  })

  test('leaves typical browsers on HTML', () => {
    expect(
      prefersMarkdown(
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ),
    ).toBe(false)
  })

  test('prefers markdown when it outranks HTML', () => {
    expect(prefersMarkdown('text/markdown,text/html;q=0.8')).toBe(true)
  })
})

describe('localeRedirectPath', () => {
  test('sends Chinese browsers from / to /zh-cn over HTTP', () => {
    expect(localeRedirectPath('/', undefined, 'zh-CN,zh;q=0.9', 'Mozilla/5.0')).toBe(
      '/zh-cn',
    )
  })

  test('does not redirect crawlers', () => {
    expect(
      localeRedirectPath('/', undefined, 'zh-CN', 'Mozilla/5.0 (compatible; Googlebot/2.1)'),
    ).toBeNull()
  })

  test('English cookie wins over Accept-Language', () => {
    expect(localeRedirectPath('/', 'en', 'zh-CN', 'Mozilla/5.0')).toBeNull()
  })
})

describe('markdownAlternatePath', () => {
  test('maps the homepage to /index.md', () => {
    expect(markdownAlternatePath('/')).toBe('/index.md')
  })

  test('maps product and blog paths', () => {
    expect(markdownAlternatePath('/features')).toBe('/features.md')
    expect(markdownAlternatePath('/blog/a-post')).toBe('/blog/a-post.md')
  })
})

describe('generated surfaces', () => {
  test('homepage markdown includes FAQ and feature copy', () => {
    const md = renderHomeMarkdown('en')
    const t = getMessages('en')

    expect(md.startsWith('> For AI agents:')).toBe(true)
    expect(md).toContain(t.faq.items.audience.question)
    expect(md).toContain(t.features.items.terminals.points[0])
    expect(md).toContain('/llms.txt')
  })

  test('llms.txt .md links cover every sitemap catalog page', async () => {
    const pages = await listPublicPages()
    const body = await renderLlmsTxt()

    for (const page of pages) {
      expect(body).toContain(`${siteConfig.url}${page.markdownPath}`)
    }

    expect(body).toContain(`${siteConfig.url}${siteConfig.llmsFullTxtPath}`)
    expect(body).not.toContain(`](${siteConfig.url}/)`)
  })
})
