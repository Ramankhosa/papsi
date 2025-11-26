// Update PCT profile to make Disclosure of Invention required
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function updatePCTProfile() {
  const prisma = new PrismaClient();

  try {
    console.log('🔍 Updating PCT country profile...\n');

    // Read and parse the updated JSON file
    const pctJson = fs.readFileSync('Countries/pct.json', 'utf8');
    const profileData = JSON.parse(pctJson);

    console.log('📋 Profile updates:');
    console.log('   • Made "Disclosure of Invention" section required');
    console.log('');

    // Update existing profile
    const updatedProfile = await prisma.countryProfile.update({
      where: { countryCode: 'PCT' },
      data: {
        profileData: profileData,
        updatedBy: 'cmi4cs1ua0004xp9vzw8gk8q1' // Super admin user ID
      }
    });

    console.log('✅ PCT country profile updated successfully!');
    console.log(`   ID: ${updatedProfile.id}`);
    console.log(`   Status: ${updatedProfile.status}`);
    console.log(`   Updated: ${updatedProfile.updatedAt}`);
    console.log('');
    console.log('🎯 "Disclosure of Invention" is now REQUIRED for PCT applications');

  } catch (error) {
    console.error('❌ Error updating PCT country profile:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the update
updatePCTProfile();
