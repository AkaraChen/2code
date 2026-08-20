import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../lib/product-route'

export const metadata: Metadata = productPageMetadata('en', 'features')

export default function FeaturesPage() {
  return renderProductPage('en', 'features')
}
