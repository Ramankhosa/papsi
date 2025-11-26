import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { countryCode: string } }) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    const code = (params.countryCode || '').toUpperCase()
    if (!code) {
      return NextResponse.json({ error: 'countryCode required' }, { status: 400 })
    }

    const profile = await prisma.countryProfile.findFirst({
      where: { countryCode: code, status: 'ACTIVE' as any }
    })

    if (!profile) {
      return NextResponse.json({ error: 'Country profile not found' }, { status: 404 })
    }

    // Return only the data needed for drafting UI (structure/prompts/rules/meta)
    const profileData = profile.profileData as any
    const payload = {
      code: profile.countryCode,
      name: profile.name,
      meta: profileData?.meta || {},
      structure: profileData?.structure || null,
      prompts: profileData?.prompts || null,
      rules: profileData?.rules || null,
      export: profileData?.export || null
    }

    return NextResponse.json({ profile: payload })
  } catch (error) {
    console.error('[CountryProfile:getByCode] error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
