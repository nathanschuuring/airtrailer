// E-mail versturen via SMTP (nodemailer). Alleen de server laadt dit bestand.
//
// Instellen in Vercel (Project Settings > Environment Variables), daarna opnieuw deployen:
//   SMTP_HOST   bijvoorbeeld smtp.transip.email
//   SMTP_PORT   465 (standaard) of 587
//   SMTP_USER   het e-mailadres van de mailbox waarmee wordt verzonden
//   SMTP_PASS   het wachtwoord van die mailbox
//   MAIL_TO     waar aanvragen binnenkomen, bijvoorbeeld info@airtrailer.nl
//   MAIL_FROM   (optioneel) afzenderadres als dat afwijkt van SMTP_USER
//
// Zolang deze gegevens ontbreken, antwoordt de server met "mail-unavailable" en biedt de pagina
// de bezoeker aan om de samenstelling zelf te mailen. Er gaat dan niets verloren.

import nodemailer from 'nodemailer';

export function createMailer(env = process.env) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_TO } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_TO) {
    return {
      configured: false,
      async send() {
        throw new Error('E-mail is niet ingesteld.');
      },
    };
  }

  const port = Number(env.SMTP_PORT || 465);
  // Op moduleniveau aangemaakt, zodat een warme serverinstantie de verbinding kan hergebruiken.
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });
  const from = { name: 'Airtrailer', address: env.MAIL_FROM || SMTP_USER };

  return {
    configured: true,
    // Zonder `to` gaat het bericht naar Airtrailer; een kopie voor de klant krijgt Airtrailer
    // als antwoordadres.
    send({ to, subject, text, html, replyTo }) {
      return transporter.sendMail({ from, to: to ?? MAIL_TO, replyTo: replyTo ?? (to ? MAIL_TO : undefined), subject, text, html });
    },
  };
}
