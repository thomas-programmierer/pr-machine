// mailer.js — E-Mail-Versand via Brevo SMTP für die VHS PR-Maschine

require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_KEY
  }
});

/**
 * Sendet eine Benachrichtigung an alle Redakteure/Admins bei neuer Einreichung.
 * @param {object} einreichung — die neue Einreichung
 * @param {Array}  empfaenger  — Array von { name, email } Objekten
 */
async function sendeEinreichungsBenachrichtigung(einreichung, empfaenger) {
  if (!empfaenger || empfaenger.length === 0) return;
  if (!process.env.BREVO_SMTP_KEY) {
    console.warn('[Mailer] BREVO_SMTP_KEY nicht gesetzt — Mail wird nicht gesendet.');
    return;
  }

  const datum = einreichung.datum
    ? new Date(einreichung.datum).toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' })
    : '(kein Datum)';

  const subject = `📬 Neue Einreichung: ${einreichung.anlass || einreichung.kurs || 'Ohne Titel'}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#1A2943">
      <div style="background:#00285A;padding:18px 24px;border-radius:8px 8px 0 0">
        <span style="color:#FAB90F;font-weight:700;font-size:16px">VHS Spandau</span>
        <span style="color:rgba(255,255,255,.6);font-size:13px;margin-left:8px">PR-Maschine</span>
      </div>
      <div style="border:1px solid #dde2e9;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 16px;font-size:17px;color:#00285A">Neue Einreichung eingegangen</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr><td style="padding:6px 0;color:#69829B;width:120px">Anlass</td><td style="padding:6px 0;font-weight:600">${einreichung.anlass || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#69829B">Kurs</td><td style="padding:6px 0">${einreichung.kurs || '—'}${einreichung.kursNr ? ' · ' + einreichung.kursNr : ''}</td></tr>
          <tr><td style="padding:6px 0;color:#69829B">Datum</td><td style="padding:6px 0">${datum}</td></tr>
          <tr><td style="padding:6px 0;color:#69829B">Kanal</td><td style="padding:6px 0">${einreichung.kanal || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#69829B">Eingereicht von</td><td style="padding:6px 0">${einreichung.autor || '—'} (${einreichung.pb || '—'})</td></tr>
        </table>
        ${einreichung.idee ? `<div style="margin-top:16px;padding:12px;background:#F4F6F9;border-radius:6px;font-size:13px;color:#444"><strong>Idee:</strong><br>${einreichung.idee}</div>` : ''}
        <div style="margin-top:20px">
          <a href="https://pr.datenwolke.berlin" style="display:inline-block;background:#00285A;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600">
            → Zur PR-Maschine
          </a>
        </div>
        <p style="margin-top:20px;font-size:11px;color:#969696">Volkshochschule Spandau · vhs-spandau.de · PR-Maschine automatische Benachrichtigung</p>
      </div>
    </div>
  `;

  for (const emp of empfaenger) {
    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM || 'PR-Maschine VHS Spandau <noreply@vhs-spandau.de>',
        to:   `${emp.name} <${emp.email}>`,
        subject,
        html
      });
      console.log(`[Mailer] Mail gesendet an ${emp.email}`);
    } catch (err) {
      console.error(`[Mailer] Fehler bei ${emp.email}:`, err.message);
    }
  }
}

module.exports = { sendeEinreichungsBenachrichtigung };
