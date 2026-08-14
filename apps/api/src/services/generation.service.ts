import type {
  GeneratedListing,
  GenerationRequest,
} from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
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

  const result = await aiProvider.generate(prompt)

  const property = await prisma.property.create({
    data: {
      operation: request.property.operation,
      type: request.property.type,
      price: request.property.price,
      address: request.property.address,
      city: request.property.city,
      neighborhood: request.property.neighborhood,
      area: request.property.area,
      bedrooms: request.property.bedrooms,
      bathrooms: request.property.bathrooms,
      floor: request.property.floor,
      condition: request.property.condition,
      elevator: request.property.elevator,
      terrace: request.property.terrace,
      balcony: request.property.balcony,
      garage: request.property.garage,
      pool: request.property.pool,
      garden: request.property.garden,
      airConditioning: request.property.airConditioning,
      heating: request.property.heating,
      additionalInformation: request.property.additionalInformation,
    },
  })

  await prisma.generation.create({
    data: {
      propertyId: property.id,
      title: result.title,
      description: result.description,
      highlights: JSON.stringify(result.highlights),
      callToAction: result.callToAction,
      provider: process.env.AI_PROVIDER ?? 'mock',
      tone: request.tone,
      language: request.language,
    },
  })

  return result
}