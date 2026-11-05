import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_URL } from '@/lib/api'
import {
  AdminApiError,
  changeRecoveryDestination,
  getAdminAudit,
  getAdminOverview,
  getAdminUserDetail,
  getAdminUsers,
  resendRecoveryLink,
  resolveSecurityHold,
  runAdminUserAction,
  type AdminAuditAction,
} from './adminService'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return fetchMock.mock.calls[0][1] as RequestInit
}

const pagination = { page: 1, pageSize: 20, total: 0, pages: 0 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adminService', () => {
  it('consulta el resumen con la cookie de sesión y sin Content-Type', async () => {
    const overview = { users: 5, properties: 4, generations: 7, blockedUsers: 1, suspendedUsers: 1 }
    const fetchMock = stubFetch(jsonResponse(overview))

    await expect(getAdminOverview()).resolves.toEqual(overview)
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/overview`, expect.objectContaining({ credentials: 'include' }))
    expect(lastInit(fetchMock).headers).toEqual({})
  })

  it('sin argumentos pide los usuarios sin parámetros de consulta', async () => {
    const fetchMock = stubFetch(jsonResponse({ users: [], pagination }))

    await getAdminUsers()

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/users`, expect.objectContaining({ credentials: 'include' }))
  })

  it('codifica la búsqueda y respeta la página', async () => {
    const fetchMock = stubFetch(jsonResponse({ users: [], pagination }))

    await getAdminUsers({ search: 'a b+c@x.com', page: 3 })

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/users?search=a%20b%2Bc%40x.com&page=3`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('envía una búsqueda vacía tal cual', async () => {
    const fetchMock = stubFetch(jsonResponse({ users: [], pagination }))

    await getAdminUsers({ search: '', page: 1 })

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/users?search=&page=1`, expect.anything())
  })

  it('salta directamente a la página 1250 con una sola petición y conserva la búsqueda', async () => {
    const fetchMock = stubFetch(jsonResponse({ users: [], pagination }))

    await getAdminUsers({ search: 'target', page: 1250 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/users?search=target&page=1250`, expect.anything())
  })

  it('pide el detalle de la cuenta con el id codificado, la cookie de sesión y sin Content-Type', async () => {
    const detail = {
      id: 'user/1', email: 'a@x.test', role: 'USER', createdAt: '2026-09-01T00:00:00.000Z',
      securityHoldAt: null, adminSuspendedAt: null, adminSuspensionReason: null,
      properties: 3, activeSessions: 2,
    }
    const fetchMock = stubFetch(jsonResponse(detail))

    await expect(getAdminUserDetail('user/1')).resolves.toEqual(detail)
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/users/user%2F1`, expect.objectContaining({ credentials: 'include' }))
    expect(lastInit(fetchMock).headers).toEqual({})
  })

  it('lanza el mensaje de la API si el detalle devuelve 404', async () => {
    stubFetch(jsonResponse({ message: 'No se ha encontrado la cuenta.' }, 404))

    await expect(getAdminUserDetail('no-existe')).rejects.toThrow('No se ha encontrado la cuenta.')
  })

  it('usa el mensaje genérico si el detalle devuelve una respuesta no JSON', async () => {
    stubFetch(new Response('URI Too Long', { status: 414 }))

    await expect(getAdminUserDetail('a'.repeat(101))).rejects.toThrow('No se pudo completar la operación (414).')
  })

  it('pide la página indicada de la auditoría', async () => {
    const audit = { logs: [], pagination: { page: 2, pageSize: 10, total: 15, pages: 2 } }
    const fetchMock = stubFetch(jsonResponse(audit))

    await expect(getAdminAudit(2)).resolves.toEqual(audit)
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/audit?page=2`, expect.objectContaining({ credentials: 'include' }))
  })

  it('sin filtros mantiene exactamente la URL de la auditoría', async () => {
    const fetchMock = stubFetch(jsonResponse({ logs: [], pagination }))

    await getAdminAudit(3, {})

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/audit?page=3`, expect.objectContaining({ credentials: 'include' }))
    expect(lastInit(fetchMock).headers).toEqual({})
  })

  it('envía el filtro por acción', async () => {
    const fetchMock = stubFetch(jsonResponse({ logs: [], pagination }))

    await getAdminAudit(1, { action: 'SESSIONS_REVOKED' })

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/audit?page=1&action=SESSIONS_REVOKED`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it.each([
    'SECURITY_HOLD_RESOLVED',
    'SECURITY_RECOVERY_DESTINATION_CHANGED',
    'SECURITY_RECOVERY_LINK_RESENT',
    'SECURITY_RECOVERY_LINK_REQUESTED',
    'SECURITY_RECOVERY_COMPLETED',
  ] as const)('envía el filtro por la acción de recuperación %s', async (action) => {
    const fetchMock = stubFetch(jsonResponse({ logs: [], pagination }))

    await getAdminAudit(1, { action })

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/audit?page=1&action=${action}`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('combina una acción de recuperación con el filtro por cuenta', async () => {
    const fetchMock = stubFetch(jsonResponse({ logs: [], pagination }))

    await getAdminAudit(3, { action: 'SECURITY_RECOVERY_LINK_REQUESTED', targetUserId: 'user/1' })

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/audit?page=3&action=SECURITY_RECOVERY_LINK_REQUESTED&targetUserId=user%2F1`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('codifica la acción: un valor inesperado no añade parámetros a la URL', async () => {
    const fetchMock = stubFetch(jsonResponse({ logs: [], pagination }))

    await getAdminAudit(1, { action: 'SESSIONS_REVOKED&targetUserId=otra' as AdminAuditAction })

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/audit?page=1&action=SESSIONS_REVOKED%26targetUserId%3Dotra`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('envía el filtro por cuenta con el id codificado', async () => {
    const fetchMock = stubFetch(jsonResponse({ logs: [], pagination }))

    await getAdminAudit(1, { targetUserId: 'user/1' })

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/audit?page=1&targetUserId=user%2F1`,
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('envía los dos filtros a la vez', async () => {
    const fetchMock = stubFetch(jsonResponse({ logs: [], pagination }))

    await getAdminAudit(2, { action: 'ACCOUNT_SUSPENDED', targetUserId: 'user-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/audit?page=2&action=ACCOUNT_SUSPENDED&targetUserId=user-1`,
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(lastInit(fetchMock).headers).toEqual({})
  })

  it('salta directamente a la página 1250 de la auditoría con una sola petición y los filtros', async () => {
    const fetchMock = stubFetch(jsonResponse({ logs: [], pagination }))

    await getAdminAudit(1250, { action: 'ACCOUNT_SUSPENDED', targetUserId: 'user-1' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/audit?page=1250&action=ACCOUNT_SUSPENDED&targetUserId=user-1`,
      expect.anything(),
    )
  })

  it('no envía un identificador de cuenta vacío', async () => {
    const fetchMock = stubFetch(jsonResponse({ logs: [], pagination }))

    await getAdminAudit(1, { targetUserId: '' })

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/audit?page=1`, expect.anything())
  })

  it('lanza el mensaje de la API si la auditoría filtrada falla', async () => {
    stubFetch(jsonResponse({ message: 'No tienes permisos para acceder a esta sección.' }, 403))

    await expect(getAdminAudit(1, { action: 'ACCOUNT_SUSPENDED' })).rejects.toThrow(
      'No tienes permisos para acceder a esta sección.',
    )
  })

  it('envía la acción con el motivo, el id codificado y la cookie de sesión', async () => {
    const fetchMock = stubFetch(jsonResponse({ success: true, message: 'Cuenta suspendida y sesiones cerradas.' }))

    await expect(runAdminUserAction('user/1', 'suspend', 'Spam reiterado')).resolves.toMatchObject({
      message: 'Cuenta suspendida y sesiones cerradas.',
    })
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/users/user%2F1/suspend`, {
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({ reason: 'Spam reiterado' }),
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it.each(['unsuspend', 'revoke-sessions'] as const)('usa la ruta de la acción %s', async action => {
    const fetchMock = stubFetch(jsonResponse({ message: 'ok' }))

    await runAdminUserAction('user-1', action, 'Motivo válido')

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/users/user-1/${action}`, expect.objectContaining({ method: 'POST' }))
  })

  it.each([403, 409])('lanza el mensaje de la API en un %i', async status => {
    stubFetch(jsonResponse({ message: 'La cuenta ya está suspendida administrativamente.' }, status))

    await expect(runAdminUserAction('user-1', 'suspend', 'Motivo válido')).rejects.toThrow(
      'La cuenta ya está suspendida administrativamente.',
    )
  })

  it('usa el mensaje genérico si la respuesta de error no es JSON', async () => {
    stubFetch(new Response('Too Many Requests', { status: 429 }))

    await expect(runAdminUserAction('user-1', 'suspend', 'Motivo válido')).rejects.toThrow(
      'No se pudo completar la operación (429).',
    )
  })

  it('usa el mensaje genérico si la respuesta de error no tiene cuerpo', async () => {
    stubFetch(new Response(null, { status: 500 }))

    await expect(getAdminOverview()).rejects.toThrow('No se pudo completar la operación (500).')
  })

  it('los errores conservan el estado HTTP sin cambiar su mensaje', async () => {
    stubFetch(jsonResponse({ message: 'La cuenta ya está suspendida administrativamente.' }, 409))

    const error = await runAdminUserAction('user-1', 'suspend', 'Motivo válido').then(() => null, (failure: unknown) => failure)
    expect(error).toBeInstanceOf(AdminApiError)
    expect(error).toBeInstanceOf(Error)
    expect((error as AdminApiError).status).toBe(409)
    expect((error as AdminApiError).message).toBe('La cuenta ya está suspendida administrativamente.')
  })
})

describe('adminService: recuperación de cuentas (R2)', () => {
  const sent = { success: true, recoveryEmailSent: true, message: 'Protección por incidente retirada. Se ha enviado el enlace de recuperación obligatoria.' }
  const jsonPost = (body: unknown) => ({ credentials: 'include', method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

  it('retira la protección con el destino guardado: solo envía el motivo', async () => {
    const fetchMock = stubFetch(jsonResponse(sent))

    await expect(resolveSecurityHold('user/1', 'Incidente revisado')).resolves.toEqual(sent)
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/users/user%2F1/resolve-security-hold`, jsonPost({ reason: 'Incidente revisado' }))
  })

  it('retira la protección con un destino indicado: envía motivo y recoveryEmail', async () => {
    const fetchMock = stubFetch(jsonResponse(sent))

    await resolveSecurityHold('user-1', 'Incidente revisado', 'nuevo@estateforge.test')
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/users/user-1/resolve-security-hold`,
      jsonPost({ reason: 'Incidente revisado', recoveryEmail: 'nuevo@estateforge.test' }),
    )
  })

  it('corrige el destino: envía motivo y recoveryEmail y devuelve changed', async () => {
    const result = { success: true, changed: true, recoveryEmailSent: true, message: 'Destino de recuperación actualizado.' }
    const fetchMock = stubFetch(jsonResponse(result))

    await expect(changeRecoveryDestination('user/1', 'Destino erróneo', 'otro@estateforge.test')).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/admin/users/user%2F1/recovery-destination`,
      jsonPost({ reason: 'Destino erróneo', recoveryEmail: 'otro@estateforge.test' }),
    )
  })

  it('corregir al mismo destino devuelve changed false y recoveryEmailSent false tal cual', async () => {
    const result = { success: true, changed: false, recoveryEmailSent: false, message: 'El destino indicado ya es el destino de recuperación de la cuenta.' }
    stubFetch(jsonResponse(result))

    await expect(changeRecoveryDestination('user-1', 'Sin cambios', 'mismo@estateforge.test')).resolves.toEqual(result)
  })

  it('reenvía el enlace: solo envía el motivo', async () => {
    const fetchMock = stubFetch(jsonResponse({ success: true, recoveryEmailSent: true, message: 'Se ha enviado un enlace de recuperación nuevo.' }))

    await resendRecoveryLink('user/1', 'El titular no recibió el correo')
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/api/admin/users/user%2F1/resend-recovery`, jsonPost({ reason: 'El titular no recibió el correo' }))
  })

  it('un envío fallido se devuelve como respuesta correcta con recoveryEmailSent false', async () => {
    const failed = { success: true, recoveryEmailSent: false, message: 'No se pudo enviar el enlace de recuperación.' }
    stubFetch(jsonResponse(failed))

    await expect(resendRecoveryLink('user-1', 'Reintento')).resolves.toEqual(failed)
  })

  it.each([
    [409, 'La cuenta tiene una protección por incidente activa. Retírala primero; la retirada envía un enlace nuevo.'],
    [400, 'La cuenta no tiene un destino de recuperación guardado. Corrige el destino antes de reenviar.'],
  ])('un %i lanza AdminApiError con su estado y el mensaje de la API', async (status, message) => {
    stubFetch(jsonResponse({ message }, status))

    const error = await resendRecoveryLink('user-1', 'Reintento').then(() => null, (failure: unknown) => failure)
    expect(error).toBeInstanceOf(AdminApiError)
    expect((error as AdminApiError).status).toBe(status)
    expect((error as AdminApiError).message).toBe(message)
  })

  it('retirar la protección sin destino guardado (400) conserva el mensaje de la API', async () => {
    const message = 'La cuenta no tiene un destino de recuperación guardado. Indica el email al que enviar el enlace de recuperación obligatoria.'
    stubFetch(jsonResponse({ message }, 400))

    await expect(resolveSecurityHold('user-1', 'Incidente revisado')).rejects.toThrow(message)
  })
})
