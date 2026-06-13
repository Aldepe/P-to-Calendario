import { discordText, sendDiscord } from "../_shared/discordClient.ts";
import { sendEmail } from "../_shared/emailClient.ts";

type Recipient = {
  name?: string;
  email?: string;
};

type PersonDetail = {
  name?: string;
  mode?: string;
  reason?: string;
};

type SessionPayload = {
  campaignName?: string;
  date?: string;
  slotLabel?: string;
  slotTime?: string;
  dmNames?: string[];
  absentPlayerNames?: string[];
  createdBy?: string;
  cancelledBy?: string;
  details?: {
    availablePlayers?: PersonDetail[];
    unavailablePlayers?: PersonDetail[];
    availableDms?: PersonDetail[];
    assignedDms?: PersonDetail[];
    modeSummary?: { online?: number; presencial?: number; cualquiera?: number };
    playersTotal?: number;
    availablePlayersCount?: number;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const payload = await request.json();
  const recipients = (payload.recipients || []) as Recipient[];
  const session = (payload.session || {}) as SessionPayload;
  const eventType = payload.eventType === "cancelled" ? "cancelled" : "confirmed";
  const appUrl = Deno.env.get("APP_URL") || "https://example.com";
  const failures = [];
  const providers = new Set<string>();
  let sent = 0;

  for (const recipient of recipients) {
    if (!recipient.email) continue;
    const email = buildSessionEmail({
      recipientName: recipient.name || "mesa",
      session,
      eventType,
      appUrl
    });
    const result = await sendEmail({ to: recipient.email, subject: email.subject, html: email.html, text: email.text });
    providers.add(result.provider);
    if (!result.ok) failures.push({ email: recipient.email, message: result.message, provider: result.provider });
    else sent += 1;
  }

  const discordResult = await sendSessionDiscord({ session, eventType, appUrl });
  providers.add(discordResult.provider);
  if (!discordResult.ok) failures.push({ email: "discord", message: discordResult.message, provider: discordResult.provider });

  return jsonResponse({
    sent,
    discordSent: discordResult.sent ? 1 : 0,
    attempted: recipients.length,
    failures,
    providers: [...providers],
    eventType
  });
});

function buildSessionEmail({
  recipientName,
  session,
  eventType,
  appUrl
}: {
  recipientName: string;
  session: SessionPayload;
  eventType: "confirmed" | "cancelled";
  appUrl: string;
}) {
  const isCancelled = eventType === "cancelled";
  const campaignName = session.campaignName || "Campana";
  const statusLabel = isCancelled ? "cancelada" : "confirmada";
  const accent = isCancelled ? "#d66b5b" : "#d8ad3d";
  const subject = `P*to Calendario: ${campaignName} ${statusLabel}`;
  const details = session.details || {};
  const availablePlayers = details.availablePlayers || [];
  const unavailablePlayers = details.unavailablePlayers || [];
  const availableDms = details.availableDms || [];
  const assignedDms = details.assignedDms || [];
  const modeSummary = details.modeSummary || {};
  const text = [
    `Hola ${recipientName},`,
    "",
    `${campaignName} queda ${statusLabel}.`,
    `Dia: ${session.date || "sin fecha"}`,
    `Franja: ${session.slotLabel || ""} ${session.slotTime || ""}`.trim(),
    `DM disponibles: ${names(availableDms) || namesFromStrings(session.dmNames) || "sin DM"}`,
    `DM asignados a campana: ${names(assignedDms) || namesFromStrings(session.dmNames) || "sin DM"}`,
    `Players disponibles: ${names(availablePlayers) || "nadie"}`,
    `Players ausentes: ${personReasons(unavailablePlayers) || namesFromStrings(session.absentPlayerNames) || "nadie"}`,
    `Modalidad: online ${modeSummary.online || 0}, presencial ${modeSummary.presencial || 0}, ambos ${modeSummary.cualquiera || 0}`,
    isCancelled ? `Cancelada por: ${session.cancelledBy || "DM"}` : `Confirmada por: ${session.createdBy || "DM"}`,
    "",
    `Detalle: ${appUrl}`
  ].join("\n");

  return {
    subject,
    text,
    html: emailShell({
      accent,
      title: `${campaignName} ${statusLabel}`,
      intro: `Hola <b>${escapeHtml(recipientName)}</b>, ${isCancelled ? "la sesion se ha desconfirmado." : "la sesion queda cerrada."}`,
      body: `
        <div style="display:grid;gap:10px;margin:16px 0">
          <div style="padding:12px;border-radius:12px;background:#fff3d1;border:1px solid #efd58e">
            <b>Dia:</b> ${escapeHtml(session.date || "sin fecha")}<br>
            <b>Franja:</b> ${escapeHtml(`${session.slotLabel || ""} ${session.slotTime || ""}`.trim())}<br>
            <b>${isCancelled ? "Cancelada por" : "Confirmada por"}:</b> ${escapeHtml(isCancelled ? session.cancelledBy || "DM" : session.createdBy || "DM")}
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
            ${statBox("Online", modeSummary.online || 0, "#e4f0ff")}
            ${statBox("Presencial", modeSummary.presencial || 0, "#e6f5df")}
            ${statBox("Ambos", modeSummary.cualquiera || 0, "#fff0cb")}
          </div>
        </div>
        <table role="presentation" style="width:100%;border-collapse:collapse;background:#fffdf8;border:1px solid #eadfd7;border-radius:12px;overflow:hidden">
          <tbody>
            ${detailRow("DM disponibles", names(availableDms) || namesFromStrings(session.dmNames) || "sin DM")}
            ${detailRow("DM asignados", names(assignedDms) || namesFromStrings(session.dmNames) || "sin DM")}
            ${detailRow("Players disponibles", names(availablePlayers) || "nadie")}
            ${detailRow("Players ausentes", personReasons(unavailablePlayers) || namesFromStrings(session.absentPlayerNames) || "nadie")}
            ${detailRow("Asistencia", `${details.availablePlayersCount || availablePlayers.length}/${details.playersTotal || Math.max(availablePlayers.length + unavailablePlayers.length, 0)} players`)}
          </tbody>
        </table>
      `,
      ctaLabel: "Ver calendario",
      appUrl
    })
  };
}

async function sendSessionDiscord({
  session,
  eventType,
  appUrl
}: {
  session: SessionPayload;
  eventType: "confirmed" | "cancelled";
  appUrl: string;
}) {
  const isCancelled = eventType === "cancelled";
  const campaignName = session.campaignName || "Campana";
  const details = session.details || {};
  const availablePlayers = details.availablePlayers || [];
  const unavailablePlayers = details.unavailablePlayers || [];
  const availableDms = details.availableDms || [];
  const assignedDms = details.assignedDms || [];
  const modeSummary = details.modeSummary || {};
  const statusLabel = isCancelled ? "cancelada" : "confirmada";

  return sendDiscord({
    content: `Sesion ${statusLabel}: ${campaignName}`,
    embeds: [{
      title: `${campaignName} ${statusLabel}`,
      url: appUrl,
      color: isCancelled ? 0xd66b5b : 0xd8ad3d,
      fields: [
        { name: "Dia", value: session.date || "sin fecha", inline: true },
        { name: "Franja", value: `${session.slotLabel || ""} ${session.slotTime || ""}`.trim() || "-", inline: true },
        { name: isCancelled ? "Cancelada por" : "Confirmada por", value: isCancelled ? session.cancelledBy || "DM" : session.createdBy || "DM", inline: true },
        { name: "DM disponibles", value: discordText(names(availableDms) || namesFromStrings(session.dmNames) || "sin DM") },
        { name: "DM asignados", value: discordText(names(assignedDms) || namesFromStrings(session.dmNames) || "sin DM") },
        { name: "Players disponibles", value: discordText(names(availablePlayers) || "nadie") },
        { name: "Players ausentes", value: discordText(personReasons(unavailablePlayers) || namesFromStrings(session.absentPlayerNames) || "nadie") },
        {
          name: "Modalidad",
          value: `Online ${modeSummary.online || 0} | Presencial ${modeSummary.presencial || 0} | Ambos ${modeSummary.cualquiera || 0}`,
          inline: true
        },
        {
          name: "Asistencia",
          value: `${details.availablePlayersCount || availablePlayers.length}/${details.playersTotal || Math.max(availablePlayers.length + unavailablePlayers.length, 0)} players`,
          inline: true
        }
      ],
      footer: { text: "P*to Calendario" },
      timestamp: new Date().toISOString()
    }]
  });
}

function statBox(label: string, value: number, background: string) {
  return `<div style="padding:10px;border-radius:12px;background:${background};border:1px solid #eadfd7;text-align:center"><b style="font-size:20px">${value}</b><br><span style="font-size:12px;color:#6d5b50">${escapeHtml(label)}</span></div>`;
}

function detailRow(label: string, value: string) {
  return `
    <tr>
      <td style="width:36%;padding:10px;border-bottom:1px solid #eadfd7;color:#6d5b50"><b>${escapeHtml(label)}</b></td>
      <td style="padding:10px;border-bottom:1px solid #eadfd7">${escapeHtml(value)}</td>
    </tr>
  `;
}

function names(items: PersonDetail[]) {
  return items.map((item) => item.name).filter(Boolean).join(", ");
}

function namesFromStrings(items?: string[]) {
  return (items || []).filter((item) => item && item !== "nadie").join(", ");
}

function personReasons(items: PersonDetail[]) {
  return items
    .map((item) => {
      const mode = item.mode ? `, ${item.mode}` : "";
      const reason = item.reason ? `: ${item.reason}` : "";
      return `${item.name || "Sin nombre"}${mode}${reason}`;
    })
    .join("; ");
}

function emailShell({ accent, title, intro, body, ctaLabel, appUrl }: {
  accent: string;
  title: string;
  intro: string;
  body: string;
  ctaLabel: string;
  appUrl: string;
}) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#f6eee7;color:#3a302b;padding:24px">
      <div style="max-width:680px;margin:auto;border:1px solid #eadfd7;border-radius:18px;padding:22px;background:#fffaf4;box-shadow:0 10px 30px rgba(84,62,45,.12)">
        <p style="color:#7b6557;text-transform:uppercase;font-weight:800;letter-spacing:.08em;margin:0 0 8px">P*to Calendario</p>
        <h1 style="margin:0 0 12px;color:#332721;border-bottom:3px solid ${accent};padding-bottom:10px">${escapeHtml(title)}</h1>
        <p style="font-size:16px;line-height:1.55">${intro}</p>
        ${body}
        <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:18px;background:${accent};color:#2b2119;padding:12px 16px;border-radius:10px;font-weight:800;text-decoration:none">${escapeHtml(ctaLabel)}</a>
      </div>
    </div>
  `;
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
