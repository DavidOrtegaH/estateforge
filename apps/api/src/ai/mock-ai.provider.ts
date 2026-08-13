import type {
  AIProvider,
} from './ai-provider.js'

import type {
  GeneratedListing,
} from '@estateforge/shared'

export class MockAIProvider implements AIProvider {
  async generate(): Promise<GeneratedListing> {
    return {
      title: 'Apartamento luminoso en venta',
      description:
        'Magnífico apartamento con una distribución cómoda y funcional, ideal para quienes buscan un nuevo hogar.',
      highlights: [
        '3 habitaciones',
        '2 baños',
        'Terraza',
      ],
      callToAction:
        'Contacta con nosotros para concertar una visita.',
    }
  }
}