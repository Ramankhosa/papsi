const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkProjects() {
  try {
    console.log('🔍 Checking projects in database...\n');

    const projects = await prisma.project.findMany({
      include: {
        user: {
          select: { email: true, id: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`Found ${projects.length} projects:\n`);

    projects.forEach((project, index) => {
      console.log(`${index + 1}. ${project.name}`);
      console.log(`   Project ID: ${project.id}`);
      console.log(`   User: ${project.user.email} (${project.user.id})`);
      console.log(`   Created: ${project.createdAt}`);
      console.log('');
    });

    // Check for Default Projects specifically
    const defaultProjects = projects.filter(p => p.name === 'Default Project');
    console.log(`\n🎯 Default Projects: ${defaultProjects.length}`);
    defaultProjects.forEach(project => {
      console.log(`   - ${project.user.email} has Default Project: ${project.id}`);
    });

  } catch (error) {
    console.error('❌ Error checking projects:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkProjects();
