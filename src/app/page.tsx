import HeroSection from '@/components/home/HeroSection'
import TrustSection from '@/components/home/TrustSection'
import HowItWorksSection from '@/components/home/HowItWorksSection'
import EmotionalSection from '@/components/home/EmotionalSection'
import ComparisonSection from '@/components/home/ComparisonSection'
import FeaturesSection from '@/components/home/FeaturesSection'
import SocialProofSection from '@/components/home/SocialProofSection'
import GuidedChoiceSection from '@/components/home/GuidedChoiceSection'
import CTAFooter from '@/components/home/CTAFooter'
import MinimalFooter from '@/components/home/MinimalFooter'

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <HeroSection />
      <TrustSection />
      <HowItWorksSection />
      <EmotionalSection />
      <ComparisonSection />
      <FeaturesSection />
      <SocialProofSection />
      <GuidedChoiceSection />
      <CTAFooter />
      <MinimalFooter />
    </div>
  )
}

