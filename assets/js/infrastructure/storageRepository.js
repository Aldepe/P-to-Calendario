import { DAYS, DEFAULT_CAMPAIGNS, SLOTS, addDaysIso, createEmptyAvailability, getWeekStart, normalizeCampaignIds, normalizeCampaigns } from "../domain/sessionRules.js";

const STORAGE_KEY = "mesa-jackpot-calendar-v3";

export class LocalStorageRepository {
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();
    return normalizeState(JSON.parse(raw));
  }

  save(state) {
    const normalized = normalizeState(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }
}

export class SupabaseRepository {
  constructor(client, fallback) {
    this.client = client;
    this.fallback = fallback;
  }

  async load() {
    try {
      const [{ data: participants }, { data: sessions }, { data: campaigns }] = await Promise.all([
        this.client.from("participants").select("*").order("name"),
        this.client.from("sessions").select("*").order("date"),
        this.client.from("campaigns").select("*").order("name")
      ]);

      return normalizeState({
        campaigns: (campaigns || []).map((row) => ({
          id: row.id,
          name: row.name,
          tone: row.tone || "gold",
          dmIds: row.dm_ids || []
        })),
        participants: (participants || []).map((row) => ({
          id: row.id,
          name: row.name,
          role: row.role,
          email: row.email || "",
          phone: row.phone,
          campaignIds: row.campaign_ids || [],
          filledUntil: row.filled_until,
          availability: row.availability,
          availabilityByWeek: row.availability_by_week || {}
        })),
        sessions: (sessions || []).map((row) => ({
          id: row.id,
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          date: row.date,
          dayKey: row.day_key,
          slotId: row.slot_id,
          slotLabel: row.slot_label,
          slotTime: row.slot_time,
          dmNames: row.dm_names || [],
          absentPlayerNames: row.absent_player_names || [],
          createdBy: row.created_by || ""
        }))
      });
    } catch (error) {
      console.warn("Supabase no disponible, usando localStorage.", error);
      return this.fallback.load();
    }
  }

  async save(state) {
    const normalized = normalizeState(state);
    try {
      for (const campaign of normalized.campaigns) {
        await this.client.from("campaigns").upsert({
          id: campaign.id,
          name: campaign.name,
          tone: campaign.tone,
          dm_ids: campaign.dmIds
        });
      }

      for (const participant of normalized.participants) {
        await this.client.from("participants").upsert({
          id: participant.id,
          name: participant.name,
          role: participant.role,
          email: participant.email || "",
          phone: participant.phone,
          campaign_ids: participant.campaignIds,
          filled_until: participant.filledUntil || "1970-01-01",
          availability: participant.availability,
          availability_by_week: participant.availabilityByWeek || {}
        });
      }

      for (const session of normalized.sessions) {
        await this.client.from("sessions").upsert({
          id: session.id,
          campaign_id: session.campaignId,
          campaign_name: session.campaignName,
          date: session.date,
          day_key: session.dayKey,
          slot_id: session.slotId,
          slot_label: session.slotLabel,
          slot_time: session.slotTime,
          dm_names: session.dmNames,
          absent_player_names: session.absentPlayerNames,
          created_by: session.createdBy
        });
      }

      return normalized;
    } catch (error) {
      console.warn("Guardado remoto fallido, persistiendo local.", error);
      return this.fallback.save(normalized);
    }
  }
}

export function createEmptyState() {
  const weekStart = getWeekStart();
  const campaigns = DEFAULT_CAMPAIGNS.map((campaign) => ({ ...campaign, dmIds: ["local-demo-dm"] }));
  return {
    campaigns,
    participants: [
      createDemoParticipant({
        id: "local-demo-dm",
        name: "DemoDM",
        role: "dm",
        email: "dm@example.local",
        filledUntil: addDaysIso(weekStart, 6),
        campaigns,
        weekStart
      }),
      createDemoParticipant({
        id: "local-demo-player",
        name: "DemoPlayer",
        role: "player",
        email: "player@example.local",
        filledUntil: "",
        campaigns,
        weekStart
      })
    ],
    sessions: []
  };
}

function createDemoParticipant({ id, name, role, email, filledUntil, campaigns, weekStart }) {
  const availability = createEmptyAvailability();
  for (const [day] of DAYS) {
    for (const slot of SLOTS) {
      availability[day][slot.id] = { available: true, mode: "cualquiera", reason: "" };
    }
  }
  return {
    id,
    name,
    role,
    email,
    phone: "",
    campaignIds: campaigns.map((campaign) => campaign.id),
    filledUntil,
    availability,
    availabilityByWeek: { [addDaysIso(weekStart, 0)]: availability }
  };
}

function normalizeState(state) {
  const base = createEmptyState();
  const campaigns = normalizeCampaigns(state?.campaigns || base.campaigns);
  const participants = Array.isArray(state?.participants)
    ? state.participants.map((participant) => normalizeStoredParticipant(participant, campaigns))
    : [];

  for (const demo of base.participants) {
    if (!participants.some((participant) => participant.id === demo.id || participant.name.toLowerCase() === demo.name.toLowerCase())) {
      participants.push(normalizeStoredParticipant(demo, campaigns));
    }
  }

  return {
    campaigns: normalizeCampaigns(campaigns, participants),
    participants,
    sessions: Array.isArray(state?.sessions) ? state.sessions.map(normalizeStoredSession) : []
  };
}

function normalizeStoredParticipant(participant, campaigns) {
  const availability = participant.availability || createEmptyAvailability();
  const availabilityByWeek = participant.availabilityByWeek && Object.keys(participant.availabilityByWeek).length
    ? participant.availabilityByWeek
    : { [addDaysIso(getWeekStart(), 0)]: availability };

  return {
    id: participant.id || crypto.randomUUID(),
    name: participant.name || "Sin nombre",
    role: participant.role === "dm" ? "dm" : "player",
    email: participant.email || "",
    phone: participant.phone || "",
    campaignIds: normalizeCampaignIds(participant.campaignIds, campaigns),
    filledUntil: participant.filledUntil || "",
    availability,
    availabilityByWeek
  };
}

function normalizeStoredSession(session) {
  return {
    id: session.id || crypto.randomUUID(),
    campaignId: session.campaignId || "drakkenheim",
    campaignName: session.campaignName || "Campana",
    date: session.date,
    dayKey: session.dayKey,
    slotId: session.slotId,
    slotLabel: session.slotLabel,
    slotTime: session.slotTime,
    dmNames: session.dmNames || [],
    absentPlayerNames: session.absentPlayerNames || [],
    createdBy: session.createdBy || ""
  };
}
