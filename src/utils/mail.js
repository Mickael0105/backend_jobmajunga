import nodemailer from "nodemailer";

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendPasswordResetEmail({ to, resetUrl }) {
  if (!smtpConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`[jobmajunga2] Password reset link for ${to}: ${resetUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: String(process.env.SMTP_SECURE ?? "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const from = process.env.SMTP_FROM ?? "no-reply@jobmajunga.local";

  await transporter.sendMail({
    from,
    to,
    subject: "Réinitialisation du mot de passe - JobMajunga2",
    text:
      `Bonjour,\n\n` +
      `Pour réinitialiser votre mot de passe, cliquez sur ce lien :\n${resetUrl}\n\n` +
      `Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n`,
  });
}

