import type {
  GenerateListingRequest,
  GenerateListingResponse,
} from '@/types/generation'

export async function generateListing(
  request: GenerateListingRequest,
): Promise<GenerateListingResponse> {
  console.log('Generation request:', request)

  return {
    listing: {
      title: 'Título de ejemplo',
      description: 'Descripción generada de ejemplo.',
      highlights: [
        '3 habitaciones',
        '2 baños',
        'Terraza',
      ],
      callToAction: 'Contacta con nosotros para concertar una visita.',
    },
  }
}