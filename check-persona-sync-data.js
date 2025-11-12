const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPersonaSyncData() {
  try {
    const userId = 'cmhru2h3e000c918wsdoj4cwc';
    const userEmail = 'individual@gmail.com';

    console.log('=== PERSONA SYNC DATA FOR USER:', userEmail, '===\n');

    // Style Profiles
    console.log('=== STYLE PROFILES ===');
    const profiles = await prisma.styleProfile.findMany({
      where: { userId: userId }
    });

    if (profiles.length === 0) {
      console.log('No style profiles found.');
    } else {
      profiles.forEach((p, index) => {
        console.log(`${index + 1}. Profile ID: ${p.id}`);
        console.log(`   Version: ${p.version}`);
        console.log(`   Status: ${p.status}`);
        console.log(`   Created: ${p.createdAt.toISOString()}`);
        console.log(`   Updated: ${p.updatedAt.toISOString()}`);
        console.log(`   Locked: ${p.lockedAt ? 'YES (' + p.lockedAt.toISOString() + ')' : 'NO'}`);
        console.log(`   JSON Size: ${JSON.stringify(p.json).length} characters`);

        // Show some key metadata
        if (p.json && p.json.metadata) {
          const meta = p.json.metadata;
          console.log(`   Training Samples: ${meta.training_samples || 'N/A'}`);
          console.log(`   Total Tokens: ${meta.total_tokens || 'N/A'}`);
          console.log(`   Consistency Score: ${meta.entropy_score ? (meta.entropy_score * 100).toFixed(1) + '%' : 'N/A'}`);
          console.log(`   Coverage Score: ${meta.coverage_score ? (meta.coverage_score * 100).toFixed(1) + '%' : 'N/A'}`);
        }
        console.log('');
      });
    }
    console.log(`Total profiles: ${profiles.length}\n`);

    // Style Training Jobs
    console.log('=== STYLE TRAINING JOBS ===');
    const jobs = await prisma.styleTrainingJob.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' }
    });

    if (jobs.length === 0) {
      console.log('No training jobs found.');
    } else {
      jobs.forEach((j, index) => {
        console.log(`${index + 1}. Job ID: ${j.id}`);
        console.log(`   Status: ${j.status}`);
        console.log(`   Created: ${j.createdAt.toISOString()}`);
        console.log(`   Started: ${j.startedAt?.toISOString() || 'N/A'}`);
        console.log(`   Completed: ${j.completedAt?.toISOString() || 'N/A'}`);
        console.log(`   Error: ${j.error || 'None'}`);

        // Show inputs metadata
        if (j.inputsMetadata) {
          const inputs = j.inputsMetadata;
          console.log(`   Document Count: ${inputs.documentCount || inputs.documentIds?.length || 'N/A'}`);
          console.log(`   Jurisdiction Hints: ${inputs.jurisdictionHints ? inputs.jurisdictionHints.join(', ') : 'None'}`);
          console.log(`   Total Tokens: ${inputs.totalTokens || 'N/A'}`);
        }

        // Show metrics
        if (j.metrics) {
          const metrics = j.metrics;
          console.log(`   Final Token Count: ${metrics.totalTokens || 'N/A'}`);
          console.log(`   Entropy Score: ${metrics.entropy ? (metrics.entropy * 100).toFixed(1) + '%' : 'N/A'}`);
          console.log(`   Coverage Score: ${metrics.coverage ? (metrics.coverage * 100).toFixed(1) + '%' : 'N/A'}`);
        }

        console.log('');
      });
    }
    console.log(`Total jobs: ${jobs.length}\n`);

    // Documents
    console.log('=== DOCUMENTS ===');
    const docs = await prisma.document.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' }
    });

    if (docs.length === 0) {
      console.log('No documents found.');
    } else {
      docs.forEach((d, index) => {
        console.log(`${index + 1}. Document ID: ${d.id}`);
        console.log(`   Filename: ${d.filename}`);
        console.log(`   Type: ${d.type}`);
        console.log(`   Tokens: ${d.tokens}`);
        console.log(`   Size: ${(d.sizeBytes / 1024).toFixed(1)} KB`);
        console.log(`   MIME Type: ${d.mimeType || 'N/A'}`);
        console.log(`   Content Path: ${d.contentPtr ? d.contentPtr.split('/').pop() : 'N/A'}`);
        console.log(`   Hash: ${d.hash}`);
        console.log(`   Created: ${d.createdAt.toISOString()}`);
        console.log('');
      });
    }
    console.log(`Total documents: ${docs.length}\n`);

    // Summary
    console.log('=== SUMMARY ===');
    console.log(`User: ${userEmail} (${userId})`);
    console.log(`Style Profiles: ${profiles.length}`);
    console.log(`Training Jobs: ${jobs.length}`);
    console.log(`Documents: ${docs.length}`);

    const completedJobs = jobs.filter(j => j.status === 'COMPLETED').length;
    const failedJobs = jobs.filter(j => j.status === 'FAILED').length;
    const learnedProfiles = profiles.filter(p => p.status === 'LEARNED').length;

    console.log(`Completed Jobs: ${completedJobs}`);
    console.log(`Failed Jobs: ${failedJobs}`);
    console.log(`Learned Profiles: ${learnedProfiles}`);

  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPersonaSyncData();
