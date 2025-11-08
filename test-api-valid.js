const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = 'your-super-secure-jwt-secret-change-in-production-min-32-chars';
const userId = 'cmgw4e5dy0004ojj4fg1092sc'; // From the database check

const token = jwt.sign(
  { sub: userId, email: 'analyst@spotipr.com' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

console.log('Using token for user:', userId);

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
    try {
      const json = JSON.parse(data);
      console.log('Response:', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
