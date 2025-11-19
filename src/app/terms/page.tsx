import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service | PatentNest.ai',
  description: 'Terms of Service and usage policy for PatentNest.ai',
}

export default function TermsOfServicePage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Terms of Service / Usage Policy</h1>
      <p className="text-gray-700 mb-4">
        Effective date: <span className="italic">[Insert date]</span>
      </p>
      <p className="text-gray-700 mb-6">
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of the website, web application, and
        services provided at <span className="font-mono">patentnest.ai</span> (collectively, the &quot;Service&quot;).
        By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, you must not use
        the Service.
      </p>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">1. Description of the Service</h2>
        <p className="text-gray-700">
          PatentNest AI provides an AI-powered platform designed to assist with patent-related research and analysis,
          including novelty search, prior-art discovery, and related analytics (the &quot;Purpose&quot;). The Service
          and all outputs are for informational and research purposes only, do not constitute legal or professional
          advice, and should not be relied upon as a substitute for independent legal, technical, or business advice.
          PatentNest is not a law firm and does not provide legal representation or create any attorney-client
          relationship.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">2. Eligibility and Accounts</h2>
        <p className="text-gray-700 mb-3">
          You represent that you are at least the age of majority in your jurisdiction and have the authority to enter
          into these Terms on behalf of yourself or any organization you represent.
        </p>
        <p className="text-gray-700">
          You may be required to create an account to access certain features. You agree to provide accurate, current,
          and complete information, keep it updated, maintain the confidentiality of your login credentials, and accept
          responsibility for all activities that occur under your account. You must notify us promptly of any
          unauthorized use or security breach.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">3. User Content and License</h2>
        <p className="text-gray-700 mb-3">
          &quot;User Content&quot; means any data, documents, text, files, patent numbers, comments, and other material
          that you upload, submit, or otherwise provide through the Service. You retain ownership of your User Content.
        </p>
        <p className="text-gray-700">
          You grant PatentNest a worldwide, non-exclusive, royalty-free license to use, reproduce, process, transmit,
          and display your User Content solely to operate, maintain, and improve the Service and as otherwise described
          in our Privacy Policy. You represent and warrant that you have all necessary rights to submit the User
          Content and grant this license and that your User Content does not infringe or violate any third-party rights
          or applicable laws.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">4. Acceptable Use</h2>
        <p className="text-gray-700 mb-3">You agree not to:</p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>Use the Service for any unlawful, harmful, fraudulent, infringing, or misleading purpose.</li>
          <li>
            Upload or transmit any User Content that is illegal, obscene, defamatory, harassing, or otherwise
            objectionable.
          </li>
          <li>Attempt to gain unauthorized access to the Service or related systems or circumvent security controls.</li>
          <li>
            Reverse engineer, decompile, or attempt to derive the source code, models, or underlying ideas of the
            Service, except to the extent such restrictions are prohibited by law.
          </li>
          <li>Use the Service to build, train, or improve a competing product or service.</li>
          <li>
            Interfere with or disrupt the integrity or performance of the Service, including by introducing malware or
            harmful code.
          </li>
          <li>Misrepresent your identity or affiliation with any person or entity.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">5. Intellectual Property</h2>
        <p className="text-gray-700">
          All rights, title, and interest in and to the Service, including software, interfaces, designs, text,
          graphics, logos, models, and underlying technology, are owned by PatentNest or its licensors and are
          protected by intellectual property laws. Except as expressly permitted in these Terms, you may not copy,
          modify, distribute, sell, lease, or create derivative works based on the Service. You may use outputs
          generated by the Service for your internal business or personal purposes, subject to these Terms and
          applicable law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">6. No Legal Advice or Guarantees</h2>
        <p className="text-gray-700">
          Outputs from the Service may be incomplete, inaccurate, or outdated and may not reflect current law or
          practice. The Service does not guarantee novelty, patentability, freedom-to-operate, validity,
          enforceability, or any other legal or business outcome. You are solely responsible for obtaining independent
          professional advice and for verifying any information before relying on it or making decisions. PatentNest is
          not responsible for decisions or actions you take based on the Service or its outputs.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">7. Fees, Billing, and Refund Policy</h2>
        <p className="text-gray-700 mb-3">
          Access to certain features may require payment of fees, subscriptions, or usage-based charges (&quot;Fees&quot;).
          Applicable Fees and billing terms will be described at the point of purchase or in your account. You authorize
          us or our payment processor to charge your chosen payment method for all Fees incurred, including applicable
          taxes.
        </p>
        <p className="text-gray-700 mb-3">
          Subscriptions may automatically renew at the end of each billing period unless you cancel before the renewal
          date in accordance with the instructions in your account.
        </p>
        <p className="text-gray-700">
          <span className="font-semibold">Refund Policy:</span> Except where required by applicable law or expressly
          stated otherwise in writing, all Fees are non-refundable and non-cancellable once the billing period has
          started or credits have been used. We may, at our sole discretion, offer refunds or credits in limited
          circumstances (for example, if the Service is unavailable for an extended period due to our fault). Any such
          accommodation is one-time only and does not entitle you to future refunds. If mandatory consumer protection
          laws in your jurisdiction grant you additional rights (such as a withdrawal or cooling-off period), those
          rights will apply to the extent required by law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">8. Termination</h2>
        <p className="text-gray-700">
          You may stop using the Service at any time. We may suspend or terminate your access to the Service, in whole
          or in part, at any time with or without notice if we reasonably believe you have violated these Terms, pose a
          risk to the Service or others, or if we discontinue the Service. Upon termination, your right to access and
          use the Service will immediately cease. Sections relating to intellectual property, disclaimers, limitations
          of liability, and indemnification will survive termination.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">9. Disclaimers</h2>
        <p className="text-gray-700">
          To the maximum extent permitted by law, the Service is provided on an &quot;AS IS&quot; and &quot;AS
          AVAILABLE&quot; basis without warranties of any kind, whether express, implied, or statutory. We disclaim all
          warranties, including implied warranties of merchantability, fitness for a particular purpose, non-infringement,
          and any warranties arising from course of dealing or usage of trade. We do not warrant that the Service will
          be uninterrupted, secure, error-free, or free of harmful components, or that any defects will be corrected,
          or that any outputs or results are accurate, complete, or reliable.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">10. Limitation of Liability</h2>
        <p className="text-gray-700">
          To the maximum extent permitted by law, PatentNest and its affiliates, officers, employees, agents, and
          licensors shall not be liable for any indirect, incidental, consequential, special, exemplary, or punitive
          damages, or for any loss of profits, revenues, data, or goodwill, arising out of or in connection with the
          Service or these Terms, whether based on contract, tort, strict liability, or any other legal theory, even if
          we have been advised of the possibility of such damages. Our total aggregate liability for any claim arising
          out of or related to the Service or these Terms shall not exceed the greater of (a) the amount you paid to us
          for the Service during the three (3) months immediately preceding the event giving rise to the claim, and (b)
          <span className="italic"> [Insert modest fixed amount and currency]</span>. Some jurisdictions do not allow
          certain limitations; in such cases, these limitations apply only to the extent permitted by law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">11. Indemnification</h2>
        <p className="text-gray-700">
          You agree to indemnify, defend, and hold harmless PatentNest and its affiliates, officers, employees, and
          agents from and against any claims, liabilities, damages, losses, and expenses (including reasonable
          attorneys&apos; fees) arising out of or in any way connected with your use of the Service, your User Content,
          your violation of these Terms, or your violation of any law or the rights of any third party.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">12. Governing Law and Dispute Resolution</h2>
        <p className="text-gray-700">
          These Terms are governed by the laws of{' '}
          <span className="italic">[Insert governing jurisdiction]</span>, without regard to its conflict of law
          principles. Any disputes arising out of or relating to these Terms or the Service shall be subject to the
          exclusive jurisdiction of the courts located in{' '}
          <span className="italic">[Insert city and country/state]</span>, and you consent to personal jurisdiction in
          such courts. If mandatory consumer protection or other laws in your jurisdiction require a different governing
          law or forum, those requirements will apply to the extent required by law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">13. Changes to These Terms</h2>
        <p className="text-gray-700">
          We may modify these Terms from time to time. When we do, we will update the &quot;Effective date&quot; above
          and may provide additional notice as appropriate. Your continued use of the Service after the updated Terms
          become effective constitutes your acceptance of the changes.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">14. Contact Information</h2>
        <p className="text-gray-700">
          If you have questions about these Terms or the Service, please contact us at:
          <br />
          <span className="italic">[Insert company name]</span>
          <br />
          Email: <span className="italic">[Insert contact email]</span>
          <br />
          Address: <span className="italic">[Insert postal address, including jurisdiction]</span>
        </p>
      </section>
    </main>
  )
}

