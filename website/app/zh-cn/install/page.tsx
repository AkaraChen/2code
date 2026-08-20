import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../../lib/product-route'

export const metadata: Metadata = productPageMetadata('zh-cn', 'install')

export default function ChineseInstallPage() {
  return renderProductPage('zh-cn', 'install')
}
