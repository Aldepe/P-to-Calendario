import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY")!);
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (request) => {
  if (!["POST", "GET"].includes(request.method)) return new Response("Method not allowed", { status: 405 });

  const payload = await readPayload(request);
  const requiredUntil = currentWeekSundayIso();
  const weekKey = currentWeekMondayIso();
  const appUrl = Deno.env.get("APP_URL") || "https://example.com";
  const from = Deno.env.get("EMAIL_FROM") || "P*to Calendario <onboarding@resend.dev>";

  const { data: participants, error } = await supabase
    .from("participants")
    .select("name, email, filled_until, availability_by_week")
    .not("email", "is", null);

  if (error) return new Response(error.message, { status: 500 });

  const pendingRecipients = (participants || []).filter((participant) => !isWeekComplete(participant, weekKey, requiredUntil));
  const pendingNames = pendingRecipients.map((recipient) => recipient.name).join(", ") || "nadie";
  const testRecipient = payload?.testRecipient?.email ? payload.testRecipient : null;
  const recipients = testRecipient ? [testRecipient] : pendingRecipients;
  const results = [];

  for (const recipient of recipients) {
    const subject = testRecipient
      ? "P*to Calendario: prueba de recordatorio"
      : `P*to Calendario: falta rellenar la semana hasta ${requiredUntil}`;
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;background:#f7f8ff;color:#352d2a;padding:24px">
        <div style="max-width:620px;margin:auto;border:1px solid #ddd7ef;border-radius:10px;padding:20px;background:#fffdf9">
          <p style="color:#7b6d66;text-transform:uppercase;font-weight:800;margin:0 0 8px">P*to Calendario</p>
          <h1 style="margin:0 0 12px;color:#352d2a">${testRecipient ? "Prueba de recordatorio" : "Falta rellenar disponibilidad"}</h1>
          <p>Hola <b>${escapeHtml(recipient.name)}</b>, ${testRecipient ? "este es un email de prueba del recordatorio diario." : "aun queda gente por rellenar la semana."}</p>
          <p style="padding:12px;border-radius:8px;background:#fff1ef;color:#c94b4b"><b>Pendientes:</b> ${escapeHtml(pendingNames)}</p>
          <p><b>Semana objetivo:</b> hasta ${escapeHtml(requiredUntil)}</p>
          <p>Este aviso se repetira cada dia hasta que el calendario quede completo.</p>
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:10px;background:#dceee7;color:#285545;padding:12px 16px;border-radius:8px;font-weight:800;text-decoration:none">Rellenar calendario</a>
        </div>
      </div>
    `;
    results.push(await resend.emails.send({ from, to: recipient.email, subject, html }));
  }

  return Response.json({ sent: results.length, test: Boolean(testRecipient), weekKey, requiredUntil, pendingNames });
});

async function readPayload(request: Request) {
  if (request.method !== "POST") return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function currentWeekMonday() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - day + 1);
  return monday;
}

function currentWeekMondayIso() {
  return currentWeekMonday().toISOString().slice(0, 10);
}

function currentWeekSundayIso() {
  const monday = currentWeekMonday();
  monday.setDate(monday.getDate() + 6);
  return monday.toISOString().slice(0, 10);
}

function isWeekComplete(participant: any, weekKey: string, requiredUntil: string) {
  if (!participant.filled_until || participant.filled_until < requiredUntil) return false;
  const availability = participant.availability_by_week?.[weekKey];
  if (!availability) return false;
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const slots = ["morning", "evening"];
  for (const day of days) {
    for (const slot of slots) {
      const entry = availability?.[day]?.[slot];
      if (!entry) return false;
      if (!entry.available && !String(entry.reason || "").trim()) return false;
    }
  }
  return true;
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
