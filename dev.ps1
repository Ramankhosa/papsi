# DEVELOPMENT ONLY: Handle SSL certificate issues for external API calls
# This allows making HTTPS requests to APIs with certificate issues (proxies, etc.)
# Does NOT affect the SSL certificate your Next.js app serves
# WARNING: NEVER use this in production!
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
Write-Host "⚠️  WARNING: SSL certificate validation disabled for development API calls"
Write-Host "   This affects OUTBOUND requests only - your app can still serve HTTPS normally"
Write-Host "   NEVER use this in production environments!"
npm run dev
