import type { Metadata } from 'next'
import { productPageMetadata, renderProductPage } from '../lib/product-route'

export const revalidate = 3600

export const metadata: Metadata = productPageMetadata('en', 'faq')

export default function FaqPage() {
  return renderProductPage('en', 'faq')
}
