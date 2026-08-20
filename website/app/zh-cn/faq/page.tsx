import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../../lib/product-route'

export const metadata: Metadata = productPageMetadata('zh-cn', 'faq')

export default function ChineseFaqPage() {
  return renderProductPage('zh-cn', 'faq')
}
