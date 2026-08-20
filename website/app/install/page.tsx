import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../lib/product-route'

export const metadata: Metadata = productPageMetadata('en', 'install')

export default function InstallPage() {
  return renderProductPage('en', 'install')
}
