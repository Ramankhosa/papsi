import { prisma } from './prisma'

export interface CountryProfile {
  id: string
  countryCode: string
  name: string
  profileData: any
  version: number
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT'
  createdAt: string
  updatedAt: string
}

// Cache for active country profiles
let countryProfileCache: Map<string, CountryProfile> | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/**
 * Get active country profiles, using cache when possible
 */
export async function getActiveCountryProfiles(): Promise<Map<string, CountryProfile>> {
  const now = Date.now()

  // Return cached data if still valid
  if (countryProfileCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return countryProfileCache
  }

  try {
    const profiles = await prisma.countryProfile.findMany({
      where: { status: 'ACTIVE' }
    })

    // Create new cache
    countryProfileCache = new Map()
    profiles.forEach(profile => {
      countryProfileCache!.set(profile.countryCode, {
        id: profile.id,
        countryCode: profile.countryCode,
        name: profile.name,
        profileData: profile.profileData,
        version: profile.version,
        status: profile.status,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString()
      })
    })

    cacheTimestamp = now
    return countryProfileCache
  } catch (error) {
    console.error('Error fetching country profiles:', error)
    // Return empty map on error, don't break the application
    return new Map()
  }
}

/**
 * Get a specific country profile by code
 */
export async function getCountryProfile(countryCode: string): Promise<CountryProfile | null> {
  const profiles = await getActiveCountryProfiles()
  return profiles.get(countryCode.toUpperCase()) || null
}

/**
 * Check if a country code is supported (has an active profile)
 */
export async function isCountrySupported(countryCode: string): Promise<boolean> {
  const profile = await getCountryProfile(countryCode)
  return profile !== null
}

/**
 * Get supported country codes
 */
export async function getSupportedCountryCodes(): Promise<string[]> {
  const profiles = await getActiveCountryProfiles()
  return Array.from(profiles.keys())
}

/**
 * Get country profile metadata (without full profile data)
 */
export async function getCountryProfileMetadata(countryCode: string): Promise<{
  code: string
  name: string
  continent: string
  office: string
  languages: string[]
  applicationTypes: string[]
} | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  const meta = profile.profileData.meta
  return {
    code: profile.countryCode,
    name: profile.name,
    continent: meta.continent || 'Unknown',
    office: meta.office || 'Unknown',
    languages: meta.languages || [],
    applicationTypes: meta.applicationTypes || []
  }
}

/**
 * Invalidate the cache (useful after profile updates)
 */
export function invalidateCountryProfileCache(): void {
  countryProfileCache = null
  cacheTimestamp = 0
}

/**
 * Get validation rules for a specific country and section
 */
export async function getValidationRules(countryCode: string, sectionId: string): Promise<any[] | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  return profile.profileData.validation?.sectionChecks?.[sectionId] || []
}

/**
 * Get drafting prompts for a specific country and section
 */
export async function getDraftingPrompts(countryCode: string, sectionId: string): Promise<{
  instruction: string
  constraints: string[]
} | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  return profile.profileData.prompts?.sections?.[sectionId] || null
}

/**
 * Get export configuration for a specific country
 */
export async function getExportConfig(countryCode: string): Promise<any | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  return profile.profileData.export || null
}

/**
 * Get base style configuration for a specific country
 */
export async function getBaseStyle(countryCode: string): Promise<any | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  return profile.profileData.prompts?.baseStyle || null
}

/**
 * Get global rules for a specific country
 */
export async function getGlobalRules(countryCode: string): Promise<any | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  return profile.profileData.rules?.global || null
}

/**
 * Get section-specific rules for a specific country
 */
export async function getSectionRules(countryCode: string, sectionType: string): Promise<any | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  const rules = profile.profileData.rules || {}

  // Helper to normalize keys for flexible lookup (handles underscores/casing)
  const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = normalize(sectionType)

  // Direct hit first
  if (rules[sectionType]) return rules[sectionType]

  // Known aliases between profile section ids and rule block ids
  const aliasMap: Record<string, string[]> = {
    detaileddescription: ['description'],
    briefdescriptionofdrawings: ['drawings'],
    fieldofinvention: ['field', 'technicalfield'],
    industrialapplicability: ['utility'],
    crossreference: ['cross_reference', 'crossreference'],
    background: ['backgroundofinvention', 'descriptionbackground']
  }
  const aliasKeys = aliasMap[target] || []

  // Try alias keys
  for (const alias of aliasKeys) {
    if (rules[alias]) return rules[alias]
  }

  // Try normalized match across all rule keys
  for (const [key, value] of Object.entries(rules)) {
    if (normalize(key) === target) return value
  }

  return null
}

/**
 * Get sequence listing rules for a specific country
 */
export async function getSequenceListingRules(countryCode: string): Promise<any | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  return profile.profileData.rules?.sequenceListing || null
}

/**
 * Get page layout rules for a specific country
 */
export async function getPageLayoutRules(countryCode: string): Promise<any | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  return profile.profileData.rules?.pageLayout || null
}

/**
 * Get designated states rules for a specific country
 */
export async function getDesignatedStatesRules(countryCode: string): Promise<any | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  return profile.profileData.rules?.designatedStates || null
}

/**
 * Get document type configuration with margin fallbacks for a specific country and document type
 */
export async function getDocumentTypeConfig(countryCode: string, documentTypeId: string): Promise<{
  documentType: any | null
  margins: {
    top: number
    bottom: number
    left: number
    right: number
  }
  pageSize: string
} | null> {
  const profile = await getCountryProfile(countryCode)
  if (!profile) return null

  const exportConfig = profile.profileData.export
  if (!exportConfig?.documentTypes) return null

  const documentType = exportConfig.documentTypes.find((dt: any) => dt.id === documentTypeId)
  if (!documentType) return null

  // Get page layout rules for fallbacks
  const pageLayout = await getPageLayoutRules(countryCode)

  // Use document type margins if available, otherwise fall back to pageLayout minimums
  const margins = {
    top: documentType.marginTopCm ?? pageLayout?.minMarginTopCm ?? 2.5,
    bottom: documentType.marginBottomCm ?? pageLayout?.minMarginBottomCm ?? 1.0,
    left: documentType.marginLeftCm ?? pageLayout?.minMarginLeftCm ?? 2.5,
    right: documentType.marginRightCm ?? pageLayout?.minMarginRightCm ?? 1.5
  }

  // Use document type pageSize if available, otherwise fall back to pageLayout default
  const pageSize = documentType.pageSize || pageLayout?.defaultPageSize || 'A4'

  return {
    documentType,
    margins,
    pageSize
  }
}
