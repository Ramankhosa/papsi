// Test PQAI API directly
const https = require('https');
const url = require('url');

async function testPQAI() {
  const token = process.env.PQAI_API_TOKEN || process.env.PQAI_TOKEN || '90b423ac4fd243c790c068e3a9309cd7'; // Fallback to user's token
  const apiUrl = `https://api.projectpq.ai/search/102/?q=drone+navigation+system&n=5&type=patent&token=${token}`;

  console.log('Testing PQAI API...');
  console.log('URL:', apiUrl);
  console.log('Token present:', !!token && token !== 'test');
  console.log('Token length:', token ? token.length : 0);

  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(apiUrl);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = https.request(options, (res) => {
      console.log('Status Code:', res.statusCode);
      console.log('Headers:', res.headers);

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Response length:', data.length);
        console.log('Response preview:', data.substring(0, 500) + (data.length > 500 ? '...' : ''));

        try {
          const jsonData = JSON.parse(data);
          console.log('Parsed response keys:', Object.keys(jsonData));
          if (jsonData.results) {
            console.log('Results count:', jsonData.results.length);
            if (jsonData.results.length > 0) {
              console.log('First result:', JSON.stringify(jsonData.results[0], null, 2));
            }
          }
          resolve(jsonData);
        } catch (e) {
          console.log('Raw response:', data);
          resolve(data);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });

    req.setTimeout(30000, () => {
      console.error('Request timeout');
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

testPQAI().catch(console.error);
