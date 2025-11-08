const jwt = require('jsonwebtoken');

// Create a test JWT token (you'll need to replace with actual secret and user ID)
const secret = process.env.JWT_SECRET || 'your-secret-key';
const userId = 'analyst-user-id'; // Replace with actual user ID

const token = jwt.sign(
  { sub: userId, email: 'analyst@spotipr.com' },
  secret,
  { expiresIn: '1h' }
);

console.log('Test JWT token:', token);

// Now you can use this token to test the API
console.log('\nUse this curl command:');
console.log(`curl -H "Authorization: Bearer ${token}" http://localhost:3000/api/idea-bank`);