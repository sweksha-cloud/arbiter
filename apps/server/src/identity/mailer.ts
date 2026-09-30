import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends email. Production needs a real provider (AWS SES or similar), which
 * isn't chosen yet (BUGS.md OPEN-007); these cover development and tests.
 */
export interface Mailer {
  send(email: Email): Promise<void>;
}

interface MailLog {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
}

/** Development: prints the email, reset link included, to the server log. */
export class LogMailer implements Mailer {
  constructor(private readonly log: MailLog) {}

  async send(email: Email) {
    this.log.info({ to: email.to, subject: email.subject, text: email.text }, 'Email (development: not actually sent)');
  }
}

/** E2E tests: writes each email to a folder the browser tests read reset links from. */
export class OutboxMailer implements Mailer {
  constructor(private readonly dir: string) {}

  async send(email: Email) {
    await mkdir(this.dir, { recursive: true });
    const file = `${Date.now()}-${email.to.replace(/[^a-z0-9@.-]/gi, '_')}.json`;
    await writeFile(path.join(this.dir, file), JSON.stringify(email));
  }
}

/**
 * Production without a provider: says so loudly, and never logs the content,
 * because a reset link in a log is a way into someone's account.
 */
export class UnconfiguredMailer implements Mailer {
  constructor(private readonly log: MailLog) {}

  async send(email: Email) {
    this.log.error({ subject: email.subject }, 'No email provider configured; email not sent');
  }
}
