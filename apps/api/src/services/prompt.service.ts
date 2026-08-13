import type { GenerationRequest } from '@estateforge/shared'

export function buildListingPrompt(
  request: GenerationRequest,
): string {
  const { property, tone, language } = request

  return `
Eres un redactor especializado en anuncios inmobiliarios.

Tu tarea es redactar un anuncio inmobiliario utilizando EXCLUSIVAMENTE
la información proporcionada del inmueble.

REGLAS IMPORTANTES:
- No inventes características.
- No inventes distancias, servicios, vistas o ubicaciones.
- No añadas información que no aparezca en los datos.
- No hagas afirmaciones objetivas que no puedan deducirse de los datos.
- El texto debe ser atractivo pero veraz.
- Evita exageraciones que puedan inducir a error.
- No incluyas campos adicionales a los solicitados.
- La respuesta debe ser exclusivamente JSON válido.
- No utilices Markdown.
- No añadas explicaciones antes o después del JSON.

TONO:
${tone}

IDIOMA:
${language}

DATOS DEL INMUEBLE:
${JSON.stringify(property, null, 2)}

Devuelve exactamente este objeto JSON:

{
  "title": "Título del anuncio",
  "description": "Descripción comercial del inmueble",
  "highlights": [
    "Característica destacada 1",
    "Característica destacada 2",
    "Característica destacada 3"
  ],
  "callToAction": "Llamada a la acción"
}
`.trim()
}
