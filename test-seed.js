const { PrismaClient } = require('@prisma/client');

async function test() {
  const prisma = new PrismaClient();
  try {
    const userCount = await prisma.user.count();
    const tenantCount = await prisma.tenant.count();
    const planCount = await prisma.plan.count();

    console.log('✅ Database connection successful!');
    console.log(`Users: ${userCount}`);
    console.log(`Tenants: ${tenantCount}`);
    console.log(`Plans: ${planCount}`);

    if (userCount > 0) {
      console.log('✅ Seed data exists!');
    } else {
      console.log('❌ No seed data found - running seed script...');

      // Run seed
      const seed = require('./scripts/comprehensive-seed.js');
      await seed.runComprehensiveSeed({ skipExport: true });
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();
