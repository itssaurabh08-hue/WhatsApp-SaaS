import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "@/server/logging/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter;

  constructor(private readonly from: string) {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
    logger.info({ to: maskEmail(message.to), subject: message.subject }, "email sent");
  }
}

/** Keeps emails in memory. Used by automated tests (EMAIL_PROVIDER=memory). */
export class MemoryEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local?.slice(0, 2) ?? ""}***@${domain ?? ""}`;
}

const globalForEmail = globalThis as unknown as { __email?: EmailProvider };

export function getEmailProvider(): EmailProvider {
  if (!globalForEmail.__email) {
    globalForEmail.__email =
      process.env.EMAIL_PROVIDER === "memory"
        ? new MemoryEmailProvider()
        : new SmtpEmailProvider(process.env.EMAIL_FROM ?? "no-reply@localhost");
  }
  return globalForEmail.__email;
}

export function setEmailProvider(provider: EmailProvider) {
  globalForEmail.__email = provider;
}
