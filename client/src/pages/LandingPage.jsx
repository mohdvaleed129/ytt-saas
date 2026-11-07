import Hero from '../components/landing/Hero.jsx';
import HowItWorks from '../components/landing/HowItWorks.jsx';
import SampleSection from '../components/landing/SampleSection.jsx';
import Capabilities from '../components/landing/Capabilities.jsx';
import Pricing from '../components/landing/Pricing.jsx';
import Faq from '../components/landing/Faq.jsx';
import { useTitle } from '../hooks/useTitle.js';

export default function LandingPage() {
  useTitle('');
  return (
    <>
      <Hero />
      <HowItWorks />
      <SampleSection />
      <Capabilities />
      <Pricing />
      <Faq />
    </>
  );
}
