import { CONTACT_EMAIL } from '../lib/config';

/** How to reach whoever runs Arbiter, for privacy and account requests. */
export function Contact() {
  if (CONTACT_EMAIL) return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
  return (
    <>
      the project owner via{' '}
      <a href="https://github.com/sweksha-cloud/arbiter" target="_blank" rel="noreferrer">
        Arbiter&apos;s GitHub page
      </a>
    </>
  );
}
