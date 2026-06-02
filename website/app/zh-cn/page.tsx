import type { Metadata } from 'next'
import { HomePageContent } from '../home-page-content'
import { getMessages } from '../i18n/resources'
import { buildPageMetadata } from '../page-metadata'

export const metadata: Metadata = buildPageMetadata('zh-cn', '/zh-cn')

export default function ChineseHomePage() {
  return <HomePageContent locale="zh-cn" messages={getMessages('zh-cn')} />
}
