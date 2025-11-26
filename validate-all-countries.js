// Comprehensive validation of all country profile JSON files
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

async function validateAllCountries() {
  const prisma = new PrismaClient();

  try {
    console.log('🔍 Comprehensive validation of all country profiles...\n');

    // Country files to check
    const countryFiles = [
      { file: 'Countries/US-updated.json', code: 'US', name: 'United States' },
      { file: 'Countries/pct.json', code: 'PCT', name: 'Patent Cooperation Treaty' },
      { file: 'Countries/AU.json', code: 'AU', name: 'Australia' },
      { file: 'Countries/canada.json', code: 'CA', name: 'Canada' }
    ];

    const results = [];

    for (const country of countryFiles) {
      console.log(`📋 Validating ${country.name} (${country.code})...`);

      try {
        // Read and parse JSON
        const jsonContent = fs.readFileSync(country.file, 'utf8');
        const profile = JSON.parse(jsonContent);

        // Validate structure
        const validation = validateCountryStructure(profile, country.code);

        results.push({
          ...country,
          valid: validation.isValid,
          errors: validation.errors,
          warnings: validation.warnings,
          structure: validation.structure
        });

        if (validation.isValid) {
          console.log(`   ✅ Valid structure`);
        } else {
          console.log(`   ❌ Invalid structure: ${validation.errors.length} errors`);
          validation.errors.forEach(error => console.log(`      - ${error}`));
        }

        if (validation.warnings.length > 0) {
          console.log(`   ⚠️  Warnings: ${validation.warnings.length}`);
          validation.warnings.forEach(warning => console.log(`      - ${warning}`));
        }

      } catch (error) {
        results.push({
          ...country,
          valid: false,
          errors: [`JSON parsing error: ${error.message}`],
          warnings: [],
          structure: null
        });
        console.log(`   ❌ JSON parsing error: ${error.message}`);
      }

      console.log('');
    }

    // Compare structures
    console.log('🔄 Comparing structures across all countries...\n');

    const validProfiles = results.filter(r => r.valid && r.structure);

    if (validProfiles.length === 0) {
      console.log('❌ No valid profiles found to compare!');
      return;
    }

    // Check consistency
    const referenceStructure = validProfiles[0].structure;
    const consistencyIssues = [];

    for (const profile of validProfiles.slice(1)) {
      const issues = compareStructures(referenceStructure, profile.structure, profile.code);
      if (issues.length > 0) {
        consistencyIssues.push(...issues.map(issue => `${profile.code}: ${issue}`));
      }
    }

    if (consistencyIssues.length > 0) {
      console.log('⚠️  Structure consistency issues:');
      consistencyIssues.forEach(issue => console.log(`   - ${issue}`));
    } else {
      console.log('✅ All valid profiles have consistent structure');
    }

    console.log('');

    // Check database status
    console.log('🗄️  Checking database status...\n');

    for (const country of countryFiles) {
      try {
        const dbProfile = await prisma.countryProfile.findUnique({
          where: { countryCode: country.code }
        });

        if (dbProfile) {
          console.log(`   ✅ ${country.code}: Present in DB (Status: ${dbProfile.status}, Version: ${dbProfile.version})`);
        } else {
          console.log(`   ❌ ${country.code}: Missing from database`);
        }
      } catch (error) {
        console.log(`   ❌ ${country.code}: Database check failed - ${error.message}`);
      }
    }

    // Summary
    console.log('\n📊 VALIDATION SUMMARY:');
    console.log('=' .repeat(50));

    const totalCountries = countryFiles.length;
    const validCountries = results.filter(r => r.valid).length;
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
    const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

    console.log(`Total countries checked: ${totalCountries}`);
    console.log(`Valid countries: ${validCountries}/${totalCountries}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log(`Total warnings: ${totalWarnings}`);
    console.log(`Structure consistency: ${consistencyIssues.length === 0 ? '✅ PASS' : '⚠️  ISSUES'}`);

    if (validCountries === totalCountries && totalErrors === 0 && consistencyIssues.length === 0) {
      console.log('\n🎉 ALL COUNTRY PROFILES ARE VALID AND CONSISTENT!');
      console.log('🌍 Multi-jurisdictional patent drafting system is ready.');
    } else {
      console.log('\n⚠️  Some issues found. Please review and fix before production use.');
    }

  } catch (error) {
    console.error('❌ Error during validation:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

function validateCountryStructure(profile, code) {
  const errors = [];
  const warnings = [];
  const structure = {};

  // Required top-level keys
  const requiredKeys = ['meta', 'structure', 'rules', 'validation', 'prompts', 'export', 'diagrams', 'crossChecks'];
  structure.topLevelKeys = requiredKeys.filter(key => profile[key]).length;

  for (const key of requiredKeys) {
    if (!profile[key]) {
      errors.push(`Missing required top-level key: ${key}`);
    }
  }

  // Meta validation
  if (profile.meta) {
    const requiredMeta = ['id', 'name', 'code', 'continent', 'office', 'officeUrl', 'applicationTypes', 'languages', 'version', 'status', 'inheritsFrom', 'tags', 'createdAt', 'updatedAt'];
    const metaKeys = Object.keys(profile.meta);
    structure.metaKeys = metaKeys.length;

    const missingMeta = requiredMeta.filter(key => !metaKeys.includes(key));
    if (missingMeta.length > 0) {
      errors.push(`Missing meta fields: ${missingMeta.join(', ')}`);
    }

    // Check status enum
    if (profile.meta.status && !['active', 'inactive', 'draft'].includes(profile.meta.status)) {
      errors.push(`Invalid meta.status: ${profile.meta.status} (must be 'active', 'inactive', or 'draft')`);
    }
  }

  // Structure validation
  if (profile.structure) {
    if (!profile.structure.defaultVariant) {
      errors.push('Missing structure.defaultVariant');
    }

    if (!Array.isArray(profile.structure.variants) || profile.structure.variants.length === 0) {
      errors.push('Missing or empty structure.variants array');
    } else {
      const variant = profile.structure.variants[0];
      if (!variant.id) errors.push('Missing variant.id');
      if (!variant.label) errors.push('Missing variant.label');

      if (!Array.isArray(variant.sections) || variant.sections.length === 0) {
        errors.push('Missing or empty variant.sections array');
      } else {
        structure.sectionCount = variant.sections.length;
        const sectionIds = variant.sections.map(s => s.id);

        // Check for duplicate section IDs
        const duplicates = sectionIds.filter((id, index) => sectionIds.indexOf(id) !== index);
        if (duplicates.length > 0) {
          errors.push(`Duplicate section IDs: ${duplicates.join(', ')}`);
        }
      }
    }
  }

  // Rules validation
  if (profile.rules) {
    const requiredRuleBlocks = ['global', 'abstract', 'claims', 'description', 'drawings', 'procedural', 'language', 'sequenceListing', 'pageLayout'];
    const ruleKeys = Object.keys(profile.rules);
    structure.ruleBlocks = ruleKeys.length;

    const missingRules = requiredRuleBlocks.filter(key => !ruleKeys.includes(key));
    if (missingRules.length > 0) {
      warnings.push(`Missing rule blocks: ${missingRules.join(', ')}`);
    }
  }

  // Validation section
  if (profile.validation) {
    if (!profile.validation.sectionChecks) {
      errors.push('Missing validation.sectionChecks');
    } else {
      structure.validationChecks = Object.keys(profile.validation.sectionChecks).length;
    }

    if (!Array.isArray(profile.validation.crossSectionChecks)) {
      warnings.push('Missing or invalid validation.crossSectionChecks array');
    }
  }

  // Prompts validation
  if (profile.prompts) {
    if (!profile.prompts.baseStyle) {
      warnings.push('Missing prompts.baseStyle');
    }

    if (!profile.prompts.sections) {
      errors.push('Missing prompts.sections');
    } else {
      structure.promptSections = Object.keys(profile.prompts.sections).length;
    }
  }

  // Export validation
  if (profile.export) {
    if (!Array.isArray(profile.export.documentTypes) || profile.export.documentTypes.length === 0) {
      errors.push('Missing or empty export.documentTypes array');
    } else {
      structure.documentTypes = profile.export.documentTypes.length;
    }
  }

  // Cross-reference validation
  if (profile.structure?.variants?.[0]?.sections && profile.prompts?.sections) {
    const sectionIds = profile.structure.variants[0].sections.map(s => s.id);
    const promptKeys = Object.keys(profile.prompts.sections);

    const invalidPromptRefs = promptKeys.filter(key => !sectionIds.includes(key));
    if (invalidPromptRefs.length > 0) {
      errors.push(`Invalid prompt section references: ${invalidPromptRefs.join(', ')}`);
    }
  }

  // CrossChecks validation
  if (profile.crossChecks?.checkList) {
    const sectionIds = profile.structure?.variants?.[0]?.sections?.map(s => s.id) || [];
    for (const check of profile.crossChecks.checkList) {
      if (check.from && !sectionIds.includes(check.from)) {
        errors.push(`CrossCheck "${check.id}" references unknown section: ${check.from}`);
      }
      if (check.mustBeExplainedIn) {
        const invalidRefs = check.mustBeExplainedIn.filter(ref => !sectionIds.includes(ref));
        if (invalidRefs.length > 0) {
          errors.push(`CrossCheck "${check.id}" mustBeExplainedIn references unknown sections: ${invalidRefs.join(', ')}`);
        }
      }
      if (check.mustBeShownIn) {
        const invalidRefs = check.mustBeShownIn.filter(ref => !sectionIds.includes(ref));
        if (invalidRefs.length > 0) {
          errors.push(`CrossCheck "${check.id}" mustBeShownIn references unknown sections: ${invalidRefs.join(', ')}`);
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    structure
  };
}

function compareStructures(reference, current, code) {
  const issues = [];

  // Compare key counts
  if (reference.topLevelKeys !== current.topLevelKeys) {
    issues.push(`Different number of top-level keys (${current.topLevelKeys} vs ${reference.topLevelKeys})`);
  }

  if (reference.metaKeys !== current.metaKeys) {
    issues.push(`Different number of meta fields (${current.metaKeys} vs ${reference.metaKeys})`);
  }

  if (reference.sectionCount !== current.sectionCount) {
    issues.push(`Different number of sections (${current.sectionCount} vs ${reference.sectionCount})`);
  }

  if (reference.ruleBlocks !== current.ruleBlocks) {
    issues.push(`Different number of rule blocks (${current.ruleBlocks} vs ${reference.ruleBlocks})`);
  }

  if (reference.validationChecks !== current.validationChecks) {
    issues.push(`Different number of validation checks (${current.validationChecks} vs ${reference.validationChecks})`);
  }

  if (reference.promptSections !== current.promptSections) {
    issues.push(`Different number of prompt sections (${current.promptSections} vs ${reference.promptSections})`);
  }

  if (reference.documentTypes !== current.documentTypes) {
    issues.push(`Different number of document types (${current.documentTypes} vs ${reference.documentTypes})`);
  }

  return issues;
}

// Run the comprehensive validation
validateAllCountries();
