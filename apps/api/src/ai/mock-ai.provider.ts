import type { AIProvider } from './ai-provider.js'

export class MockAIProvider implements AIProvider {
  async generate(_prompt: string): Promise<string> {
    return JSON.stringify({
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
    })
  }
}