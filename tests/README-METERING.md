# LLM Metering System - Comprehensive Testing Suite

This directory contains an exhaustive testing suite for the LLM metering system, designed to validate all aspects of request validation, token counting, and bypass prevention in the SpotIPR platform.

## Overview

The metering system is critical for:
- **Security**: Preventing unauthorized LLM access
- **Billing**: Accurate token counting and cost calculation
- **Compliance**: Enforcing plan-based access controls
- **Monitoring**: Tracking usage across users, tenants, and plans

## Test Coverage

### 1. Plan-Based Model Access Control
- ✅ Users can only access models permitted by their plan
- ✅ Super admin controls are enforced at all levels
- ✅ Model class restrictions work correctly
- ✅ Stage-specific and task-specific model configurations

### 2. Token Counting Accuracy
- ✅ Input token estimation and validation
- ✅ Output token recording from providers
- ✅ Multimodal content token counting
- ✅ Provider-reported token consistency

### 3. Multi-Level Usage Tracking
- ✅ User-level usage tracking
- ✅ Tenant-level aggregation
- ✅ Plan-level quota enforcement
- ✅ Daily and monthly limits

### 4. Super Admin Bypass Prevention
- ✅ Direct API access is blocked
- ✅ Token manipulation is detected
- ✅ Plan spoofing is prevented
- ✅ Unauthorized model access is blocked

### 5. Provider Routing & Failover
- ✅ Correct provider selection by model
- ✅ Automatic fallback on provider failure
- ✅ Model resolution priority (stage > task > plan > system)
- ✅ Fallback chain limits to prevent infinite loops

### 6. Quota Enforcement
- ✅ Daily and monthly limits
- ✅ Real-time quota checking
- ✅ Graceful quota exceeded handling
- ✅ Quota reset scheduling

### 7. Security & Edge Cases
- ✅ Malformed request handling
- ✅ Token count manipulation prevention
- ✅ Concurrent request race conditions
- ✅ Session expiration handling

## Test Structure

```
tests/
├── unit/metering/
│   └── llm-metering-validation.test.ts     # Core validation logic
├── integration/metering/
│   └── llm-metering-integration.test.ts    # Database & API integration
├── e2e/metering/
│   └── llm-metering-e2e.spec.ts            # Full user journey testing
├── run-metering-tests.js                   # Test runner script
└── README-METERING.md                      # This file
```

## Running the Tests

### Prerequisites

1. **Environment Setup**:
   ```bash
   # Copy environment variables
   cp .env.example .env.test

   # Configure test database
   export DATABASE_URL="postgresql://test:test@localhost:5432/spotipr_test"

   # Set API keys for providers (use test/sandbox keys)
   export OPENAI_API_KEY="sk-test-..."
   export ANTHROPIC_API_KEY="sk-ant-test-..."
   export GOOGLE_AI_API_KEY="test-key"
   ```

2. **Database Setup**:
   ```bash
   # Create test database
   npm run db:test:create

   # Run migrations
   npm run db:test:migrate

   # Seed test data
   npm run db:test:seed
   ```

### Running Tests

#### All Metering Tests
```bash
# Run the comprehensive test suite
node tests/run-metering-tests.js

# Or using npm script
npm run test:metering
```

#### Individual Test Suites

```bash
# Unit tests only
npm run test:unit -- tests/unit/metering/

# Integration tests only
npm run test:integration -- tests/integration/metering/

# E2E tests only
npm run test:e2e -- tests/e2e/metering/

# With coverage
npm run test:coverage -- tests/**/metering/
```

#### Specific Test Categories

```bash
# Security and bypass tests
npm run test:security

# Performance and load tests
npm run test:performance

# Data integrity validation
npm run test:data-integrity

# Token counting validation
npm run test:token-validation
```

## Test Scenarios Covered

### Critical Security Tests

1. **Plan-Based Access Control**:
   - BASIC plan users cannot access GPT-4o
   - PRO plan users can access Claude-3.5-Sonnet
   - Model resolution respects stage/task/plan hierarchy

2. **Bypass Prevention**:
   - Direct provider API calls are blocked
   - JWT token tampering is detected
   - Model class spoofing is prevented
   - Unauthorized tenant access is blocked

3. **Token Manipulation**:
   - Under-reporting input tokens is detected
   - Provider token counts are validated
   - Usage meters are tamper-proof

### Functional Tests

1. **Request Flow**:
   - Tenant context extraction from JWT
   - Policy evaluation and quota checking
   - Model resolution and provider routing
   - Usage recording and aggregation

2. **Provider Integration**:
   - OpenAI GPT models routing
   - Anthropic Claude routing
   - Google Gemini routing
   - Fallback chain execution

3. **Quota Management**:
   - Daily quota enforcement
   - Monthly quota enforcement
   - Real-time quota checking
   - Quota reset timing

### Performance Tests

1. **Load Testing**:
   - 100 concurrent requests handling
   - Memory leak prevention
   - Database connection pooling
   - Response time validation

2. **Stress Testing**:
   - Provider API failure simulation
   - Network timeout handling
   - Database failover scenarios
   - High-frequency request bursts

## Test Data Setup

### Test Tenants and Users

```javascript
// Test data structure
const testData = {
  tenants: [
    { name: 'Basic Tenant', plan: 'BASIC' },
    { name: 'Pro Tenant', plan: 'PRO' },
    { name: 'Enterprise Tenant', plan: 'ENTERPRISE' }
  ],
  users: [
    { email: 'basic@example.com', plan: 'BASIC' },
    { email: 'pro@example.com', plan: 'PRO' },
    { email: 'enterprise@example.com', plan: 'ENTERPRISE' }
  ]
}
```

### LLM Models Configuration

```javascript
const testModels = [
  {
    code: 'gpt-4o-mini',
    provider: 'openai',
    contextWindow: 128000,
    costPer1M: { input: 150, output: 600 },
    planAccess: ['BASIC', 'PRO', 'ENTERPRISE']
  },
  {
    code: 'claude-3.5-sonnet',
    provider: 'anthropic',
    contextWindow: 200000,
    costPer1M: { input: 300, output: 1500 },
    planAccess: ['PRO', 'ENTERPRISE']
  }
]
```

## Monitoring and Debugging

### Test Logs

```bash
# Enable verbose logging
DEBUG=metering:* npm run test:metering

# View test-specific logs
tail -f logs/test-metering.log
```

### Common Issues

1. **Provider API Keys**:
   - Use test/sandbox API keys
   - Check rate limits for test accounts
   - Verify key permissions

2. **Database Connection**:
   - Ensure test database is running
   - Check connection pooling settings
   - Verify migration status

3. **Environment Variables**:
   - All required API keys present
   - Database URL correct
   - JWT secrets configured

## Continuous Integration

### GitHub Actions Configuration

```yaml
name: LLM Metering Tests

on:
  push:
    paths:
      - 'src/lib/metering/**'
      - 'tests/**/metering/**'

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run db:test:setup
      - run: npm run test:metering
```

## Performance Benchmarks

### Expected Test Performance

- **Unit Tests**: < 30 seconds
- **Integration Tests**: < 2 minutes
- **E2E Tests**: < 5 minutes
- **Full Suite**: < 10 minutes

### Resource Requirements

- **Memory**: 2GB minimum
- **CPU**: 2 cores minimum
- **Storage**: 5GB for test database
- **Network**: Stable internet for API calls

## Troubleshooting

### Test Failures

1. **Quota Exceeded Errors**:
   ```bash
   # Reset test data
   npm run db:test:reset
   npm run db:test:seed
   ```

2. **Provider API Errors**:
   ```bash
   # Check API key validity
   curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models
   ```

3. **Database Connection Issues**:
   ```bash
   # Verify database connectivity
   psql $DATABASE_URL -c "SELECT 1"
   ```

### Debug Mode

```bash
# Run tests with debug output
DEBUG=metering:* npm run test:metering

# Run specific test with verbose output
npm run test:unit -- --verbose tests/unit/metering/llm-metering-validation.test.ts
```

## Security Validation Checklist

- [ ] Plan-based model access enforced
- [ ] Token counting accurate and tamper-proof
- [ ] Multi-tenant isolation maintained
- [ ] Super admin controls cannot be bypassed
- [ ] Provider routing is secure
- [ ] Quota enforcement is strict
- [ ] Concurrent access is safe
- [ ] Data integrity is maintained
- [ ] Session security is validated
- [ ] Error handling doesn't leak information

## Conclusion

This comprehensive test suite ensures that the LLM metering system is robust, secure, and accurate. Regular execution of these tests will catch regressions and security vulnerabilities early in the development cycle.

For questions or issues, contact the platform security team or create an issue in the project repository.
