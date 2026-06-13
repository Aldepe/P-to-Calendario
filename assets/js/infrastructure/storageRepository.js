import { addDaysIso, createEmptyAvailability, getWeekStart, normalizeCampaignIds, normalizeCampaigns } from "../domain/sessionRules.js";

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
  constructor(client, fallback = null) {
    this.client = client;
    this.fallback = fallback;
  }

  async load() {
    try {
      const [participantsResult, sessionsResult, campaignsResult] = await Promise.all([
        this.client.from("participants").select("*").order("name"),
        this.client.from("sessions").select("*").order("date"),
        this.client.from("campaigns").select("*").order("name")
      ]);
      await assertSupabaseResult(participantsResult, "cargar participantes");
      await assertSupabaseResult(sessionsResult, "cargar sesiones");
      await assertSupabaseResult(campaignsResult, "cargar campanas");

      const participants = participantsResult.data || [];
      const sessions = sessionsResult.data || [];
      const campaigns = campaignsResult.data || [];

      return normalizeState({
        campaigns: campaigns.map((row) => ({
          id: row.id,
          name: row.name,
          tone: row.tone || "gold",
          dmIds: row.dm_ids || []
        })),
        participants: participants.map((row) => ({
          id: row.id,
          name: row.name,
          role: row.role,
          email: row.email || "",
          phone: row.phone,
          campaignIds: row.campaign_ids || [],
          filledUntil: normalizeFilledUntil(row.filled_until),
          availability: row.availability,
          availabilityByWeek: row.availability_by_week || {}
        })),
        sessions: sessions.map((row) => ({
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
      if (!this.fallback) throw error;
      console.warn("Supabase no disponible, usando localStorage.", error);
      return this.fallback.load();
    }
  }

  async save(state) {
    const normalized = normalizeState(state);
    try {
      for (const campaign of normalized.campaigns) {
        await assertSupabaseResult(this.client.from("campaigns").upsert({
          id: campaign.id,
          name: campaign.name,
          tone: campaign.tone,
          dm_ids: campaign.dmIds
        }), `guardar campana ${campaign.name}`);
      }
      await deleteRowsNotInState(this.client, "campaigns", normalized.campaigns.map((campaign) => campaign.id));

      for (const participant of normalized.participants) {
        await assertSupabaseResult(this.client.from("participants").upsert({
          id: participant.id,
          name: participant.name,
          role: participant.role,
          email: participant.email || "",
          phone: participant.phone,
          campaign_ids: participant.campaignIds,
          filled_until: participant.filledUntil || "1970-01-01",
          availability: participant.availability,
          availability_by_week: participant.availabilityByWeek || {}
        }), `guardar disponibilidad de ${participant.name}`);
      }

      for (const session of normalized.sessions) {
        await assertSupabaseResult(this.client.from("sessions").upsert({
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
        }), `guardar sesion ${session.campaignName}`);
      }
      await deleteRowsNotInState(this.client, "sessions", normalized.sessions.map((session) => session.id));

      return normalized;
    } catch (error) {
      if (!this.fallback) throw error;
      console.warn("Guardado remoto fallido, persistiendo local.", error);
      return this.fallback.save(normalized);
    }
  }
}

export function createEmptyState() {
  return {
    campaigns: [],
    participants: [],
    sessions: []
  };
}

function normalizeState(state) {
  const base = createEmptyState();
  const campaigns = normalizeCampaigns(state?.campaigns || base.campaigns);
  const participants = Array.isArray(state?.participants)
    ? state.participants.map((participant) => normalizeStoredParticipant(participant, campaigns))
    : [];

  return {
    campaigns: normalizeCampaigns(campaigns, participants),
    participants,
    sessions: Array.isArray(state?.sessions) ? state.sessions.map(normalizeStoredSession) : []
  };
}

function normalizeStoredParticipant(participant, campaigns) {
  const availability = participant.availability || createEmptyAvailability();
  const availabilityByWeek = participant.availabilityByWeek && hasRealWeekData(participant.availabilityByWeek)
    ? participant.availabilityByWeek
    : { [addDaysIso(getWeekStart(), 0)]: availability };

  return {
    id: participant.id || crypto.randomUUID(),
    name: participant.name || "Sin nombre",
    role: participant.role === "dm" ? "dm" : "player",
    email: participant.email || "",
    phone: participant.phone || "",
    campaignIds: normalizeCampaignIds(participant.campaignIds, campaigns),
    filledUntil: normalizeFilledUntil(participant.filledUntil),
    availability,
    availabilityByWeek
  };
}

function normalizeStoredSession(session) {
  return {
    id: session.id || crypto.randomUUID(),
    campaignId: session.campaignId || "",
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

async function deleteRowsNotInState(client, table, keepIds) {
  const { data, error } = await client.from(table).select("id");
  if (error) throw error;
  const keep = new Set(keepIds);
  const staleIds = (data || []).map((row) => row.id).filter((id) => !keep.has(id));
  for (const id of staleIds) {
    const { error: deleteError } = await client.from(table).delete().eq("id", id);
    if (deleteError) throw deleteError;
  }
}

async function assertSupabaseResult(resultOrPromise, context) {
  const result = await resultOrPromise;
  if (result?.error) throw new Error(`${context}: ${result.error.message}`);
  return result;
}

function hasRealWeekData(availabilityByWeek) {
  return Object.keys(availabilityByWeek).some((key) => !key.startsWith("__"));
}

function normalizeFilledUntil(value) {
  return !value || value === "1970-01-01" ? "" : value;
}
