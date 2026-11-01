import { API_URL } from '@/lib/api'

export interface DashboardStats {
  properties: number
  generations: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const response = await fetch(
    `${API_URL}/api/dashboard/stats`,
    {
      credentials: 'include',
    },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load dashboard stats: ${response.status}`,
    )
  }

  return response.json() as Promise<DashboardStats>
}