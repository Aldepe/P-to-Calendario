type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

type EmailResult = {
  ok: boolean;
  provider: string;
  message?: string;
};

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const webhookUrl = Deno.env.get("GOOGLE_MAIL_WEBHOOK_URL") || Deno.env.get("EMAIL_WEBHOOK_URL");
  if (webhookUrl) return sendViaGoogleAppsScript(webhookUrl, message);

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (resendApiKey) return sendViaResend(resendApiKey, message);

  return {
    ok: false,
    provider: "none",
    message: "Falta GOOGLE_MAIL_WEBHOOK_URL o RESEND_API_KEY en los secrets de Supabase."
  };
}

async function sendViaGoogleAppsScript(webhookUrl: string, message: EmailMessage): Promise<EmailResult> {
  const secret = Deno.env.get("GOOGLE_MAIL_WEBHOOK_SECRET") || Deno.env.get("EMAIL_WEBHOOK_SECRET") || "";
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...message, secret })
  });
  const bodyText = await response.text();
  const body = parseJson(bodyText);

  if (!response.ok || !body || body.ok !== true) {
    return {
      ok: false,
      provider: "gmail-appscript",
      message: body?.error || body?.message || `Respuesta inesperada de Google Apps Script: ${response.status}: ${bodyText.slice(0, 300)}`
    };
  }

  return { ok: true, provider: "gmail-appscript" };
}

async function sendViaResend(apiKey: string, message: EmailMessage): Promise<EmailResult> {
  const from = Deno.env.get("EMAIL_FROM") || "P*to Calendario <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to: message.to, subject: message.subject, html: message.html, text: message.text })
  });
  const bodyText = await response.text();
  const body = parseJson(bodyText);

  if (!response.ok || body?.error) {
    return {
      ok: false,
      provider: "resend",
      message: body?.error?.message || body?.message || `${response.status}: ${bodyText.slice(0, 300)}`
    };
  }

  return { ok: true, provider: "resend" };
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
