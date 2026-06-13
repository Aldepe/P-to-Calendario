type DiscordField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: DiscordField[];
  footer?: { text: string };
  timestamp?: string;
};

type DiscordMessage = {
  content?: string;
  embeds?: DiscordEmbed[];
};

type DiscordResult = {
  ok: boolean;
  sent: boolean;
  provider: string;
  message?: string;
};

export async function sendDiscord(message: DiscordMessage): Promise<DiscordResult> {
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL") || "";
  if (!webhookUrl) {
    return {
      ok: true,
      sent: false,
      provider: "discord-disabled",
      message: "DISCORD_WEBHOOK_URL no configurado."
    };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: Deno.env.get("DISCORD_WEBHOOK_NAME") || "P*to Calendario",
      allowed_mentions: { parse: [] },
      ...message
    })
  });
  const bodyText = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      sent: false,
      provider: "discord",
      message: `${response.status}: ${bodyText.slice(0, 300)}`
    };
  }

  return { ok: true, sent: true, provider: "discord" };
}

export function discordText(value: string, maxLength = 1024) {
  const text = String(value || "").trim() || "-";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
