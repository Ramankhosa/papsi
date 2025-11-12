// Check environment variables
require('dotenv').config({ path: '.env.local' });

console.log('Checking environment variables...');
console.log('PQAI_API_TOKEN:', process.env.PQAI_API_TOKEN ? 'Loaded (' + process.env.PQAI_API_TOKEN.length + ' chars)' : 'Not found');
console.log('PQAI_TOKEN:', process.env.PQAI_TOKEN ? 'Loaded (' + process.env.PQAI_TOKEN.length + ' chars)' : 'Not found');

// Also check .env
require('dotenv').config({ path: '.env' });
console.log('After loading .env:');
console.log('PQAI_API_TOKEN:', process.env.PQAI_API_TOKEN ? 'Loaded (' + process.env.PQAI_API_TOKEN.length + ' chars)' : 'Not found');
console.log('PQAI_TOKEN:', process.env.PQAI_TOKEN ? 'Loaded (' + process.env.PQAI_TOKEN.length + ' chars)' : 'Not found');










