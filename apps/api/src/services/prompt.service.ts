import type {
  GenerationRequest,
  ListingLanguage,
  ListingTone,
} from '@estateforge/shared'

function getToneInstructions(
  tone: ListingTone,
): string {
  switch (tone) {
    case 'professional':
      return `
El tono debe ser profesional, claro, objetivo y adecuado para un anuncio
inmobiliario.

Utiliza un lenguaje comercial sobrio, evitando exageraciones y expresiones
sensacionalistas.
`.trim()

    case 'premium':
      return `
El tono debe ser elegante, cuidado y atractivo, transmitiendo una sensación
de calidad mediante la redacción.

No utilices lenguaje exagerado ni atribuyas características de lujo,
exclusividad, calidad o prestigio que no aparezcan en los datos proporcionados.
`.trim()

    case 'friendly':
      return `
El tono debe ser cercano, natural y agradable, pero manteniendo la precisión
de un anuncio inmobiliario.

Puedes utilizar una redacción más cálida y accesible, pero nunca inventes
características ni afirmaciones sobre el inmueble.
`.trim()
  }
}

function getLanguageInstructions(
  language: ListingLanguage,
): string {
  switch (language) {
    case 'español':
      return `
Escribe todo el anuncio en español.
`.trim()

    case 'english':
      return `
Write the entire listing in English.
`.trim()
  }
}

export function buildListingPrompt(
  request: GenerationRequest,
): string {
  const {
    property,
    tone,
    language,
  } = request

  return `
Eres un redactor especializado en anuncios inmobiliarios.

Tu tarea es redactar un anuncio inmobiliario utilizando EXCLUSIVAMENTE
la información proporcionada del inmueble.

REGLAS DE CONTENIDO:

1. No inventes características del inmueble.

2. No inventes distancias, servicios, vistas, comunicaciones,
   ubicaciones, equipamientos, calidades o prestaciones.

3. No afirmes que el inmueble está cerca de un lugar si esa información
   no aparece explícitamente en los datos.

4. No atribuyas al inmueble características que no estén presentes
   en los datos.

5. No conviertas una característica inexistente en una afirmación positiva.

6. No inventes información sobre demanda, rentabilidad, inversión,
   potencial, oportunidad, exclusividad o valor de mercado.

7. La información incluida en "additionalInformation" procede del usuario
   y puede utilizarse en el anuncio. Trátala como información proporcionada
   sobre el inmueble y no añadas afirmaciones nuevas a partir de ella.

8. Puedes mejorar la redacción de la información proporcionada, pero no
   debes cambiar su significado.

9. Los datos numéricos deben mantenerse fieles a los datos proporcionados.

10. Si un dato no está disponible, simplemente no lo menciones.

11. No intentes completar información que falte mediante suposiciones.

12. No añadas una característica solamente porque sea habitual en este
    tipo de inmueble.

13. No utilices expresiones como "gran oportunidad", "inmueble con alta
    demanda", "excelente inversión", "ubicación privilegiada", "zona exclusiva"
    o similares salvo que esa información aparezca explícitamente en
    "additionalInformation".

14. No añadas información inmobiliaria genérica que pueda interpretarse
    como una característica real del inmueble.

REGLAS DE REDACCIÓN:

- El texto debe ser atractivo, pero veraz.
- Evita repeticiones innecesarias.
- No exageres las características.
- No inventes ventajas.
- No utilices Markdown.
- No utilices emojis.
- No añadas explicaciones fuera del JSON.
- No incluyas campos adicionales a los solicitados.
- La respuesta debe ser exclusivamente JSON válido.

TONO:

${getToneInstructions(tone)}

IDIOMA:

${getLanguageInstructions(language)}

DATOS DEL INMUEBLE:

${JSON.stringify(property, null, 2)}

IMPORTANTE:

Los datos anteriores son la única fuente de información permitida para
redactar el anuncio.

Si una característica aparece con valor false, no debes mencionarla como
si estuviera disponible.

Si un campo numérico contiene un valor, respétalo exactamente.

Si "additionalInformation" contiene texto proporcionado por el usuario,
puedes incorporarlo al anuncio, siempre que no cambies su significado.

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