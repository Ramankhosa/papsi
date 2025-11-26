import { prisma } from './prisma'

export interface TenantUsageMetrics {
  tenantId: string | null
  tenantName: string | null
  tenantType: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  patentDrafts: number
  noveltySearches: number
  ideasReserved: number
}

export interface GlobalUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  totalPatentsDrafted: number
  totalNoveltySearches: number
  totalIdeasReserved: number
}

export interface UsageSummaryResult {
  startDate: Date
  endDate: Date
  global: GlobalUsageSummary
  tenants: TenantUsageMetrics[]
}

function calculateCostForLog(
  log: { inputTokens: number | null; outputTokens: number | null; modelClass: string | null },
  priceMap?: Map<string, { input: number; output: number }>
): number {
  const inputTokens = log.inputTokens || 0
  const outputTokens = log.outputTokens || 0

  if (priceMap && log.modelClass && priceMap.has(log.modelClass)) {
    const price = priceMap.get(log.modelClass)!
    const inputCost = inputTokens * (price.input / 1_000_000)
    const outputCost = outputTokens * (price.output / 1_000_000)
    return inputCost + outputCost
  }

  // Fallback: static pricing if no dynamic config
  const inputCost = inputTokens * 0.000005 // $5 per million tokens
  const outputCost = outputTokens * 0.000015 // $15 per million tokens
  return inputCost + outputCost
}

export async function computeUsageSummary(
  startDate: Date,
  endDate: Date,
  tenantFilterId?: string
): Promise<UsageSummaryResult> {
  const normalizedStart = new Date(startDate)
  const normalizedEnd = new Date(endDate)
  normalizedStart.setHours(0, 0, 0, 0)
  normalizedEnd.setHours(23, 59, 59, 999)

  const dateRange = {
    gte: normalizedStart,
    lte: normalizedEnd
  }

  const usageWhere: any = {
    startedAt: dateRange,
    status: 'COMPLETED'
  }

  if (tenantFilterId) {
    usageWhere.tenantId = tenantFilterId
  }

  const [usageLogs, modelPrices, draftsByTenant, noveltyRuns, reservations] = await Promise.all([
    prisma.usageLog.findMany({
      where: usageWhere,
      select: {
        tenantId: true,
        inputTokens: true,
        outputTokens: true,
        apiCalls: true,
        modelClass: true
      }
    }),
    prisma.lLMModelPrice.findMany(),
    prisma.draftingSession.groupBy({
      by: ['tenantId'],
      where: {
        createdAt: dateRange,
        ...(tenantFilterId ? { tenantId: tenantFilterId } : {})
      },
      _count: { _all: true }
    }),
    prisma.noveltySearchRun.findMany({
      where: {
        createdAt: dateRange,
        status: 'COMPLETED'
      },
      select: {
        user: {
          select: { tenantId: true }
        }
      }
    }),
    prisma.ideaBankReservation.findMany({
      where: {
        reservedAt: dateRange
      },
      select: {
        user: {
          select: { tenantId: true }
        }
      }
    })
  ])

  const priceMap = new Map<string, { input: number; output: number }>()
  for (const p of modelPrices) {
    priceMap.set(p.modelClass, {
      input: p.inputPricePerMTokens,
      output: p.outputPricePerMTokens
    })
  }

  const tenantMap = new Map<
    string,
    {
      totalInputTokens: number
      totalOutputTokens: number
      totalApiCalls: number
      totalCost: number
      patentDrafts: number
      noveltySearches: number
      ideasReserved: number
    }
  >()

  const global: GlobalUsageSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalApiCalls: 0,
    totalCost: 0,
    totalPatentsDrafted: 0,
    totalNoveltySearches: 0,
    totalIdeasReserved: 0
  }

  // Token + cost aggregation from usage logs
  for (const log of usageLogs) {
    const tId = log.tenantId || 'no-tenant'
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!

    const input = log.inputTokens || 0
    const output = log.outputTokens || 0
    const calls = log.apiCalls || 0
    const cost = calculateCostForLog(log, priceMap)

    bucket.totalInputTokens += input
    bucket.totalOutputTokens += output
    bucket.totalApiCalls += calls
    bucket.totalCost += cost

    global.totalInputTokens += input
    global.totalOutputTokens += output
    global.totalApiCalls += calls
    global.totalCost += cost
  }

  // Drafting sessions per tenant (patent drafts)
  for (const row of draftsByTenant) {
    const tId = row.tenantId || 'no-tenant'
    if (tenantFilterId && tId !== tenantFilterId) continue
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!
    bucket.patentDrafts += row._count._all
    global.totalPatentsDrafted += row._count._all
  }

  // Novelty searches per tenant (via user.tenantId)
  for (const run of noveltyRuns) {
    const tId = run.user?.tenantId || 'no-tenant'
    if (tenantFilterId && tId !== tenantFilterId) continue
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!
    bucket.noveltySearches += 1
    global.totalNoveltySearches += 1
  }

  // Idea reservations per tenant (via user.tenantId)
  for (const res of reservations) {
    const tId = res.user?.tenantId || 'no-tenant'
    if (tenantFilterId && tId !== tenantFilterId) continue
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!
    bucket.ideasReserved += 1
    global.totalIdeasReserved += 1
  }

  const tenantIds = Array.from(tenantMap.keys()).filter(id => id !== 'no-tenant')
  const tenantRecords = tenantIds.length
    ? await prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true, type: true }
      })
    : []

  const tenantMeta = new Map<string, { name: string | null; type: string | null }>()
  for (const t of tenantRecords) {
    tenantMeta.set(t.id, { name: t.name, type: t.type })
  }

  const tenants: TenantUsageMetrics[] = Array.from(tenantMap.entries()).map(([id, metrics]) => {
    const meta = tenantMeta.get(id)
    const isNoTenant = id === 'no-tenant'
    return {
      tenantId: isNoTenant ? null : id,
      tenantName: isNoTenant ? 'No tenant' : (meta?.name ?? 'Unknown tenant'),
      tenantType: isNoTenant ? null : (meta?.type ?? null),
      totalInputTokens: metrics.totalInputTokens,
      totalOutputTokens: metrics.totalOutputTokens,
      totalApiCalls: metrics.totalApiCalls,
      totalCost: metrics.totalCost,
      patentDrafts: metrics.patentDrafts,
      noveltySearches: metrics.noveltySearches,
      ideasReserved: metrics.ideasReserved
    }
  })

  return {
    startDate: normalizedStart,
    endDate: normalizedEnd,
    global,
    tenants
  }
}
