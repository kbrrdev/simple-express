import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      // A password must never travel unencrypted. Mailpit needs no login, so it is exempt.
      requireTLS: Boolean(env.SMTP_USER),
      ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }),
    })
  : undefined;

interface Email {
  to: string;
  subject: string;
  text: string;
}

/** Recipients and content stay out of the logs, as they can hold personal data and private links. */
export async function sendEmail({ to, subject, text }: Email) {
  if (!transport) throw new Error('Email is not configured. Set SMTP_HOST.');

  await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text });
  logger.info('Email sent');
}

export function closeEmail() {
  transport?.close();
}
