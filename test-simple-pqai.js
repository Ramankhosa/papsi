const https = require('https');

function testSimplePQAI() {
  // Use the exact same URL that works in browser
  const url = new URL('https://api.projectpq.ai/search/102/?q=a%20fire%20fighting%20drone&n=10&type=patent&after=2016-01-01&token=90b423ac4fd243c790c068e3a9309cd7');

  console.log('Testing with exact working URL from browser:', url.href);

  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  };

  const req = https.request(options, (res) => {
    console.log('Response status:', res.statusCode);
    console.log('Response headers:', res.headers);

    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      console.log('Response length:', data.length);
      console.log('Response starts with:', data.substring(0, 200));

      if (res.statusCode === 200) {
        try {
          const json = JSON.parse(data);
          console.log('Success! Results count:', json.results?.length || 0);
        } catch (e) {
          console.log('Failed to parse JSON:', e.message);
        }
      } else {
        console.log('Request failed with status:', res.statusCode);
      }
    });
  });

  req.on('error', (error) => {
    console.log('Network error:', error.message);
  });

  req.end();
}

testSimplePQAI();
