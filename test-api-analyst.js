const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = 'your-super-secure-jwt-secret-change-in-production-min-32-chars';
const userId = 'cmgw4e74g000fojj4jry18081'; // Analyst user ID

const token = jwt.sign(
  { sub: userId, email: 'analyst@spotipr.com' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

console.log('Using token for analyst user:', userId);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/idea-bank?page=1&limit=20',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);

  let data = '';
  res.on('data', (chunk) => {
    data += chunk.toString();
  });

  res.on('end', () => {
    if (res.statusCode === 200) {
      try {
        const json = JSON.parse(data);
        console.log(`✅ Success! Found ${json.totalCount} ideas`);
      } catch (e) {
        console.log('Raw response:', data.substring(0, 200));
      }
    } else {
      console.log('❌ Error response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
