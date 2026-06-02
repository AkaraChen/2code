import type { Metadata } from 'next'
import { HomePageContent } from './home-page-content'
import { getMessages } from './i18n/resources'
import { buildPageMetadata } from './page-metadata'

export const metadata: Metadata = buildPageMetadata('en', '/')

export default function HomePage() {
  return <HomePageContent locale="en" messages={getMessages('en')} />
}
