export interface DashboardStats {
  properties: number
  generations: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const response = await fetch(
    'http://localhost:3000/api/dashboard/stats',
  )

  if (!response.ok) {
    throw new Error(
      `Failed to load dashboard stats: ${response.status}`,
    )
  }

  return response.json() as Promise<DashboardStats>
}