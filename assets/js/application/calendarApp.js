import { buildLoginCredentials, buildSignupProfile } from "../domain/authRules.js";
import { buildReminderPreview } from "../domain/notificationMessages.js";
import {
  DAYS,
  SLOTS,
  addDaysIso,
  campaignName,
  createCampaign,
  createEmptyAvailability,
  findSessionCandidates,
  getCampaignPlayers,
  getPendingFillers,
  getWeekStart,
  normalizeCampaignIds,
  normalizeCampaigns,
  normalizeParticipant,
  parseLocalIsoDate,
  removeCampaignFromParticipants
} from "../domain/sessionRules.js";

const byId = (id) => document.getElementById(id);

export class CalendarApp {
  constructor({ repository, authRepository, notificationGateway }) {
    this.repository = repository;
    this.authRepository = authRepository;
    this.notificationGateway = notificationGateway;
    this.state = { campaigns: [], participants: [], sessions: [] };
    this.currentUser = null;
    this.weekStart = getWeekStart();
    this.calendarViewMode = "week";
    this.fillViewMode = "week";
  }

  async init() {
    this.state = await this.repository.load();
    this.currentUser = await this.authRepository.currentUser();
    this.bindAuth();
    this.bindTabs();
    this.bindControls();
    this.renderEditor();
    await this.ensureCurrentParticipant();
    this.renderAuthState();
    this.render();
    if (this.currentUser) this.selectTab("calendar");
  }

  bindAuth() {
    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.addEventListener("click", () => this.setAuthMode(button.dataset.authMode));
    });

    byId("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.runAuthAction(async () => {
        this.currentUser = await this.authRepository.login(buildLoginCredentials(new FormData(event.currentTarget)));
        await this.ensureCurrentParticipant();
        this.renderEditor();
        this.renderAuthState();
        this.render();
        this.selectTab("calendar");
      });
    });

    byId("signupForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.runAuthAction(async () => {
        this.currentUser = await this.authRepository.signUp(buildSignupProfile(new FormData(event.currentTarget)));
        await this.ensureCurrentParticipant();
        this.renderEditor();
        this.renderAuthState();
        this.render();
        this.selectTab("calendar");
      });
    });

    byId("logoutButton").addEventListener("click", async () => {
      await this.authRepository.logout();
      this.currentUser = null;
      this.renderAuthState();
      this.render();
    });
  }

  bindTabs() {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => this.selectTab(button.dataset.tab));
    });
  }

  bindControls() {
    document.querySelectorAll("[data-week]").forEach((button) => {
      button.addEventListener("click", () => {
        this.weekStart.setDate(this.weekStart.getDate() + (button.dataset.week === "next" ? 7 : -7));
        this.renderEditor();
        this.render();
      });
    });

    document.querySelectorAll("[data-view-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = byId(button.dataset.viewTarget);
        document.querySelectorAll(`[data-view-target="${button.dataset.viewTarget}"]`).forEach((item) => item.classList.toggle("is-active", item === button));
        target?.classList.toggle("calendar-layout", button.dataset.viewMode === "calendar");
        if (button.dataset.viewTarget === "calendarGrid") {
          this.calendarViewMode = button.dataset.viewMode;
          this.renderCalendar();
        }
        if (button.dataset.viewTarget === "availabilityEditor") {
          this.fillViewMode = button.dataset.viewMode;
          this.renderEditor();
        }
      });
    });

    byId("availabilityForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!this.currentUser) return;
      this.upsertParticipant(this.participantFromAvailability(new FormData(event.currentTarget)));
      await this.persistAndRender("Disponibilidad guardada.");
      this.renderEditor();
    });

    byId("recalculate").addEventListener("click", () => this.renderSessions());
    byId("sendReminderTest")?.addEventListener("click", () => this.sendReminderTest());
    byId("sendSessionTest")?.addEventListener("click", () => this.sendSessionTest());
    byId("sendCancelTest")?.addEventListener("click", () => this.sendSessionCancelTest());

    byId("campaignForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (this.currentUser?.role !== "dm") return;
      const name = String(new FormData(event.currentTarget).get("campaignName") || "").trim();
      if (!name) return;
      const campaign = createCampaign(name, this.state.campaigns);
      campaign.dmIds = [this.currentUser.id];
      this.state.campaigns.push(campaign);
      this.syncDmCampaignMembership(campaign.id, campaign.dmIds);
      event.currentTarget.reset();
      await this.persistAndRender("Campana anadida.");
    });
  }

  async runAuthAction(action) {
    try {
      byId("authMessage").textContent = "";
      await action();
    } catch (error) {
      byId("authMessage").textContent = error.message;
    }
  }

  setAuthMode(mode) {
    document.querySelectorAll("[data-auth-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.authMode === mode));
    byId("loginForm").hidden = mode !== "login";
    byId("signupForm").hidden = mode !== "signup";
  }

  selectTab(tabId) {
    document.querySelectorAll("[data-tab], .view").forEach((node) => node.classList.remove("is-active"));
    document.querySelector(`.tab[data-tab="${tabId}"]`)?.classList.add("is-active");
    byId(tabId)?.classList.add("is-active");
  }

  async ensureCurrentParticipant() {
    if (!this.currentUser) return;
    const existing = this.findCurrentParticipant();
    this.upsertParticipant(participantFromUser(this.currentUser, existing, this.state.campaigns));
    this.state = await this.repository.save(this.state);
    if (!existing && this.currentUser.email) await this.sendInitialReminder();
  }

  findCurrentParticipant() {
    if (!this.currentUser) return null;
    return this.state.participants.find((participant) => participant.id === this.currentUser.id)
      || this.state.participants.find((participant) => participant.name.toLowerCase() === this.currentUser.name.toLowerCase())
      || null;
  }

  upsertParticipant(participant) {
    const normalized = normalizeParticipant(participant, this.state.campaigns);
    const index = this.state.participants.findIndex((item) => item.id === normalized.id || item.name.toLowerCase() === normalized.name.toLowerCase());
    if (index >= 0) this.state.participants[index] = { ...this.state.participants[index], ...normalized };
    else this.state.participants.push(normalized);
  }

  weekKey(date = this.weekStart) {
    return addDaysIso(date, 0);
  }

  availabilityForWeek(participant, weekStart = this.weekStart) {
    const key = this.weekKey(weekStart);
    const availabilityByWeek = participant.availabilityByWeek || {};
    if (availabilityByWeek[key]) return availabilityByWeek[key];

    const hasWeekData = Object.keys(availabilityByWeek).some((itemKey) => !itemKey.startsWith("__"));
    const currentWeekKey = this.weekKey(getWeekStart());
    if (!hasWeekData && key === currentWeekKey) return participant.availability || createEmptyAvailability();

    return createEmptyAvailability();
  }

  participantsForWeek(weekStart = this.weekStart) {
    return this.state.participants.map((participant) => ({
      ...participant,
      availability: this.availabilityForWeek(participant, weekStart)
    }));
  }

  participantFromAvailability(data) {
    const current = this.findCurrentParticipant() || participantFromUser(this.currentUser, {}, this.state.campaigns);
    const availability = createEmptyAvailability();
    for (const [dayKey] of DAYS) {
      for (const slot of SLOTS) {
        const prefix = `${dayKey}.${slot.id}`;
        availability[dayKey][slot.id] = {
          available: data.get(`${prefix}.available`) === "on",
          mode: String(data.get(`${prefix}.mode`) || "cualquiera"),
          reason: String(data.get(`${prefix}.reason`) || "").trim()
        };
      }
    }
    const weekKey = this.weekKey();
    return {
      ...current,
      filledUntil: String(data.get("filledUntil") || ""),
      availability,
      availabilityByWeek: {
        ...(current.availabilityByWeek || {}),
        [weekKey]: availability
      }
    };
  }

  renderAuthState() {
    const loggedIn = Boolean(this.currentUser);
    byId("authGate").hidden = loggedIn;
    byId("appShell").hidden = !loggedIn;
    byId("userPanel").hidden = !loggedIn;
    if (!loggedIn) {
      byId("dmEmailTools").hidden = true;
      this.renderSignupCampaigns();
      this.setAuthMode("login");
      return;
    }
    byId("userName").textContent = this.currentUser.name;
    byId("userRole").textContent = this.currentUser.role === "dm" ? "DM" : "Player";
    document.querySelector('.tab[data-tab="campaigns"]').hidden = this.currentUser.role !== "dm";
    byId("dmEmailTools").hidden = this.currentUser.role !== "dm";
    this.renderEmailTools();
    this.renderSignupCampaigns();
    this.renderCurrentProfile();
  }

  renderSignupCampaigns() {
    renderCampaignChoices(byId("signupCampaigns"), "signupCampaigns", this.state.campaigns, this.state.campaigns.map((campaign) => campaign.id));
  }

  renderCurrentProfile() {
    const participant = this.findCurrentParticipant();
    if (!participant) return;
    const campaigns = participant.campaignIds.map((id) => campaignName(id, this.state.campaigns)).join(", ");
    byId("currentProfileCard").innerHTML = `
      <div>
        <span class="mini-label">Cuenta activa</span>
        <strong>${escapeHtml(participant.name)}</strong>
      </div>
      <p>${participant.role === "dm" ? "DM" : "Player"} - ${escapeHtml(participant.email || "sin email")} - ${escapeHtml(campaigns || "sin campanas")}</p>
    `;
  }

  renderEmailTools() {
    const field = byId("emailTestRecipient");
    if (!field || !this.currentUser) return;
    const email = this.findCurrentParticipant()?.email || this.currentUser.email || "";
    field.placeholder = email && !email.endsWith(".local") ? email : "tu@email.com";
    if (!field.value && email && !email.endsWith(".local")) field.value = email;
  }

  renderEditor() {
    const container = byId("availabilityEditor");
    const template = byId("slotTemplate");
    const isMonthView = this.fillViewMode === "calendar";
    container.classList.toggle("month-grid", isMonthView);
    container.classList.toggle("fill-month-grid", isMonthView);
    container.classList.toggle("calendar-layout", false);
    container.innerHTML = "";

    if (isMonthView) {
      this.renderFillMonth(container);
      return;
    }

    for (const [dayKey, dayLabel] of DAYS) {
      const dayIndex = DAYS.findIndex(([key]) => key === dayKey);
      const date = addDaysIso(this.weekStart, dayIndex);
      const group = document.createElement("section");
      group.className = "day-editor";
      group.innerHTML = `<h3><span>${dayLabel}</span><small>${formatDate(date)}</small></h3>`;
      for (const slot of SLOTS) {
        const node = template.content.cloneNode(true);
        node.querySelector("[data-slot-label]").textContent = slot.label;
        node.querySelector("[data-slot-time]").textContent = slot.time;
        node.querySelectorAll("[data-field]").forEach((input) => {
          input.name = `${dayKey}.${slot.id}.${input.dataset.field}`;
        });
        group.appendChild(node);
      }
      container.appendChild(group);
    }
    this.applyCurrentAvailability();
  }

  renderFillMonth(container) {
    const participant = this.findCurrentParticipant();
    const selected = new Date(this.weekStart);
    const selectedWeekKey = this.weekKey(this.weekStart);
    const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const monthEnd = new Date(selected.getFullYear(), selected.getMonth() + 1, 0);
    const cursor = getWeekStart(monthStart);
    const monthEndWeek = getWeekStart(monthEnd);

    while (cursor <= monthEndWeek) {
      const weekStart = new Date(cursor);
      const weekKey = this.weekKey(weekStart);
      const availability = participant ? this.availabilityForWeek(participant, weekStart) : createEmptyAvailability();
      const week = document.createElement("article");
      week.className = `month-week-column fill-week-column ${weekKey === selectedWeekKey ? "is-selected" : ""}`;
      week.innerHTML = `
        <div class="fill-week-head">
          <strong>${formatDate(weekStart)}</strong>
          <button class="ghost-button compact" type="button" data-fill-week="${weekKey}">${weekKey === selectedWeekKey ? "Editando" : "Editar"}</button>
        </div>
      `;

      for (const [dayKey, dayLabel] of DAYS) {
        const dayIndex = DAYS.findIndex(([key]) => key === dayKey);
        const date = addDaysIso(weekStart, dayIndex);
        const dateObj = parseLocalIsoDate(date);
        const entries = SLOTS.map((slot) => ({ slot, entry: availability?.[dayKey]?.[slot.id] || {} }));
        const day = document.createElement("section");
        day.className = `month-day fill-month-day ${dateObj.getMonth() !== selected.getMonth() ? "is-outside-month" : ""}`;
        day.innerHTML = `
          <div class="month-day-head"><strong>${dayLabel.slice(0, 3)}</strong><span>${formatDate(date)}</span></div>
          <div class="fill-month-marks">
            ${entries.map(({ slot, entry }) => fillMark(slot, entry)).join("")}
          </div>
        `;
        week.appendChild(day);
      }

      container.appendChild(week);
      cursor.setDate(cursor.getDate() + 7);
    }

    container.querySelectorAll("[data-fill-week]").forEach((button) => {
      button.addEventListener("click", () => {
        this.weekStart = parseLocalIsoDate(button.dataset.fillWeek);
        this.fillViewMode = "week";
        document.querySelectorAll('[data-view-target="availabilityEditor"]').forEach((item) => item.classList.toggle("is-active", item.dataset.viewMode === "week"));
        this.renderEditor();
        this.render();
      });
    });
  }

  applyCurrentAvailability() {
    const participant = this.findCurrentParticipant();
    if (!participant) return;
    byId("filledUntil").value = participant.filledUntil || addDaysIso(this.weekStart, 6);
    const availability = this.availabilityForWeek(participant);
    for (const [dayKey] of DAYS) {
      for (const slot of SLOTS) {
        const entry = availability?.[dayKey]?.[slot.id] || {};
        setField(`${dayKey}.${slot.id}.available`, Boolean(entry.available));
        setField(`${dayKey}.${slot.id}.mode`, entry.mode || "cualquiera");
        setField(`${dayKey}.${slot.id}.reason`, entry.reason || "");
      }
    }
  }

  render() {
    byId("weekLabel").textContent = `${formatDate(this.weekStart)} - ${formatDate(addDaysIso(this.weekStart, 6))}`;
    byId("fillWeekLabel").textContent = `${formatDate(this.weekStart)} - ${formatDate(addDaysIso(this.weekStart, 6))}`;
    this.renderSignupCampaigns();
    this.renderCalendar();
    this.renderReminder();
    this.renderSessions();
    this.renderCampaignManager();
    this.renderCurrentProfile();
  }

  renderCalendar() {
    const grid = byId("calendarGrid");
    grid.innerHTML = "";
    grid.classList.toggle("month-grid", this.calendarViewMode === "calendar");
    grid.classList.toggle("calendar-grid", this.calendarViewMode !== "calendar");
    if (this.calendarViewMode === "calendar") {
      this.renderMonthCalendar(grid);
      return;
    }
    this.renderWeekCalendar(grid, this.weekStart);
  }

  renderWeekCalendar(grid, weekStart) {
    const participants = this.participantsForWeek(weekStart);
    const candidates = findSessionCandidates(participants, this.state.campaigns, weekStart);
    for (const [dayKey, dayLabel] of DAYS) {
      const date = addDaysIso(weekStart, DAYS.findIndex(([key]) => key === dayKey));
      const column = document.createElement("article");
      column.className = "day-card";
      column.innerHTML = `<h3>${dayLabel}<small>${formatDate(date)}</small></h3>`;
      for (const slot of SLOTS) {
        const available = participants.filter((participant) => participant.availability?.[dayKey]?.[slot.id]?.available);
        const blocked = participants.filter((participant) => !participant.availability?.[dayKey]?.[slot.id]?.available);
        const confirmed = this.state.sessions.filter((session) => session.date === date && session.slotId === slot.id);
        const slotCandidates = candidates.filter((candidate) => candidate.date === date && candidate.slot.id === slot.id);
        const card = buildSlotCard({
          campaigns: this.state.campaigns,
          participants,
          dayKey,
          slot,
          available,
          blocked,
          confirmed,
          slotCandidates,
          compact: false
        });
        column.appendChild(card);
      }
      grid.appendChild(column);
    }
  }

  renderMonthCalendar(grid) {
    const selected = new Date(this.weekStart);
    const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const monthEnd = new Date(selected.getFullYear(), selected.getMonth() + 1, 0);
    const cursor = getWeekStart(monthStart);
    const monthEndWeek = getWeekStart(monthEnd);

    while (cursor <= monthEndWeek) {
      const weekStart = new Date(cursor);
      const participants = this.participantsForWeek(weekStart);
      const candidates = findSessionCandidates(participants, this.state.campaigns, weekStart);
      const week = document.createElement("article");
      week.className = "month-week-column";
      week.innerHTML = `<h3>Semana<br><small>${formatDate(weekStart)} - ${formatDate(addDaysIso(weekStart, 6))}</small></h3>`;

      for (const [dayKey, dayLabel] of DAYS) {
        const dayIndex = DAYS.findIndex(([key]) => key === dayKey);
        const date = addDaysIso(weekStart, dayIndex);
        const dateObj = parseLocalIsoDate(date);
        const day = document.createElement("section");
        day.className = `month-day ${dateObj.getMonth() !== selected.getMonth() ? "is-outside-month" : ""}`;
        day.innerHTML = `<div class="month-day-head"><strong>${dayLabel.slice(0, 3)}</strong><span>${formatDate(date)}</span></div>`;

        for (const slot of SLOTS) {
          const available = participants.filter((participant) => participant.availability?.[dayKey]?.[slot.id]?.available);
          const blocked = participants.filter((participant) => !participant.availability?.[dayKey]?.[slot.id]?.available);
          const confirmed = this.state.sessions.filter((session) => session.date === date && session.slotId === slot.id);
          const slotCandidates = candidates.filter((candidate) => candidate.date === date && candidate.slot.id === slot.id);
          day.appendChild(buildSlotCard({
            campaigns: this.state.campaigns,
            participants,
            dayKey,
            slot,
            available,
            blocked,
            confirmed,
            slotCandidates,
            compact: true
          }));
        }
        week.appendChild(day);
      }

      grid.appendChild(week);
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  renderReminder() {
    const pending = getPendingFillers(this.participantsForWeek(), this.weekStart, this.state.campaigns);
    const requiredUntil = addDaysIso(this.weekStart, 6);
    byId("reminderBadge").textContent = pending.length ? `${pending.length} recordatorio(s) pendiente(s)` : "Todo el mundo al dia";
    byId("reminderPreview").textContent = buildReminderPreview(pending, requiredUntil);
  }

  renderSessions() {
    const today = todayIso();
    const proposals = findSessionCandidates(this.participantsForWeek(), this.state.campaigns, this.weekStart)
      .filter((proposal) => proposal.date >= today);
    this.renderProposalList(proposals);
    this.renderConfirmedSessions();
  }

  renderProposalList(proposals) {
    const proposalList = byId("proposalList");
    proposalList.innerHTML = proposals.length ? "" : `<p class="empty">No hay huecos validos esta semana.</p>`;
    proposals.forEach((proposal) => {
      const missing = proposal.unavailablePlayers.map((player) => `${player.name}${reasonFor(player, proposal.dayKey, proposal.slot.id)}`);
      const canConfirm = this.currentUser?.role === "dm";
      const item = document.createElement("article");
      item.className = "session-card";
      item.innerHTML = `
        <div class="session-topline">
          <div>
            <span class="mini-label">${escapeHtml(proposal.campaignName)}</span>
            <strong>${proposal.dayLabel}, ${formatDate(proposal.date)}</strong>
          </div>
          <span>${proposal.slot.label} - ${proposal.slot.time}</span>
        </div>
        <div class="odds-strip">
          <span>${icon("dm")}DM: ${formatPeople(proposal.availableDms)}</span>
          <span>${icon("players")}${proposal.availablePlayers.length}/${proposal.players.length} players</span>
          <span>${icon("blocked")}Faltan: ${missing.length ? escapeHtml(missing.join(", ")) : "0"}</span>
        </div>
        <button class="primary-button" type="button" ${canConfirm ? "" : "disabled"}>${icon(canConfirm ? "confirmed" : "dm")}${canConfirm ? "Confirmar" : "Solo DM"}</button>
      `;
      item.querySelector("button").addEventListener("click", () => this.confirmSession(proposal));
      proposalList.appendChild(item);
    });
  }

  renderConfirmedSessions() {
    const confirmedList = byId("confirmedList");
    const today = todayIso();
    const weekEnd = addDaysIso(this.weekStart, 6);
    const sessions = this.state.sessions.filter((session) => session.date >= today && session.date >= this.weekKey() && session.date <= weekEnd);
    confirmedList.innerHTML = sessions.length ? "" : `<p class="empty">Aun no hay sesiones cerradas.</p>`;
    sessions
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((session) => {
        const item = document.createElement("article");
        item.className = "session-card confirmed";
        item.innerHTML = `
          <div class="session-topline">
            <div>
              <span class="mini-label">${escapeHtml(session.campaignName)}</span>
              <strong>${formatDate(session.date)}</strong>
            </div>
            <span>${escapeHtml(session.slotLabel)} - ${escapeHtml(session.slotTime)}</span>
          </div>
          <p>DM: ${escapeHtml(session.dmNames.join(", "))} - Ausentes: ${escapeHtml(session.absentPlayerNames.join(", ") || "nadie")}</p>
          <p>Confirmada por ${escapeHtml(session.createdBy || "DM")}</p>
          ${this.currentUser?.role === "dm" ? `<button class="ghost-button danger" type="button" data-cancel-session="${session.id}">Desconfirmar</button>` : ""}
        `;
        item.querySelector("[data-cancel-session]")?.addEventListener("click", () => this.cancelSession(session.id));
        confirmedList.appendChild(item);
      });
  }

  renderCampaignManager() {
    const container = byId("campaignList");
    if (!container) return;
    const isDm = this.currentUser?.role === "dm";
    byId("campaignForm").hidden = !isDm;
    container.innerHTML = "";
    const dms = this.state.participants.filter((participant) => participant.role === "dm");
    this.state.campaigns.forEach((campaign) => {
      const item = document.createElement("article");
      item.className = "campaign-admin-card";
      item.innerHTML = `
        <label>Nombre
          <input value="${escapeHtml(campaign.name)}" data-campaign-name="${campaign.id}" ${isDm ? "" : "disabled"} />
        </label>
        <div>
          <span class="field-title">DM asignados</span>
          <div class="campaign-choice-grid">
            ${dms.map((dm) => `
              <label class="campaign-choice">
                <input type="checkbox" data-campaign-dm="${campaign.id}" value="${dm.id}" ${campaign.dmIds.includes(dm.id) ? "checked" : ""} ${isDm ? "" : "disabled"} />
                <span>${escapeHtml(dm.name)}</span>
              </label>
            `).join("") || '<span class="soft-chip">No hay DMs</span>'}
          </div>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="button" data-save-campaign="${campaign.id}" ${isDm ? "" : "disabled"}>Guardar</button>
          <button class="ghost-button danger" type="button" data-delete-campaign="${campaign.id}" ${isDm ? "" : "disabled"}>Borrar</button>
        </div>
      `;
      item.querySelector("[data-save-campaign]")?.addEventListener("click", () => this.saveCampaign(campaign.id));
      item.querySelector("[data-delete-campaign]")?.addEventListener("click", () => this.deleteCampaign(campaign.id));
      container.appendChild(item);
    });
  }

  async saveCampaign(campaignId) {
    try {
      const campaign = this.state.campaigns.find((item) => item.id === campaignId);
      if (!campaign) return;
      campaign.name = document.querySelector(`[data-campaign-name="${campaignId}"]`)?.value?.trim() || campaign.name;
      campaign.dmIds = [...document.querySelectorAll(`[data-campaign-dm="${campaignId}"]:checked`)].map((input) => input.value);
      this.syncDmCampaignMembership(campaignId, campaign.dmIds);
      this.state.campaigns = normalizeCampaigns(this.state.campaigns, this.state.participants);
      this.state.sessions = this.state.sessions.map((session) => session.campaignId === campaignId ? { ...session, campaignName: campaign.name } : session);
      await this.persistAndRender("Campana actualizada.");
    } catch (error) {
      this.setToast(`No se pudo guardar la campana: ${error.message || error}`);
      this.render();
    }
  }

  async deleteCampaign(campaignId) {
    try {
      this.state.campaigns = this.state.campaigns.filter((campaign) => campaign.id !== campaignId);
      this.state.participants = removeCampaignFromParticipants(this.state.participants, campaignId, this.state.campaigns);
      this.state.sessions = this.state.sessions.filter((session) => session.campaignId !== campaignId);
      await this.persistAndRender("Campana borrada.");
    } catch (error) {
      this.setToast(`No se pudo borrar la campana: ${error.message || error}`);
      this.render();
    }
  }

  syncDmCampaignMembership(campaignId, selectedDmIds) {
    const selected = new Set(selectedDmIds);
    this.state.participants = this.state.participants.map((participant) => {
      if (participant.role !== "dm") return participant;
      const campaignIds = new Set(participant.campaignIds || []);
      if (selected.has(participant.id)) campaignIds.add(campaignId);
      else campaignIds.delete(campaignId);
      return { ...participant, campaignIds: normalizeCampaignIds([...campaignIds], this.state.campaigns) };
    });
  }

  async confirmSession(proposal) {
    if (this.currentUser?.role !== "dm") return;
    try {
      const duplicate = this.state.sessions.some((session) => session.campaignId === proposal.campaignId && session.date === proposal.date && session.slotId === proposal.slot.id);
      if (duplicate) {
        this.setToast("Esa campana ya esta confirmada en esa franja.");
        return;
      }
      const session = {
        id: crypto.randomUUID(),
        campaignId: proposal.campaignId,
        campaignName: proposal.campaignName,
        date: proposal.date,
        dayKey: proposal.dayKey,
        slotId: proposal.slot.id,
        slotLabel: proposal.slot.label,
        slotTime: proposal.slot.time,
        dmNames: proposal.availableDms.map((participant) => participant.name),
        absentPlayerNames: proposal.unavailablePlayers.map((participant) => participant.name),
        createdBy: this.currentUser.name,
        details: buildSessionDetails(proposal)
      };
      this.state.sessions.push(session);
      this.state = await this.repository.save(this.state);
      const result = await this.notificationGateway.sendSessionConfirmed({
        eventType: "confirmed",
        session,
        confirmedBy: this.currentUser,
        recipients: uniqueRecipients([...proposal.players, ...proposal.assignedDms])
      });
      this.setToast(`Aviso enviado: ${formatDelivery(result)}.`);
      this.render();
    } catch (error) {
      this.setToast(`No se pudo confirmar: ${error.message || error}`);
      this.render();
    }
  }

  async cancelSession(sessionId) {
    if (this.currentUser?.role !== "dm") return;
    try {
      const session = this.state.sessions.find((item) => item.id === sessionId);
      if (!session) return;
      const sessionWeek = getWeekStart(parseLocalIsoDate(session.date));
      const participants = this.participantsForWeek(sessionWeek);
      const campaign = this.state.campaigns.find((item) => item.id === session.campaignId);
      const players = participants.filter((participant) => participant.role === "player" && participant.campaignIds.includes(session.campaignId));
      const dms = participants.filter((participant) => participant.role === "dm" && campaign?.dmIds.includes(participant.id));
      const recipients = uniqueRecipients([...getCampaignPlayers(this.state.participants, session.campaignId, this.state.campaigns), ...dms]);
      const enrichedSession = {
        ...session,
        cancelledBy: this.currentUser.name,
        details: session.details || buildSessionDetailsFromStoredSession(session, players, dms)
      };
      this.state.sessions = this.state.sessions.filter((item) => item.id !== sessionId);
      this.state = await this.repository.save(this.state);
      const result = await this.notificationGateway.sendSessionCancelled({
        eventType: "cancelled",
        session: enrichedSession,
        cancelledBy: this.currentUser,
        recipients
      });
      this.setToast(`Cancelacion enviada: ${formatDelivery(result)}.`);
      this.render();
    } catch (error) {
      this.setToast(`No se pudo desconfirmar: ${error.message || error}`);
      this.render();
    }
  }

  async sendInitialReminder() {
    const participant = this.findCurrentParticipant();
    if (!participant?.email) return;
    try {
      const result = await this.notificationGateway.sendReminderForParticipant(participant);
      if (Number(result.sent || 0) + Number(result.discordSent || 0) > 0) this.setToast(`Cuenta creada. Recordatorio inicial: ${formatDelivery(result)}.`);
    } catch (error) {
      console.warn("No se pudo enviar el recordatorio inicial.", error);
    }
  }

  async sendReminderTest() {
    if (this.currentUser?.role !== "dm") return;
    const recipient = this.currentNoticeRecipient();
    if (!recipient) return;
    await this.runEmailTest(async () => {
      const result = await this.notificationGateway.sendReminderTest({ recipient });
      return `Recordatorio de prueba: ${formatDelivery(result)}.`;
    });
  }

  async sendSessionTest() {
    if (this.currentUser?.role !== "dm") return;
    const recipient = this.currentNoticeRecipient();
    if (!recipient) return;
    const session = this.testSession(recipient);
    await this.runEmailTest(async () => {
      const result = await this.notificationGateway.sendSessionTest({ recipient, session });
      return `Confirmacion de prueba: ${formatDelivery(result)}.`;
    });
  }

  async sendSessionCancelTest() {
    if (this.currentUser?.role !== "dm") return;
    const recipient = this.currentNoticeRecipient();
    if (!recipient) return;
    const session = {
      ...this.testSession(recipient),
      cancelledBy: this.currentUser.name
    };
    await this.runEmailTest(async () => {
      const result = await this.notificationGateway.sendSessionCancelTest({ recipient, session });
      return `Cancelacion de prueba: ${formatDelivery(result)}.`;
    });
  }

  testSession(recipient) {
    return {
      id: crypto.randomUUID(),
      campaignId: "test",
      campaignName: "Prueba de campana",
      date: addDaysIso(this.weekStart, 2),
      dayKey: "wednesday",
      slotId: "evening",
      slotLabel: "Tarde",
      slotTime: "18:00-22:00",
      dmNames: [this.currentUser.name],
      absentPlayerNames: ["nadie"],
      createdBy: this.currentUser.name,
      details: {
        availablePlayers: [{ name: recipient.name, mode: "online" }],
        unavailablePlayers: [],
        availableDms: [{ name: this.currentUser.name, mode: "online" }],
        assignedDms: [{ name: this.currentUser.name }],
        modeSummary: { online: 1, presencial: 0, cualquiera: 0 },
        playersTotal: 1,
        availablePlayersCount: 1
      }
    };
  }

  currentNoticeRecipient() {
    const participant = this.findCurrentParticipant();
    const email = String(byId("emailTestRecipient")?.value || "").trim();
    if (email && (!email.includes("@") || email.endsWith(".local"))) {
      this.setEmailStatus("Escribe un email real o deja el campo vacio para probar solo Discord.");
      return null;
    }
    return {
      id: participant?.id || this.currentUser.id,
      name: participant?.name || this.currentUser.name,
      email
    };
  }

  async runEmailTest(action) {
    try {
      this.setEmailStatus("Enviando prueba...");
      const message = await action();
      this.setEmailStatus(message);
    } catch (error) {
      this.setEmailStatus(`Error enviando prueba: ${error.message || error}`);
    }
  }

  setEmailStatus(message) {
    byId("emailTestStatus").textContent = message || "";
    this.setToast(message || "");
  }

  async persistAndRender(message) {
    this.state = await this.repository.save(this.state);
    this.setToast(message);
    this.render();
  }

  setToast(message) {
    byId("toast").textContent = message || "";
  }
}

function participantFromUser(user, existing = {}, campaigns = []) {
  return normalizeParticipant({
    ...existing,
    id: user.id,
    name: user.name,
    role: user.role,
    phone: user.phone,
    email: user.email || existing?.email || "",
    campaignIds: normalizeCampaignIds(user.campaignIds, campaigns),
    filledUntil: existing?.filledUntil || "",
    availability: existing?.availability || createEmptyAvailability()
  }, campaigns);
}

function buildSlotCard({ campaigns, participants, dayKey, slot, available, blocked, confirmed, slotCandidates, compact }) {
  const card = document.createElement("div");
  const statusKey = confirmed.length ? "confirmed" : slotCandidates.length ? "viable" : "blocked";
  const statusClass = `is-${statusKey}`;
  const statusText = confirmed.length
    ? "Confirmada"
    : slotCandidates.length
      ? `${slotCandidates.length} viable`
      : slotBlockReasonShort(campaigns, participants, dayKey, slot.id);
  const counts = modeCounts(available, dayKey, slot.id);
  card.className = `calendar-slot ${statusClass} ${compact ? "is-compact" : ""}`;
  card.innerHTML = `
    <div class="slot-title"><span class="slot-name">${icon(slot.id)}<strong>${compact ? slotShort(slot) : slot.label}</strong></span><span>${compact ? compactTime(slot.time) : slot.time}</span></div>
    ${confirmed.map((session) => `<div class="confirmed-label">${icon("campaign")}${escapeHtml(session.campaignName)}</div>`).join("")}
    <div class="slot-status">${icon(statusKey)}<span>${escapeHtml(statusText)}</span></div>
    <div class="mode-counts">
      <span title="Online">${icon("online")}<b>${counts.online}</b></span>
      <span title="Presencial">${icon("presencial")}<b>${counts.presencial}</b></span>
      <span title="Ambos">${icon("cualquiera")}<b>${counts.cualquiera}</b></span>
    </div>
    ${compact ? "" : `<div class="campaign-chip-row">${slotCandidates.map((candidate) => chip(candidate.campaignName)).join("") || '<span class="soft-chip">Sin propuesta</span>'}</div>`}
    ${compact ? "" : `<div class="people-lines"><span>${icon("available")}${formatPeople(available) || "Nadie"}</span><span>${icon("unavailable")}${formatUnavailable(blocked, dayKey, slot.id) || "Sin bloqueos"}</span></div>`}
  `;
  return card;
}

function modeCounts(participants, dayKey, slotId) {
  return participants.reduce(
    (counts, participant) => {
      const mode = participant.availability?.[dayKey]?.[slotId]?.mode || "cualquiera";
      if (mode === "presencial") counts.presencial += 1;
      else if (mode === "online") counts.online += 1;
      else counts.cualquiera += 1;
      return counts;
    },
    { online: 0, presencial: 0, cualquiera: 0 }
  );
}

function buildSessionDetails(proposal) {
  return {
    availablePlayers: proposal.availablePlayers.map((participant) => participantSessionDetail(participant, proposal.dayKey, proposal.slot.id)),
    unavailablePlayers: proposal.unavailablePlayers.map((participant) => participantSessionDetail(participant, proposal.dayKey, proposal.slot.id)),
    availableDms: proposal.availableDms.map((participant) => participantSessionDetail(participant, proposal.dayKey, proposal.slot.id)),
    assignedDms: proposal.assignedDms.map((participant) => ({ name: participant.name })),
    modeSummary: modeCounts(proposal.availablePlayers, proposal.dayKey, proposal.slot.id),
    playersTotal: proposal.players.length,
    availablePlayersCount: proposal.availablePlayers.length
  };
}

function buildSessionDetailsFromStoredSession(session, players, dms) {
  const dayKey = session.dayKey;
  const slotId = session.slotId;
  const availablePlayers = players
    .filter((participant) => participant.availability?.[dayKey]?.[slotId]?.available)
    .map((participant) => participantSessionDetail(participant, dayKey, slotId));
  const unavailablePlayers = players
    .filter((participant) => !participant.availability?.[dayKey]?.[slotId]?.available)
    .map((participant) => participantSessionDetail(participant, dayKey, slotId));
  const availableDms = dms
    .filter((participant) => participant.availability?.[dayKey]?.[slotId]?.available)
    .map((participant) => participantSessionDetail(participant, dayKey, slotId));

  return {
    availablePlayers,
    unavailablePlayers,
    availableDms,
    assignedDms: dms.map((participant) => ({ name: participant.name })),
    modeSummary: modeCounts(players.filter((participant) => participant.availability?.[dayKey]?.[slotId]?.available), dayKey, slotId),
    playersTotal: players.length,
    availablePlayersCount: availablePlayers.length
  };
}

function participantSessionDetail(participant, dayKey, slotId) {
  const slot = participant.availability?.[dayKey]?.[slotId] || {};
  return {
    name: participant.name,
    email: participant.email || "",
    available: Boolean(slot.available),
    mode: slot.mode || "cualquiera",
    reason: String(slot.reason || "").trim()
  };
}

function renderCampaignChoices(container, name, campaigns, selectedIds = []) {
  if (!campaigns.length) {
    container.innerHTML = `<p class="empty compact-empty">No hay campanas creadas.</p>`;
    return;
  }
  container.innerHTML = campaigns.map((campaign) => {
    const checked = selectedIds.includes(campaign.id) ? "checked" : "";
    return `<label class="campaign-choice"><input type="checkbox" name="${name}" value="${campaign.id}" ${checked} /><span>${escapeHtml(campaign.name)}</span></label>`;
  }).join("");
}

function setField(name, value) {
  const field = document.querySelector(`[name="${name}"]`);
  if (!field) return;
  if (field.type === "checkbox") field.checked = value;
  else field.value = value;
}

function formatPeople(items) {
  return escapeHtml(items.map((item) => item.name).join(", "));
}

function formatUnavailable(items, dayKey, slotId) {
  return escapeHtml(items.map((item) => `${item.name}${reasonFor(item, dayKey, slotId)}`).join(", "));
}

function reasonFor(participant, dayKey, slotId) {
  const reason = participant.availability?.[dayKey]?.[slotId]?.reason;
  return reason ? ` (${reason})` : "";
}

function slotBlockReasonShort(campaigns, participants, dayKey, slotId) {
  const statuses = campaigns.map((campaign) => {
    const players = participants.filter((participant) => participant.role === "player" && participant.campaignIds.includes(campaign.id));
    const assignedDms = participants.filter((participant) => participant.role === "dm" && campaign.dmIds.includes(participant.id));
    const availableDms = assignedDms.filter((participant) => participant.availability?.[dayKey]?.[slotId]?.available);
    const missingPlayers = players.filter((participant) => !participant.availability?.[dayKey]?.[slotId]?.available);
    if (!players.length) return `${campaign.name}: sin players`;
    if (!assignedDms.length) return `${campaign.name}: sin DM`;
    if (!availableDms.length) return `${campaign.name}: falta DM`;
    if (missingPlayers.length > 2) return `${campaign.name}: ${missingPlayers.length} fuera`;
    return `${campaign.name}: viable`;
  });
  const blocked = statuses.filter((status) => !status.endsWith(": viable"));
  return (blocked.length ? blocked : statuses).slice(0, 2).join(" / ") || "Sin hueco";
}

function chip(label) {
  return `<span class="campaign-chip">${icon("campaign")}${escapeHtml(label)}</span>`;
}

function fillMark(slot, entry) {
  const available = Boolean(entry.available);
  const hasReason = String(entry.reason || "").trim();
  const state = available ? "is-on" : hasReason ? "is-off" : "is-missing";
  const title = available ? "Disponible" : hasReason ? `No: ${entry.reason}` : "Pendiente";
  return `<span class="${state}" title="${escapeHtml(`${slot.label}: ${title}`)}">${icon(slot.id)}<b>${slotShort(slot)}</b></span>`;
}

function icon(name) {
  return `<span class="ui-icon ui-icon-${name}" aria-hidden="true"></span>`;
}

function slotShort(slot) {
  return slot.id === "morning" ? "M" : "T";
}

function compactTime(time) {
  return time.replaceAll(":00", "");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(parseLocalIsoDate(value));
}

function todayIso() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uniqueRecipients(recipients) {
  const seen = new Set();
  return recipients.filter((recipient) => {
    const key = recipient.email || recipient.id || recipient.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatDelivery(result = {}) {
  const emailCount = Number(result.sent || 0);
  const discordCount = Number(result.discordSent || 0);
  return `${emailCount} email(s), ${discordCount} Discord`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
