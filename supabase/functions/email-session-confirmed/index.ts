import { discordText, sendDiscord } from "../_shared/discordClient.ts";

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
  const session = (payload.session || {}) as SessionPayload;
  const eventType = payload.eventType === "cancelled" ? "cancelled" : "confirmed";
  const appUrl = Deno.env.get("APP_URL") || "https://aldepe.github.io/P-to-Calendario/";
  const failures = [];
  const providers = new Set<string>();

  const discordResult = await sendSessionDiscord({ session, eventType, appUrl });
  providers.add(discordResult.provider);
  if (!discordResult.ok) failures.push({ channel: "discord", message: discordResult.message, provider: discordResult.provider });

  return jsonResponse({
    sent: 0,
    discordSent: discordResult.sent ? 1 : 0,
    attempted: 1,
    failures,
    providers: [...providers],
    eventType
  });
});

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
  const actorLabel = isCancelled ? "Cancelada por" : "Confirmada por";
  const actorName = isCancelled ? session.cancelledBy || "DM" : session.createdBy || "DM";

  return sendDiscord({
    content: `Sesion ${statusLabel}: ${campaignName}`,
    embeds: [{
      title: `${campaignName} ${statusLabel}`,
      url: appUrl,
      color: isCancelled ? 0xd66b5b : 0xd8ad3d,
      fields: [
        { name: "Dia", value: session.date || "sin fecha", inline: true },
        { name: "Franja", value: `${session.slotLabel || ""} ${session.slotTime || ""}`.trim() || "-", inline: true },
        { name: actorLabel, value: actorName, inline: true },
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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
