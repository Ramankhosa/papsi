const fs = require('fs');

function checkExportFile(filename) {
  try {
    console.log(`\n=== Checking ${filename} ===`);
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));

    console.log('Keys:', Object.keys(data));

    if (data.ideaBankIdea) {
      console.log(`Number of ideaBankIdea records: ${data.ideaBankIdea.length}`);
      if (data.ideaBankIdea.length > 0) {
        console.log('First 3 ideas:');
        data.ideaBankIdea.slice(0, 3).forEach((idea, i) => {
          console.log(`  ${i+1}. ${idea.title}`);
        });
      }
    } else if (data.tables && data.tables.ideaBankIdea) {
      console.log(`Number of ideaBankIdea records in tables: ${data.tables.ideaBankIdea.length}`);
      if (data.tables.ideaBankIdea.length > 0) {
        console.log('First 3 ideas:');
        data.tables.ideaBankIdea.slice(0, 3).forEach((idea, i) => {
          console.log(`  ${i+1}. ${idea.title}`);
        });
      }
    } else {
      console.log('No ideaBankIdea found in this export');
    }

  } catch (error) {
    console.error(`Error reading ${filename}:`, error.message);
  }
}

checkExportFile('database-export.json');
checkExportFile('database-export-improved.json');
