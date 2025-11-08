const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getAnalystId() {
  try {
    const user = await prisma.user.findFirst({
      where: { email: 'analyst@spotipr.com' },
      select: { id: true, email: true, tenantId: true }
    });

    console.log('Analyst user:', user);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

getAnalystId();
