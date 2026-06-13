import { buildSessionMessage } from "../domain/notificationMessages.js";

export class ConsoleNotificationGateway {
  async sendSessionConfirmed(payload) {
    console.info("Aviso simulado", {
      message: buildSessionMessage(payload.session),
      recipients: payload.recipients.map((recipient) => ({ name: recipient.name, email: recipient.email }))
    });
    return { mode: "simulation", sent: payload.recipients.filter((recipient) => recipient.email).length };
  }

  async sendReminderTest(payload) {
    console.info("Recordatorio simulado", payload);
    return { mode: "simulation", sent: payload.recipient?.email ? 1 : 0 };
  }

  async sendSessionTest(payload) {
    return this.sendSessionConfirmed({
      session: payload.session,
      confirmedBy: payload.recipient,
      recipients: [payload.recipient]
    });
  }
}

export class SupabaseNotificationGateway {
  constructor(client, fallback) {
    this.client = client;
    this.fallback = fallback;
  }

  async sendSessionConfirmed(payload) {
    try {
      const { data, error } = await this.client.functions.invoke("email-session-confirmed", {
        body: payload
      });
      if (error) throw error;
      return data;
    } catch (error) {
      console.warn("Notificacion remota fallida, usando simulacion local.", error);
      return this.fallback.sendSessionConfirmed(payload);
    }
  }

  async sendReminderTest(payload) {
    const { data, error } = await this.client.functions.invoke("email-reminders", {
      body: {
        test: true,
        testRecipient: payload.recipient
      }
    });
    if (error) throw error;
    return data;
  }

  async sendSessionTest(payload) {
    const { data, error } = await this.client.functions.invoke("email-session-confirmed", {
      body: {
        recipients: [payload.recipient],
        session: payload.session
      }
    });
    if (error) throw error;
    return data;
  }
}
