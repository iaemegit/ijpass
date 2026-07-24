import 'dotenv/config';
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
if (!host || !user || !pass) throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured');

const transporter = nodemailer.createTransport({
  host,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user, pass }
});

try {
  await transporter.verify();
  console.log(`SMTP connection verified successfully for ${user}`);
} catch (error) {
  const mailError = error as { code?: string; response?: string; message?: string };
  console.error(`SMTP verification failed: ${mailError.code || 'UNKNOWN'} ${mailError.response || mailError.message || ''}`);
  process.exitCode = 1;
}
