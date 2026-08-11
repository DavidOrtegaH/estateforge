import type {
  GeneratedListing,
  Property,
} from '@estateforge/shared'

export async function generateListing(
  property: Property,
): Promise<GeneratedListing> {
  console.log('Generating listing for property:', property)

  return {
    title: 'Título generado desde EstateForge',
    description:
      'Descripción generada desde el servicio de generación de EstateForge.',
    highlights: [
      '3 habitaciones',
      '2 baños',
      'Terraza',
    ],
    callToAction:
      'Contacta con nosotros para concertar una visita.',
  }
}