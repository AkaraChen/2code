import type { Metadata } from 'next'
import { getMessages, type AppLocale } from '../i18n/resources'
import { buildPageMetadata } from '../page-metadata'
import { ProductPageContent, productLocaleMap } from '../product-page-content'
import {
  productMarkdownPath,
  productPath,
  type ProductPageId,
} from './product-pages'

export function productPageMetadata(
  locale: AppLocale,
  pageId: ProductPageId,
): Metadata {
  const copy = getMessages(locale).pages
  const titles = {
    features: copy.features,
    faq: copy.faq,
    install: copy.install,
    'getting-started': copy.gettingStarted,
  }[pageId]

  return buildPageMetadata(locale, {
    pathname: productPath(locale, pageId),
    title: titles.metadataTitle,
    description: titles.metadataDescription,
    markdownPath: productMarkdownPath(locale, pageId),
    languages: productLocaleMap(pageId),
  })
}

export function renderProductPage(locale: AppLocale, pageId: ProductPageId) {
  return (
    <ProductPageContent
      locale={locale}
      messages={getMessages(locale)}
      pageId={pageId}
    />
  )
}
