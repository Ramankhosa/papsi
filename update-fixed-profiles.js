// Update US and PCT profiles with corrected references
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function updateFixedProfiles() {
  const prisma = new PrismaClient();

  try {
    console.log('🔧 Updating US and PCT profiles with corrected references...\n');

    // Update US profile
    console.log('📝 Updating US profile...');
    const usJson = fs.readFileSync('Countries/US-updated.json', 'utf8');
    const usProfile = JSON.parse(usJson);

    await prisma.countryProfile.update({
      where: { countryCode: 'US' },
      data: {
        profileData: usProfile,
        updatedBy: 'cmi4cs1ua0004xp9vzw8gk8q1'
      }
    });

    console.log('✅ US profile updated successfully!');
    console.log('');

    // Update PCT profile
    console.log('📝 Updating PCT profile...');
    const pctJson = fs.readFileSync('Countries/pct.json', 'utf8');
    const pctProfile = JSON.parse(pctJson);

    await prisma.countryProfile.update({
      where: { countryCode: 'PCT' },
      data: {
        profileData: pctProfile,
        updatedBy: 'cmi4cs1ua0004xp9vzw8gk8q1'
      }
    });

    console.log('✅ PCT profile updated successfully!');
    console.log('');

    console.log('🎯 Fixed Issues:');
    console.log('   ✅ US: field_of_invention → field');
    console.log('   ✅ US: summary_of_invention → summary');
    console.log('   ✅ US: CrossChecks drawings → brief_drawings');
    console.log('   ✅ PCT: technical_field → field');
    console.log('   ✅ PCT: background_art → background');
    console.log('   ✅ PCT: summary_of_invention → summary');
    console.log('   ✅ PCT: CrossChecks drawings → brief_drawings');
    console.log('');

    console.log('🧪 Running final validation...\n');

    // Quick validation check
    const usDb = await prisma.countryProfile.findUnique({
      where: { countryCode: 'US' },
      select: { profileData: true }
    });

    const pctDb = await prisma.countryProfile.findUnique({
      where: { countryCode: 'PCT' },
      select: { profileData: true }
    });

    // Check prompt references
    const usSections = usDb?.profileData?.structure?.variants?.[0]?.sections?.map(s => s.id) || [];
    const usPrompts = Object.keys(usDb?.profileData?.prompts?.sections || {});
    const usInvalidPrompts = usPrompts.filter(p => !usSections.includes(p));

    const pctSections = pctDb?.profileData?.structure?.variants?.[0]?.sections?.map(s => s.id) || [];
    const pctPrompts = Object.keys(pctDb?.profileData?.prompts?.sections || {});
    const pctInvalidPrompts = pctPrompts.filter(p => !pctSections.includes(p));

    console.log('🔍 Validation Results:');
    console.log(`   US invalid prompts: ${usInvalidPrompts.length} (${usInvalidPrompts.join(', ')})`);
    console.log(`   PCT invalid prompts: ${pctInvalidPrompts.length} (${pctInvalidPrompts.join(', ')})`);

    if (usInvalidPrompts.length === 0 && pctInvalidPrompts.length === 0) {
      console.log('✅ All prompt references are now valid!');
    } else {
      console.log('❌ Some prompt references are still invalid.');
    }

  } catch (error) {
    console.error('❌ Error updating profiles:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the update
updateFixedProfiles();
