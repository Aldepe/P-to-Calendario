import { buildSessionMessage } from "../domain/notificationMessages.js";

export class ConsoleNotificationGateway {
  async sendSessionConfirmed(payload) {
    console.info("Aviso local Discord", {
      message: buildSessionMessage(payload.session),
      eventType: "confirmed"
    });
    return localDiscordResult();
  }

  async sendSessionCancelled(payload) {
    console.info("Cancelacion local Discord", {
      session: payload.session,
      eventType: "cancelled"
    });
    return localDiscordResult();
  }

  async sendReminderTest(payload = {}) {
    console.info("Recordatorio local Discord", payload);
    return localDiscordResult();
  }

  async sendReminderForParticipant(payload = {}) {
    console.info("Recordatorio diario local omitido", payload);
    return { mode: "local", sent: 0, discordSent: 0, skipped: true };
  }

  async sendSessionTest(payload) {
    return this.sendSessionConfirmed({
      session: payload.session,
      confirmedBy: payload.actor
    });
  }

  async sendSessionCancelTest(payload) {
    return this.sendSessionCancelled({
      session: {
        ...payload.session,
        cancelledBy: payload.actor?.name || payload.session?.cancelledBy
      },
      cancelledBy: payload.actor
    });
  }
}

export class SupabaseNotificationGateway {
  constructor(client) {
    this.client = client;
  }

  async sendSessionConfirmed(payload) {
    return this.sendSessionLifecycle({
      ...payload,
      eventType: "confirmed"
    });
  }

  async sendSessionCancelled(payload) {
    return this.sendSessionLifecycle({
      ...payload,
      eventType: "cancelled"
    });
  }

  async sendSessionLifecycle(payload) {
    const { data, error } = await this.client.functions.invoke("email-session-confirmed", {
      body: payload
    });
    if (error) throw error;
    assertDiscordResult(data);
    return data;
  }

  async sendReminderTest() {
    const { data, error } = await this.client.functions.invoke("email-reminders", {
      body: { test: true }
    });
    if (error) throw error;
    assertDiscordResult(data);
    return data;
  }

  async sendReminderForParticipant(participant) {
    const { data, error } = await this.client.functions.invoke("email-reminders", {
      body: {
        participantId: participant.id
      }
    });
    if (error) throw error;
    assertDiscordResult(data, { allowZero: true });
    return data;
  }

  async sendSessionTest(payload) {
    const { data, error } = await this.client.functions.invoke("email-session-confirmed", {
      body: {
        eventType: "confirmed",
        session: payload.session
      }
    });
    if (error) throw error;
    assertDiscordResult(data);
    return data;
  }

  async sendSessionCancelTest(payload) {
    const { data, error } = await this.client.functions.invoke("email-session-confirmed", {
      body: {
        eventType: "cancelled",
        session: {
          ...payload.session,
          cancelledBy: payload.actor?.name || payload.session?.cancelledBy
        }
      }
    });
    if (error) throw error;
    assertDiscordResult(data);
    return data;
  }
}

function localDiscordResult() {
  return { mode: "local", sent: 0, discordSent: 1, providers: ["local-discord"] };
}

function assertDiscordResult(data, options = {}) {
  const failures = Array.isArray(data?.failures) ? data.failures : [];
  if (failures.length) {
    throw new Error(failures.map((failure) => failure.message || failure.channel || failure.provider || String(failure)).join(" | "));
  }
  const discordSent = Number(data?.discordSent || 0);
  if (!options.allowZero && discordSent <= 0) {
    throw new Error("La funcion respondio, pero no publico en Discord. Revisa DISCORD_WEBHOOK_URL en los secrets de Supabase.");
  }
}
