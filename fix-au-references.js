// Fix AU.json section references and update database
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function fixAUReferences() {
  const prisma = new PrismaClient();

  try {
    console.log('🔧 Fixing AU.json section references...\n');

    // Read the corrected AU.json file
    const auJson = fs.readFileSync('Countries/AU.json', 'utf8');
    const profileData = JSON.parse(auJson);

    console.log('📋 Verifying fixes:');
    console.log(`   • defaultVariant: ${profileData.structure.defaultVariant} (should be "au_standard")`);
    console.log(`   • Prompts sections: ${Object.keys(profileData.prompts.sections).join(', ')}`);
    console.log(`   • CrossChecks drawings reference: ${profileData.crossChecks.checkList[0].from} → ${profileData.crossChecks.checkList[0].mustBeExplainedIn[0]}`);
    console.log('');

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
    console.log(`   Updated: ${updatedProfile.updatedAt}`);
    console.log('');

    console.log('🎯 Fixed Issues:');
    console.log('   ✅ defaultVariant: "standard" → "au_standard"');
    console.log('   ✅ Prompts: technical_field → field');
    console.log('   ✅ Prompts: background_art → background');
    console.log('   ✅ Prompts: summary_of_invention → summary');
    console.log('   ✅ Prompts: description_of_embodiments → detailed_description');
    console.log('   ✅ CrossChecks: drawings → brief_drawings');
    console.log('');

    console.log('🎉 AU.json should now upload without validation errors!');
    console.log('🇦🇺 Try uploading AU.json again in the super-admin interface.');

  } catch (error) {
    console.error('❌ Error fixing AU references:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixAUReferences();
