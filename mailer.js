// mailer.js — E-Mail-Versand via Brevo API für die VHS PR-Maschine
// Kein nodemailer nötig — nutzt Brevo's HTTP Transactional Email API

require('dotenv').config();
const https = require('https');

/**
 * Sendet eine Benachrichtigung an alle Redakteure/Admins bei neuer Einreichung.
 * @param {object} einreichung — die neue Einreichung
 * @param {Array}  empfaenger  — Array von { name, email } Objekten
 */
async function sendeEinreichungsBenachrichtigung(einreichung, empfaenger) {
  if (!empfaenger || empfaenger.length === 0) return;
  if (!process.env.BREVO_API_KEY) {
    console.warn('[Mailer] BREVO_API_KEY nicht gesetzt — Mail wird nicht gesendet.');
    return;
  }

  const datum = einreichung.datum
    ? new Date(einreichung.datum).toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' })
    : '(kein Datum)';

  const htmlContent = `
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

  const payload = JSON.stringify({
    sender: {
      name:  'PR-Maschine VHS Spandau',
      email: process.env.BREVO_SENDER_EMAIL || process.env.BREVO_SMTP_USER
    },
    to: empfaenger.map(e => ({ name: e.name, email: e.email })),
    subject: `📬 Neue Einreichung: ${einreichung.anlass || einreichung.kurs || 'Ohne Titel'}`,
    htmlContent
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path:     '/v3/smtp/email',
      method:   'POST',
      headers: {
        'accept':       'application/json',
        'api-key':      process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Mailer] ${empfaenger.length} Mail(s) gesendet via Brevo API`);
          resolve();
        } else {
          console.error(`[Mailer] Brevo API Fehler ${res.statusCode}:`, body);
          reject(new Error(`Brevo API ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', e => { console.error('[Mailer] Netzwerkfehler:', e.message); reject(e); });
    req.write(payload);
    req.end();
  });
}

module.exports = { sendeEinreichungsBenachrichtigung };
