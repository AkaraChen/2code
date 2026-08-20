import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../lib/product-route'

export const revalidate = 3600

export const metadata: Metadata = productPageMetadata('en', 'install')

export default function InstallPage() {
  return renderProductPage('en', 'install')
}
