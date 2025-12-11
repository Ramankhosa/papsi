const { PrismaClient } = require('@prisma/client');

async function checkTable() {
  const prisma = new PrismaClient();

  try {
    // Try to query the refresh_tokens table
    const result = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'refresh_tokens'`;

    if (result.length > 0) {
      console.log('✅ refresh_tokens table exists');
    } else {
      console.log('❌ refresh_tokens table does not exist');
    }
  } catch (error) {
    console.error('Error checking table:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkTable();





