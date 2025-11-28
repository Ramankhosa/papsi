const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Country names data
const countryData = [
  { code: 'EU', name: 'European Union' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'SE', name: 'Sweden' },
  { code: 'ES', name: 'Spain' },
  { code: 'PL', name: 'Poland' },
  { code: 'BR', name: 'Brazil' },
  { code: 'UAE', name: 'United Arab Emirates' },
  { code: 'IL', name: 'Israel' },
  { code: 'US', name: 'United States of America' },
  { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'UK', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'IR', name: 'Iran' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'RU', name: 'Russia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'ZA', name: 'South Africa' }
];

async function seedAllCountryData() {
  try {
    console.log('Starting to seed all country data...');

    // === SEED COUNTRY NAMES ===
    console.log('Seeding country names...');
    await prisma.countryName.createMany({
      data: countryData,
      skipDuplicates: true
    });

    const countryCount = await prisma.countryName.count();
    console.log(`Country names: ${countryCount} records`);

    // === SEED COUNTRY SECTION MAPPINGS ===
    console.log('Seeding country section mappings...');

    // Read the CSV file
    const csvPath = path.join(__dirname, 'Finalmapping.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');

    // Parse CSV content
    const lines = csvContent.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim());

    // Country codes are from index 1 onwards (skip "Superset Section")
    const countryCodes = headers.slice(1);

    // Process each data row (skip header)
    const mappings = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = line.split(',').map(col => col.trim());

      // First column is the superset code
      const supersetCode = columns[0];

      // Remaining columns are country-specific headings
      for (let j = 1; j < columns.length; j++) {
        const countryCode = countryCodes[j - 1];
        let heading = columns[j];

        // Skip if heading is empty or undefined
        if (!heading || heading === '') continue;

        // Clean up the heading - remove extra quotes and handle special cases
        heading = heading.replace(/^"+|"+$/g, ''); // Remove surrounding quotes
        heading = heading.replace(/"""/g, '"'); // Fix triple quotes

        mappings.push({
          countryCode,
          supersetCode,
          heading
        });
      }
    }

    console.log(`Prepared ${mappings.length} section mappings to insert`);

    // Insert mappings data
    await prisma.countrySectionMapping.createMany({
      data: mappings,
      skipDuplicates: true
    });

    const mappingCount = await prisma.countrySectionMapping.count();
    console.log(`Country section mappings: ${mappingCount} records`);

    // === VERIFICATION ===
    console.log('\n=== VERIFICATION ===');

    // Show sample country names
    const sampleCountries = await prisma.countryName.findMany({
      take: 3,
      orderBy: { code: 'asc' }
    });
    console.log('Sample countries:');
    sampleCountries.forEach(country => {
      console.log(`  ${country.code}: ${country.name}`);
    });

    // Show sample mappings
    const sampleMappings = await prisma.countrySectionMapping.findMany({
      take: 3,
      orderBy: { countryCode: 'asc' }
    });
    console.log('\nSample section mappings:');
    sampleMappings.forEach(mapping => {
      console.log(`  ${mapping.countryCode} - ${mapping.supersetCode}: ${mapping.heading}`);
    });

    console.log('\n=== SEEDING COMPLETED SUCCESSFULLY ===');
    console.log(`Total countries: ${countryCount}`);
    console.log(`Total section mappings: ${mappingCount}`);

  } catch (error) {
    console.error('Error seeding country data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed function
if (require.main === module) {
  seedAllCountryData()
    .then(() => {
      console.log('All country data seeding completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('All country data seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedAllCountryData };
