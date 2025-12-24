// OAuth configuration for social login providers
export const oauthConfig = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/social/google/callback`,
    scope: ['openid', 'profile', 'email'],
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo'
  },
  facebook: {
    clientId: process.env.FACEBOOK_CLIENT_ID,
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    redirectUri: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/social/facebook/callback`,
    scope: ['email', 'public_profile'],
    authorizationUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/me?fields=id,name,email,first_name,last_name,picture'
  },
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/social/linkedin/callback`,
    // Using OpenID Connect scopes (Sign In with LinkedIn v2)
    scope: ['openid', 'profile', 'email'],
    authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    // Using OpenID Connect userinfo endpoint
    userInfoUrl: 'https://api.linkedin.com/v2/userinfo'
  },
  twitter: {
    clientId: process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET,
    redirectUri: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/social/twitter/callback`,
    scope: ['tweet.read', 'users.read', 'offline.access'],
    authorizationUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userInfoUrl: 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,verified,email'
  }
}

export type OAuthProvider = keyof typeof oauthConfig

// Validate OAuth configuration
export function validateOAuthConfig(provider: OAuthProvider): boolean {
  const config = oauthConfig[provider]
  return !!(config.clientId && config.clientSecret)
}

// Generate authorization URL for OAuth provider
export function getAuthorizationUrl(provider: OAuthProvider, state?: string): string {
  const config = oauthConfig[provider]
  const params = new URLSearchParams({
    client_id: config.clientId!,
    redirect_uri: config.redirectUri,
    scope: config.scope.join(' '),
    response_type: 'code',
    ...(state && { state })
  })

  return `${config.authorizationUrl}?${params.toString()}`
}
