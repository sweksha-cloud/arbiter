import type { Metadata } from 'next';
import Link from 'next/link';

import { Contact } from '../../components/Contact';

export const metadata: Metadata = { title: 'Terms of Use · Arbiter' };

const EFFECTIVE = '1 October 2026';

export default function TermsPage() {
  return (
    <main className="page stack legal">
      <h1>Terms of Use</h1>
      <p className="muted small">Effective {EFFECTIVE}</p>

      <p>
        Arbiter is a free tool that helps a group of friends decide where to eat. By using it, as a guest or with an
        account, you agree to these terms and to the third-party terms listed below. If you don&apos;t agree, please
        don&apos;t use Arbiter.
      </p>

      <h2>Third-party services</h2>
      <p>Arbiter uses other companies&apos; services, and using Arbiter means you also agree to their terms:</p>
      <ul>
        <li>
          <strong>Google Maps.</strong> Place information comes from Google Maps Platform. You agree to be bound by the{' '}
          <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noreferrer">
            Google Maps/Google Earth Additional Terms of Service
          </a>{' '}
          and the{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          .
        </li>
        <li>
          <strong>fatsecret.</strong> Nutrition information for chain restaurants is provided by the fatsecret Platform
          API and is subject to the{' '}
          <a href="https://platform.fatsecret.com/terms" target="_blank" rel="noreferrer">
            fatsecret Platform API Terms of Use
          </a>
          .
        </li>
      </ul>

      <h2>Using Arbiter</h2>
      <ul>
        <li>Use it for its purpose: deciding where to eat with people you know.</li>
        <li>
          Don&apos;t misuse it: no attempts to break, overload or get around its limits, no automated scraping, no
          using someone else&apos;s account, and nothing illegal, abusive or harassing (including in your display
          name).
        </li>
        <li>If you make an account, give a real email address and keep your password to yourself.</li>
        <li>Access may be limited or removed for anyone who misuses Arbiter.</li>
      </ul>

      <h2>What Arbiter&apos;s information is, and isn&apos;t</h2>
      <ul>
        <li>
          <strong>Place details</strong> (names, prices, ratings, opening hours, distances) come from Google and may be
          out of date or wrong. Check before you go.
        </li>
        <li>
          <strong>Nutrition information is not nutrition, dietary or medical advice.</strong> Chain menu figures come
          from fatsecret and may not match what you&apos;re served; &quot;sample&quot; nutrition is invented for
          testing; what the group marks is people&apos;s opinion. It isn&apos;t a substitute for advice from a doctor
          or dietitian.
        </li>
        <li>
          <strong>Allergies:</strong> Arbiter never checks whether a place is safe for an allergy and never chooses
          places based on allergies. Always check with the restaurant.
        </li>
        <li>Suggestions are a starting point for the group&apos;s decision, not a recommendation or endorsement.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        Your name, preferences and reactions stay yours. You let Arbiter store and use them to run the service, as
        described in the <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>No warranty</h2>
      <p>
        Arbiter is a personal project, provided &quot;as is&quot; and &quot;as available&quot;, without warranties of
        any kind. It may change, have errors, or stop working at any time, and sessions in progress can be lost (for
        example when the server restarts).
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, whoever runs Arbiter isn&apos;t liable for any loss or harm from using it,
        including decisions about where or what to eat.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change. The new version will be posted here with a new effective date; continuing to use
        Arbiter means you accept it.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <Contact />.
      </p>
    </main>
  );
}
