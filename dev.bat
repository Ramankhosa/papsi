@echo off
REM DEVELOPMENT ONLY: Handle SSL certificate issues for external API calls
REM This allows making HTTPS requests to APIs with certificate issues (proxies, etc.)
REM Does NOT affect the SSL certificate your Next.js app serves
REM WARNING: NEVER use this in production!
echo ⚠️  WARNING: SSL certificate validation disabled for development API calls
echo    This affects OUTBOUND requests only - your app can still serve HTTPS normally
echo    NEVER use this in production environments!
set NODE_TLS_REJECT_UNAUTHORIZED=0
npm run dev
