import type { Metadata } from 'next';
import Link from 'next/link';

import { Contact } from '../../components/Contact';

export const metadata: Metadata = { title: 'Privacy Policy · Arbiter' };

const EFFECTIVE = '1 October 2026';

export default function PrivacyPage() {
  return (
    <main className="page stack legal">
      <h1>Privacy Policy</h1>
      <p className="muted small">Effective {EFFECTIVE}</p>

      <p>
        Arbiter helps a group of friends decide where to eat. This page explains what it collects, why, who it&apos;s
        shared with, and how long it&apos;s kept. Arbiter is a small personal project: there are no ads, no analytics
        or tracking tools, and your information is never sold.
      </p>

      <h2>What Arbiter collects</h2>
      <h3>When you use it as a guest</h3>
      <ul>
        <li>
          <strong>The name you choose</strong>, shown to people in the sessions you join.
        </li>
        <li>
          <strong>A sign-in token</strong> kept in your browser, so the app remembers you. The server stores only a
          one-way hash of it, which can&apos;t be used to sign in.
        </li>
      </ul>

      <h3>When you make an account</h3>
      <ul>
        <li>
          <strong>Your email address</strong>, to sign you in and to send password-reset and confirmation links.
        </li>
        <li>
          <strong>Your password</strong>, stored only as a salted, slow one-way hash (scrypt). Nobody, including
          whoever runs Arbiter, can read it.
        </li>
        <li>Whether you&apos;ve confirmed your email address.</li>
      </ul>

      <h3>Your preferences</h3>
      <p>
        What you choose in the form: budget, distance, vegetarian, cuisines and kinds of place you like or dislike, fast
        food, vegan options, nutrition goals (calories, protein, carbs) and allergies. They&apos;re saved to fill in the
        form next time and used to pick suggestions.{' '}
        <strong>Nobody else ever sees your preferences.</strong> Others in a session see only that you&apos;ve
        submitted, never what you chose. Allergies are never used to pick places; the group only sees that someone has
        an allergy, never who or what.
      </p>

      <h3>Sessions</h3>
      <ul>
        <li>
          <strong>Your location</strong>, if you share it (your device&apos;s location or a place you type), is used only
          to decide where the group searches. When the group meets between everyone, nobody else in the group sees
          where you&apos;re coming from; they only see that you shared. It&apos;s kept in the server&apos;s memory for
          that session only and <strong>never saved</strong>.
        </li>
        <li>
          <strong>The session record</strong>: its code, who joined, which places were suggested (stored only as
          Google place IDs) and each person&apos;s likes and dislikes. This is kept so people with an account can see
          their past sessions. Others in the session see totals, not who liked what.
        </li>
        <li>
          <strong>Nutrition marks</strong> (&quot;the group says it has vegan options&quot;) are kept for the session
          only.
        </li>
      </ul>

      <h3>Technical information</h3>
      <ul>
        <li>
          <strong>Your IP address</strong> is used to prevent abuse (rate limits, and a daily limit on searches per
          network). These counts are kept in memory only. The server&apos;s request logs also record IP addresses;
          they&apos;re rotated and kept only for a limited time, for troubleshooting.
        </li>
        <li>
          <strong>Your browser&apos;s local storage</strong> holds your sign-in and the code of the session
          you&apos;re in, so you can rejoin. Arbiter uses no cookies.
        </li>
      </ul>

      <h2>Who your information is shared with</h2>
      <ul>
        <li>
          <strong>Google Maps Platform</strong> (Places API and Geocoding API) receives the location of each search, to
          find nearby places, and any place you type, to find it on the map. It doesn&apos;t receive your name, email or preferences. Use of Google Maps features is subject to
          the{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          .
        </li>
        <li>
          <strong>fatsecret</strong> (nutrition for chain restaurants) receives only chain restaurant names, never
          anything about you.
        </li>
        <li>
          <strong>Hosting providers</strong> that store or carry the data on Arbiter&apos;s behalf: Amazon Web
          Services (the server), Neon (the database) and Vercel (the website). They may keep their own technical logs,
          such as IP addresses.
        </li>
        <li>
          <strong>An email provider</strong>, once password-reset emails are switched on, receives your email address
          and the message.
        </li>
        <li>Anyone else only if the law requires it.</li>
      </ul>

      <h2>How long it&apos;s kept</h2>
      <ul>
        <li>Your account, guest name and preferences: until you ask for them to be deleted.</li>
        <li>Session records: until you ask for your data to be deleted.</li>
        <li>Sign-in tokens: they stop working after 90 days without use, and are deleted after that.</li>
        <li>Password-reset links (1 hour) and email-confirmation links (24 hours): deleted within a week after use or expiry.</li>
        <li>Your location, nutrition marks and Google&apos;s place details (names, prices, hours): only during the session.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>You can use Arbiter as a guest, without an email address.</li>
        <li>You don&apos;t have to share your location.</li>
        <li>Every preference is optional; leave any of it blank.</li>
        <li>
          To see, correct or delete your data, contact <Contact />. There isn&apos;t yet a button to delete your
          account in the app, so requests are handled by hand.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Connections are encrypted (HTTPS). Passwords and sign-in tokens are stored only as one-way hashes. No system is
        perfectly secure, but Arbiter is built to keep what it holds to a minimum.
      </p>

      <h2>Children</h2>
      <p>Arbiter isn&apos;t meant for children under 13 and doesn&apos;t knowingly collect their information.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the new version will be posted here with a new effective date.</p>

      <p className="small">
        See also the <Link href="/terms">Terms of Use</Link>.
      </p>
    </main>
  );
}
