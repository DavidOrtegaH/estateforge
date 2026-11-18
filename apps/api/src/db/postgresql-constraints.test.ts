import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Paridad entre las restricciones manuales y la migración activa (DA-14).
// Prisma no representa los CHECK ni los índices parciales, así que nada más lo vigilaría.

const prismaDir = resolve(import.meta.dirname, '../../prisma')
const migrationsDir = join(prismaDir, 'migrations')

const latestMigration = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(join(migrationsDir, entry.name, 'migration.sql'), 'utf8'))
  .filter((sql) => sql.includes('ListingPublication_published_requires_url'))
  .at(-1) as string

const postgres = readFileSync(join(prismaDir, 'postgresql', 'constraints.sql'), 'utf8')

const checks = (sql: string) =>
  Object.fromEntries(
    [...sql.matchAll(/CONSTRAINT "((?:ListingPublication|User)_\w+)" (CHECK \(.*\))[,;]?\s*$/gm)].map((match) => [match[1], match[2]]),
  )

const partialIndex = (sql: string) =>
  sql.split('\n').find((line) => line.includes('ListingPublication_other_position_key'))

describe('restricciones manuales de PostgreSQL', () => {
  it('declara los cuatro CHECK', () => {
    expect(Object.keys(checks(postgres)).sort()).toEqual([
      'ListingPublication_instance_key_matches_platform',
      'ListingPublication_other_position_range',
      'ListingPublication_published_requires_url',
      'User_email_lowercase',
    ])
  })

  it('los CHECK coinciden con la migración activa', () => {
    expect(checks(postgres)).toEqual(checks(latestMigration))
  })

  it('el índice parcial coincide', () => {
    expect(partialIndex(postgres)).toBeDefined()
    expect(partialIndex(postgres)).toBe(partialIndex(latestMigration))
  })

  it('ni el archivo ni la migración activa usan sintaxis propia de SQLite', () => {
    expect(postgres + latestMigration).not.toMatch(/PRAGMA|AUTOINCREMENT|DATETIME|new_ListingPublication/)
  })

  it('cada CHECK exige explícitamente sus columnas', () => {
    expect(checks(postgres).ListingPublication_other_position_range).toContain('"position" IS NOT NULL')
    expect(checks(postgres).ListingPublication_instance_key_matches_platform).toContain('"instanceKey" IS NOT NULL')
    expect(checks(postgres).ListingPublication_published_requires_url).toContain('"isPublished" IS NOT NULL')
  })
})

describe('restricciones manuales de las fotografías y del material publicitario (DA-46)', () => {
  const mediaMigration = readFileSync(join(migrationsDir, '20261110120000_add_property_photos_and_listing_media', 'migration.sql'), 'utf8')
  const START = 'ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_position_range"'
  const NEXT = '-- Galería de 50 fotografías, plantillas y audio (DA-51 a DA-55).'
  const normalize = (sql: string) => sql.replace(/\r\n/g, '\n').trim()
  // En constraints.sql, el bloque de DA-46 termina donde empieza el de DA-51 a DA-55.
  const block = (sql: string) => normalize(sql.slice(sql.indexOf(START), sql.includes(NEXT) ? sql.indexOf(NEXT) : undefined))

  it('el bloque manual de constraints.sql coincide exactamente con la migración', () => {
    expect(postgres.indexOf(START)).toBeGreaterThan(-1)
    expect(block(postgres)).toBe(block(mediaMigration))
  })

  it('declara el rango de posiciones, los tipos permitidos, la principal única, el límite inicial y la cola de limpieza', () => {
    const sql = block(postgres)
    for (const name of [
      'PropertyPhoto_position_range', 'PropertyPhoto_content_type_allowed', 'PropertyPhoto_size_range', 'PropertyPhoto_sha256_format',
      'ListingMedia_kind_allowed', 'ListingMedia_content_type_matches_kind', 'ListingMedia_size_range', 'ListingMedia_version_positive',
      'PropertyPhoto_one_primary_key', 'PropertyPhoto_max_16', 'PropertyPhoto_enqueue_cleanup', 'ListingMedia_enqueue_cleanup',
    ]) {
      expect(sql).toContain(`"${name}"`)
    }
    expect(sql).toContain('BETWEEN 0 AND 15')
    expect(sql).toContain('>= 16')
  })
})

describe('restricciones manuales de la galería de 50, las plantillas y el audio (DA-51 a DA-55)', () => {
  const migration = readFileSync(join(migrationsDir, '20261111120000_gallery_50_poster_templates_audio', 'migration.sql'), 'utf8')
  const START = 'ALTER TABLE "PropertyPhoto" DROP CONSTRAINT "PropertyPhoto_position_range";'
  const NEXT = '-- Subidas directas (DA-58).'
  const block = (sql: string) => sql.slice(sql.indexOf(START), sql.includes(NEXT) ? sql.indexOf(NEXT) : undefined).replace(/\r\n/g, '\n').trim()

  it('el bloque de constraints.sql coincide exactamente con la migración nueva', () => {
    expect(postgres.indexOf(START)).toBeGreaterThan(-1)
    expect(block(postgres)).toBe(block(migration))
  })

  it('amplía el límite a 50 y añade las restricciones de miniaturas, plantillas, audio y sorteos', () => {
    const sql = block(postgres)
    expect(sql).toContain('BETWEEN 0 AND 49')
    expect(sql).toContain('>= 50')
    expect(sql).toContain('DROP TRIGGER "PropertyPhoto_max_16"')
    for (const name of [
      'PropertyPhoto_thumb_consistent', 'ListingMedia_template_fields', 'ListingMedia_audio_fields', 'AudioTrack_format_allowed',
      'AudioTrack_size_range', 'AudioTrack_duration_range', 'AudioTrack_sha256_format', 'AudioTrack_name_length',
      'MediaTemplateDraw_version_positive', 'PropertyPhoto_max_photos', 'AudioTrack_max_tracks', 'PropertyPhoto_enqueue_thumb_cleanup',
      'AudioTrack_enqueue_cleanup',
    ]) {
      expect(sql).toContain(`"${name}"`)
    }
  })

  it('la migración nueva es aditiva: no borra tablas, columnas ni filas', () => {
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i)
  })
})

describe('restricciones manuales de las subidas directas (DA-58)', () => {
  const migration = readFileSync(join(migrationsDir, '20261112120000_direct_uploads', 'migration.sql'), 'utf8')
  const START = 'ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_kind_allowed"'
  const NEXT = '-- BYOK de IA para carteles y vídeos (DA-67 a DA-75).'
  const block = (sql: string) => sql.slice(sql.indexOf(START), sql.includes(NEXT) ? sql.indexOf(NEXT) : undefined).replace(/\r\n/g, '\n').trim()

  it('el bloque de constraints.sql coincide exactamente con la migración', () => {
    expect(postgres.indexOf(START)).toBeGreaterThan(-1)
    expect(block(postgres)).toBe(block(migration))
  })

  it('declara tipos, estados, tamaño, coherencia del resultado y del destino y la limpieza de intentos fallidos', () => {
    const sql = block(postgres)
    for (const name of ['UploadAttempt_kind_allowed', 'UploadAttempt_status_allowed', 'UploadAttempt_size_range', 'UploadAttempt_completed_has_result', 'UploadAttempt_target_matches_kind', 'UploadAttempt_enqueue_cleanup', 'UploadAttempt_delete_enqueue_cleanup']) {
      expect(sql).toContain(`"${name}"`)
    }
  })

  it('es aditiva: no borra tablas, columnas ni filas', () => {
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i)
  })
})

describe('restricciones manuales del BYOK de IA (DA-67 a DA-75)', () => {
  const migration = readFileSync(join(migrationsDir, '20261113120000_ai_media_byok', 'migration.sql'), 'utf8')
  const START = 'ALTER TABLE "UserAIKey" ADD CONSTRAINT "UserAIKey_provider_allowed"'
  const NEXT = '-- BYOK obligatorio también para el texto (DA-77).'
  const block = (sql: string) => sql.slice(sql.indexOf(START), sql.includes(NEXT) ? sql.indexOf(NEXT) : undefined).replace(/\r\n/g, '\n').trim()

  it('el bloque de constraints.sql coincide exactamente con la migración', () => {
    expect(postgres.indexOf(START)).toBeGreaterThan(-1)
    expect(block(postgres)).toBe(block(migration))
  })

  it('declara proveedores, estados, cifrado conocido, moderación previa a «listo», categoría al bloquear y la limpieza de resultados', () => {
    const sql = block(postgres)
    for (const name of [
      'UserAIKey_provider_allowed', 'UserAIKey_status_allowed', 'UserAIKey_hint_format', 'UserAIKey_encryption_known', 'AiMediaPreference_pairs',
      'AiMediaJob_kind_allowed', 'AiMediaJob_status_allowed', 'AiMediaJob_moderation_allowed', 'AiMediaJob_ready_is_moderated',
      'AiMediaJob_blocked_has_category', 'AiMediaJob_counters_range', 'ListingMedia_ai_fields', 'AiMediaJob_enqueue_cleanup', 'AiMediaJob_delete_enqueue_cleanup',
    ]) {
      expect(sql).toContain(`"${name}"`)
    }
  })

  it('es aditiva: no borra tablas, columnas ni filas', () => {
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i)
  })
})

describe('restricción manual de la preferencia de texto (DA-77)', () => {
  const migration = readFileSync(join(migrationsDir, '20261114120000_ai_text_byok', 'migration.sql'), 'utf8')
  const START = 'ALTER TABLE "AiMediaPreference" ADD CONSTRAINT "AiMediaPreference_text_pair"'
  const NEXT = '-- Catálogo amplio de proveedores (DA-82, DA-83).'
  const block = (sql: string) => sql.slice(sql.indexOf(START), sql.includes(NEXT) ? sql.indexOf(NEXT) : undefined).replace(/\r\n/g, '\n').trim()

  it('el bloque de constraints.sql coincide exactamente con la migración y es aditiva', () => {
    expect(postgres.indexOf(START)).toBeGreaterThan(-1)
    expect(block(postgres)).toBe(block(migration))
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i)
  })
})

describe('restricciones manuales del catálogo amplio de proveedores (DA-82, DA-83)', () => {
  const migration = readFileSync(join(migrationsDir, '20261115120000_ai_provider_catalog', 'migration.sql'), 'utf8')
  const START = '-- Catálogo amplio de proveedores (DA-82, DA-83).'
  // En constraints.sql el bloque termina donde empieza el de DA-87 a DA-89; en la migración, al final.
  const NEXT = '-- Diagnóstico de conexiones y pruebas reales controladas (DA-87, DA-89).'
  const block = (sql: string) => {
    const start = sql.indexOf(START)
    const end = sql.indexOf(NEXT, start)
    return sql.slice(start, end === -1 ? undefined : end).replace(/\r\n/g, '\n').trim()
  }

  it('el bloque de constraints.sql coincide exactamente con la migración', () => {
    expect(postgres.indexOf(START)).toBeGreaterThan(-1)
    expect(block(postgres)).toBe(block(migration))
  })

  it('la migración es aditiva: no borra tablas, columnas ni filas', () => {
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i)
    // Lo único que se retira es la lista cerrada de proveedores y el índice único antiguo, que se sustituyen
    // por otros más amplios: ninguna fila existente deja de ser válida.
    expect(migration.match(/DROP (CONSTRAINT|INDEX) "[A-Za-z_]+"/g)).toEqual(['DROP INDEX "UserAIKey_userId_provider_key"', 'DROP CONSTRAINT "UserAIKey_provider_allowed"'])
    expect(migration).toContain('CREATE UNIQUE INDEX "UserAIKey_userId_provider_label_key" ON "UserAIKey"("userId", "provider", "label")')
    expect(migration).toContain(`ADD COLUMN     "label" TEXT NOT NULL DEFAULT ''`)
  })

  it('el formato del proveedor admite todos los del catálogo y rechaza valores extraños', () => {
    const pattern = /CHECK \("provider" ~ '([^']+)'\)/.exec(migration)![1]
    const regex = new RegExp(pattern)
    for (const id of ['gemini', 'openai', 'anthropic', 'xai', 'mistral', 'deepseek', 'openrouter', 'groq', 'bfl', 'stability', 'ideogram', 'recraft', 'runway', 'fal', 'replicate', 'simulador']) expect(regex.test(id)).toBe(true)
    for (const bad of ['', 'x', 'OpenAI', 'open ai', 'https://evil', '../etc', 'a'.repeat(30)]) expect(regex.test(bad)).toBe(false)
  })
})

describe('restricciones manuales del diagnóstico y de las pruebas reales controladas (DA-87 a DA-89)', () => {
  const migration = readFileSync(join(migrationsDir, '20261115200000_ai_provider_trials', 'migration.sql'), 'utf8')
  const START = '-- Diagnóstico de conexiones y pruebas reales controladas (DA-87, DA-89).'
  // En constraints.sql el bloque termina donde empieza el de la migración siguiente.
  const NEXT = '-- Constancia de las ejecuciones del mantenimiento diario'
  const block = (sql: string) => {
    const from = sql.slice(sql.indexOf(START))
    const end = from.indexOf(NEXT)
    return (end === -1 ? from : from.slice(0, end)).replace(/\r\n/g, '\n').trim()
  }

  it('el bloque de constraints.sql coincide exactamente con la migración', () => {
    expect(postgres.indexOf(START)).toBeGreaterThan(-1)
    expect(block(postgres)).toBe(block(migration))
  })

  it('la migración es aditiva: solo añade una columna opcional, una tabla, índices y restricciones', () => {
    expect(migration).not.toMatch(/DROP |DELETE FROM|TRUNCATE|ALTER COLUMN|RENAME/i)
    expect(migration).toContain('ALTER TABLE "UserAIKey" ADD COLUMN     "lastCheckDetails" TEXT;')
    expect(migration).toContain('CREATE TABLE "AiProviderTrial"')
    // Una conexión eliminada no borra el historial de sus pruebas; un usuario eliminado, sí.
    expect(migration).toContain('FOREIGN KEY ("connectionId") REFERENCES "UserAIKey"("id") ON DELETE SET NULL')
    expect(migration).toContain('FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE')
  })

  it('los estados y tipos de la base coinciden con los del código compartido', async () => {
    const { AI_TRIAL_KINDS, AI_TRIAL_STATUSES } = await import('@estateforge/shared')
    const list = (name: string) => /CHECK \("\w+" IN \(([^)]+)\)\)/.exec(migration.split('\n').find(line => line.includes(name))!)![1].split(', ').map(item => item.slice(1, -1))
    expect(list('AiProviderTrial_kind_allowed')).toEqual([...AI_TRIAL_KINDS])
    expect(list('AiProviderTrial_status_allowed')).toEqual([...AI_TRIAL_STATUSES])
  })
})

describe('constancia de las ejecuciones del mantenimiento (MaintenanceRun)', () => {
  const migration = readFileSync(join(migrationsDir, '20261118120000_maintenance_runs', 'migration.sql'), 'utf8')
  const constraint = (sql: string) => sql.split('\n').find(line => line.includes('ADD CONSTRAINT "MaintenanceRun_values_allowed"'))?.trim()

  it('la restricción de constraints.sql coincide exactamente con la migración', () => {
    expect(constraint(postgres)).toBeDefined()
    expect(constraint(postgres)).toBe(constraint(migration))
  })

  it('la migración es aditiva y la tabla no guarda datos personales ni enlaza cuentas', () => {
    expect(migration).not.toMatch(/DROP |DELETE FROM|TRUNCATE|ALTER COLUMN|RENAME|UPDATE /i)
    expect(migration).toContain('CREATE TABLE "MaintenanceRun"')
    expect(migration).not.toMatch(/FOREIGN KEY|userId|email|storageKey|"ip"/i)
  })
})
