import type {
  GeneratedListing,
  GenerationRequest,
} from '@estateforge/shared'

import { buildListingPrompt } from './prompt.service.js'
import type { AIProvider } from '../ai/ai-provider.js'
import { MockAIProvider } from '../ai/mock-ai.provider.js'
import { OpenAIProvider } from '../ai/openai.provider.js'

function createAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER ?? 'mock'

  if (provider === 'openai') {
    return new OpenAIProvider()
  }

  return new MockAIProvider()
}

const aiProvider = createAIProvider()

export async function generateListing(
  request: GenerationRequest,
): Promise<GeneratedListing> {
  const prompt = buildListingPrompt(request)

  return aiProvider.generate(prompt)
}