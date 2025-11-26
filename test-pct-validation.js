const fs = require('fs');

// Simple test script to validate PCT JSON
// Note: This is a basic test - in a real environment you'd use the actual TypeScript validation

function validatePCTProfile() {
  try {
    const pctJson = fs.readFileSync('pct-test-profile.json', 'utf8');
    const profile = JSON.parse(pctJson);

    console.log('🔍 Validating PCT Country Profile...\n');

    // Basic structure checks
    const requiredTopKeys = ['meta', 'structure', 'rules', 'validation', 'prompts', 'export', 'diagrams', 'crossChecks'];
    const missingKeys = requiredTopKeys.filter(key => !profile[key]);

    if (missingKeys.length > 0) {
      console.log('❌ Missing required top-level keys:', missingKeys.join(', '));
      return false;
    }

    console.log('✅ All required top-level keys present');

    // Check new optional rules blocks
    const rules = profile.rules;
    const optionalRulesBlocks = ['sequenceListing', 'pageLayout', 'designatedStates'];

    optionalRulesBlocks.forEach(block => {
      if (rules[block]) {
        console.log(`✅ Optional rules.${block} block present`);
      } else {
        console.log(`ℹ️  Optional rules.${block} block not present (acceptable)`);
      }
    });

    // Check meta information
    const meta = profile.meta;
    console.log(`📋 Profile: ${meta.name} (${meta.code})`);
    console.log(`🌍 Continent: ${meta.continent}`);
    console.log(`🏛️  Office: ${meta.office}`);
    console.log(`🗣️  Languages: ${meta.languages.join(', ')}`);
    console.log(`📝 Application Types: ${meta.applicationTypes.join(', ')}`);

    // Check structure
    const structure = profile.structure;
    console.log(`📄 Variants: ${structure.variants.length}`);
    console.log(`📑 Sections in default variant: ${structure.variants[0].sections.length}`);

    // Check export configuration
    const exportConfig = profile.export;
    console.log(`📤 Document Types: ${exportConfig.documentTypes.length}`);

    exportConfig.documentTypes.forEach(docType => {
      console.log(`  - ${docType.label}: ${docType.pageSize}, margins: ${docType.marginTopCm || 'auto'}cm/${docType.marginBottomCm || 'auto'}cm/${docType.marginLeftCm || 'auto'}cm/${docType.marginRightCm || 'auto'}cm`);
    });

    // Check new rules blocks if present
    if (rules.sequenceListing) {
      console.log(`🧬 Sequence Listing: ${rules.sequenceListing.format}, required: ${rules.sequenceListing.requiredIfSeqDisclosed}`);
    }

    if (rules.pageLayout) {
      console.log(`📄 Page Layout: ${rules.pageLayout.defaultPageSize}, font: ${rules.pageLayout.recommendedFontFamily}`);
    }

    if (rules.designatedStates) {
      console.log(`🇺🇳 Designated States: ${rules.designatedStates.mode}, total: ${rules.designatedStates.totalStates}`);
    }

    // Check section headings
    const sectionHeadings = Object.keys(exportConfig.sectionHeadings);
    console.log(`🏷️  Section Headings: ${sectionHeadings.length} defined`);

    console.log('\n🎉 PCT profile structure validation completed successfully!');
    console.log('📋 The profile includes all required fields and new optional blocks.');

    return true;

  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    return false;
  }
}

// Run the validation
validatePCTProfile();
