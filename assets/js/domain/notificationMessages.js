export function buildReminderPreview(pendingParticipants, requiredUntil) {
  const pendingNames = pendingParticipants.map((participant) => participant.name).join(", ") || "nadie";
  return `Recordatorio diario hasta completar calendario. Pendientes hasta ${requiredUntil}: ${pendingNames}.`;
}

export function buildSessionMessage(session) {
  return `${session.campaignName}: sesion confirmada el ${session.date} de ${session.slotTime}. DM: ${session.dmNames.join(", ")}.`;
}

export function buildReminderEmail({ recipientName, pendingNames, requiredUntil, appUrl }) {
  return {
    subject: `P*to Calendario: falta rellenar la semana hasta ${requiredUntil}`,
    text: [
      `Hola ${recipientName},`,
      "",
      "Aun queda gente por rellenar disponibilidad.",
      `Pendientes: ${pendingNames || "nadie"}.`,
      `Semana objetivo: hasta ${requiredUntil}.`,
      "",
      `Entra aqui: ${appUrl}`,
      "",
      "Este aviso se repetira cada dia hasta que el calendario quede completo."
    ].join("\n"),
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#21150f;color:#fff7de;padding:24px">
        <div style="max-width:620px;margin:auto;border:1px solid #f6c655;border-radius:8px;padding:20px;background:#3a2418">
          <p style="color:#f6c655;text-transform:uppercase;font-weight:800;margin:0 0 8px">P*to Calendario</p>
          <h1 style="margin:0 0 12px;color:#ffe5a1">Falta rellenar disponibilidad</h1>
          <p>Hola <b>${escapeHtml(recipientName)}</b>, aun queda gente por rellenar la semana.</p>
          <p style="padding:12px;border-radius:6px;background:#1b100b"><b>Pendientes:</b> ${escapeHtml(pendingNames || "nadie")}</p>
          <p><b>Semana objetivo:</b> hasta ${escapeHtml(requiredUntil)}</p>
          <p>Este aviso se repetira cada dia hasta que el calendario quede completo.</p>
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:10px;background:#f6c655;color:#21150f;padding:12px 16px;border-radius:6px;font-weight:800;text-decoration:none">Rellenar calendario</a>
        </div>
      </div>
    `
  };
}

export function buildSessionEmail({ recipientName, session, appUrl }) {
  return {
    subject: `P*to Calendario: ${session.campaignName} confirmada`,
    text: [
      `Hola ${recipientName},`,
      "",
      `${session.campaignName} queda confirmada.`,
      `Dia: ${session.date}`,
      `Franja: ${session.slotTime}`,
      `DM: ${session.dmNames.join(", ")}`,
      `Ausentes previstos: ${session.absentPlayerNames.join(", ") || "nadie"}`,
      "",
      `Detalle: ${appUrl}`
    ].join("\n"),
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#21150f;color:#fff7de;padding:24px">
        <div style="max-width:620px;margin:auto;border:1px solid #f6c655;border-radius:8px;padding:20px;background:#3a2418">
          <p style="color:#f6c655;text-transform:uppercase;font-weight:800;margin:0 0 8px">P*to Calendario</p>
          <h1 style="margin:0 0 12px;color:#ffe5a1">${escapeHtml(session.campaignName)} confirmada</h1>
          <p>Hola <b>${escapeHtml(recipientName)}</b>, ya hay sesion cerrada.</p>
          <div style="padding:12px;border-radius:6px;background:#1b100b">
            <p><b>Dia:</b> ${escapeHtml(session.date)}</p>
            <p><b>Franja:</b> ${escapeHtml(session.slotTime)}</p>
            <p><b>DM:</b> ${escapeHtml(session.dmNames.join(", "))}</p>
            <p><b>Ausentes previstos:</b> ${escapeHtml(session.absentPlayerNames.join(", ") || "nadie")}</p>
          </div>
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:10px;background:#f6c655;color:#21150f;padding:12px 16px;border-radius:6px;font-weight:800;text-decoration:none">Ver calendario</a>
        </div>
      </div>
    `
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
