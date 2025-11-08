// Test the full novelty assessment PQAI flow
const fetch = require('node-fetch');

async function testNoveltyPQAI() {
  const baseUrl = 'http://localhost:3003';

  try {
    console.log('🧪 Testing Novelty Assessment PQAI Flow...\n');

    // Step 1: Create a novelty search
    console.log('1️⃣ Creating novelty search...');
    const createResponse = await fetch(`${baseUrl}/api/novelty-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // For testing, we'll assume authentication works
      },
      body: JSON.stringify({
        title: 'Test Drone Navigation',
        inventionDescription: 'A system for autonomous drone navigation using AI',
        jurisdiction: 'US',
        config: {
          jurisdiction: 'US',
          stage4: {
            reportFormat: 'PDF',
            includeExecutiveSummary: true,
            includeTechnicalDetails: true,
            colorCoding: true,
            modelPreference: 'gemini-2.0-flash-lite'
          }
        }
      })
    });

    if (!createResponse.ok) {
      console.log('❌ Failed to create novelty search');
      const error = await createResponse.text();
      console.log('Error:', error);
      return;
    }

    const createData = await createResponse.json();
    console.log('✅ Novelty search created:', createData.searchId);

    const searchId = createData.searchId;

    // Step 2: Execute Stage 1 (PQAI Search)
    console.log('\n2️⃣ Executing Stage 1 (PQAI Search)...');
    const stage1Response = await fetch(`${baseUrl}/api/novelty-search/${searchId}/stage/1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Authentication headers would go here
      }
    });

    console.log('Stage 1 Response Status:', stage1Response.status);

    if (!stage1Response.ok) {
      console.log('❌ Stage 1 execution failed');
      const error = await stage1Response.text();
      console.log('Error:', error);
      return;
    }

    const stage1Data = await stage1Response.json();
    console.log('✅ Stage 1 completed');
    console.log('Response data keys:', Object.keys(stage1Data));
    console.log('Status:', stage1Data.status);
    console.log('Current Stage:', stage1Data.currentStage);

    // Step 3: Check if PQAI results are included in response
    if (stage1Data.results && stage1Data.results.pqaiResults) {
      console.log('\n3️⃣ PQAI Results received:');
      console.log('Number of results:', stage1Data.results.pqaiResults.length);

      if (stage1Data.results.pqaiResults.length > 0) {
        console.log('✅ PQAI search successful!');
        console.log('Sample result:');
        console.log(JSON.stringify(stage1Data.results.pqaiResults[0], null, 2));
      } else {
        console.log('⚠️  PQAI returned 0 results');
      }
    } else {
      console.log('❌ No PQAI results in response');
      console.log('Results structure:', JSON.stringify(stage1Data.results, null, 2));
    }

    // Step 4: Fetch search status to verify data is stored
    console.log('\n4️⃣ Verifying data storage...');
    const statusResponse = await fetch(`${baseUrl}/api/novelty-search/${searchId}`, {
      headers: {
        // Authentication headers would go here
      }
    });

    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      console.log('✅ Search status fetched');

      if (statusData.search.results?.stage1?.pqaiResults) {
        console.log('✅ PQAI results stored in database');
        console.log('Stored results count:', statusData.search.results.stage1.pqaiResults.length);
      } else {
        console.log('❌ PQAI results not found in stored data');
      }
    } else {
      console.log('❌ Failed to fetch search status');
    }

    console.log('\n🎯 Test completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

testNoveltyPQAI();





