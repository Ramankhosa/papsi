# PQAI API Setup Instructions

## The Issue
The novelty search is failing because the PQAI API token is not configured.

## Solution
1. Get a PQAI API token from: https://projectpq.ai/
2. Create a `.env.local` file in the project root
3. Add your PQAI token:

```bash
# Create .env.local file
PQAI_API_TOKEN=your_actual_pqai_token_here
```

## Testing
Once you've added the token, test it with:
```bash
node test-pqai.js
```

You should see a 200 status code and patent results instead of 401 Unauthorized.

## What This Fixes
- Stage 1 of novelty search will be able to fetch patent results from PQAI
- The "No PQAI results available for feature mapping" error will be resolved
- Patent search functionality will work properly










