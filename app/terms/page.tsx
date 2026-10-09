import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Use — OrbitOps',
}

export default function TermsPage() {
  const effectiveDate = 'October 9, 2025'

  return (
    <div className="max-w-2xl mx-auto px-6 py-12 text-sm leading-relaxed" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 className="text-2xl font-bold mb-1">Terms of Use</h1>
      <p className="text-gray-500 mb-8">Effective date: {effectiveDate}</p>

      <p className="mb-6">
        These Terms of Use (&ldquo;Terms&rdquo;) govern your access to and use of OrbitOps (the
        &ldquo;Service&rdquo;), operated by <strong>NicollasBeltraoLLC</strong> (&ldquo;Company&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;). By accessing or using OrbitOps, you
        agree to be bound by these Terms. If you do not agree, do not use the Service.
      </p>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">1. Description of Service</h2>
        <p>
          OrbitOps is a workforce-management platform that allows construction businesses to track employee
          time, manage projects, record expenses and mileage, and oversee field operations. Access is
          granted only to authorized users of a subscribing business.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">2. Eligibility &amp; Authorized Use</h2>
        <p className="mb-2">
          You must be at least 18 years old and authorized by your employer or business to use the Service.
          You are responsible for maintaining the confidentiality of your login credentials and for all
          activity under your account.
        </p>
        <p>
          You agree not to: (a) use the Service for any unlawful purpose; (b) attempt to gain unauthorized
          access to any part of the Service; (c) reverse-engineer, decompile, or disassemble any part of
          the Service; or (d) use the Service to transmit harmful, offensive, or fraudulent content.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">3. Intellectual Property</h2>
        <p>
          The Service, including all software, design, text, graphics, and other content, is the exclusive
          property of NicollasBeltraoLLC and is protected by applicable intellectual property laws. No
          license, right, title, or interest in the Service is transferred to you other than the limited
          right to use it as described in these Terms. You may not copy, reproduce, distribute, or create
          derivative works without our prior written permission.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">4. Business Data &amp; Privacy</h2>
        <p>
          Data entered into OrbitOps by your organization (employee records, time entries, project
          information, etc.) remains owned by your organization. We process this data solely to provide the
          Service. Please review our <a href="/privacy" className="underline text-blue-600">Privacy Policy</a> for
          full details on how we collect, use, and protect information.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">5. Location Data</h2>
        <p>
          Certain features (such as GPS-based clock-in) require access to your device&rsquo;s location.
          Location data is used solely to verify proximity to an authorized job site at the moment of
          clock-in and is not stored beyond what is needed for that verification. You may deny location
          permission at any time, which will disable location-dependent features.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">6. Disclaimer of Warranties</h2>
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES
          OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL
          BE UNINTERRUPTED, ERROR-FREE, OR SECURE.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">7. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, NicollasBeltraoLLC SHALL NOT BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR DATA, ARISING
          OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF THE
          POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM ARISING UNDER THESE TERMS
          SHALL NOT EXCEED THE AMOUNTS YOU PAID US IN THE THREE (3) MONTHS PRECEDING THE CLAIM.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">8. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service at any time, with or without cause, and
          with or without notice. Upon termination, your right to use the Service ceases immediately.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">9. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the United States. Any disputes arising under these Terms
          shall be resolved in the courts of competent jurisdiction.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">10. Changes to Terms</h2>
        <p>
          We may update these Terms from time to time. We will notify users of material changes by updating
          the effective date above. Continued use of the Service after changes constitutes acceptance of the
          revised Terms.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">11. Contact</h2>
        <p>
          For questions about these Terms, please contact us at{' '}
          <a href="mailto:beltraonico@gmail.com" className="underline text-blue-600">
            beltraonico@gmail.com
          </a>
          .
        </p>
      </section>

      <p className="mt-10 text-gray-400 text-xs">
        &copy; {new Date().getFullYear()} NicollasBeltraoLLC. All rights reserved.
      </p>
    </div>
  )
}
