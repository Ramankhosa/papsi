import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getActiveCountryProfiles } from '@/lib/country-profile-service'

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    const profiles = await getActiveCountryProfiles()
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

    return NextResponse.json({ countries })
  } catch (error) {
    console.error('[CountryProfiles] Failed to fetch active country profiles', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
