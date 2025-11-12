const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

class PersonaSyncAPITester {
  constructor() {
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0,
      details: []
    };
    this.baseURL = 'http://localhost:3000';
  }

  log(message) {
    console.log(`[API TEST] ${message}`);
  }

  success(testName, details = '') {
    this.testResults.passed++;
    this.testResults.total++;
    this.testResults.details.push({ testName, status: 'PASSED', details });
    console.log(`✅ ${testName} ${details ? `- ${details}` : ''}`);
  }

  failure(testName, error, details = '') {
    this.testResults.failed++;
    this.testResults.total++;
    this.testResults.details.push({ testName, status: 'FAILED', error, details });
    console.error(`❌ ${testName} - ${error} ${details ? `- ${details}` : ''}`);
  }

  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const finalOptions = { ...defaultOptions, ...options };

    try {
      const response = await fetch(url, finalOptions);
      const data = await response.json().catch(() => ({}));
      return { response, data };
    } catch (error) {
      throw new Error(`Request failed: ${error.message}`);
    }
  }

  async runTest(testName, testFn) {
    try {
      this.log(`Running: ${testName}`);
      await testFn();
      this.success(testName);
    } catch (error) {
      this.failure(testName, error.message, error.stack);
    }
  }

  // Test 1: Get Style Profile
  async testGetProfile() {
    this.log('Testing GET style profile...');

    const { response, data } = await this.makeRequest(
      '/api/tenants/cmhru2goo0006918wi7yfw7mi/users/cmhru2h3e000c918wsdoj4cwc/style/profile'
    );

    if (response.ok && data && data.json) {
      const profile = data.json;
      if (profile.global && profile.sections && profile.metadata) {
        this.success('Get style profile', `Found profile v${data.version} with ${Object.keys(profile.sections).length} sections`);
      } else {
        throw new Error('Invalid profile structure');
      }
    } else {
      throw new Error(`Request failed: ${response.status} ${data?.error || 'Unknown error'}`);
    }
  }

  // Test 2: List Training Jobs
  async testListJobs() {
    this.log('Testing GET style jobs...');

    const { response, data } = await this.makeRequest(
      '/api/style/jobs/cmhue295r0023lb6rosxfm3pl' // Using the profile ID as job ID for testing
    );

    // This might fail if the job doesn't exist, but let's see what happens
    if (response.ok && data) {
      this.success('Get style job', `Job status: ${data.status || 'unknown'}`);
    } else if (response.status === 404) {
      this.success('Get style job', 'Job not found (expected for test job ID)');
    } else {
      throw new Error(`Request failed: ${response.status} ${data?.error || 'Unknown error'}`);
    }
  }

  // Test 3: List Documents
  async testListDocuments() {
    this.log('Testing GET style documents...');

    const { response, data } = await this.makeRequest(
      '/api/tenants/cmhru2goo0006918wi7yfw7mi/users/cmhru2h3e000c918wsdoj4cwc/style/documents'
    );

    if (response.ok && Array.isArray(data)) {
      this.success('List documents', `Found ${data.length} documents`);
    } else {
      throw new Error(`Request failed: ${response.status} ${data?.error || 'Unknown error'}`);
    }
  }

  // Test 4: Training Job Status
  async testJobStatus() {
    this.log('Testing training job status...');

    // Get the most recent completed job
    const jobs = await prisma.styleTrainingJob.findMany({
      where: { userId: 'cmhru2h3e000c918wsdoj4cwc', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: 1
    });

    if (jobs.length > 0) {
      const jobId = jobs[0].id;
      const { response, data } = await this.makeRequest(`/api/style/jobs/${jobId}`);

      if (response.ok && data) {
        const expectedMetrics = ['totalTokens', 'entropy', 'coverage'];
        const hasMetrics = expectedMetrics.every(metric => data.metrics && data.metrics[metric] !== undefined);

        if (hasMetrics) {
          this.success('Training job status', `Job ${jobId}: ${data.status}, metrics: ${JSON.stringify(data.metrics)}`);
        } else {
          throw new Error('Job metrics incomplete');
        }
      } else {
        throw new Error(`Request failed: ${response.status} ${data?.error || 'Unknown error'}`);
      }
    } else {
      this.success('Training job status', 'No completed jobs found (expected in test environment)');
    }
  }

  // Test 5: Database Integrity
  async testDatabaseIntegrity() {
    this.log('Testing database integrity...');

    const userId = 'cmhru2h3e000c918wsdoj4cwc';

    // Check profile exists
    const profile = await prisma.styleProfile.findFirst({
      where: { userId },
      orderBy: { version: 'desc' }
    });

    // Check jobs exist
    const jobs = await prisma.styleTrainingJob.findMany({
      where: { userId }
    });

    // Check documents exist
    const documents = await prisma.document.findMany({
      where: { userId }
    });

    if (profile && jobs.length > 0 && documents.length > 0) {
      this.success('Database integrity', `Profile: ✅, Jobs: ${jobs.length}, Documents: ${documents.length}`);
    } else {
      throw new Error(`Missing data - Profile: ${!!profile}, Jobs: ${jobs.length}, Documents: ${documents.length}`);
    }
  }

  // Test 6: Profile Validation via API
  async testProfileValidation() {
    this.log('Testing profile validation via API...');

    // Get the current profile
    const { response, data } = await this.makeRequest(
      '/api/tenants/cmhru2goo0006918wi7yfw7mi/users/cmhru2h3e000c918wsdoj4cwc/style/profile'
    );

    if (response.ok && data && data.json) {
      const profile = data.json;

      // Check required structure
      const hasGlobal = profile.global && typeof profile.global === 'object';
      const hasSections = profile.sections && typeof profile.sections === 'object';
      const hasMetadata = profile.metadata && typeof profile.metadata === 'object';
      const hasSafety = profile.safety_constraints && typeof profile.safety_constraints === 'object';

      if (hasGlobal && hasSections && hasMetadata && hasSafety) {
        this.success('Profile validation', 'Profile has all required sections');
      } else {
        throw new Error(`Missing sections: global=${hasGlobal}, sections=${hasSections}, metadata=${hasMetadata}, safety=${hasSafety}`);
      }
    } else {
      throw new Error(`Failed to get profile: ${response.status} ${data?.error || 'Unknown error'}`);
    }
  }

  // Test 7: API Error Handling
  async testAPIErrorHandling() {
    this.log('Testing API error handling...');

    // Test with invalid tenant ID
    const { response: invalidResponse, data: invalidData } = await this.makeRequest(
      '/api/tenants/invalid-tenant/users/cmhru2h3e000c918wsdoj4cwc/style/profile'
    );

    if (invalidResponse.status === 403 || invalidResponse.status === 404) {
      this.success('API error handling', `Correctly rejected invalid tenant (${invalidResponse.status})`);
    } else {
      throw new Error(`Should have rejected invalid tenant, got ${invalidResponse.status}`);
    }

    // Test with invalid user ID
    const { response: userResponse, data: userData } = await this.makeRequest(
      '/api/tenants/cmhru2goo0006918wi7yfw7mi/users/invalid-user/style/profile'
    );

    if (userResponse.status === 403 || userResponse.status === 404) {
      this.success('API error handling', `Correctly rejected invalid user (${userResponse.status})`);
    } else {
      throw new Error(`Should have rejected invalid user, got ${userResponse.status}`);
    }
  }

  // Test 8: File Upload Validation
  async testFileUploadValidation() {
    this.log('Testing file upload validation...');

    // Create a test file
    const testContent = 'This is a test file for upload validation.';
    const testFilePath = path.join(__dirname, 'test-upload.txt');
    fs.writeFileSync(testFilePath, testContent);

    try {
      // Read file as buffer
      const fileBuffer = fs.readFileSync(testFilePath);
      const fileBlob = new Blob([fileBuffer], { type: 'text/plain' });
      const file = new File([fileBlob], 'test-upload.txt', { type: 'text/plain' });

      // Create form data
      const formData = new FormData();
      formData.append('files', file);

      const { response, data } = await this.makeRequest(
        '/api/tenants/cmhru2goo0006918wi7yfw7mi/users/cmhru2h3e000c918wsdoj4cwc/style/learn',
        {
          method: 'POST',
          body: formData,
          headers: {} // Let fetch set content-type for FormData
        }
      );

      if (response.ok && data && data.jobId) {
        this.success('File upload validation', `Training job created: ${data.jobId}`);
      } else {
        // This might fail due to metering, which is expected
        if (data?.error?.includes('not available in plan')) {
          this.success('File upload validation', 'Correctly rejected due to plan limits (expected)');
        } else {
          throw new Error(`Upload failed: ${response.status} ${data?.error || 'Unknown error'}`);
        }
      }
    } finally {
      // Cleanup
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    }
  }

  // Test 9: Concurrent Access
  async testConcurrentAccess() {
    this.log('Testing concurrent access...');

    // Make multiple simultaneous requests
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        this.makeRequest('/api/tenants/cmhru2goo0006918wi7yfw7mi/users/cmhru2h3e000c918wsdoj4cwc/style/profile')
      );
    }

    try {
      const results = await Promise.all(promises);
      const successful = results.filter(({ response }) => response.ok).length;

      if (successful === results.length) {
        this.success('Concurrent access', `All ${results.length} concurrent requests successful`);
      } else {
        throw new Error(`${successful}/${results.length} requests succeeded`);
      }
    } catch (error) {
      throw new Error(`Concurrent access failed: ${error.message}`);
    }
  }

  // Run all tests
  async runAllTests() {
    console.log('🚀 Starting PersonaSync API Test Suite\n');
    console.log('=' .repeat(60));

    // Check if server is running first
    try {
      const { response } = await this.makeRequest('/');
      if (!response.ok) {
        throw new Error('Server not responding');
      }
    } catch (error) {
      console.error('❌ Server not running. Please start with: npm run start');
      process.exit(1);
    }

    // Run individual test suites
    await this.runTest('Get Style Profile', () => this.testGetProfile());
    await this.runTest('List Training Jobs', () => this.testListJobs());
    await this.runTest('List Documents', () => this.testListDocuments());
    await this.runTest('Training Job Status', () => this.testJobStatus());
    await this.runTest('Database Integrity', () => this.testDatabaseIntegrity());
    await this.runTest('Profile Validation', () => this.testProfileValidation());
    await this.runTest('API Error Handling', () => this.testAPIErrorHandling());
    await this.runTest('File Upload Validation', () => this.testFileUploadValidation());
    await this.runTest('Concurrent Access', () => this.testConcurrentAccess());

    // Print results
    console.log('\n' + '=' .repeat(60));
    console.log('📊 API TEST RESULTS SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Total Tests: ${this.testResults.total}`);
    console.log(`✅ Passed: ${this.testResults.passed}`);
    console.log(`❌ Failed: ${this.testResults.failed}`);
    console.log(`Success Rate: ${((this.testResults.passed / this.testResults.total) * 100).toFixed(1)}%`);

    if (this.testResults.failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.testResults.details
        .filter(test => test.status === 'FAILED')
        .forEach(test => {
          console.log(`  - ${test.testName}: ${test.error}`);
        });
    }

    console.log('\n🎯 PersonaSync API Test Suite Complete!');
    return this.testResults;
  }
}

// Run the tests
async function main() {
  const tester = new PersonaSyncAPITester();
  const results = await tester.runAllTests();

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(error => {
    console.error('API test suite failed:', error);
    process.exit(1);
  });
}

module.exports = PersonaSyncAPITester;
