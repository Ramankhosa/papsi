const https = require('https');

function testPQAI() {
  const url = 'https://api.projectpq.ai/search/102/?q=drone+navigation+system&n=1&type=patent&snip=1&token=90b423ac4fd243c790c068e3a9309cd7';

  console.log('Testing PQAI API with URL:', url);

  https.get(url, (res) => {
    console.log('Status Code:', res.statusCode);
    console.log('Headers:', res.headers);

    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      console.log('Response body:', data);

      if (res.statusCode === 200) {
        try {
          const json = JSON.parse(data);
          console.log('Parsed JSON:', JSON.stringify(json, null, 2));
        } catch (e) {
          console.log('Failed to parse JSON:', e.message);
        }
      }
    });
  }).on('error', (err) => {
    console.log('Network error:', err.message);
  });
}

testPQAI();
