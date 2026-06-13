import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/emailClient.ts";

type ParticipantRow = {
  id: string;
  name: string;
  email: string | null;
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
  const appUrl = Deno.env.get("APP_URL") || "https://example.com";

  const { data, error } = await supabase
    .from("participants")
    .select("id, name, email, role, filled_until, availability_by_week")
    .not("email", "is", null)
    .order("name");

  if (error) return new Response(error.message, { status: 500, headers: corsHeaders });

  const participants = (data || []) as ParticipantRow[];
  const pending = participants.filter((participant) => needsReminder(participant, requiredUntil));
  const alreadySentToday = pending.filter((participant) => wasReminderSentToday(participant, today));
  const pendingRecipients = pending.filter((participant) => !wasReminderSentToday(participant, today));
  const pendingNames = pending.map((participant) => participant.name).join(", ") || "nadie";
  const testRecipient = payload?.testRecipient?.email ? payload.testRecipient : null;
  const targetParticipantId = typeof payload?.participantId === "string" ? payload.participantId : "";
  const targetParticipant = targetParticipantId ? pending.find((participant) => participant.id === targetParticipantId) || null : null;
  const targetAlreadySent = targetParticipant ? wasReminderSentToday(targetParticipant, today) : false;
  const targetCompleted = Boolean(targetParticipantId && !targetParticipant);
  const recipients = testRecipient
    ? [testRecipient]
    : targetParticipantId
      ? targetParticipant && !targetAlreadySent ? [targetParticipant] : []
      : pendingRecipients;
  const statusRows = participants.map((participant) => participantStatus(participant, requiredUntil, today));
  const failures = [];
  const providers = new Set<string>();
  let sent = 0;

  for (const recipient of recipients) {
    if (!recipient.email) continue;
    const email = buildReminderEmail({
      recipientName: recipient.name || "mesa",
      pendingNames,
      pendingCount: pending.length,
      alreadySentCount: alreadySentToday.length,
      requiredUntil,
      weekKey,
      today,
      appUrl,
      statusRows,
      isTest: Boolean(testRecipient)
    });
    const result = await sendEmail({ to: recipient.email, subject: email.subject, html: email.html, text: email.text });
    providers.add(result.provider);
    if (!result.ok) {
      failures.push({ email: recipient.email, message: result.message, provider: result.provider });
      continue;
    }

    sent += 1;
    if (!testRecipient && "id" in recipient) await markReminderSent(recipient.id, recipient.availability_by_week || {}, today);
  }

  return jsonResponse({
    sent,
    attempted: recipients.length,
    skippedAlreadySentToday: alreadySentToday.length,
    skippedCompleted: participants.length - pending.length,
    failures,
    providers: [...providers],
    test: Boolean(testRecipient),
    targetParticipantId,
    targetAlreadySent,
    targetCompleted,
    weekKey,
    requiredUntil,
    pendingNames
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
  return Boolean(participant.email) && !isFilledThroughRequiredDate(participant.filled_until, requiredUntil);
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
    role: participant.role === "dm" ? "DM" : "Player",
    filledUntil: participant.filled_until || "sin fecha",
    status: filled ? "al dia" : sentToday ? "avisado hoy" : "pendiente"
  };
}

function buildReminderEmail({
  recipientName,
  pendingNames,
  pendingCount,
  alreadySentCount,
  requiredUntil,
  weekKey,
  today,
  appUrl,
  statusRows,
  isTest
}: {
  recipientName: string;
  pendingNames: string;
  pendingCount: number;
  alreadySentCount: number;
  requiredUntil: string;
  weekKey: string;
  today: string;
  appUrl: string;
  statusRows: Array<{ name: string; role: string; filledUntil: string; status: string }>;
  isTest: boolean;
}) {
  const subject = isTest
    ? "P*to Calendario: prueba de recordatorio"
    : `P*to Calendario: ${pendingCount} pendiente(s) hasta ${requiredUntil}`;
  const text = [
    `Hola ${recipientName},`,
    "",
    isTest ? "Este es un email de prueba del recordatorio diario." : "Toca rellenar disponibilidad de la semana.",
    `Semana: ${weekKey} - ${requiredUntil}`,
    `Pendientes: ${pendingNames}`,
    `Ya avisados hoy: ${alreadySentCount}`,
    "",
    "Estado de la mesa:",
    ...statusRows.map((row) => `- ${row.name} (${row.role}): ${row.status}. Rellenado hasta: ${row.filledUntil}`),
    "",
    `Rellenar: ${appUrl}`
  ].join("\n");
  const rows = statusRows.map((row) => `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid #eadfd7"><b>${escapeHtml(row.name)}</b><br><span style="color:#836f65">${escapeHtml(row.role)}</span></td>
      <td style="padding:9px 10px;border-bottom:1px solid #eadfd7">${escapeHtml(row.filledUntil)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #eadfd7">${statusPill(row.status)}</td>
    </tr>
  `).join("");

  return {
    subject,
    text,
    html: emailShell({
      accent: "#d8ad3d",
      title: isTest ? "Prueba de recordatorio" : "Falta rellenar disponibilidad",
      intro: `Hola <b>${escapeHtml(recipientName)}</b>, ${isTest ? "este es un email de prueba." : "hay gente pendiente de cerrar la semana."}`,
      body: `
        <div style="display:grid;gap:10px;margin:16px 0">
          <div style="padding:12px;border-radius:12px;background:#fff3d1;border:1px solid #efd58e">
            <b>Semana:</b> ${escapeHtml(weekKey)} - ${escapeHtml(requiredUntil)}<br>
            <b>Hoy:</b> ${escapeHtml(today)}
          </div>
          <div style="padding:12px;border-radius:12px;background:#ffe9e4;border:1px solid #f2bdb2;color:#843329">
            <b>Pendientes:</b> ${escapeHtml(pendingNames)}
          </div>
          <div style="padding:12px;border-radius:12px;background:#edf7ef;border:1px solid #cce3d1;color:#315d3c">
            <b>Ya avisados hoy:</b> ${alreadySentCount}
          </div>
        </div>
        <table role="presentation" style="width:100%;border-collapse:collapse;background:#fffdf8;border:1px solid #eadfd7;border-radius:12px;overflow:hidden">
          <thead>
            <tr style="background:#f6ede4;color:#5c493d;text-align:left">
              <th style="padding:9px 10px">Persona</th>
              <th style="padding:9px 10px">Rellenado hasta</th>
              <th style="padding:9px 10px">Estado</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `,
      ctaLabel: "Rellenar calendario",
      appUrl
    })
  };
}

function statusPill(status: string) {
  const palette: Record<string, string> = {
    "al dia": "background:#dff1e5;color:#27633a",
    "avisado hoy": "background:#fff0c5;color:#7a5613",
    pendiente: "background:#ffe0dc;color:#97392f"
  };
  return `<span style="display:inline-block;padding:4px 8px;border-radius:999px;font-weight:700;${palette[status] || palette.pendiente}">${escapeHtml(status)}</span>`;
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
