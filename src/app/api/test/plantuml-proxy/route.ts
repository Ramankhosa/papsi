import { NextRequest, NextResponse } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import crypto from 'crypto'
import plantumlEncoder from 'plantuml-encoder'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, format = 'svg', figureNo, patentId, sessionId } = body || {}
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }
    if (format !== 'svg' && format !== 'png') {
      return NextResponse.json({ error: 'format must be svg or png' }, { status: 400 })
    }

    // Minimal sanitization similar to server: remove captions/titles, forbidden directives, and entire skinparam blocks
    let cleaned = code
      .replace(/^title.*$/gmi, '')
      .replace(/^\s*!\s*(theme|include|import|pragma).*$/gmi, '')
    // Remove multi-line skinparam blocks like: skinparam X { ... }
    cleaned = cleaned.replace(/skinparam\b[^\n{]*\{[\s\S]*?\}/gmi, '')
    // Remove any remaining single-line skinparam statements
    cleaned = cleaned.replace(/^\s*skinparam\b.*$/gmi, '')
    // Drop obviously incomplete connection lines like "500 --"
    cleaned = cleaned
      .split(/\r?\n/)
      .filter(line => !/^\s*\d+\s*--\s*$/.test(line))
      .join('\n')

    const encoded = plantumlEncoder.encode(cleaned)
    const base = process.env.PLANTUML_BASE_URL || 'https://www.plantuml.com/plantuml'
    const url = `${base}/${format}/${encoded}`

    const resp = await fetch(url, { cache: 'no-store', method: 'GET', headers: { 'Accept': format === 'svg' ? 'image/svg+xml' : 'image/png' } })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      const snippet = cleaned.slice(0, 400)
      console.warn('[PlantUML proxy] Upstream render failed', {
        upstreamStatus: resp.status,
        format,
        figureNo,
        patentId,
        sessionId,
        snippet
      })
      return NextResponse.json(
        { error: 'Upstream render failed', upstreamStatus: resp.status, details: text?.slice(0, 300) },
        { status: 502 }
      )
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    const checksum = crypto.createHash('sha256').update(buf).digest('hex')

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': format === 'svg' ? 'image/svg+xml' : 'image/png',
        'Cache-Control': 'private, max-age=0',
        'X-Checksum': checksum
      }
    })
  } catch (e) {
    console.warn('[PlantUML proxy] Bad request', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}
