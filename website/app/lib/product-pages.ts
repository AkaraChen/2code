import { getMessages, type AppLocale } from '../i18n/resources'
import { localeRoot } from '../blog/lib/routes'

export const PRODUCT_PAGE_IDS = [
  'features',
  'faq',
  'install',
  'getting-started',
] as const

export type ProductPageId = (typeof PRODUCT_PAGE_IDS)[number]

export function isProductPageId(value: string): value is ProductPageId {
  return (PRODUCT_PAGE_IDS as readonly string[]).includes(value)
}

export function productPath(locale: AppLocale, id: ProductPageId): string {
  return `${localeRoot(locale)}/${id}`
}

export function productMarkdownPath(
  locale: AppLocale,
  id: ProductPageId,
): string {
  return `${productPath(locale, id)}.md`
}

export function productPageCopy(locale: AppLocale, id: ProductPageId) {
  const messages = getMessages(locale)

  switch (id) {
    case 'features':
      return {
        title: messages.nav.features,
        heading: messages.nav.features,
        lede: messages.pages.features.metadataDescription,
        metadataTitle: messages.pages.features.metadataTitle,
        metadataDescription: messages.pages.features.metadataDescription,
      }
    case 'faq':
      return {
        title: messages.faq.title,
        heading: messages.faq.kicker,
        lede: messages.pages.faq.metadataDescription,
        metadataTitle: messages.pages.faq.metadataTitle,
        metadataDescription: messages.pages.faq.metadataDescription,
      }
    case 'install':
      return {
        title: messages.pages.install.title,
        heading: messages.footer.install,
        lede: messages.pages.install.lede,
        metadataTitle: messages.pages.install.metadataTitle,
        metadataDescription: messages.pages.install.metadataDescription,
      }
    case 'getting-started':
      return {
        title: messages.pages.gettingStarted.title,
        heading: messages.footer.gettingStarted,
        lede: messages.pages.gettingStarted.lede,
        metadataTitle: messages.pages.gettingStarted.metadataTitle,
        metadataDescription: messages.pages.gettingStarted.metadataDescription,
      }
  }
}
