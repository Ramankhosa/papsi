import { getAppOrigin } from './oauth-config';

export const mendeleyOAuthConfig = {
  clientId: process.env.MENDELEY_CLIENT_ID || '',
  clientSecret: process.env.MENDELEY_CLIENT_SECRET || '',
  authorizationUrl: 'https://api.mendeley.com/oauth/authorize',
  tokenUrl: 'https://api.mendeley.com/oauth/token',
  profileUrl: 'https://api.mendeley.com/profiles/me',
  redirectPath: '/api/library/oauth/mendeley/callback',
  scope: 'all',
};

export function isMendeleyConfigured(): boolean {
  return !!(mendeleyOAuthConfig.clientId && mendeleyOAuthConfig.clientSecret);
}

export function getMendeleyRedirectUri(requestOrigin?: string): string {
  if (process.env.MENDELEY_REDIRECT_URI) {
    return process.env.MENDELEY_REDIRECT_URI;
  }
  const origin = getAppOrigin(requestOrigin);
  return new URL(mendeleyOAuthConfig.redirectPath, origin).toString();
}

export function getMendeleyAuthUrl(state: string, requestOrigin?: string): string {
  const redirectUri = getMendeleyRedirectUri(requestOrigin);
  const params = new URLSearchParams({
    client_id: mendeleyOAuthConfig.clientId,
    redirect_uri: redirectUri,
    scope: mendeleyOAuthConfig.scope,
    response_type: 'code',
    state,
  });
  return `${mendeleyOAuthConfig.authorizationUrl}?${params.toString()}`;
}

export async function exchangeMendeleyCode(
  code: string,
  requestOrigin?: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const redirectUri = getMendeleyRedirectUri(requestOrigin);

  const response = await fetch(mendeleyOAuthConfig.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: mendeleyOAuthConfig.clientId,
      client_secret: mendeleyOAuthConfig.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Mendeley token exchange failed (${response.status}): ${text}`);
  }

  return response.json();
}

export async function refreshMendeleyToken(
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const response = await fetch(mendeleyOAuthConfig.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: mendeleyOAuthConfig.clientId,
      client_secret: mendeleyOAuthConfig.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Mendeley token refresh failed (${response.status}): ${text}`);
  }

  return response.json();
}

export async function fetchMendeleyProfile(
  accessToken: string
): Promise<{ displayName: string; email?: string } | null> {
  try {
    const response = await fetch(mendeleyOAuthConfig.profileUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const profile = await response.json();
    const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.display_name || 'Mendeley User';
    return { displayName, email: profile.email || undefined };
  } catch {
    return null;
  }
}
