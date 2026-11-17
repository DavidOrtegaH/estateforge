import type { AiModerationCategory } from '@estateforge/shared'

// Política de contenido de EstateForge para la IA (DA-75), primera capa: reglas locales y deterministas
// sobre el texto del anuncio, antes de enviar nada al proveedor. No sustituye al clasificador del
// proveedor (segunda capa) ni a la revisión del usuario (tercera): detecta lo evidente sin coste y sin
// transferir datos. Las reglas trabajan sobre el texto normalizado (minúsculas, sin acentos).

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[​-‏⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
}

const PROTECTED =
  '(extranjer|inmigrant|marroqu|magrebi|arabe|africa|latin|sudaca|gitan|rumano|chino|negro|musulman|islam|judi|cristian|catolic|evangel|ateo|gay|lesbian|homosexual|transexual|transgenero|personas trans\\b|bisexual|discapacit|minusvalid|ancian|personas mayores|jubilad|embarazad|madre soltera|padre soltero|familias? con (ninos|hijos|bebes)|ninos|hijos|bebes|mujeres|hombres|parejas (del mismo sexo|homosexuales))'

const RULES: { category: AiModerationCategory; patterns: RegExp[] }[] = [
  {
    category: 'sexual_minors',
    patterns: [
      /\b(pornografia infantil|abuso (sexual )?(de|a) menores|explotacion (sexual )?infantil|child porn|csam)\b/,
      /\b(menor(es)?( de edad)?|nin[oa]s?|adolescentes?|chiquill)\b.{0,40}\b(desnud|sexual|erotic|sensual|intim)/,
      /\b(desnud|sexual|erotic|sensual|intim)\w*\b.{0,40}\b(menor(es)?( de edad)?|nin[oa]s?|adolescentes?)\b/,
    ],
  },
  { category: 'sexual_explicit', patterns: [/\b(porno|pornograf|sexo explicito|desnudos? integral|contenido para adultos|xxx)\b/] },
  { category: 'non_consensual_intimate', patterns: [/\b(fotos? intimas? (robadas|filtradas|sin permiso)|revenge porn|pornovenganza)\b/] },
  {
    category: 'housing_discrimination',
    patterns: [
      new RegExp(`\\b(no se (admiten|aceptan|alquila a|vende a)|abstenerse|no (queremos|aceptamos|admitimos)|prohibid[oa]s?|nada de)\\b.{0,30}\\b${PROTECTED}`),
      new RegExp(`\\b(solo|unicamente|exclusivamente)\\b.{0,25}\\b(para )?(espanoles|nacionales|europeos|blancos|cristianos|catolicos|parejas sin hijos|jovenes|hombres|mujeres|heterosexuales|personas sin discapacidad)\\b`),
      new RegExp(`\\bsin ${PROTECTED}`),
      /\b(no immigrants|no foreigners|whites only|no children allowed|no families with children|christians only)\b/,
    ],
  },
  {
    category: 'prompt_injection',
    patterns: [
      /\b(ignora|olvida|omite|desobedece|salta(te)?)\b.{0,30}\b(instrucciones|indicaciones|reglas|normas|restricciones|filtros)\b/,
      /\b(ignore|disregard|forget|override)\b.{0,30}\b(instructions|rules|prompt|guidelines|filters)\b/,
      /\b(system prompt|prompt del sistema|instrucciones del sistema|developer mode|modo desarrollador|jailbreak|dan mode)\b/,
      /\b(actua|comportate|responde) como\b.{0,40}\b(otro|un|una)\b.{0,30}\b(ia|modelo|asistente|sistema)\b/,
      /\b(you are now|act as)\b/,
      /<\/?\s*(system|assistant|instructions?|tool|developer)\s*>/,
      /\b(genera|crea|dibuja|incluye|anade)\b.{0,40}\b(desnud|sexual|violen|arma|sangre|logotipo de|marca de agua)\w*/,
    ],
  },
  {
    category: 'real_estate_fraud',
    patterns: [
      /\b(rentabilidad|beneficio|revalorizacion|retorno)\b.{0,20}\bgarantizad[oa]\b/,
      /\b(garantizamos|garantizado)\b.{0,30}\b(rentabilidad|hipoteca|financiacion|beneficio|licencia|certificado)\b/,
      /\bsin necesidad de (contrato|escritura|notario)\b/,
      /\bpago por adelantado (sin visita|antes de ver)\b/,
      /\b(licencia turistica|cedula de habitabilidad|certificado energetico (a|a\+))\b.{0,20}\b(garantizad|asegurad)/,
    ],
  },
  { category: 'violence', patterns: [/\b(matar|asesinar|degollar|descuartizar|masacre|tortura)\w*\b/] },
  { category: 'hate', patterns: [/\b(raza inferior|limpieza etnica|exterminar a|fuera (los|las) (extranjeros|inmigrantes|moros|gitanos))\b/] },
  { category: 'dangerous_illegal', patterns: [/\b(narcopiso|punto de venta de droga|cultivo de marihuana|blanqueo de capitales|sin factura ni contrato|ocupacion ilegal)\b/] },
]

/** Categorías que el texto incumple (vacío si cumple la política). */
export function checkTextPolicy(fields: Record<string, string | null | undefined>): AiModerationCategory[] {
  const text = normalize(Object.values(fields).filter(Boolean).join(' \n '))
  const found: AiModerationCategory[] = []
  for (const rule of RULES) if (rule.patterns.some(pattern => pattern.test(text))) found.push(rule.category)
  return found
}
