const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyUser() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: 'ramankhosa@gmail.com' },
      select: {
        email: true,
        name: true,
        roles: true,
        emailVerified: true,
        tenant: {
          select: {
            name: true,
            type: true
          }
        }
      }
    });

    if (user) {
      console.log('✅ Test user verified:');
      console.log('📧 Email:', user.email);
      console.log('👤 Name:', user.name);
      console.log('🎭 Roles:', user.roles.join(', '));
      console.log('📧 Email Verified:', user.emailVerified);
      console.log('🏢 Tenant:', user.tenant?.name, '(' + user.tenant?.type + ')');
    } else {
      console.log('❌ User not found');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyUser();





