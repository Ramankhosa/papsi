// Check for valid user IDs for foreign key constraints
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkValidUsers() {
  try {
    console.log('🔍 Finding valid user IDs for country profile creation...\n');

    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        email: true,
        name: true,
        roles: true
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log('📋 Active users:');
    users.forEach(user => {
      console.log(`   ID: ${user.id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Name: ${user.name || 'N/A'}`);
      console.log(`   Roles: ${user.roles.join(', ')}`);
      console.log('');
    });

    if (users.length === 0) {
      console.log('❌ No active users found!');
      console.log('💡 You need to create a user first, or use an existing user ID.');
    } else {
      console.log(`✅ Found ${users.length} active user(s)`);
      console.log('💡 Use one of these user IDs for the createdBy/updatedBy fields:');
      users.forEach(user => {
        console.log(`   ${user.id} (${user.email})`);
      });
    }

  } catch (error) {
    console.error('❌ Error checking users:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the check
checkValidUsers();
