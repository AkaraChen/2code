import type { Metadata } from 'next'
import { getMessages, type AppLocale } from './i18n/resources'
import { siteConfig } from './site-config'

const markdownByPath = {
  '/': '/index.md',
  '/zh-cn': '/zh-cn.md',
} as const

export function buildPageMetadata(
  locale: AppLocale,
  pathname: '/' | '/zh-cn',
): Metadata {
  const messages = getMessages(locale)
  const markdownPath = markdownByPath[pathname]
  const absoluteUrl =
    pathname === '/' ? siteConfig.url : `${siteConfig.url}${pathname}`

  return {
    title: messages.metadata.title,
    description: messages.metadata.description,
    keywords: [...messages.metadata.keywords],
    applicationName: siteConfig.name,
    authors: [{ name: siteConfig.name, url: siteConfig.githubUrl }],
    creator: siteConfig.name,
    publisher: siteConfig.name,
    category: 'technology',
    alternates: {
      canonical: pathname,
      languages: {
        en: '/',
        'zh-CN': '/zh-cn',
        'x-default': '/',
      },
      types: {
        'text/markdown': markdownPath,
      },
    },
    openGraph: {
      type: 'website',
      url: absoluteUrl,
      siteName: siteConfig.name,
      title: messages.metadata.title,
      description: messages.metadata.description,
      images: [
        {
          url: siteConfig.ogImage,
          width: siteConfig.ogImageWidth,
          height: siteConfig.ogImageHeight,
          alt: messages.metadata.title,
        },
      ],
      locale: locale === 'zh-cn' ? 'zh_CN' : 'en_US',
      alternateLocale: locale === 'zh-cn' ? ['en_US'] : ['zh_CN'],
    },
    twitter: {
      card: 'summary_large_image',
      title: messages.metadata.title,
      description: messages.metadata.description,
      images: [siteConfig.ogImage],
    },
  }
}
