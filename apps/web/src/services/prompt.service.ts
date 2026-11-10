import type {
  GenerationRequest,
} from '@estateforge/shared'

export function buildListingPrompt(
  request: GenerationRequest,
): string {
  const { property, tone, language } = request

  return `
Eres un redactor especializado en anuncios inmobiliarios.

Tu tarea es redactar un anuncio inmobiliario utilizando
EXCLUSIVAMENTE la información proporcionada del inmueble.

REGLAS IMPORTANTES:
- No inventes características.
- No inventes distancias, servicios, vistas o ubicaciones.
- No añadas información que no aparezca en los datos.
- No hagas afirmaciones objetivas que no puedan deducirse de los datos.
- El texto debe ser atractivo pero veraz.
- Evita exageraciones que puedan inducir a error.

TONO:
${tone}

IDIOMA:
${language}

DATOS DEL INMUEBLE:
${JSON.stringify({ ...property, price: Number(property.price) }, null, 2)}

Genera un anuncio inmobiliario con:
1. Un título atractivo.
2. Una descripción comercial.
3. Una lista de características destacadas.
4. Una llamada a la acción.
`.trim()
}