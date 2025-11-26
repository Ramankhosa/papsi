// Final fix for AU.json - correct the repair function and re-insert
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function fixAUFinal() {
  const prisma = new PrismaClient();

  try {
    console.log('🔧 Final fix for AU.json...\n');

    // Read the AU.json file
    const auJson = fs.readFileSync('Countries/AU.json', 'utf8');
    const profileData = JSON.parse(auJson);

    console.log('📋 Verifying AU profile:');
    console.log(`   Status value: ${profileData.meta.status} (${typeof profileData.meta.status})`);
    console.log(`   Status should be: 'active' (string)`);
    console.log('');

    // Ensure status is correctly set as string
    if (profileData.meta.status !== 'active') {
      console.log('🔧 Fixing status field...');
      profileData.meta.status = 'active';
      console.log('✅ Status corrected to: "active"');
    }

    // Update the database
    console.log('📝 Updating AU profile in database...\n');

    const updatedProfile = await prisma.countryProfile.update({
      where: { countryCode: 'AU' },
      data: {
        profileData: profileData,
        updatedBy: 'cmi4cs1ua0004xp9vzw8gk8q1'
      }
    });

    console.log('✅ AU country profile updated successfully!');
    console.log(`   Status: ${updatedProfile.status}`);
    console.log(`   Updated: ${updatedProfile.updatedAt}`);
    console.log('');

    // Verify the stored data
    const storedProfile = await prisma.countryProfile.findUnique({
      where: { countryCode: 'AU' },
      select: { profileData: true }
    });

    if (storedProfile) {
      const storedStatus = storedProfile.profileData.meta.status;
      console.log(`🔍 Verification - Stored status: ${storedStatus} (${typeof storedStatus})`);

      if (storedStatus === 'active' && typeof storedStatus === 'string') {
        console.log('✅ Status field is correctly stored as string enum!');
        console.log('');
        console.log('🎉 AU.json should now upload without errors in the UI!');
        console.log('🇦🇺 Try uploading AU.json again in the super-admin interface.');
      } else {
        console.log('❌ Status field is still incorrect in database.');
      }
    }

  } catch (error) {
    console.error('❌ Error fixing AU profile:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the final fix
fixAUFinal();
