const MAIL_SECRET = "CAMBIA_ESTE_SECRETO_LARGO";

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    if (payload.secret !== MAIL_SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }

    const to = String(payload.to || "").trim();
    const subject = String(payload.subject || "").trim();
    const html = String(payload.html || "");
    const text = String(payload.text || stripHtml(html));

    if (!to || !subject || !text) {
      return jsonResponse({ ok: false, error: "Missing to, subject or body" });
    }

    MailApp.sendEmail({
      to,
      subject,
      body: text,
      htmlBody: html,
      name: "P*to Calendario"
    });

    return jsonResponse({ ok: true, remainingDailyQuota: MailApp.getRemainingDailyQuota() });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function stripHtml(value) {
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
