// Simple test for PQAI functionality in stage 1
const { NoveltySearchService } = require('./src/lib/novelty-search-service.ts');

// This won't work directly since it's TypeScript, but let's create a simpler test
console.log('Testing PQAI integration...');

// Test the PQAI search function directly
async function testPQAI() {
  const service = new NoveltySearchService();

  try {
    console.log('Calling PQAI search...');
    const results = await service.searchPQAI('drone navigation system', 5);
    console.log('✅ PQAI search successful!');
    console.log('Results count:', results.length);

    if (results.length > 0) {
      console.log('First result:', JSON.stringify(results[0], null, 2));
    }
  } catch (error) {
    console.log('❌ PQAI search failed:', error.message);
  }
}

testPQAI();










