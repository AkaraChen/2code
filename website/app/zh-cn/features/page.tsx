import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../../lib/product-route'

export const metadata: Metadata = productPageMetadata('zh-cn', 'features')

export default function ChineseFeaturesPage() {
  return renderProductPage('zh-cn', 'features')
}
