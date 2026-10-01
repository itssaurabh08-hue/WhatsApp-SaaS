import { brand } from "@/config/brand";
import type { EmailMessage } from "./provider";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
<h2 style="font-size:18px">${escapeHtml(title)}</h2>${bodyHtml}
<p style="color:#666;font-size:12px;margin-top:32px">${escapeHtml(brand.productName)} · ${escapeHtml(brand.supportEmail)}</p>
</body></html>`;
}

function button(url: string, label: string) {
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#666">Or paste this link into your browser:<br>${escapeHtml(url)}</p>`;
}

export function verifyEmailMessage(to: string, name: string, url: string): EmailMessage {
  const subject = `Verify your email for ${brand.productName}`;
  return {
    to,
    subject,
    text: `Hi ${name},\n\nConfirm your email address by opening this link:\n${url}\n\nThe link expires in 24 hours. If you did not create an account, you can ignore this email.`,
    html: layout(
      subject,
      `<p>Hi ${escapeHtml(name)},</p><p>Confirm your email address to finish setting up your account.</p>${button(url, "Verify email")}<p style="font-size:12px;color:#666">The link expires in 24 hours. If you did not create an account, you can ignore this email.</p>`,
    ),
  };
}

export function passwordResetMessage(to: string, name: string, url: string): EmailMessage {
  const subject = `Reset your ${brand.productName} password`;
  return {
    to,
    subject,
    text: `Hi ${name},\n\nReset your password using this link:\n${url}\n\nThe link expires in 1 hour and can be used once. If you did not request this, you can ignore this email.`,
    html: layout(
      subject,
      `<p>Hi ${escapeHtml(name)},</p><p>We received a request to reset your password.</p>${button(url, "Reset password")}<p style="font-size:12px;color:#666">The link expires in 1 hour and can be used once. If you did not request this, you can ignore this email.</p>`,
    ),
  };
}
