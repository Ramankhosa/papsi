import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | PatentNest.ai',
  description: 'Privacy Policy for PatentNest.ai',
}

export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Privacy Policy</h1>
      <p className="text-gray-700 mb-4">
        Effective date: <span className="italic">[Insert date]</span>
      </p>
      <p className="text-gray-700 mb-6">
        PatentNest AI (&quot;PatentNest&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the website and
        web application available at <span className="font-mono">patentnest.ai</span> (the &quot;Service&quot;). This Privacy
        Policy explains how we collect, use, share, and protect information when you use the Service.
      </p>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">1. Acceptance</h2>
        <p className="text-gray-700">
          By accessing or using the Service, you agree to this Privacy Policy. If you do not agree, you must not use
          the Service. You should read this policy together with our Terms of Service.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>
            <span className="font-semibold">Account information</span> such as name, email address, password (stored in
            hashed form), organization, and any profile details you provide.
          </li>
          <li>
            <span className="font-semibold">Billing and payment information</span> such as billing name, address, and
            tax details. Payment card details are processed by our payment processor and are not stored in full by us.
          </li>
          <li>
            <span className="font-semibold">Usage and technical data</span> such as IP address, device and browser
            type, operating system, pages viewed, actions taken, timestamps, and referring URLs. We may use cookies and
            similar technologies.
          </li>
          <li>
            <span className="font-semibold">Content you submit</span> such as search queries, uploaded documents,
            patent numbers, notes, and any other information you input or upload to the Service.
          </li>
          <li>
            <span className="font-semibold">Communications</span> such as support requests, feedback, and other
            messages you send to us.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">3. How We Use Information</h2>
        <p className="text-gray-700 mb-3">We use the information we collect to:</p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>Provide, operate, maintain, and secure the Service.</li>
          <li>Process registrations, logins, payments, and transactions.</li>
          <li>Run AI-powered patent and novelty search features and generate outputs based on your inputs.</li>
          <li>Improve and develop the Service, including for troubleshooting, testing, and analytics.</li>
          <li>Communicate with you about the Service, including updates, notices, and support responses.</li>
          <li>Detect, prevent, and address fraud, abuse, security risks, and technical issues.</li>
          <li>Comply with legal obligations and enforce our agreements.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">4. AI and Data Usage</h2>
        <p className="text-gray-700 mb-3">
          We may use your inputs (such as search queries and uploaded documents) and outputs (such as generated
          reports) to operate and improve the Service, including improving our models, algorithms, and features.
        </p>
        <p className="text-gray-700 mb-3">
          Where required by law or your internal policies, you may request that your content not be used to train or
          improve models beyond providing the Service to you. If we offer such options, they will be clearly described
          in your account or workspace settings.
        </p>
        <p className="text-gray-700">
          We may rely on third-party AI or infrastructure providers to process your data solely for the purpose of
          providing the Service, under appropriate confidentiality and data protection agreements.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">5. How We Share Information</h2>
        <p className="text-gray-700 mb-3">
          We do not sell your personal information. We may share information in the following circumstances:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>
            <span className="font-semibold">Service providers</span> that perform services on our behalf, such as
            hosting, cloud infrastructure, analytics, payment processing, and customer support.
          </li>
          <li>
            <span className="font-semibold">Business transfers</span> in connection with a merger, acquisition, or sale
            of all or a portion of our business.
          </li>
          <li>
            <span className="font-semibold">Legal and safety</span> when required by law or to protect our rights, your
            safety, or the safety of others.
          </li>
          <li>
            <span className="font-semibold">Aggregated or de-identified data</span> that does not reasonably identify
            you, for research, analytics, and business purposes.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">6. International Transfers</h2>
        <p className="text-gray-700">
          Your information may be transferred to and processed in countries other than your own, which may have data
          protection laws that differ from those in your jurisdiction. We take reasonable steps to ensure that such
          transfers comply with applicable data protection laws and that your information remains protected.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">7. Data Retention</h2>
        <p className="text-gray-700">
          We retain personal information for as long as necessary to provide the Service, comply with our legal
          obligations, resolve disputes, and enforce our agreements. When information is no longer needed, we will
          delete or anonymize it in accordance with our data retention policies and applicable law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">8. Security</h2>
        <p className="text-gray-700">
          We implement reasonable technical and organizational measures designed to protect your information from
          unauthorized access, loss, misuse, or alteration. However, no method of transmission or storage is completely
          secure, and we cannot guarantee absolute security.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">9. Your Rights and Choices</h2>
        <p className="text-gray-700 mb-3">
          Depending on your jurisdiction, you may have rights such as access, correction, deletion, restriction or
          objection to processing, data portability, and withdrawal of consent where processing is based on consent.
        </p>
        <p className="text-gray-700">
          To exercise these rights, or to update your information, please contact us at{' '}
          <span className="italic">[Insert contact email]</span>. You may opt out of marketing emails by following the
          unsubscribe instructions in those messages or adjusting your account settings.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">10. Cookies and Similar Technologies</h2>
        <p className="text-gray-700">
          We use cookies and similar technologies to operate and improve the Service, remember your preferences, and
          analyze usage. You can control cookies through your browser settings, but disabling cookies may affect certain
          features of the Service.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">11. Children&apos;s Privacy</h2>
        <p className="text-gray-700">
          The Service is not intended for and may not be used by individuals under the age of 16 (or any higher age
          required by applicable law). We do not knowingly collect personal information from children. If you believe a
          child has provided us with personal information, please contact us and we will take appropriate steps to
          delete it.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">12. Changes to This Policy</h2>
        <p className="text-gray-700">
          We may update this Privacy Policy from time to time. The &quot;Effective date&quot; above indicates when this
          policy was last revised. We will notify you of material changes by posting the updated policy on the Service
          and, where appropriate, by other means. Your continued use of the Service after changes become effective
          constitutes your acceptance of the updated policy.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">13. Contact Us</h2>
        <p className="text-gray-700">
          If you have questions or concerns about this Privacy Policy or our data practices, please contact us at:
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

