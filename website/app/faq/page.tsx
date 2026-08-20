import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../lib/product-route'

export const metadata: Metadata = productPageMetadata('en', 'faq')

export default function FaqPage() {
  return renderProductPage('en', 'faq')
}
