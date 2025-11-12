const http = require('http');

http.get('http://localhost:3001/api/health', (res) => {
  console.log('✅ Server is running');
  process.exit(0);
}).on('error', () => {
  console.log('❌ Server not running');
  process.exit(1);
});




















