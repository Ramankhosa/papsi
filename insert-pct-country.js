// Insert PCT country profile into database after repair
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

// Simple repair function for basic fixes
function repairCountryProfile(profile) {
  const repairs = [];

  // Ensure required top-level keys exist
  const requiredKeys = ['meta', 'structure', 'rules', 'validation', 'prompts', 'export', 'diagrams', 'crossChecks'];
  requiredKeys.forEach(key => {
    if (!profile[key]) {
      profile[key] = {};
      repairs.push({ type: 'added', field: key, description: `Added missing ${key} section` });
    }
  });

  // Fix meta section
  if (!profile.meta) profile.meta = {};
  if (!profile.meta.version) {
    profile.meta.version = 1;
    repairs.push({ type: 'added', field: 'meta.version', description: 'Added default version' });
  }

  // Fix structure section
  if (!profile.structure) profile.structure = { defaultVariant: 'standard', variants: [] };

  // Fix rules section - add missing optional blocks
  if (!profile.rules) profile.rules = {};

  // Add sequenceListing if missing
  if (!profile.rules.sequenceListing) {
    profile.rules.sequenceListing = {
      requiredIfSeqDisclosed: true,
      format: "ST.26-XML",
      allowLateFurnishing: true,
      lateFurnishingNotes: "Late submission permitted under certain conditions.",
      affectsFilingDate: false,
      additionalFormatsAllowedForReference: ["PDF"]
    };
    repairs.push({ type: 'added', field: 'rules.sequenceListing', description: 'Added default sequence listing rules' });
  }

  // Add pageLayout if missing
  if (!profile.rules.pageLayout) {
    profile.rules.pageLayout = {
      defaultPageSize: "A4",
      allowedPageSizes: ["A4"],
      minMarginTopCm: 2.0,
      minMarginBottomCm: 1.0,
      minMarginLeftCm: 2.5,
      minMarginRightCm: 1.5,
      recommendedFontFamily: "Times New Roman",
      recommendedFontSizePt: 12,
      recommendedLineSpacing: 1.5
    };
    repairs.push({ type: 'added', field: 'rules.pageLayout', description: 'Added default page layout rules' });
  }

  // Add designatedStates if missing
  if (!profile.rules.designatedStates) {
    profile.rules.designatedStates = {
      mode: "all_by_default",
      totalStates: 150,
      electionAllowed: true,
      electionRequiredForChapterII: false,
      chapterIIDeadlineMonths: 22,
      notes: "All member states designated by default."
    };
    repairs.push({ type: 'added', field: 'rules.designatedStates', description: 'Added default designated states rules' });
  }

  return {
    success: true,
    repairedProfile: profile,
    repairs: repairs,
    validationResult: { valid: true, errors: [], warnings: [] },
    errors: []
  };
}

async function insertPCTCountry() {
  const prisma = new PrismaClient();

  try {
    console.log('🔍 Loading and repairing PCT country profile...\n');

    // Read and parse the JSON file
    const pctJson = fs.readFileSync('Countries/pct.json', 'utf8');
    const originalProfile = JSON.parse(pctJson);

    console.log('📋 Original profile structure:');
    console.log(`   Name: ${originalProfile.meta?.name || 'Unknown'}`);
    console.log(`   Code: ${originalProfile.meta?.code || 'Unknown'}`);
    console.log(`   Office: ${originalProfile.meta?.office || 'Unknown'}`);
    console.log(`   Version: ${originalProfile.meta?.version || 'Unknown'}`);
    console.log('');

    // Repair the profile
    console.log('🔧 Repairing profile...');
    const repairResult = await repairCountryProfile(originalProfile);

    if (!repairResult.success) {
      console.log('❌ Repair failed with errors:');
      repairResult.errors.forEach(error => console.log(`   - ${error}`));
      return;
    }

    console.log('✅ Profile repaired successfully!');
    console.log(`   Repairs applied: ${repairResult.repairs.length}`);

    if (repairResult.repairs.length > 0) {
      console.log('   Repair details:');
      repairResult.repairs.forEach(repair => {
        console.log(`   • ${repair.type.toUpperCase()}: ${repair.field} - ${repair.description}`);
      });
    }
    console.log('');

    const profileData = repairResult.repairedProfile;

    // Check if profile already exists
    const existingProfile = await prisma.countryProfile.findUnique({
      where: { countryCode: 'PCT' }
    });

    if (existingProfile) {
      console.log('⚠️  PCT country profile already exists. Updating...\n');

      // Update existing profile
      const updatedProfile = await prisma.countryProfile.update({
        where: { countryCode: 'PCT' },
        data: {
          name: profileData.meta.name,
          profileData: profileData,
          version: profileData.meta.version,
          updatedBy: 'cmi4cs1ua0004xp9vzw8gk8q1' // Super admin user ID
        }
      });

      console.log('✅ PCT country profile updated successfully!');
      console.log(`   ID: ${updatedProfile.id}`);
      console.log(`   Status: ${updatedProfile.status}`);
      console.log(`   Updated: ${updatedProfile.updatedAt}`);

    } else {
      console.log('📝 Creating new PCT country profile...\n');

      // Create new profile
      const newProfile = await prisma.countryProfile.create({
        data: {
          countryCode: profileData.meta.code,
          name: profileData.meta.name,
          profileData: profileData,
          version: profileData.meta.version,
          status: 'ACTIVE',
          createdBy: 'cmi4cs1ua0004xp9vzw8gk8q1', // Super admin user ID
          updatedBy: 'cmi4cs1ua0004xp9vzw8gk8q1'
        }
      });

      console.log('✅ PCT country profile created successfully!');
      console.log(`   ID: ${newProfile.id}`);
      console.log(`   Status: ${newProfile.status}`);
      console.log(`   Created: ${newProfile.createdAt}`);
    }

    console.log('\n🎉 Operation completed successfully!');
    console.log('🌍 PCT country profile is now available for patent drafting.');

  } catch (error) {
    console.error('❌ Error inserting PCT country profile:', error.message);
    if (error.code === 'P2002') {
      console.error('   This might be a unique constraint violation.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run the insertion
insertPCTCountry();
