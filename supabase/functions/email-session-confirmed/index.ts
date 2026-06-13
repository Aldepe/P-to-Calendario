import { Resend } from "npm:resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY")!);

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { recipients, session } = await request.json();
  const appUrl = Deno.env.get("APP_URL") || "https://example.com";
  const from = Deno.env.get("EMAIL_FROM") || "P*to Calendario <onboarding@resend.dev>";
  const results = [];

  for (const recipient of recipients || []) {
    if (!recipient.email) continue;
    const subject = `P*to Calendario: ${session.campaignName} confirmada`;
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;background:#251d28;color:#fff7de;padding:24px">
        <div style="max-width:620px;margin:auto;border:1px solid #f6c655;border-radius:10px;padding:20px;background:#3b3042">
          <p style="color:#f6c655;text-transform:uppercase;font-weight:800;margin:0 0 8px">P*to Calendario</p>
          <h1 style="margin:0 0 12px;color:#ffe5a1">${escapeHtml(session.campaignName)} confirmada</h1>
          <p>Hola <b>${escapeHtml(recipient.name)}</b>, ya hay sesion cerrada.</p>
          <div style="padding:12px;border-radius:8px;background:#211927">
            <p><b>Dia:</b> ${escapeHtml(session.date)}</p>
            <p><b>Franja:</b> ${escapeHtml(session.slotTime)}</p>
            <p><b>DM:</b> ${escapeHtml(session.dmNames.join(", "))}</p>
            <p><b>Ausentes previstos:</b> ${escapeHtml(session.absentPlayerNames.join(", ") || "nadie")}</p>
          </div>
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:10px;background:#f6c655;color:#21150f;padding:12px 16px;border-radius:8px;font-weight:800;text-decoration:none">Ver calendario</a>
        </div>
      </div>
    `;
    results.push(await resend.emails.send({ from, to: recipient.email, subject, html }));
  }

  return Response.json({ sent: results.length, results });
});

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
