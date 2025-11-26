// Check production readiness of AU country profile
const { PrismaClient } = require('@prisma/client');

async function checkProductionStatus() {
  const prisma = new PrismaClient();

  try {
    console.log('🔍 Checking AU country profile production status...\n');

    // Check if AU profile exists
    const auProfile = await prisma.countryProfile.findUnique({
      where: { countryCode: 'AU' }
    });

    if (!auProfile) {
      console.log('❌ AU country profile not found in database!');
      return;
    }

    console.log('✅ AU profile found in database:');
    console.log(`   ID: ${auProfile.id}`);
    console.log(`   Name: ${auProfile.name}`);
    console.log(`   Code: ${auProfile.countryCode}`);
    console.log(`   Status: ${auProfile.status}`);
    console.log(`   Version: ${auProfile.version}`);
    console.log(`   Created: ${auProfile.createdAt}`);
    console.log(`   Updated: ${auProfile.updatedAt}`);
    console.log('');

    // Validate profile data structure
    const profileData = auProfile.profileData;
    console.log('📋 Validating profile data structure...\n');

    const requiredKeys = ['meta', 'structure', 'rules', 'validation', 'prompts', 'export', 'diagrams', 'crossChecks'];
    const missingKeys = requiredKeys.filter(key => !profileData[key]);

    if (missingKeys.length > 0) {
      console.log('❌ Missing required keys:', missingKeys.join(', '));
    } else {
      console.log('✅ All required top-level keys present');
    }

    // Check meta
    if (profileData.meta) {
      const meta = profileData.meta;
      console.log('✅ Meta section:');
      console.log(`   • Name: ${meta.name}`);
      console.log(`   • Code: ${meta.code}`);
      console.log(`   • Office: ${meta.office}`);
      console.log(`   • Languages: ${meta.languages?.join(', ')}`);
      console.log(`   • Application Types: ${meta.applicationTypes?.join(', ')}`);
    }

    // Check rules
    if (profileData.rules) {
      console.log('✅ Rules section:');
      const optionalBlocks = ['sequenceListing', 'pageLayout'];
      optionalBlocks.forEach(block => {
        const present = !!profileData.rules[block];
        console.log(`   • ${block}: ${present ? 'PRESENT' : 'MISSING'}`);
      });
    }

    // Check export
    if (profileData.export?.documentTypes) {
      console.log('✅ Export section:');
      profileData.export.documentTypes.forEach((docType, index) => {
        const hasMargins = ['marginTopCm', 'marginBottomCm', 'marginLeftCm', 'marginRightCm']
          .every(margin => typeof docType[margin] === 'number');
        console.log(`   • ${docType.label}: ${hasMargins ? 'MARGINS OK' : 'MARGINS MISSING'}`);
      });
    }

    // Check if profile is active
    const isActive = auProfile.status === 'ACTIVE';
    console.log(`\n🎯 Production Status: ${isActive ? 'READY' : 'NOT ACTIVE'}`);

    if (isActive) {
      console.log('✅ AU country profile is production-ready!');
      console.log('🇦🇺 Australian patent drafting is now available.');
    } else {
      console.log('⚠️  Profile exists but is not active. Activate it for production use.');
    }

  } catch (error) {
    console.error('❌ Error checking production status:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the check
checkProductionStatus();
