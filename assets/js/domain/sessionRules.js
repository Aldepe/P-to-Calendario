export const DAYS = [
  ["monday", "Lunes"],
  ["tuesday", "Martes"],
  ["wednesday", "Miercoles"],
  ["thursday", "Jueves"],
  ["friday", "Viernes"],
  ["saturday", "Sabado"],
  ["sunday", "Domingo"]
];

export const SLOTS = [
  { id: "morning", label: "Manana", time: "09:00-13:00" },
  { id: "evening", label: "Tarde", time: "18:00-22:00" }
];

export const DEFAULT_CAMPAIGNS = [];

export const CAMPAIGNS = DEFAULT_CAMPAIGNS;

export function createEmptyAvailability() {
  return Object.fromEntries(
    DAYS.map(([day]) => [
      day,
      Object.fromEntries(SLOTS.map((slot) => [slot.id, { available: true, mode: "cualquiera", reason: "" }]))
    ])
  );
}

export function findSessionCandidates(participants, campaignsOrWeekStart, maybeWeekStart) {
  const hasCampaignList = Array.isArray(campaignsOrWeekStart);
  const campaigns = hasCampaignList ? campaignsOrWeekStart : DEFAULT_CAMPAIGNS;
  const weekStart = hasCampaignList ? maybeWeekStart : campaignsOrWeekStart;
  const normalizedParticipants = participants.map((participant) => normalizeParticipant(participant, campaigns));
  const normalizedCampaigns = normalizeCampaigns(campaigns, normalizedParticipants);
  const candidates = [];

  for (const campaign of normalizedCampaigns) {
    const campaignPlayers = normalizedParticipants.filter(
      (participant) => participant.role === "player" && participant.campaignIds.includes(campaign.id)
    );
    const assignedDms = normalizedParticipants.filter(
      (participant) => participant.role === "dm" && campaign.dmIds.includes(participant.id)
    );

    if (campaignPlayers.length === 0 || assignedDms.length === 0) continue;

    for (const [dayKey, dayLabel] of DAYS) {
      for (const slot of SLOTS) {
        const availableDms = assignedDms.filter((participant) => participant.availability?.[dayKey]?.[slot.id]?.available);
        const availablePlayers = campaignPlayers.filter((participant) => participant.availability?.[dayKey]?.[slot.id]?.available);
        const unavailablePlayers = campaignPlayers.filter((participant) => !participant.availability?.[dayKey]?.[slot.id]?.available);
        const missingPlayers = campaignPlayers.length - availablePlayers.length;
        const isValid = availableDms.length > 0 && missingPlayers <= 2;

        if (isValid) {
          candidates.push({
            id: `${campaign.id}-${dayKey}-${slot.id}`,
            campaign,
            campaignId: campaign.id,
            campaignName: campaign.name,
            dayKey,
            dayLabel,
            date: addDaysIso(weekStart, DAYS.findIndex(([key]) => key === dayKey)),
            slot,
            players: campaignPlayers,
            assignedDms,
            availableDms,
            availablePlayers,
            unavailablePlayers,
            missingPlayers,
            score: availablePlayers.length * 3 + availableDms.length * 2 - unavailablePlayers.length * 2
          });
        }
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date) || a.campaignName.localeCompare(b.campaignName));
}

export function getCampaignPlayers(participants, campaignId, campaigns = DEFAULT_CAMPAIGNS) {
  return participants
    .map((participant) => normalizeParticipant(participant, campaigns))
    .filter((participant) => participant.role === "player" && participant.campaignIds.includes(campaignId));
}

export function getPendingFillers(participants, weekStart = getWeekStart(), campaigns = DEFAULT_CAMPAIGNS) {
  return participants
    .map((participant) => normalizeParticipant(participant, campaigns))
    .filter((participant) => (participant.phone || participant.email) && !isWeekComplete(participant, weekStart));
}

export function getWeekStart(date = new Date()) {
  const current = new Date(date);
  const day = current.getDay() || 7;
  current.setHours(0, 0, 0, 0);
  current.setDate(current.getDate() - day + 1);
  return current;
}

export function addDaysIso(baseDate, days) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + days);
  return toLocalIsoDate(date);
}

export function isFilledForCurrentWeek(filledUntil, weekStart = getWeekStart()) {
  if (!filledUntil || filledUntil === "1970-01-01") return false;
  const sunday = new Date(weekStart);
  sunday.setDate(sunday.getDate() + 6);
  return parseLocalIsoDate(filledUntil) >= sunday;
}

export function isWeekComplete(participant, weekStart = getWeekStart()) {
  if (!isFilledForCurrentWeek(participant.filledUntil, weekStart)) return false;
  for (const [dayKey] of DAYS) {
    for (const slot of SLOTS) {
      const entry = participant.availability?.[dayKey]?.[slot.id];
      if (!entry) return false;
      if (!entry.available && !String(entry.reason || "").trim()) return false;
    }
  }
  return true;
}

export function normalizeParticipant(participant, campaigns = DEFAULT_CAMPAIGNS) {
  return {
    id: participant.id,
    name: participant.name,
    role: participant.role || "player",
    phone: participant.phone || "",
    email: participant.email || "",
    filledUntil: participant.filledUntil || "",
    availabilityByWeek: participant.availabilityByWeek || {},
    campaignIds: normalizeCampaignIds(participant.campaignIds, campaigns),
    availability: participant.availability || createEmptyAvailability()
  };
}

export function normalizeCampaigns(campaigns, participants = []) {
  const source = Array.isArray(campaigns) ? campaigns : DEFAULT_CAMPAIGNS;
  const normalized = source.map((campaign) => normalizeCampaign(campaign));
  const unique = [];

  for (const campaign of normalized) {
    if (!unique.some((item) => item.id === campaign.id)) unique.push(campaign);
  }

  if (participants.length) {
    return inferDmAssignments(unique, participants);
  }

  return unique;
}

export function normalizeCampaign(campaign) {
  const name = String(campaign.name || "Nueva campana").trim();
  return {
    id: campaign.id || slugify(name),
    name,
    tone: campaign.tone || "gold",
    dmIds: Array.isArray(campaign.dmIds) ? campaign.dmIds : []
  };
}

export function createCampaign(name, campaigns = DEFAULT_CAMPAIGNS) {
  const baseId = slugify(name);
  const existingIds = new Set(normalizeCampaigns(campaigns).map((campaign) => campaign.id));
  let id = baseId;
  let index = 2;

  while (existingIds.has(id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }

  return { id, name: String(name).trim(), tone: "gold", dmIds: [] };
}

export function normalizeCampaignIds(campaignIds, campaigns = DEFAULT_CAMPAIGNS) {
  const normalizedCampaigns = normalizeCampaigns(campaigns);
  const allowedIds = normalizedCampaigns.map((campaign) => campaign.id);
  const ids = Array.isArray(campaignIds) ? campaignIds : [];
  return [...new Set(ids.filter((id) => allowedIds.includes(id)))];
}

export function campaignName(campaignId, campaigns = DEFAULT_CAMPAIGNS) {
  return normalizeCampaigns(campaigns).find((campaign) => campaign.id === campaignId)?.name || campaignId;
}

export function removeCampaignFromParticipants(participants, campaignId, campaigns = DEFAULT_CAMPAIGNS) {
  return participants.map((participant) => ({
    ...participant,
    campaignIds: normalizeCampaignIds(participant.campaignIds, campaigns).filter((id) => id !== campaignId)
  }));
}

export function parseLocalIsoDate(value) {
  if (value instanceof Date) return value;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferDmAssignments(campaigns, participants) {
  const realDmIds = new Set(participants.filter((participant) => participant.role === "dm").map((participant) => participant.id));
  return campaigns.map((campaign) => {
    const validDmIds = campaign.dmIds.filter((id) => realDmIds.has(id));
    if (validDmIds.length) return { ...campaign, dmIds: validDmIds };
    const dmIds = participants
      .filter((participant) => participant.role === "dm" && Array.isArray(participant.campaignIds) && participant.campaignIds.includes(campaign.id))
      .map((participant) => participant.id);
    return { ...campaign, dmIds };
  });
}

function slugify(value) {
  return String(value || "campana")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "campana";
}
