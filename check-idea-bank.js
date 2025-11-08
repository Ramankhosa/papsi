const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkIdeaBank() {
  try {
    console.log('=== CHECKING IDEA BANK DATA ===');

    // Check plans
    const plans = await prisma.plan.findMany();
    console.log('\nPlans:', plans.map(p => ({ code: p.code, name: p.name })));

    // Check features
    const features = await prisma.feature.findMany();
    console.log('\nFeatures:', features.map(f => ({ code: f.code, name: f.name })));

    // Check plan features
    const planFeatures = await prisma.planFeature.findMany({
      include: { feature: true, plan: true }
    });
    console.log('\nPlan Features:', planFeatures.map(pf => ({
      plan: pf.plan.code,
      feature: pf.feature.code
    })));

    // Check tenants
    const tenants = await prisma.tenant.findMany();
    console.log('\nTenants:', tenants.map(t => ({ id: t.id, name: t.name })));

    // Check tenant plans
    const tenantPlans = await prisma.tenantPlan.findMany({
      include: { plan: true, tenant: true }
    });
    console.log('\nTenant Plans:', tenantPlans.map(tp => ({
      tenant: tp.tenant.name,
      plan: tp.plan.code
    })));

    // Check ideas
    const ideas = await prisma.ideaBankIdea.findMany();
    console.log('\nIdea Bank Ideas:', ideas.length);
    if (ideas.length > 0) {
      console.log('Sample ideas:', ideas.slice(0, 3).map(i => ({
        title: i.title,
        status: i.status,
        createdBy: i.createdBy
      })));
    }

    // Check users
    const users = await prisma.user.findMany();
    console.log('\nUsers:', users.map(u => ({
      email: u.email,
      role: u.role,
      tenantId: u.tenantId
    })));

    // If no ideas exist, create some sample ideas
    if (ideas.length === 0) {
      console.log('\n=== CREATING SAMPLE IDEAS ===');

      const sampleIdeas = [
        {
          title: "AI-Powered Medical Diagnosis System",
          description: "A machine learning system that analyzes medical images and patient data to provide early disease detection with 95% accuracy. Uses convolutional neural networks and natural language processing to interpret radiological scans and clinical notes.",
          abstract: "An artificial intelligence system for medical diagnosis comprising a neural network trained on large datasets of medical images and clinical data, capable of detecting diseases with high accuracy.",
          domainTags: ["AI/ML", "Medical Devices", "Healthcare"],
          technicalField: "Artificial Intelligence",
          keyFeatures: [
            "Multi-modal data processing",
            "Real-time diagnosis assistance",
            "Explainable AI decisions",
            "Integration with existing EMR systems"
          ],
          potentialApplications: [
            "Radiology departments",
            "Primary care clinics",
            "Emergency medicine",
            "Telemedicine platforms"
          ],
          status: "PUBLIC",
          createdBy: users[0]?.id || "test-user-id"
        },
        {
          title: "Smart Grid Energy Optimization",
          description: "An intelligent energy management system for power grids that uses predictive analytics to optimize energy distribution, reduce waste, and integrate renewable energy sources seamlessly.",
          abstract: "A grid management system using advanced algorithms to optimize energy distribution and integrate renewable sources.",
          domainTags: ["Energy", "IoT", "AI/ML"],
          technicalField: "Power Systems",
          keyFeatures: [
            "Predictive load balancing",
            "Renewable energy integration",
            "Real-time monitoring",
            "Automated fault detection"
          ],
          potentialApplications: [
            "Utility companies",
            "Smart cities",
            "Industrial facilities",
            "Renewable energy farms"
          ],
          status: "PUBLIC",
          createdBy: users[0]?.id || "test-user-id"
        },
        {
          title: "Blockchain-Based Supply Chain Tracking",
          description: "A decentralized supply chain management platform that provides immutable tracking of goods from manufacturing to delivery, ensuring authenticity and preventing counterfeiting.",
          abstract: "A blockchain platform for transparent and secure supply chain management with immutable tracking capabilities.",
          domainTags: ["Blockchain", "Supply Chain", "Security"],
          technicalField: "Distributed Systems",
          keyFeatures: [
            "Immutable product tracking",
            "Smart contract automation",
            "QR code integration",
            "Real-time verification"
          ],
          potentialApplications: [
            "Pharmaceutical industry",
            "Luxury goods",
            "Food safety",
            "Automotive parts"
          ],
          status: "PUBLIC",
          createdBy: users[0]?.id || "test-user-id"
        }
      ];

      for (const ideaData of sampleIdeas) {
        await prisma.ideaBankIdea.create({
          data: ideaData
        });
        console.log(`Created idea: ${ideaData.title}`);
      }

      console.log('\nSample ideas created successfully!');
    }

  } catch (error) {
    console.error('Error checking idea bank:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkIdeaBank();
