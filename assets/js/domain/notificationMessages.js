export function buildReminderPreview(pendingParticipants, requiredUntil) {
  const pendingNames = pendingParticipants.map((participant) => participant.name).join(", ") || "nadie";
  return `Recordatorio diario por Discord hasta completar calendario. Pendientes hasta ${requiredUntil}: ${pendingNames}.`;
}

export function buildSessionMessage(session) {
  return `${session.campaignName}: sesion confirmada el ${session.date} de ${session.slotTime}. DM: ${session.dmNames.join(", ")}.`;
}
