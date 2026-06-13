import { buildSessionMessage } from "../domain/notificationMessages.js";

export class ConsoleNotificationGateway {
  async sendSessionConfirmed(payload) {
    console.info("Aviso local", {
      message: buildSessionMessage(payload.session),
      recipients: payload.recipients.map((recipient) => ({ name: recipient.name, email: recipient.email }))
    });
    return { mode: "local", sent: payload.recipients.filter((recipient) => recipient.email).length, discordSent: 0 };
  }

  async sendReminderTest(payload) {
    console.info("Recordatorio local", payload);
    return { mode: "local", sent: payload.recipient?.email ? 1 : 0, discordSent: 0 };
  }

  async sendReminderForParticipant(payload) {
    console.info("Recordatorio inicial local", payload);
    return { mode: "local", sent: payload?.email ? 1 : 0, discordSent: 0 };
  }

  async sendSessionTest(payload) {
    return this.sendSessionConfirmed({
      session: payload.session,
      confirmedBy: payload.recipient,
      recipients: [payload.recipient]
    });
  }

  async sendSessionCancelTest(payload) {
    return this.sendSessionCancelled({
      session: payload.session,
      cancelledBy: payload.recipient,
      recipients: payload.recipient?.email ? [payload.recipient] : []
    });
  }

  async sendSessionCancelled(payload) {
    console.info("Cancelacion local", payload);
    return { mode: "local", sent: payload.recipients.filter((recipient) => recipient.email).length, discordSent: 0 };
  }
}

export class SupabaseNotificationGateway {
  constructor(client, fallback = null) {
    this.client = client;
    this.fallback = fallback;
  }

  async sendSessionConfirmed(payload) {
    try {
      const { data, error } = await this.client.functions.invoke("email-session-confirmed", {
        body: payload
      });
      if (error) throw error;
      assertNotificationResult(data);
      return data;
    } catch (error) {
      if (!this.fallback) throw error;
      console.warn("Notificacion remota fallida, usando salida local.", error);
      return this.fallback.sendSessionConfirmed(payload);
    }
  }

  async sendSessionCancelled(payload) {
    try {
      return await this.sendSessionLifecycle({
        ...payload,
        eventType: "cancelled"
      });
    } catch (error) {
      if (!this.fallback) throw error;
      console.warn("Cancelacion remota fallida, usando salida local.", error);
      return this.fallback.sendSessionCancelled(payload);
    }
  }

  async sendSessionLifecycle(payload) {
    const { data, error } = await this.client.functions.invoke("email-session-confirmed", {
      body: payload
    });
    if (error) throw error;
    assertNotificationResult(data);
    return data;
  }

  async sendReminderTest(payload) {
    const { data, error } = await this.client.functions.invoke("email-reminders", {
      body: {
        test: true,
        testRecipient: payload.recipient
      }
    });
    if (error) throw error;
    assertNotificationResult(data);
    return data;
  }

  async sendReminderForParticipant(participant) {
    const { data, error } = await this.client.functions.invoke("email-reminders", {
      body: {
        participantId: participant.id
      }
    });
    if (error) throw error;
    assertNotificationResult(data, { allowZero: true });
    return data;
  }

  async sendSessionTest(payload) {
    const { data, error } = await this.client.functions.invoke("email-session-confirmed", {
      body: {
        eventType: "confirmed",
        recipients: [payload.recipient],
        session: payload.session
      }
    });
    if (error) throw error;
    assertNotificationResult(data);
    return data;
  }

  async sendSessionCancelTest(payload) {
    const { data, error } = await this.client.functions.invoke("email-session-confirmed", {
      body: {
        eventType: "cancelled",
        recipients: payload.recipient.email ? [payload.recipient] : [],
        session: {
          ...payload.session,
          cancelledBy: payload.recipient.name
        }
      }
    });
    if (error) throw error;
    assertNotificationResult(data);
    return data;
  }
}

function assertNotificationResult(data, options = {}) {
  const failures = Array.isArray(data?.failures) ? data.failures : [];
  if (failures.length) {
    throw new Error(failures.map((failure) => failure.message || failure.email || String(failure)).join(" | "));
  }
  const delivered = Number(data?.sent || 0) + Number(data?.discordSent || 0);
  if (!options.allowZero && delivered <= 0) {
    throw new Error("La funcion respondio, pero no envio ningun aviso. Revisa el email o configura DISCORD_WEBHOOK_URL.");
  }
}
