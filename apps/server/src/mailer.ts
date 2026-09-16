import nodemailer from "nodemailer";
import type { AppConfig } from "./config.js";

export interface Mailer {
  sendMagicLink(email: string, verifyUrl: string): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  async sendMagicLink(email: string, verifyUrl: string) {
    process.stdout.write(`Magic link for ${email}: ${verifyUrl}\n`);
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(private readonly config: AppConfig) {
    this.transport = nodemailer.createTransport(config.SMTP_URL!);
  }

  async sendMagicLink(email: string, verifyUrl: string) {
    await this.transport.sendMail({
      from: this.config.EMAIL_FROM,
      to: email,
      subject: "Sign in to OpenRound",
      text: `Use this link to sign in. It expires in 15 minutes.\n\n${verifyUrl}\n\nIf you did not request it, ignore this email.`,
      html: `<p>Use this link to sign in. It expires in 15 minutes.</p><p><a href="${verifyUrl}">Sign in to OpenRound</a></p><p>If you did not request it, ignore this email.</p>`,
    });
  }
}
