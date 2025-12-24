import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getActiveCountryProfiles } from '@/lib/country-profile-service'

export async function GET(request: NextRequest) {
  try {
    console.log('[CountryProfiles] API called')
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      console.log('[CountryProfiles] Auth failed:', authResult.error)
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    console.log('[CountryProfiles] Auth successful for user:', authResult.user.id)
    const profiles = await getActiveCountryProfiles()
    console.log('[CountryProfiles] Found profiles:', profiles.size)

    const countries = Array.from(profiles.values()).map(profile => {
      const meta = profile.profileData?.meta || {}
      return {
        code: profile.countryCode,
        name: profile.name,
        continent: meta.continent || 'Unknown',
        office: meta.office || 'Patent Office',
        languages: meta.languages || [],
        applicationTypes: meta.applicationTypes || [],
        updatedAt: profile.updatedAt
      }
    })

    console.log('[CountryProfiles] Returning countries:', countries.length)
    return NextResponse.json({ countries })
  } catch (error) {
    console.error('[CountryProfiles] Failed to fetch active country profiles', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
