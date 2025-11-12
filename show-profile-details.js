const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function showProfileDetails() {
  try {
    const profile = await prisma.styleProfile.findFirst({
      where: { userId: 'cmhru2h3e000c918wsdoj4cwc' },
      orderBy: { version: 'desc' }
    });

    if (profile) {
      console.log('=== LEARNED STYLE PROFILE DETAILS ===');
      console.log('Profile ID:', profile.id);
      console.log('Status:', profile.status);
      console.log('Version:', profile.version);
      console.log('Created:', profile.createdAt.toISOString());
      console.log('Updated:', profile.updatedAt.toISOString());
      console.log('Locked:', profile.lockedAt ? 'YES (' + profile.lockedAt.toISOString() + ')' : 'NO');
      console.log('');

      console.log('=== PROFILE JSON CONTENT ===');
      console.log(JSON.stringify(profile.json, null, 2));
    } else {
      console.log('No profile found');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

showProfileDetails();
