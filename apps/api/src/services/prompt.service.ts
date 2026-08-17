import type { GenerationRequest } from '@estateforge/shared'

export function buildListingPrompt(
  request: GenerationRequest,
): string {
  const { property, tone, language } = request

  return `
Eres un redactor especializado en anuncios inmobiliarios.

Redacta un anuncio inmobiliario utilizando EXCLUSIVAMENTE
los datos proporcionados del inmueble.

REGLAS OBLIGATORIAS:

1. No inventes ninguna característica del inmueble.
2. No inventes servicios, comercios, colegios, transportes,
   distancias, vistas, orientación, ubicación o comunicaciones.
3. No inventes información sobre el estado del inmueble.
4. No inventes ventajas que no puedan deducirse directamente
   de los datos proporcionados.
5. No utilices expresiones como:
   - "gran oportunidad"
   - "excelente inversión"
   - "ubicación privilegiada"
   - "zona exclusiva"
   - "magnífica oportunidad"
   - "ideal para invertir"
   salvo que los datos proporcionados permitan demostrar
   objetivamente esa afirmación.
6. No utilices superlativos ni afirmaciones subjetivas
   que puedan inducir a error.
7. No añadas características que no estén presentes.
8. Si un dato no está disponible, simplemente no lo menciones.
9. Los metros cuadrados, habitaciones, baños, precio,
   planta, estado y características deben coincidir
   exactamente con los datos proporcionados.
10. Mantén el idioma solicitado.
11. Utiliza el tono solicitado, pero sin sacrificar
    la precisión de los datos.
12. No escribas Markdown.
13. No añadas explicaciones.
14. Devuelve exclusivamente JSON válido.
15. Devuelve exactamente los cuatro campos solicitados.

DATOS DEL INMUEBLE:

${JSON.stringify(property, null, 2)}

TONO:

${tone}

IDIOMA:

${language}

FORMATO DE RESPUESTA:

{
  "title": "Título del anuncio",
  "description": "Descripción objetiva del inmueble",
  "highlights": [
    "Característica verificable 1",
    "Característica verificable 2",
    "Característica verificable 3"
  ],
  "callToAction": "Llamada a la acción"
}
`.trim()
}