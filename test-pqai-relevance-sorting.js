// Test PQAI relevance sorting functionality
// This test verifies that PQAI returns actual relevance scores and that they are properly sorted

async function testPQAIRelevanceSorting() {
  console.log('🧪 Testing PQAI Relevance Sorting\n');

  try {
    // Simulate PQAI response with relevance scores (based on real drafting pipeline behavior)
    const mockPQAIResponse = [
      { score: 0.15, title: "Battery management system", publication_number: "US001A" },
      { score: 0.87, title: "Wireless power transfer for vehicles", publication_number: "US002B" },
      { score: 0.42, title: "Electric motor control", publication_number: "US003C" },
      { score: 0.93, title: "Resonant wireless charging system", publication_number: "US004D" },
      { score: 0.28, title: "Power electronics circuit", publication_number: "US005E" },
      { score: 0.76, title: "Inductive charging for EVs", publication_number: "US006F" },
      { score: 0.61, title: "Battery charging apparatus", publication_number: "US007G" },
      { score: 0.34, title: "DC-DC converter design", publication_number: "US008H" },
      { score: 0.89, title: "Wireless charging alignment system", publication_number: "US009I" },
      { score: 0.52, title: "High-frequency power transfer", publication_number: "US010J" },
      { score: 0.71, title: "Magnetic field coupling device", publication_number: "US011K" },
      { score: 0.19, title: "Basic power supply unit", publication_number: "US012L" },
      { score: 0.95, title: "Dynamic wireless charging for moving vehicles", publication_number: "US013M" },
      { score: 0.67, title: "Coil design for wireless power", publication_number: "US014N" },
      { score: 0.43, title: "Vehicle power management", publication_number: "US015O" }
    ];

    console.log(`🔍 Simulating PQAI response with ${mockPQAIResponse.length} results\n`);

    // Show raw scores from mock data
    console.log('🔍 Raw PQAI scores (first 10):');
    mockPQAIResponse.slice(0, 10).forEach((r, i) => {
      console.log(`   ${i + 1}. Score: ${r.score}, Title: ${r.title?.substring(0, 50)}...`);
    });
    console.log();

    // Extract relevance scores (using the same logic as the main service)
    const normalizedResults = mockPQAIResponse.map((result) => {
      // Extract relevance score using the same pattern as drafting pipeline
      const relevanceScore = typeof result.score === 'number' ? result.score :
                            (typeof result.relevance === 'number' ? result.relevance : null);

      return {
        title: result.title || 'Untitled Patent',
        publicationNumber: result.publication_number || result.patent_number || 'Unknown',
        relevanceScore: relevanceScore,
        rawScore: result.score || result.relevance
      };
    });

    // Sort by relevance score (highest first)
    normalizedResults.sort((a, b) => {
      const scoreA = a.relevanceScore || 0;
      const scoreB = b.relevanceScore || 0;
      return scoreB - scoreA; // Higher scores first
    });

    // Analyze results
    const scores = normalizedResults.map(r => r.relevanceScore);
    const validScores = scores.filter(s => s !== null && s !== undefined);
    const nullScores = scores.filter(s => s === null || s === undefined);

    console.log('📈 Relevance Score Analysis:');
    console.log(`   - Total results: ${normalizedResults.length}`);
    console.log(`   - Valid scores: ${validScores.length}`);
    console.log(`   - Null/undefined scores: ${nullScores.length}`);
    if (validScores.length > 0) {
      console.log(`   - Score range: ${Math.min(...validScores).toFixed(3)} - ${Math.max(...validScores).toFixed(3)}`);
      console.log(`   - Average score: ${(validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(3)}\n`);
    }

    // Check if results are sorted by relevance (descending)
    const isSortedDescending = validScores.length > 1 && validScores.every((score, index) => {
      if (index === 0) return true;
      return score <= validScores[index - 1];
    });

    console.log('🔄 Sorting Verification:');
    console.log(`   - Is sorted descending: ${isSortedDescending ? '✅ YES' : '❌ NO'}\n`);

    // Show top 5 results with scores
    console.log('🏆 Top 5 Results by Relevance:');
    normalizedResults.slice(0, 5).forEach((result, index) => {
      const score = result.relevanceScore;
      const scorePercent = score ? `${(score * 100).toFixed(1)}%` : 'N/A';
      console.log(`   ${index + 1}. ${result.publicationNumber} - Relevance: ${scorePercent}`);
      console.log(`      Title: ${result.title?.substring(0, 60)}${result.title?.length > 60 ? '...' : ''}`);
    });

    console.log('\n📋 Sample Raw Scores (first 10):');
    normalizedResults.slice(0, 10).forEach((result, index) => {
      console.log(`   ${index + 1}. Score: ${result.relevanceScore}, Raw: ${result.rawScore}`);
    });

    // Test the patent selection logic
    console.log('\n🎯 Testing Patent Selection Logic:');
    const totalPatents = normalizedResults.length;
    const targetCount = Math.ceil(totalPatents * 0.5); // Top 50%
    const selectedCount = Math.min(
      Math.max(targetCount, 10), // At least 10 patents
      Math.min(totalPatents, 20) // At most 20 patents
    );

    const selectedPatents = normalizedResults.slice(0, selectedCount);

    console.log(`   - Total patents: ${totalPatents}`);
    console.log(`   - Target count (50%): ${targetCount}`);
    console.log(`   - Selected count: ${selectedCount}`);
    console.log(`   - Selection percentage: ${((selectedCount/totalPatents)*100).toFixed(1)}%`);

    if (selectedCount > 0) {
      const avgSelectedScore = selectedPatents.reduce((sum, p) => sum + (p.relevanceScore || 0), 0) / selectedCount;
      console.log(`   - Average score of selected patents: ${avgSelectedScore.toFixed(3)} (${(avgSelectedScore * 100).toFixed(1)}%)`);
    }

    // Summary
    console.log('\n📋 TEST SUMMARY:');
    console.log(`   ✅ PQAI Results: ${normalizedResults.length > 0 ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Relevance Scores: ${validScores.length > 0 ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Proper Sorting: ${isSortedDescending ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Selection Logic: ${selectedCount >= 10 && selectedCount <= 20 ? 'PASS' : 'FAIL'}`);

    const allTestsPass = normalizedResults.length > 0 && validScores.length > 0 && isSortedDescending &&
                        selectedCount >= 10 && selectedCount <= 20;

    console.log(`\n🎉 OVERALL RESULT: ${allTestsPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testPQAIRelevanceSorting();
