const axios = require('axios')

async function testStage4Only() {
  console.log('🧪 Testing Stage 4 (Report Generation) only...')

  const BASE_URL = 'http://localhost:3001'
  const searchId = 'cmhhl3h1s0040rh9kdvu080vh' // From the previous test run

  try {
    // Get auth token
    const loginResponse = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
      email: 'analyst@spotipr.com',
      password: 'AnalystPass123!'
    })

    if (!loginResponse.data.token) {
      console.log('❌ Could not get auth token')
      return
    }

    const token = loginResponse.data.token
    console.log('✅ Got auth token')

    // Execute Stage 4
    console.log('📄 Executing Stage 4 (Report Generation)...')
    const stage4StartTime = Date.now()

    const stage4Response = await axios.post(`${BASE_URL}/api/novelty-search/${searchId}/stage/4`, {}, {
      headers: { authorization: `Bearer ${token}` },
      timeout: 120000
    })

    const stage4EndTime = Date.now()
    const stage4Duration = (stage4EndTime - stage4StartTime) / 1000

    if (!stage4Response.data.success) {
      console.log('❌ Stage 4 failed:', stage4Response.data.error)
      return
    }

    console.log(`✅ Stage 4 completed in ${stage4Duration}s`)

    const report = stage4Response.data.results?.report
    if (!report) {
      console.log('❌ Stage 4: Missing report in results')
      return
    }

    console.log('📊 Stage 4 Results:', {
      hasMatrix: !!report.feature_matrix,
      matrixSize: report.feature_matrix ?
        `${report.feature_matrix.rows?.length || 0} features × ${report.feature_matrix.cols?.length || 0} patents` :
        'N/A',
      hasSummary: !!report.executive_summary,
      topReferences: report.top_references?.length || 0
    })

    console.log('🎉 Stage 4 test completed successfully!')

  } catch (error) {
    const errorMessage = error.response?.data?.error || error.response?.data?.details || error.message
    console.error('❌ Stage 4 test failed:', errorMessage)
  }
}

testStage4Only()















