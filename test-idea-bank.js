const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testIdeaBank() {
  try {
    console.log('Checking idea_bank_ideas table...');
    const ideaCount = await prisma.ideaBankIdea.count();
    console.log(`Found ${ideaCount} ideas in idea_bank_ideas`);

    if (ideaCount === 0) {
      console.log('No ideas found, checking idea_bank_suggestions...');
      const suggestionCount = await prisma.ideaBankSuggestion.count();
      console.log(`Found ${suggestionCount} suggestions in idea_bank_suggestions`);

      if (suggestionCount > 0) {
        console.log('Found suggestions but no ideas - migration needed!');
      }
    } else {
      console.log('Sample ideas:');
      const ideas = await prisma.ideaBankIdea.findMany({ take: 3 });
      ideas.forEach(idea => {
        console.log(`- ${idea.title} (status: ${idea.status})`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testIdeaBank();
