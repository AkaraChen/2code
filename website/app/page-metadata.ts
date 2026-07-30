import type { Metadata } from 'next'
import { getMessages, type AppLocale } from './i18n/resources'
import { siteConfig } from './site-config'

export function buildPageMetadata(
  locale: AppLocale,
  pathname: '/' | '/zh-cn',
): Metadata {
  const messages = getMessages(locale)

  return {
    title: messages.metadata.title,
    description: messages.metadata.description,
    alternates: {
      canonical: pathname,
      languages: {
        en: '/',
        'zh-CN': '/zh-cn',
      },
    },
    openGraph: {
      type: 'website',
      url: pathname,
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
    },
    twitter: {
      card: 'summary_large_image',
      title: messages.metadata.title,
      description: messages.metadata.description,
      images: [siteConfig.ogImage],
    },
  }
}
