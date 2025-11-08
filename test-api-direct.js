// Simple test to call the idea-bank API directly
const { PrismaClient } = require('@prisma/client');
const { IdeaBankService } = require('./src/lib/idea-bank-service');

const prisma = new PrismaClient();

async function testAPI() {
  try {
    // Get the analyst user
    const user = await prisma.user.findFirst({
      where: { email: 'analyst@spotipr.com' }
    });

    if (!user) {
      console.log('User not found');
      return;
    }

    console.log('Testing with user:', user.email);

    // Test the service directly
    const ideaBankService = new IdeaBankService();
    const result = await ideaBankService.searchIdeas({}, {}, user, 1, 20);

    console.log('✅ API call successful!');
    console.log(`Found ${result.totalCount} ideas, showing ${result.ideas.length}`);
    if (result.ideas.length > 0) {
      console.log('Sample idea:', result.ideas[0].title);
    }

  } catch (error) {
    console.error('❌ API call failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testAPI();
