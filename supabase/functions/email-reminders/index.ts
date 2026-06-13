import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { discordText, sendDiscord } from "../_shared/discordClient.ts";

type ParticipantRow = {
  id: string;
  name: string;
  role: string | null;
  filled_until: string | null;
  availability_by_week: Record<string, unknown> | null;
};

const TIME_ZONE = Deno.env.get("APP_TIME_ZONE") || "Europe/Madrid";
const NOTIFICATION_META_KEY = "__notifications";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["POST", "GET"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const payload = await readPayload(request);
  const today = todayIso();
  const weekKey = currentWeekMondayIso(today);
  const requiredUntil = addDaysIso(weekKey, 6);
  const appUrl = Deno.env.get("APP_URL") || "https://aldepe.github.io/P-to-Calendario/";
  const isTest = Boolean(payload?.test);

  const { data, error } = await supabase
    .from("participants")
    .select("id, name, role, filled_until, availability_by_week")
    .order("name");

  if (error) return new Response(error.message, { status: 500, headers: corsHeaders });

  const players = ((data || []) as ParticipantRow[]).filter((participant) => (participant.role || "player") === "player");
  const pendingPlayers = players.filter((participant) => needsReminder(participant, requiredUntil));
  const pendingNames = pendingPlayers.map((participant) => participant.name).join(", ") || "nadie";
  const alreadySentCount = pendingPlayers.filter((participant) => wasReminderSentToday(participant, today)).length;
  const alreadySentToday = pendingPlayers.length > 0 && alreadySentCount === pendingPlayers.length;
  const shouldSend = isTest || (pendingPlayers.length > 0 && !alreadySentToday);
  const statusRows = players.map((participant) => participantStatus(participant, requiredUntil, today));
  const failures = [];
  const providers = new Set<string>();

  const discordResult = await sendReminderDiscord({
    pendingNames,
    pendingCount: pendingPlayers.length,
    alreadySentCount,
    requiredUntil,
    weekKey,
    today,
    appUrl,
    statusRows,
    isTest,
    shouldSend,
    skipReason: pendingPlayers.length === 0 ? "La semana esta completa." : "El recordatorio ya se publico hoy."
  });

  providers.add(discordResult.provider);
  if (!discordResult.ok) failures.push({ channel: "discord", message: discordResult.message, provider: discordResult.provider });

  if (!isTest && discordResult.ok && discordResult.sent) {
    await Promise.all(pendingPlayers.map((participant) => markReminderSent(participant.id, participant.availability_by_week || {}, today)));
  }

  return jsonResponse({
    sent: 0,
    discordSent: discordResult.sent ? 1 : 0,
    attempted: shouldSend ? 1 : 0,
    pendingCount: pendingPlayers.length,
    pendingNames,
    skippedAlreadySentToday: alreadySentToday ? pendingPlayers.length : 0,
    skippedCompleted: players.length - pendingPlayers.length,
    failures,
    providers: [...providers],
    test: isTest,
    alreadySentToday,
    weekKey,
    requiredUntil
  });
});

async function readPayload(request: Request) {
  if (request.method !== "POST") return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function needsReminder(participant: ParticipantRow, requiredUntil: string) {
  return !isFilledThroughRequiredDate(participant.filled_until, requiredUntil);
}

function isFilledThroughRequiredDate(filledUntil: string | null, requiredUntil: string) {
  return Boolean(filledUntil && filledUntil >= requiredUntil);
}

function wasReminderSentToday(participant: ParticipantRow, today: string) {
  const meta = participant.availability_by_week?.[NOTIFICATION_META_KEY] as Record<string, string> | undefined;
  return meta?.reminderSentOn === today;
}

async function markReminderSent(participantId: string, availabilityByWeek: Record<string, unknown>, today: string) {
  const nextAvailabilityByWeek = {
    ...availabilityByWeek,
    [NOTIFICATION_META_KEY]: {
      ...((availabilityByWeek[NOTIFICATION_META_KEY] as Record<string, unknown>) || {}),
      reminderSentOn: today
    }
  };
  const { error } = await supabase
    .from("participants")
    .update({ availability_by_week: nextAvailabilityByWeek })
    .eq("id", participantId);
  if (error) throw error;
}

function participantStatus(participant: ParticipantRow, requiredUntil: string, today: string) {
  const filled = isFilledThroughRequiredDate(participant.filled_until, requiredUntil);
  const sentToday = wasReminderSentToday(participant, today);
  return {
    name: participant.name,
    filledUntil: participant.filled_until || "sin fecha",
    status: filled ? "al dia" : sentToday ? "avisado hoy" : "pendiente"
  };
}

async function sendReminderDiscord({
  pendingNames,
  pendingCount,
  alreadySentCount,
  requiredUntil,
  weekKey,
  today,
  appUrl,
  statusRows,
  isTest,
  shouldSend,
  skipReason
}: {
  pendingNames: string;
  pendingCount: number;
  alreadySentCount: number;
  requiredUntil: string;
  weekKey: string;
  today: string;
  appUrl: string;
  statusRows: Array<{ name: string; filledUntil: string; status: string }>;
  isTest: boolean;
  shouldSend: boolean;
  skipReason: string;
}) {
  if (!shouldSend) {
    return { ok: true, sent: false, provider: "discord-skipped", message: skipReason };
  }

  const title = isTest ? "Prueba de recordatorio" : "Falta rellenar disponibilidad";
  const content = isTest
    ? "Prueba de recordatorio de P*to Calendario."
    : `Recordatorio: ${pendingCount} player(s) pendientes de rellenar la semana.`;

  return sendDiscord({
    content,
    embeds: [{
      title,
      url: appUrl,
      color: 0xd8ad3d,
      fields: [
        { name: "Semana", value: `${weekKey} - ${requiredUntil}`, inline: true },
        { name: "Hoy", value: today, inline: true },
        { name: "Pendientes", value: discordText(`${pendingCount}: ${pendingNames}`) },
        { name: "Avisados hoy antes de este envio", value: String(alreadySentCount), inline: true },
        {
          name: "Estado de players",
          value: discordText(statusRows.map((row) => `${row.name}: ${row.status}. Rellenado hasta: ${row.filledUntil}`).join("\n") || "Sin players")
        }
      ],
      footer: { text: "P*to Calendario" },
      timestamp: new Date().toISOString()
    }]
  });
}

function todayIso() {
  return formatInTimeZone(new Date(), TIME_ZONE);
}

function currentWeekMondayIso(today: string) {
  const date = parseIsoDate(today);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return toIsoDate(date);
}

function addDaysIso(baseIso: string, days: number) {
  const date = parseIsoDate(baseIso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
