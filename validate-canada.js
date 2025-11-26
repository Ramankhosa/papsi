// Validate and insert Canada.json into database
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function validateAndInsertCanada() {
  const prisma = new PrismaClient();

  try {
    console.log('🔍 Validating and inserting Canada country profile...\n');

    // Read and parse the JSON file
    const canadaJson = fs.readFileSync('Countries/canada.json', 'utf8');
    const originalProfile = JSON.parse(canadaJson);

    console.log('📋 Original profile structure:');
    console.log(`   Name: ${originalProfile.meta?.name || 'Unknown'}`);
    console.log(`   Code: ${originalProfile.meta?.code || 'Unknown'}`);
    console.log(`   Office: ${originalProfile.meta?.office || 'Unknown'}`);
    console.log(`   Languages: ${originalProfile.meta?.languages?.join(', ') || 'Unknown'}`);
    console.log('');

    // Validate structure
    console.log('🧪 Validating structure...');

    const requiredKeys = ['meta', 'structure', 'rules', 'validation', 'prompts', 'export', 'diagrams', 'crossChecks'];
    const missingKeys = requiredKeys.filter(key => !originalProfile[key]);

    if (missingKeys.length > 0) {
      console.log('❌ Missing required keys:', missingKeys.join(', '));
      return;
    }

    // Check variant consistency
    const defaultVariant = originalProfile.structure?.defaultVariant;
    const variants = originalProfile.structure?.variants || [];
    const variantExists = variants.some(v => v.id === defaultVariant);

    if (!variantExists) {
      console.log(`❌ defaultVariant "${defaultVariant}" not found in variants`);
      return;
    }

    // Check section references in prompts
    const sectionIds = variants[0]?.sections?.map(s => s.id) || [];
    const promptKeys = Object.keys(originalProfile.prompts?.sections || {});
    const invalidPromptRefs = promptKeys.filter(key => !sectionIds.includes(key));

    if (invalidPromptRefs.length > 0) {
      console.log('❌ Invalid prompt section references:', invalidPromptRefs.join(', '));
      return;
    }

    // Check crossCheck references
    const crossChecks = originalProfile.crossChecks?.checkList || [];
    for (const check of crossChecks) {
      if (check.from && !sectionIds.includes(check.from)) {
        console.log(`❌ CrossCheck "${check.id}" references unknown section: ${check.from}`);
        return;
      }
      if (check.mustBeExplainedIn) {
        const invalidRefs = check.mustBeExplainedIn.filter(ref => !sectionIds.includes(ref));
        if (invalidRefs.length > 0) {
          console.log(`❌ CrossCheck "${check.id}" references unknown sections in mustBeExplainedIn:`, invalidRefs.join(', '));
          return;
        }
      }
      if (check.mustBeShownIn) {
        const invalidRefs = check.mustBeShownIn.filter(ref => !sectionIds.includes(ref));
        if (invalidRefs.length > 0) {
          console.log(`❌ CrossCheck "${check.id}" references unknown sections in mustBeShownIn:`, invalidRefs.join(', '));
          return;
        }
      }
    }

    console.log('✅ All validations passed!');
    console.log('');

    // Check if profile already exists
    const existingProfile = await prisma.countryProfile.findUnique({
      where: { countryCode: 'CA' }
    });

    if (existingProfile) {
      console.log('⚠️  CA country profile already exists. Updating...\n');

      // Update existing profile
      const updatedProfile = await prisma.countryProfile.update({
        where: { countryCode: 'CA' },
        data: {
          name: originalProfile.meta.name,
          profileData: originalProfile,
          version: originalProfile.meta.version,
          updatedBy: 'cmi4cs1ua0004xp9vzw8gk8q1' // Super admin user ID
        }
      });

      console.log('✅ CA country profile updated successfully!');
      console.log(`   ID: ${updatedProfile.id}`);
      console.log(`   Status: ${updatedProfile.status}`);
      console.log(`   Updated: ${updatedProfile.updatedAt}`);

    } else {
      console.log('📝 Creating new CA country profile...\n');

      // Create new profile
      const newProfile = await prisma.countryProfile.create({
        data: {
          countryCode: originalProfile.meta.code,
          name: originalProfile.meta.name,
          profileData: originalProfile,
          version: originalProfile.meta.version,
          status: 'ACTIVE',
          createdBy: 'cmi4cs1ua0004xp9vzw8gk8q1', // Super admin user ID
          updatedBy: 'cmi4cs1ua0004xp9vzw8gk8q1'
        }
      });

      console.log('✅ CA country profile created successfully!');
      console.log(`   ID: ${newProfile.id}`);
      console.log(`   Status: ${newProfile.status}`);
      console.log(`   Created: ${newProfile.createdAt}`);
    }

    console.log('\n🎉 Operation completed successfully!');
    console.log('🇨🇦 Canada country profile is now available for patent drafting.');

  } catch (error) {
    console.error('❌ Error processing Canada country profile:', error.message);
    if (error.code === 'P2002') {
      console.error('   This might be a unique constraint violation.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run the validation and insertion
validateAndInsertCanada();
