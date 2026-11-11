import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../lib/product-route'

export const revalidate = 3600

export const metadata: Metadata = productPageMetadata('en', 'getting-started')

export default function GettingStartedPage() {
  return renderProductPage('en', 'getting-started')
}
