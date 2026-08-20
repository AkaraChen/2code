import { renderLlmsTxt } from '../llms-txt'
import { textResponse } from '../lib/agent-docs'

export const revalidate = 300

export async function GET() {
  return textResponse(await renderLlmsTxt(), 'text/plain')
}
