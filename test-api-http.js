const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/idea-bank',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer invalid-token',
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);

  res.on('data', (chunk) => {
    console.log('Response:', chunk.toString());
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
