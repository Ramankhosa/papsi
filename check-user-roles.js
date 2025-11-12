const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUserRoles() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'individual@gmail.com' },
      select: { email: true, roles: true }
    });
    console.log('Individual user:', user);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUserRoles();
