import type { Logger } from "pino";

export type Mail = { to: string; subject: string; text: string; link?: string };

export interface Mailer {
  readonly kind: "console" | "provider";
  send(mail: Mail): Promise<void>;
}

/** ADR-005 fallback without a provider: writes the mail (incl. link) to the log. */
export class ConsoleMailer implements Mailer {
  readonly kind = "console" as const;

  constructor(private readonly logger: Logger) {}

  async send(mail: Mail): Promise<void> {
    this.logger.info(
      { mail: { to: mail.to, subject: mail.subject, link: mail.link } },
      "mail (console mailer — not sent)",
    );
  }
}
