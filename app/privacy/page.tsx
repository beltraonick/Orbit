import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — OrbitOps',
}

export default function PrivacyPage() {
  const effectiveDate = 'October 9, 2025'

  return (
    <div className="max-w-2xl mx-auto px-6 py-12 text-sm leading-relaxed" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 className="text-2xl font-bold mb-1">Privacy Policy</h1>
      <p className="text-gray-500 mb-8">Effective date: {effectiveDate}</p>

      <p className="mb-6">
        This Privacy Policy explains how <strong>NicollasBeltraoLLC</strong> (&ldquo;Company&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) collects, uses, and protects information
        when you use OrbitOps (the &ldquo;Service&rdquo;). By using the Service, you agree to the
        practices described in this Policy.
      </p>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">1. Information We Collect</h2>
        <p className="mb-2">We collect the following categories of information:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Account information:</strong> Name, email address, and role (e.g., administrator,
            employee) provided when your account is created by your employer.
          </li>
          <li>
            <strong>Work records:</strong> Clock-in and clock-out times, hours worked, project
            assignments, daily or hourly pay rates, and attendance records.
          </li>
          <li>
            <strong>Location data:</strong> GPS coordinates at the moment of clock-in, used solely to
            verify that you are within an authorized job-site boundary. Location is not tracked
            continuously.
          </li>
          <li>
            <strong>Expense and mileage data:</strong> Trip records, distances, amounts, and receipt
            images that you or your employer submit through the Service.
          </li>
          <li>
            <strong>Device &amp; usage data:</strong> Basic technical information such as device type,
            operating system version, and error logs, collected automatically to keep the Service running
            reliably.
          </li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">2. How We Use Your Information</h2>
        <p className="mb-2">We use the information we collect to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Provide, operate, and improve the Service.</li>
          <li>Enable your employer to manage payroll, track time, and oversee projects.</li>
          <li>Verify your location when you clock in at a job site.</li>
          <li>Process and export payroll and expense reports.</li>
          <li>Send notifications relevant to your work (e.g., approval status updates).</li>
          <li>Diagnose and fix technical problems.</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">3. How We Share Your Information</h2>
        <p className="mb-2">
          We do not sell your personal information. We may share information only in the following
          circumstances:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Within your organization:</strong> Administrators of your employer&rsquo;s account can
            view records associated with their employees.
          </li>
          <li>
            <strong>Service providers:</strong> We use third-party infrastructure providers (e.g., hosting,
            database) that process data on our behalf under strict confidentiality obligations.
          </li>
          <li>
            <strong>Legal requirements:</strong> We may disclose information if required to do so by law or
            in response to a valid legal process.
          </li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">4. Location Data</h2>
        <p>
          Location access is requested only when you use the clock-in feature and only to check whether
          your device is within the configured radius of a job site. Your GPS coordinates are used
          momentarily for this check and are not stored as a location history or shared with any third
          party. You can deny location permission at any time in your device settings; doing so will
          prevent GPS-based clock-in from working.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">5. Data Retention</h2>
        <p>
          We retain your data for as long as your employer&rsquo;s account is active or as needed to
          provide the Service. When an account is closed, we retain data only as required by applicable law
          and delete it thereafter.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">6. Security</h2>
        <p>
          We use industry-standard security measures, including encrypted sessions, HTTPS-only
          transmission, and role-based access controls, to protect your data. No method of transmission
          over the internet is 100% secure; we cannot guarantee absolute security, but we take all
          reasonable steps to protect your information.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">7. Your Rights</h2>
        <p className="mb-2">
          Depending on your jurisdiction, you may have the right to:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Access the personal data we hold about you.</li>
          <li>Request correction of inaccurate data.</li>
          <li>Request deletion of your data, subject to legal obligations.</li>
          <li>Object to or restrict certain processing of your data.</li>
        </ul>
        <p className="mt-2">
          To exercise any of these rights, contact us at the address below. We will respond within 30
          days.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">8. Children&rsquo;s Privacy</h2>
        <p>
          The Service is intended for use by adults in a professional capacity. We do not knowingly collect
          personal information from anyone under the age of 18.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Material changes will be communicated by
          updating the effective date at the top of this page. Your continued use of the Service after any
          changes constitutes acceptance of the revised Policy.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-base mb-2">10. Contact Us</h2>
        <p>
          If you have questions or concerns about this Privacy Policy, please contact us at:
        </p>
        <p className="mt-2">
          <strong>NicollasBeltraoLLC</strong>
          <br />
          <a href="mailto:beltraonico@gmail.com" className="underline text-blue-600">
            beltraonico@gmail.com
          </a>
        </p>
      </section>

      <p className="mt-10 text-gray-400 text-xs">
        &copy; {new Date().getFullYear()} NicollasBeltraoLLC. All rights reserved.
      </p>
    </div>
  )
}
