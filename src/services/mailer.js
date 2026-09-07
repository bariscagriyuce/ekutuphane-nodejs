// mailer.js — SMTP üzerinden e-kitap gönderimi (PHP'deki SimpleSMTP yerine nodemailer)
import nodemailer from 'nodemailer';
import { getSettings } from '../db.js';

export function smtpConfigured(settings = getSettings()) {
  return Boolean(settings.smtp_host && settings.smtp_user && settings.smtp_pass && settings.smtp_from);
}

function buildTransport(settings) {
  const port = Number(settings.smtp_port || 587);
  const secure = String(settings.smtp_secure || 'tls').toLowerCase() === 'ssl' || port === 465;
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port,
    secure,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    requireTLS: !secure,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
  });
}

/**
 * @param {{to:string, subject:string, text:string, attachment?:{path:string,filename:string}}} opts
 */
export async function sendMail({ to, subject, text, attachment }) {
  const settings = getSettings();
  if (!smtpConfigured(settings)) {
    throw new Error('SMTP ayarları eksik. Yönetici panelinden SMTP bilgilerini tanımlayın.');
  }
  const transport = buildTransport(settings);
  const info = await transport.sendMail({
    from: settings.smtp_from,
    to,
    subject,
    text,
    attachments: attachment ? [attachment] : undefined,
  });
  transport.close();
  return info;
}

export async function verifySmtp() {
  const settings = getSettings();
  if (!smtpConfigured(settings)) throw new Error('SMTP ayarları eksik.');
  const transport = buildTransport(settings);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
