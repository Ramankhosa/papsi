'use client'

import { useEffect, useState } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { useAuth } from '@/lib/auth-context'
import { DateRangePicker } from '@/components/analytics/DateRangePicker'

interface TenantOption {
  id: string
  name: string
}

interface ServiceUsageUser {
  userId: string
  userName: string
  userEmail: string
  tenantId: string | null
  tenantName: string | null
  tenantType: 'INDIVIDUAL' | 'ENTERPRISE' | null
  patentsDrafted: number
  noveltySearches: number
  ideasReserved: number
}

interface ServiceUsageResponse {
  startDate: string
  endDate: string
  users: ServiceUsageUser[]
  summary: {
    totalPatentsDrafted: number
    totalNoveltySearches: number
    totalIdeasReserved: number
  }
}

type PeriodMode = 'date' | 'month' | 'year'

export default function UserServiceUsagePage() {
  // Prevent static generation
  noStore()

  const { user, logout } = useAuth()

  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState<string>('')
  const [mode, setMode] = useState<PeriodMode>('date')

  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(),
  })

  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [selectedYear, setSelectedYear] = useState<string>('')

  const [data, setData] = useState<ServiceUsageUser[]>([])
  const [summary, setSummary] = useState<ServiceUsageResponse['summary'] | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }

    if (!user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      window.location.href = '/dashboard'
      return
    }

    fetchTenants()
  }, [user])

  useEffect(() => {
    if (user && user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      fetchUsage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dateRange, selectedMonth, selectedYear, selectedTenantId])

  const fetchTenants = async () => {
    try {
      const response = await fetch('/api/tenants', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })
      if (response.ok) {
        const tenantData = await response.json()
        setTenants(tenantData.tenants || [])
      }
    } catch (err) {
      console.error('Failed to fetch tenants:', err)
    }
  }

  const resolveDateRange = () => {
    if (mode === 'date') {
      return {
        start: dateRange.from,
        end: dateRange.to,
      }
    }

    if (mode === 'month' && selectedMonth) {
      const [yearStr, monthStr] = selectedMonth.split('-')
      const year = parseInt(yearStr, 10)
      const month = parseInt(monthStr, 10) - 1
      const start = new Date(year, month, 1)
      const end = new Date(year, month + 1, 0)
      return { start, end }
    }

    if (mode === 'year' && selectedYear) {
      const year = parseInt(selectedYear, 10)
      const start = new Date(year, 0, 1)
      const end = new Date(year, 11, 31)
      return { start, end }
    }

    // Fallback: last 30 days
    const fallbackEnd = new Date()
    const fallbackStart = new Date(fallbackEnd.getTime() - 30 * 24 * 60 * 60 * 1000)
    return { start: fallbackStart, end: fallbackEnd }
  }

  const fetchUsage = async () => {
    try {
      setLoading(true)
      setError(null)

      const { start, end } = resolveDateRange()

      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      })

      if (selectedTenantId) {
        params.append('tenantId', selectedTenantId)
      }

      const response = await fetch(`/api/analytics/service-usage?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to fetch service usage data')
      }

      const body: ServiceUsageResponse = await response.json()
      setData(body.users)
      setSummary(body.summary)
    } catch (err) {
      console.error('Failed to fetch service usage data:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      setData([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user.roles?.some(role => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Access denied. Super admin privileges required.</div>
      </div>
    )
  }

  const formatNumber = (value: number) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">User Wise Service Usage</h1>
            <p className="text-gray-600 mt-1">
              Monitor how many patents, novelty searches, and idea reservations each user performs.
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500">Super Admin: {user.email}</span>
            <button
              onClick={logout}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Filters */}
        <div className="bg-white p-6 rounded-lg shadow border space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Filters</h2>
              <p className="text-sm text-gray-500">
                Filter by date, month, or year and narrow down to a specific tenant.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <label className="text-sm font-medium text-gray-700">View by:</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as PeriodMode)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="date">Date range</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            {mode === 'date' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date range
                </label>
                <DateRangePicker value={dateRange} onChange={setDateRange} />
              </div>
            )}

            {mode === 'month' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Month
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            )}

            {mode === 'year' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Year
                </label>
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="e.g. 2025"
                />
              </div>
            )}

            <div className={mode === 'date' ? 'md:col-span-1' : ''}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tenant
              </label>
              <select
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All tenants</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchUsage}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg shadow border">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Patents drafted</h3>
            <div className="text-2xl font-bold text-gray-900">
              {summary ? formatNumber(summary.totalPatentsDrafted) : '—'}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Total drafting sessions started in the selected period.
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Novelty searches</h3>
            <div className="text-2xl font-bold text-gray-900">
              {summary ? formatNumber(summary.totalNoveltySearches) : '—'}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Completed novelty search runs in the selected period.
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Patent ideas reserved</h3>
            <div className="text-2xl font-bold text-gray-900">
              {summary ? formatNumber(summary.totalIdeasReserved) : '—'}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              New idea bank reservations created in the selected period.
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white p-6 rounded-lg shadow border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">User-wise service usage</h2>
            <p className="text-sm text-gray-500">
              Showing {data.length} user{data.length === 1 ? '' : 's'}.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-4 py-2 text-left">Tenant</th>
                    <th className="px-4 py-2 text-left">Tenant type</th>
                    <th className="px-4 py-2 text-left">User</th>
                    <th className="px-4 py-2 text-left">Email</th>
                    <th className="px-4 py-2 text-right">Patents drafted</th>
                    <th className="px-4 py-2 text-right">Novelty searches</th>
                    <th className="px-4 py-2 text-right">Ideas reserved</th>
                    <th className="px-4 py-2 text-right">Total actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-8 text-center text-gray-500"
                      >
                        No activity found for the selected filters.
                      </td>
                    </tr>
                  )}

                  {data.map((row) => {
                    const totalActions =
                      row.patentsDrafted + row.noveltySearches + row.ideasReserved

                    return (
                      <tr key={row.userId} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <div className="font-medium">
                            {row.tenantName || '—'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {row.tenantId || 'No tenant'}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {row.tenantType || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-medium">{row.userName}</div>
                          <div className="text-xs text-gray-500">ID: {row.userId}</div>
                        </td>
                        <td className="px-4 py-2">{row.userEmail}</td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatNumber(row.patentsDrafted)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatNumber(row.noveltySearches)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {formatNumber(row.ideasReserved)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">
                          {formatNumber(totalActions)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
