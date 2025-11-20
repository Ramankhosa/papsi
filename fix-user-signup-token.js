const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixUserSignupToken() {
  console.log('🔧 Fixing signup ATI token for ramankhosa@gmail.com...');

  try {
    // Find the user
    const user = await prisma.user.findUnique({
      where: { email: 'ramankhosa@gmail.com' }
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    // Find the ATI token for this user's tenant
    const atiToken = await prisma.aTIToken.findFirst({
      where: { tenantId: user.tenantId }
    });

    if (!atiToken) {
      console.log('❌ No ATI token found for user tenant');
      return;
    }

    console.log('✅ Found ATI token:', atiToken.id);

    // Update the user to link to this signup token
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        signupAtiTokenId: atiToken.id
      },
      select: {
        id: true,
        email: true,
        signupAtiTokenId: true
      }
    });

    console.log('✅ Updated user signup token:');
    console.log('User ID:', updatedUser.id);
    console.log('Email:', updatedUser.email);
    console.log('Signup ATI Token ID:', updatedUser.signupAtiTokenId);

    console.log('\n🎉 User should now be able to login!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixUserSignupToken();


