import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../../lib/product-route'

export const revalidate = 3600

export const metadata: Metadata = productPageMetadata('zh-cn', 'getting-started')

export default function ChineseGettingStartedPage() {
  return renderProductPage('zh-cn', 'getting-started')
}
