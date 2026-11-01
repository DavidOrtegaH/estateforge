import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_URL } from '@/lib/api'
import {
  getAdminAudit,
  getAdminOverview,
  getAdminUserDetail,
  getAdminUsers,
  runAdminUserAction,
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
})
