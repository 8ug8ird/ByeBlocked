/**
 * @name ByeBlocked
 * @author 8ug8ird
 * @authorId 698947564459917343
 * @version 2.3.3
 * @description Hides blocked and ignored users from chat, voice, and member lists.
 * @source https://github.com/8ug8ird/ByeBlocked
 */

class ModuleResolver {
    constructor() { this._cache = {}; }
    getStore(...names) {
        for (const n of names) { try { const s = BdApi.Webpack.getStore(n); if (s) return s; } catch (_) {} }
        return this._byHeuristic(names[0]);
    }
    _byHeuristic(hint) {
        if (!hint) return null;
        const k = 'st:' + hint;
        if (this._cache[k]) return this._cache[k];
        const t = hint.replace(/store$/i, '').toLowerCase();
        try {
            const stores = this.get(m => m && typeof m === 'object' && typeof m.addChangeListener === 'function' && typeof m.getState === 'function');
            if (!stores) return null;
            const all = Array.isArray(stores) ? stores : [stores];
            for (const mod of all) {
                const n = (mod.getName?.() || mod.constructor?.displayName || mod.constructor?.name || '').toLowerCase();
                if (n.includes(t)) return this._cache[k] = mod;
            }
            for (const mod of all) {
                try {
                    const state = mod.getState();
                    if (state && typeof state === 'object')
                        for (const key of Object.keys(state))
                            if (key.toLowerCase().includes(t.replace(/^./, c => c.toLowerCase()))) return this._cache[k] = mod;
                } catch (_) {}
            }
        } catch (_) {}
        return null;
    }
    get(f, o) { try { return BdApi.Webpack.getModule(f, o); } catch (_) { return null; } }
    getBySource(s, o) { try { return BdApi.Webpack.getBySource(s, o); } catch (_) { return null; } }
    getWithKey(f) { try { return BdApi.Webpack.getModuleWithKey(f); } catch (_) { return null; } }
    findByKeys(...keys) {
        for (const key of keys) { try { const m = BdApi.Webpack.getByKeys(key); if (m) return m; } catch (_) {} }
        try { const m = this.get(mod => mod && typeof mod === 'object' && keys.every(k => k in mod)); if (m) return m; } catch (_) {}
        try { return BdApi.Webpack.getByKeys(...keys); } catch (_) { return null; }
    }
    findFnKey(mod, ...needles) {
        if (!mod || typeof mod !== 'object') return null;
        try { for (const [k, v] of Object.entries(mod)) { if (typeof v !== 'function') continue; if (needles.every(n => v.toString().includes(n))) return k; } } catch (_) {}
        return null;
    }
    findFnKeyFuzzy(mod, ...needles) {
        if (!mod || typeof mod !== 'object') return null;
        try { let best = null, bs = 0; for (const [k, v] of Object.entries(mod)) { if (typeof v !== 'function') continue; const s = needles.filter(n => v.toString().includes(n)).length; if (s > bs) { bs = s; best = k; } if (s === needles.length) return k; } return best; } catch (_) { return null; }
    }
    getBySourceAny(...sources) { for (const s of sources) { try { const m = BdApi.Webpack.getBySource(s); if (m) return m; } catch (_) {} } return null; }
}
class PatchManager {
    constructor(p) { this.p = p; }
    before(t, m, fn) { try { if (!t?.[m]) return; BdApi.Patcher.before(this.p.pluginName, t, m, fn); } catch (_) {} }
    after(t, m, fn) { try { if (!t?.[m]) return; BdApi.Patcher.after(this.p.pluginName, t, m, fn); } catch (_) {} }
    instead(t, m, fn) { try { if (!t?.[m]) return; BdApi.Patcher.instead(this.p.pluginName, t, m, fn); } catch (_) {} }
    safe(l, fn) { try { fn(); return true; } catch (err) { this._logFail(l, err); return false; } }
    cleanup() { try { BdApi.Patcher.unpatchAll(this.p.pluginName); } catch (_) {} }
    _logFail(l, err) {
        try {
            this.p._nmbStartupFailures = this.p._nmbStartupFailures || [];
            this.p._nmbStartupFailures.push({ name: l, message: err?.message || String(err), time: Date.now() });
            if (this.p._nmbStartupFailures.length === 1)
                this.p.toast('ByeBlocked: parte de uma funcionalidade (' + l + ') nao pode iniciar. Provavelmente o Discord mudou algo - o resto do plugin continua ativo. Veja o console para detalhes.', 'warn');
        } catch (_) {}
    }
}

function _locale(locale, dict) { return dict[locale] || dict[locale.split('-')[0]] || dict.en; }
function _getLocale() { try { return (document.documentElement?.lang || navigator.language || 'en').toLowerCase(); } catch (_) { return 'en'; } }
function _makeDict(pt, en) { return { 'pt-br': pt, pt: pt, 'en-us': en, en: en }; }

module.exports = class ByeBlocked {
    static VERSION="2.3.3";
    static RAW_URL="https://raw.githubusercontent.com/8ug8ird/ByeBlocked/refs/heads/main/ByeBlocked.plugin.js";
    static RELEASE_URL="https://github.com/8ug8ird/ByeBlocked";
    static EVENTS_LOCALE = _makeDict(
        { title: 'N\u00e3o h\u00e1 eventos futuros.', subtitle: 'Agende um evento para qualquer atividade planejada no seu servidor.', tip_prefix: 'Voc\u00ea pode dar permiss\u00e3o para outras pessoas criarem eventos em ', tip_link: 'configura\u00e7\u00f5es do servidor > cargos' },
        { title: 'No upcoming events.', subtitle: 'Schedule an event for any planned activity in your server.', tip_prefix: 'You can give other people permission to create events in ', tip_link: 'server settings > roles' }
    );
    static PINS_LOCALE = _makeDict(
        { body: 'Este canal n\u00e3o tem<br>mensagens fixadas... por enquanto.', tip_label: 'Fica a dica:', tip_text: 'Usu\u00e1rios com a permiss\u00e3o \u201cGerenciar Mensagens\u201d podem fixar uma mensagem no menu de contexto.' },
        { body: "This channel doesn't have<br>any pinned messages... yet.", tip_label: 'Pro tip:', tip_text: 'Users with the "Manage Messages" permission can pin a message from the context menu.' }
    );
    static TOPICS_LOCALE = _makeDict(
        { title: 'N\u00e3o h\u00e1 t\u00f3picos.', subtitle: 'Mantenha o foco em uma conversa com um t\u00f3pico \u2014 um canal de texto tempor\u00e1rio.', button: 'Criar t\u00f3pico' },
        { title: 'There are no threads.', subtitle: 'Stay focused on a conversation with a thread \u2014 a temporary text channel.', button: 'Create Thread' }
    );
    static FORUM_LOCALE = _makeDict(
        { title: 'Seja o primeiro a come\u00e7ar essa conversa!', subtitle: 'Sobre o que voc\u00ea quer postar em #{channel}?' },
        { title: 'Be the first to start this conversation!', subtitle: 'What do you want to post about in #{channel}?' }
    );
    static CHANNEL_STATUS_LOCALE = _makeDict(
        'Status oculto (bloqueado)',
        'Status hidden (blocked)'
    );
    static STAGE_LOCALE = _makeDict(
        { title: 'Sem pedidos', body: 'Os pedidos para falar ser\u00e3o mostrados aqui.' },
        { title: 'No requests', body: 'Requests to speak will show up here.' }
    );
    static SETTINGS_LABELS = {
        blocked: 'Blocked users',
        ignored: 'Muted/ignored users',
        messages: 'Messages & chat',
        memberList: 'Member list & members page',
        voiceChannels: 'Voice & Stage channels (including activity panel, streams)',
        groupDms: 'Group DMs',
        autocomplete: 'Autocomplete & suggestions (mentions, invite picker)',
        reactions: 'Message reactions',
        events: 'Scheduled events (hide events created by blocked users)',
        autoCheckUpdates: 'Auto-check updates on startup',
        muteVoiceJoinLeaveSound: 'Silence join/leave sounds for blocked users',
        muteBlockedVoiceAudio: 'Mute blocked users\' voice/mic audio in calls',
        suppressTaskbarBadge: 'Hide taskbar & tray badge for blocked-only activity'
    };
    constructor() {
        this.pluginName = 'ByeBlocked';
        this.isRunning = false;
        
        this._r = new ModuleResolver();
        this.modules = {};
        this.hiddenElements = new Set;
        this.hiddenParents = new Set;
        this.observer = null;
        
        this.settings = this.loadSettings();
        
        this._updateState = { status: 'idle', latestVersion: null, remoteText: null };
        this._updateNotice = null;
        this._lastNotifiedVersion = null;
        this._periodicCheckInterval = null;
        this._updateResetTimer = null;
        this._lastCheckTimestamp = this.loadLastCheck();
        
        this.scanInterval = null;
        this.scanTimeout = null;
        this.refreshTimeout = null;
        this.saveTimeout = null;
        this._refreshDebounce = null;
        this._moduleRetryTimeout = null;
        this._muteTimeout = null;
        this._reactorModalPassTimer = null;
        this._guildSwitchWaitTimeout = null;
        
        for (const flag of ['store','readState','taskbarBadge','taskbarElectron','forumPostComponent',
            'messagesWrap','inviteSuggestions','privateChannelStore','mentionAutocomplete',
            'activePostsPopover','notificationDispatcher','channelPinsStore','pinFlux',
            'soundboard','guildMembersPage','guildMemberStore','eventsSidebarUnread',
            'memberListRow','stageRenderComponent','activityPanelComponent','callGrid',
            'blockedMsgGroup','voiceMute','guildScheduledEventStore']) {
            this['_' + flag + 'Patched'] = this['_' + flag] || false;
        }
        
        this._voiceChannelMemberIds = new Map;
        this._voiceFakeTimers = new Map;
        this._voiceFakeTimerTick = null;
        this._mutedBlockedUserIds = new Set;
        this._blockedChannelStatuses = new Map;

        this._channelStatusAuthors = new Map;
        this._oldUnblockedConnectedUsers = [];
        this._lastStreamerId = null;
        this._lastActivityParticipantIds = new Set;
        this.originalVoiceMethods = {};
        this._soundPlayKey = null;
        this._localMuteKey = null;
        this._localVolumeKey = null;
        
        this._blockedPinnedMessageIds = this.loadBlockedPinnedIds();
        this._pinPinnerByMessageId = this.loadPinPinnerCache();
        this._pendingPinsByChannel = new Map;
        this._channelPinsStorePatched = false;
        this._pinFluxPatched = false;
        
        this._blockedOnlyReadChannels = new Set;
        this._blockedReadCache = this.loadBlockedReadCache();
        this._readStateRecheckScheduled = false;
        this._readStateRecheckInFlight = false;
        this._readStateRecheckTimer = null;
        this._readStateReloadRecheckTimers = null;
        this._rawGetMessages = null;
        
        this._historyPatchActive = false;
        this._origPushState = null;
        this._origReplaceState = null;
        this._storeResolveCache = {};
        
        this.relationshipChangeHandler = null;
        this._channelPinsChangeHandler = null;
        this._channelSwitchChangeHandler = null;
        this.guildChangeHandler = null;
        this.routerChangeHandler = null;
        this._routerUnsubscribe = null;
        this._roleSettingsClickHandler = null;
        this._reactionClickHandler = null;
        this._contextMenuHandler = null;
        this._menuPortalObserver = null;
        this._threadsStoreChangeHandler = null;
        this._threadStoreChangeHandler = null;
        this._channelStoreChangeHandler = null;
        
        this._lastWatchedChannelId = null;
        this._forumRetryScheduled = false;
        this._lastScanDomTime = 0;
        this._lastContextMessageId = null;
        
        this._patcher = new PatchManager(this);
    }
    get hideStyles() { return 'display: none !important;width: 0 !important;height: 0 !important;min-width: 0 !important;min-height: 0 !important;max-width: 0 !important;max-height: 0 !important;flex: 0 0 0 !important;padding: 0 !important;margin: 0 !important;border: 0 !important;overflow: hidden !important;position: absolute !important;opacity: 0 !important;pointer-events: none !important;transform: scale(0) !important;visibility: hidden !important;line-height: 0 !important;font-size: 0 !important;contain: size style !important;'; }
    _wpGetStore(...names) { return this._r ? this._r.getStore(...names) : this._wpGetStoreLegacy(...names); }
    _wpGetStoreLegacy(...names) {
        for (const n of names) { try { const s = BdApi.Webpack.getStore(n); if (s) return s; } catch (_) {} }
        return this._wpGetStoreByHeuristic(names[0]);
    }
    _wpGetStoreByHeuristic(h) {
        if (!h) return null;
        const ck = 'store:' + h;
        if (this._storeResolveCache?.[ck]) return this._storeResolveCache[ck];
        try {
            const stores = this._wpGetModule(m => m && typeof m === 'object' && typeof m.addChangeListener === 'function' && typeof m.getState === 'function');
            if (!stores) return null;
            const all = Array.isArray(stores) ? stores : [stores];
            const t = h.replace(/store$/i, '').toLowerCase();
            for (const mod of all) {
                const n = (mod.getName?.() || mod.constructor?.displayName || mod.constructor?.name || '').toLowerCase();
                if (n.includes(t)) { if (!this._storeResolveCache) this._storeResolveCache = {}; return this._storeResolveCache[ck] = mod; }
            }
            for (const mod of all) {
                try {
                    const state = mod.getState();
                    if (state && typeof state === 'object')
                        for (const key of Object.keys(state))
                            if (key.toLowerCase().includes(t.replace(/^./, c => c.toLowerCase()))) { if (!this._storeResolveCache) this._storeResolveCache = {}; return this._storeResolveCache[ck] = mod; }
                } catch (_) {}
            }
        } catch (_) {}
        return null;
    }
    _wpGetModule(f, o) { return this._r ? this._r.get(f, o) : (() => { try { return BdApi.Webpack.getModule(f, o); } catch (_) { return null; } })(); }
    _wpGetBySource(s, o) { return this._r ? this._r.getBySource(s, o) : (() => { try { return BdApi.Webpack.getBySource(s, o); } catch (_) { return null; } })(); }
    _wpGetModuleWithKey(f) { return this._r ? this._r.getWithKey(f) : (() => { try { return BdApi.Webpack.getModuleWithKey(f); } catch (_) { return null; } })(); }
    _wpGetModuleByKeys(...keys) { return this._r ? this._r.findByKeys(...keys) : this._wpGetModuleByKeysLegacy(...keys); }
    _wpGetModuleByKeysLegacy(...keys) {
        for (const key of keys) { try { const mod = BdApi.Webpack.getByKeys(key); if (mod) return mod; } catch (_) {} }
        try { const mod = BdApi.Webpack.getModule(m => m && typeof m === 'object' && keys.every(k => k in m)); if (mod) return mod; } catch (_) {}
        try { return BdApi.Webpack.getByKeys(...keys); } catch (_) { return null; }
    }
    _wpGetModuleBySourceAny(...sources) { return this._r ? this._r.getBySourceAny(...sources) : (() => { for (const s of sources) { try { const m = BdApi.Webpack.getBySource(s); if (m) return m; } catch (_) {} } return null; })(); }
    _wpFindFnKey(mod, ...needles) {
        if (!mod || typeof mod !== "object") return null;
        try {
            for (const [key, val] of Object.entries(mod)) {
                if (typeof val !== "function") continue;
                const src = val.toString();
                if (needles.every(n => src.includes(n))) return key;
            }
        } catch (_) {}
        return null;
    }
    _wpFindFnKeyFuzzy(mod, ...needles) {
        if (!mod || typeof mod !== "object") return null;
        try {
            const entries = Object.entries(mod);
            let best = null, bestScore = 0;
            for (const [key, val] of entries) {
                if (typeof val !== "function") continue;
                try {
                    const src = val.toString();
                    let score = 0;
                    for (const n of needles) { if (src.includes(n)) score++; }
                    if (score > bestScore) { bestScore = score; best = key; }
                    if (score === needles.length) return key;
                } catch (_) {}
            }
            return best;
        } catch (_) {}
        return null;
    }
    _wpGetModuleByKeys(...keys) {
        for (const key of keys) {
            try {
                const mod = BdApi.Webpack.getByKeys(key);
                if (mod) return mod;
            } catch (_) {}
        }
        try {
            const mod = BdApi.Webpack.getModule(m => m && typeof m === "object" && keys.every(k => k in m));
            if (mod) return mod;
        } catch (_) {}
        try {
            const mod = BdApi.Webpack.getByKeys(...keys);
            if (mod) return mod;
        } catch (_) {}
        return null;
    }
    _wpGetModuleBySourceAny(...sources) {
        for (const src of sources) {
            try {
                const mod = BdApi.Webpack.getBySource(src);
                if (mod) return mod;
            } catch (_) {}
        }
        return null;
    }
    _wpPatchRenderBySourceHeuristic(shouldSuppress, matchingStrings) {
        const self = this;
        const doPatch = (mod, key, getProps) => {
            if (!mod?.[key] || typeof mod[key] !== "function") return false;
            self.patchInstead(mod, key, function(ctx, args, orig) {
                try {
                    const props = getProps ? getProps(ctx, args) : args?.[0] || ctx?.props;
                    if (shouldSuppress(props, ctx, args)) return null;
                } catch (_) {}
                return orig.apply(ctx, args);
            });
            return true;
        };
        const srcFilter = m => {
            if (typeof m !== "function") return false;
            try {
                const src = Function.prototype.toString.call(m);
                return matchingStrings.some(s => src.includes(s));
            } catch (_) { return false; }
        };
        try {
            const mod = this._wpGetModule(srcFilter, { searchExports: true });
            if (mod) {
                if (doPatch(mod.prototype, "render", () => null)) return true;
                if (doPatch(mod, "default", (ctx, args) => args?.[0])) return true;
            }
        } catch (_) {}
        try {
            const found = this._wpGetModuleWithKey(srcFilter);
            if (found?.[0] && found[1]) {
                return doPatch(found[0], found[1], (ctx, args) => args?.[0]);
            }
        } catch (_) {}
        return false;
    }
    _formatDate(timestamp) {
        if (!timestamp) return "No check yet";
        try {
            const date = new Date(timestamp);
            return date.toLocaleString("en-US", {
                month: "2-digit",
                day: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true
            });
        } catch (_) {
            return "Invalid date";
        }
    }
    _updateLastCheckTime() {
        this._lastCheckTimestamp = Date.now();
        try {
            BdApi.Data.save(this.pluginName, "lastCheck", this._lastCheckTimestamp);
        } catch (_) {}
    }
    loadLastCheck() {
        try {
            return BdApi.Data.load(this.pluginName, "lastCheck") || null;
        } catch (_) {
            return null;
        }
    }
    _openSettingsModal() {
        try {
            const React = BdApi.React;
            const self = this;
            BdApi.UI.showConfirmationModal("âš™ï¸ ByeBlocked Settings", React.createElement(function() {
                const ref = React.useRef(null);
                React.useEffect(function() {
                    if (ref.current) ref.current.appendChild(self.getSettingsPanel());
                }, []);
                return React.createElement("div", {
                    ref: ref
                });
            }), {
                confirmText: "Done",
                cancelText: null,
                size: "large"
            });
        } catch (_) {
            this.toast("Go to BD Settings â†’ Plugins â†’ ByeBlocked âš™ï¸", "info");
        }
    }
    async checkForUpdatesAuto() {
        if (this._updateState.status === "checking") return;
        this._updateState = {
            status: "checking",
            latestVersion: null,
            remoteText: null
        };
        try {
            const text = await this._httpsGet(ByeBlocked.RAW_URL);
            const match = text.match(/@version\s+([\d.]+)/);
            if (!match) throw new Error("Version tag not found");
            const remote = match[1];
            const local = ByeBlocked.VERSION;
            const hasUpdate = this._compareVersions(remote, local) > 0;
            this._updateLastCheckTime();
            if (hasUpdate) {
                if (remote !== this._lastNotifiedVersion) {
                    this._lastNotifiedVersion = remote;
                    this._removeNotice();
                    try {
                        this._updateNotice = BdApi.UI.showNotice(`🎉 ByeBlocked v${remote} is out! You're on v${local} - update available.`, {
                            timeout: 0,
                            buttons: [ {
                                label: "Install now",
                                onClick: () => {
                                    if (this._updateNotice) {
                                        try {
                                            this._updateNotice.close();
                                        } catch (_) {}
                                        this._updateNotice = null;
                                    }
                                    this._autoInstall(remote, text);
                                }
                            }, {
                                label: "View on GitHub",
                                onClick: () => {
                                    this._safeOpenExternal(ByeBlocked.RELEASE_URL);
                                }
                            } ]
                        });
                    } catch (_) {
                        this.toast(`🎉 ByeBlocked v${remote} available! Go to settings.`, "info");
                    }
                }
                this._updateState = {
                    status: "available",
                    latestVersion: remote,
                    remoteText: text
                };
            } else {
                this._updateState = {
                    status: "idle",
                    latestVersion: null,
                    remoteText: null
                };
            }
        } catch (_) {
            this._updateState = {
                status: "idle",
                latestVersion: null,
                remoteText: null
            };
        }
    }
    _removeNotice() {
        try {
            if (this._updateNotice) {
                if (typeof this._updateNotice.close === "function") this._updateNotice.close(); else if (typeof this._updateNotice.remove === "function") this._updateNotice.remove();
                this._updateNotice = null;
            }
            document.querySelectorAll(".bd-notice").forEach(el => {
                if (el.textContent && el.textContent.includes("ByeBlocked")) {
                    const closeBtn = el.querySelector('.bd-close-button, [aria-label="Close"]');
                    if (closeBtn) closeBtn.click(); else el.remove();
                }
            });
        } catch (_) {}
    }
    _scheduleUpdateReset(panelRef) {
        if (this._updateResetTimer) {
            clearTimeout(this._updateResetTimer);
            this._updateResetTimer = null;
        }
        if (this._updateState.status === "upToDate" || this._updateState.status === "error") {
            this._updateResetTimer = setTimeout(() => {
                this._updateState = {
                    status: "idle",
                    latestVersion: null,
                    remoteText: null
                };
                this._renderUpdateBtn(panelRef);
                this._updateResetTimer = null;
            }, 1500);
        }
    }
    async checkForUpdates(panelRef = null, silent = false) {
        if (this._updateResetTimer) {
            clearTimeout(this._updateResetTimer);
            this._updateResetTimer = null;
        }
        if (this._updateState.status === "checking") return;
        this._updateState = {
            status: "checking",
            latestVersion: null,
            remoteText: null
        };
        this._renderUpdateBtn(panelRef);
        try {
            const text = await this._httpsGet(ByeBlocked.RAW_URL);
            const match = text.match(/@version\s+([\d.]+)/);
            if (!match) throw new Error("Version tag not found in remote file");
            const remote = match[1];
            const local = ByeBlocked.VERSION;
            const hasUpdate = this._compareVersions(remote, local) > 0;
            this._updateLastCheckTime();
            this._updatePanelInfo(panelRef);
            if (hasUpdate) {
                this._updateState = {
                    status: "available",
                    latestVersion: remote,
                    remoteText: text
                };
                this._renderUpdateBtn(panelRef);
                if (!silent) {
                    try {
                        this._updateNotice = BdApi.UI.showNotice(`🎉 ByeBlocked v${remote} is out! You're on v${local} - update available.`, {
                            timeout: 0,
                            buttons: [ {
                                label: "Install now",
                                onClick: () => {
                                    if (this._updateNotice) {
                                        try {
                                            this._updateNotice.close();
                                        } catch (_) {}
                                        this._updateNotice = null;
                                    }
                                    this._autoInstall(remote, text, panelRef);
                                }
                            }, {
                                label: "View on GitHub",
                                onClick: () => {
                                    try {
                                        require("electron").shell.openExternal(ByeBlocked.RELEASE_URL);
                                    } catch (_) {
                                        window.open(ByeBlocked.RELEASE_URL, "_blank");
                                    }
                                }
                            } ]
                        });
                    } catch (_) {
                        this.toast(`Update available: v${remote}. Visit GitHub to download.`, "info");
                    }
                }
            } else {
                this._updateState = {
                    status: "upToDate",
                    latestVersion: remote,
                    remoteText: null
                };
                this._renderUpdateBtn(panelRef);
                if (!silent) this.toast("ByeBlocked is up to date!", "success");
                this._scheduleUpdateReset(panelRef);
            }
        } catch (err) {
            this._updateState = {
                status: "error",
                latestVersion: null,
                remoteText: null
            };
            this._renderUpdateBtn(panelRef);
            if (!silent) {
                this.toast("Error checking for updates: " + err.message, "error");
            }
            this._scheduleUpdateReset(panelRef);
        }
    }
    _updatePanelInfo(panelRef) {
        if (!panelRef) return;
        const infoEl = panelRef.querySelector("[data-nmb-last-check]");
        if (infoEl) infoEl.textContent = `Last check: ${this._formatDate(this._lastCheckTimestamp)}`;
    }
    async _safeOpenExternal(url) {
        try {
            if (typeof BdApi?.Utils?.openExternal === "function") {
                BdApi.Utils.openExternal(url);
                return;
            }
        } catch (_) {}
        try {
            const _require = typeof window !== "undefined" && typeof window.require === "function" ? window.require : null;
            if (_require) {
                const electron = _require("electron");
                if (electron?.shell?.openExternal) { electron.shell.openExternal(url); return; }
            }
        } catch (_) {}
        try {
            const DiscordNative = typeof window !== "undefined" ? window.DiscordNative : null;
            if (DiscordNative?.remote?.shell?.openExternal) { DiscordNative.remote.shell.openExternal(url); return; }
        } catch (_) {}
        try {
            if (typeof __non_webpack_require__ !== "undefined") {
                const electron = __non_webpack_require__("electron");
                if (electron?.shell?.openExternal) { electron.shell.openExternal(url); return; }
            }
        } catch (_) {}
        window.open(url, "_blank");
    }
    async _httpsGet(url, _redirectCount = 0) {
        if (_redirectCount > 5) throw new Error("Too many redirects");
        if (typeof BdApi?.Net?.fetch === "function") {
            const res = await BdApi.Net.fetch(url, {
                headers: {
                    "User-Agent": "ByeBlocked-UpdateChecker/1.0",
                    "Cache-Control": "no-cache"
                }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
        }
        const _require = typeof window !== "undefined" && typeof window.require === "function" ? window.require : typeof __non_webpack_require__ !== "undefined" ? __non_webpack_require__ : null;
        if (_require) {
            return new Promise((resolve, reject) => {
                try {
                    const https = _require("https");
                    const urlObj = new URL(url);
                    const options = {
                        hostname: urlObj.hostname,
                        path: urlObj.pathname + urlObj.search,
                        method: "GET",
                        headers: {
                            "User-Agent": "ByeBlocked-UpdateChecker/1.0",
                            "Cache-Control": "no-cache"
                        }
                    };
                    const req = https.request(options, res => {
                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            this._httpsGet(res.headers.location, _redirectCount + 1).then(resolve).catch(reject);
                            return;
                        }
                        if (res.statusCode !== 200) {
                            reject(new Error(`HTTP ${res.statusCode}`));
                            return;
                        }
                        const chunks = [];
                        res.on("data", c => chunks.push(c));
                        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
                        res.on("error", reject);
                    });
                    req.on("error", reject);
                    req.setTimeout(1e4, () => {
                        req.destroy();
                        reject(new Error("Timeout"));
                    });
                    req.end();
                } catch (err) {
                    reject(err);
                }
            });
        }
        const res = await fetch(url, {
            headers: {
                "User-Agent": "ByeBlocked-UpdateChecker/1.0",
                "Cache-Control": "no-cache"
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
    }
    _compareVersions(a, b) {
        const pa = String(a).split(".").map(Number);
        const pb = String(b).split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    }
    async _autoInstall(remoteVersion, remoteText, panelRef = null) {
        if (this._updateResetTimer) {
            clearTimeout(this._updateResetTimer);
            this._updateResetTimer = null;
        }
        try {
            this._removeNotice();
            const fs = require("fs");
            const path = require("path");
            const pluginsDir = BdApi.Plugins.folder;
            const dest = path.join(pluginsDir, "ByeBlocked.plugin.js");
            fs.writeFileSync(dest, remoteText, "utf8");
            this._updateState = {
                status: "upToDate",
                latestVersion: remoteVersion,
                remoteText: null
            };
            this._renderUpdateBtn(panelRef);
            this._lastNotifiedVersion = remoteVersion;
            this.toast(`ByeBlocked updated to v${remoteVersion}!`, "success");
            setTimeout(() => {
                try {
                    if (BdApi.Plugins.isEnabled(this.pluginName)) BdApi.Plugins.disable(this.pluginName);
                    BdApi.Plugins.enable(this.pluginName);
                    this.toast(`Plugin successfully re-activated (v${remoteVersion})!`, "success");
                } catch (_) {
                    this.toast("Plugin updated, but couldn't auto-reactivate. Disable and re-enable manually.", "warn");
                }
            }, 800);
        } catch (err) {
            this.toast("Auto-install failed: " + err.message + " â€” download manually from GitHub.", "error");
            this._safeOpenExternal(ByeBlocked.RELEASE_URL);
        }
    }
    _renderUpdateBtn(panelRef) {
        if (!panelRef) return;
        const btn = panelRef.querySelector("[data-nmb-update-btn]");
        if (!btn) return;
        const iconPaths = {
            idle: `<path d="M14 2v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 7A5.5 5.5 0 1 1 10.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
            checking: `<path d="M14 2v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 7A5.5 5.5 0 1 1 10.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
            upToDate: `<path d="M2.5 8.5l3.5 3.5 7.5-7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
            available: `<path d="M8 2v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
            error: `<path d="M8 3.5v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>`
        };
        const states = {
            idle: {
                label: "Check for updates",
                cls: "",
                disabled: false
            },
            checking: {
                label: "Checkingâ€¦",
                cls: "is-checking",
                disabled: true
            },
            upToDate: {
                label: "Up to date",
                cls: "is-up-to-date",
                disabled: false
            },
            available: {
                label: "Install update",
                cls: "is-update-available",
                disabled: false
            },
            error: {
                label: "Error â€” try again",
                cls: "is-error",
                disabled: false
            }
        };
        const s = states[this._updateState.status] || states.idle;
        const icon = iconPaths[this._updateState.status] || iconPaths.idle;
        const labelEl = btn.querySelector(".nmb-btn-label");
        const iconEl = btn.querySelector(".nmb-btn-icon");
        if (labelEl) labelEl.textContent = s.label;
        if (iconEl) iconEl.innerHTML = icon;
        btn.disabled = s.disabled;
        btn.className = "nmb-update-btn " + s.cls;
        btn.title = this._updateState.status === "available" && this._updateState.latestVersion ? `v${this._updateState.latestVersion} available` : "";
    }
    getDefaultSettings() {
        return {
            types: {
                blocked: true,
                ignored: true
            },
            places: {
                messages: true,
                memberList: true,
                voiceChannels: true,
                groupDms: true,
                autocomplete: true,
                reactions: true,
                events: true
            },
            behavior: {
                autoCheckUpdates: true,
                muteVoiceJoinLeaveSound: true,
                muteBlockedVoiceAudio: true,
                suppressTaskbarBadge: true
            }
        };
    }
    loadSettings() {
        const defaults = this.getDefaultSettings();
        try {
            const stored = BdApi.Data.load(this.pluginName, "settings") || {};
            return this.mergeSettings(defaults, stored);
        } catch (_) {
            return defaults;
        }
    }
    saveSettings(immediate = false) {
        clearTimeout(this.saveTimeout);
        const persist = () => {
            try {
                BdApi.Data.save(this.pluginName, "settings", this.settings);
            } catch (_) {}
        };
        if (immediate) return persist();
        this.saveTimeout = setTimeout(persist, 250);
    }
    mergeSettings(defaults, stored) {
        const merged = {};
        for (const section of Object.keys(defaults)) {
            merged[section] = {
                ...defaults[section]
            };
            const saved = stored?.[section];
            if (saved && typeof saved === "object") {
                for (const key of Object.keys(defaults[section])) {
                    if (typeof saved[key] === "boolean") merged[section][key] = saved[key];
                }
            }
        }
        return merged;
    }
    loadBlockedPinnedIds() {
        try {
            const stored = BdApi.Data.load(this.pluginName, "blockedPinnedIds");
            return Array.isArray(stored) ? new Set(stored) : new Set;
        } catch (_) {
            return new Set;
        }
    }
    saveBlockedPinnedIds() {
        try {
            const MAX_TRACKED = 500;
            let ids = Array.from(this._blockedPinnedMessageIds);
            if (ids.length > MAX_TRACKED) {
                ids = ids.slice(ids.length - MAX_TRACKED);
                this._blockedPinnedMessageIds = new Set(ids);
            }
            BdApi.Data.save(this.pluginName, "blockedPinnedIds", ids);
        } catch (_) {}
    }
    loadPinPinnerCache() {
        try {
            const stored = BdApi.Data.load(this.pluginName, "pinPinnerCache");
            if (stored && typeof stored === "object") return new Map(Object.entries(stored));
        } catch (_) {}
        return new Map;
    }
    savePinPinnerCache() {
        try {
            const entries = Array.from(this._pinPinnerByMessageId.entries()).slice(-500);
            this._pinPinnerByMessageId = new Map(entries);
            BdApi.Data.save(this.pluginName, "pinPinnerCache", Object.fromEntries(entries));
        } catch (_) {}
    }
    _rememberPinPinner(messageId, pinnerId) {
        if (!messageId || !pinnerId) return;
        const key = String(messageId);
        const val = String(pinnerId);
        if (this._pinPinnerByMessageId.get(key) === val) return;
        this._pinPinnerByMessageId.set(key, val);
        this.savePinPinnerCache();
    }
    _getChannelMessagesList(channelId) {
        if (!channelId) return [];
        try {
            const store = this.modules.MessageStore;
            const rawGet = this._rawGetMessages || store?.getMessages || store?.getMessagesForChannel || store?.getMessagesForChannelId;
            const ret = typeof rawGet === "function" ? rawGet.call(store, channelId) : null;
            if (Array.isArray(ret)) return ret;
            if (Array.isArray(ret?._array)) return ret._array;
            if (ret instanceof Map) return Array.from(ret.values());
            if (ret && typeof ret === "object") return Object.values(ret);
        } catch (_) {}
        return [];
    }
    _findPinSystemMessage(channelId, messageId) {
        if (!channelId || !messageId) return null;
        const list = this._getChannelMessagesList(channelId);
        for (let i = list.length - 1; i >= 0; i--) {
            const msg = list[i];
            if (msg?.type !== 6) continue;
            const ref = msg.messageReference?.message_id || msg.message_reference?.message_id;
            if (ref === messageId) return msg;
        }
        return null;
    }
    _resolvePinPinnerId(channelId, messageId, pinItem) {
        if (!messageId) return null;
        const cached = this._pinPinnerByMessageId.get(String(messageId));
        if (cached) return cached;
        const fromItem = pinItem?.pinnedBy?.id || pinItem?.pinned_by?.id || pinItem?.pinner?.id || pinItem?.userId;
        if (fromItem) {
            this._rememberPinPinner(messageId, fromItem);
            return String(fromItem);
        }
        const sys = this._findPinSystemMessage(channelId, messageId);
        const pinnerId = sys?.author?.id || null;
        if (pinnerId) {
            this._rememberPinPinner(messageId, pinnerId);
            return String(pinnerId);
        }
        if (channelId) this._schedulePinPinnerRetry(channelId, messageId);
        return null;
    }
    _cleanupPendingPin(channelId, messageId) {
        if (!channelId || !messageId) return;
        const pending = this._pendingPinsByChannel;
        if (!pending) return;
        const queue = pending.get(channelId);
        if (queue) { queue.delete(messageId); if (!queue.size) pending.delete(channelId); }
    }
    _schedulePinPinnerRetry(channelId, messageId, attempt = 0) {
        if (!channelId || !messageId) return;
        if (!this._pendingPinsByChannel) this._pendingPinsByChannel = new Map;
        if (!this._pendingPinsByChannel.has(channelId)) this._pendingPinsByChannel.set(channelId, new Set);
        if (!attempt && this._pendingPinsByChannel.get(channelId).has(messageId)) return;
        if (!attempt) this._pendingPinsByChannel.get(channelId).add(messageId);
        const delays = [1500, 3000, 6000];
        const maxAttempts = delays.length;
        const delay = attempt < maxAttempts ? delays[attempt] : 10000;
        setTimeout(() => {
            if (!this.isRunning) return;
            const pending = this._pendingPinsByChannel;
            if (!pending || !pending.has(channelId) || !pending.get(channelId).has(messageId)) return;
            if (this._pinPinnerByMessageId.has(String(messageId))) {
                this._cleanupPendingPin(channelId, messageId);
                return;
            }
            this._resolvePendingPinFromStore(channelId, messageId);
            if (attempt + 1 < maxAttempts) {
                if (!this._pendingPinsByChannel) this._pendingPinsByChannel = new Map;
                if (!this._pendingPinsByChannel.has(channelId)) this._pendingPinsByChannel.set(channelId, new Set);
                this._pendingPinsByChannel.get(channelId).add(messageId);
                this._schedulePinPinnerRetry(channelId, messageId, attempt + 1);
            }
        }, delay);
    }
    _shouldHidePinnedMessage(channelId, messageId, pinItem) {
        if (!messageId) return false;
        if (this._blockedPinnedMessageIds.has(String(messageId))) return true;
        const authorId = pinItem?.message?.author?.id;
        if (authorId && this.shouldHide(authorId)) return true;
        const pinnerId = this._resolvePinPinnerId(channelId, messageId, pinItem);
        if (pinnerId && this.shouldHide(pinnerId)) {
            this._markMessagePinnedByBlocked(messageId);
            return true;
        }
        return false;
    }
    _extractPinActionPinnerId(action) {
        if (!action || typeof action !== "object") return null;
        return action.pinnedBy?.id || action.pinnedById || action.userId || action.user?.id || action.pin?.pinnedBy?.id || action.pinned_by?.id || null;
    }
    _processPinStoreItems(channelId, items) {
        if (!channelId || !Array.isArray(items)) return;
        let changed = false;
        for (const item of items) {
            const messageId = item?.message?.id;
            if (!messageId) continue;
            const pinnerId = this._resolvePinPinnerId(channelId, messageId, item);
            if (pinnerId && this.shouldHide(pinnerId)) {
                if (!this._blockedPinnedMessageIds.has(String(messageId))) changed = true;
                this._markMessagePinnedByBlocked(messageId);
            } else if (pinnerId && !this.shouldHide(pinnerId) && this._blockedPinnedMessageIds.has(String(messageId))) {
                changed = true;
                this._unmarkMessageUnpinned(messageId);
            }
        }
        if (changed) this.queueScan();
    }
    _ackBlockedOnlyPins() {
        try {
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            if (!channelId) return;
            const rs = this.modules.ReadStateStore;
            const pinsStore = this.modules.ChannelPinsStore;
            if (!rs || !pinsStore?.getPins) return;
            const items = pinsStore.getPins(channelId)?.items;
            if (!Array.isArray(items) || !items.length) return;
            const lastPinTs = rs.lastPinTimestamp ? rs.lastPinTimestamp(channelId) : null;
            const newPins = lastPinTs ? items.filter(item => {
                const ts = item?.pinnedAt instanceof Date ? item.pinnedAt.getTime() : new Date(item?.pinnedAt || 0).getTime();
                const cmpTs = lastPinTs instanceof Date ? lastPinTs.getTime() : new Date(lastPinTs).getTime();
                return ts > cmpTs;
            }) : items;
            if (!newPins.length) return;
            const allBlocked = newPins.every(item => {
                const messageId = item?.message?.id;
                return messageId && this._shouldHidePinnedMessage(channelId, messageId, item);
            });
            if (!allBlocked) return;
            const ack = rs.ackPins || rs.ackPinnedMessages || rs.ackChannelPins;
            if (typeof ack === "function") ack.call(rs, channelId); else this._forceReadStateRecheck(true);
        } catch (_) {}
    }
    loadBlockedReadCache() {
        try {
            const stored = BdApi.Data.load(this.pluginName, "blockedReadCache");
            return stored && typeof stored === "object" ? stored : {};
        } catch (_) {
            return {};
        }
    }
    saveBlockedReadCache() {
        try {
            BdApi.Data.save(this.pluginName, "blockedReadCache", this._blockedReadCache || {});
        } catch (_) {}
    }
    _markMessagePinnedByBlocked(messageId) {
        if (!messageId || this._blockedPinnedMessageIds.has(String(messageId))) return;
        this._blockedPinnedMessageIds.add(String(messageId));
        this.saveBlockedPinnedIds();
        this.queueRefresh();
        this._forceReadStateRecheck();
        this._ackBlockedOnlyPins();
    }
    _unmarkMessageUnpinned(messageId) {
        if (!messageId || !this._blockedPinnedMessageIds.has(String(messageId))) return;
        this._blockedPinnedMessageIds.delete(String(messageId));
        this.saveBlockedPinnedIds();
        this._forceReadStateRecheck();
    }
    _emitReadStateChanges() {
        try {
            const readState = this.modules.ReadStateStore;
            if (readState && typeof readState.emitChange === "function") readState.emitChange();
        } catch (_) {}
        try {
            const guildReadState = this.modules.GuildReadStateStore;
            if (guildReadState && typeof guildReadState.emitChange === "function") guildReadState.emitChange();
        } catch (_) {}
        this._refreshTaskbarBadge();
    }
    _taskbarBadgeEnabled() {
        return !!(this.settings.places?.messages && this.settings.behavior?.suppressTaskbarBadge);
    }
    _getGuildIds() {
        const gs = this.modules.GuildStore;
        if (!gs) return [];
        try {
            if (typeof gs.getGuildIds === "function") return gs.getGuildIds() || [];
            if (typeof gs.getGuilds === "function") {
                const guilds = gs.getGuilds();
                if (Array.isArray(guilds)) return guilds.map(g => g?.id).filter(Boolean);
                if (guilds && typeof guilds === "object") return Object.keys(guilds);
            }
        } catch (_) {}
        return [];
    }
    _forEachKnownChannel(callback) {
        if (typeof callback !== "function") return;
        const gcs = this.modules.GuildChannelStore;
        for (const guildId of this._getGuildIds()) {
            try {
                const groups = gcs?.getChannels?.(guildId);
                if (!groups || typeof groups !== "object") continue;
                for (const list of Object.values(groups)) {
                    if (!Array.isArray(list)) continue;
                    for (const entry of list) {
                        const channel = entry?.channel || entry;
                        if (channel?.id) callback(channel.id, channel);
                    }
                }
            } catch (_) {}
        }
        const pcs = this.modules.PrivateChannelStore;
        const privateIds = new Set;
        try {
            if (typeof pcs?.getPrivateChannelIds === "function") pcs.getPrivateChannelIds().forEach(id => privateIds.add(id));
            const mutable = pcs?.getMutablePrivateChannels?.();
            if (mutable && typeof mutable === "object") Object.keys(mutable).forEach(id => privateIds.add(id));
        } catch (_) {}
        for (const channelId of privateIds) {
            try {
                const channel = this.modules.ChannelStore?.getChannel?.(channelId);
                callback(channelId, channel);
            } catch (_) {}
        }
    }
    _channelHasVisibleUnread(channelId) {
        const rs = this.modules.ReadStateStore;
        if (!rs || !channelId) return false;
        if (typeof rs.hasTrackedUnread === "function" && rs.hasTrackedUnread(channelId)) return true;
        if (typeof rs.hasUnreadOrMentions === "function" && rs.hasUnreadOrMentions(channelId)) return true;
        return !!rs.hasUnread?.(channelId);
    }
    _filteredHasAnyUnread() {
        const grs = this.modules.GuildReadStateStore;
        for (const guildId of this._getGuildIds()) {
            try {
                if (grs?.hasUnread?.(guildId)) return true;
            } catch (_) {}
        }
        let foundPrivate = false;
        this._forEachKnownChannel((channelId, channel) => {
            if (foundPrivate) return;
            if (channel?.guild_id) return;
            if (channel?.isDM?.() && this.shouldHide(channel.recipient?.id || channel.recipientId)) return;
            if (this._channelHasVisibleUnread(channelId)) foundPrivate = true;
        });
        return foundPrivate;
    }
    _filteredTotalMentionCount() {
        const rs = this.modules.ReadStateStore;
        if (!rs?.getMentionCount) return 0;
        const cs = this.modules.ChannelStore;
        let total = 0;
        this._forEachKnownChannel(channelId => {
            try {
                let count = rs.getMentionCount(channelId) || 0;
                if (count <= 0) return;
                const ch = cs?.getChannel?.(channelId);
                if (ch?.isDM?.() && this.shouldHide(ch.recipient?.id || ch.recipientId)) return;
                if (ch?.guild_id && !this._channelHasVisibleUnread(channelId)) return;
                total += count;
            } catch (_) {}
        });
        return total;
    }
    _recomputeTaskbarBadgeCount() {
        try {
            const rs = this.modules.RelationshipStore;
            const nss = this.modules.NotificationSettingsStore;
            const mentionCount = this._filteredTotalMentionCount();
            const pendingRequests = typeof rs?.getPendingCount === "function" ? rs.getPendingCount() : 0;
            const hasUnread = this._filteredHasAnyUnread();
            const disableUnreadBadge = typeof nss?.getDisableUnreadBadge === "function" ? nss.getDisableUnreadBadge() : false;
            let total = mentionCount + pendingRequests;
            if (!total && hasUnread && !disableUnreadBadge) total = -1;
            return total;
        } catch (_) {
            return null;
        }
    }
    _snowflakeGreater(a, b) {
        if (!a) return false;
        if (!b) return true;
        try {
            return BigInt(a) > BigInt(b);
        } catch (_) {
            return String(a) > String(b);
        }
    }
    _channelHasRawUnread(channelId) {
        const rs = this.modules.ReadStateStore;
        if (!rs || !channelId) return false;
        const lastId = rs.lastMessageId?.(channelId);
        const ackId = rs.ackMessageId?.(channelId);
        return !!(lastId && ackId && this._snowflakeGreater(lastId, ackId));
    }
    _applyBlockedReadCacheOnStartup() {
        const rs = this.modules.ReadStateStore;
        if (!rs || !this._blockedReadCache) return;
        for (const [channelId, activityId] of Object.entries(this._blockedReadCache)) {
            const lastId = rs.lastMessageId?.(channelId);
            if (lastId && String(lastId) === String(activityId)) {
                this._blockedOnlyReadChannels.add(String(channelId));
            }
        }
    }
    _bootstrapBlockedUnreadSuppression() {
        if (!this.settings.places?.messages) return;
        const helpers = this._getReadStateHelpers();
        let changed = false;
        this._forEachKnownChannel((channelId, channel) => {
            if (!this._channelHasRawUnread(channelId)) return;
            if (this._hasBlockedOnlyReadActivity(channelId)) return;
            try {
                if (helpers.isForumParentChannel(channelId)) {
                    const forumResult = helpers.hasVisibleForumActivity(channelId);
                    if (forumResult === false) {
                        const lastId = this.modules.ReadStateStore?.lastMessageId?.(channelId);
                        this._markBlockedOnlyReadActivity(channelId, channel?.parent_id, lastId);
                        changed = true;
                    }
                    return;
                }
                const store = this.modules.ReadStateStore;
                const lastMessageId = store?.lastMessageId?.(channelId);
                const messages = helpers.getChannelMessages(channelId);
                if (messages.length) {
                    const oldestUnreadId = store.getOldestUnreadMessageId ? store.getOldestUnreadMessageId(channelId) : null;
                    if (oldestUnreadId) {
                        const idx = messages.findIndex(m => m?.id === oldestUnreadId);
                        if (idx !== -1) {
                            const anyVisible = messages.slice(idx).some(m => !helpers.isBlockedMessage(m));
                            if (!anyVisible) {
                                this._markBlockedOnlyReadActivity(channelId, channel?.parent_id, lastMessageId);
                                changed = true;
                            }
                            return;
                        }
                    }
                }
                if (lastMessageId && helpers.resolveForumActivityOwnerId) {
                    const ownerId = helpers.resolveForumActivityOwnerId(channelId, lastMessageId);
                    if (ownerId && this.shouldHide(ownerId)) {
                        this._markBlockedOnlyReadActivity(channelId, channel?.parent_id, lastMessageId);
                        changed = true;
                        return;
                    }
                }
                const blockedOnly = this._resolveUnreadFromBlockedOnly(channelId, store, helpers);
                if (blockedOnly === false) {
                    this._markBlockedOnlyReadActivity(channelId, channel?.parent_id, lastMessageId);
                    changed = true;
                }
            } catch (_) {}
        });
        if (changed) {
            this._forceReadStateRecheck(true);
            this._refreshTaskbarBadge();
        }
    }
    _markBlockedOnlyReadActivity(channelId, parentChannelId, activityId) {
        if (!this._blockedOnlyReadChannels) this._blockedOnlyReadChannels = new Set;
        if (channelId) this._blockedOnlyReadChannels.add(String(channelId));
        if (parentChannelId) this._blockedOnlyReadChannels.add(String(parentChannelId));
        if (activityId) {
            if (!this._blockedReadCache) this._blockedReadCache = this.loadBlockedReadCache();
            if (channelId) this._blockedReadCache[String(channelId)] = String(activityId);
            if (parentChannelId) this._blockedReadCache[String(parentChannelId)] = String(activityId);
            this.saveBlockedReadCache();
        }
    }
    _clearBlockedOnlyReadActivity(channelId) {
        if (!channelId || !this._blockedOnlyReadChannels) return;
        const id = String(channelId);
        this._blockedOnlyReadChannels.delete(id);
        if (this._blockedReadCache && id in this._blockedReadCache) {
            delete this._blockedReadCache[id];
            this.saveBlockedReadCache();
        }
    }
    _hasBlockedOnlyReadActivity(channelId) {
        if (!channelId) return false;
        if (this._blockedOnlyReadChannels?.has(String(channelId))) return true;
        const rs = this.modules.ReadStateStore;
        const lastId = rs?.lastMessageId?.(channelId);
        const cached = this._blockedReadCache?.[String(channelId)];
        return !!(lastId && cached && String(lastId) === String(cached));
    }
    _resolveUnreadFromBlockedOnly(channelId, store, helpers) {
        if (!channelId || !store || !helpers) return null;
        const lastMessageId = store.lastMessageId ? store.lastMessageId(channelId) : null;
        if (!lastMessageId) return null;
        const getMessage = this.modules.MessageStore?.getMessage;
        const directMsg = getMessage ? getMessage(channelId, lastMessageId) : null;
        if (directMsg && helpers.isBlockedMessage(directMsg)) return false;
        const ownerId = helpers.resolveForumActivityOwnerId?.(channelId, lastMessageId);
        if (ownerId && this.shouldHide(ownerId)) return false;
        try {
            const threadCh = this.modules.ChannelStore?.getChannel?.(lastMessageId);
            const threadOwner = threadCh?.ownerId || threadCh?.owner_id;
            if (threadOwner && this.shouldHide(threadOwner)) return false;
        } catch (_) {}
        if (this._hasBlockedOnlyReadActivity(channelId)) return false;
        return null;
    }
    _guildHasBlockedOnlyUnread(guildId) {
        if (!guildId) return false;
        if (this._blockedOnlyReadChannels?.size) {
            const cs = this.modules.ChannelStore;
            for (const channelId of this._blockedOnlyReadChannels) {
                try {
                    if (cs?.getChannel?.(channelId)?.guild_id === guildId) return true;
                } catch (_) {}
            }
        }
        if (this._blockedReadCache && this.modules.ReadStateStore) {
            const cs = this.modules.ChannelStore;
            for (const channelId of Object.keys(this._blockedReadCache)) {
                try {
                    if (cs?.getChannel?.(channelId)?.guild_id === guildId && this._hasBlockedOnlyReadActivity(channelId)) return true;
                } catch (_) {}
            }
        }
        const gcs = this.modules.GuildChannelStore;
        const helpers = gcs ? this._getReadStateHelpers() : null;
        if (gcs && helpers) {
            try {
                const groups = gcs.getChannels?.(guildId);
                if (groups && typeof groups === "object") {
                    for (const list of Object.values(groups)) {
                        if (!Array.isArray(list)) continue;
                        for (const entry of list) {
                            const id = entry?.channel?.id;
                            if (!id || !this._channelHasRawUnread(id)) continue;
                            if (helpers.isForumParentChannel(id) && helpers.hasVisibleForumActivity(id) === false) return true;
                        }
                    }
                }
            } catch (_) {}
        }
        return false;
    }
    _filterBadgeArgs(args) {
        if (!this._taskbarBadgeEnabled()) return;
        if (!this._readStatePatched) {
            args[0] = 0;
            return;
        }
        const count = this._recomputeTaskbarBadgeCount();
        if (count !== null) args[0] = count;
    }
    _ensureTaskbarElectronPatch() {
        if (this._taskbarElectronPatched) return;
        const electron = this._wpGetModuleByKeys("setBadge", "setSystemTrayIcon");
        if (!electron?.setBadge) return;
        this.modules.ElectronModule = electron;
        const self = this;
        const badgeBefore = (_, args) => self._filterBadgeArgs(args);
        this._patcher.before(electron, "setBadge", badgeBefore);
        try {
            const nativeApp = typeof DiscordNative !== "undefined" ? DiscordNative?.app : null;
            if (nativeApp?.setBadgeCount) {
                this._patcher.before(nativeApp, "setBadgeCount", badgeBefore);
            }
        } catch (_) {}
        try {
            const altElectron = this._wpGetModuleByKeys("setSystemTrayApplications", "setBadge");
            if (altElectron?.setBadge && altElectron !== electron) {
                this._patcher.before(altElectron, "setBadge", badgeBefore);
            }
        } catch (_) {}
        if (typeof electron.setSystemTrayIcon === "function") {
            this._patcher.before(electron, "setSystemTrayIcon", (_, args) => {
                if (!self._taskbarBadgeEnabled()) return;
                if (!self._readStatePatched) {
                    if (args[0] === "UNREAD") args[0] = "DEFAULT";
                    return;
                }
                if (args[0] !== "UNREAD") return;
                const count = self._recomputeTaskbarBadgeCount();
                if (!count) args[0] = "DEFAULT";
            });
        }
        this._taskbarElectronPatched = true;
        if (this._taskbarBadgeEnabled()) {
            try {
                electron.setBadge(0);
            } catch (_) {}
            try {
                if (typeof electron.setSystemTrayIcon === "function") electron.setSystemTrayIcon("DEFAULT");
            } catch (_) {}
        }
    }
    _refreshTaskbarBadge() {
        if (!this._taskbarBadgeEnabled()) return;
        try {
            const electron = this.modules.ElectronModule;
            if (!electron?.setBadge) return;
            const count = this._recomputeTaskbarBadgeCount();
            if (count === null) return;
            electron.setBadge(count);
            if (typeof electron.setSystemTrayIcon === "function") {
                const showUnreadTray = count !== 0;
                electron.setSystemTrayIcon(showUnreadTray ? "UNREAD" : "DEFAULT");
            }
        } catch (_) {}
    }
    _forceReadStateRecheck(immediate = false) {
        const run = () => {
            this._readStateRecheckScheduled = false;
            this._readStateRecheckInFlight = true;
            try {
                this._emitReadStateChanges();
            } catch (_) {} finally {
                this._readStateRecheckInFlight = false;
            }
        };
        if (immediate) {
            if (this._readStateRecheckTimer) {
                clearTimeout(this._readStateRecheckTimer);
                this._readStateRecheckTimer = null;
            }
            this._readStateRecheckScheduled = false;
            run();
            return;
        }
        if (this._readStateRecheckScheduled || this._readStateRecheckInFlight) return;
        this._readStateRecheckScheduled = true;
        this._readStateRecheckTimer = setTimeout(run, 100);
    }
    _scheduleReadStateReloadRechecks() {
        if (this._readStateReloadRecheckTimers) {
            for (const timer of this._readStateReloadRecheckTimers) clearTimeout(timer);
        }
        this._forceReadStateRecheck(true);
        this._readStateReloadRecheckTimers = [ 0, 300, 800, 2e3, 5e3, 1e4 ].map(delay => setTimeout(() => {
            if (this.isRunning) {
                this._bootstrapBlockedUnreadSuppression();
                this._forceReadStateRecheck(delay === 0);
            }
        }, delay));
    }
    _scanForBlockedPinSystemMessages(ret) {
        try {
            if (!ret) return;
            let list;
            if (Array.isArray(ret)) list = ret; else if (Array.isArray(ret._array)) list = ret._array; else if (ret instanceof Map) list = Array.from(ret.values()); else if (typeof ret === "object") list = Object.values(ret);
            if (!Array.isArray(list) || !list.length) return;
            for (let i = 0; i < list.length; i++) {
                const msg = list[i];
                if (!msg || msg.type !== 6) continue;
                this._handlePinSystemMessage(msg);
            }
        } catch (_) {}
    }
    _resolveDomElByPattern(...patterns) {
        for (const pattern of patterns) {
            try {
                const el = typeof pattern === "function" ? pattern() : document.querySelector(pattern);
                if (el) return el;
            } catch (_) {}
        }
        return null;
    }
    _cancelAllNavTimers() {
        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
            this.scanTimeout = null;
        }
        if (this._refreshDebounce) {
            clearTimeout(this._refreshDebounce);
            this._refreshDebounce = null;
        }
        if (this._guildSwitchWaitTimeout) {
            clearTimeout(this._guildSwitchWaitTimeout);
            this._guildSwitchWaitTimeout = null;
        }
    }
    _handleNavigation() {
        if (!this.isRunning) return;
        this._cancelAllNavTimers();
        this._observerFramePending = false;
        this._injectGuildSwitchGuard();
        if (this.settings.places.events) {
            try {
                this.hideBlockedEvents();
            } catch (_) {}
        }
        try {
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            if (channelId) this._scanExistingPinsForChannel(channelId);
        } catch (_) {}
        this._waitForChatReady(0);
    }
    _waitForChatReady(attempts) {
        const MAX_ATTEMPTS = 60;
        const INTERVAL = 50;
        if (!this.isRunning) {
            this._removeGuildSwitchGuard();
            this._restartObserver();
            return;
        }
        const chatReady = this._resolveDomElByPattern(
            () => document.querySelector('[class*="chatContent"]'),
            () => document.querySelector('[data-list-id*="chat-messages"]'),
            () => document.querySelector('[class*="privateChannels"]'),
            () => document.querySelector('[class*="friendsContainer"]'),
            () => document.querySelector('[class*="noFriendsText"]'),
            () => document.querySelector('[class*="memberRow"]'),
            () => document.querySelector('[class*="membersHeader"]'),
            () => document.querySelector('[class*="chat"]'),
            () => document.querySelector('[data-list-id]')
        );
        if (chatReady || attempts >= MAX_ATTEMPTS) {
            this.hiddenElements.clear();
            this.hiddenParents.clear();
            this._restartObserver();
            this.scanDom();
            this.patchMessageStore();
            try {
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                if (channelId) this._scanExistingPinsForChannel(channelId);
            } catch (_) {}
            this._guildSwitchWaitTimeout = setTimeout(() => {
                if (!this.isRunning) return;
                this.scanDom();
                try {
                    const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                    if (channelId) this._scanExistingPinsForChannel(channelId);
                } catch (_) {}
                this._waitForEventsDataThenRemoveGuard(0);
                this._guildSwitchWaitTimeout = null;
            }, 400);
        } else {
            if (this.settings.places.events) {
                try {
                    this.hideBlockedEvents();
                } catch (_) {}
            }
            this._guildSwitchWaitTimeout = setTimeout(() => {
                this._waitForChatReady(attempts + 1);
            }, INTERVAL);
        }
    }
    _waitForEventsDataThenRemoveGuard(attempts) {
        const MAX_ATTEMPTS = 30;
        const INTERVAL = 100;
        if (!this.isRunning) {
            this._removeGuildSwitchGuard();
            return;
        }
        if (!this.settings.places.events) {
            this._removeGuildSwitchGuard();
            return;
        }
        let storeReady = true;
        try {
            const guildId = this.modules.SelectedGuildStore?.getGuildId?.();
            const hasSidebarEventsItem = !!document.querySelector('[data-list-item-id^="channels___upcoming-events-"]');
            if (guildId && hasSidebarEventsItem) {
                const fromStore = this._getGuildEventsFromStore();
                storeReady = fromStore !== null;
            }
        } catch (_) {
            storeReady = true;
        }
        if (storeReady || attempts >= MAX_ATTEMPTS) {
            try {
                this.hideBlockedEvents();
            } catch (_) {}
            this._removeGuildSwitchGuard();
            this._guildSwitchWaitTimeout = null;
        } else {
            try {
                this.hideBlockedEvents();
            } catch (_) {}
            this._guildSwitchWaitTimeout = setTimeout(() => {
                this._waitForEventsDataThenRemoveGuard(attempts + 1);
            }, INTERVAL);
        }
    }
    _isRelevantMutation(mutations) {
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                const tag = node.tagName;
                if (tag === 'LINK' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'META' || tag === 'TITLE') continue;
                return true;
            }
        }
        return false;
    }
    _restartObserver() {
        this.observer?.disconnect();
        this._observerFramePending = false;
        this.observer = new MutationObserver(mutations => {
            if (!this._isRelevantMutation(mutations)) return;
            if (this.isRunning && this.settings?.places?.voiceChannels) {
                try { this._fastHideChannelStatusFromMutations(mutations); } catch (_) {}
            }
            if (this.isRunning && this.settings.places?.reactions) {
                try { this._fastHideReactionsFromMutations(mutations); } catch (_) {}
            }
            if (this._observerFramePending) return;
            this._observerFramePending = true;
            requestAnimationFrame(() => {
                this._observerFramePending = false;
                if (!this.isRunning) return;
                try {
                    this._fastHideFromMutations(mutations);
                } catch (_) {}
                this.queueScan(true);
            });
        });
        if (document.body) this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    _injectGuildSwitchGuard() {
        if (document.getElementById("nmb-guild-switch-guard")) return;
        const style = document.createElement("style");
        style.id = "nmb-guild-switch-guard";
        const voiceTimerRule = this.settings.places.voiceChannels ? `\n            [data-list-item-id*="channels"] [class*="timer"],\n            [data-list-item-id*="channels"] [class*="voiceTimer"],\n            [data-list-item-id*="channels"] [role="timer"],\n            [data-list-item-id*="channels"] [class*="tabularNumbers"],\n            [class*="voiceChannel"] [class*="timer"],\n            [class*="voiceChannel"] [class*="voiceTimer"],\n            [class*="voiceChannel"] [role="timer"],\n            [class*="voiceChannel"] [class*="tabularNumbers"] {\n                visibility: hidden !important;\n            }\n        ` : "";
        const stageIconGuardRule = this.settings.places.voiceChannels ? `\n            [data-list-item-id*="channels"] [class*="iconLive"],\n            [class*="voiceChannel"] [class*="iconLive"] {\n                color: var(--channels-default) !important;\n            }\n        ` : "";
        const eventsGuardRule = this.settings.places.events ? `\n            li:has([data-list-item-id^="channels___upcoming-events-"]) {\n                visibility: hidden !important;\n            }\n        ` : "";
        const channelStatusGuardRule = "";
        style.textContent = `\n            [class*="messageGroupBlocked"],\n            [class*="blockedSystemMessage"],\n            li[class*="messageListItem"]:has([class*="messageGroupBlocked"]),\n            li[class*="messageListItem"]:has([class*="blockedSystemMessage"]) {\n                display: none !important;\n                height: 0 !important;\n                overflow: hidden !important;\n                contain: size style !important;\n            }\n            ${voiceTimerRule}\n            ${stageIconGuardRule}\n            ${eventsGuardRule}\n            ${channelStatusGuardRule}\n        `;
        document.head.appendChild(style);
    }
    _removeGuildSwitchGuard() {
        document.getElementById("nmb-guild-switch-guard")?.remove();
    }
    _patchHistoryApi() {
        try {
            if (this._historyPatchActive) return;
            this._origPushState = history.pushState;
            this._origReplaceState = history.replaceState;
            const self = this;
            history.pushState = function(...a) {
                self._origPushState.apply(this, a);
                self._handleNavigation();
            };
            history.replaceState = function(...a) {
                self._origReplaceState.apply(this, a);
                self._handleNavigation();
            };
            this._historyPatchActive = true;
        } catch (_) {}
    }
    start(_retryAttempt = 0) {
        if (this.isRunning) return;
        this.isRunning = true;
        window.__byeBlocked = this;
        this._injectGuildSwitchGuard();
        this._patcher.safe('resolveModules', () => this.resolveModules());
        if (!this.modules.RelationshipStore?.isBlocked) {
            const maxAttempts = 12;
            if (_retryAttempt < maxAttempts) {
                this.isRunning = false;
                const delay = Math.min(1000 * Math.pow(1.5, _retryAttempt), 20000);
                clearTimeout(this._moduleRetryTimeout);
                this._moduleRetryTimeout = setTimeout(() => this.start(_retryAttempt + 1), delay);
                return;
            }
            this.isRunning = false;
            this.toast('ByeBlocked: nao foi possivel localizar o RelationshipStore do Discord apos varias tentativas. O Discord provavelmente mudou algo - verifique se ha uma atualizacao do plugin.', 'error');
            return;
        }
        clearTimeout(this._moduleRetryTimeout);
        const p = this._patcher;
        p.safe('patchReadState', () => this.patchReadState());
        p.safe('scheduleReadStateReloadRechecks', () => this._scheduleReadStateReloadRechecks());
        p.safe('addStyles', () => this.addStyles());
        p.safe('patchStores', () => this.patchStores());
        p.safe('patchChannelPinsStore', () => this.patchChannelPinsStore());
        p.safe('patchPinFlux', () => this.patchPinFlux());
        p.safe('patchPrivateChannelStore', () => this.patchPrivateChannelStore());
        p.safe('patchGuildScheduledEventStore', () => this.patchGuildScheduledEventStore());
        p.safe('patchEventsSidebarUnread', () => this.patchEventsSidebarUnread());
        p.safe('patchGuildMemberStore', () => this.patchGuildMemberStore());
        p.safe('patchActivePostsPopoverComponent', () => this.patchActivePostsPopoverComponent());
        p.safe('patchReactions', () => this.patchReactions());
        p.safe('patchRelationshipUpdates', () => this.patchRelationshipUpdates());
        p.safe('patchBlockedMessageGroup', () => this.patchBlockedMessageGroup());
        p.safe('patchMessagesWrapComponent', () => this.patchMessagesWrapComponent());
        p.safe('patchForumPostComponent', () => this.patchForumPostComponent());
        p.safe('patchCallGridParticipants', () => this.patchCallGridParticipants());
        p.safe('patchMessageStore', () => this.patchMessageStore());
        p.safe('restartObserver', () => this._restartObserver());
        p.safe('startReactionClickWatcher', () => this._startReactionClickWatcher());
        p.safe('startChannelSwitchWatcher', () => this._startChannelSwitchWatcher());
        p.safe('seedVoiceChannelMembers', () => this._seedVoiceChannelMembers());
        this.scanInterval = setInterval(() => this.queueScan(), 4e3);
        this.queueRefresh();
        this._waitForChatReady(0);
        setTimeout(() => {
            try {
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                if (channelId) this._scanExistingPinsForChannel(channelId);
            } catch (_) {}
        }, 1500);
        this._registerModuleRefresh();
        if (this.settings.behavior.autoCheckUpdates) {
            setTimeout(() => this.checkForUpdatesAuto(), 5e3);
            this._periodicCheckInterval = setInterval(() => this.checkForUpdatesAuto(), 72e5);
        }
        setTimeout(() => {
            p.safe('patchInviteSuggestions', () => this.patchInviteSuggestions());
            p.safe('patchMentionAutocomplete', () => this.patchMentionAutocomplete());
            p.safe('patchGuildMembersPageRow', () => this.patchGuildMembersPageRow());
            p.safe('patchMemberListRow', () => this.patchMemberListRow());
            p.safe('patchSoundboardEffects', () => this.patchSoundboardEffects());
            if (this.settings.behavior.muteVoiceJoinLeaveSound || this.settings.behavior.muteBlockedVoiceAudio)
                p.safe('patchSound', () => this.patchSound());
            if (this.settings.behavior.muteBlockedVoiceAudio)
                p.safe('patchVoiceMute', () => this.patchVoiceMute());
        }, 2e3);
        setTimeout(() => {
            p.safe('patchStageRenderComponent', () => this.patchStageRenderComponent());
            p.safe('patchActivityPanelComponent', () => this.patchActivityPanelComponent());
        }, 3e3);
        this._patchHistoryApi();
        this._roleSettingsClickHandler = event => {
            const link = event.target.closest?.('[data-nmb-open-role-settings="true"]');
            if (!link) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                this._closeEventsPopoverFrom(link);
                this._openGuildRolesSettings();
            } catch (_) {
                this.toast("âš ï¸ NÃ£o foi possÃ­vel abrir as configuraÃ§Ãµes do servidor automaticamente.", "warn");
            }
        };
        document.addEventListener("click", this._roleSettingsClickHandler, true);
    }
    _closeEventsPopoverFrom(link) {
        try {
            const dialog = link.closest('[role="dialog"], [class*="layer"]');
            if (!dialog) return;
            const closeBtn = dialog.querySelector('[aria-label="Fechar"], [aria-label="Close"]');
            if (closeBtn) {
                closeBtn.click();
                return;
            }
            document.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Escape",
                code: "Escape",
                keyCode: 27,
                which: 27,
                bubbles: true
            }));
        } catch (_) {}
    }
    stop() {
        this.isRunning = false;
        clearTimeout(this._moduleRetryTimeout);
        this._moduleRetryTimeout = null;
        if (window.__byeBlocked === this) delete window.__byeBlocked;
        if (this._updateResetTimer) {
            clearTimeout(this._updateResetTimer);
            this._updateResetTimer = null;
        }
        if (this._periodicCheckInterval) {
            clearInterval(this._periodicCheckInterval);
            this._periodicCheckInterval = null;
        }
        if (this._refreshDebounce) {
            clearTimeout(this._refreshDebounce);
            this._refreshDebounce = null;
        }
        if (this._guildSwitchWaitTimeout) {
            clearTimeout(this._guildSwitchWaitTimeout);
            this._guildSwitchWaitTimeout = null;
        }
        if (this._readStateRecheckTimer) {
            clearTimeout(this._readStateRecheckTimer);
            this._readStateRecheckTimer = null;
        }
        this._readStateRecheckScheduled = false;
        this._readStateRecheckInFlight = false;
        this.observer?.disconnect();
        this.observer = null;
        if (this._reactionClickHandler) {
            document.removeEventListener("click", this._reactionClickHandler, true);
            this._reactionClickHandler = null;
        }
        if (this._contextMenuHandler) {
            document.removeEventListener("contextmenu", this._contextMenuHandler, true);
            document.removeEventListener("click", this._contextMenuHandler, true);
            this._contextMenuHandler = null;
        }
        if (this._roleSettingsClickHandler) {
            document.removeEventListener("click", this._roleSettingsClickHandler, true);
            this._roleSettingsClickHandler = null;
        }
        this._menuPortalObserver?.disconnect();
        this._menuPortalObserver = null;
        if (this._statusModalClickHandler) {
            document.removeEventListener("click", this._statusModalClickHandler, true);
            this._statusModalClickHandler = null;
        }
        this._statusModalObserver?.disconnect();
        this._statusModalObserver = null;
        clearInterval(this.scanInterval);
        clearTimeout(this.scanTimeout);
        clearTimeout(this.refreshTimeout);
        clearTimeout(this.saveTimeout);
        this.scanInterval = null;
        this.scanTimeout = null;
        this.refreshTimeout = null;
        if (this._voiceFakeTimerTick) {
            clearInterval(this._voiceFakeTimerTick);
            this._voiceFakeTimerTick = null;
        }
        this._voiceFakeTimers.clear();
        this._voiceChannelMemberIds.clear();
        this._blockedChannelStatuses?.clear();
        this._channelStatusAuthors?.clear();
        try {
            this._releaseAllVoiceMutes();
        } catch (_) {}
        this._voiceMutePatched = false;
        try {
            this.modules.RelationshipStore?.removeChangeListener?.(this.relationshipChangeHandler);
        } catch (_) {}
        this.relationshipChangeHandler = null;
        try {
            this.modules.ChannelPinsStore?.removeChangeListener?.(this._channelPinsChangeHandler);
        } catch (_) {}
        this._channelPinsChangeHandler = null;
        try {
            this.modules.ActiveJoinedThreadsStore?.removeChangeListener?.(this._threadsStoreChangeHandler);
        } catch (_) {}
        this._threadsStoreChangeHandler = null;
        try {
            this.modules.ThreadStore?.removeChangeListener?.(this._threadStoreChangeHandler);
        } catch (_) {}
        this._threadStoreChangeHandler = null;
        try {
            this.modules.ChannelStore?.removeChangeListener?.(this._channelStoreChangeHandler);
        } catch (_) {}
        this._channelStoreChangeHandler = null;
        if (this._readStateReloadRecheckTimers) {
            for (const timer of this._readStateReloadRecheckTimers) clearTimeout(timer);
            this._readStateReloadRecheckTimers = null;
        }
        try {
            this.modules.SelectedChannelStore?.removeChangeListener?.(this._channelSwitchChangeHandler);
        } catch (_) {}
        this._channelSwitchChangeHandler = null;
        this._lastWatchedChannelId = null;
        this._forumRetryScheduled = false;
        this._patcher?.cleanup();
        this.restoreAllElements();
        this.removeStyles();
        this._removeNotice();
        this._removeGuildSwitchGuard();
        this._navFluxHandler = null;
        this.guildChangeHandler = null;
        this.routerChangeHandler = null;
        this._guildSwitchFluxHandler = null;
        this._channelSelectFluxHandler = null;
        this._lastSeenGuildId = null;
        if (this._historyPatchActive) {
            history.pushState = this._origPushState;
            history.replaceState = this._origReplaceState;
            this._historyPatchActive = false;
        }
        if (this._routerUnsubscribe) {
            try { this._routerUnsubscribe(); } catch (_) {}
            this._routerUnsubscribe = null;
        }
        for (const flag of ['store','readState','taskbarBadge','taskbarElectron','notificationDispatcher',
            'forumPostComponent','messagesWrap','inviteSuggestions','privateChannelStore',
            'mentionAutocomplete','activePostsPopover','channelPinsStore','pinFlux',
            'soundboard','guildMembersPage','guildMemberStore','eventsSidebarUnread',
            'memberListRow','stageRenderComponent','activityPanelComponent','callGrid',
            'blockedMsgGroup','voiceMute','guildScheduledEventStore','reactions']) {
            this['_' + flag + 'Patched'] = false;
        }
        if (this._blockedOnlyReadChannels) this._blockedOnlyReadChannels.clear();
        this._rawGetMessages = null;
        this.modules.ElectronModule = null;
        this._oldUnblockedConnectedUsers = [];
        this._soundPlayKey = null;
        this._lastStreamerId = null;
        this._lastActivityParticipantIds = new Set;
        this._guildMembersPagePatched = false;
        this._guildMemberStorePatched = false;
        this._eventsSidebarUnreadPatched = false;
        this._memberListRowPatched = false;
        this._stageRenderComponentPatched = false;
        this._activityPanelComponentPatched = false;
        this._blockedMsgGroupPatched = false;
        this._voiceMutePatched = false;
        if (this._muteTimeout) {
            clearTimeout(this._muteTimeout);
            this._muteTimeout = null;
        }
        if (this._reactorModalPassTimer) {
            clearTimeout(this._reactorModalPassTimer);
            this._reactorModalPassTimer = null;
        }
    }
    resolveModules() {
        const getStore = (...names) => this._wpGetStore(...names);
        const getModule = (filter, opts) => this._wpGetModule(filter, opts);
        this.modules.RelationshipStore = getStore("RelationshipStore", "RelationshipManagerStore", "RelationshipStoreManager");
        this.modules.GuildMemberStore = getStore("GuildMemberStore", "MemberStore", "GuildMembersStore");
        this.modules.ReactionsStore = getStore("ReactionsStore", "MessageReactionsStore", "ReactionStore");
        this.modules.SortedVoiceStateStore = getStore("SortedVoiceStateStore", "VoiceStateStore", "SortedVoiceStatesStore");
        this.modules.StageChannelParticipantStore = getStore("StageChannelParticipantStore", "StageParticipantStore");
        this.modules.StageInstanceStore = getStore("StageInstanceStore", "StageInstancesStore");
        this.modules.ActivityStore = getStore("ActivityStore", "EmbeddedActivityStore", "ActivityParticipantsStore", "ActivityManagerStore");
        this.modules.ChannelStore = getStore("ChannelStore", "ChannelsStore");
        this.modules.MessageStore = getStore("MessageStore", "MessagesStore", "ChannelMessagesStore");
        this._resolveMessagesGet();
        this.modules.UserStore = getStore("UserStore", "UsersStore", "CurrentUserStore");
        this.modules.SelectedGuildStore = getStore("SelectedGuildStore", "SelectedGuildIdStore");
        this.modules.RelationshipUtils = getModule(m => m?.addRelationship && m?.removeRelationship);
        this.modules.SelectedChannelStore = getStore("SelectedChannelStore", "ChannelSelectedStore");
        this.modules.VoiceStateStore = getStore("VoiceStateStore", "VoiceStatesStore");
        this.modules.MediaEngineStore = getStore("MediaEngineStore", "MediaEngineManagerStore");
        this.modules.ReadStateStore = getStore("ReadStateStore", "ChannelReadStateStore", "ReadStatesStore");
        this.modules.GuildReadStateStore = getStore("GuildReadStateStore", "GuildUnreadStore", "GuildReadStatesStore");
        this.modules.GuildChannelStore = getStore("GuildChannelStore", "GuildChannelsStore");
        this.modules.GuildStore = getStore("GuildStore", "GuildsStore");
        this.modules.PrivateChannelStore = getStore("PrivateChannelStore", "PrivateChannelsStore");
        this.modules.NotificationSettingsStore = getStore("NotificationSettingsStore", "NotificationStore");
        this.modules.ChannelPinsStore = getStore("ChannelPinsStore", "PinnedMessagesStore");
        this.modules.ActiveJoinedThreadsStore = getStore("ActiveJoinedThreadsStore", "JoinedThreadsStore");
        this.modules.ThreadStore = getStore("ActiveThreadsStore", "ThreadStore", "ForumChannelStore", "GuildThreadStore", "ThreadsStore");
        this.modules.GuildScheduledEventStore = getStore("GuildScheduledEventStore", "ScheduledEventStore", "GuildEventsStore");
        this.modules.ChannelStatusStore = getStore("ChannelStatusStore", "VoiceChannelStatusStore", "ChannelStatusesStore");
        this._resolveDispatcher();
        this.modules.RTCConnectionUtils = getModule(m => typeof m?.getChannelId === "function" && typeof m?.getGuildId === "function");
        this._resolveMediaEngineActions();
        try {
            this.resolveInviteQueryModule();
        } catch (_) {
            this.modules.InviteQueryModule = null;
            this.modules.InviteQueryComposeKey = null;
        }
        this._resolveSoundUtils();
        this._nmbReportMissingModules();
    }
    _resolveSoundUtils() {
        const getModuleRaw = filter => this._wpGetModule(filter, { defaultExport: false });
        this.modules.SoundUtils = getModuleRaw(m => {
            if (!m || typeof m !== "object") return false;
            try {
                return Object.values(m).some(v => {
                    if (typeof v !== "function") return false;
                    const src = v.toString();
                    return src.includes("disableSounds") && src.includes("getSoundpack");
                });
            } catch (_) { return false; }
        });
        if (this.modules.SoundUtils) {
            this._soundPlayKey = null;
            try {
                for (const [key, val] of Object.entries(this.modules.SoundUtils)) {
                    if (typeof val !== "function") continue;
                    const src = val.toString();
                    if (src.includes("disableSounds") && src.includes("getSoundpack")) {
                        this._soundPlayKey = key;
                        break;
                    }
                }
            } catch (_) {}
            if (!this._soundPlayKey) {
                this._soundPlayKey = this._wpFindFnKeyFuzzy(this.modules.SoundUtils, "playSound", "playFile");
                if (!this._soundPlayKey) this.modules.SoundUtils = null;
            }
        } else {
            this.modules.SoundUtils = getModuleRaw(m => typeof m?.playSound === "function" && typeof m?.playFile === "function");
            if (this.modules.SoundUtils) this._soundPlayKey = "playSound";
        }
        if (!this.modules.SoundUtils || !this._soundPlayKey) {
            const altMod = this._wpGetModule(m => {
                if (typeof m !== "object" || !m) return false;
                return Object.values(m).some(v => typeof v === "function" && v.toString().includes("playSound"));
            });
            if (altMod) {
                const k = this._wpFindFnKeyFuzzy(altMod, "playSound", "play");
                if (k) { this.modules.SoundUtils = altMod; this._soundPlayKey = k; }
            }
        }
    }
    _resolveMediaEngineActions() {
        try {
            const mod = this._wpGetModule(m => {
                if (typeof m !== "object" || !m) return false;
                return Object.values(m).some(v => {
                    if (typeof v !== "function") return false;
                    try {
                        const src = v.toString();
                        return src.includes("setLocalVolume") || (src.includes("LOCAL_VOLUME") && src.includes("userId"));
                    } catch (_) { return false; }
                });
            }, { searchExports: true });
            if (mod) {
                this.modules.MediaEngineActions = mod;
                this._localVolumeKey = this._wpFindFnKeyFuzzy(mod, "setLocalVolume") || this._wpFindFnKey(mod, "setLocalVolume");
                this._localMuteKey = this._wpFindFnKeyFuzzy(mod, "setLocalMute") || this._wpFindFnKey(mod, "setLocalMute");
            }
        } catch (_) {}
        if (!this.modules.MediaEngineActions || (!this._localVolumeKey && !this._localMuteKey)) {
            try {
                const alt = this._wpGetModule(m => typeof m?.setLocalVolume === "function" || typeof m?.setLocalMute === "function");
                if (alt) {
                    this.modules.MediaEngineActions = alt;
                    this._localVolumeKey = typeof alt.setLocalVolume === "function" ? "setLocalVolume" : this._localVolumeKey;
                    this._localMuteKey = typeof alt.setLocalMute === "function" ? "setLocalMute" : this._localMuteKey;
                }
            } catch (_) {}
        }
    }
    _resolveMessagesGet() {
        const store = this.modules.MessageStore;
        if (store && !this._rawGetMessages) {
            for (const method of ["getMessages", "getMessagesForChannel", "getMessagesForChannelId", "getChannelMessages"]) {
                if (typeof store[method] === "function") {
                    this._rawGetMessages = store[method].bind(store);
                    break;
                }
            }
        }
    }
    _resolveDispatcher() {
        try {
            this.modules.Dispatcher = this.modules.SelectedChannelStore?._dispatcher || null;
            if (this.modules.Dispatcher && typeof this.modules.Dispatcher.dispatch === "function") return;
        } catch (_) {}
        try {
            const d = this._wpGetModule(m => m && typeof m === "object" && typeof m.dispatch === "function" && typeof m.subscribe === "function");
            if (d) { this.modules.Dispatcher = d; return; }
        } catch (_) {}
        try {
            const d2 = this._wpGetBySource("dispatch", { defaultExport: false });
            if (d2 && typeof d2.dispatch === "function") { this.modules.Dispatcher = d2; return; }
        } catch (_) {}
        try {
            const entries = Object.entries(window);
            for (const [key, val] of entries) {
                if (key.startsWith("__FLUX_DISPATCHER") && val && typeof val.dispatch === "function") {
                    this.modules.Dispatcher = val;
                    return;
                }
            }
        } catch (_) {}
        this.modules.Dispatcher = null;
    }
    _registerModuleRefresh() {
        try {
            this._patcher.after(this, "resolveModules", () => {
                this._resolveDispatcher();
                this._resolveMessagesGet();
                this._resolveSoundUtils();
                if (!this._guildScheduledEventStorePatched) {
                    this._patcher.safe("patchGuildScheduledEventStore", () => this.patchGuildScheduledEventStore());
                }
                if (!this._eventsSidebarUnreadPatched) {
                    this._patcher.safe("patchEventsSidebarUnread", () => this.patchEventsSidebarUnread());
                }
            });
        } catch (_) {}
    }
    _nmbCoreModuleSpecs() {
        return [
            ["RelationshipStore", "isBlocked"],
            ["ChannelStore", "getChannel"],
            ["UserStore", "getCurrentUser"],
            ["SelectedChannelStore", "getChannelId"],
            ["MessageStore", "getMessages"],
            ["GuildMemberStore", "getMember"]
        ];
    }
    _nmbReportMissingModules() {
        const missing = [];
        for (const [name, method] of this._nmbCoreModuleSpecs()) {
            const mod = this.modules[name];
            if (!mod || typeof mod[method] !== "function") {
                const resolved = this._wpGetStoreByHeuristic(name);
                if (resolved && typeof resolved[method] === "function") {
                    this.modules[name] = resolved;
                } else {
                    missing.push(name);
                }
            }
        }
        this._nmbMissingCoreModules = missing;
        if (missing.length) {
        }
        return missing;
    }
    patchPrivateChannelStore() {
        const pcs = this.modules.PrivateChannelStore;
        if (!pcs || this._privateChannelStorePatched) return;
        const self = this;
        const filterIds = ids => {
            if (!self.settings.places.groupDms && !self.settings.places.messages) return ids;
            if (!Array.isArray(ids)) return ids;
            return ids.filter(id => {
                try {
                    const ch = self.modules.ChannelStore?.getChannel?.(id);
                    if (!ch) return true;
                    if (ch.isDM?.() && self.shouldHide(ch.recipient?.id || ch.recipientId)) return false;
                    if (self.settings.places.groupDms && ch.isGroupDM?.()) {
                        const recipients = ch.recipients || ch.rawRecipients?.map(u => u?.id || u) || [];
                        if (Array.isArray(recipients) && recipients.length && recipients.every(rid => self.shouldHide(rid))) return false;
                    }
                    return true;
                } catch (_) {
                    return true;
                }
            });
        };
        const filterMutable = obj => {
            if (!obj || typeof obj !== "object" || !self.settings.places.groupDms && !self.settings.places.messages) return obj;
            const out = Array.isArray(obj) ? [] : {};
            const entries = Array.isArray(obj) ? obj.entries() : Object.entries(obj);
            for (const [key, ch] of entries) {
                const id = ch?.id || key;
                const channel = ch || self.modules.ChannelStore?.getChannel?.(id);
                if (channel?.isDM?.() && self.shouldHide(channel.recipient?.id || channel.recipientId)) continue;
                if (self.settings.places.groupDms && channel?.isGroupDM?.()) {
                    const recipients = channel.recipients || channel.rawRecipients?.map(u => u?.id || u) || [];
                    if (Array.isArray(recipients) && recipients.length && recipients.every(rid => self.shouldHide(rid))) continue;
                }
                if (Array.isArray(out)) out.push(ch); else out[key] = ch;
            }
            return out;
        };
        if (typeof pcs.getPrivateChannelIds === "function") {
            this.patchAfter(pcs, "getPrivateChannelIds", (_, __, ret) => filterIds(ret));
        }
        if (typeof pcs.getMutablePrivateChannels === "function") {
            this.patchAfter(pcs, "getMutablePrivateChannels", (_, __, ret) => filterMutable(ret));
        }
        if (typeof pcs.getPrivateChannels === "function") {
            this.patchAfter(pcs, "getPrivateChannels", (_, __, ret) => filterMutable(ret));
        }
        this._privateChannelStorePatched = true;
    }
    patchGuildScheduledEventStore() {
        if (this._guildScheduledEventStorePatched) return;
        if (!this.settings.places.events) return;
        const store = this.modules.GuildScheduledEventStore;
        if (!store) return;
        const self = this;
        const isVisibleEvent = ev => {
            if (!ev) return false;
            const creatorId = ev.creatorId || ev.creator_id || ev.creator?.id;
            if (!creatorId) return true;
            return !self.shouldHide(String(creatorId));
        };
        const filterList = list => {
            if (!Array.isArray(list)) return list;
            const filtered = list.filter(isVisibleEvent);
            return filtered.length === list.length ? list : filtered;
        };
        const filterMapLike = obj => {
            if (!obj || typeof obj !== "object") return obj;
            if (Array.isArray(obj)) return filterList(obj);
            let changed = false;
            const out = {};
            for (const key of Object.keys(obj)) {
                if (isVisibleEvent(obj[key])) {
                    out[key] = obj[key];
                } else {
                    changed = true;
                }
            }
            return changed ? out : obj;
        };
        const wrapReturn = ret => {
            if (Array.isArray(ret)) return filterList(ret);
            if (ret && typeof ret === "object") return filterMapLike(ret);
            return ret;
        };
        let patchedAny = false;
        if (typeof store.getGuildScheduledEventsByIndex === "function") {
            this.patchAfter(store, "getGuildScheduledEventsByIndex", (_, __, ret) => {
                if (!self.settings.places.events) return ret;
                try {
                    return wrapReturn(ret);
                } catch (_) {
                    return ret;
                }
            });
            patchedAny = true;
        }
        if (typeof store.getGuildEventCountByIndex === "function") {
            this.patchAfter(store, "getGuildEventCountByIndex", (_, args, ret) => {
                if (!self.settings.places.events) return ret;
                if (typeof ret !== "number") return ret;
                try {
                    if (typeof store.getGuildScheduledEventsByIndex === "function") {
                        const filtered = store.getGuildScheduledEventsByIndex(...args);
                        if (Array.isArray(filtered)) return filtered.length;
                    }
                    return ret;
                } catch (_) {
                    return ret;
                }
            });
            patchedAny = true;
        }
        if (typeof store.getGuildScheduledEventsForGuild === "function") {
            this.patchAfter(store, "getGuildScheduledEventsForGuild", (_, __, ret) => {
                if (!self.settings.places.events) return ret;
                try {
                    return wrapReturn(ret);
                } catch (_) {
                    return ret;
                }
            });
            patchedAny = true;
        }
        if (typeof store.getGuildScheduledEvent === "function") {
            this.patchAfter(store, "getGuildScheduledEvent", (_, args, ret) => {
                if (!self.settings.places.events) return ret;
                try {
                    return isVisibleEvent(ret) ? ret : null;
                } catch (_) {
                    return ret;
                }
            });
            patchedAny = true;
        }
        if (patchedAny) this._guildScheduledEventStorePatched = true;
    }
    patchEventsSidebarUnread() {
        if (this._eventsSidebarUnreadPatched) return;
        const rs = this.modules.ReadStateStore;
        if (!rs) return;
        const self = this;

        const asKnownGuildEventsId = arg0 => {
            if (typeof arg0 !== "string" && typeof arg0 !== "number") return null;
            const id = String(arg0);
            try {
                const isChannel = !!self.modules.ChannelStore?.getChannel?.(id);
                if (isChannel) return null;
                const isGuild = !!self.modules.GuildStore?.getGuild?.(id);
                return isGuild ? id : null;
            } catch (_) {
                return null;
            }
        };

        const hasVisibleUnseenEvent = guildId => {
            try {
                const store = self.modules.GuildScheduledEventStore;
                if (!store) return true;
                const getters = [ "getGuildScheduledEventsForGuild", "getEvents", "getEventsForGuild" ];
                let events = null;
                for (const name of getters) {
                    if (typeof store[name] === "function") {
                        events = store[name](guildId);
                        if (events) break;
                    }
                }
                if (!events) return true;
                const list = Array.isArray(events) ? events : Object.values(events);
                return list.some(ev => {
                    const creatorId = ev?.creatorId || ev?.creator_id || ev?.creator?.id;
                    return !(creatorId && self.shouldHide(String(creatorId)));
                });
            } catch (_) {
                return true;
            }
        };

        let patchedAny = false;

        if (typeof rs.getUnreadCount === "function") {
            this.patchAfter(rs, "getUnreadCount", (_, args, ret) => {
                if (!self.settings.places.events) return ret;
                if (!ret || typeof ret !== "number" || ret <= 0) return ret;
                const guildId = asKnownGuildEventsId(args?.[0]);
                if (!guildId) return ret;
                return hasVisibleUnseenEvent(guildId) ? ret : 0;
            });
            patchedAny = true;
        }

        if (typeof rs.getMentionCount === "function") {
            this.patchAfter(rs, "getMentionCount", (_, args, ret) => {
                if (!self.settings.places.events) return ret;
                if (!ret || typeof ret !== "number" || ret <= 0) return ret;
                const guildId = asKnownGuildEventsId(args?.[0]);
                if (!guildId) return ret;
                return hasVisibleUnseenEvent(guildId) ? ret : 0;
            });
            patchedAny = true;
        }

        if (typeof rs.hasUnread === "function") {
            this.patchAfter(rs, "hasUnread", (_, args, ret) => {
                if (!self.settings.places.events || !ret) return ret;
                const guildId = asKnownGuildEventsId(args?.[0]);
                if (!guildId) return ret;
                return hasVisibleUnseenEvent(guildId) ? ret : false;
            });
            patchedAny = true;
        }

        if (typeof rs.hasUnreadOrMentions === "function") {
            this.patchAfter(rs, "hasUnreadOrMentions", (_, args, ret) => {
                if (!self.settings.places.events || !ret) return ret;
                const guildId = asKnownGuildEventsId(args?.[0]);
                if (!guildId) return ret;
                return hasVisibleUnseenEvent(guildId) ? ret : false;
            });
            patchedAny = true;
        }

        if (typeof rs.hasTrackedUnread === "function") {
            this.patchAfter(rs, "hasTrackedUnread", (_, args, ret) => {
                if (!self.settings.places.events || !ret) return ret;
                const guildId = asKnownGuildEventsId(args?.[0]);
                if (!guildId) return ret;
                return hasVisibleUnseenEvent(guildId) ? ret : false;
            });
            patchedAny = true;
        }

        if (patchedAny) this._eventsSidebarUnreadPatched = true;
    }
    patchGuildMemberStore() {
        if (this._guildMemberStorePatched || !this.settings.places.memberList) return;
        const gms = this.modules.GuildMemberStore;
        if (!gms) return;
        const self = this;
        const isHiddenId = id => id && self.shouldHide(id);
        const filterIdArray = ret => {
            if (!self.settings.places.memberList || !Array.isArray(ret)) return ret;
            return ret.filter(id => !isHiddenId(id));
        };
        const filterMemberArray = ret => {
            if (!self.settings.places.memberList || !Array.isArray(ret)) return ret;
            return ret.filter(m => !isHiddenId(m?.userId || m?.user?.id || self.extractUserId(m)));
        };
        let patchedAny = false;
        if (typeof gms.getMemberIds === "function") {
            this.patchAfter(gms, "getMemberIds", (_, __, ret) => filterIdArray(ret));
            patchedAny = true;
        }
        if (typeof gms.getMembers === "function") {
            this.patchAfter(gms, "getMembers", (_, __, ret) => filterMemberArray(ret));
            patchedAny = true;
        }
        if (typeof gms.getMember === "function") {
            this.patchAfter(gms, "getMember", (_, args, ret) => {
                if (!self.settings.places.memberList || !ret) return ret;
                const userId = args?.[1] || ret.userId || ret.user?.id;
                if (isHiddenId(userId)) return null;
                return ret;
            });
            patchedAny = true;
        }
        if (typeof gms.getNickname === "function") {
            this.patchAfter(gms, "getNickname", (_, args, ret) => {
                if (!self.settings.places.memberList) return ret;
                const userId = args?.[1];
                if (isHiddenId(userId)) return null;
                return ret;
            });
        }
        this._guildMemberStorePatched = patchedAny;
    }
    patchMentionAutocomplete(attempt = 0) {
        if (this._mentionAutocompletePatched || !this.settings.places.autocomplete) return;
        const sources = ["queryMentionResults", "mention-autocomplete", "getMentionSuggestions", "mention", "suggestions"];
        let mod = null;
        let key = null;
        for (const source of sources) {
            mod = this._wpGetBySource(source, { defaultExport: false }) || this._wpGetBySource(source);
            if (mod) {
                key = this._wpFindFnKeyFuzzy(mod, source, "mention", "suggest");
                if (key) break;
                for (const k of Object.keys(mod)) {
                    if (typeof mod[k] === "function" && mod[k].toString().includes("mention")) {
                        key = k;
                        break;
                    }
                }
                if (key) break;
            }
        }
        if (!mod || !key || typeof mod[key] !== "function") {
            if (attempt < 8) setTimeout(() => this.patchMentionAutocomplete(attempt + 1), 3e3);
            return;
        }
        const self = this;
        this.patchAfter(mod, key, function(_, args, result) {
            if (!self.settings.places.autocomplete) return result;
            if (!result) return result;
            const filterUser = u => {
                const id = u?.id || u?.userId || u?.user?.id;
                return !(id && self.shouldHide(id));
            };
            if (Array.isArray(result)) return result.filter(filterUser);
            if (Array.isArray(result?.results)) result.results = result.results.filter(filterUser);
            if (Array.isArray(result?.users)) result.users = result.users.filter(filterUser);
            return result;
        });
        this._mentionAutocompletePatched = true;
    }
    patchActivePostsPopoverComponent() {
        if (!this.settings.places.messages || this._activePostsPopoverPatched) return;
        const self = this;
        const patched = this._wpPatchRenderBySourceHeuristic(props => {
            const thread = props?.thread || props?.item?.thread || props?.data?.thread;
            const ownerId = thread?.ownerId || thread?.owner_id;
            if (ownerId && self.shouldHide(ownerId)) return true;
            const threadId = thread?.id;
            if (threadId) {
                const ch = self.modules.ChannelStore?.getChannel?.(threadId);
                const oid = ch?.ownerId || ch?.owner_id;
                if (oid && self.shouldHide(oid)) return true;
            }
return false;
            }, ["row__", "thread", "active"]);
        if (patched) this._activePostsPopoverPatched = true;
    }
    patchGuildMembersPageRow(attempt = 0) {
        if (!this.settings.places.memberList || this._guildMembersPagePatched) return;
        const self = this;
        const patched = this._wpPatchRenderBySourceHeuristic(props => {
            const userId = self.extractUserId(props);
            return !!(userId && self.shouldHide(userId));
        }, ["memberRow", "guildMember", "joinedAt", "userId"]);
        if (patched) {
            this._guildMembersPagePatched = true;
        } else if (attempt < 10) {
            setTimeout(() => this.patchGuildMembersPageRow(attempt + 1), 2500);
        }
    }
    patchMemberListRow(attempt = 0) {
        if (!this.settings.places.memberList || this._memberListRowPatched) return;
        const self = this;
        const patched = this._wpPatchRenderBySourceHeuristic(props => {
            const userId = props?.user?.id || self.extractUserId(props);
            return !!(userId && self.shouldHide(userId));
        }, ["nameplate", "hideClanTag", "colorRoleName", "shouldAnimateStatus"]);
        if (patched) {
            this._memberListRowPatched = true;
        } else if (attempt < 10) {
            setTimeout(() => this.patchMemberListRow(attempt + 1), 2500);
        }
    }
    patchStores() {
        const voiceStore = this.modules.SortedVoiceStateStore;
        if (voiceStore?.getVoiceStatesForChannel) {
            this.originalVoiceMethods.getVoiceStatesForChannel = voiceStore.getVoiceStatesForChannel.bind(voiceStore);
            this.patchAfter(voiceStore, "getVoiceStatesForChannel", (_, __, ret) => this.settings.places.voiceChannels ? this.filterVoiceStates(ret) : ret);
        }
        if (voiceStore?.getVoiceStates) {
            this.originalVoiceMethods.getVoiceStates = voiceStore.getVoiceStates.bind(voiceStore);
            this.patchAfter(voiceStore, "getVoiceStates", (_, __, ret) => this.settings.places.voiceChannels ? this.filterVoiceStates(ret) : ret);
        }
        const stageStore = this.modules.StageChannelParticipantStore;
        if (!this.originalStageMethods) this.originalStageMethods = {};
        if (stageStore?.getMutableParticipants && !this.originalStageMethods.getMutableParticipants) {
            this.originalStageMethods.getMutableParticipants = stageStore.getMutableParticipants.bind(stageStore);
        }
        if (!this.originalEventMethods) this.originalEventMethods = {};
        const evStore = this.modules.GuildScheduledEventStore;
        if (evStore?.getGuildScheduledEventsForGuild && !this.originalEventMethods.getGuildScheduledEventsForGuild) {
            this.originalEventMethods.getGuildScheduledEventsForGuild = evStore.getGuildScheduledEventsForGuild.bind(evStore);
        }
        const filterStageParticipants = ret => {
            if (!ret) return ret;
            if (Array.isArray(ret)) {
                const next = ret.filter(p => !this.shouldHide(this.extractUserId(p)));
                return next.length === ret.length ? ret : next;
            }
            if (typeof ret === "object") {
                let changed = false;
                const out = {};
                for (const [key, val] of Object.entries(ret)) {
                    if (!this.shouldHide(this.extractUserId(val))) {
                        out[key] = val;
                    } else {
                        changed = true;
                    }
                }
                return changed ? out : ret;
            }
            return ret;
        };
        if (stageStore?.getMutableParticipants) {
            this.patchAfter(stageStore, "getMutableParticipants", (_, __, ret) => {
                if (!this.settings.places.voiceChannels) return ret;
                return filterStageParticipants(ret);
            });
        }
        if (stageStore?.getParticipants) {
            this.patchAfter(stageStore, "getParticipants", (_, __, ret) => {
                if (!this.settings.places.voiceChannels) return ret;
                return filterStageParticipants(ret);
            });
        }
        const patchedStageKeys = new Set;
        for (const key of ["getSpeakers", "getListeners", "getAudience", "getStageSpeakers", "getStageListeners"]) {
            if (patchedStageKeys.has(key)) continue;
            if (typeof stageStore?.[key] === "function") {
                this.patchAfter(stageStore, key, (_, __, ret) => {
                    if (!this.settings.places.voiceChannels) return ret;
                    return filterStageParticipants(ret);
                });
                patchedStageKeys.add(key);
            }
        }
        const activityStore = this.modules.ActivityStore;
        const patchedActivityKeys = new Set;
        for (const key of ["getParticipants", "getActivityParticipants", "getEmbeddedActivityParticipants"]) {
            if (patchedActivityKeys.has(key)) continue;
            if (typeof activityStore?.[key] === "function") {
                this.patchAfter(activityStore, key, (_, __, ret) => {
                    if (!this.settings.places.voiceChannels) return ret;
                    if (Array.isArray(ret)) {
                        const next = ret.filter(p => !this.shouldHide(this.extractUserId(p)));
                        return next.length === ret.length ? ret : next;
                    }
                    return ret;
                });
                patchedActivityKeys.add(key);
            }
        }
        const channelStore = this.modules.ChannelStore;
        if (channelStore?.getChannel) {
            this.patchAfter(channelStore, "getChannel", (_, __, channel) => {
                if (!channel) return channel;
                if (channel.isDM?.() && this.shouldHide(channel.recipient?.id || channel.recipientId)) {
                    return null;
                }
                if (this.settings.places.groupDms && channel.isGroupDM?.()) {
                    const clone = Object.assign(Object.create(Object.getPrototypeOf(channel)), channel);
                    if (Array.isArray(clone.rawRecipients)) clone.rawRecipients = clone.rawRecipients.filter(user => !this.shouldHide(user?.id));
                    if (Array.isArray(clone.recipients)) clone.recipients = clone.recipients.filter(id => !this.shouldHide(id));
                    return clone;
                }
                return channel;
            });
        }
        if (this.modules.ThreadStore && typeof this.modules.ThreadStore.getThreadsForParent === "function") {
            const channelStoreRef = this.modules.ChannelStore;
            this.patchAfter(this.modules.ThreadStore, "getThreadsForParent", (_, args, ret) => {
                if (!this.settings.places.messages) return ret;
                if (!ret || typeof ret !== "object") return ret;
                const isArray = Array.isArray(ret);
                const entries = isArray ? ret.entries() : Object.entries(ret);
                const filtered = isArray ? [] : {};
                for (const [key, thread] of entries) {
                    let ownerId = thread?.ownerId || thread?.owner_id || thread?.message?.author?.id;
                    if (!ownerId && channelStoreRef?.getChannel) {
                        const threadId = thread?.id || key;
                        const ch = threadId ? channelStoreRef.getChannel(threadId) : null;
                        ownerId = ch?.ownerId || ch?.owner_id;
                    }
                    if (ownerId && this.shouldHide(ownerId)) continue;
                    if (isArray) filtered.push(thread); else filtered[key] = thread;
                }
                return filtered;
            });
        } else if (this.modules.ThreadStore && typeof this.modules.ThreadStore.getThreadsForChannel === "function") {
            this.patchAfter(this.modules.ThreadStore, "getThreadsForChannel", (_, args, ret) => {
                if (!this.settings.places.messages) return ret;
                if (!ret || !Array.isArray(ret)) return ret;
                return ret.filter(thread => {
                    const ownerId = thread.ownerId || thread.owner_id || thread.message?.author?.id;
                    return !(ownerId && this.shouldHide(ownerId));
                });
            });
        }
    }
    patchStageRenderComponent() {
        if (this._stageRenderComponentPatched) return;
        const self = this;
        const tryPatchComponent = (mod) => {
            if (!mod || typeof mod !== "object") return false;
            for (const key of Object.keys(mod)) {
                const val = mod[key];
                if (typeof val !== "function" && typeof val !== "object") continue;
                const proto = typeof val === "function" ? val.prototype : val;
                if (!proto?.render || typeof proto.render !== "function") continue;
                const src = proto.render.toString();
                if (!src.includes("speaker") && !src.includes("listener") && !src.includes("participant")) continue;
                if (!src.includes("user") && !src.includes("userId")) continue;
                self.patchInstead(proto, "render", function(ctx, args, orig) {
                    try {
                        const props = args?.[0] || ctx?.props;
                        if (!props) return orig.apply(ctx, args);
                        const uid = props.user?.id || props.userId || props.participant?.userId || (props.participant && (props.participant.user?.id || props.participant.id));
                        if (uid && self.settings.places.voiceChannels && self.shouldHide(uid)) return null;
                    } catch (_) {}
                    return orig.apply(ctx, args);
                });
                return true;
            }
            return false;
        };
        const searchSources = [
            "participants",
            "userSummary",
            "stageListeners",
            "stageSpeakers",
            "VoiceUserSummary"
        ];
        const mod = this._wpGetModuleBySourceAny(...searchSources);
        if (mod && tryPatchComponent(mod)) {
            this._stageRenderComponentPatched = true;
            return;
        }
        const withKey = this._wpGetModuleWithKey(m => {
            if (typeof m !== "object" || !m) return false;
            return Object.values(m).some(v => {
                if (typeof v !== "function" && typeof v !== "object") return false;
                const p = typeof v === "function" ? v.prototype : v;
                if (!p?.render || typeof p.render !== "function") return false;
                const s = p.render.toString();
                return (s.includes("speaker") || s.includes("listener") || s.includes("participant")) && s.includes("userId");
            });
        });
        if (withKey?.[0] && withKey[1]) {
            const [m, k] = withKey;
            const val = m[k];
            const proto = typeof val === "function" ? val.prototype : val;
            if (proto?.render) {
                self.patchInstead(proto, "render", function(ctx, args, orig) {
                    try {
                        const props = args?.[0] || ctx?.props;
                        if (props?.user?.id && self.settings.places.voiceChannels && self.shouldHide(props.user.id)) return null;
                        const uid = props?.userId || props?.participant?.userId || props?.participant?.user?.id;
                        if (uid && self.settings.places.voiceChannels && self.shouldHide(uid)) return null;
                    } catch (_) {}
                    return orig.apply(ctx, args);
                });
                this._stageRenderComponentPatched = true;
            }
        }
    }
    patchActivityPanelComponent() {
        if (this._activityPanelComponentPatched) return;
        const self = this;
        const mod = this._wpGetModule(m => {
            if (typeof m !== "object" || !m) return false;
            return Object.values(m).some(v => {
                if (typeof v !== "function" && typeof v !== "object") return false;
                const p = typeof v === "function" ? v.prototype : v;
                if (!p?.render || typeof p.render !== "function") return false;
                const s = p.render.toString();
                return s.includes("activity") && s.includes("participants") && s.includes("user");
            });
        }, { searchExports: true });
        if (mod?.prototype?.render) {
            this.patchInstead(mod.prototype, "render", function(ctx, args, orig) {
                try {
                    const props = args?.[0] || ctx?.props;
                    if (!props) return orig.apply(ctx, args);
                    if (props?.users && Array.isArray(props.users) && self.settings.places.voiceChannels) {
                        props.users = props.users.filter(u => !(u?.id && self.shouldHide(u.id)));
                    }
                    if (props?.participants && Array.isArray(props.participants) && self.settings.places.voiceChannels) {
                        props.participants = props.participants.filter(p => {
                            const uid = self.extractUserId(p);
                            return !(uid && self.shouldHide(uid));
                        });
                    }
                } catch (_) {}
                return orig.apply(ctx, args);
            });
            this._activityPanelComponentPatched = true;
            return;
        }
        const withKey = this._wpGetModuleWithKey(m => {
            if (typeof m !== "object" || !m) return false;
            return Object.values(m).some(v => {
                if (typeof v !== "function" && typeof v !== "object") return false;
                const p = typeof v === "function" ? v.prototype : v;
                if (!p?.render || typeof p.render !== "function") return false;
                const s = p.render.toString();
                return s.includes("Activity") && s.includes("participants");
            });
        });
        if (withKey?.[0] && withKey[1]) {
            const [m, k] = withKey;
            const val = m[k];
            const proto = typeof val === "function" ? val.prototype : val;
            if (proto?.render) {
                this.patchInstead(proto, "render", function(ctx, args, orig) {
                    try {
                        const props = args?.[0] || ctx?.props;
                        if (props?.users && Array.isArray(props.users) && self.settings.places.voiceChannels) {
                            props.users = props.users.filter(u => !(u?.id && self.shouldHide(u.id)));
                        }
                    } catch (_) {}
                    return orig.apply(ctx, args);
                });
                this._activityPanelComponentPatched = true;
            }
        }
    }
    patchRelationshipUpdates() {
        this.relationshipChangeHandler = () => {
            this.queueRefresh();
            this._forceReadStateRecheck();
        };
        try {
            this.modules.RelationshipStore?.addChangeListener?.(this.relationshipChangeHandler);
        } catch (_) {}
        const utils = this.modules.RelationshipUtils;
        if (utils?.addRelationship) this.patchAfter(utils, "addRelationship", () => this.queueRefresh());
        if (utils?.removeRelationship) this.patchAfter(utils, "removeRelationship", () => this.queueRefresh());
    }
    patchForumPostComponent() {
        if (!this.settings.places.messages) return;
        if (this._forumPostComponentPatched) return;
        const self = this;
        const FORUM_CARD_STRINGS = [ "mainCard_", "forumPostItem", "ForumPostCard", "ForumPost", "forum-channel-list-", "PostCard" ];
        const looksLikeForumCardFn = fn => {
            if (typeof fn !== "function") return false;
            try {
                const src = Function.prototype.toString.call(fn);
                return FORUM_CARD_STRINGS.some(s => src.includes(s));
            } catch (_) {
                return false;
            }
        };
        const authorIdFromProps = props => {
            if (!props) return null;
            const threadIdCandidates = [ props.thread?.id, props.post?.id, props.channel?.id, props.item?.id, props.data?.id, props.id ];
            for (const threadId of threadIdCandidates) {
                if (!threadId) continue;
                try {
                    const ch = self.modules.ChannelStore?.getChannel?.(threadId);
                    const ownerId = ch?.ownerId || ch?.owner_id;
                    if (ownerId) return ownerId;
                } catch (_) {}
            }
            const direct = self.extractUserId(props);
            if (direct) return direct;
            const candidates = [ props.thread, props.post, props.channel, props.item, props.data ];
            for (const c of candidates) {
                const found = self.extractUserId(c);
                if (found) return found;
            }
            return null;
        };
        const beforeRender = (thisArg, args) => {
            try {
                const props = args?.[0] || thisArg?.props;
                const authorId = authorIdFromProps(props);
                if (authorId && self.shouldHide(authorId)) {
                    return null;
                }
            } catch (_) {}
            return undefined;
        };
        let patchedAny = false;
        try {
            const CardModule = BdApi.Webpack.getModule(m => looksLikeForumCardFn(m) || looksLikeForumCardFn(m?.default) || looksLikeForumCardFn(m?.prototype?.render), {
                searchExports: true
            });
            if (CardModule?.prototype?.render && looksLikeForumCardFn(CardModule.prototype.render)) {
                this.patchInstead(CardModule.prototype, "render", function(context, args, original) {
                    const result = beforeRender(context, [ context.props ]);
                    return result === null ? null : original.apply(context, args);
                });
                patchedAny = true;
            } else if (CardModule?.default && looksLikeForumCardFn(CardModule.default)) {
                this.patchInstead(CardModule, "default", function(context, args, original) {
                    const result = beforeRender(context, args);
                    return result === null ? null : original.apply(context, args);
                });
                patchedAny = true;
            }
        } catch (_) {}
        if (!patchedAny) {
            try {
                const result = BdApi.Webpack.getModuleWithKey(m => {
                    if (!m || typeof m !== "function") return false;
                    return looksLikeForumCardFn(m);
                }, {
                    searchExports: true
                });
                if (result) {
                    const [moduleObj, key] = result;
                    this.patchInstead(moduleObj, key, function(context, args, original) {
                        const result = beforeRender(context, args);
                        return result === null ? null : original.apply(context, args);
                    });
                    patchedAny = true;
                }
            } catch (_) {}
        }
        if (patchedAny) this._forumPostComponentPatched = true;
    }
    patchBlockedMessageGroup() {
        if (!this.settings.places.messages) return;
        if (this._blockedMsgGroupPatched) return;
        try {
            const BlockedMessageGroup = BdApi.Webpack.getModule(m => m?.displayName === "BlockedMessageGroup" || m?.name === "BlockedMessageGroup" || m?.prototype?.render?.toString?.().includes("MESSAGE_GROUP_BLOCKED") || typeof m === "function" && m.toString && m.toString().includes("messageGroupSpacing"));
            if (BlockedMessageGroup?.prototype?.render) {
                this.patchInstead(BlockedMessageGroup.prototype, "render", () => null);
                return;
            }
        } catch (_) {}
        const BLOCKED_STRINGS = [ "MESSAGE_GROUP_BLOCKED", "blockedMessageGroup", "BlockedMessages", "blockedMessages", "messageGroupSpacing", "isBlockedMessage", "BLOCKED_MESSAGE" ];
        try {
            const result = BdApi.Webpack.getModuleWithKey(m => {
                if (!m || typeof m !== "function") return false;
                try {
                    const src = Function.prototype.toString.call(m);
                    return BLOCKED_STRINGS.some(s => src.includes(s));
                } catch (_) {
                    return false;
                }
            });
            if (result) {
                const [moduleObj, key] = result;
                this.patchInstead(moduleObj, key, () => null);
                return;
            }
        } catch (_) {}
        try {
            let patched = false;
            BdApi.Webpack.getModule(m => {
                if (patched || !m || typeof m !== "object") return false;
                for (const key of Object.keys(m)) {
                    if (patched) break;
                    const val = m[key];
                    if (typeof val !== "function") continue;
                    try {
                        const src = Function.prototype.toString.call(val);
                        if (BLOCKED_STRINGS.some(s => src.includes(s))) {
                            this.patchInstead(m, key, () => null);
                            patched = true;
                        }
                    } catch (_) {}
                }
                return false;
            }, {
                searchExports: true
            });
        } catch (_) {}
        this._blockedMsgGroupPatched = true;
    }
    isBlockedMessageData(message, referencedMessage = null) {
        if (!message || typeof message !== "object") return false;
        try {
            const authorId = message.author?.id || null;
            if (authorId && this.shouldHide(authorId)) return true;
            const ref = referencedMessage || this.getReferencedMessage(message);
            const refAuthorId = ref?.author?.id || null;
            if (refAuthorId && this.shouldHide(refAuthorId)) return true;
        } catch (_) {}
        return false;
    }
    filterMessagesCollection(value) {
        if (!value) return value;
        if (Array.isArray(value)) return value.filter(msg => !this.isBlockedMessageData(msg));
        if (value && typeof value.filter === "function" && typeof value.toArray === "function") {
            try {
                const asArray = value.toArray();
                const filtered = asArray.filter(msg => !this.isBlockedMessageData(msg));
                if (filtered.length === asArray.length) return value;
                if (typeof value.constructor === "function") {
                    try {
                        return new value.constructor(filtered);
                    } catch (_) {}
                }
                return filtered;
            } catch (_) {
                return value;
            }
        }
        return value;
    }
    patchMessagesWrapComponent() {
        if (!this.settings.places.messages) return;
        if (this._messagesWrapPatched) return;
        const self = this;
        const applyFilterToProps = props => {
            if (!props || typeof props !== "object") return;
            try {
                if (props.messages) {
                    if (Array.isArray(props.messages)) {
                        props.messages = self.filterMessagesCollection(props.messages);
                    } else if (props.messages._array && Array.isArray(props.messages._array)) {
                        const filtered = self.filterMessagesCollection(props.messages._array);
                        if (filtered !== props.messages._array) props.messages._array = filtered;
                    }
                }
            } catch (_) {}
        };
        try {
            const MessagesWrap = BdApi.Webpack.getModule(m => m?.displayName === "MessagesWrap" || m?.name === "MessagesWrap" || m?.prototype?.render?.toString?.().includes("MessagesWrap"));
            if (MessagesWrap?.prototype?.render) {
                this.patchBefore(MessagesWrap.prototype, "render", context => applyFilterToProps(context?.props));
                this._messagesWrapPatched = true;
                return;
            }
        } catch (_) {}
        const WRAP_STRINGS = [ "messages._array", "scrollToMessage", "MessagesWrap", "renderMessages" ];
        try {
            const result = BdApi.Webpack.getModuleWithKey(m => {
                if (!m || typeof m !== "function") return false;
                try {
                    const src = Function.prototype.toString.call(m);
                    return WRAP_STRINGS.some(s => src.includes(s));
                } catch (_) {
                    return false;
                }
            });
            if (result) {
                const [moduleObj, key] = result;
                this.patchBefore(moduleObj, key, (_, args) => applyFilterToProps(args?.[0]));
                this._messagesWrapPatched = true;
                return;
            }
        } catch (_) {}
    }
    _filterParticipantArray(arr) {
        if (!Array.isArray(arr) || !arr.length) return arr;
        let changed = false;
        const next = arr.filter(item => {
            const uid = this.extractUserId(item) || this.extractUserId(item?.props) || this.extractUserId(item?.participant) || this.extractUserId(item?.user);
            const hide = uid && this.shouldHide(uid);
            if (hide) changed = true;
            return !hide;
        });
        return changed ? next : arr;
    }
    _filterCallGridProps(props) {
        if (!props || typeof props !== "object") return;
        try {
            const participants = props.participants;
            const filteredParticipants = props.filteredParticipants;
            if (Array.isArray(participants) || Array.isArray(filteredParticipants)) {
                const targetArray = Array.isArray(filteredParticipants) ? filteredParticipants : participants;
                const filtered = this._filterParticipantArray(targetArray);
                if (filtered !== targetArray) {
                    if (Array.isArray(participants)) props.participants = filtered;
                    if (Array.isArray(filteredParticipants)) props.filteredParticipants = filtered;
                    if (typeof props.totalNumberOfParticipants === "number") {
                        props.totalNumberOfParticipants = filtered.length;
                    }
                }
            }
        } catch (_) {}
    }
    patchCallGridParticipants() {
        if (!this.settings.places.voiceChannels) return;
        if (this._callGridPatched) return;
        const self = this;
        const hasFilteredParticipants = fn => {
            if (typeof fn !== "function") return false;
            try {
                return Function.prototype.toString.call(fn).includes("filteredParticipants");
            } catch (_) {
                return false;
            }
        };
        const resolveRealFnHolder = fn => {
            if (typeof fn !== "function") return null;
            if (hasFilteredParticipants(fn)) return { holder: fn, prop: null, realFn: fn };
            if (fn.type && typeof fn.type === "function" && hasFilteredParticipants(fn.type)) return { holder: fn, prop: "type", realFn: fn.type };
            if (fn.render && typeof fn.render === "function" && hasFilteredParticipants(fn.render)) return { holder: fn, prop: "render", realFn: fn.render };
            return null;
        };
        const patchHolder = info => {
            if (!info) return false;
            try {
                if (info.prop) {
                    self._patcher.before(info.holder, info.prop, (_, args) => self._filterCallGridProps(args?.[0]));
                } else {
                    return false;
                }
                return true;
            } catch (_) {
                return false;
            }
        };
        let patchedAny = false;
        try {
            const raw = BdApi.Webpack.getModule(m => {
                if (!m || typeof m !== "object") return false;
                for (const val of Object.values(m)) {
                    if (resolveRealFnHolder(val)) return true;
                }
                return false;
            }, { searchExports: true });
            if (raw && typeof raw === "object") {
                for (const [key, val] of Object.entries(raw)) {
                    const info = resolveRealFnHolder(val);
                    if (!info) continue;
                    if (info.prop) {
                        if (patchHolder(info)) {
                            patchedAny = true;
                            break;
                        }
                    } else {
                        self._patcher.before(raw, key, (_, args) => self._filterCallGridProps(args?.[0]));
                        patchedAny = true;
                        break;
                    }
                }
            }
        } catch (_) {}
        if (!patchedAny) {
            try {
                const result = BdApi.Webpack.getModuleWithKey(m => {
                    return !!resolveRealFnHolder(m);
                }, { searchExports: true });
                if (result) {
                    const [moduleObj, key] = result;
                    const info = resolveRealFnHolder(moduleObj[key]);
                    if (info && info.prop) {
                        patchedAny = patchHolder(info);
                    } else if (info) {
                        self._patcher.before(moduleObj, key, (_, args) => self._filterCallGridProps(args?.[0]));
                        patchedAny = true;
                    }
                }
            } catch (_) {}
        }
        if (patchedAny) this._callGridPatched = true;
    }
    patchMessageStore() {
        if (!this.settings.places.messages) return;
        if (this._storePatched) return;
        const store = this.modules.MessageStore;
        if (!store) return;
        const self = this;
        const methods = [ "getMessages", "getMessagesForChannel", "getMessagesForChannelId" ];
        for (const method of methods) {
            if (typeof store[method] === "function") {
                this.patchAfter(store, method, function(_, args, ret) {
                    self._scanForBlockedPinSystemMessages(ret);
                    return ret;
                });
            }
        }
        this._storePatched = true;
    }
    patchChannelPinsStore() {
        if (!this.settings.places.messages) return;
        if (this._channelPinsStorePatched) return;
        const store = this.modules.ChannelPinsStore;
        if (!store || typeof store.getPins !== "function") return;
        const self = this;
        this.patchAfter(store, "getPins", function(_, args, ret) {
            const channelId = args?.[0];
            if (channelId) self._processPinStoreItems(channelId, ret?.items);
            return ret;
        });
        this._channelPinsStorePatched = true;
    }
    patchPinFlux() {
        if (this._pinFluxPatched) return;
        if (!this.modules.Dispatcher) {
            try {
                this.modules.Dispatcher = this.modules.SelectedChannelStore?._dispatcher || null;
            } catch (_) {}
        }
        const Dispatcher = this.modules.Dispatcher;
        if (!Dispatcher || typeof Dispatcher.dispatch !== "function") return;
        const self = this;
        this.patchBefore(Dispatcher, "dispatch", function(_, args) {
            if (!self.settings.places?.messages) return;
            const action = args?.[0];
            if (!action || typeof action !== "object") return;
            if (action.type === "MESSAGE_PIN_ADD") {
                self._handlePinAdd(action);
                return;
            }
            if (action.type === "MESSAGE_PIN_REMOVE") {
                self._unmarkMessageUnpinned(action.messageId);
                return;
            }
            if (action.type === "MESSAGE_CREATE" && action.message?.type === 6) {
                self._handlePinSystemMessage(action.message);
                return;
            }
            const channelId = action.channelId || action.channel_id;
            if (channelId && (action.type === "CHANNEL_PINS_UPDATE" || action.type === "LOAD_PINNED_MESSAGES_SUCCESS" || action.type === "FETCH_PINNED_MESSAGES_SUCCESS")) {
                self._scanExistingPinsForChannel(channelId);
                self._processPinStoreItems(channelId, action.items || action.pins?.items);
                self._forceReadStateRecheck(true);
                self.queueScan();
            }
        });
        this._pinFluxPatched = true;
    }
    _getChannelMessages(channelId) {
        try {
            const raw = this._rawGetMessages;
            const ret = raw ? raw(channelId) : this.modules.MessageStore?.getMessages?.(channelId);
            if (Array.isArray(ret)) return ret;
            if (Array.isArray(ret?._array)) return ret._array;
            if (ret instanceof Map) return Array.from(ret.values());
            if (ret && typeof ret === 'object') return Object.values(ret);
        } catch (_) {}
        return [];
    }
    _getAuthorId(msg) { return msg?.author?.id || msg?.authorId || msg?.user?.id; }
    _isBlockedMessage(msg) {
        if (!msg) return false;
        if (msg.blocked === true) return true;
        const authorId = this._getAuthorId(msg);
        return !!(authorId && this.shouldHide(authorId));
    }
    _flattenThreadEntries(list) {
        if (!list) return [];
        if (Array.isArray(list)) return list;
        return Object.values(list).flatMap(v => Array.isArray(v) ? v : [v]);
    }
    _getThreadOwnerId(threadOrId) {
        if (!threadOrId) return null;
        if (typeof threadOrId === 'object') {
            const direct = threadOrId.ownerId || threadOrId.owner_id || threadOrId.thread?.ownerId || threadOrId.thread?.owner_id || threadOrId.channel?.ownerId || threadOrId.channel?.owner_id;
            if (direct) return direct;
            threadOrId = threadOrId.id || threadOrId.channel?.id;
        }
        if (!threadOrId) return null;
        try {
            const ch = this.modules.ChannelStore?.getChannel?.(threadOrId);
            return ch?.ownerId || ch?.owner_id || null;
        } catch (_) { return null; }
    }
    _isForumParentChannel(channelId) {
        try { return this.modules.ChannelStore?.getChannel?.(channelId)?.type === 15; } catch (_) { return false; }
    }
    _collectThreadsForParent(channelId, guildId) {
        const seen = new Map;
        const add = thread => { if (!thread) return; const id = thread?.id || thread?.channel?.id; if (id && !seen.has(id)) seen.set(id, thread); };
        try { const fn = this.modules.ChannelStore?.getAllThreadsForParent; if (typeof fn === 'function') { const t = fn.call(this.modules.ChannelStore, channelId); if (Array.isArray(t)) t.forEach(add); } } catch (_) {}
        try { const ts = this.modules.ThreadStore; if (typeof ts?.getThreadsForParent === 'function') { const a = guildId ? [guildId, channelId] : [channelId]; const r = ts.getThreadsForParent(...a); if (Array.isArray(r)) r.forEach(add); else if (r && typeof r === 'object') Object.values(r).forEach(add); } } catch (_) {}
        try { const ajs = this.modules.ActiveJoinedThreadsStore; if (ajs) { const a = guildId ? [guildId, channelId] : [channelId]; this._flattenThreadEntries(ajs.getActiveJoinedThreadsForParent?.(...a)).forEach(add); this._flattenThreadEntries(ajs.getActiveUnjoinedThreadsForParent?.(...a)).forEach(add); } } catch (_) {}
        return Array.from(seen.values());
    }
    _resolveForumActivityOwnerId(parentChannelId, activityId) {
        if (!activityId) return null;
        let ownerId = this._getThreadOwnerId(activityId);
        if (ownerId) return ownerId;
        const parent = this.modules.ChannelStore?.getChannel?.(parentChannelId);
        const guildId = parent?.guild_id;
        const threads = this._collectThreadsForParent(parentChannelId, guildId);
        for (const thread of threads) {
            const tId = thread?.id || thread?.channel?.id;
            const lmId = thread?.lastMessageId || thread?.channel?.lastMessageId;
            if (tId !== activityId && lmId !== activityId) continue;
            ownerId = this._getThreadOwnerId(thread);
            if (ownerId) return ownerId;
        }
        try { const gm = this.modules.MessageStore?.getMessage; if (typeof gm === 'function') { for (const thread of threads) { const tId = thread?.id || thread?.channel?.id; if (!tId) continue; const msg = gm(tId, activityId); if (msg) return this._getAuthorId(msg); } const pm = gm(parentChannelId, activityId); if (pm) return this._getAuthorId(pm); } } catch (_) {}
        try { const msg = this._getChannelMessages(parentChannelId).find(m => m?.id === activityId); if (msg) return this._getAuthorId(msg); } catch (_) {}
        for (const thread of threads) { const tId = thread?.id || thread?.channel?.id; if (!tId) continue; try { const msg = this._getChannelMessages(tId).find(m => m?.id === activityId); if (msg) return this._getAuthorId(msg); } catch (_) {} }
        if (guildId && this.modules.GuildChannelStore?.getChannels) {
            try { const groups = this.modules.GuildChannelStore.getChannels(guildId); const entries = groups ? Object.values(groups).flat() : []; for (const entry of entries) { const ch = entry?.channel || entry; if (!ch?.id || ch.parent_id !== parentChannelId) continue; if (ch.id !== activityId && ch.lastMessageId !== activityId) continue; ownerId = ch.ownerId || ch.owner_id; if (ownerId) return ownerId; } } catch (_) {}
        }
        return null;
    }
    _hasVisibleUnreadThreadsFromStore(channelId, guildId) {
        const ajs = this.modules.ActiveJoinedThreadsStore;
        if (!ajs) return null;
        try { const a = guildId ? [guildId, channelId] : [channelId]; const vu = [...this._flattenThreadEntries(ajs.getActiveJoinedUnreadThreadsForParent?.(...a)), ...this._flattenThreadEntries(ajs.getActiveUnjoinedUnreadThreadsForParent?.(...a))]; return vu.length > 0; } catch (_) { return null; }
    }
    _hasVisibleForumActivity(channelId) {
        try {
            if (this._hasBlockedOnlyReadActivity(channelId)) return false;
            if (!this._isForumParentChannel(channelId)) return null;
            const rs = this.modules.ReadStateStore;
            const ackId = rs.ackMessageId ? rs.ackMessageId(channelId) : null;
            const lastId = rs.lastMessageId ? rs.lastMessageId(channelId) : null;
            if (!this._snowflakeGreater(lastId, ackId)) return false;
            const parent = this.modules.ChannelStore?.getChannel?.(channelId);
            const guildId = parent?.guild_id;
            const threads = this._collectThreadsForParent(channelId, guildId);
            if (threads.length) {
                for (const thread of threads) {
                    const ownerId = this._getThreadOwnerId(thread);
                    const actId = thread?.lastMessageId || thread?.channel?.lastMessageId || thread?.id;
                    if (!this._snowflakeGreater(actId, ackId)) continue;
                    if (!ownerId) continue;
                    if (!this.shouldHide(ownerId)) return true;
                }
                const aoId = this._resolveForumActivityOwnerId(channelId, lastId);
                if (aoId) return !this.shouldHide(aoId);
                return false;
            }
            const aoId = this._resolveForumActivityOwnerId(channelId, lastId);
            if (aoId) return !this.shouldHide(aoId);
            const vu = this._hasVisibleUnreadThreadsFromStore(channelId, guildId);
            if (vu === true) return true;
            if (vu === false) return false;
            try { if (rs.getUnreadCount?.(channelId) === 0) return false; } catch (_) {}
            return null;
        } catch (_) { return null; }
    }
    patchReadState() {
        this._ensureTaskbarElectronPatch();
        if (!this.modules.ReadStateStore) return;
        if (this._readStatePatched) return;
        const self = this;
        this.patchAfter(this.modules.ReadStateStore, "getUnreadCount", function(_, args, ret) {
            if (!self.settings.places?.messages) return ret;
            if (!ret || typeof ret !== "number" || ret <= 0) return ret;
            const channelId = args?.[0];
            if (!channelId) return ret;
            try {
                const messages = self._getChannelMessages(channelId).slice().reverse();
                let hiddenCount = 0;
                for (let i = 0; i < ret && i < messages.length; i++) {
                    if (self._isBlockedMessage(messages[i])) hiddenCount++; else break;
                }
                return ret - hiddenCount;
            } catch (_) {
                return ret;
            }
        });
        this.patchInstead(this.modules.ReadStateStore, "hasUnread", function(ctx, args, orig) {
            const channelId = args?.[0];
            if (channelId && self.settings.places?.messages && self._hasBlockedOnlyReadActivity(channelId)) return false;
            const ret = orig.apply(ctx, args);
            if (!ret) return ret;
            if (!self.settings.places?.messages) return ret;
            if (!channelId) return ret;
            try {
                if (self._isForumParentChannel(channelId)) {
                    const forumResult = self._hasVisibleForumActivity(channelId);
                    if (forumResult !== null) return forumResult;
                }
                const store = self.modules.ReadStateStore;
                const oldestUnreadId = store.getOldestUnreadMessageId ? store.getOldestUnreadMessageId(channelId) : null;
                const messages = self._getChannelMessages(channelId);
                if (!messages.length) {
                    const forumResult = self._hasVisibleForumActivity(channelId);
                    if (forumResult !== null) return forumResult;
                    const blockedOnly = self._resolveUnreadFromBlockedOnly(channelId, store, self._getReadStateHelpers());
                    if (blockedOnly === false) return false;
                    return ret;
                }
                if (oldestUnreadId) {
                    const idx = messages.findIndex(m => m?.id === oldestUnreadId);
                    if (idx !== -1) {
                        const unreadSlice = messages.slice(idx);
                        const anyVisibleUnread = unreadSlice.some(m => !self._isBlockedMessage(m));
                        return anyVisibleUnread;
                    }
                }
                const lastMessageId = store.lastMessageId ? store.lastMessageId(channelId) : null;
                const lastMessage = lastMessageId ? messages.find(m => m?.id === lastMessageId) : null;
                if (lastMessage && self._isBlockedMessage(lastMessage)) {
                    const anyVisibleUnread = messages.some(m => !self._isBlockedMessage(m));
                    if (!anyVisibleUnread) return false;
                }
                const blockedOnly = self._resolveUnreadFromBlockedOnly(channelId, store, self._getReadStateHelpers());
                if (blockedOnly === false) return false;
                return ret;
            } catch (_) {
                return ret;
            }
        });
        for (const methodName of [ "hasUnreadOrMentions", "hasTrackedUnread" ]) {
            if (typeof this.modules.ReadStateStore[methodName] !== "function") continue;
            this.patchInstead(this.modules.ReadStateStore, methodName, function(ctx, args, orig) {
                const channelId = args?.[0];
                if (channelId && self.settings.places?.messages && self._hasBlockedOnlyReadActivity(channelId)) return false;
                const ret = orig.apply(ctx, args);
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                if (!channelId) return ret;
                try {
                    if (self._isForumParentChannel(channelId)) {
                        const forumResult = self._hasVisibleForumActivity(channelId);
                        if (forumResult !== null) return forumResult;
                    }
                    const messages = self._getChannelMessages(channelId);
                    if (!messages.length) {
                        const forumResult = self._hasVisibleForumActivity(channelId);
                        if (forumResult !== null) return forumResult;
                        const store = self.modules.ReadStateStore;
                        const blockedOnly = self._resolveUnreadFromBlockedOnly(channelId, store, self._getReadStateHelpers());
                        if (blockedOnly === false) return false;
                    }
                    return ret;
                } catch (_) {
                    return ret;
                }
            });
        }
        this.patchInstead(this.modules.GuildReadStateStore, "hasUnread", function(ctx, args, orig) {
            const ret = orig.apply(ctx, args);
            if (!ret) return ret;
            if (!self.settings.places?.messages) return ret;
            const guildId = args?.[0];
            if (!guildId) return ret;
            try {
                const channels = self.modules.GuildChannelStore.getChannels?.(guildId);
                const selectable = channels?.SELECTABLE;
                if (!Array.isArray(selectable)) {
                    if (self._guildHasBlockedOnlyUnread(guildId)) return false;
                    return ret;
                }
                const visible = selectable.map(entry => entry?.channel?.id).filter(Boolean).some(cid => self._channelCountsAsGuildUnread(cid));
                if (visible) return true;
                if (self._guildHasBlockedOnlyUnread(guildId)) return false;
                return false;
            } catch (_) {
                return ret;
            }
        });
        this.patchAfter(this.modules.ReadStateStore, "hasUnreadPins", function(_, args, ret) {
            if (!ret) return ret;
            if (!self.settings.places?.messages) return ret;
            const channelId = args?.[0];
            if (!channelId) return ret;
            try {
                const pinsStore = self.modules.ChannelPinsStore;
                const pins = pinsStore?.getPins ? pinsStore.getPins(channelId) : null;
                const items = pins?.items;
                if (!Array.isArray(items) || !items.length) return false;
                const store = self.modules.ReadStateStore;
                const lastPinTs = store.lastPinTimestamp ? store.lastPinTimestamp(channelId) : null;
                const newPins = lastPinTs ? items.filter(item => {
                    const ts = item?.pinnedAt instanceof Date ? item.pinnedAt.getTime() : new Date(item?.pinnedAt || 0).getTime();
                    const cmpTs = lastPinTs instanceof Date ? lastPinTs.getTime() : new Date(lastPinTs).getTime();
                    return ts > cmpTs;
                }) : items;
                if (!newPins.length) return false;
                const anyVisibleNewPin = newPins.some(item => {
                    const messageId = item?.message?.id;
                    return messageId && !self._shouldHidePinnedMessage(channelId, messageId, item);
                });
                return anyVisibleNewPin;
            } catch (_) {
                return ret;
            }
        });
        if (this.modules.ChannelPinsStore?.addChangeListener) {
            this._channelPinsChangeHandler = () => {
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                if (channelId) {
                    this._scanExistingPinsForChannel(channelId);
                    const items = this.modules.ChannelPinsStore?.getPins?.(channelId)?.items;
                    this._processPinStoreItems(channelId, items);
                }
                this._forceReadStateRecheck(true);
                this.queueScan();
            };
            this.modules.ChannelPinsStore.addChangeListener(this._channelPinsChangeHandler);
        }
        const threadsStore = this.modules.ActiveJoinedThreadsStore;
        if (threadsStore) {
            const getThreadOwnerId = thread => thread?.ownerId || thread?.owner_id || thread?.thread?.ownerId || thread?.thread?.owner_id;
            const isBlockedThreadEntry = entry => !!(getThreadOwnerId(entry) && self.shouldHide(getThreadOwnerId(entry)));
            const filterThreadList = list => {
                if (Array.isArray(list)) return list.filter(e => !isBlockedThreadEntry(e));
                if (list && typeof list === 'object') {
                    const out = {};
                    for (const [key, val] of Object.entries(list)) {
                        if (Array.isArray(val)) { const f = val.filter(e => !isBlockedThreadEntry(e)); if (f.length) out[key] = f; }
                        else if (val && typeof val === 'object' && ('ownerId' in val || 'owner_id' in val)) { if (!isBlockedThreadEntry(val)) out[key] = val; }
                        else out[key] = val;
                    }
                    return out;
                }
                return list;
            };
            const filterWrapper = (_, args, ret) => {
                if (!ret || !self.settings.places?.messages) return ret;
                try { return filterThreadList(ret); } catch (_) { return ret; }
            };
            const THREAD_LIST_METHODS = ['getActiveJoinedUnreadThreadsForParent','getActiveJoinedUnreadThreadsForGuild','getActiveUnjoinedUnreadThreadsForParent','getActiveUnjoinedUnreadThreadsForGuild','getActiveJoinedThreadsForParent','getActiveJoinedThreadsForGuild','getActiveJoinedRelevantThreadsForParent','getActiveJoinedRelevantThreadsForGuild','getActiveUnjoinedThreadsForParent','getActiveUnjoinedThreadsForGuild'];
            for (const m of THREAD_LIST_METHODS) { if (typeof threadsStore[m] === 'function') this.patchAfter(threadsStore, m, filterWrapper); }
            this.patchAfter(threadsStore, "getActiveThreadCount", function(_, args, ret) {
                if (!ret || typeof ret !== "number" || ret <= 0) return ret;
                if (!self.settings.places?.messages) return ret;
                if (!args || !args.length) return ret;
                try {
                    const joined = threadsStore.getActiveJoinedThreadsForParent?.(...args);
                    const unjoined = threadsStore.getActiveUnjoinedThreadsForParent?.(...args);
                    const flatten = list => {
                        if (!list) return [];
                        if (Array.isArray(list)) return list;
                        return Object.values(list).flatMap(v => Array.isArray(v) ? v : [ v ]);
                    };
                    const combined = [ ...flatten(joined), ...flatten(unjoined) ];
                    return Math.min(ret, combined.length);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "hasActiveJoinedUnreadThreads", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                if (!args || !args.length) return ret;
                try {
                    const forParent = threadsStore.getActiveJoinedUnreadThreadsForParent?.(...args);
                    if (forParent !== undefined) {
                        const filtered = filterThreadList(forParent);
                        const stillHasAny = Array.isArray(filtered) ? filtered.length > 0 : Object.values(filtered || {}).some(v => Array.isArray(v) && v.length > 0);
                        return stillHasAny;
                    }
                    return ret;
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getNewThreadCount", function(_, args, ret) {
                if (!ret || typeof ret !== "number" || ret <= 0) return ret;
                if (!self.settings.places?.messages) return ret;
                if (!args || !args.length) return ret;
                const readStateStore = self.modules.ReadStateStore;
                if (!readStateStore?.ackMessageId || !readStateStore?.lastMessageId) return ret;
                try {
                    const channelId = args[args.length - 1];
                    const ackId = readStateStore.ackMessageId(channelId);
                    if (ackId == null) return 0;
                    const joined = threadsStore.getActiveJoinedUnreadThreadsForParent?.(...args);
                    const unjoined = threadsStore.getActiveUnjoinedUnreadThreadsForParent?.(...args);
                    const flatten = list => {
                        if (!list) return [];
                        if (Array.isArray(list)) return list;
                        return Object.values(list).flatMap(v => Array.isArray(v) ? v : [ v ]);
                    };
                    let count = 0;
                    for (const entry of flatten(joined)) {
                        const threadChannelId = entry?.channel?.id || entry?.id;
                        const lm = threadChannelId ? readStateStore.lastMessageId(threadChannelId) : null;
                        if (lm != null && lm > ackId) count++;
                    }
                    for (const entry of flatten(unjoined)) {
                        const threadId = entry?.id || entry?.channel?.id;
                        const lm = threadId ? readStateStore.lastMessageId(threadId) : null;
                        if (lm != null && lm > ackId) count++;
                    }
                    return count;
                } catch (_) {
                    return ret;
                }
            });
        }
        const scheduleReadStateRecheck = () => self._forceReadStateRecheck();
        try {
            if (threadsStore?.addChangeListener && !self._threadsStoreChangeHandler) {
                self._threadsStoreChangeHandler = scheduleReadStateRecheck;
                threadsStore.addChangeListener(self._threadsStoreChangeHandler);
            }
        } catch (_) {}
        try {
            if (self.modules.ThreadStore?.addChangeListener && !self._threadStoreChangeHandler) {
                self._threadStoreChangeHandler = scheduleReadStateRecheck;
                self.modules.ThreadStore.addChangeListener(self._threadStoreChangeHandler);
            }
        } catch (_) {}
        try {
            if (self.modules.ChannelStore?.addChangeListener && !self._channelStoreChangeHandler) {
                self._channelStoreChangeHandler = scheduleReadStateRecheck;
                self.modules.ChannelStore.addChangeListener(self._channelStoreChangeHandler);
            }
        } catch (_) {}
        if (!self._taskbarBadgePatched) {
            const grs = self.modules.GuildReadStateStore;
            if (grs?.hasAnyUnread) {
                self.patchAfter(grs, "hasAnyUnread", (_, __, ret) => {
                    if (!self._taskbarBadgeEnabled() || !ret) return ret;
                    return self._filteredHasAnyUnread();
                });
            }
            if (grs?.getTotalMentionCount) {
                self.patchAfter(grs, "getTotalMentionCount", (_, __, ret) => {
                    if (!self._taskbarBadgeEnabled()) return ret;
                    return self._filteredTotalMentionCount();
                });
            }
            self._taskbarBadgePatched = true;
        }
        if (!self._notificationDispatcherPatched) {
            if (!self.modules.Dispatcher) {
                try {
                    self.modules.Dispatcher = self.modules.SelectedChannelStore?._dispatcher || null;
                } catch (_) {}
            }
            const Dispatcher = self.modules.Dispatcher;
            if (Dispatcher && typeof Dispatcher.dispatch === "function") {
                self.patchBefore(Dispatcher, "dispatch", (_, args) => {
                    if (!self.settings.places?.messages) return;
                    const action = args?.[0];
                    if (!action || typeof action !== "object") return;
                    const scheduleRefresh = () => {
                        queueMicrotask(() => {
                            self._forceReadStateRecheck(true);
                            self._refreshTaskbarBadge();
                        });
                    };
                    if (action.type === "MESSAGE_CREATE") {
                        const msg = action.message;
                        const authorId = msg?.author?.id;
                        const channelId = msg?.channel_id;
                        if (!authorId || !channelId) return;
                        let parentId = null;
                        try {
                            parentId = self.modules.ChannelStore?.getChannel?.(channelId)?.parent_id || null;
                        } catch (_) {}
                        if (self.shouldHide(authorId)) {
                            self._markBlockedOnlyReadActivity(channelId, parentId, msg?.id);
                            scheduleRefresh();
                        } else {
                            self._clearBlockedOnlyReadActivity(channelId);
                            if (parentId) self._clearBlockedOnlyReadActivity(parentId);
                        }
                        return;
                    }
                    if (action.type === "THREAD_CREATE") {
                        const thread = action.channel || action;
                        const ownerId = thread?.ownerId || thread?.owner_id;
                        const parentId = thread?.parent_id;
                        if (ownerId && parentId && self.shouldHide(ownerId)) {
                            const lastId = self.modules.ReadStateStore?.lastMessageId?.(parentId);
                            self._markBlockedOnlyReadActivity(parentId, null, lastId || thread?.id);
                            scheduleRefresh();
                        }
                        return;
                    }
                    const ackChannelId = action.channelId || action.channel_id;
                    if (ackChannelId && (action.type === "CHANNEL_ACK" || action.type === "ACK_MESSAGES" || action.type === "THREAD_ACK")) {
                        self._clearBlockedOnlyReadActivity(ackChannelId);
                    }
                });
                self._notificationDispatcherPatched = true;
            }
        }
        this._readStatePatched = true;
        self._applyBlockedReadCacheOnStartup();
        self._bootstrapBlockedUnreadSuppression();
        self._refreshTaskbarBadge();
    }
    _getReadStateHelpers() {
        return {
            getChannelMessages: cid => this._getChannelMessages(cid),
            isBlockedMessage: msg => this._isBlockedMessage(msg),
            isForumParentChannel: cid => this._isForumParentChannel(cid),
            hasVisibleForumActivity: cid => this._hasVisibleForumActivity(cid),
            resolveForumActivityOwnerId: (p, a) => this._resolveForumActivityOwnerId(p, a)
        };
    }
    _channelCountsAsGuildUnread(channelId) {
        const rs = this.modules.ReadStateStore;
        if (!rs || !channelId) return false;
        if (typeof rs.hasTrackedUnread === 'function' && rs.hasTrackedUnread(channelId)) return true;
        if (typeof rs.hasUnreadOrMentions === 'function' && rs.hasUnreadOrMentions(channelId)) return true;
        return !!rs.hasUnread?.(channelId);
    }
    patchBefore(target, method, callback) { this._patcher?.before(target, method, callback); }
    patchInstead(target, method, callback) { this._patcher?.instead(target, method, callback); }
    patchAfter(target, method, callback) { this._patcher?.after(target, method, callback); }
    filterVoiceStates(value) {
        if (!value) return value;
        if (Array.isArray(value)) {
            let changed = false;
            const filtered = value.filter(state => {
                const hide = this.shouldHide(this.extractUserId(state));
                if (hide) changed = true;
                return !hide;
            });
            return changed ? filtered : value;
        }
        if (value instanceof Map) {
            let changed = false;
            const filtered = new Map;
            for (const [key, item] of value) {
                const next = this.filterVoiceStates(item);
                const userId = this.extractUserId(item) || key;
                const keep = Array.isArray(next) ? next.length : !this.shouldHide(userId);
                if (keep) {
                    filtered.set(key, next);
                    if (next !== item) changed = true;
                } else {
                    changed = true;
                }
            }
            return changed ? filtered : value;
        }
        if (typeof value === "object") {
            let changed = false;
            const filtered = {};
            for (const [key, item] of Object.entries(value)) {
                if (Array.isArray(item)) {
                    const next = this.filterVoiceStates(item);
                    if (next.length) {
                        filtered[key] = next;
                        if (next !== item) changed = true;
                    } else {
                        changed = true;
                    }
                    continue;
                }
                const userId = this.extractUserId(item) || key;
                if (!this.shouldHide(userId)) {
                    filtered[key] = item;
                } else {
                    changed = true;
                }
            }
            return changed ? filtered : value;
        }
        return value;
    }
    shouldHide(userId, isSpammer = false) {
        if (!userId) return false;
        if (isSpammer) return true;
        if (this._shouldHideCache?.has(userId)) return this._shouldHideCache.get(userId);
        try {
            let result = false;
            if (this.settings.types.blocked && this.modules.RelationshipStore?.isBlocked?.(userId)) result = true;
            else if (this.settings.types.ignored && this.modules.RelationshipStore?.isIgnored?.(userId)) result = true;
            if (this._shouldHideCache) this._shouldHideCache.set(userId, result);
            return result;
        } catch (_) {
            return false;
        }
    }
    _startChannelSwitchWatcher() {
        if (this._channelSwitchChangeHandler) return;
        const store = this.modules.SelectedChannelStore;
        if (!store?.addChangeListener) return;
        this._lastWatchedChannelId = store.getChannelId?.() || null;
        this._channelSwitchChangeHandler = () => {
            const channelId = store.getChannelId?.() || null;
            if (channelId === this._lastWatchedChannelId) return;
            this._lastWatchedChannelId = channelId;
            const delays = [ 50, 250, 600 ];
            for (let d = 0; d < delays.length; d++) {
                setTimeout(() => {
                    if (!this.isRunning) return;
                    try {
                        if (this.settings.places.messages) this.hideForumPosts();
                        if (this.settings.places.memberList) this.hideMemberRows();
                        if (this.settings.places.groupDms || this.settings.places.messages) this.hidePrivateChannels();
                        if (this.settings.places.reactions) {
                            this.fixReactionCounts();
                            this.hideBlockedReactors();
                        }
                    } catch (_) {}
                }, delays[d]);
            }
        };
        store.addChangeListener(this._channelSwitchChangeHandler);
    }
    queueRefresh() {
        clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(() => {
            this._revalidateActiveChannelPins();
            this.restoreUnhiddenElements();
            this.queueScan();
        }, 10);
    }
    _revalidateActiveChannelPins() {
        try {
            if (!this._blockedPinnedMessageIds || !this._blockedPinnedMessageIds.size) return;
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            if (channelId) this._scanExistingPinsForChannel(channelId);
        } catch (_) {}
    }
    queueScan(fromMutation = false) {
        if (!this.isRunning || this.scanTimeout) return;
        this._nmbWatchdogCheck();
        const now = Date.now();
        if (this._lastScanDomTime && now - this._lastScanDomTime < 80) {
            this.scanTimeout = setTimeout(() => {
                this.scanTimeout = null;
                this._lastScanDomTime = Date.now();
                this.scanDom(fromMutation);
            }, 80);
            return;
        }
        this.scanTimeout = requestAnimationFrame(() => {
            this.scanTimeout = null;
            this._lastScanDomTime = Date.now();
            this.scanDom(fromMutation);
        });
    }
    _nmbWatchdogCheck() {
        try {
            if (!this.isRunning) return;
            const now = Date.now();
            if (this._nmbLastWatchdog && now - this._nmbLastWatchdog < 3e4) return;
            this._nmbLastWatchdog = now;
            const relStore = this.modules.RelationshipStore;
            const storeBroken = !relStore || typeof relStore.isBlocked !== "function";
            const observerBroken = !this.observer;
            const dispatcherBroken = !this.modules.Dispatcher || typeof this.modules.Dispatcher.dispatch !== "function";
            const msgStoreBroken = !this._rawGetMessages && (!this.modules.MessageStore || typeof this.modules.MessageStore.getMessages !== "function");
            if (storeBroken || observerBroken || dispatcherBroken || msgStoreBroken) {
                if (storeBroken) { this._patcher.safe("watchdog:resolveModules", () => this.resolveModules()); }
                if (dispatcherBroken) { this._patcher.safe("watchdog:resolveDispatcher", () => this._resolveDispatcher()); }
                if (msgStoreBroken) { this._patcher.safe("watchdog:resolveMessagesGet", () => this._resolveMessagesGet()); }
                if (observerBroken || storeBroken) { this._patcher.safe("watchdog:restartObserver", () => this._restartObserver()); }
            }
        } catch (_) {}
    }
    _startReactionClickWatcher() {
        if (this._reactionClickHandler) return;
        this._reactionClickHandler = event => {
            const removeBtn = event.target.closest?.('[class*="reactionRemove"], [class*="removeReaction"], button[aria-label*="Remove"], button[aria-label*="Remover"]');
            if (removeBtn) {
                if (removeBtn.dataset?.nmbReactorRemoveHidden === "true") {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    return;
                }
                const entry = this._getReactorEntryRoot(removeBtn);
                const clickable = entry?.querySelector('[class*="reactorClickable_"]');
                const userId = this.resolveReactorIdFromRemoveButton(removeBtn) || (clickable ? this.findUserId(clickable) || this.resolveReactorIdByName(clickable) : null);
                if (entry?.dataset?.nmbReactorHidden === "true" || userId && this.shouldHide(userId)) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    return;
                }
            }
            const reactionRow = event.target.closest?.('[class*="reactionInner"]');
            const isModalTrigger = event.target.closest?.('[role="dialog"], [class*="reactionInner"], [class*="reactorsContainer_"], [class*="reactors_"]');
            if (!reactionRow && !isModalTrigger) return;
            const messageRow = event.target.closest?.('li[class*="messageListItem"], [class*="messageListItem"]');
            const idMatch = messageRow?.id?.match(/chat-messages-(?:\d+-)?(\d+)$/);
            if (idMatch) this._lastContextMessageId = idMatch[1];
            if (reactionRow && !isModalTrigger?.matches?.('[role="dialog"]')) {
                this.fixReactionCounts();
                return;
            }
            this._scheduleReactorModalPass();
        };
        document.addEventListener("click", this._reactionClickHandler, true);
        this._startContextMenuWatcher();
        this._startChannelStatusModalWatcher();
    }
    _startContextMenuWatcher() {
        if (this._contextMenuHandler) return;
        const resolveMessageId = fromEl => {
            const messageRow = fromEl?.closest?.('li[class*="messageListItem"], [class*="messageListItem"]');
            if (!messageRow) return null;
            const idMatch = messageRow.id?.match(/chat-messages-(?:\d+-)?(\d+)$/);
            return idMatch ? idMatch[1] : messageRow.id || null;
        };
        const isRelevantClick = event => {
            if (event.type === "contextmenu") return true;
            const target = event.target;
            if (target?.closest?.('li[class*="messageListItem"], [class*="messageListItem"]')) return true;
            if (target?.closest?.('[aria-haspopup="menu"], [aria-haspopup="true"], [role="menuitem"], [class*="buttonContainer"]')) return true;
            return false;
        };
        const capture = event => {
            if (!isRelevantClick(event)) return;
            const resolved = resolveMessageId(event.target);
            if (resolved) this._lastContextMessageId = resolved;
            const delays = this._contextMenuDelays || (this._contextMenuDelays = [ 50, 200, 450 ]);
            for (let d = 0; d < delays.length; d++) {
                setTimeout(() => {
                    try {
                        if (this.settings.places.reactions) this._hideViewReactionsMenuItem();
                    } catch (_) {}
                }, delays[d]);
            }
        };
        this._contextMenuHandler = capture;
        document.addEventListener("contextmenu", capture, true);
        document.addEventListener("click", capture, true);
        this._startMenuPortalObserver();
    }
    _startMenuPortalObserver() {
        if (this._menuPortalObserver) return;
        this._menuPortalObserver = new MutationObserver(mutations => {
            for (let m = 0; m < mutations.length; m++) {
                const added = mutations[m].addedNodes;
                for (let n = 0; n < added.length; n++) {
                    const node = added[n];
                    if (node.nodeType !== 1) continue;
                    const reactionMenuSelector = "#message-actions-reactions, #message-remove-emoji-reactions, #message-remove-reactions, #message-reactions";
                    const menuItem = node.matches?.(reactionMenuSelector) ? node : node.querySelector?.(reactionMenuSelector);
                    if (menuItem) {
                        try {
                            if (this.settings.places.reactions) this._hideViewReactionsMenuItem();
                        } catch (_) {}
                    }
                    if (this.settings.places.messages) {
                        try {
                            const popoverRoot = this._findActivePostsPopoverRoot(node);
                            if (popoverRoot) {
                                this.hideActivePostsPopover(popoverRoot);
                                this._watchActivePostsPopoverContent(popoverRoot);
                                for (const delay of [ 0, 50, 150, 300 ]) {
                                    setTimeout(() => {
                                        if (document.contains(popoverRoot)) this.hideActivePostsPopover(popoverRoot);
                                    }, delay);
                                }
                            }
                        } catch (_) {}
                    }
                    const isReactorsModal = node.matches?.('[role="dialog"], [class*="reactorsContainer_"], [class*="reactors_"]') || node.querySelector?.('[class*="reactorsContainer_"], [class*="reactors_"]');
                    if (isReactorsModal && this.settings.places.reactions) {
                        const modalRoot = node.matches?.('[role="dialog"]') ? node : node.closest?.('[role="dialog"]') || node;
                        this._watchReactorsModalContent(modalRoot);
                        this._scheduleReactorModalPass();
                    }
                }
            }
        });
        this._menuPortalObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    _startChannelStatusModalWatcher() {
        if (this._statusModalClickHandler) return;

        this._statusModalClickHandler = event => {
            try {
                const trigger = event.target?.closest?.('[class*="statusDiv" i][role="button"], [class*="channelStatus" i][role="button"], [class*="voiceChannelStatus" i][role="button"]');
                if (!trigger) return;
                const row = trigger.closest('[data-list-item-id*="channels"]');
                const channelId = row ? this.findChannelId(row) : null;
                if (channelId) this._lastClickedStatusChannelId = channelId;
            } catch (_) {}
        };
        document.addEventListener("click", this._statusModalClickHandler, true);

        if (!this._statusModalObserver) {
            this._statusModalObserver = new MutationObserver(mutations => {
                if (!this.settings.places.voiceChannels) return;
                for (let m = 0; m < mutations.length; m++) {
                    const added = mutations[m].addedNodes;
                    for (let n = 0; n < added.length; n++) {
                        const node = added[n];
                        if (node.nodeType !== 1) continue;
                        const editor = node.matches?.('[data-slate-editor="true"]')
                            ? node
                            : node.querySelector?.('[data-slate-editor="true"]');
                        if (editor) this._maybeClearBlockedStatusEditor(editor);
                    }
                }
            });
            this._statusModalObserver.observe(document.body, { childList: true, subtree: true });
        }
    }
    _maybeClearBlockedStatusEditor(editor) {
        try {
            if (editor.dataset?.nmbStatusChecked === "true") return;
            editor.dataset.nmbStatusChecked = "true";
            const channelId = this._lastClickedStatusChannelId
                || this.modules.SelectedChannelStore?.getVoiceChannelId?.()
                || this.modules.SelectedChannelStore?.getChannelId?.();
            if (!channelId) return;

            const blockedStatusText = this._blockedChannelStatuses?.get(channelId);
            if (!blockedStatusText) return;

            const verifyAndClear = () => {
                if (!document.contains(editor)) return;
                const currentText = (editor.textContent || "").trim();
                if (currentText !== blockedStatusText.trim()) return;
                editor.focus();
                const range = document.createRange();
                range.selectNodeContents(editor);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                document.execCommand("delete");
            };
            setTimeout(verifyAndClear, 30);
        } catch (_) {}
    }
    _watchReactorsModalContent(modalRoot) {
        try {
            if (!modalRoot || modalRoot.dataset?.nmbContentWatched === "true") return;
            modalRoot.dataset.nmbContentWatched = "true";
            const observer = new MutationObserver(() => {
                if (!document.contains(modalRoot)) {
                    observer.disconnect();
                    return;
                }
                this._scheduleReactorModalPass();
            });
            observer.observe(modalRoot, {
                childList: true,
                subtree: true
            });
            setTimeout(() => observer.disconnect(), 15e3);
            this._scheduleReactorModalPass();
        } catch (_) {}
    }
    _scheduleReactorModalPass() {
        if (!this.settings.places?.reactions) return;
        clearTimeout(this._reactorModalPassTimer);
        this._reactorModalPassTimer = setTimeout(() => {
            this._reactorModalPassTimer = null;
            if (!this.isRunning) return;
            try {
                this.hideBlockedReactors();
            } catch (_) {}
        }, 100);
    }
    _resolveReactorsModalMessageId(modal) {
        if (!modal) return this._lastContextMessageId;
        if (modal.dataset?.nmbMessageId) return modal.dataset.nmbMessageId;
        let found = null;
        try {
            this.walkFiberProps(modal, props => {
                if (found) return;
                for (const c of [ props?.messageId, props?.message?.id, props?.message_id ]) {
                    if (c && /^\d{17,20}$/.test(String(c))) {
                        found = String(c);
                        return;
                    }
                }
            }, 12);
        } catch (_) {}
        if (!found) {
            const bars = document.querySelectorAll('[id^="message-reactions-"]');
            for (const bar of bars) {
                if (bar.dataset?.nmbZeroReaction === "true") continue;
                const id = bar.id.match(/message-reactions-(\d+)$/)?.[1];
                if (id) {
                    found = id;
                    break;
                }
            }
        }
        if (found) modal.dataset.nmbMessageId = found;
        return found || this._lastContextMessageId;
    }
    _filterReactionUsers(result) {
        if (!result || !this.settings.places?.reactions) return result;
        if (result instanceof Map) {
            const filtered = new Map;
            for (const [key, value] of result) {
                const userId = /^\d{17,20}$/.test(String(key)) ? String(key) : value?.id;
                if (userId && this.shouldHide(userId)) continue;
                filtered.set(key, value);
            }
            return filtered;
        }
        if (Array.isArray(result)) {
            return result.filter(user => {
                const userId = user?.id;
                return !(userId && this.shouldHide(userId));
            });
        }
        return result;
    }
    _reactionUsersSize(users) {
        if (users instanceof Map) return users.size;
        if (Array.isArray(users)) return users.length;
        return 0;
    }
    _getFilteredReactions(store, channelId, messageId, emoji, burstType = 0) {
        if (!store || !channelId || !messageId) return null;
        try {
            let users = store.getReactions(channelId, messageId, emoji, undefined, burstType);
            users = this._filterReactionUsers(users);
            if (this._reactionUsersSize(users) === 0) {
                const burstUsers = store.getReactions(channelId, messageId, emoji, undefined, 1);
                const filteredBurst = this._filterReactionUsers(burstUsers);
                if (this._reactionUsersSize(filteredBurst) > 0) users = filteredBurst;
            }
            return users;
        } catch (_) {
            return null;
        }
    }
    _countReactorClickables(el) {
        if (!el?.querySelectorAll) return 0;
        return el.querySelectorAll('[class*="reactorClickable_"]').length;
    }
    _getReactorEntryRoot(node) {
        if (!node) return null;
        const container = node.closest('[class*="reactorsContainer_"], [class*="reactors_"]');
        if (!container) return node;
        let el = node.matches?.('[class*="reactorClickable_"]') ? node : node.parentElement;
        let best = node.matches?.('[class*="reactorClickable_"]') ? node : null;
        while (el && el !== container) {
            const count = this._countReactorClickables(el);
            if (count === 1) best = el;
            if (count > 1) break;
            if (el.matches?.('li, [class*="reactorRow"]') && count <= 1) return el;
            el = el.parentElement;
        }
        return best || node;
    }
    _hideReactorRemoveButtons(entry) {
        if (!entry) return;
        const removeSel = '[class*="reactionRemove"], [class*="removeReaction"], button[aria-label*="Remove"], button[aria-label*="Remover"]';
        entry.querySelectorAll(removeSel).forEach(btn => {
            if (btn.dataset?.nmbReactorRemoveHidden !== "true") btn.dataset.nmbReactorRemoveHidden = "true";
        });
    }
    _hideReactorEntry(row) {
        if (!row) return;
        if (row.dataset?.nmbReactorHidden !== "true") row.dataset.nmbReactorHidden = "true";
        const entry = this._getReactorEntryRoot(row);
        if (entry && entry !== row && this._countReactorClickables(entry) === 1) {
            if (entry.dataset?.nmbReactorHidden !== "true") entry.dataset.nmbReactorHidden = "true";
            this._hideReactorRemoveButtons(entry);
            return;
        }
        const parent = row.parentElement;
        if (parent && this._countReactorClickables(parent) <= 1) {
            this._hideReactorRemoveButtons(parent);
        }
    }
    resolveReactorIdFromRemoveButton(btn) {
        if (!btn) return null;
        const fromFiber = this.findUserId(btn);
        if (fromFiber) return fromFiber;
        const label = btn.getAttribute("aria-label") || btn.getAttribute("title") || "";
        const match = label.match(/(?:from|de|for|para)\s+(.+?)(?:[''']s reaction|$)/i) || label.match(/(?:Remove|Remover).*?,\s*(.+)$/i);
        const displayName = (match?.[1] || "").trim();
        if (!displayName) return null;
        const UserStore = this.modules.UserStore;
        if (!UserStore || typeof UserStore.getUsers !== "function") return null;
        const users = UserStore.getUsers();
        for (const id in users) {
            const u = users[id];
            const names = [ u?.username, u?.globalName, u?.displayName ].filter(Boolean).map(n => String(n).trim().toLowerCase());
            if (names.includes(displayName.toLowerCase())) return String(id);
        }
        return null;
    }
    _getRawReactionUserIds(channelId, messageId, emoji) {
        const store = this.modules.ReactionsStore;
        if (!store || !channelId || !messageId || !emoji?.name) return [];
        const ids = [];
        try {
            for (const burst of [ 0, 1 ]) {
                const raw = store.getReactions(channelId, messageId, emoji, undefined, burst);
                if (raw instanceof Map) {
                    for (const [key, val] of raw) {
                        const id = /^\d{17,20}$/.test(String(key)) ? String(key) : val?.id;
                        if (id) ids.push(String(id));
                    }
                } else if (Array.isArray(raw)) {
                    for (const u of raw) if (u?.id) ids.push(String(u.id));
                }
            }
        } catch (_) {}
        return [ ...new Set(ids) ];
    }
    _getActiveModalEmoji(modal) {
        const activeTab = modal?.querySelector?.('[class*="reactionSelected_"][aria-selected="true"], [class*="reactionSelected_"]');
        const emojiImg = activeTab?.querySelector('img[class*="emoji"]');
        if (!emojiImg) return null;
        return {
            id: emojiImg.getAttribute("data-id") || null,
            name: emojiImg.getAttribute("alt") || emojiImg.getAttribute("data-name")
        };
    }
    _hideGhostReactorSlots(container, messageId, channelId, emoji) {
        if (!container || !messageId || !channelId || !emoji?.name) return;
        const blockedIds = this._getRawReactionUserIds(channelId, messageId, emoji).filter(id => this.shouldHide(id));
        if (!blockedIds.length) return;
        const removeSel = '[class*="reactionRemove"], [class*="removeReaction"], button[aria-label*="Remove"], button[aria-label*="Remover"]';
        container.querySelectorAll(removeSel).forEach(btn => {
            if (btn.dataset?.nmbReactorRemoveHidden === "true") return;
            const userId = this.resolveReactorIdFromRemoveButton(btn);
            if (userId && this.shouldHide(userId)) {
                btn.dataset.nmbReactorRemoveHidden = "true";
                const entry = this._getReactorEntryRoot(btn);
                if (entry && this._countReactorClickables(entry) <= 1) entry.dataset.nmbReactorHidden = "true";
                return;
            }
            const entry = this._getReactorEntryRoot(btn);
            if (!entry) return;
            const clickable = entry.querySelector('[class*="reactorClickable_"]');
            const nameEl = clickable?.querySelector('[class*="reactorInfo_"] strong, [class*="defaultColor_"]');
            const avatar = clickable?.querySelector('img[src*="/avatars/"]');
            const hasIdentity = !!(nameEl?.textContent || "").trim() || !!avatar;
            const clickableHidden = clickable?.dataset?.nmbReactorHidden === "true";
            if (!clickable || clickableHidden && !hasIdentity) {
                btn.dataset.nmbReactorRemoveHidden = "true";
                if (this._countReactorClickables(entry) <= 1) entry.dataset.nmbReactorHidden = "true";
            }
        });
    }
    _cleanupReactorModalLoading(container) {
        if (!container) return;
        const rows = container.querySelectorAll('[class*="reactorClickable_"]');
        rows.forEach(row => {
            if (row.dataset?.nmbReactorHidden === "true") return;
            const nameEl = row.querySelector('[class*="reactorInfo_"] strong, [class*="defaultColor_"]');
            if (!nameEl || !(nameEl.textContent || "").trim()) return;
            row.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="wandering"], [class*="dot"]').forEach(spinner => {
                const parent = spinner.parentElement;
                if (parent && parent !== row && !parent.querySelector('[class*="reactorInfo_"]')) {
                    parent.style.display = "none";
                    parent.dataset.nmbLoadingHidden = "true";
                } else {
                    spinner.style.display = "none";
                    spinner.dataset.nmbLoadingHidden = "true";
                }
            });
        });
        container.querySelectorAll('[class*="loadingMore"], [class*="loading_"]').forEach(el => {
            if (el.closest('[class*="reactorClickable_"]:not([data-nmb-reactor-hidden="true"])')) return;
            const wrap = el.closest('[class*="reactors_"], [class*="reactorsContainer_"]') ? el : el.parentElement;
            if (wrap) {
                wrap.style.display = "none";
                wrap.dataset.nmbLoadingHidden = "true";
            }
        });
    }
    _messageHasRealReaction(messageId) {
        try {
            if (!messageId) return true;
            const container = document.getElementById(`message-reactions-${messageId}`);
            if (!container) return true;
            this.fixReactionCounts();
            if (container.dataset.nmbZeroReaction === "true") return false;
            const rows = container.querySelectorAll('[class*="reactionInner"]');
            if (!rows.length) return false;
            for (const row of rows) {
                if (row.dataset.nmbZeroReaction !== "true") return true;
            }
            return false;
        } catch (_) {
            return true;
        }
    }
    _REACTION_MENU_ITEM_IDS() {
        return [ "message-actions-reactions", "message-remove-emoji-reactions", "message-remove-reactions", "message-reactions" ];
    }
    _hideViewReactionsMenuItem() {
        const focusedRow = document.querySelector('li[class*="messageListItem"][class*="contextMenuOpen"], li[class*="messageListItem"][aria-expanded="true"]');
        const idFromFocused = focusedRow?.id?.match(/chat-messages-(?:\d+-)?(\d+)$/)?.[1] || null;
        const messageId = idFromFocused || this._lastContextMessageId;
        const hasReal = this._messageHasRealReaction(messageId);
        for (const itemId of this._REACTION_MENU_ITEM_IDS()) {
            const item = document.getElementById(itemId);
            if (!item) continue;
            if (item.dataset.nmbHideViewReactions === "true") delete item.dataset.nmbHideViewReactions;
            if (!hasReal) item.dataset.nmbHideViewReactions = "true";
        }
    }
    _getForumThreadOwnerId(card) {
        try {
            const idEl = card.querySelector("[data-item-id]");
            const threadId = idEl?.dataset?.itemId || card.dataset?.itemId;
            if (!threadId) return null;
            const channel = this.modules.ChannelStore?.getChannel?.(threadId);
            if (!channel) return null;
            return channel.ownerId || channel.owner_id || null;
        } catch (_) {
            return null;
        }
    }
    hideForumPosts() {
        try {
            const forumLists = document.querySelectorAll('[data-list-id^="forum-channel-list-"]');
            for (const list of forumLists) {
                const cards = Array.from(list.querySelectorAll('.card_f369db, [class*="card_"]')).filter(card => !card.classList.contains("headerRow_f369db") && !/headerRow_/.test(card.className));
                let hiddenCount = 0;
                for (const card of cards) {
                    if (card.dataset?.hiddenBlocked === "true") {
                        hiddenCount++;
                        continue;
                    }
                    let shouldHide = false;
                    let authorId = this._getForumThreadOwnerId(card);
                    if (!authorId) authorId = this.findUserId(card);
                    if (authorId && this.shouldHide(authorId)) {
                        shouldHide = true;
                    }
                    const messageContent = card.querySelector('.message_faa96b, .messageFocusBlock_faa96b, [class*="message"]');
                    const blockedMessage = card.querySelector('[data-hidden-blocked="true"], .blockedMessage_faa96b, [class*="blockedMessage"]');
                    const placeholder = card.querySelector('text-md\\/medium, .text-md\\/medium, [class*="empty"]');
                    if (blockedMessage && blockedMessage.dataset?.hiddenBlocked === "true") {
                        shouldHide = true;
                    }
                    if (placeholder && /Be the first|start this conversation|Seja o primeiro|comeÃ§ar essa conversa|empty/i.test(placeholder.textContent || "")) {
                        shouldHide = true;
                    }
                    if (messageContent && !messageContent.querySelector(':not([data-hidden-blocked="true"])')) {
                        shouldHide = true;
                    }
                    if (shouldHide) {
                        this.hideElement(card, "forum-post-only-blocked", authorId || null);
                        hiddenCount++;
                    }
                }
                this._syncForumEmptyState(list, cards.length > 0 && hiddenCount === cards.length);
            }
        } catch (_) {}
    }
    _findLocalizedForumEmptyText() { return _locale(_getLocale(), ByeBlocked.FORUM_LOCALE).title; }
    _findLocalizedForumEmptySubtitle(channelName) { return _locale(_getLocale(), ByeBlocked.FORUM_LOCALE).subtitle.replace('{channel}', channelName); }
    _syncForumEmptyState(listRoot, shouldShowEmpty) {
        const contentContainer = listRoot.querySelector('.content_d125d2, [class*="content_"]') || listRoot;
        let placeholder = contentContainer.querySelector(":scope > .nmb-injected-forum-empty");
        if (shouldShowEmpty) {
            if (!placeholder) {
                placeholder = document.createElement("div");
                placeholder.className = "container__93db4 nmb-injected-forum-empty";
                const bodyText = this._findLocalizedForumEmptyText();
                const channelName = document.querySelector('h1[class*="title__9293f"]')?.textContent?.trim() || document.title.split("|")[0]?.replace("#", "").trim() || "";
                const subtitleText = this._findLocalizedForumEmptySubtitle(channelName);
                placeholder.innerHTML = `\n                    <h2 class="defaultColor__4bd52 heading-md/semibold_cf4812 defaultColor__5345c header__93db4" data-text-variant="heading-md/semibold">${bodyText}</h2>\n                    <div class="text-sm/normal_cf4812" data-text-variant="text-sm/normal" style="color: var(--text-default);">${subtitleText}</div>\n                `;
                contentContainer.appendChild(placeholder);
            }
            placeholder.style.display = "";
        } else if (placeholder) {
            placeholder.style.display = "none";
        }
    }
    hideTopicPanelItems() {
        try {
            const topicItems = document.querySelectorAll('div.container__6764b, [class*="container__6764b"]');
            for (const item of topicItems) {
                if (item.dataset?.hiddenBlocked === "true") continue;
                let authorId = null;
                const listId = item.dataset?.listItemId || item.getAttribute("data-list-item-id") || "";
                let threadId = (listId.match(/(\d{17,20})/) || [])[1] || null;
                if (!threadId) {
                    this.walkFiberProps(item, props => {
                        if (threadId) return;
                        const candidate = props?.threadId || props?.thread?.id;
                        if (candidate && /^\d{17,20}$/.test(String(candidate))) threadId = String(candidate);
                    }, 12);
                }
                if (threadId && this.modules.ChannelStore && typeof this.modules.ChannelStore.getChannel === "function") {
                    try {
                        const thread = this.modules.ChannelStore.getChannel(threadId);
                        if (thread) authorId = thread.ownerId || thread.owner_id || thread.message?.author?.id;
                    } catch (_) {}
                }
                if (!authorId) authorId = this.findUserId(item);
                if (!authorId) {
                    const avatarImg = item.querySelector('img[src*="/avatars/"]');
                    if (avatarImg) {
                        const match = avatarImg.src.match(/\/avatars\/(\d{17,20})/);
                        if (match) authorId = match[1];
                    }
                }
                if (authorId && this.shouldHide(authorId)) {
                    this.hideElement(item, "topic-panel-blocked", authorId);
                }
            }
        } catch (_) {}
    }
    _findActivePostsPopoverRoot(node) {
        try {
            if (node.matches?.('[class*="popout__"][class*="popover_"]')) return node;
            if (node.querySelector) {
                const direct = node.querySelector('[class*="popout__"][class*="popover_"]');
                if (direct) return direct;
            }
            if (node.matches?.('[class*="row__"]') || node.querySelector && node.querySelector('[class*="row__"]')) {
                const rowEl = node.matches?.('[class*="row__"]') ? node : node.querySelector('[class*="row__"]');
                const ancestorPopover = rowEl?.closest?.('[class*="popout__"][class*="popover_"]');
                if (ancestorPopover) return ancestorPopover;
            }
            const HEADER_STRINGS = [ "Mais postagens ativas", "More active posts", "Postagens ativas" ];
            const matchesHeader = el => HEADER_STRINGS.some(s => (el.textContent || "").trim().startsWith(s));
            const headers = node.querySelectorAll ? node.querySelectorAll('[class*="title__"]') : [];
            for (const h of headers) {
                if (matchesHeader(h)) {
                    return h.closest('[class*="popout__"]') || h.parentElement;
                }
            }
        } catch (_) {}
        return null;
    }
    _threadFromRowFiber(row) {
        let found = null;
        this.walkFiberProps(row, props => {
            if (!found && props?.thread) found = props.thread;
        }, 10);
        return found;
    }
    _watchActivePostsPopoverContent(popoverRoot) {
        try {
            if (!popoverRoot || popoverRoot.dataset?.nmbPopoverWatched === "true") return;
            popoverRoot.dataset.nmbPopoverWatched = "true";
            const observer = new MutationObserver(() => {
                if (!document.contains(popoverRoot)) {
                    observer.disconnect();
                    return;
                }
                try {
                    if (this.settings.places.messages) this.hideActivePostsPopover(popoverRoot);
                } catch (_) {}
            });
            observer.observe(popoverRoot, {
                childList: true,
                subtree: true,
                attributes: true
            });
            setTimeout(() => observer.disconnect(), 15e3);
        } catch (_) {}
    }
    hideActivePostsPopover(root) {
        if (!root) return;
        try {
            const rowSel = '[class*="row__"]';
            let rows = root.querySelectorAll(rowSel);
            if (!rows.length) {
                rows = root.querySelectorAll('[role="button"]');
                if (!rows.length) return;
                let filtered = [], r;
                for (let i = 0; i < rows.length; i++) {
                    r = rows[i];
                    if (this._threadFromRowFiber(r)) filtered.push(r);
                }
                rows = filtered;
            }
            if (!rows.length) return;
            let visibleCount = 0;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row.nodeType !== 1 || row.dataset?.hiddenBlocked === "true") continue;
                let authorId = null;
                const thread = this._threadFromRowFiber(row);
                if (thread) authorId = thread.ownerId || thread.owner_id || null;
                if (!authorId) {
                    const match = row.dataset?.listItemId?.match?.(/(\d{17,20})/);
                    const threadId = thread?.id || (match ? match[1] : null);
                    if (threadId && this.modules.ChannelStore?.getChannel) {
                        try {
                            const ch = this.modules.ChannelStore.getChannel(threadId);
                            authorId = ch?.ownerId || ch?.owner_id || null;
                        } catch (_) {}
                    }
                }
                if (!authorId) authorId = this.findUserId(row);
                if (authorId && this.shouldHide(authorId)) {
                    this.hideElement(row, "active-posts-popover-blocked", authorId);
                } else {
                    visibleCount++;
                }
            }
            if (visibleCount === 0) {
                this.hideElement(root, "active-posts-popover-all-blocked", false);
            }
        } catch (_) {}
    }
    hidePrivateChannels() {
        try {
            const dmRows = document.querySelectorAll('[data-list-item-id^="private-channels___"]:not([data-hidden-blocked="true"]), [class*="privateChannels"] [class*="channel"]:not([data-hidden-blocked="true"])');
            for (let i = 0; i < dmRows.length; i++) {
                const row = dmRows[i];
                const userId = this.findUserId(row);
                if (userId && this.shouldHide(userId)) {
                    this.hideElement(row, "dm-blocked", userId);
                }
            }
        } catch (_) {}
    }
    static get FIXED_DM_LIST_ITEM_SUFFIXES() {
        return [ "___friends", "___nitro", "___shop", "___quests" ];
    }
    static get EMPTY_DM_SKELETON_SVG() {
        return '<svg width="184" height="428" viewBox="0 0 184 428" class="empty__99e7c" data-nmb-injected-skeleton="true">' + '<rect x="40" y="6" width="144" height="20" rx="10"></rect><circle cx="16" cy="16" r="16"></circle>' + '<rect x="40" y="50" width="144" height="20" rx="10" opacity="0.9"></rect><circle cx="16" cy="60" r="16" opacity="0.9"></circle>' + '<rect x="40" y="94" width="144" height="20" rx="10" opacity="0.8"></rect><circle cx="16" cy="104" r="16" opacity="0.8"></circle>' + '<rect x="40" y="138" width="144" height="20" rx="10" opacity="0.7"></rect><circle cx="16" cy="148" r="16" opacity="0.7"></circle>' + '<rect x="40" y="182" width="144" height="20" rx="10" opacity="0.6"></rect><circle cx="16" cy="192" r="16" opacity="0.6"></circle>' + '<rect x="40" y="226" width="144" height="20" rx="10" opacity="0.5"></rect><circle cx="16" cy="236" r="16" opacity="0.5"></circle>' + '<rect x="40" y="270" width="144" height="20" rx="10" opacity="0.4"></rect><circle cx="16" cy="280" r="16" opacity="0.4"></circle>' + '<rect x="40" y="314" width="144" height="20" rx="10" opacity="0.3"></rect><circle cx="16" cy="324" r="16" opacity="0.3"></circle>' + '<rect x="40" y="358" width="144" height="20" rx="10" opacity="0.2"></rect><circle cx="16" cy="368" r="16" opacity="0.2"></circle>' + '<rect x="40" y="402" width="144" height="20" rx="10" opacity="0.1"></rect><circle cx="16" cy="412" r="16" opacity="0.1"></circle>' + "</svg>";
    }
    _findLocalizedTopicsEmptyText() { return _locale(_getLocale(), ByeBlocked.TOPICS_LOCALE); }
    _buildTopicsEmptySkeletonHtml() {
        const t = this._findLocalizedTopicsEmptyText();
        return `<div class="nmb-injected-topic-empty container__1b24f">\n                    <div class="iconContainer__1b24f">\n                        <div class="icon__1b24f">\n                            <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="36" height="36" fill="none" viewBox="0 0 24 24">\n                                <path d="M12 2.81a1 1 0 0 1 0-1.41l.36-.36a1 1 0 0 1 1.41 0l9.2 9.2a1 1 0 0 1 0 1.4l-.7.7a1 1 0 0 1-1.3.13l-9.54-6.72a1 1 0 0 1-.08-1.58l1-1L12 2.8ZM12 21.2a1 1 0 0 1 0 1.41l-.35.35a1 1 0 0 1-1.41 0l-9.2-9.19a1 1 0 0 1 0-1.41l.7-.7a1 1 0 0 1 1.3-.12l9.54 6.72a1 1 0 0 1 .07 1.58l-1 1 .35.36ZM15.66 16.8a1 1 0 0 1-1.38.28l-8.49-5.66A1 1 0 1 1 6.9 9.76l8.49 5.65a1 1 0 0 1 .27 1.39ZM17.1 14.25a1 1 0 1 0 1.11-1.66L9.73 6.93a1 1 0 0 0-1.11 1.66l8.49 5.66Z" fill="currentColor"></path>\n                            </svg>\n                        </div>\n                        <svg class="stars__1b24f" aria-hidden="true" role="img" width="104" height="80" viewBox="0 0 104 80" fill="none">\n                            <path d="M95.6718 1.80634C95.6718 0.808724 94.863 0 93.8654 0C92.8678 0 92.0591 0.808724 92.0591 1.80634V3.64278C92.0591 4.64039 92.8678 5.44911 93.8654 5.44911C94.863 5.44911 95.6718 4.64039 95.6718 3.64278V1.80634Z" fill="#ADF3FF"></path>\n                            <path d="M95.6713 16.3574C95.6713 15.3598 94.8625 14.5511 93.8649 14.5511C92.8673 14.5511 92.0586 15.3598 92.0586 16.3574V18.1939C92.0586 19.1915 92.8673 20.0002 93.8649 20.0002C94.8625 20.0002 95.6713 19.1915 95.6713 18.1939V16.3574Z" fill="#ADF3FF"></path>\n                            <path d="M102.194 11.8412C103.191 11.8412 104 11.0325 104 10.0349C104 9.03724 103.191 8.22852 102.194 8.22852H100.357C99.3596 8.22852 98.5509 9.03724 98.5509 10.0349C98.5509 11.0325 99.3596 11.8412 100.357 11.8412H102.194Z" fill="#ADF3FF"></path>\n                            <path d="M87.6434 11.7413C88.641 11.7413 89.4497 10.9325 89.4497 9.93494C89.4497 8.93733 88.641 8.1286 87.6434 8.1286H85.8069C84.8093 8.1286 84.0006 8.93733 84.0006 9.93494C84.0006 10.9325 84.8093 11.7413 85.8069 11.7413H87.6434Z" fill="#ADF3FF"></path>\n                            <path d="M11.1501 74.4573L15.3147 73.0684C15.5192 72.9747 15.6925 72.8241 15.814 72.6347C15.9354 72.4454 16 72.225 16 72C16 71.775 15.9354 71.5546 15.814 71.3653C15.6925 71.1759 15.5192 71.0253 15.3147 70.9316L11.1501 69.5427C10.8657 69.4142 10.6378 69.1862 10.5094 68.9016L9.01446 64.7348C8.94423 64.521 8.80835 64.3349 8.62619 64.203C8.44403 64.071 8.22488 64 7.99999 64C7.77511 64 7.55597 64.071 7.37381 64.203C7.19165 64.3349 7.05576 64.521 6.98554 64.7348L5.49057 68.9016C5.36216 69.1862 5.13433 69.4142 4.84986 69.5427L0.685276 70.9316C0.480802 71.0253 0.307523 71.1759 0.186045 71.3653C0.0645662 71.5546 0 71.775 0 72C0 72.225 0.0645662 72.4454 0.186045 72.6347C0.307523 72.8241 0.480802 72.9747 0.685276 73.0684L4.84986 74.4573C5.0011 74.5032 5.1387 74.5858 5.25046 74.6976C5.36222 74.8094 5.44469 74.9471 5.49057 75.0984L6.98554 79.2652C7.05576 79.479 7.19165 79.6651 7.37381 79.797C7.55597 79.929 7.77511 80 7.99999 80C8.22488 80 8.44403 79.929 8.62619 79.797C8.80835 79.6651 8.94423 79.479 9.01446 79.2652L10.5094 75.0984C10.5553 74.9471 10.6378 74.8094 10.7495 74.6976C10.8613 74.5858 10.9989 74.5032 11.1501 74.4573Z" fill="#FFD01A"></path>\n                        </svg>\n                    </div>\n                    <h2 class="defaultColor__4bd52 heading-xl/semibold_cf4812 defaultColor__5345c header__1b24f" data-text-variant="heading-xl/semibold">${t.title}</h2>\n                    <div class="text-md/normal_cf4812" data-text-variant="text-md/normal" style="color: var(--text-default);">${t.subtitle}</div>\n                    <div data-button-hoisted-classname-wrapper="true" class="cta__1b24f">\n                        <button data-mana-component="button" role="button" class="button_a22cb0 md_a22cb0 primary_a22cb0 hasText_a22cb0" type="button">\n                            <div class="buttonChildrenWrapper_a22cb0">\n                                <div class="buttonChildren_a22cb0">\n                                    <span class="lineClamp1__4bd52 text-md/medium_cf4812" data-text-variant="text-md/medium">${t.button}</span>\n                                </div>\n                            </div>\n                        </button>\n                    </div>\n                </div>`;
    }
    enforceEmptyDmSkeleton() {
        try {
            const list = document.querySelector('ul[aria-label="Direct Messages"], ul[aria-label="Mensagens diretas"]');
            if (!list) return;
            const existingSkeleton = list.querySelector('[data-nmb-injected-skeleton="true"]');
            const nativeSkeleton = list.querySelector('svg[class*="empty__99e7c"]:not([data-nmb-injected-skeleton])');
            if (nativeSkeleton) {
                if (existingSkeleton) existingSkeleton.remove();
                return;
            }
            const rows = Array.from(list.querySelectorAll('li[class*="channel__972a0"], li[role="listitem"]'));
            const isFixedItem = row => {
                const link = row.querySelector("[data-list-item-id]");
                const listId = link?.dataset?.listItemId || row.dataset?.listItemId || "";
                return ByeBlocked.FIXED_DM_LIST_ITEM_SUFFIXES.some(suffix => listId.endsWith(suffix));
            };
            let hasVisibleRealDm = false;
            let hasHiddenBlockedDm = false;
            for (const row of rows) {
                if (isFixedItem(row)) continue;
                if (row.dataset?.hiddenBlocked === "true") {
                    hasHiddenBlockedDm = true;
                } else if (row.offsetParent !== null) {
                    hasVisibleRealDm = true;
                }
            }
            if (hasVisibleRealDm) {
                if (existingSkeleton) existingSkeleton.remove();
                return;
            }
            if (hasHiddenBlockedDm && !existingSkeleton) {
                list.insertAdjacentHTML("beforeend", ByeBlocked.EMPTY_DM_SKELETON_SVG);
            } else if (!hasHiddenBlockedDm && existingSkeleton) {
                existingSkeleton.remove();
            }
        } catch (_) {}
    }
    _findTopicPanelListRoot(header) {
        let node = header?.parentElement;
        for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
            if (String(node.className || "").match(/\blist_[a-f0-9]+\b/)) return node;
        }
        return header?.parentElement?.parentElement || null;
    }
    _prepareTopicPanelEmptyLayout(listRoot, scrollerContent) {
        if (!listRoot || !scrollerContent) return;
        if (scrollerContent.dataset.nmbTopicScrollerHidden !== "true") {
            scrollerContent.dataset.nmbTopicScrollerHidden = "true";
            scrollerContent.dataset.nmbPrevDisplay = scrollerContent.style.display || "";
            scrollerContent.style.display = "none";
        }
        if (!listRoot.dataset.nmbPrevListClass) {
            listRoot.dataset.nmbPrevListClass = listRoot.className;
            listRoot.dataset.nmbPrevListStyle = listRoot.getAttribute("style") || "";
            listRoot.className = listRoot.className.split(/\s+/).filter(cls => cls && !/(?:^thin_|^scrollerBase_|^fade_|^auto_|^customTheme_)/.test(cls)).join(" ");
            listRoot.style.removeProperty("overflow");
            listRoot.style.removeProperty("padding-right");
        }
    }
    _restoreTopicPanelListLayout(listRoot, scrollerContent) {
        listRoot?.querySelectorAll(".nmb-injected-topic-empty").forEach(el => el.remove());
        if (scrollerContent?.dataset.nmbTopicScrollerHidden === "true") {
            scrollerContent.style.display = scrollerContent.dataset.nmbPrevDisplay || "";
            delete scrollerContent.dataset.nmbTopicScrollerHidden;
            delete scrollerContent.dataset.nmbPrevDisplay;
        }
        if (listRoot?.dataset.nmbPrevListClass) {
            listRoot.className = listRoot.dataset.nmbPrevListClass;
            const prevStyle = listRoot.dataset.nmbPrevListStyle;
            if (prevStyle) listRoot.setAttribute("style", prevStyle); else listRoot.removeAttribute("style");
            delete listRoot.dataset.nmbPrevListClass;
            delete listRoot.dataset.nmbPrevListStyle;
        }
    }
    _wireTopicPanelEmptyButton(emptyRoot) {
        const button = emptyRoot?.querySelector("button");
        if (!button || button.dataset.nmbTopicCreateWired === "true") return;
        button.dataset.nmbTopicCreateWired = "true";
        button.addEventListener("click", () => {
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(btn => btn !== button && !emptyRoot.contains(btn) && btn.offsetParent !== null);
            const normalize = el => (el.textContent || "").trim().toLowerCase();
            let target = allButtons.find(btn => normalize(btn) === "create thread") || allButtons.find(btn => normalize(btn) === "create") || allButtons.find(btn => normalize(btn) === "criar") || allButtons.find(btn => normalize(btn) === "criar tÃ³pico");
            if (!target) return;
            const rect = target.getBoundingClientRect();
            const mouseOpts = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: rect.x + rect.width / 2,
                clientY: rect.y + rect.height / 2,
                button: 0
            };
            [ "pointerdown", "mousedown", "pointerup", "mouseup", "click" ].forEach(type => {
                target.dispatchEvent(new MouseEvent(type, mouseOpts));
            });
        });
    }
    fixEmptyTopicPanelState() {
        try {
            const headers = document.querySelectorAll('[class*="sectionHeader_"]');
            for (const header of headers) {
                const textContent = (header.textContent || "").toLowerCase();
                if (!textContent.includes("topic") && !textContent.includes("thread") && !textContent.includes("tÃ³pic")) continue;
                const scrollerContent = header.parentElement;
                const listRoot = this._findTopicPanelListRoot(header);
                if (!scrollerContent || !listRoot) continue;
                const topics = Array.from(scrollerContent.querySelectorAll('div.container__6764b, [class*="container__6764b"]'));
                if (topics.length === 0) continue;
                let visibleCount = 0;
                let hiddenBlockedCount = 0;
                for (const topic of topics) {
                    if (topic.dataset?.hiddenBlocked === "true") hiddenBlockedCount++; else if (topic.offsetParent !== null) visibleCount++;
                }
                let existingSkeleton = document.querySelector(".nmb-injected-topic-empty");
                if (visibleCount === 0 && hiddenBlockedCount > 0) {
                    this.hideElement(header, "empty-topic-header");
                    this._prepareTopicPanelEmptyLayout(listRoot, scrollerContent);
                    if (!existingSkeleton) {
                        listRoot.insertAdjacentHTML("beforeend", this._buildTopicsEmptySkeletonHtml());
                        existingSkeleton = listRoot.querySelector(":scope > .nmb-injected-topic-empty");
                    } else if (existingSkeleton.parentElement !== listRoot) {
                        listRoot.appendChild(existingSkeleton);
                    }
                    this._wireTopicPanelEmptyButton(existingSkeleton);
                } else if (visibleCount > 0) {
                    this.restoreElement(header);
                    this._restoreTopicPanelListLayout(listRoot, scrollerContent);
                    if (!header.dataset.nmbOrigText) header.dataset.nmbOrigText = header.textContent;
                    const originalText = header.dataset.nmbOrigText;
                    const match = originalText.match(/\d+/);
                    if (match) {
                        const originalNumber = parseInt(match[0], 10);
                        const realNumber = Math.max(0, originalNumber - hiddenBlockedCount);
                        const currentDisplayedNumber = parseInt(header.textContent.match(/\d+/)?.[0] || "0", 10);
                        if (realNumber !== currentDisplayedNumber) {
                            header.textContent = originalText.replace(/\d+/, realNumber);
                        }
                    }
                }
            }
        } catch (_) {}
    }
    _scheduleForumRetry() {
        if (this._forumRetryScheduled) return;
        this._forumRetryScheduled = true;
        const delays = [ 100, 400 ];
        for (let d = 0; d < delays.length; d++) {
            setTimeout(() => {
                if (!this.isRunning) return;
                try { this.hideForumPosts(); } catch (_) {}
            }, delays[d]);
        }
        setTimeout(() => { this._forumRetryScheduled = false; }, 400);
    }
    _fastHideReactionsFromMutations(mutations) {
        const reactionSel = '[id^="message-reactions-"], [class*="reactionInner"]';
        let found = false;
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                const tag = node.tagName;
                if (tag === 'LINK' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'META' || tag === 'TITLE') continue;
                if (node.matches?.(reactionSel) || node.querySelector?.(reactionSel)) {
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        if (!found) return;
        this.fixReactionCounts();
        this.hideBlockedReactors();
    }
    _fastHideChannelStatusFromMutations(mutations) {
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                const sel = '[class*="channelStatus" i], [class*="voiceChannelStatus" i], [class*="statusText" i]';
                if (node.matches?.(sel)) {
                    if (!node.dataset?.nmbStatusSafe && !node.dataset?.nmbStatusOverridden) {
                        node.dataset.nmbStatusOverridden = "true";
                    }
                    continue;
                }
                if (typeof node.querySelectorAll === 'function') {
                    const els = node.querySelectorAll(sel);
                    for (let e = 0; e < els.length; e++) {
                        const el = els[e];
                        if (!el.dataset?.nmbStatusSafe && !el.dataset?.nmbStatusOverridden) {
                            el.dataset.nmbStatusOverridden = "true";
                        }
                    }
                }
            }
        }
    }
    _fastHideFromMutations(mutations) {
        const places = this.settings.places;
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                const tag = node.tagName;
                if (tag === 'LINK' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'META' || tag === 'TITLE') continue;
                this._fastHideNode(node);
                const qsa = node.querySelectorAll;
                if (qsa) {
                    const descendants = qsa.call(node, 'li[class*="messageListItem"], [class*="messageListItem"], [data-list-item-id^="pins__"], [class*="memberRow"], [role="listitem"][data-list-item-id]');
                    for (let d = 0; d < descendants.length; d++) {
                        this._fastHideNode(descendants[d]);
                    }
                }
                if (node.children?.length === 0 && !node.classList?.length) continue;
                const tagLC = tag === 'DIV' || tag === 'LI';
                if (!tagLC && !node.children?.length) continue;
                if (node.matches?.('[data-list-id="pins"], [data-list-id*="pins"]') || node.querySelector?.('[data-list-id="pins"], [data-list-id*="pins"]')) {
                    try {
                        const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                        if (channelId) this._scanExistingPinsForChannel(channelId);
                        this.hidePinnedMessages();
                        this.fixPinNotificationBadge();
                    } catch (_) {}
                }
                if (node.matches?.('.mainCard_f369db, [class*="mainCard_"]') || node.querySelector?.('.card_f369db, [class*="card_"]') || node.matches?.('[data-list-id^="forum-channel-list-"]')) {
                    this.hideForumPosts();
                    this._scheduleForumRetry();
                }
                if (node.matches?.('div.container__6764b, [class*="container__6764b"]')) this.hideTopicPanelItems();
                if (node.matches?.('[data-list-item-id^="private-channels___"]')) this.hidePrivateChannels();
                if (places.memberList && (node.matches?.('[class*="memberRow"]') || node.querySelector?.('[class*="memberRow"]'))) {
                    this.hideMemberRows();
                }
                if (places.memberList && (node.matches?.('[data-list-id^="members-"]') || node.querySelector?.('[data-list-id^="members-"]'))) {
                    this.hideMemberRows();
                }
                if (places.events) {
                    const eventsSidebarItem = node.matches?.('[data-list-item-id^="channels___upcoming-events-"]') ? node : node.querySelector?.('[data-list-item-id^="channels___upcoming-events-"]');
                    if (eventsSidebarItem) {
                        const li = eventsSidebarItem.closest('li');
                        if (li && !li.querySelector('[data-nmb-events-ready="true"]')) {
                            li.dataset.nmbSidebarPreHidden = "true";
                            li.style.visibility = 'hidden';
                        }
                        try { this._fixEventsSidebarCounterFor(eventsSidebarItem); } catch (_) {}
                    }
                    if (node.matches?.('[data-list-item-id^="channels___guild_scheduled_event-"]') || node.querySelector?.('[data-list-item-id^="channels___guild_scheduled_event-"]')) {
                        try { this.hideSidebarEventItems(); } catch (_) {}
                    }
                    if (node.matches?.('[class*="channelNotice_"]') || node.querySelector?.('[class*="channelNotice_"]')) {
                        try { this.hideBlockedStageChannelNotice(); } catch (_) {}
                    }
                }
                if (places.voiceChannels) {
                    const voiceSel = '[class*="stageUser_"],[class*="stageSection_"],[class*="activityPanel_"],[class*="streamPreview_"],[class*="streamTile_"],[class*="tile_"],[class*="tileSizer_"],[class*="videoWrapper_"],[class*="participantWrapper_"],[class*="gridLayout_"],[class*="callContainer_"],[class*="audienceContainer__"],[class*="raisedHandCount__"],[class*="toolbar__"],[class*="details_"],[class*="speakerCount__"],[class*="text__9aed4"],[class*="blockedNotice__"],[class*="channelNotice__"],[class*="subtitle__"]';
                    if (node.matches?.(voiceSel) || node.querySelector?.(voiceSel)) {
                        try { this.hideVoiceUsers(); } catch (_) {}
                    }
                }
                this._removeVoiceInviteSuggestion(node);
            }
        }
    }
    _removeVoiceInviteSuggestion(node) {
        try {
            const INVITE_LABEL_SEL = '[aria-label^="Convidar para canal de voz"], [aria-label^="Invite to voice channel"]';
            const isInviteRow = el => el.matches?.(INVITE_LABEL_SEL);
            let target = null;
            if (isInviteRow(node)) {
                target = node;
            } else if (node.querySelector) {
                target = node.querySelector(INVITE_LABEL_SEL);
            }
            if (!target) return;
            const wrapper = target.closest('[class*="animation_"]') || target;
            if (!wrapper.matches?.(INVITE_LABEL_SEL) && !wrapper.querySelector?.(INVITE_LABEL_SEL)) return;
            if (wrapper.dataset?.hiddenBlocked === "true") return;
            this.hideElement(wrapper, "voice-invite-suggestion", false);
        } catch (_) {}
    }
    _removeAllVoiceInviteSuggestions() {
        try {
            const INVITE_LABEL_SEL = '[aria-label^="Convidar para canal de voz"], [aria-label^="Invite to voice channel"]';
            const rows = document.querySelectorAll(INVITE_LABEL_SEL);
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const wrapper = row.closest('[class*="animation_"]') || row;
                if (!wrapper.matches?.(INVITE_LABEL_SEL) && !wrapper.querySelector?.(INVITE_LABEL_SEL)) continue;
                if (wrapper.dataset?.hiddenBlocked === "true") continue;
                this.hideElement(wrapper, "voice-invite-suggestion", false);
            }
        } catch (_) {}
    }
    _fastHideNode(el) {
        if (!el || el.nodeType !== 1) return;
        if (el.dataset?.hiddenBlocked === "true") return;
        if (el.dataset?.nmbGhost === "true") return;
        if (this.settings.places.memberList && el.matches?.('[class*="memberRow"]')) {
            const userId = this.findUserId(el);
            if (userId && this.shouldHide(userId)) {
                this.hideElement(el, "fast-guild-member-row", userId);
                try {
                    this.fixGuildMembersPageCount();
                } catch (_) {}
                return;
            }
        }
        if (this.settings.places.memberList && el.matches?.('[role="listitem"][data-list-item-id]')) {
            const listId = el.dataset?.listItemId || "";
            const looksLikeMemberItem = /^\d{17,20}$/.test(listId.split(/[_-]+/).pop() || "") || /^members?[_-]/.test(listId);
            if (looksLikeMemberItem) {
                const userId = this.findUserId(el);
                if (userId && this.shouldHide(userId)) {
                    this.hideElement(el, "fast-sidebar-member-row", userId);
                    try {
                        this.fixMemberGroupCounts();
                    } catch (_) {}
                    return;
                }
            }
        }
        if (el.matches?.('[data-list-item-id^="pins__"]') || el.querySelector?.('[data-list-item-id^="pins__"]')) {
            const pinCard = el.matches?.('[data-list-item-id^="pins__"]') ? el : el.querySelector('[data-list-item-id^="pins__"]');
            if (pinCard && pinCard.dataset?.hiddenBlocked !== "true") {
                const userId = this.findUserId(pinCard);
                const listId = pinCard.dataset?.listItemId || "";
                const pinMatch = listId.match(/^pins_+(\d{17,20})$/);
                const messageId = pinMatch ? pinMatch[1] : null;
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                const pinsItems = channelId ? this.modules.ChannelPinsStore?.getPins?.(channelId)?.items || [] : [];
                const shouldHideByAuthor = userId && this.shouldHide(userId);
                const pinItem = messageId && pinsItems.length ? pinsItems.find(item => item?.message?.id === messageId) || null : null;
                const shouldHideByPinner = messageId && this._shouldHidePinnedMessage(channelId, messageId, pinItem);
                if (shouldHideByAuthor || shouldHideByPinner) {
                    this.hideElement(pinCard, shouldHideByAuthor ? "fast-pin-author" : "fast-pin-by-blocked", shouldHideByAuthor ? userId : false);
                    const wrapper = pinCard.closest('[class*="messageGroupWrapper"]');
                    if (wrapper && wrapper.dataset?.hiddenBlocked !== "true") {
                        const siblingCards = Array.from(wrapper.querySelectorAll('[data-list-item-id^="pins__"]'));
                        if (siblingCards.every(card => card.dataset?.hiddenBlocked === "true")) {
                            this.hideElement(wrapper, "pinned-panel-residue", false);
                        }
                    }
                }
                if (channelId && !this._pinsCleanupThrottled) {
                    this._pinsCleanupThrottled = true;
                    requestAnimationFrame(() => {
                        this._pinsCleanupThrottled = false;
                        try { this.hidePinnedMessages(); } catch (_) {}
                    });
                }
            }
        }
        const hasBlockedClass = this.settings.places.messages && (el.matches?.('[class*="messageGroupBlocked"], [class*="blockedSystemMessage"]') || el.querySelector?.('[class*="messageGroupBlocked"]') || el.querySelector?.('[class*="blockedSystemMessage"]'));
        if (hasBlockedClass) {
            const items = new Set;
            const collectTargets = node => {
                const blocked = node.matches?.('[class*="messageGroupBlocked"], [class*="blockedSystemMessage"]') ? [node] : Array.from(node.querySelectorAll?.('[class*="messageGroupBlocked"], [class*="blockedSystemMessage"]') || []);
                for (const b of blocked) {
                    let t = b.closest?.('[class*="messageListItem"]') || b.closest?.('[role="article"]') || b.closest?.('[class*="wrapper_"]') || b;
                    const gs = t.closest?.('[class*="groupStart"]');
                    if (gs) t = gs;
                    items.add(t);
                }
            };
            collectTargets(el);
            for (const item of items) {
                if (item.dataset?.hiddenBlocked !== "true") this.hideElement(item, "blocked-group-fast");
            }
            return;
        }
        if (this.settings.places.messages && (el.matches?.('li[class*="messageListItem"], [class*="messageListItem"]'))) {
            const messageRow = el;
            if (messageRow.dataset?.hiddenBlocked === "true") return;
            const userId = this.findUserId(messageRow);
            if (userId && this.shouldHide(userId)) {
                this.hideElement(messageRow, "fast-message", userId);
                return;
            }
            const replyBar = messageRow.querySelector('[class*="repliedMessage"], [class*="replyBar"], [class*="messageReference"]');
            if (replyBar) {
                const replyMention = replyBar.querySelector("[data-user-id]");
                const replyUserId = replyMention?.dataset?.userId || this.findUserId(replyBar);
                if (replyUserId && this.shouldHide(replyUserId)) {
                    this.hideElement(messageRow, "fast-reply-to-blocked", replyUserId);
                    return;
                }
                if (replyBar.matches('[class*="blocked"]') || replyBar.querySelector('[class*="blocked"]')) {
                    this.hideElement(messageRow, "fast-reply-blocked-class");
                    return;
                }
            }
            const mention = messageRow.querySelector?.('[class*="mention"][data-user-id]');
            if (mention) {
                const mentionedId = mention.dataset.userId || this.findUserId(mention);
                if (mentionedId && this.shouldHide(mentionedId)) {
                    this.hideElement(messageRow, "fast-mention", mentionedId);
                    return;
                }
            }
            const text = messageRow.textContent;
            if (text && this.isBlockedMessageBannerText(text)) {
                this.hideElement(messageRow, "blocked-group-fast");
                return;
            }
        }
        if (this.settings.places.messages && el.matches?.('[class*="mention"]')) {
            const userId = this.findUserId(el);
            if (userId && this.shouldHide(userId)) {
                const messageRow = el.closest('li[class*="messageListItem"]') || el.closest('[class*="messageListItem"]');
                if (messageRow) {
                    this.hideElement(messageRow, "fast-mention", userId);
                                    } else {
                    this.hideElement(el, "fast-mention", userId);
                                    }
            }
        }
    }
    scanDom(fromMutation = false) {
        try {
            this._shouldHideCache = new Map;
            this.restoreUnhiddenElements();
            this._removeAllVoiceInviteSuggestions();
            if (fromMutation) {
                this.fixMemberGroupCounts();
                this.fixVoiceChannelIconColors();
                this._resyncBlockedChannelStatuses();
                this.hideOrphanedDividers();
                this.collapseGhostSlots();
                this.promoteOrphanedMessages();
                if (this.settings.places?.reactions) {
                    this.fixReactionCounts();
                    this.hideBlockedReactors();
                }
                return;
            }
            const p = this.settings.places;
            if (p.voiceChannels) this.hideVoiceUsers();
            if (p.voiceChannels && !this._callGridPatched) {
                try { this.patchCallGridParticipants(); } catch (_) {}
            }
            if (p.memberList) this.hideMemberRows();
            if (p.messages) {
                this.hideMessages();
                this.hidePinnedMessages();
                this.hideForumPosts();
                this.hideTopicPanelItems();
                this.fixEmptyTopicPanelState();
                this.fixPinNotificationBadge();
            }
            if (p.groupDms || p.messages) this.hidePrivateChannels();
            this.enforceEmptyDmSkeleton();
            if (p.autocomplete) this.hideAutocompleteRows();
            if (p.reactions) {
                this.fixReactionCounts();
                this.hideBlockedReactors();
            }
            if (p.events) {
                this.hideBlockedEvents();
                this.hideSidebarEventItems();
                this.hideBlockedStageChannelNotice();
                this.hideBlockedGuildStageBadge();
            }
            this.fixMemberGroupCounts();
            this.fixVoiceChannelIconColors();
            this._resyncBlockedChannelStatuses();
            this.hideOrphanedDividers();
            this.collapseGhostSlots();
            this.promoteOrphanedMessages();
        } catch (_) {}
    }
    promoteOrphanedMessages() {
        document.querySelectorAll('[data-nmb-promoted="true"]').forEach(el => {
            const prev = this._prevVisibleLi(el);
            if (prev && prev.dataset?.hiddenBlocked !== "true") this._demoteMessage(el);
        });
        const hiddenLis = document.querySelectorAll('li[data-hidden-blocked="true"], [data-hidden-blocked="true"][class*="messageListItem"]');
        for (let i = 0; i < hiddenLis.length; i++) {
            const hidden = hiddenLis[i];
            const next = this._nextVisibleLi(hidden);
            if (!next) continue;
            if (next.dataset?.hiddenBlocked === "true") continue;
            if (next.dataset?.nmbPromoted === "true") continue;
            const groupStartAttr = next.getAttribute("data-message-group-start");
            const isCompact = next.className?.includes?.("compact") || !!next.querySelector('[class*="compact"]');
            const hasHeader = !!next.querySelector('[class*="groupStart"], [class*="cozyHeader"], [class*="header_"], img[src*="/avatars/"]');
            if (groupStartAttr === "false" || !hasHeader && !isCompact) {
                this._promoteMessage(next);
            }
        }
    }
    _promoteMessage(li) {
        if (!li || li.dataset?.nmbPromoted === "true") return;
        li.dataset.nmbPromoted = "true";
        try {
            let fiber = BdApi.ReactUtils.getInternalInstance(li);
            for (let i = 0; i < 30 && fiber; i++, fiber = fiber.return) {
                const props = fiber.memoizedProps || fiber.pendingProps;
                if (!props) continue;
                const key = "groupStart" in props ? "groupStart" : "isGroupStart" in props ? "isGroupStart" : null;
                if (key) {
                    if (!li.dataset.nmbOrigGroupStart) li.dataset.nmbOrigGroupStart = String(props[key]);
                    break;
                }
                const msg = props.message || props.childMessage;
                if (msg && "groupStart" in msg) {
                    if (!li.dataset.nmbOrigGroupStart) li.dataset.nmbOrigGroupStart = String(msg.groupStart);
                    break;
                }
            }
        } catch (_) {}
        li.style.setProperty("--nmb-promoted", "1");
    }
    _demoteMessage(li) {
        if (!li) return;
        delete li.dataset.nmbPromoted;
        li.removeAttribute("data-nmb-promoted");
        delete li.dataset.nmbOrigGroupStart;
        li.removeAttribute("data-nmb-orig-group-start");
        li.style.removeProperty("--nmb-promoted");
    }
    _nextVisibleLi(el) {
        let next = el.nextElementSibling;
        while (next) {
            if (next.dataset?.hiddenBlocked !== "true" && next.dataset?.nmbGhost !== "true") {
                const tag = next.tagName?.toLowerCase();
                if (tag === "li" || next.className?.includes?.("messageListItem")) return next;
            }
            next = next.nextElementSibling;
        }
        return null;
    }
    _prevVisibleLi(el) {
        let prev = el.previousElementSibling;
        while (prev) {
            if (prev.dataset?.hiddenBlocked !== "true" && prev.dataset?.nmbGhost !== "true") {
                const tag = prev.tagName?.toLowerCase();
                if (tag === "li" || prev.className?.includes?.("messageListItem")) return prev;
            }
            prev = prev.previousElementSibling;
        }
        return null;
    }
    collapseGhostSlots() {
        const isEmptyText = el => !(el.textContent || "").trim();
        const lis = document.querySelectorAll('li[class*="messageListItem"]:not([data-hidden-blocked="true"]):not([data-nmb-ghost="true"])');
        const lisToGhost = [];
        for (let i = 0; i < lis.length; i++) {
            const el = lis[i];
            if (!isEmptyText(el)) continue;
            if (el.getClientRects().length === 0) continue;
            lisToGhost.push(el);
        }
        for (let i = 0; i < lisToGhost.length; i++) this._ghostHide(lisToGhost[i]);

        const WRP_SEL = '[class*="groupStart"] [class*="wrapper"], [class*="groupStart"] > [class*="cozy"]';
        const wrappers = document.querySelectorAll(WRP_SEL + ':not([data-hidden-blocked="true"]):not([data-nmb-ghost="true"])');
        const wrappersToGhost = [];
        for (let i = 0; i < wrappers.length; i++) {
            const el = wrappers[i];
            if (!isEmptyText(el)) continue;
            if (el.getClientRects().length === 0) continue;
            wrappersToGhost.push(el);
        }
        for (let i = 0; i < wrappersToGhost.length; i++) this._ghostHide(wrappersToGhost[i]);

        const groups = document.querySelectorAll('[class*="groupStart"]:not([data-nmb-ghost="true"])');
        const groupsToGhost = [];
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            if (group.tagName?.toLowerCase() === "li") continue;
            if (!isEmptyText(group)) continue;
            let hasVisible = false;
            for (const child of group.children) {
                if (child.dataset?.hiddenBlocked === "true" || child.dataset?.nmbGhost === "true") continue;
                if (child.offsetParent !== null || !isEmptyText(child)) {
                    hasVisible = true;
                    break;
                }
            }
            if (!hasVisible) groupsToGhost.push(group);
        }
        for (let i = 0; i < groupsToGhost.length; i++) this._ghostHide(groupsToGhost[i]);
    }
    _ghostHide(el) {
        el.dataset.nmbGhost = "true";
        if (!el.hasAttribute("data-nmb-prev-ghost-style")) {
            el.setAttribute("data-nmb-prev-ghost-style", el.getAttribute("style") || "");
        }
        el.style.cssText = `\n            display: none !important;\n            height: 0 !important;\n            min-height: 0 !important;\n            max-height: 0 !important;\n            padding: 0 !important;\n            margin: 0 !important;\n            overflow: hidden !important;\n            contain: size style !important;\n        `;
    }
    hidePinnedMessages() {
        if (!this.settings.places?.messages) return;
        const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
        const pinsItems = channelId ? this.modules.ChannelPinsStore?.getPins?.(channelId)?.items || [] : [];
        const pinCards = document.querySelectorAll('[data-list-item-id^="pins__"]');
        for (let i = 0; i < pinCards.length; i++) {
            const pinCard = pinCards[i];
            if (pinCard.dataset?.hiddenBlocked === "true") continue;
            const listId = pinCard.dataset?.listItemId || "";
            const pinMatch = listId.match(/^pins_+(\d{17,20})$/);
            const messageId = pinMatch ? pinMatch[1] : null;
            const userId = this.findUserId(pinCard);
            const pinItem = messageId && pinsItems.length ? pinsItems.find(item => item?.message?.id === messageId) || null : null;
            const shouldHideByAuthor = userId && this.shouldHide(userId);
            const shouldHideByPinner = messageId && this._shouldHidePinnedMessage(channelId, messageId, pinItem);
            if (!shouldHideByAuthor && !shouldHideByPinner) continue;
            this.hideElement(pinCard, shouldHideByAuthor ? "pin-author" : "pin-by-blocked", shouldHideByAuthor ? userId : false);
            const wrapper = pinCard.closest('[class*="messageGroupWrapper"]');
            if (wrapper && wrapper.dataset?.hiddenBlocked !== "true") {
                const siblingCards = Array.from(wrapper.querySelectorAll('[data-list-item-id^="pins__"]'));
                if (siblingCards.length > 0 && siblingCards.every(card => card.dataset?.hiddenBlocked === "true")) {
                    this.hideElement(wrapper, "pinned-panel-residue", false);
                }
            }
        }
        this.cleanupPinnedPanelResidue();
    }
    fixPinNotificationBadge() {
        if (!this.settings.places?.messages) return;
        const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
        if (!channelId) return;
        let showBadge = false;
        try {
            showBadge = !!this.modules.ReadStateStore?.hasUnreadPins?.(channelId);
        } catch (_) {}
        const pinButtons = document.querySelectorAll('[aria-label*="Pinned"], [aria-label*="fixad"], [aria-label*="Fixad"]');
        for (let i = 0; i < pinButtons.length; i++) {
            const btn = pinButtons[i];
            const badges = btn.querySelectorAll('[class*="iconBadge"], [class*="numberBadge"], [class*="lowerBadge"], [class*="base"] span[class*="badge"]');
            for (let j = 0; j < badges.length; j++) {
                const badge = badges[j];
                if (!showBadge) {
                    badge.dataset.nmbPinBadgeHidden = "true";
                } else if (badge.dataset?.nmbPinBadgeHidden === "true") {
                    delete badge.dataset.nmbPinBadgeHidden;
                }
            }
        }
    }
    hideMessages() {
        const LI_SEL = 'li[class*="messageListItem"]:not([data-hidden-blocked="true"])';
        const els = document.querySelectorAll(LI_SEL);
        if (!els.length) return;
        const parentSet = new Set;
        for (let i = 0; i < els.length; i++) {
            const messageRow = els[i];
            const info = this.getMessageInfo(messageRow);
            if (this.shouldHide(info.authorId, info.isSpammer)) {
                this.hideElement(messageRow, "message", info.authorId);
                const p = messageRow.parentElement;
                if (p && !p.dataset?.hiddenBlocked) parentSet.add(p);
                continue;
            }
            if (this.shouldHide(info.referencedAuthorId)) {
                this.hideElement(messageRow, "reply-to-blocked", info.referencedAuthorId);
                const p = messageRow.parentElement;
                if (p && !p.dataset?.hiddenBlocked) parentSet.add(p);
                continue;
            }
            if (info.isBlockedGroup) {
                this.hideElement(messageRow, "blocked-group");
                const p = messageRow.parentElement;
                if (p && !p.dataset?.hiddenBlocked) parentSet.add(p);
                continue;
            }
        }
        for (const parent of parentSet) {
            let hasVisible = false;
            for (const child of parent.children) {
                if (child.dataset?.hiddenBlocked !== "true" && child.offsetParent !== null) {
                    hasVisible = true;
                    break;
                }
            }
            if (!hasVisible) this.hideParent(parent, "empty-message-group");
        }
    }
    hideParent(el, reason = "empty-parent") {
        if (!el || el.dataset?.hiddenBlocked === "true") return;
        if (!el.hasAttribute("data-nmb-prev-style")) el.setAttribute("data-nmb-prev-style", el.getAttribute("style") || "");
        el.dataset.hiddenBlocked = "true";
        el.dataset.nmbReason = reason;
        this.hiddenParents.add(el);
        el.dataset.nmbParentHidden = "true";
    }
    restoreParent(el) {
        if (!el) return;
        const previous = el.getAttribute("data-nmb-prev-style");
        if (previous) el.setAttribute("style", previous); else el.removeAttribute("style");
        delete el.dataset.hiddenBlocked;
        delete el.dataset.nmbReason;
        delete el.dataset.nmbParentHidden;
        el.removeAttribute("data-nmb-prev-style");
        this.hiddenParents.delete(el);
    }
    restoreUnhiddenElements() {
        for (const el of Array.from(this.hiddenElements)) {
            if (!document.contains(el)) {
                this.hiddenElements.delete(el);
                continue;
            }
            const reason = el.dataset?.nmbReason;
            if (reason === "pin-by-blocked" || reason === "fast-pin-by-blocked") {
                const listId = el.dataset?.listItemId || "";
                const pinMatch = listId.match(/^pins_+(\d{17,20})$/);
                const messageId = pinMatch ? pinMatch[1] : null;
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                if (messageId && !this._shouldHidePinnedMessage(channelId, messageId, null)) {
                    this.restoreElement(el);
                }
                continue;
            }
            const userId = el.dataset?.nmbUserId;
            if (userId && !this.shouldHide(userId)) this.restoreElement(el);
        }
        for (const parent of Array.from(this.hiddenParents)) {
            if (!document.contains(parent)) {
                this.hiddenParents.delete(parent);
                continue;
            }
            const visibleChildren = Array.from(parent.children).filter(child => !child.dataset?.hiddenBlocked && child.offsetParent !== null);
            if (visibleChildren.length > 0) {
                this.restoreParent(parent);
            }
        }
        document.querySelectorAll('[data-nmb-ghost="true"]').forEach(slot => {
            const prev = slot.getAttribute("data-nmb-prev-ghost-style");
            if (prev) slot.setAttribute("style", prev); else slot.removeAttribute("style");
            delete slot.dataset.nmbGhost;
            slot.removeAttribute("data-nmb-prev-ghost-style");
        });
        document.querySelectorAll('[data-nmb-reactor-hidden="true"]').forEach(el => {
            const clickable = el.matches?.('[class*="reactorClickable_"]') ? el : el.querySelector('[class*="reactorClickable_"]');
            const userId = this.findUserId(clickable || el) || this.resolveReactorIdByName(clickable || el);
            if (!userId || !this.shouldHide(userId)) delete el.dataset.nmbReactorHidden;
        });
        document.querySelectorAll('[data-nmb-reactor-remove-hidden="true"]').forEach(btn => {
            const userId = this.resolveReactorIdFromRemoveButton(btn);
            if (!userId || !this.shouldHide(userId)) delete btn.dataset.nmbReactorRemoveHidden;
        });
        document.querySelectorAll('[data-nmb-reason="pinned-panel-residue"]').forEach(wrapper => {
            const pinCards = Array.from(wrapper.querySelectorAll('[data-list-item-id^="pins__"]'));
            const stillAllHidden = pinCards.length > 0 && pinCards.every(card => card.dataset?.hiddenBlocked === "true");
            if (!stillAllHidden) this.restoreElement(wrapper);
        });
        document.querySelectorAll(".nmb-pins-empty-placeholder").forEach(placeholder => {
            if (!document.contains(placeholder) || !document.contains(placeholder.parentElement)) {
                placeholder.remove();
            }
        });
        document.querySelectorAll(".nmb-pins-empty-footer").forEach(footer => {
            if (!document.contains(footer) || !document.contains(footer.parentElement)) {
                footer.remove();
            }
        });
    }
    restoreAllElements() {
        document.querySelectorAll('[data-nmb-promoted="true"]').forEach(el => {
            try {
                this._demoteMessage(el);
            } catch (_) {
                delete el.dataset.nmbPromoted;
                el.removeAttribute("data-nmb-promoted");
            }
        });
        document.querySelectorAll('[data-hidden-blocked="true"]').forEach(el => {
            if (el.dataset?.nmbParentHidden === "true") {
                this.restoreParent(el);
            } else {
                this.restoreElement(el);
            }
        });
        document.querySelectorAll("[data-nmb-prev-text]").forEach(el => this.restoreTemporaryText(el));
        document.querySelectorAll("[data-nmb-muted-voice]").forEach(row => this.restoreVoiceChannelIcon(row));
        document.querySelectorAll("[data-nmb-prev-icon-style]").forEach(icon => {
            const previous = icon.getAttribute("data-nmb-prev-icon-style");
            if (previous) icon.setAttribute("style", previous); else icon.removeAttribute("style");
            icon.removeAttribute("data-nmb-prev-icon-style");
        });
        document.querySelectorAll('[data-nmb-ghost="true"]').forEach(slot => {
            const prev = slot.getAttribute("data-nmb-prev-ghost-style");
            if (prev) slot.setAttribute("style", prev); else slot.removeAttribute("style");
            delete slot.dataset.nmbGhost;
            slot.removeAttribute("data-nmb-prev-ghost-style");
        });
        document.querySelectorAll('[data-nmb-sidebar-hidden="true"]').forEach(el => this._clearEventsSidebarOverlay(el));
        document.querySelectorAll('[data-nmb-orig-text]').forEach(el => el.removeAttribute("data-nmb-orig-text"));
        document.querySelectorAll(".nmb-pins-empty-placeholder").forEach(el => el.remove());
        document.querySelectorAll(".nmb-pins-empty-footer").forEach(el => el.remove());
        document.querySelectorAll("[data-nmb-prev-residue-style]").forEach(el => {
            const prev = el.getAttribute("data-nmb-prev-residue-style");
            if (prev) el.setAttribute("style", prev); else el.removeAttribute("style");
            el.removeAttribute("data-nmb-prev-residue-style");
        });
        document.querySelectorAll('[data-list-id="pins"], [data-list-id*="pins"]').forEach(root => {
            const scroller = root.closest('[class*="messagesPopout_"]') || root.parentElement;
            if (scroller) scroller.style.display = "";
            if (root.hasAttribute("data-nmb-prev-list-style")) {
                const prevListStyle = root.getAttribute("data-nmb-prev-list-style");
                if (prevListStyle) root.setAttribute("style", prevListStyle); else root.removeAttribute("style");
                root.removeAttribute("data-nmb-prev-list-style");
            } else {
                root.style.display = "";
            }
        });
        document.querySelectorAll(".nmb-injected-topic-empty").forEach(el => el.remove());
        document.querySelectorAll('[data-nmb-topic-scroller-hidden="true"]').forEach(scrollerContent => {
            const listRoot = scrollerContent.parentElement;
            this._restoreTopicPanelListLayout(listRoot, scrollerContent);
        });
        this.hiddenElements.clear();
        this.hiddenParents.clear();
    }
    hideVoiceUsers() {
        const els = document.querySelectorAll('[class*="voiceUser"]:not([data-hidden-blocked="true"]), [class*="voiceUsers"] [data-list-item-id]:not([data-hidden-blocked="true"]), [class*="listItem"][data-list-item-id]:not([data-hidden-blocked="true"])');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const userId = this.findUserId(el);
            if (!this.shouldHide(userId)) continue;
            const row = el.closest("li") || el;
            if (!this.isVoiceChannelShell(row)) this.hideElement(row, "voice-user", userId); else this.hideElement(el, "voice-user", userId);
        }
        this.fixVoiceCounters();
        this.hideStageUsers();
        this.fixStageAudienceCount();
        this.hideStageSpeakerRequests();
        this.hideBlockedStageNotice();
        this.hideActivityUsers();
        this.hideCallGridTiles();
    }
    hideCallGridTiles() {
        const els = document.querySelectorAll('[class*="tileSizer_"], [class*="tile_"], [class*="videoWrapper_"], [class*="voiceUserTile"], [class*="participants_"] > *, [class*="gridLayout_"] [class*="participant"], [class*="callContainer_"] [class*="wrapper_"], [class*="participantWrapper_"]');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (el.dataset?.hiddenBlocked === "true") continue;
            const userId = this.findUserId(el);
            if (!userId || !this.shouldHide(userId)) continue;
            const sizer = el.closest('[class*="tileSizer_"]');
            const tile = sizer || el.closest('[class*="tile_"]') || el.closest('[class*="participantWrapper_"]') || el.closest('[class*="videoWrapper_"]') || el;
            this.hideElement(tile, "call-grid-tile", userId);
        }
        this._injectCallGridInvitePlaceholder();
    }
    _injectCallGridInvitePlaceholder() {
        try {
            if (this._callGridPlaceholderCooldownUntil && Date.now() < this._callGridPlaceholderCooldownUntil) return;
            const existingPlaceholders = document.querySelectorAll('[data-nmb-invite-placeholder="true"]');
            for (let i = 0; i < existingPlaceholders.length; i++) {
                const ph = existingPlaceholders[i];
                const row = ph.closest('[class*="row_"]') || ph.parentElement;
                const stillHasHiddenTile = row && row.querySelector('[data-hidden-blocked="true"][data-nmb-reason="call-grid-tile"]');
                if (!stillHasHiddenTile) {
                    if (row) {
                        const orderedTile = row.querySelector('[class*="tile_"][style*="order"]');
                        if (orderedTile && orderedTile.style.order === "0") orderedTile.style.order = "";
                    }
                    ph.remove();
                }
            }
            const hiddenTiles = document.querySelectorAll('[data-hidden-blocked="true"][data-nmb-reason="call-grid-tile"]');
            if (!hiddenTiles.length) return;
            for (let i = 0; i < hiddenTiles.length; i++) {
                const hiddenTile = hiddenTiles[i];
                const row = hiddenTile.closest('[class*="row_"]') || hiddenTile.parentElement;
                if (!row) continue;
                if (row.querySelector('[data-nmb-invite-placeholder="true"]')) continue;
                const visibleTile = row.querySelector('[class*="tile_"]:not([data-hidden-blocked="true"])');
                if (!visibleTile) continue;
                const nativeSingleUserRoot = row.querySelector('[class*="singleUserRoot"]');
                if (nativeSingleUserRoot && !hiddenTile.contains(nativeSingleUserRoot)) continue;
                const now = Date.now();
                if (!this._callGridPlaceholderCreations || now - (this._callGridPlaceholderWindowStart || 0) > 3000) {
                    this._callGridPlaceholderCreations = 0;
                    this._callGridPlaceholderWindowStart = now;
                }
                this._callGridPlaceholderCreations++;
                if (this._callGridPlaceholderCreations > 8) {
                    this._callGridPlaceholderCooldownUntil = now + 10000;
                    return;
                }
                const clonedWidth = hiddenTile.getAttribute("data-nmb-prev-style") || "";
                const widthMatch = clonedWidth.match(/width:\s*([\d.]+px)/);
                const width = widthMatch ? widthMatch[1] : (visibleTile.style?.width || "100%");
                const placeholder = document.createElement("div");
                placeholder.setAttribute("data-nmb-invite-placeholder", "true");
                placeholder.className = hiddenTile.className;
                placeholder.style.width = width;
                placeholder.innerHTML = `
                    <div class="tileSizer_d6271c">
                        <div class="root__4ad81 singleUserRoot__4ad81 theme-dark theme-midnight images-dark disable-adaptive-theme tile__90dc5">
                            <img class="art__4ad81" alt="" src="/assets/664390de11a80444.svg">
                            <div data-align="center" data-justify="center" data-direction="horizontal" data-wrap="true" data-full-width="false" class="stack_dbd263" style="gap: var(--space-8); padding: var(--space-0);">
                                <button data-mana-component="button" role="button" class="button_a22cb0 md_a22cb0 secondary_a22cb0 hasText_a22cb0" type="button">
                                    <div class="buttonChildrenWrapper_a22cb0">
                                        <div class="buttonChildren_a22cb0">
                                            <svg class="icon_a22cb0" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M19 14a1 1 0 0 1 1 1v3h3a1 1 0 0 1 0 2h-3v3a1 1 0 0 1-2 0v-3h-3a1 1 0 1 1 0-2h3v-3a1 1 0 0 1 1-1Z" fill="currentColor"></path><path d="M16.83 12.93c.26-.27.26-.75-.08-.92A9.5 9.5 0 0 0 12.47 11h-.94A9.53 9.53 0 0 0 2 20.53c0 .81.66 1.47 1.47 1.47h.22c.24 0 .44-.17.5-.4.29-1.12.84-2.17 1.32-2.91.14-.21.43-.1.4.15l-.26 2.61c-.02.3.2.55.5.55h7.64c.12 0 .17-.31.06-.36C12.82 21.14 12 20.22 12 19a3 3 0 0 1 3-3h.5a.5.5 0 0 0 .5-.5V15c0-.8.31-1.53.83-2.07ZM12 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" fill="currentColor"></path></svg>
                                            <span class="lineClamp1__4bd52 text-md/medium_cf4812" data-text-variant="text-md/medium">Convidar para voz</span>
                                        </div>
                                    </div>
                                </button>
                                <button data-mana-component="button" role="button" class="button_a22cb0 md_a22cb0 secondary_a22cb0 hasText_a22cb0" type="button">
                                    <div class="buttonChildrenWrapper_a22cb0">
                                        <div class="buttonChildren_a22cb0">
                                            <svg class="icon_a22cb0" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="M2.06 7.61c-.25.95.31 1.92 1.26 2.18l4.3 1.15c.94.25 1.91-.31 2.17-1.26l1.15-4.3c.25-.94-.31-1.91-1.26-2.17l-4.3-1.15c-.94-.25-1.91.31-2.17 1.26l-1.15 4.3ZM12.98 7.87a2 2 0 0 0 1.75 2.95H20a2 2 0 0 0 1.76-2.95l-2.63-4.83a2 2 0 0 0-3.51 0l-2.63 4.83ZM5.86 13.27a.89.89 0 0 1 1.28 0l.75.77a.9.9 0 0 0 .54.26l1.06.12c.5.06.85.52.8 1.02l-.13 1.08c-.02.2.03.42.14.6l.56.92c.27.43.14 1-.28 1.26l-.9.58a.92.92 0 0 0-.37.48l-.36 1.02a.9.9 0 0 1-1.15.57l-1-.36a.89.89 0 0 0-.6 0l-1 .36a.9.9 0 0 1-1.15-.57l-.36-1.02a.92.92 0 0 0-.37-.48l-.9-.58a.93.93 0 0 1-.28-1.26l.56-.93c.11-.17.16-.38.14-.59l-.12-1.08c-.06-.5.3-.96.8-1.02l1.05-.12a.9.9 0 0 0 .54-.26l.75-.77ZM18.52 13.71a1.1 1.1 0 0 0-2.04 0l-.46 1.24c-.19.5-.57.88-1.07 1.07l-1.24.46a1.1 1.1 0 0 0 0 2.04l1.24.46c.5.19.88.57 1.07 1.07l.46 1.24c.35.95 1.7.95 2.04 0l.46-1.24c.19-.5.57-.88 1.07-1.07l1.24-.46a1.1 1.1 0 0 0 0-2.04l-1.24-.46a1.8 1.8 0 0 1-1.07-1.07l-.46-1.24Z"></path></svg>
                                            <span class="lineClamp1__4bd52 text-md/medium_cf4812" data-text-variant="text-md/medium">Escolher atividade</span>
                                        </div>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
                const inviteBtn = Array.from(placeholder.querySelectorAll("button")).find(b => /Convidar para voz|Invite to voice channel/i.test(b.textContent || ""));
                if (inviteBtn) {
                    inviteBtn.addEventListener("click", () => {
                        try {
                            this._openNativeInviteModal();
                        } catch (_) {}
                    });
                }
                const activityBtn = Array.from(placeholder.querySelectorAll("button")).find(b => /Escolher atividade|Choose an activity|Choose activity/i.test(b.textContent || ""));
                if (activityBtn) {
                    activityBtn.addEventListener("click", () => {
                        try {
                            if (!this._clickNativeActivityButton()) {
                                this.toast?.("Use o botÃ£o de atividades na barra da chamada para escolher uma atividade.", "info");
                            }
                        } catch (_) {}
                    });
                }
                if (!visibleTile.style.order) visibleTile.style.order = "0";
                placeholder.style.order = "1";
                hiddenTile.insertAdjacentElement("afterend", placeholder);
            }
        } catch (_) {}
    }
    _openNativeInviteModal() {
        try {
            const channelId = this.modules.SelectedChannelStore?.getVoiceChannelId?.() || this.modules.SelectedChannelStore?.getChannelId?.();

            if (this._inviteModalModule) {
                if (this._tryInviteModule(this._inviteModalModule, channelId)) return;
                this._inviteModalModule = null;
            }

            const nameFilters = [
                m => m && typeof m.openInviteModal === "function",
                m => m && typeof m.openInvitePopout === "function",
                m => m && typeof m.openInviteFriendsModal === "function",
                m => m && typeof m.inviteModalToggle === "function"
            ];
            for (const filter of nameFilters) {
                try {
                    const mod = this._wpGetModule(filter);
                    if (mod && this._tryInviteModule(mod, channelId)) {
                        this._inviteModalModule = mod;
                        return;
                    }
                } catch (_) {}
            }

            try {
                const bySource = this._wpGetModuleBySourceAny?.("openInviteModal", "INVITE_MODAL_OPEN", "openInvitePopout");
                if (bySource && this._tryInviteModule(bySource, channelId)) {
                    this._inviteModalModule = bySource;
                    return;
                }
            } catch (_) {}

            if (this._clickNativeInviteButton()) return;

            this.toast?.("NÃ£o encontrei o convite automÃ¡tico nessa versÃ£o do Discord. Abra pelo menu de participantes do canal.", "info");
        } catch (_) {
            try {
                this.toast?.("NÃ£o encontrei o convite automÃ¡tico nessa versÃ£o do Discord. Abra pelo menu de participantes do canal.", "info");
            } catch (_) {}
        }
    }
    _tryInviteModule(mod, channelId) {
        if (!mod || !channelId) return false;
        try {
            if (typeof mod.openInviteModal === "function") {
                mod.openInviteModal(channelId);
                return true;
            }
            if (typeof mod.openInvitePopout === "function") {
                mod.openInvitePopout(channelId);
                return true;
            }
            if (typeof mod.openInviteFriendsModal === "function") {
                mod.openInviteFriendsModal(channelId);
                return true;
            }
            if (typeof mod.inviteModalToggle === "function") {
                mod.inviteModalToggle(channelId);
                return true;
            }
        } catch (_) {}
        return false;
    }
    _clickNativeActivityButton() {
        try {
            const selectors = [
                '[aria-label="Atividades"]',
                '[aria-label="Activities"]',
                '[aria-label*="atividade" i]',
                '[aria-label*="activit" i]'
            ];
            for (const sel of selectors) {
                const btn = document.querySelector(sel);
                if (btn instanceof HTMLElement) {
                    btn.click();
                    return true;
                }
            }
        } catch (_) {}
        return false;
    }
    _clickNativeInviteButton() {
        try {
            const selectors = [
                '[aria-label="Convidar Pessoas"]',
                '[aria-label="Invite People"]',
                '[aria-label*="Convidar"]',
                '[aria-label*="Invite"][aria-label*="voice"]',
                '[aria-label*="Invite"][aria-label*="Voice"]'
            ];
            for (const sel of selectors) {
                const btn = document.querySelector(sel);
                if (btn instanceof HTMLElement) {
                    btn.click();
                    return true;
                }
            }
        } catch (_) {}
        return false;
    }
    hideStageUsers() {
        const els = document.querySelectorAll('[class*="stageUser_"], [class*="stageListener_"], [class*="stageSpeaker_"], [class*="participantRow_"], [class*="stageSection_"] [class*="user_"], [class*="stageSection_"] [data-list-item-id]');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (el.dataset?.hiddenBlocked === "true") continue;
            const userId = this.findUserId(el);
            if (userId && this.shouldHide(userId)) {
                this.hideElement(el, "stage-user", userId);
            }
        }
        const stageStore = this.modules.StageChannelParticipantStore;
        const guildId = this.modules.SelectedGuildStore?.getGuildId?.();
        const getStageParticipants = cid => {
            const orig = this.originalStageMethods?.getMutableParticipants;
            if (orig) {
                try { return orig(cid); } catch (_) {}
            }
            try { return stageStore?.getMutableParticipants?.(cid); } catch (_) {}
            return null;
        };
        const getGuildEvents = gid => {
            const orig = this.originalEventMethods?.getGuildScheduledEventsForGuild;
            if (orig) {
                try { return orig(gid); } catch (_) {}
            }
            return null;
        };
        if (stageStore) {
            const allChannels = document.querySelectorAll('[data-list-item-id^="channels___"]');
            for (let i = 0; i < allChannels.length; i++) {
                const link = allChannels[i];
                const match = link.getAttribute('data-list-item-id')?.match(/channels___(\d+)/);
                if (!match) continue;
                const cid = match[1];
                let hasBlockedParticipant = false;
                try {
                    const raw = getStageParticipants(cid);
                    if (raw) {
                        const list = Array.isArray(raw) ? raw : Object.values(raw);
                        hasBlockedParticipant = list.some(p => {
                            const uid = this.extractUserId(p);
                            return uid && this.shouldHide(uid);
                        });
                    }
                } catch (_) {}
                if (!hasBlockedParticipant && guildId) {
                    try {
                        const events = getGuildEvents(guildId);
                        if (events) {
                            const evList = Array.isArray(events) ? events : Object.values(events);
                            hasBlockedParticipant = evList.some(ev => {
                                if (String(ev.channel_id) !== cid && String(ev.channelId) !== cid) return false;
                                const creatorId = ev.creatorId || ev.creator_id || ev.creator?.id;
                                return creatorId && this.shouldHide(String(creatorId));
                            });
                        }
                    } catch (_) {}
                }
                if (hasBlockedParticipant) {
                    const subtitle = link.querySelector('[class*="subtitle__"]');
                    if (subtitle && subtitle.textContent.trim()) {
                        subtitle.textContent = "";
                    }
                }
            }
        }
    }
    fixStageAudienceCount() {
        try {
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            const stageStore = this.modules.StageChannelParticipantStore;
            let correctCount = null;
            if (channelId && stageStore) {
                try {
                    const isSpeaker = p => p && (p.role === "speaker" || p.type === "speaker" || p.speaker === true);
                    const audience = stageStore.getAudience?.(channelId) ?? stageStore.getListeners?.(channelId);
                    if (audience) {
                        const list = Array.isArray(audience) ? audience : Object.values(audience);
                        correctCount = list.filter(p => {
                            const uid = this.extractUserId(p);
                            return !uid || !this.shouldHide(uid);
                        }).length;
                    } else {
                        const all = stageStore.getMutableParticipants?.(channelId);
                        if (all) {
                            const list = Array.isArray(all) ? all : Object.values(all);
                            correctCount = list.filter(p => {
                                if (isSpeaker(p)) return false;
                                const uid = this.extractUserId(p);
                                return !uid || !this.shouldHide(uid);
                            }).length;
                        }
                    }
                } catch (_) {}
            }
            if (correctCount === null) return;

            const replaceNum = (el, val) => { el.textContent = el.textContent.replace(/\d+/, String(val)); };
            const hasNum = el => /\d/.test(el.textContent);

            const containers = document.querySelectorAll('[class*="audienceContainer__"]');
            for (let i = 0; i < containers.length; i++) {
                const c = containers[i];
                const textEl = c.querySelector('[data-text-variant]') || c.querySelector('[class*="text-sm/medium"]');
                if (!textEl || !hasNum(textEl)) continue;
                if (correctCount === 0) {
                    c.style.display = "none";
                } else {
                    replaceNum(textEl, correctCount);
                    if (c.style.display === "none") c.style.display = "";
                }
            }

            const stageRoots = document.querySelectorAll('[class*="stageSection_"], [class*="audienceContainer_"]');
            for (let r = 0; r < stageRoots.length; r++) {
                const details = stageRoots[r].querySelectorAll('[class*="details_"]');
                for (let i = 0; i < details.length; i++) {
                    if (hasNum(details[i])) replaceNum(details[i], correctCount);
                }
            }

            const h1List = document.querySelectorAll('h1');
            for (let i = 0; i < h1List.length; i++) {
                const counts = h1List[i].querySelectorAll('[class*="speakerCount__"]');
                if (counts.length >= 2 && hasNum(counts[1])) {
                    replaceNum(counts[1], correctCount);
                }
            }

            const headers = document.querySelectorAll('[class*="text__9aed4"]');
            for (let i = 0; i < headers.length; i++) {
                if (hasNum(headers[i]) && /[\u2014\u2013-]/.test(headers[i].textContent)) {
                    replaceNum(headers[i], correctCount);
                }
            }
        } catch (_) {}
    }
    hideStageSpeakerRequests() {
        try {
            const headingRe = /^(Pedidos para falar|Requests to Speak)(\s*[â€”-]\s*\d+)?$/i;
            const t = _locale(_getLocale(), ByeBlocked.STAGE_LOCALE);
            const headings = document.querySelectorAll('[class*="listTitle__"]');
            let anyPanelProcessed = false;
            let totalVisible = 0;
            for (let h = 0; h < headings.length; h++) {
                const heading = headings[h];
                const text = (heading.textContent || "").trim();
                const match = text.match(headingRe);
                if (!match) continue;
                const baseLabel = match[1];
                const panel = heading.closest('[class*="content"]') || heading.parentElement;
                if (!panel) continue;
                anyPanelProcessed = true;
                const nativeEmpty = panel.querySelector('[class*="emptyStateContainer__"]');
                if (nativeEmpty && !nativeEmpty.dataset.nmbInjected) continue;
                const rowContainers = panel.querySelectorAll('[class*="participantRowContainer__"]');
                let anyHidden = false;
                let visible = 0;
                for (let i = 0; i < rowContainers.length; i++) {
                    const rowContainer = rowContainers[i];
                    const member = rowContainer.querySelector('[class*="participantMemberContainer__"]') || rowContainer;
                    if (rowContainer.dataset?.hiddenBlocked === "true") { anyHidden = true; continue; }
                    const userId = this.findUserId(member);
                    if (userId && this.shouldHide(userId)) {
                        this.hideElement(rowContainer, "stage-speaker-request", userId);
                        anyHidden = true;
                    } else {
                        visible++;
                    }
                }
                totalVisible += visible;
                if (!anyHidden) continue;
                if (visible > 0) {
                    heading.textContent = `${baseLabel} - ${visible}`;
                    if (nativeEmpty?.dataset.nmbInjected) nativeEmpty.remove();
                    continue;
                }
                heading.textContent = baseLabel;
                let placeholder = panel.querySelector('[data-nmb-injected="true"]');
                if (!placeholder) {
                    placeholder = document.createElement("div");
                    placeholder.className = "emptyStateContainer__664ff";
                    placeholder.dataset.nmbInjected = "true";
                    placeholder.innerHTML = `<img alt="" class="sparkleIcon__05cdc sparkleBottom__05cdc" src="/assets/3a6a08a976f34e04.svg">
                        <div class="background__506d9">
                            <svg class="foreground__506d9" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M19.61 18.25a1.08 1.08 0 0 1-.07-1.33 9 9 0 1 0-15.07 0c.26.42.25.97-.08 1.33l-.02.02c-.41.44-1.12.43-1.46-.07a11 11 0 1 1 18.17 0c-.33.5-1.04.51-1.45.07l-.02-.02Z"></path>
                                <path fill="currentColor" d="M16.83 15.23c.43.47 1.18.42 1.45-.14a7 7 0 1 0-12.57 0c.28.56 1.03.6 1.46.14l.05-.06c.3-.33.35-.81.17-1.23A4.98 4.98 0 0 1 12 7a5 5 0 0 1 4.6 6.94c-.17.42-.13.9.18 1.23l.05.06Z"></path>
                                <path fill="currentColor" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM6.33 20.03c-.25.72.12 1.5.8 1.84a10.96 10.96 0 0 0 9.73 0 1.52 1.52 0 0 0 .8-1.84 6 6 0 0 0-11.33 0Z"></path>
                            </svg>
                        </div>
                        <img alt="" class="sparkleIcon__05cdc sparkleTop__05cdc" src="/assets/30d1720360dd2c40.svg">
                        <div class="text-lg/semibold_cf4812 emptyStateTitle__664ff" data-text-variant="text-lg/semibold" style="color: var(--text-strong);">${t.title}</div>
                        <div class="text-sm/normal_cf4812 emptyStateBody__664ff" data-text-variant="text-sm/normal" style="color: var(--text-default);">${t.body}</div>`;
                    heading.insertAdjacentElement("afterend", placeholder);
                }
            }
            const setHandBadgeCount = (badge, count) => {
                const iconContainer = badge.closest('[class*="raisedHandIcon_"]') || badge.parentElement;
                const svg = iconContainer ? iconContainer.querySelector("svg") : null;
                if (count > 0) {
                    if (badge.dataset.nmbHandOverride === "empty") {
                        const prevStyle = badge.getAttribute("data-nmb-hand-prev-style");
                        if (prevStyle) badge.setAttribute("style", prevStyle); else badge.removeAttribute("style");
                        badge.removeAttribute("data-nmb-hand-prev-style");
                        delete badge.dataset.nmbHandOverride;
                    }
                    badge.textContent = String(count);
                    if (svg) this._restoreHandIconMaskCutout(svg);
                } else {
                    if (badge.dataset.nmbHandOverride !== "empty") {
                        badge.setAttribute("data-nmb-hand-prev-style", badge.getAttribute("style") || "");
                    }
                    badge.textContent = "";
                    badge.style.setProperty("display", "none", "important");
                    badge.dataset.nmbHandOverride = "empty";
                    if (svg) this._fixHandIconMaskCutout(svg);
                }
            };
            const badges = document.querySelectorAll('[class*="raisedHandCount__"]');
            if (anyPanelProcessed) {
                for (let b = 0; b < badges.length; b++) setHandBadgeCount(badges[b], totalVisible);
            } else {
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                let storeVisible = 0;
                if (channelId && this.modules.StageChannelParticipantStore) {
                    try {
                        const participants = this.modules.StageChannelParticipantStore.getMutableParticipants?.(channelId);
                        const list = Array.isArray(participants) ? participants : (participants && typeof participants === "object" ? Object.values(participants) : []);
                        const nonBlocked = list.filter(p => {
                            const uid = this.extractUserId(p);
                            return !uid || !this.shouldHide(uid);
                        });
                        const requesters = nonBlocked.filter(p => {
                            if (!p) return false;
                            if (p.voiceState?.requestToSpeakTimestamp) return true;
                            if (p.requestToSpeakTimestamp) return true;
                            return false;
                        });
                        storeVisible = requesters.length;
                    } catch (_) {}
                }
                for (let b = 0; b < badges.length; b++) setHandBadgeCount(badges[b], storeVisible);
            }
        } catch (_) {}
    }
    hideBlockedStageNotice() {
        const notices = document.querySelectorAll('[class*="blockedNotice__"], [class*="blockedUsersContainer__"]');
        for (let i = 0; i < notices.length; i++) {
            const container = notices[i].closest('[class*="blockedUsersContainer__"]') || notices[i];
            if (container.style.display !== "none") {
                container.style.display = "none";
            }
        }
    }
    hideActivityUsers() {
        const els = document.querySelectorAll('[class*="activityPanel_"] [data-list-item-id], [class*="activityPanel_"] [class*="participant_"], [class*="activityPanel_"] [class*="user_"], [class*="streamPreview_"], [class*="streamTile_"], [class*="stream_"] [class*="user_"], [class*="activity_"] [class*="member_"], [class*="embeddedActivity_"] [class*="user_"], [class*="nowPlaying_"] [class*="user_"]');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (el.dataset?.hiddenBlocked === "true") continue;
            const userId = this.findUserId(el);
            if (userId && this.shouldHide(userId)) {
                this.hideElement(el, "activity-user", userId);
            }
        }
    }
    hideMemberRows() {
        const els = document.querySelectorAll('[data-list-item-id]:not([data-hidden-blocked="true"]), [class*="member-"]:not([data-hidden-blocked="true"]), [class*="member_"]:not([data-hidden-blocked="true"]), [class*="memberRow"]:not([data-hidden-blocked="true"])');
        if (this._memberListRowPatched) {
            for (let i = 0; i < els.length; i++) {
                const el = els[i];
                if (el.closest?.('[data-list-id^="members-"]')) continue;
                const userId = this.findUserId(el);
                if (!this.shouldHide(userId)) continue;
                const row = el.closest("[data-list-item-id]") || el.closest('[class*="memberRow"]') || el;
                this.hideElement(row, row.matches?.('[class*="memberRow"]') ? "guild-members-page" : "member", userId);
            }
        } else {
            for (let i = 0; i < els.length; i++) {
                const el = els[i];
                const userId = this.findUserId(el);
                if (!this.shouldHide(userId)) continue;
                const row = el.closest("[data-list-item-id]") || el.closest('[class*="memberRow"]') || el;
                this.hideElement(row, row.matches?.('[class*="memberRow"]') ? "guild-members-page" : "member", userId);
            }
        }
        this.fixGuildMembersPageCount();
    }
    _buildEventsEmptySkeletonHtml() {
        const t = _locale(_getLocale(), ByeBlocked.EVENTS_LOCALE);
        return `<div class="nmb-injected-events-empty container__710ee">\n                    <img alt="" class="sparkleIcon__05cdc sparkleBottom__05cdc" src="/assets/3a6a08a976f34e04.svg">\n                    <div class="circle__710ee">\n                        <svg class="icon__710ee" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="none" viewBox="0 0 24 24">\n                            <path fill="currentColor" d="M7 1a1 1 0 0 1 1 1v.75c0 .14.11.25.25.25h7.5c.14 0 .25-.11.25-.25V2a1 1 0 1 1 2 0v.75c0 .14.11.25.25.25H19a3 3 0 0 1 3 3 1 1 0 0 1-1 1H3a1 1 0 0 1-1-1 3 3 0 0 1 3-3h.75c.14 0 .25-.11.25-.25V2a1 1 0 0 1 1-1Z"></path>\n                            <path fill="currentColor" fill-rule="evenodd" d="M2 10a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-9Zm3.5 2a.5.5 0 0 0-.5.5v3c0 .28.22.5.5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3Z" clip-rule="evenodd"></path>\n                        </svg>\n                    </div>\n                    <img alt="" class="sparkleIcon__05cdc sparkleTop__05cdc" src="/assets/30d1720360dd2c40.svg">\n                    <h2 class="heading-xl/semibold_cf4812 defaultColor__5345c title__710ee" data-text-variant="heading-xl/semibold" style="color: var(--text-strong);">${t.title}</h2>\n                    <div class="text-sm/normal_cf4812 subtitle__710ee" data-text-variant="text-sm/normal" style="color: var(--text-default);">${t.subtitle}</div>\n                    <div class="text-sm/normal_cf4812 roleTip__710ee" data-text-variant="text-sm/normal" style="color: var(--text-default);">${t.tip_prefix}<strong><a class="anchor_edefb8 anchorUnderlineOnHover_edefb8" role="link" tabindex="0" data-nmb-open-role-settings="true">${t.tip_link}</a></strong>.</div>\n                </div>`;
    }
    hideBlockedEvents() {
        const containers = new Set;
        const cards = document.querySelectorAll('[class*="card__"]');
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const creatorEl = card.querySelector('[class*="creator_"]');
            if (!creatorEl) continue;
            const container = card.closest('[class*="content__49fc1"], [class*="content_d0b769"]') || card.parentElement;
            if (container) containers.add(container);
            if (card.dataset?.hiddenBlocked === "true") continue;
            const userId = this.resolveEventCreatorId(card);
            if (userId && this.shouldHide(userId)) {
                this.hideElement(card, "guild-event", userId);
            }
        }
        for (const container of containers) this._fixEmptyEventsPopoverState(container);
        for (const existingLi of document.querySelectorAll('li:has([data-list-item-id^="channels___upcoming-events-"])')) {
            if (!existingLi.querySelector('[data-nmb-events-ready="true"]')) {
                existingLi.dataset.nmbSidebarPreHidden = "true";
                existingLi.style.visibility = 'hidden';
            }
        }
        this._fixEventsSidebarCounter();
        this.hideSidebarEventItems();
        this._closeBlockedEventModalIfOpen();
    }
    _fixEmptyEventsPopoverState(container) {
        if (!container) return;
        const cards = container.querySelectorAll('[class*="card__"]');
        let visible = 0;
        let hiddenBlocked = 0;
        for (let i = 0; i < cards.length; i++) {
            if (cards[i].dataset?.hiddenBlocked === "true") hiddenBlocked++; else visible++;
        }
        let skeleton = container.querySelector(":scope > .nmb-injected-events-empty");
        if (visible === 0 && hiddenBlocked > 0) {
            if (!skeleton) {
                container.insertAdjacentHTML("beforeend", this._buildEventsEmptySkeletonHtml());
            }
        } else if (skeleton) {
            skeleton.remove();
        }
        this._fixEventsPopoverHeaderCount(container, visible, hiddenBlocked);
    }
    _fixEventsPopoverHeaderCount(container, visible, hiddenBlocked) {
        const root = container.closest('[class*="root__49fc1"]') || container.parentElement;
        if (!root) return;
        const heading = root.querySelector('h1[id], [class*="header__49fc1"] h1');
        if (!heading) return;
        if (!heading.hasAttribute("data-nmb-orig-text")) {
            heading.setAttribute("data-nmb-orig-text", heading.textContent || "");
        }
        const originalText = heading.getAttribute("data-nmb-orig-text");
        const genericLabel = originalText.replace(/\d+/, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim() || originalText;
        let desired;
        if (visible === 0 && hiddenBlocked > 0) {
            desired = genericLabel;
        } else {
            const match = originalText.match(/\d+/);
            if (!match) {
                this._clearEventsHeaderOverlay(heading);
                return;
            }
            const originalNumber = parseInt(match[0], 10);
            const realNumber = Math.max(0, originalNumber - hiddenBlocked);
            desired = realNumber > 0 ? originalText.replace(/\d+/, realNumber) : genericLabel;
        }
        if (desired === originalText) {
            this._clearEventsHeaderOverlay(heading);
            return;
        }
        this._applyEventsHeaderOverlay(heading, desired);
    }
    _applyEventsHeaderOverlay(heading, desired) {
        if (!heading.hasAttribute("data-nmb-header-hidden")) {
            const computed = getComputedStyle(heading);
            heading.style.setProperty("--nmb-header-restore-size", computed.fontSize);
            heading.style.setProperty("--nmb-header-restore-line-height", computed.lineHeight);
        }
        let overlay = heading.querySelector(':scope > [data-nmb-header-overlay="true"]');
        if (!overlay) {
            overlay = document.createElement("span");
            overlay.setAttribute("data-nmb-header-overlay", "true");
            overlay.setAttribute("aria-hidden", "true");
            heading.appendChild(overlay);
        }
        if (overlay.textContent !== desired) overlay.textContent = desired;
        heading.setAttribute("data-nmb-header-hidden", "true");
    }
    _clearEventsHeaderOverlay(heading) {
        const overlay = heading.querySelector(':scope > [data-nmb-header-overlay="true"]');
        overlay?.remove();
        heading.removeAttribute("data-nmb-header-hidden");
        heading.style.removeProperty("--nmb-header-restore-size");
        heading.style.removeProperty("--nmb-header-restore-line-height");
    }
    _getTextExcludingOverlay(el) {
        if (!el) return "";
        let text = "";
        for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                text += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE && !child.hasAttribute("data-nmb-sidebar-overlay")) {
                text += child.textContent;
            }
        }
        return text.replace(/\s+/g, " ").trim();
    }
    _applyEventsSidebarOverlay(nameEl, desiredText) {
        if (!nameEl.hasAttribute("data-nmb-sidebar-hidden")) {
            const cs = getComputedStyle(nameEl);
            nameEl.style.setProperty("--nmb-sidebar-color", cs.color);
        }
        nameEl.style.setProperty("position", "relative", "important");
        let overlay = nameEl.querySelector(':scope > [data-nmb-sidebar-overlay="true"]');
        if (overlay) {
            if (overlay.textContent !== desiredText) overlay.textContent = desiredText;
        } else {
            const color = nameEl.style.getPropertyValue("--nmb-sidebar-color") || "#fff";
            overlay = document.createElement("span");
            overlay.setAttribute("data-nmb-sidebar-overlay", "true");
            overlay.setAttribute("aria-hidden", "true");
            overlay.style.cssText = `\n                position: absolute !important;\n                inset: 0 !important;\n                pointer-events: none !important;\n                z-index: 1 !important;\n                overflow: hidden !important;\n                white-space: nowrap !important;\n                text-overflow: ellipsis !important;\n                visibility: visible !important;\n                color: ${color} !important;\n            `;
            overlay.textContent = desiredText;
            nameEl.appendChild(overlay);
        }
        nameEl.style.setProperty("color", "transparent", "important");
        nameEl.setAttribute("data-nmb-sidebar-hidden", "true");
    }
    _clearEventsSidebarOverlay(nameEl) {
        if (!nameEl) return;
        const overlay = nameEl.querySelector(':scope > [data-nmb-sidebar-overlay="true"]');
        overlay?.remove();
        nameEl.removeAttribute("data-nmb-sidebar-hidden");
        nameEl.style.removeProperty("--nmb-sidebar-color");
        nameEl.style.removeProperty("color");
        nameEl.style.removeProperty("position");
    }
    _fixEventsSidebarCounter() {
        const items = document.querySelectorAll('nav [role="listitem"], nav a, nav div[role="button"], nav [class*="link__"], nav [class*="basicChannelRowLink"]');
        const eventRegex = /\d+.*(?:event|evento|Ã©vÃ©nement)|(?:event|evento|Ã©vÃ©nement).*\d+/i;
        const seenNameEls = new Set;
        for (let i = 0; i < items.length; i++) {
            this._processEventsSidebarItem(items[i], eventRegex, seenNameEls);
        }
    }
    _fixEventsSidebarCounterFor(focusItem) {
        if (!focusItem) return;
        const eventRegex = /\d+.*(?:event|evento|Ã©vÃ©nement)|(?:event|evento|Ã©vÃ©nement).*\d+/i;
        const item = focusItem.matches?.('[role="listitem"], a, div[role="button"], [class*="link__"], [class*="basicChannelRowLink"]') ? focusItem : focusItem.querySelector?.('[role="listitem"], a, div[role="button"], [class*="link__"], [class*="basicChannelRowLink"]') || focusItem;
        this._processEventsSidebarItem(item, eventRegex, null);
    }
    _processEventsSidebarItem(item, eventRegex, seenNameEls) {
        if (!item) return;
        if (item.querySelector('[class*="card__"], [class*="content__49fc1"]')) return;
        const nameEl = item.querySelector('[class*="name__"]');
        if (!nameEl) return;
        const _processEventsLi = item.closest('li');
        const currentText = this._getTextExcludingOverlay(nameEl);
        const isEventText = eventRegex.test(currentText);
        const hasOrigText = nameEl.hasAttribute("data-nmb-orig-text");
        const origText = hasOrigText ? nameEl.getAttribute("data-nmb-orig-text") : "";
        const hasOverlay = nameEl.querySelector(':scope > [data-nmb-sidebar-overlay="true"]');
        if (isEventText) {
            if (!hasOrigText || (currentText !== origText && origText)) {
                nameEl.setAttribute("data-nmb-orig-text", currentText);
            }
        } else if (!hasOrigText) {
            if (hasOverlay) this._clearEventsSidebarOverlay(nameEl);
            this._setEventsReadyAndUnhide(nameEl, _processEventsLi);
            return;
        } else if (!eventRegex.test(origText)) {
            if (hasOverlay) this._clearEventsSidebarOverlay(nameEl);
            this._setEventsReadyAndUnhide(nameEl, _processEventsLi);
            return;
        }
        if (seenNameEls) {
            if (seenNameEls.has(nameEl)) return;
            seenNameEls.add(nameEl);
        }
        const storedOrigText = nameEl.getAttribute("data-nmb-orig-text");
        const totalEvents = this._countKnownGuildEvents();
        const hiddenEvents = this._countHiddenGuildEvents();
        if (totalEvents === null) {
            nameEl.removeAttribute("data-nmb-events-ready");
            if (hasOverlay || nameEl.querySelector(':scope > [data-nmb-sidebar-overlay="true"]')) this._clearEventsSidebarOverlay(nameEl);
            const firstSeenAt = nameEl.hasAttribute("data-nmb-events-pending-since") ? parseInt(nameEl.getAttribute("data-nmb-events-pending-since"), 10) : Date.now();
            if (!nameEl.hasAttribute("data-nmb-events-pending-since")) nameEl.setAttribute("data-nmb-events-pending-since", String(firstSeenAt));
            if (Date.now() - firstSeenAt > 5000) this._setEventsReadyAndUnhide(nameEl, _processEventsLi);
            return;
        }
        nameEl.removeAttribute("data-nmb-events-pending-since");
        const row = item.closest('[class*="wrapper__2ea32"]') || item.parentElement;
        const badgeEl = row ? row.querySelector('[class*="numberBadge__"]') : null;
        const unreadEl = row ? row.querySelector('[class*="unread__"][class*="unreadImportant__"], [class*="unreadImportant__"]') : null;
        const genericLabel = storedOrigText.replace(/\d+/, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim() || storedOrigText;
        const visibleEvents = totalEvents - hiddenEvents;
        if (visibleEvents <= 0) {
            if (_processEventsLi) {
                this.hideElement(_processEventsLi, "events-tab-all-blocked", false);
            } else {
                this._applyEventsSidebarOverlay(nameEl, genericLabel);
                if (badgeEl) this.hideElement(badgeEl, "events-sidebar-badge");
                if (unreadEl) this.hideElement(unreadEl, "events-sidebar-unread");
            }
            this._setEventsReadyAndUnhide(nameEl, null);
            return;
        }
        if (_processEventsLi?.dataset?.hiddenBlocked === "true") this.restoreElement(_processEventsLi);
        if (hiddenEvents === 0) {
            if (nameEl.querySelector(':scope > [data-nmb-sidebar-overlay="true"]')) this._clearEventsSidebarOverlay(nameEl);
            if (badgeEl && badgeEl.dataset?.hiddenBlocked === "true") this.restoreElement(badgeEl);
            if (unreadEl && unreadEl.dataset?.hiddenBlocked === "true") this.restoreElement(unreadEl);
            this._setEventsReadyAndUnhide(nameEl, _processEventsLi);
            return;
        }
        if (badgeEl && badgeEl.dataset?.hiddenBlocked === "true") this.restoreElement(badgeEl);
        if (unreadEl && unreadEl.dataset?.hiddenBlocked === "true") this.restoreElement(unreadEl);
        const match = storedOrigText.match(/\d+/);
        if (match) {
            const originalNumber = parseInt(match[0], 10);
            const realNumber = Math.max(0, originalNumber - hiddenEvents);
            const desired = realNumber > 0 ? storedOrigText.replace(/\d+/, realNumber) : genericLabel;
            this._applyEventsSidebarOverlay(nameEl, desired);
            if (badgeEl && realNumber !== originalNumber) {
                const badgeText = realNumber > 0 ? String(realNumber) : "";
                if (badgeEl.textContent !== badgeText) badgeEl.textContent = badgeText;
            }
        }
        this._setEventsReadyAndUnhide(nameEl, _processEventsLi);
    }
    _setEventsReadyAndUnhide(nameEl, li) {
        nameEl.setAttribute("data-nmb-events-ready", "true");
        if (li && li.dataset?.nmbSidebarPreHidden === "true") {
            delete li.dataset.nmbSidebarPreHidden;
            li.style.visibility = '';
        }
    }
    _countKnownGuildEvents() {
        const fromStore = this._getGuildEventsFromStore();
        if (fromStore) return fromStore.total;
        const cards = document.querySelectorAll('[class*="card__"]');
        let count = 0;
        let any = false;
        for (let i = 0; i < cards.length; i++) {
            if (!cards[i].querySelector('[class*="creator_"]')) continue;
            any = true;
            count++;
        }
        return any ? count : null;
    }
    _countHiddenGuildEvents() {
        const fromStore = this._getGuildEventsFromStore();
        if (fromStore) return fromStore.hidden;
        const cards = document.querySelectorAll('[class*="card__"][data-hidden-blocked="true"]');
        let count = 0;
        for (let i = 0; i < cards.length; i++) {
            if (cards[i].querySelector('[class*="creator_"]')) count++;
        }
        return count;
    }
    _getGuildEventsFromStore() {
        const store = this.modules.GuildScheduledEventStore;
        const guildId = this.modules.SelectedGuildStore?.getGuildId?.();
        if (!store || !guildId) return null;
        try {
            const getters = [ "getEvents", "getGuildScheduledEventsForGuild", "getEventsForGuild" ];
            let events = null;
            for (const name of getters) {
                if (typeof store[name] === "function") {
                    events = store[name](guildId);
                    if (events) break;
                }
            }
            if (!events) return null;
            const list = Array.isArray(events) ? events : Object.values(events);
            const upcoming = list.filter(ev => {
                const status = ev?.status;
                return status === undefined || status === 1 || status === 2 || status === "SCHEDULED" || status === "ACTIVE";
            });
            let hidden = 0;
            for (const ev of upcoming) {
                const creatorId = ev?.creatorId || ev?.creator_id || ev?.creator?.id;
                if (creatorId && this.shouldHide(String(creatorId))) hidden++;
            }
            return {
                total: upcoming.length,
                hidden: hidden
            };
        } catch (_) {
            return null;
        }
    }
    resolveEventCreatorId(scope) {
        if (!scope) return null;
        const hiddenSpans = scope.querySelectorAll('[class*="hiddenVisually"]');
        for (let i = 0; i < hiddenSpans.length; i++) {
            const text = (hiddenSpans[i].textContent || "").trim();
            const match = text.match(/(?:criada?\s+por|created\s+by)\s*:?\s*(.+)$/i);
            if (match?.[1]) {
                const id = this.resolveUserIdByName(match[1].trim());
                if (id) return id;
            }
        }
        const creatorEl = scope.querySelector('[class*="creator_"][aria-label], [class*="creator__"][aria-label]');
        const ariaLabel = creatorEl?.getAttribute("aria-label");
        if (ariaLabel) {
            const id = this.resolveUserIdByName(ariaLabel.trim());
            if (id) return id;
        }
        const nameEl = scope.querySelector('[class*="creator__"] [class*="name__"], [class*="creator_"] [class*="name__"]');
        if (nameEl) {
            const id = this.resolveUserIdByName((nameEl.textContent || "").trim());
            if (id) return id;
        }
        return this.findEventCreatorId(scope);
    }
    resolveUserIdByName(name) {
        if (!name) return null;
        if (/^\d{17,20}$/.test(name)) return name;
        const UserStore = this.modules.UserStore;
        if (!UserStore || typeof UserStore.getUsers !== "function") return null;
        const target = name.toLowerCase();
        const users = UserStore.getUsers();
        for (const id in users) {
            const u = users[id];
            const names = [ u?.username, u?.globalName, u?.displayName ].filter(Boolean).map(n => String(n).trim().toLowerCase());
            if (names.includes(target)) return String(id);
        }
        return null;
    }
    findEventCreatorId(el) {
        if (!el) return null;
        let found = null;
        this.walkFiberProps(el, props => {
            if (found) return;
            const direct = this.extractUserId(props);
            if (direct) { found = direct; return; }
            const event = props?.guildScheduledEvent || props?.event || props?.scheduledEvent;
            if (event) {
                const nested = event.creatorId || event.creator_id || event.creator?.id;
                if (nested && /^\d{17,20}$/.test(String(nested))) found = String(nested);
            }
        }, 14);
        return found;
    }
    _closeBlockedEventModalIfOpen() {
        const dialogs = document.querySelectorAll('[data-mana-component="modal"]');
        for (let i = 0; i < dialogs.length; i++) {
            const dialog = dialogs[i];
            if (dialog.dataset?.nmbEventChecked === "true") continue;
            const hasEventDetailsFooter = dialog.querySelector('[class*="actionBar__"]') && dialog.querySelector('[class*="creator__"]');
            if (!hasEventDetailsFooter) continue;
            dialog.dataset.nmbEventChecked = "true";
            const userId = this.resolveEventCreatorId(dialog);
            if (userId && this.shouldHide(userId)) {
                const closeBtn = dialog.querySelector('button[aria-label="Close"], button[aria-label="Fechar"], [aria-label="Close"][role="button"], [aria-label="Fechar"][role="button"]');
                if (closeBtn) {
                    closeBtn.click();
                    this.toast("ðŸš« Este evento foi criado por um usuÃ¡rio bloqueado.", "info");
                }
            }
        }
    }
    hideSidebarEventItems() {
        const items = document.querySelectorAll('[data-list-item-id^="channels___guild_scheduled_event-"]');
        if (!items.length) return;
        const store = this.modules.GuildScheduledEventStore;
        const guildId = this.modules.SelectedGuildStore?.getGuildId?.();
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.dataset?.hiddenBlocked === "true") continue;
            const listId = item.dataset?.listItemId || "";
            const eventId = listId.replace(/^channels___guild_scheduled_event-/, "");
            if (!eventId || !/^\d{17,20}$/.test(eventId)) continue;
            if (store && guildId) {
                try {
                    const ev = store.getEvent?.(guildId, eventId) || store.getGuildScheduledEvent?.(eventId);
                    const creatorId = ev?.creatorId || ev?.creator_id || ev?.creator?.id;
                    if (creatorId && this.shouldHide(String(creatorId))) {
                        this.hideElement(item, "sidebar-event-item", String(creatorId));
                    }
                } catch (_) {}
            } else {
                const creator = this.resolveEventCreatorId(item) || this.findUserId(item);
                if (creator && this.shouldHide(creator)) {
                    this.hideElement(item, "sidebar-event-item", creator);
                }
            }
        }
    }
    hideBlockedStageChannelNotice() {
        try {
            const notices = document.querySelectorAll('[class*="channelNotice_"]');
            for (let i = 0; i < notices.length; i++) {
                const notice = notices[i];
                const outer = notice.closest('[class*="container__"]') || notice;
                if (outer.dataset?.hiddenBlocked === "true") continue;
                const isLiveStageNotice = notice.querySelector('[class*="liveIndicator_"]') && notice.querySelector('[class*="stageIcon_"]');
                if (!isLiveStageNotice) continue;

                const channelId = this._resolveStageNoticeChannelId(notice);
                if (!channelId) continue;

                const allConnectedBlocked = this._areAllStageChannelUsersBlocked(channelId);
                if (allConnectedBlocked) {
                    this.hideElement(outer, "stage-channel-notice", false);
                }
            }
        } catch (_) {}
    }
    _resolveStageNoticeChannelId(notice) {
        let found = null;
        this.walkFiberProps(notice, props => {
            if (found || !props) return;
            const direct = props.channelId;
            if (direct && /^\d{17,20}$/.test(String(direct))) { found = String(direct); return; }
            const nested = props.channel?.id;
            if (nested && /^\d{17,20}$/.test(String(nested))) found = String(nested);
        }, 14);
        if (found) return found;

        const nameEl = notice.querySelector('[class*="channelName_"]');
        const name = (nameEl?.textContent || "").trim();
        if (!name) return null;
        const links = document.querySelectorAll('[data-list-item-id^="channels___"]');
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const label = link.getAttribute("aria-label") || "";
            if (label.startsWith(name + " (") && /canal palco|stage channel/i.test(label)) {
                const listId = link.dataset?.listItemId || "";
                const idMatch = listId.match(/(\d{17,20})$/);
                if (idMatch) return idMatch[1];
            }
        }
        return null;
    }
    _areAllStageChannelUsersBlocked(channelId) {
        try {
            const states = this.getRawVoiceStatesForChannel(channelId);
            if (!states || !states.length) return false;
            return states.every(s => {
                const uid = this.extractUserId(s);
                return uid && this.shouldHide(uid);
            });
        } catch (_) {
            return false;
        }
    }
    hideBlockedGuildStageBadge() {
        try {
            const badges = document.querySelectorAll('[class*="upperBadge_"]');
            for (let i = 0; i < badges.length; i++) {
                const badgeWrapper = badges[i];

                const itemContainer = badgeWrapper.closest("li") || badgeWrapper.closest('[class*="blobContainer"]') || badgeWrapper.parentElement?.parentElement;
                if (!itemContainer) continue;

                const a11yText = Array.from(itemContainer.querySelectorAll('[class*="hiddenVisually"]')).map(s => s.textContent || "").join(" | ");
                const isStageBadge = /palco ao vivo|stage.*live|live.*stage/i.test(a11yText);

                if (badgeWrapper.dataset?.hiddenBlocked === "true") {
                    if (!isStageBadge) {
                        this.restoreElement(badgeWrapper);
                        this._restoreGuildIconMask(itemContainer);
                        continue;
                    }
                    const guildIdRecheck = this._resolveGuildIdFromItem(itemContainer);
                    const channelIdRecheck = guildIdRecheck ? this._resolveGuildActiveStageChannelId(guildIdRecheck) : null;
                    const stillAllBlocked = channelIdRecheck ? this._areAllStageChannelUsersBlocked(channelIdRecheck) : true;
                    if (!stillAllBlocked) {
                        this.restoreElement(badgeWrapper);
                        this._restoreGuildIconMask(itemContainer);
                        continue;
                    }
                    this._fixGuildIconMaskForHiddenBadge(itemContainer);
                    continue;
                }
                if (!isStageBadge) continue;

                const guildId = this._resolveGuildIdFromItem(itemContainer);
                if (!guildId) continue;

                const channelId = this._resolveGuildActiveStageChannelId(guildId);
                if (!channelId) continue;

                const allConnectedBlocked = this._areAllStageChannelUsersBlocked(channelId);
                if (allConnectedBlocked) {
                    this.hideElement(badgeWrapper, "guild-stage-badge", false);
                    this._fixGuildIconMaskForHiddenBadge(itemContainer);
                }
            }
        } catch (_) {}
    }
    _restoreGuildIconMask(itemContainer) {
        try {
            const svg = itemContainer.querySelector('svg[class*="svg_cc5dd2"]');
            if (!svg) return;
            const fixedForeignObjects = svg.querySelectorAll('foreignObject[data-nmb-mask-fixed="true"]');
            fixedForeignObjects.forEach(fo => {
                const prevMask = fo.getAttribute("data-nmb-prev-mask");
                if (prevMask) fo.setAttribute("mask", prevMask);
                fo.removeAttribute("data-nmb-prev-mask");
                delete fo.dataset.nmbMaskFixed;
            });
            const hiddenStrokeEls = svg.querySelectorAll('[data-nmb-stroke-hidden="true"]');
            hiddenStrokeEls.forEach(el => {
                el.style.removeProperty("display");
                delete el.dataset.nmbStrokeHidden;
            });
        } catch (_) {}
    }
    _fixGuildIconMaskForHiddenBadge(itemContainer) {
        try {
            const svg = itemContainer.querySelector('svg[class*="svg_cc5dd2"]');
            if (!svg) return;
            const foreignObjects = svg.querySelectorAll("foreignObject[mask]");
            for (let i = 0; i < foreignObjects.length; i++) {
                const fo = foreignObjects[i];
                if (fo.dataset?.nmbMaskFixed === "true") continue;
                const maskAttr = fo.getAttribute("mask") || "";
                const maskIdMatch = maskAttr.match(/url\(#([^)]+)\)/);
                if (!maskIdMatch) continue;
                const maskId = maskIdMatch[1];
                const maskEl = document.getElementById(maskId);
                const usesBadgeCutout = !!maskEl && (!!maskEl.querySelector('[id*="upper_badge_masks"]') || Array.from(maskEl.querySelectorAll("use")).some(useEl => {
                    const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href") || "";
                    return href.includes("upper_badge_masks");
                }));
                if (!usesBadgeCutout) continue;
                fo.setAttribute("data-nmb-prev-mask", maskAttr);
                fo.setAttribute("mask", "url(#svg-mask-squircle)");
                fo.dataset.nmbMaskFixed = "true";
            }
            const strokeMasks = svg.querySelectorAll('mask[id*="-stroke_mask"]');
            for (let i = 0; i < strokeMasks.length; i++) {
                const strokeMask = strokeMasks[i];
                if (!strokeMask.innerHTML.includes("upper_badge_masks")) continue;
                const maskId = strokeMask.id;
                const usersOfStroke = svg.querySelectorAll(`[mask="url(#${maskId})"]`);
                usersOfStroke.forEach(el => {
                    if (el.dataset?.nmbStrokeHidden === "true") return;
                    el.style.setProperty("display", "none", "important");
                    el.dataset.nmbStrokeHidden = "true";
                });
            }
        } catch (_) {}
    }
    _fixHandIconMaskCutout(svg) {
        try {
            const gEls = svg.querySelectorAll("g[mask]");
            for (let i = 0; i < gEls.length; i++) {
                const maskAttr = gEls[i].getAttribute("mask") || "";
                const maskIdMatch = maskAttr.match(/url\(#([^)]+)\)/);
                if (!maskIdMatch) continue;
                const maskEl = svg.querySelector(`mask#${CSS.escape(maskIdMatch[1])}`) || document.getElementById(maskIdMatch[1]);
                if (!maskEl || maskEl.dataset?.nmbHandMaskFixed === "true") continue;
                const cutout = maskEl.querySelector('circle[fill="black"], circle[fill="#000"], circle[fill="#000000"]');
                if (!cutout) continue;
                const placeholder = document.createComment("nmb-hand-cutout");
                cutout.replaceWith(placeholder);
                maskEl._nmbCutoutEl = cutout;
                maskEl._nmbCutoutPlaceholder = placeholder;
                maskEl.dataset.nmbHandMaskFixed = "true";
            }
        } catch (_) {}
    }
    _restoreHandIconMaskCutout(svg) {
        try {
            const fixedMasks = svg.querySelectorAll('mask[data-nmb-hand-mask-fixed="true"]');
            fixedMasks.forEach(maskEl => {
                if (maskEl._nmbCutoutEl && maskEl._nmbCutoutPlaceholder) {
                    maskEl._nmbCutoutPlaceholder.replaceWith(maskEl._nmbCutoutEl);
                }
                delete maskEl._nmbCutoutEl;
                delete maskEl._nmbCutoutPlaceholder;
                delete maskEl.dataset.nmbHandMaskFixed;
            });
        } catch (_) {}
    }
    _resolveGuildIdFromItem(itemContainer) {
        const withListId = itemContainer.querySelector('[data-list-item-id^="guildsnav___"]') || (itemContainer.dataset?.listItemId ? itemContainer : null);
        if (withListId) {
            const listId = withListId.dataset?.listItemId || withListId.getAttribute("data-list-item-id") || "";
            const match = listId.match(/(\d{17,20})$/);
            if (match) return match[1];
        }
        let found = null;
        this.walkFiberProps(itemContainer, props => {
            if (found || !props) return;
            const direct = props.guildId ?? props.channel?.guild_id;
            if (direct && /^\d{17,20}$/.test(String(direct))) found = String(direct);
        }, 14);
        return found;
    }
    _resolveGuildActiveStageChannelIdViaStore(guildId) {
        try {
            const store = this.modules.StageInstanceStore;
            if (!store || !guildId) return null;
            const instancesByGuild = store.getStageInstancesByGuild?.(guildId);
            if (!instancesByGuild || typeof instancesByGuild !== "object") return null;
            const keys = Object.keys(instancesByGuild);
            if (!keys.length) return null;
            const first = instancesByGuild[keys[0]];
            const channelId = first?.channel_id || first?.channelId || keys[0];
            return channelId ? String(channelId) : null;
        } catch (_) {
            return null;
        }
    }
    _resolveGuildActiveStageChannelId(guildId) {
        const viaStore = this._resolveGuildActiveStageChannelIdViaStore(guildId);
        if (viaStore) return viaStore;
        try {
            let currentGuildId = null;
            try {
                currentGuildId = this.modules.SelectedGuildStore?.getGuildId?.();
            } catch (_) {}
            if (!currentGuildId || !guildId || String(currentGuildId) !== String(guildId)) return null;

            const notice = document.querySelector('[class*="channelNotice_"]');
            if (!notice) return null;
            const isLiveStageNotice = notice.querySelector('[class*="liveIndicator_"]') && notice.querySelector('[class*="stageIcon_"]');
            if (!isLiveStageNotice) return null;

            return this._resolveStageNoticeChannelId(notice);
        } catch (_) {
            return null;
        }
    }
    _openGuildRolesSettings() {
        let guildId = null;
        try {
            guildId = this.modules.SelectedGuildStore?.getGuildId?.();
        } catch (_) {}
        if (!guildId) {
            try {
                const match = location.pathname.match(/\/channels\/(\d+)/);
                if (match) guildId = match[1];
            } catch (_) {}
        }
        if (!guildId) {
            this.toast("âš ï¸ NÃ£o foi possÃ­vel identificar o servidor atual.", "warn");
            return;
        }
        const isSettingsGearIcon = el => {
            const path = el?.querySelector?.('svg path[fill-rule="evenodd"]');
            const d = path?.getAttribute("d") || "";
            return d.includes("M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0");
        };
        const ROLES_TAB_RE = /cargos|roles|rÃ´les/i;
        const findSettingsModalRoot = () => {
            const anyTab = document.querySelector('[role="tab"]');
            return anyTab?.closest('[role="dialog"], [class*="layer"]') || null;
        };
        const clickRolesTab = () => {
            const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(el => ROLES_TAB_RE.test((el.textContent || "").trim()));
            if (tab) {
                tab.click();
                return true;
            }
            return false;
        };
        const revealSettingsModal = modalRoot => {
            if (!modalRoot) return;
            modalRoot.style.removeProperty("visibility");
            modalRoot.style.removeProperty("transition");
            modalRoot.removeAttribute("data-nmb-roles-hidden");
        };
        const watchForRolesTab = () => {
            const already = findSettingsModalRoot();
            if (already && !already.hasAttribute("data-nmb-roles-hidden")) {
                already.dataset.nmbRolesHidden = "true";
                already.style.visibility = "hidden";
            }
            if (clickRolesTab()) {
                requestAnimationFrame(() => revealSettingsModal(findSettingsModalRoot() || already));
                return;
            }
            let attempts = 0;
            const observer = new MutationObserver(() => {
                attempts++;
                const modalRoot = findSettingsModalRoot();
                if (modalRoot && !modalRoot.hasAttribute("data-nmb-roles-hidden")) {
                    modalRoot.dataset.nmbRolesHidden = "true";
                    modalRoot.style.visibility = "hidden";
                }
                if (clickRolesTab()) {
                    observer.disconnect();
                    requestAnimationFrame(() => revealSettingsModal(findSettingsModalRoot() || modalRoot));
                    return;
                }
                if (attempts > 40) {
                    observer.disconnect();
                    revealSettingsModal(modalRoot);
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            setTimeout(() => {
                observer.disconnect();
                revealSettingsModal(findSettingsModalRoot());
            }, 4e3);
        };
        const clickSettingsMenuItemIfPresent = () => {
            const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(isSettingsGearIcon);
            if (item) {
                item.click();
                watchForRolesTab();
                return true;
            }
            return false;
        };
        try {
            if (clickSettingsMenuItemIfPresent()) return;
            const guildHeader = document.querySelector('[class*="guildDropdown_"]');
            if (guildHeader) {
                guildHeader.click();
                let attempts = 0;
                const menuObserver = new MutationObserver(() => {
                    attempts++;
                    if (clickSettingsMenuItemIfPresent() || attempts > 40) {
                        menuObserver.disconnect();
                    }
                });
                menuObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
                setTimeout(() => menuObserver.disconnect(), 4e3);
                return;
            }
        } catch (_) {}
        try {
            const Dispatcher = this.modules.Dispatcher || this._wpGetModule(m => typeof m?.dispatch === "function" && typeof m?.subscribe === "function", {
                searchExports: true
            });
            if (Dispatcher?.dispatch) {
                Dispatcher.dispatch({
                    type: "GUILD_SETTINGS_MODAL_OPEN",
                    guildId: guildId
                });
                watchForRolesTab();
                return;
            }
        } catch (_) {}
        try {
            const opener = this._wpGetModule(m => typeof m?.open === "function" && typeof m?.updateGuild === "function", {
                searchExports: true
            });
            if (opener?.open) {
                opener.open(guildId);
                watchForRolesTab();
                return;
            }
        } catch (_) {}
        this.toast("âš ï¸ NÃ£o foi possÃ­vel abrir automaticamente. Abra manualmente em ConfiguraÃ§Ãµes do servidor > Cargos.", "warn");
    }
    fixGuildMembersPageCount() {
        if (!this.settings.places.memberList) return;
        const counters = document.querySelectorAll('[class*="membersCount"]');
        for (let i = 0; i < counters.length; i++) {
            const counter = counters[i];
            const scope = counter.closest('[class*="members"]') || counter.parentElement?.parentElement;
            if (!scope) continue;
            const rows = scope.querySelectorAll('[class*="memberRow"]');
            if (!rows.length) continue;
            let visible = 0;
            for (let j = 0; j < rows.length; j++) {
                if (rows[j].dataset?.hiddenBlocked !== "true") visible++;
            }
            const text = counter.textContent || "";
            const updated = text.replace(/\b\d[\d.,]*\b/, String(visible));
            if (updated === text || !/\d/.test(text)) continue;
            if (!counter.hasAttribute("data-nmb-prev-text")) {
                counter.setAttribute("data-nmb-prev-text", text);
            }
            counter.textContent = updated;
        }
        this._fixGuildMembersShowingCountFooter();
    }
    _fixGuildMembersShowingCountFooter() {
        const showingRegex = /^(?:mostrando|showing)\s+\d[\d.,]*\s+(?:membros?|members?)$/i;
        const candidates = document.querySelectorAll("div[data-text-variant], span[data-text-variant], p[data-text-variant], div, span, p");
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            const strong = el.querySelector(":scope > strong");
            if (!strong) continue;
            const text = (el.textContent || "").trim().replace(/\s+/g, " ");
            if (!showingRegex.test(text)) continue;
            let scope = el;
            let rows = null;
            for (let k = 0; k < 6 && scope; k++, scope = scope.parentElement) {
                const found = scope.querySelectorAll('[class*="memberRow"]');
                if (found.length) {
                    rows = found;
                    break;
                }
            }
            if (!rows || !rows.length) continue;
            let visible = 0;
            for (let j = 0; j < rows.length; j++) {
                if (rows[j].dataset?.hiddenBlocked !== "true") visible++;
            }
            const currentNum = parseInt((strong.textContent || "").replace(/[^\d]/g, ""), 10);
            if (Number.isNaN(currentNum) || currentNum === visible) continue;
            if (!strong.hasAttribute("data-nmb-prev-text")) {
                strong.setAttribute("data-nmb-prev-text", strong.textContent);
            }
            strong.textContent = String(visible);
        }
    }
    isBlockedMessageBannerText(text) {
        return /(?:^|\s)(?:\d+\s+)?(?:blocked\s+messages?|messages?\s+blocked|mensage(?:m|ns)\s+bloquead[ao]s?)(?:\s*[â€”]\s*(?:mostrar|show))?(?:\s|$)/i.test(String(text || "").trim());
    }
    hideAutocompleteRows() {
        const rows = document.querySelectorAll('[data-list-id^="channel-autocomplete"] [role="option"], [data-list-id^="mention-autocomplete"] [role="option"]');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.dataset?.hiddenBlocked === "true") continue;
            const userId = this.findUserId(row);
            if (userId && this.shouldHide(userId)) {
                this.hideElement(row, "autocomplete", userId);
            }
        }
    }
    fixMemberGroupCounts() {
        const headers = document.querySelectorAll('[class*="membersGroup"], [data-list-item-id]');
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i];
            if (header.dataset?.hiddenBlocked === "true" || !this.isMemberGroupHeader(header)) continue;
            const count = this.countVisibleMembersAfter(header);
            if (count === null) continue;
            if (count <= 0) {
                this.hideElement(header, "empty-member-header");
                continue;
            }
            this.updateMemberGroupVisibleCount(header, count);
        }
    }
    isMemberGroupHeader(el) {
        const id = el.dataset?.listItemId || "";
        if (id && /\d{17,20}$/.test(id)) return false;
        const text = (el.textContent || "").trim();
        if (!text) return false;
        if (/[\s\u00A0]+[\u2013\u2014][\s\u00A0]*\d+\s*$/.test(text)) return true;
        return String(el.className || "").includes("membersGroup");
    }
    countVisibleMembersAfter(header) {
        let count = 0;
        let sawMember = false;
        let next = header.nextElementSibling;
        while (next) {
            if (this.isMemberGroupHeader(next)) break;
            if (next.dataset?.hiddenBlocked === "true") { next = next.nextElementSibling; continue; }
            const userId = this.findUserId(next);
            if (userId) {
                sawMember = true;
                if (!this.shouldHide(userId)) count++;
            }
            next = next.nextElementSibling;
        }
        return sawMember ? count : null;
    }
    updateMemberGroupVisibleCount(header, count) {
        const headerDiv = header.querySelector('[class*="membersGroupHeader"]') || header;
        const spans = Array.from(headerDiv.querySelectorAll("span"));
        const countSpan = spans.find(span => {
            if (span.className && span.className.includes("membersGroupName")) return false;
            return /[\u2013\u2014]\s*\d+/.test(span.textContent || "");
        });
        if (countSpan) {
            if (!countSpan.hasAttribute("data-nmb-prev-text")) {
                countSpan.setAttribute("data-nmb-prev-text", countSpan.textContent);
            }
            countSpan.textContent = `\u00a0\u2014 ${count}`;
        }
        const hiddenSpan = header.querySelector('[class*="hiddenVisually"]');
        if (hiddenSpan) {
            if (!hiddenSpan.hasAttribute("data-nmb-prev-text")) {
                hiddenSpan.setAttribute("data-nmb-prev-text", hiddenSpan.textContent);
            }
            hiddenSpan.textContent = hiddenSpan.textContent.replace(/\d+/, count);
        }
    }
    hideOrphanedDividers() {
        const dividers = document.querySelectorAll('li:has([class*="divider"]), [class*="divider_"], [class*="divider-"]');
        for (let i = 0; i < dividers.length; i++) {
            const divider = dividers[i];
            if (divider.dataset?.hiddenBlocked === "true") continue;
            let next = divider.nextElementSibling;
            let hasVisible = false;
            while (next) {
                if (next.matches?.('[class*="divider"], li:has([class*="divider"])')) break;
                if (next.dataset?.hiddenBlocked !== "true" && (next.textContent || "").trim()) {
                    hasVisible = true;
                    break;
                }
                next = next.nextElementSibling;
            }
            if (!hasVisible) this.hideElement(divider, "orphan-divider");
        }
    }
    cleanupPinnedPanelResidue() {
        const pinsRoots = document.querySelectorAll('[data-list-id="pins"], [data-list-id*="pins"]');
        for (let i = 0; i < pinsRoots.length; i++) {
            const root = pinsRoots[i];
            const groups = root.querySelectorAll('[class*="messageGroupWrapper"]');
            let totalGroups = 0;
            let hiddenGroups = 0;
            for (let j = 0; j < groups.length; j++) {
                const wrapper = groups[j];
                totalGroups++;
                if (wrapper.dataset?.hiddenBlocked === "true") {
                    hiddenGroups++;
                    continue;
                }
                const pinCards = Array.from(wrapper.querySelectorAll('[data-list-item-id^="pins__"]'));
                if (pinCards.length === 0) continue;
                const allHidden = pinCards.every(card => card.dataset?.hiddenBlocked === "true");
                if (allHidden) {
                    this.hideElement(wrapper, "pinned-panel-residue", false);
                    hiddenGroups++;
                }
            }
            this._syncPinnedEmptyState(root, totalGroups > 0 && hiddenGroups === totalGroups);
        }
    }
    _findLocalizedPinsEmptyText() { return (_locale(_getLocale(), ByeBlocked.PINS_LOCALE) || {}).body || null; }
    _findLocalizedPinsTipText() {
        const d = _locale(_getLocale(), ByeBlocked.PINS_LOCALE);
        return d ? { label: d.tip_label, text: d.tip_text } : null;
    }
    _syncPinnedEmptyState(listRoot, shouldShowEmpty) {
        let placeholder = listRoot.querySelector(":scope > .nmb-pins-empty-placeholder");
        if (shouldShowEmpty) {
            if (!listRoot.hasAttribute("data-nmb-prev-list-style")) {
                listRoot.setAttribute("data-nmb-prev-list-style", listRoot.getAttribute("style") || "");
            }
            listRoot.style.gap = "0px";
            listRoot.style.rowGap = "0px";
            listRoot.style.padding = "0px";
            listRoot.style.display = "flex";
            listRoot.style.flexDirection = "column";
            listRoot.style.height = "auto";
            listRoot.style.minHeight = "0px";
            listRoot.style.overflow = "hidden";
            Array.from(listRoot.children).forEach(child => {
                if (child === placeholder) return;
                if (!child.hasAttribute("data-nmb-prev-residue-style")) {
                    child.setAttribute("data-nmb-prev-residue-style", child.getAttribute("style") || "");
                }
                child.style.cssText = "display: none !important; height: 0 !important; min-height: 0 !important; max-height: 0 !important; padding: 0 !important; margin: 0 !important; border: 0 !important; overflow: hidden !important; contain: size style !important;";
            });
            if (!placeholder) {
                placeholder = document.createElement("div");
                const bodyText = this._findLocalizedPinsEmptyText() || "This channel doesn't have<br>any pinned messages... yet.";
                placeholder.className = "emptyPlaceholder_e8b59c nmb-pins-empty-placeholder";
                placeholder.innerHTML = `\n                    <div class="image_e8b59c" style="background-image:url(&quot;/assets/1772d54cb566d95b.svg&quot;)"></div>\n                    <div class="text-md/medium_cf4812 body_e8b59c" data-text-variant="text-md/medium" style="color: var(--text-default);">${bodyText}</div>\n                `;
                listRoot.appendChild(placeholder);
            }
            placeholder.style.display = "";
            const scroller = listRoot.closest('.messagesPopout_e8b59c, [class*="messagesPopout_"], [class*="messagesPopout"]') || listRoot.parentElement;
            const footerHost = scroller && scroller.parentElement ? scroller.parentElement : null;
            let footer = footerHost ? footerHost.querySelector(":scope > .nmb-pins-empty-footer") : null;
            if (!footer && footerHost) {
                footer = document.createElement("div");
                const tip = this._findLocalizedPinsTipText() || {
                    label: "Pro tip:",
                    text: 'Users with the "Manage Messages" permission can pin a message from the context menu.'
                };
                footer.className = "footer_e8b59c nmb-pins-empty-footer";
                footer.innerHTML = `\n                    <div class="block__30cbe" style="width: 100%; padding-top: 10px; padding-bottom: 10px;">\n                        <div class="text-sm/bold_cf4812 pro__30cbe" data-text-variant="text-sm/bold" style="color: var(--text-feedback-positive);">${tip.label}</div>\n                        <div class="defaultColor__4bd52 text-sm/normal_cf4812 tip__30cbe" data-text-variant="text-sm/normal">${tip.text}</div>\n                    </div>\n                `;
                footerHost.appendChild(footer);
            }
            if (footer) footer.style.display = "";
        } else {
            if (listRoot.hasAttribute("data-nmb-prev-list-style")) {
                const prevListStyle = listRoot.getAttribute("data-nmb-prev-list-style");
                if (prevListStyle) listRoot.setAttribute("style", prevListStyle); else listRoot.removeAttribute("style");
                listRoot.removeAttribute("data-nmb-prev-list-style");
            } else {
                listRoot.style.gap = "";
                listRoot.style.rowGap = "";
                listRoot.style.padding = "";
                listRoot.style.display = "";
                listRoot.style.flexDirection = "";
                listRoot.style.height = "";
                listRoot.style.minHeight = "";
                listRoot.style.overflow = "";
            }
            Array.from(listRoot.children).forEach(child => {
                if (child.hasAttribute("data-nmb-prev-residue-style")) {
                    const prev = child.getAttribute("data-nmb-prev-residue-style");
                    if (prev) child.setAttribute("style", prev); else child.removeAttribute("style");
                    child.removeAttribute("data-nmb-prev-residue-style");
                }
            });
            if (placeholder) placeholder.style.display = "none";
            const footer = listRoot.parentElement ? listRoot.parentElement.querySelector(":scope > .nmb-pins-empty-footer") : null;
            if (footer) footer.style.display = "none";
        }
    }
    _seedVoiceChannelMembers() {
        try {
            const voiceStore = this.modules.SortedVoiceStateStore || this.modules.VoiceStateStore;
            if (!voiceStore) return;
            document.querySelectorAll('[data-list-item-id*="channels"]').forEach(row => {
                const channelId = this.findChannelId(row);
                if (!channelId) return;
                const states = this.getRawVoiceStatesForChannel(channelId);
                if (!states.length) return;
                const memberIds = new Set(states.map(s => this.extractUserId(s)).filter(Boolean));
                if (memberIds.size) this._voiceChannelMemberIds.set(channelId, memberIds);
            });
        } catch (_) {}
        this._seedBlockedChannelStatuses();
    }
    _seedBlockedChannelStatuses() {
        try {
            if (!this._channelStatusAuthors) this._channelStatusAuthors = new Map;
            document.querySelectorAll('[data-list-item-id*="channels"]').forEach(row => {
                const channelId = this.findChannelId(row);
                if (!channelId) return;
                const statusEl = row.querySelector('[class*="channelStatus" i], [class*="voiceChannelStatus" i], [class*="statusText" i]');
                if (!statusEl || !statusEl.textContent?.trim()) return;
                if (this._isChannelStatusPlaceholder(statusEl)) {
                    statusEl.dataset.nmbStatusSafe = "true";
                    return;
                }

                if (!this._channelStatusAuthors.has(channelId)) {
                    this._channelStatusAuthors.set(channelId, this._channelHasBlockedMember(channelId));
                }
                if (this._channelStatusBelongsToBlocked(channelId)) {
                    if (!this._blockedChannelStatuses) this._blockedChannelStatuses = new Map;
                    this._blockedChannelStatuses.set(channelId, statusEl.textContent.trim());
                    this._suppressChannelStatusText(channelId);
                } else {
                    statusEl.dataset.nmbStatusSafe = "true";
                    delete statusEl.dataset.nmbStatusOverridden;
                }
            });
        } catch (_) {}
    }
    _getSelfUserId() {
        try {
            const UserStore = this.modules.UserStore;
            const me = UserStore?.getCurrentUser?.();
            return me?.id || null;
        } catch (_) {
            return null;
        }
    }
    _handleVoiceStateUpdatesForFakeTimer(voiceStates) {
        if (!this.settings.places.voiceChannels) return;
        const selfId = this._getSelfUserId();
        for (const vs of voiceStates) {
            if (!vs) continue;
            const userId = vs.userId || this.extractUserId(vs);
            if (!userId) continue;
            const newChannelId = vs.channelId || null;
            const prevMembers = this._voiceChannelMemberIds;
            let oldChannelId = null;
            for (const [chId, members] of prevMembers) {
                if (members.has(userId)) { oldChannelId = chId; break; }
            }
            if (oldChannelId === newChannelId) continue;
            if (oldChannelId) {
                const oldSet = prevMembers.get(oldChannelId);
                oldSet?.delete(userId);
                if (oldSet && !oldSet.size) prevMembers.delete(oldChannelId);
            }
            if (this.shouldHide(userId)) {

                const _oldChId = oldChannelId, _newChId = newChannelId;
                setTimeout(() => {
                    if (!this.isRunning) return;
                    try {
                        if (_oldChId) this._reevaluateChannelStatusVisibility(_oldChId);
                        if (_newChId) this._reevaluateChannelStatusVisibility(_newChId);
                    } catch (_) {}
                }, 0);
            }
            if (selfId && userId === selfId && !newChannelId) {
                this._voiceFakeTimers.delete(oldChannelId);
                this._releaseAllVoiceMutes();
                setTimeout(() => {
                    if (this.isRunning) this.fixVoiceChannelIconColors();
                }, 0);
            }
            if (newChannelId) {
                const existingMembers = prevMembers.get(newChannelId) || new Set;
                existingMembers.add(userId);
                prevMembers.set(newChannelId, existingMembers);

                if (selfId && userId === selfId) {
                    let othersBeforeIEntered = [ ...existingMembers ].filter(id => id !== selfId);

                    if (!othersBeforeIEntered.length) {
                        const rawStates = this.getRawVoiceStatesForChannel(newChannelId) || [];
                        othersBeforeIEntered = rawStates
                            .map(s => this.extractUserId(s))
                            .filter(id => id && id !== selfId);
                    }

                    const anyBlockedBefore = othersBeforeIEntered.some(id => this.shouldHide(id));
                    const anyUnblockedBefore = othersBeforeIEntered.some(id => !this.shouldHide(id));
                    if (anyBlockedBefore && !anyUnblockedBefore) {
                        this._resetFakeVoiceTimer(newChannelId);
                    }
                    try {
                        this._applyVoiceMuteForChannel(newChannelId);
                    } catch (_) {}
                }
            }
        }
    }
    _reevaluateChannelStatusVisibility(channelId) {
        if (!channelId || !this.settings.places.voiceChannels) return;
        const row = this._findChannelRowById(channelId);
        if (!row) return;
        if (!this._blockedChannelStatuses) this._blockedChannelStatuses = new Map;
        if (!this._channelStatusAuthors) this._channelStatusAuthors = new Map;
        const statusEl = row.querySelector('[class*="channelStatus" i], [class*="voiceChannelStatus" i], [class*="statusText" i]');
        if (this._isChannelStatusPlaceholder(statusEl)) {
            this._blockedChannelStatuses.delete(channelId);
            this._channelStatusAuthors.delete(channelId);
            if (statusEl) statusEl.dataset.nmbStatusSafe = "true";
            return;
        }

        const belongsToBlocked = this._channelStatusBelongsToBlocked(channelId);
        if (belongsToBlocked) {

            this._channelStatusAuthors.set(channelId, true);
            const currentText = statusEl?.dataset?.nmbStatusOverridden === "true"
                ? this._blockedChannelStatuses.get(channelId)
                : statusEl?.textContent?.trim();
            if (currentText) {
                this._blockedChannelStatuses.set(channelId, currentText);
                this._suppressChannelStatusText(channelId);
            }
        } else {
            this._channelStatusAuthors.set(channelId, false);
            this._blockedChannelStatuses.delete(channelId);
            this._restoreChannelStatusText(channelId);
            if (statusEl) statusEl.dataset.nmbStatusSafe = "true";
        }
    }
    _getMediaEngineContext() {
        try {
            const RTCUtils = this.modules.RTCConnectionUtils;
            if (RTCUtils) {
                const channelId = RTCUtils.getChannelId?.();
                const guildId = RTCUtils.getGuildId?.();
                if (channelId) return { channelId: channelId, guildId: guildId || null, context: "default" };
            }
        } catch (_) {}
        try {
            const candidate = this.modules.SelectedChannelStore?.getVoiceChannelId?.();
            if (candidate) return { channelId: candidate, guildId: null, context: "default" };
        } catch (_) {}
        return null;
    }
    _setBlockedUserLocalMute(userId, mute) {
        const actions = this.modules.MediaEngineActions;
        if (!actions || !userId) return false;
        const ctx = this._getMediaEngineContext();
        const context = ctx?.context || "default";
        let applied = false;
        try {
            if (this._localMuteKey && typeof actions[this._localMuteKey] === "function") {
                actions[this._localMuteKey](userId, mute, context);
                applied = true;
            }
        } catch (_) {}
        try {
            if (this._localVolumeKey && typeof actions[this._localVolumeKey] === "function") {
                actions[this._localVolumeKey](userId, mute ? 0 : 100, context);
                applied = true;
            }
        } catch (_) {}
        return applied;
    }
    _applyVoiceMuteForChannel(channelId) {
        if (!this.settings.behavior.muteBlockedVoiceAudio) return;
        if (!channelId) return;
        try {
            const states = this.getRawVoiceStatesForChannel(channelId) || [];
            const selfId = this._getSelfUserId();
            for (const state of states) {
                const userId = this.extractUserId(state);
                if (!userId || userId === selfId) continue;
                if (this.shouldHide(userId)) {
                    if (!this._mutedBlockedUserIds) this._mutedBlockedUserIds = new Set;
                    this._setBlockedUserLocalMute(userId, true);
                    this._mutedBlockedUserIds.add(userId);
                }
            }
        } catch (_) {}
    }
    _releaseVoiceMuteForUser(userId) {
        if (!userId) return;
        if (!this._mutedBlockedUserIds || !this._mutedBlockedUserIds.has(userId)) return;
        this._setBlockedUserLocalMute(userId, false);
        this._mutedBlockedUserIds.delete(userId);
    }
    _releaseAllVoiceMutes() {
        if (!this._mutedBlockedUserIds || !this._mutedBlockedUserIds.size) return;
        for (const userId of [...this._mutedBlockedUserIds]) {
            this._setBlockedUserLocalMute(userId, false);
        }
        this._mutedBlockedUserIds.clear();
    }
    patchVoiceMute() {
        if (this._voiceMutePatched) return;
        const Dispatcher = this.modules.Dispatcher;
        if (!Dispatcher || typeof Dispatcher.dispatch !== "function") return;
        this._voiceMutePatched = true;
        this._mutedBlockedUserIds = this._mutedBlockedUserIds || new Set;
        const self = this;
        this.patchBefore(Dispatcher, "dispatch", function(context, args) {
            const action = args[0];
            if (!action || typeof action !== "object") return;
            if (action.type === "VOICE_STATE_UPDATES" && Array.isArray(action.voiceStates)) {
                try {
                    self._handleVoiceStateUpdatesForMute(action.voiceStates);
                } catch (_) {}
            }
        });
        try {
            const ctx = this._getMediaEngineContext();
            if (ctx?.channelId) this._applyVoiceMuteForChannel(ctx.channelId);
        } catch (_) {}
    }
    _handleVoiceStateUpdatesForMute(voiceStates) {
        if (!this.settings.behavior.muteBlockedVoiceAudio) return;
        const selfId = this._getSelfUserId();
        const myChannelId = this._getMediaEngineContext()?.channelId || null;
        for (const vs of voiceStates) {
            if (!vs) continue;
            const userId = vs.userId || this.extractUserId(vs);
            if (!userId || userId === selfId) continue;
            const newChannelId = vs.channelId || null;
            if (newChannelId && myChannelId && newChannelId === myChannelId && this.shouldHide(userId)) {
                if (!this._mutedBlockedUserIds) this._mutedBlockedUserIds = new Set;
                this._setBlockedUserLocalMute(userId, true);
                this._mutedBlockedUserIds.add(userId);
            } else if (newChannelId !== myChannelId) {
                this._releaseVoiceMuteForUser(userId);
            }
        }
    }
    _resetFakeVoiceTimer(channelId) {
        this._voiceFakeTimers.set(channelId, {
            startedAt: Date.now(),
            active: true
        });
        this._ensureFakeTimerTicker();
    }
    _ensureFakeTimerTicker() {
        if (this._voiceFakeTimerTick) return;
        this._voiceFakeTimerTick = setInterval(() => {
            if (!this.isRunning || !this._voiceFakeTimers.size) {
                clearInterval(this._voiceFakeTimerTick);
                this._voiceFakeTimerTick = null;
                return;
            }
            this._renderFakeVoiceTimers();
        }, 1e3);
    }
    _formatFakeTimerDuration(ms) {
        const totalSeconds = Math.max(0, Math.floor(ms / 1e3));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor(totalSeconds % 3600 / 60);
        const seconds = totalSeconds % 60;
        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
        }
        return `${minutes}:${String(seconds).padStart(2, "0")}`;
    }
    _renderFakeVoiceTimers() {
        for (const [channelId, state] of this._voiceFakeTimers) {
            if (!state.active) continue;
            const row = this._findChannelRowById(channelId);
            if (!row) continue;
            const fakeEl = row.querySelector('[data-nmb-fake-timer="true"]');
            if (fakeEl) fakeEl.textContent = this._formatFakeTimerDuration(Date.now() - state.startedAt);
        }
    }
    _findChannelRowById(channelId) {
        if (!channelId) return null;
        return document.querySelector(`[data-list-item-id*="channels___${channelId}"]`) || document.querySelector(`[data-list-item-id*="${channelId}"]`);
    }
    _findVoiceTimerAnchor(channelRow) {
        if (!channelRow) return null;
        const link = channelRow.matches?.('[data-list-item-id*="channels"]') ? channelRow : channelRow.querySelector?.('[data-list-item-id*="channels"]');
        return link || channelRow;
    }
    _DEFAULT_FAKE_TIMER_STYLE() {
        return {
            fontFamily: "var(--font-display, inherit)",
            fontSize: "12px",
            fontWeight: "500",
            fontVariantNumeric: "tabular-nums",
            lineHeight: "16px",
            color: "var(--text-positive, #23a55a)",
            letterSpacing: "normal",
            margin: "0",
            padding: "0 2px"
        };
    }
    _showFakeVoiceTimer(channelRow, channelId) {
        let state = this._voiceFakeTimers.get(channelId);
        if (!state) {
            state = { startedAt: Date.now(), active: true };
            this._voiceFakeTimers.set(channelId, state);
            this._ensureFakeTimerTicker();
        } else if (!state.active) {
            state.active = true;
        }
        const timerContainer = channelRow.querySelector('[class*="tabularNumbers"]');
        if (timerContainer) {
            if (timerContainer.dataset.hiddenBlocked === "true") {
                this.restoreElement(timerContainer);
            }
            const visibleTimerSpan = timerContainer.querySelector('span[aria-hidden="true"]') || timerContainer;
            if (!state.styleSnapshot) {
                const computed = window.getComputedStyle(visibleTimerSpan);
                state.styleSnapshot = {
                    fontFamily: computed.fontFamily,
                    fontSize: computed.fontSize,
                    fontWeight: computed.fontWeight,
                    fontVariantNumeric: computed.fontVariantNumeric,
                    lineHeight: computed.lineHeight,
                    color: computed.color,
                    letterSpacing: computed.letterSpacing,
                    margin: computed.margin,
                    padding: computed.padding
                };
            }
            if (!visibleTimerSpan.hasAttribute("data-nmb-prev-style")) {
                visibleTimerSpan.setAttribute("data-nmb-prev-style", visibleTimerSpan.getAttribute("style") || "");
            }
            visibleTimerSpan.dataset.hiddenBlocked = "true";
            visibleTimerSpan.dataset.nmbReason = "voice-timer-faked";
            visibleTimerSpan.style.cssText = this.hideStyles;
            this.hiddenElements.add(visibleTimerSpan);
        }
        const computedSnapshot = state.styleSnapshot || this._DEFAULT_FAKE_TIMER_STYLE();
        const anchor = this._findVoiceTimerAnchor(channelRow);
        if (!anchor) return;
        let fakeEl = channelRow.querySelector('[data-nmb-fake-timer="true"]');
        if (!fakeEl) {
            fakeEl = document.createElement("span");
            fakeEl.setAttribute("data-nmb-fake-timer", "true");
            if (timerContainer) {
                (timerContainer.querySelector('span[aria-hidden="true"]') || timerContainer).insertAdjacentElement("afterend", fakeEl);
            } else {
                anchor.appendChild(fakeEl);
            }
        }
        fakeEl.style.cssText = `
            font-family: ${computedSnapshot.fontFamily};
            font-size: ${computedSnapshot.fontSize};
            font-weight: ${computedSnapshot.fontWeight};
            font-variant-numeric: ${computedSnapshot.fontVariantNumeric};
            line-height: ${computedSnapshot.lineHeight};
            color: ${computedSnapshot.color};
            letter-spacing: ${computedSnapshot.letterSpacing};
            margin: ${computedSnapshot.margin};
            padding: ${computedSnapshot.padding};
            display: inline-block;
            visibility: visible !important;
        `;
        fakeEl.textContent = this._formatFakeTimerDuration(Date.now() - state.startedAt);
    }
    _hideFakeVoiceTimer(channelRow, channelId) {
        const state = this._voiceFakeTimers.get(channelId);
        if (state) state.active = false;
        const timerContainer = channelRow.querySelector('[class*="tabularNumbers"]');
        const fakeEl = (timerContainer || channelRow).querySelector('[data-nmb-fake-timer="true"]');
        if (fakeEl) fakeEl.remove();
        channelRow.querySelectorAll('[data-hidden-blocked="true"][data-nmb-reason="voice-timer-faked"]').forEach(el => this.restoreElement(el));
    }
    fixVoiceCounters() {
        const voiceStore = this.modules.SortedVoiceStateStore;
        if (!voiceStore?.getVoiceStatesForChannel) return;
        document.querySelectorAll('[class*="voiceUsers"], [class*="userLimit"]').forEach(counter => {
            const text = counter.textContent || "";
            if (!/\d/.test(text)) return;
            const channel = counter.closest('[data-list-item-id], [id*="channels___"], [class*="voiceChannel"], [class*="channel-"]');
            const channelId = this.findChannelId(channel);
            if (!channelId) return;
            const states = this.getRawVoiceStatesForChannel(channelId);
            const visible = states.filter(state => !this.shouldHide(this.extractUserId(state))).length;
            if (text.includes("/")) {
                const limit = text.split("/").pop().trim();
                counter.textContent = `${visible} / ${limit}`;
            } else if (/^\s*\d+\s*$/.test(text)) {
                counter.textContent = String(visible);
            }
        });
    }
    _channelContainsSelf(channelId, states) {
        try {
            const selfId = this._getSelfUserId();
            if (!selfId) return false;
            if (Array.isArray(states) && states.length) {
                return states.some(state => this.extractUserId(state) === selfId);
            }
            const mySelectedVoiceChannel = this.modules.SelectedChannelStore?.getVoiceChannelId?.();
            return Boolean(mySelectedVoiceChannel && mySelectedVoiceChannel === channelId);
        } catch (_) {
            return false;
        }
    }
    fixVoiceChannelIconColors() {
        document.querySelectorAll('[data-list-item-id*="channels"], [class*="voiceChannel"], [class*="linkTop"], [class*="linkBottom"]').forEach(row => {
            const channelRow = row.closest?.('[data-list-item-id*="channels"]') || row.closest?.("li") || row;
            const channelId = this.findChannelId(channelRow) || this.findChannelId(row);
            if (!channelId) return;
            const states = this.getRawVoiceStatesForChannel(channelId);
            const allHidden = states.length > 0 && states.every(state => this.shouldHide(this.extractUserId(state)));
            const anyBlocked = states.length > 0 && states.some(state => this.shouldHide(this.extractUserId(state)));
            const activeOnlyByDom = !states.length && this.looksLikeHiddenOnlyVoiceChannel(channelRow);
            const isHiddenOnly = allHidden || activeOnlyByDom;
            const hasBlockedUsers = anyBlocked || activeOnlyByDom;
            const isMixedChannel = states.length > 0 && anyBlocked && !allHidden;
            let fakeResetExists = this._voiceFakeTimers.has(channelId);
            const selfHereWithOnlyBlocked = isHiddenOnly && !isMixedChannel && this._channelContainsSelf(channelId, states);
            if (this.settings.places.voiceChannels && !fakeResetExists && selfHereWithOnlyBlocked) {
                this._resetFakeVoiceTimer(channelId);
                fakeResetExists = true;
            }
            if (!isHiddenOnly && !hasBlockedUsers) {
                this.restoreVoiceChannelIcon(channelRow);
                this.restoreVoiceChannelTimer(channelRow);
            } else if (isMixedChannel) {
                this.restoreVoiceChannelIcon(channelRow);
            } else {
                channelRow.dataset.nmbMutedVoice = "true";
                channelRow.querySelectorAll('svg, [class*="icon"], [class*="iconLive"]').forEach(icon => {
                    if (!icon.hasAttribute("data-nmb-prev-icon-style")) icon.setAttribute("data-nmb-prev-icon-style", icon.getAttribute("style") || "");
                    icon.style.setProperty("color", "var(--channels-default)", "important");
                    icon.style.setProperty("fill", "currentColor", "important");
                });
                if (this.settings.places.voiceChannels && !fakeResetExists) {
                    channelRow.querySelectorAll('[class*="timer"], [class*="voiceTimer"], [role="timer"], [class*="tabularNumbers"]').forEach(el => {
                        this.hideElement(el, "voice-timer");
                    });
                }
            }
            if (this.settings.places.voiceChannels && fakeResetExists) {
                this._showFakeVoiceTimer(channelRow, channelId);
            } else {
                this._hideFakeVoiceTimer(channelRow, channelId);
            }
        });
    }
    looksLikeHiddenOnlyVoiceChannel(row) {
        const link = row.matches?.('[data-list-item-id*="channels"]') ? row : row.querySelector?.('[data-list-item-id*="channels"]');
        const label = `${link?.getAttribute?.("aria-label") || ""} ${row.textContent || ""}`;
        const hasLiveIcon = Boolean(row.querySelector?.('[class*="iconLive"]'));
        const hasCallDuration = /dura(?:Ã§|c)[aÃ£]o da chamada|call duration|duration/i.test(label);
        if (!hasLiveIcon && !hasCallDuration) return false;
        const container = row.closest?.("li") || row;
        const visibleVoiceRows = Array.from(container.querySelectorAll?.('[class*="voiceUser"], [class*="voiceUser_"], [class*="voiceUser-"], [data-list-item-id*="voice"]') || []).filter(el => el.dataset?.hiddenBlocked !== "true" && el.offsetParent !== null);
        return visibleVoiceRows.length === 0;
    }
    restoreVoiceChannelIcon(row) {
        if (!row?.dataset?.nmbMutedVoice) return;
        delete row.dataset.nmbMutedVoice;
        row.querySelectorAll("[data-nmb-prev-icon-style]").forEach(icon => {
            const previous = icon.getAttribute("data-nmb-prev-icon-style");
            if (previous) icon.setAttribute("style", previous); else icon.removeAttribute("style");
            icon.removeAttribute("data-nmb-prev-icon-style");
        });
    }
    restoreVoiceChannelTimer(row) {
        row?.querySelectorAll?.('[data-hidden-blocked="true"][data-nmb-reason="voice-timer"]').forEach(el => this.restoreElement(el));
    }
    getRawVoiceStatesForChannel(channelId) {
        const fn = this.originalVoiceMethods.getVoiceStatesForChannel || this.modules.SortedVoiceStateStore?.getVoiceStatesForChannel?.bind(this.modules.SortedVoiceStateStore);
        const normalize = raw => {
            const states = Array.isArray(raw) ? raw : Object.values(raw || {});
            return states;
        };
        try {
            if (fn) {
                const channel = this.modules.ChannelStore?.getChannel?.(channelId);
                if (channel) {
                    const raw = fn(channel);
                    const states = normalize(raw);
                    if (states.length) return states;
                }
            }
        } catch (_) { }
        try {
            if (fn) {
                const guildId = this.modules.ChannelStore?.getChannel?.(channelId)?.guild_id
                    || this.modules.SelectedGuildStore?.getGuildId?.();
                if (guildId) {
                    const raw = fn(guildId, channelId);
                    const states = normalize(raw);
                    if (states.length) return states;
                }
            }
        } catch (_) { }
        try {
            if (fn) {
                const raw = fn(channelId);
                const states = normalize(raw);
                if (states.length) return states;
            }
        } catch (_) { }
        try {
            const guildId = this.modules.ChannelStore?.getChannel?.(channelId)?.guild_id
                || this.modules.SelectedGuildStore?.getGuildId?.();
            const byGuild = guildId && this.originalVoiceMethods.getVoiceStates ? this.originalVoiceMethods.getVoiceStates(guildId) : null;
            const channelStates = byGuild?.[channelId];
            return Array.isArray(channelStates) ? channelStates : Object.values(channelStates || {});
        } catch (_) {
            return [];
        }
    }
    getMessageInfo(el) {
        const info = {
            authorId: null,
            referencedAuthorId: null,
            isBlockedGroup: false,
            isSpammer: false,
            messageId: null
        };
        try {
            const uidEl = el.querySelector?.("[data-user-id]");
            if (uidEl?.dataset?.userId) info.authorId = uidEl.dataset.userId;
        } catch (_) {}
        if (!info.authorId) {
            try {
                const avatar = el.querySelector?.('img[src*="/avatars/"]');
                const match = avatar?.src?.match(/\/avatars\/(\d{17,20})/);
                if (match) info.authorId = match[1];
            } catch (_) {}
        }
        if (!info.authorId) {
            const listId = el.dataset?.listItemId || "";
            const idMatch = listId.match(/(\d{17,20})$/) || el.id?.match(/(\d{17,20})/);
            if (idMatch) info.authorId = idMatch[1];
        }
        const visit = props => {
            if (!props || typeof props !== "object") return;
            const message = props.message || props.baseMessage || props.referencedMessage?.message;
            if (message?.id && !info.messageId) info.messageId = message.id;
            if (!info.authorId) {
                if (message?.author?.id) info.authorId = message.author.id;
                else if (props.author?.id) info.authorId = props.author.id;
                else if (props.user?.id) info.authorId = props.user.id;
            }
            if (props.referencedMessage?.message?.author?.id) info.referencedAuthorId = props.referencedMessage.message.author.id;
            if (props.referencedMessage?.author?.id) info.referencedAuthorId = props.referencedMessage.author.id;
            if (message?.messageReference && !info.referencedAuthorId) {
                const ref = this.getReferencedMessage(message);
                if (ref?.author?.id) info.referencedAuthorId = ref.author.id;
            }
            const type = String(props.type || props.messages?.type || "");
            if (/BLOCKED|IGNORED|SPAMMER/i.test(type)) info.isBlockedGroup = true;
            if (/SPAMMER/i.test(type)) info.isSpammer = true;
            if (props.isBlockedMessage === true) info.isBlockedGroup = true;
        };
        if (!info.messageId || !info.authorId || !info.referencedAuthorId) {
            this._walkFiberPropsShallow(el, visit);
        }
        if (!info.messageId) {
            const listId = el.dataset?.listItemId || el.closest?.("[data-list-item-id]")?.dataset?.listItemId || "";
            const pinMatch = listId.match(/^pins_+(\d{17,20})$/);
            if (pinMatch) {
                info.messageId = pinMatch[1];
            } else {
                const chatMatch = listId.match(/^chat-messages___chat-messages-\d+-(\d{17,20})$/);
                if (chatMatch) info.messageId = chatMatch[1];
            }
        }
        return info;
    }
    getReferencedMessage(message) {
        try {
            const ref = message?.messageReference;
            if (!ref) return null;
            return this.modules.MessageStore?.getMessage?.(ref.channel_id, ref.message_id);
        } catch (_) {
            return null;
        }
    }
    _findUserIdDataAttr(el) {
        if (el.dataset?.userId) return el.dataset.userId;
        const uidEl = el.querySelector?.("[data-user-id]");
        return uidEl?.dataset?.userId || null;
    }
    findUserId(el) {
        if (!el) return null;
        let identityKey = "";
        try {
            const fromData = this._findUserIdDataAttr(el);
            if (fromData) return fromData;
            identityKey = el.dataset?.listItemId || el.id || "";
            if (identityKey && el.dataset?.nmbUserId && el.dataset?.nmbUserIdKey === identityKey) {
                return el.dataset.nmbUserId;
            }
            if (identityKey) {
                const idMatch = identityKey.match(/(\d{17,20})$/);
                if (idMatch) {
                    el.dataset.nmbUserId = idMatch[1];
                    el.dataset.nmbUserIdKey = identityKey;
                    return idMatch[1];
                }
            }
        } catch (_) {}
        let found = null;
        try {
            const avatar = el.querySelector?.('img[src*="/avatars/"]');
            const avatarMatch = avatar?.src?.match(/\/avatars\/(\d{17,20})/);
            if (avatarMatch) found = avatarMatch[1];
        } catch (_) {}
        if (!found) {
            this._walkFiberPropsShallow(el, props => {
                if (!found) found = this.extractUserId(props);
            });
        }
        if (found && identityKey) {
            try { el.dataset.nmbUserId = found; el.dataset.nmbUserIdKey = identityKey; } catch (_) {}
        }
        return found;
    }
    _walkFiberPropsShallow(el, visitor) {
        try {
            let fiber = BdApi.ReactUtils.getInternalInstance(el);
            for (let i = 0; i < 10 && fiber; i++, fiber = fiber.return) {
                if (fiber.memoizedProps) visitor(fiber.memoizedProps);
            }
        } catch (_) {}
    }
    extractUserId(value, depth = 0) {
        if (!value || depth > 3) return null;
        if (typeof value === "string" && /^\d{17,20}$/.test(value)) return value;
        if (typeof value !== "object") return null;
        const direct = value.userId || value.authorId || value.recipientId || value.ownerId || value.owner_id || value.creatorId || value.creator_id;
        if (direct && /^\d{17,20}$/.test(String(direct))) return String(direct);
        if (value.id && (value.username || value.discriminator || value.globalName) && /^\d{17,20}$/.test(String(value.id))) {
            return String(value.id);
        }
        const nested = value.user?.id || value.author?.id || value.member?.userId || value.member?.user?.id || value.guildMember?.userId || value.guildMember?.user?.id || value.participant?.userId || value.participant?.user?.id || value.voiceState?.userId || value.message?.author?.id || value.baseMessage?.author?.id || value.recipient?.id || value.channel?.recipientId || value.reactor?.id || value.reactor?.user?.id || value.reactorInfo?.id || value.reactorInfo?.user?.id || value.creator?.id || value.guildScheduledEvent?.creatorId || value.event?.creatorId;
        if (nested && /^\d{17,20}$/.test(String(nested))) return String(nested);
        for (const key of [ "props", "memoizedProps", "pendingProps", "record", "row", "message", "reactor", "reactorInfo" ]) {
            if (value[key]) {
                const found = this.extractUserId(value[key], depth + 1);
                if (found) return found;
            }
        }
        return null;
    }
    walkFiberProps(el, visitor, maxDepth = 12) {
        try {
            let fiber = BdApi.ReactUtils.getInternalInstance(el);
            for (let i = 0; i < maxDepth && fiber; i++, fiber = fiber.return) {
                visitor(fiber.memoizedProps);
                visitor(fiber.pendingProps);
            }
        } catch (_) {}
    }
    findChannelId(el) {
        if (!el) return null;
        try {
            const listId = el.dataset?.listItemId || "";
            const ids = listId.match(/\d{17,20}/g) || el.id?.match(/\d{17,20}/g);
            if (ids?.length) return ids[ids.length - 1];
            if (el.dataset?.channelId) return el.dataset.channelId;
        } catch (_) {}
        return null;
    }
    isVoiceChannelShell(el) {
        if (!el) return false;
        const text = String(el.className || "");
        return text.includes("voiceChannel") || text.includes("linkTop") || text.includes("linkBottom") || Boolean(el.querySelector?.('[class*="channelInfo"]'));
    }
    hideElement(el, reason = "blocked", userId = null) {
        if (!el || el.dataset?.hiddenBlocked === "true") return;
        if (!el.hasAttribute("data-nmb-prev-style")) el.setAttribute("data-nmb-prev-style", el.getAttribute("style") || "");
        const resolvedUserId = userId === false ? null : userId || this.findUserId(el);
        if (resolvedUserId) {
            el.dataset.nmbUserId = resolvedUserId;
            const identityKey = el.dataset?.listItemId || el.id || "";
            if (identityKey) el.dataset.nmbUserIdKey = identityKey;
        }
        el.dataset.hiddenBlocked = "true";
        el.dataset.nmbReason = reason;
        this.hiddenElements.add(el);
    }
    restoreElement(el) {
        if (!el) return;
        const previous = el.getAttribute("data-nmb-prev-style");
        if (previous) el.setAttribute("style", previous); else el.removeAttribute("style");
        delete el.dataset.hiddenBlocked;
        delete el.dataset.nmbReason;
        delete el.dataset.nmbUserId;
        delete el.dataset.nmbUserIdKey;
        el.removeAttribute("data-nmb-prev-style");
        this.hiddenElements.delete(el);
    }
    restoreTemporaryText(el) {
        const previous = el.getAttribute("data-nmb-prev-text");
        if (previous !== null) el.textContent = previous;
        el.removeAttribute("data-nmb-prev-text");
    }
    patchSound() {
        if (!this.settings.behavior.muteVoiceJoinLeaveSound && !this.settings.behavior.muteBlockedVoiceAudio) return;
        const SoundUtils = this.modules.SoundUtils;
        if (!SoundUtils) return;
        const playSoundKey = this._soundPlayKey || "playSound";
        if (typeof SoundUtils[playSoundKey] !== "function") return;
        const RTCUtils = this.modules.RTCConnectionUtils;
        const self = this;
        this.patchInstead(SoundUtils, playSoundKey, function(context, args, originalMethod) {
            const soundType = args[0];
            const isVoiceEvent = [ "disconnect", "user_join", "user_leave", "user_moved", "stream_started", "stream_ended", "activity_launch" ].includes(soundType);
            if (!isVoiceEvent) {
                return originalMethod.apply(context, args);
            }
            if (soundType === "stream_started" || soundType === "stream_ended") {
                if (!self.settings.behavior.muteBlockedVoiceAudio) return originalMethod.apply(context, args);
                const streamerId = self._lastStreamerId;
                if (!streamerId) return originalMethod.apply(context, args);
                if (self.shouldHide(streamerId)) return;
                return originalMethod.apply(context, args);
            }
            if (soundType === "activity_launch") {
                if (!self.settings.behavior.muteVoiceJoinLeaveSound) return originalMethod.apply(context, args);
                const participantIds = self._lastActivityParticipantIds;
                if (!participantIds || !participantIds.size) return originalMethod.apply(context, args);
                const allBlocked = [ ...participantIds ].every(id => self.shouldHide(id));
                if (allBlocked) return;
                return originalMethod.apply(context, args);
            }
            if (!self.settings.behavior.muteVoiceJoinLeaveSound) {
                return originalMethod.apply(context, args);
            }
            let channelId = null;
            if (RTCUtils) {
                try {
                    channelId = RTCUtils.getChannelId();
                } catch (_) {}
            }
            if (!channelId) {
                try {
                    const candidate = self.modules.SelectedChannelStore?.getVoiceChannelId?.();
                    if (candidate) {
                        const resolved = self.modules.ChannelStore?.getChannel?.(candidate);
                        if (resolved && (resolved.type === 2 || resolved.type === 13)) {
                            channelId = candidate;
                        }
                    }
                } catch (_) {}
            }
            if (!channelId) return originalMethod.apply(context, args);
            let voiceStatesList = [];
            try {
                voiceStatesList = self.getRawVoiceStatesForChannel(channelId) || [];
            } catch (_) {}
            const currentIds = new Set(voiceStatesList.map(s => self.extractUserId(s)).filter(Boolean));
            const previousIds = self._oldUnblockedConnectedUsers instanceof Set ? self._oldUnblockedConnectedUsers : new Set((self._oldUnblockedConnectedUsers || []).map(s => self.extractUserId(s)).filter(Boolean));
            self._oldUnblockedConnectedUsers = currentIds;
            if (!currentIds.size && !previousIds.size) return originalMethod.apply(context, args);
            const joined = [ ...currentIds ].filter(id => !previousIds.has(id));
            const left = [ ...previousIds ].filter(id => !currentIds.has(id));
            const changedIds = [ ...joined, ...left ];
            if (!changedIds.length) return originalMethod.apply(context, args);
            const allChangedAreBlocked = changedIds.every(id => self.shouldHide(id));
            if (allChangedAreBlocked) return;
            return originalMethod.apply(context, args);
        });
    }
    patchSoundboardEffects() {
        if (this._soundboardPatched) return;
        const Dispatcher = this.modules.Dispatcher;
        if (!Dispatcher || typeof Dispatcher.dispatch !== "function") return;
        this._soundboardPatched = true;
        const self = this;
        this.patchBefore(Dispatcher, "dispatch", function(context, args) {
            const action = args[0];
            if (!action || typeof action !== "object") return;
            if (action.type === "VOICE_STATE_UPDATES" && Array.isArray(action.voiceStates)) {
                for (const vs of action.voiceStates) {
                    if (vs && vs.selfStream === true && vs.userId) {
                        self._lastStreamerId = vs.userId;
                    } else if (vs && vs.selfStream === false && vs.userId && self._lastStreamerId === vs.userId) {
                        self._lastStreamerId = null;
                    }
                }
                try {
                    self._handleVoiceStateUpdatesForFakeTimer(action.voiceStates);
                } catch (_) {}
                return;
            }
            if (action.type === "EMBEDDED_ACTIVITY_UPDATE_V2") {
                const participants = action.instance?.participants;
                if (Array.isArray(participants)) {
                    self._lastActivityParticipantIds = new Set(participants.map(p => p?.user_id).filter(Boolean));
                    const hasParticipants = self._lastActivityParticipantIds.size > 0;
                    const allBlocked = hasParticipants && [ ...self._lastActivityParticipantIds ].every(id => self.shouldHide(id));
                    if (self.settings.places.voiceChannels && allBlocked) {
                        action.instance.participants = [];
                    }
                }
                return;
            }
            if (action.type === "VOICE_CHANNEL_EFFECT_SEND") {
                if (!self.settings.behavior.muteBlockedVoiceAudio) return;
                const senderId = action.userId;
                if (senderId && self.shouldHide(senderId)) {
                    action.type = "_BYEBLOCKED_SUPPRESSED_VOICE_CHANNEL_EFFECT_SEND";
                }
                return;
            }
            if (self._isChannelStatusUpdateAction(action)) {
                try {
                    self._handleChannelStatusUpdateAction(action);
                } catch (_) {}
                return;
            }
        });
    }
    _isChannelStatusUpdateAction(action) {
        if (!action || typeof action !== "object") return false;
        const type = String(action.type || "");
        if (!/CHANNEL_STATUS|VOICE_STATUS|VOICE_CHANNEL_STATUS/i.test(type)) return false;
        const channelId = action.channelId || action.channel_id || action.id;
        return Boolean(channelId) && ("status" in action || "channelStatus" in action);
    }
    _handleChannelStatusUpdateAction(action) {
        const channelId = action.channelId || action.channel_id || action.id;
        const status = action.status !== undefined ? action.status : action.channelStatus;
        if (!channelId) return;
        if (!this._blockedChannelStatuses) this._blockedChannelStatuses = new Map;
        if (!this._channelStatusAuthors) this._channelStatusAuthors = new Map;
        if (!status) {
            this._blockedChannelStatuses.delete(channelId);
            this._channelStatusAuthors.delete(channelId);
            this._restoreChannelStatusText(channelId);
            return;
        }

        const hasBlockedNow = this._channelHasBlockedMember(channelId);
        if (hasBlockedNow) {
            this._channelStatusAuthors.set(channelId, true);
            this._blockedChannelStatuses.set(channelId, status);
            this._suppressChannelStatusText(channelId);
        } else {
            this._channelStatusAuthors.delete(channelId);
            this._blockedChannelStatuses.delete(channelId);
            this._restoreChannelStatusText(channelId);
        }
    }

    _channelStatusBelongsToBlocked(channelId) {
        try {
            if (this._channelStatusAuthors?.has(channelId)) {
                return this._channelStatusAuthors.get(channelId) === true;
            }

            return this._channelHasBlockedMember(channelId);
        } catch (_) {
            return false;
        }
    }
    _channelHasBlockedMember(channelId) {
        try {
            const states = this.getRawVoiceStatesForChannel(channelId) || [];
            return states.some(state => this.shouldHide(this.extractUserId(state)));
        } catch (_) {
            return false;
        }
    }
    _isChannelStatusPlaceholder(statusEl) {
        if (!statusEl) return true;

        if (statusEl.dataset?.nmbStatusOverridden === "true") return false;
        try {

            const text = (statusEl.textContent || "").trim().toLowerCase();
            if (!text) return true;
            const placeholderTexts = [ "definir um status do canal", "set a channel status" ];
            if (placeholderTexts.some(p => text.includes(p))) return true;
            if (statusEl.querySelector('svg, [class*="pencil" i], [class*="edit" i]')) return true;
            if (statusEl.closest('[role="button"]') && statusEl.querySelector('button, [role="button"]')) return true;
        } catch (_) {}
        return false;
    }
    _suppressChannelStatusText(channelId) {
        if (!this.settings.places.voiceChannels) return;
        const row = this._findChannelRowById(channelId);
        if (!row) return;
        const statusEl = row.querySelector('[class*="channelStatus" i], [class*="voiceChannelStatus" i], [class*="statusText" i]');
        if (this._isChannelStatusPlaceholder(statusEl)) return;
        if (!statusEl) return;

        statusEl.dataset.nmbStatusOverridden = "true";
        delete statusEl.dataset.nmbStatusSafe;
    }
    _restoreChannelStatusText(channelId) {
        const row = this._findChannelRowById(channelId);
        if (!row) return;
        row.querySelectorAll('[data-nmb-status-overridden="true"]').forEach(el => {
            delete el.dataset.nmbStatusOverridden;
            el.dataset.nmbStatusSafe = "true";
        });
        row.querySelectorAll('[data-hidden-blocked="true"][data-nmb-reason="channel-status"]').forEach(el => this.restoreElement(el));
    }
    _resyncBlockedChannelStatuses() {

        if (this._blockedChannelStatuses && this._blockedChannelStatuses.size) {
            for (const channelId of this._blockedChannelStatuses.keys()) {
                this._suppressChannelStatusText(channelId);
            }
        }

        try { this._seedBlockedChannelStatuses(); } catch (_) {}
    }
    _handlePinAdd(action) {
        try {
            const pinnedById = this._extractPinActionPinnerId(action);
            const messageId = action.messageId || action.message?.id;
            const channelId = action.channelId || action.channel_id || null;
            if (!messageId) return;
            if (pinnedById) {
                this._rememberPinPinner(messageId, pinnedById);
                if (this.shouldHide(pinnedById)) this._markMessagePinnedByBlocked(messageId); else this._unmarkMessageUnpinned(messageId);
                return;
            }
            this._schedulePinPinnerRetry(channelId, messageId);
        } catch (_) {}
    }
    _resolvePendingPinFromStore(channelId, messageId) {
        try {
            if (!channelId || !messageId) return;
            const pending = this._pendingPinsByChannel;
            if (!pending || !pending.has(channelId) || !pending.get(channelId).has(messageId)) return;
            const store = this.modules.MessageStore;
            const getRaw = store?.getMessages || store?.getMessagesForChannel || store?.getMessagesForChannelId;
            let list = null;
            try {
                const ret = typeof getRaw === "function" ? getRaw.call(store, channelId) : null;
                if (Array.isArray(ret)) list = ret; else if (Array.isArray(ret?._array)) list = ret._array; else if (ret instanceof Map) list = Array.from(ret.values()); else if (ret && typeof ret === "object") list = Object.values(ret);
            } catch (_) {}
            let matched = null;
            if (Array.isArray(list)) {
                for (let i = list.length - 1; i >= 0; i--) {
                    const msg = list[i];
                    if (msg?.type !== 6) continue;
                    const ref = msg.messageReference?.message_id || msg.message_reference?.message_id;
                    if (ref === messageId) {
                        matched = msg;
                        break;
                    }
                }
            }
            if (matched) {
                this._handlePinSystemMessage(matched);
                this._cleanupPendingPin(channelId, messageId);
            } else {
                this._handleUnresolvedPin(channelId, messageId);
                this._cleanupPendingPin(channelId, messageId);
            }
        } catch (_) {}
    }
    _handleUnresolvedPin(channelId, messageId) {
        try {
            const sys = this._findPinSystemMessage(channelId, messageId);
            const pinnerId = sys?.author?.id;
            if (pinnerId) {
                this._rememberPinPinner(messageId, pinnerId);
                if (this.shouldHide(pinnerId)) this._markMessagePinnedByBlocked(messageId);
            }
        } catch (_) {}
    }
    _handlePinSystemMessage(msg) {
        try {
            if (!msg || msg.type !== 6) return;
            const messageId = msg.messageReference?.message_id || msg.message_reference?.message_id;
            if (!messageId) return;
            const pinnedById = msg.author?.id;
            if (pinnedById) {
                this._rememberPinPinner(messageId, pinnedById);
                if (this.shouldHide(pinnedById)) this._markMessagePinnedByBlocked(messageId); else this._unmarkMessageUnpinned(messageId);
            }
        } catch (_) {}
    }
    _scanExistingPinsForChannel(channelId) {
        try {
            if (!channelId) return;
            const list = this._getChannelMessagesList(channelId);
            for (let i = 0; i < list.length; i++) {
                const msg = list[i];
                if (msg?.type === 6) this._handlePinSystemMessage(msg);
            }
            const items = this.modules.ChannelPinsStore?.getPins?.(channelId)?.items;
            this._processPinStoreItems(channelId, items);
        } catch (_) {}
    }
    resolveInviteQueryModule() {
        const inviteQueryMod = this._wpGetBySource("queryFriends", {
            defaultExport: false
        });
        this.modules.InviteQueryModule = inviteQueryMod || null;
        this.modules.InviteQueryComposeKey = null;
        if (inviteQueryMod) {
            for (const key of Object.keys(inviteQueryMod)) {
                const val = inviteQueryMod[key];
                if (typeof val === "function" && val.toString().includes("queryFriends") && val.toString().includes("queryDMUsers")) {
                    this.modules.InviteQueryComposeKey = key;
                    break;
                }
            }
        }
        if (this.modules.InviteQueryComposeKey) return true;
        return false;
    }
    patchInviteSuggestions(attempt = 0) {
        if (this._inviteSuggestionsPatched) return;
        let mod = this.modules.InviteQueryModule;
        let key = this.modules.InviteQueryComposeKey;
        if (!mod || !key || typeof mod[key] !== "function") {
            const resolved = this.resolveInviteQueryModule();
            mod = this.modules.InviteQueryModule;
            key = this.modules.InviteQueryComposeKey;
            if (!resolved || !mod || !key || typeof mod[key] !== "function") {
                if (attempt < 5) setTimeout(() => this.patchInviteSuggestions(attempt + 1), 5e3);
                return;
            }
        }
        const self = this;
        this.patchAfter(mod, key, function(context, args, result) {
            if (!self.settings.places.autocomplete) return result;
            if (!result || !Array.isArray(result.rows)) return result;
            result.rows = result.rows.filter(row => {
                if (!row) return true;
                if (row.type === "FRIEND" || row.type === "DM") {
                    const userId = row.item?.id;
                    return !(userId && self.shouldHide(userId));
                }
                if (row.type === "GROUP_DM") {
                    const channel = row.item;
                    const recipients = channel?.recipients;
                    if (Array.isArray(recipients) && recipients.length && recipients.every(id => self.shouldHide(id))) {
                        return false;
                    }
                    return true;
                }
                return true;
            });
            return result;
        });
        this._inviteSuggestionsPatched = true;
    }
    patchReactions(attempt = 1) {
        const store = this.modules.ReactionsStore;
        if (!store || typeof store.getReactions !== "function") {
            if (attempt > 5) return;
            setTimeout(() => {
                const getStore = (...names) => this._wpGetStore(...names);
                this.modules.ReactionsStore = getStore("ReactionsStore", "MessageReactionsStore");
                this.patchReactions(attempt + 1);
            }, 2e3);
            return;
        }
        if (!this._reactionsPatched) {
            this.patchAfter(store, "getReactions", (_, __, result) => {
                return this._filterReactionUsers(result);
            });
            this._reactionsPatched = true;
        }
    }
    fixReactionCounts() {
        const store = this.modules.ReactionsStore;
        if (!store || typeof store.getReactions !== "function") return;
        const SelectedChannelStore = this.modules.SelectedChannelStore;
        const channelId = SelectedChannelStore?.getChannelId?.();
        if (!channelId) return;
        const containers = document.querySelectorAll('[id^="message-reactions-"]');
        for (let c = 0; c < containers.length; c++) {
            const container = containers[c];
            const messageIdMatch = container.id.match(/message-reactions-(\d+)$/);
            if (!messageIdMatch) continue;
            const messageId = messageIdMatch[1];
            const rows = container.querySelectorAll('[class*="reactionInner"]');
            let visibleReactionCount = 0;
            for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                const wrapper = row.closest('[class*="reaction_"]') || row.parentElement;
                const emojiImg = row.querySelector('img.emoji, img[class*="emoji"]');
                const countEl = row.querySelector('[class*="reactionCount"]');
                if (!emojiImg || !countEl) continue;
                const emojiName = emojiImg.getAttribute("data-name");
                if (!emojiName) continue;
                const emojiId = emojiImg.getAttribute("data-id") || null;
                const displayedCount = parseInt(countEl.textContent, 10);
                if (!Number.isFinite(displayedCount)) continue;
                let users;
                try {
                    users = this._getFilteredReactions(store, channelId, messageId, {
                        id: emojiId,
                        name: emojiName
                    }, 0);
                } catch (_) {
                    continue;
                }
                const realCount = this._reactionUsersSize(users);
                if (realCount <= 0) {
                    if (row.dataset.nmbZeroReaction !== "true") {
                        row.dataset.nmbZeroReaction = "true";
                    }
                    if (wrapper && wrapper.dataset.nmbZeroReaction !== "true") {
                        wrapper.dataset.nmbZeroReaction = "true";
                    }
                    continue;
                }
                if (row.dataset?.nmbZeroReaction === "true") {
                    delete row.dataset.nmbZeroReaction;
                }
                if (wrapper && wrapper.dataset?.nmbZeroReaction === "true") {
                    delete wrapper.dataset.nmbZeroReaction;
                }
                visibleReactionCount++;
                if (realCount !== displayedCount) {
                    countEl.setAttribute("data-nmb-real-count", String(realCount));
                    countEl.dataset.nmbCountFixed = "true";
                } else if (countEl.dataset?.nmbCountFixed === "true") {
                    delete countEl.dataset.nmbCountFixed;
                    countEl.removeAttribute("data-nmb-real-count");
                }
            }
            if (rows.length > 0 && visibleReactionCount === 0) {
                if (container.dataset.nmbZeroReaction !== "true") container.dataset.nmbZeroReaction = "true";
            } else if (container.dataset?.nmbZeroReaction === "true") {
                delete container.dataset.nmbZeroReaction;
            }
        }
    }
    hideBlockedReactors() {
        try {
            const containers = document.querySelectorAll('[class*="reactorsContainer_"], [class*="reactors_"]');
            for (let c = 0; c < containers.length; c++) {
                const container = containers[c];
                if (container.offsetParent === null) continue;
                const modal = container.closest('[role="dialog"]') || container.closest('[class*="layer"]');
                const messageId = this._resolveReactorsModalMessageId(modal || container);
                const rows = container.querySelectorAll('[class*="reactorClickable_"]');
                let visibleRemaining = 0;
                let unresolvedCount = 0;
                rows.forEach(row => {
                    if (row.dataset?.nmbReactorHidden === "true") return;
                    let userId = this.findUserId(row);
                    if (!userId) userId = this.resolveReactorIdByName(row);
                    if (!userId) {
                        unresolvedCount++;
                        return;
                    }
                    if (this.shouldHide(userId)) {
                        this._hideReactorEntry(row);
                    } else {
                        visibleRemaining++;
                    }
                });
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                const emoji = this._getActiveModalEmoji(modal);
                if (messageId && channelId && emoji) {
                    this._hideGhostReactorSlots(container, messageId, channelId, emoji);
                    this.fixReactionCounts();
                }
                const allTabs = modal ? Array.from(modal.querySelectorAll('[class*="reactionSelected_"], [class*="reactionDefault_"]')) : [];
                const activeTab = allTabs.find(tab => tab.getAttribute("aria-selected") === "true" || tab.className.includes("reactionSelected_")) || null;
                const realCounts = allTabs.length ? this._fixModalTabCounts(allTabs, messageId) : new Map;
                const activeTabRealCount = activeTab ? realCounts.get(activeTab) : undefined;
                const rowsSayEmpty = rows.length > 0 && unresolvedCount === 0 && visibleRemaining === 0;
                const storeSaysEmpty = activeTabRealCount === 0;
                const genuinelyEmpty = rowsSayEmpty || storeSaysEmpty;
                if (genuinelyEmpty) {
                    if (activeTab && activeTab.dataset.nmbTabHidden !== "true") activeTab.dataset.nmbTabHidden = "true";
                    if (allTabs.length > 1 && activeTab) {
                        const activeTabKey = activeTab.querySelector('img[class*="emoji"]')?.getAttribute("alt") || "unknown";
                        const otherTab = allTabs.find(tab => tab !== activeTab && tab.dataset.nmbTabHidden !== "true");
                        if (otherTab && modal && modal.dataset.nmbSwitchedFrom !== activeTabKey) {
                            modal.dataset.nmbSwitchedFrom = activeTabKey;
                            otherTab.dispatchEvent(new MouseEvent("mousedown", {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            }));
                            otherTab.dispatchEvent(new MouseEvent("mouseup", {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            }));
                            otherTab.dispatchEvent(new MouseEvent("click", {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            }));
                        }
                    } else if (allTabs.length <= 1 && modal && modal.dataset.nmbAutoClosed !== "true") {
                        if (!modal.dataset.nmbEmptySeenAt) {
                            modal.dataset.nmbEmptySeenAt = String(Date.now());
                        } else if (Date.now() - Number(modal.dataset.nmbEmptySeenAt) > 900) {
                            modal.dataset.nmbAutoClosed = "true";
                            const closeBtn = modal.querySelector('[aria-label="Fechar"], [aria-label="Close"]');
                            if (closeBtn) closeBtn.click();
                        }
                    }
                } else {
                    if (activeTab?.dataset.nmbTabHidden === "true") delete activeTab.dataset.nmbTabHidden;
                    if (modal?.dataset.nmbEmptySeenAt) delete modal.dataset.nmbEmptySeenAt;
                    if (modal?.dataset.nmbSwitchedFrom) delete modal.dataset.nmbSwitchedFrom;
                    this._cleanupReactorModalLoading(container);
                }
                allTabs.forEach(tab => {
                    if (tab === activeTab) return;
                    const tabRealCount = realCounts.get(tab);
                    if (tabRealCount === 0) {
                        if (tab.dataset.nmbTabHidden !== "true") tab.dataset.nmbTabHidden = "true";
                    } else if (tab.dataset.nmbTabHidden === "true") {
                        delete tab.dataset.nmbTabHidden;
                    }
                });
            }
        } catch (_) {}
    }
    _fixModalTabCounts(tabs, messageId) {
        const realCounts = new Map;
        try {
            const store = this.modules.ReactionsStore;
            if (!store || typeof store.getReactions !== "function") return realCounts;
            const SelectedChannelStore = this.modules.SelectedChannelStore;
            const channelId = SelectedChannelStore?.getChannelId?.();
            if (!channelId || !messageId) return realCounts;
            tabs.forEach(tab => {
                const emojiImg = tab.querySelector('img[class*="emoji"]');
                const countEl = Array.from(tab.children).find(child => child !== emojiImg && /^\d+$/.test((child.textContent || "").trim()));
                if (!emojiImg || !countEl) return;
                const name = emojiImg.getAttribute("alt");
                if (!name) return;
                const id = emojiImg.getAttribute("data-id") || null;
                const users = this._getFilteredReactions(store, channelId, messageId, {
                    id: id,
                    name: name
                }, 0);
                const realCount = this._reactionUsersSize(users);
                realCounts.set(tab, realCount);
                const displayedCount = parseInt(countEl.textContent, 10);
                if (Number.isFinite(displayedCount) && realCount !== displayedCount) {
                    countEl.setAttribute("data-nmb-real-count", String(realCount));
                    countEl.dataset.nmbCountFixed = "true";
                } else if (countEl.dataset?.nmbCountFixed === "true") {
                    delete countEl.dataset.nmbCountFixed;
                    countEl.removeAttribute("data-nmb-real-count");
                }
            });
        } catch (_) {}
        return realCounts;
    }
    resolveReactorIdByName(row) {
        try {
            const UserStore = this.modules.UserStore;
            if (!UserStore || typeof UserStore.getUsers !== "function") return null;
            const nameEl = row.querySelector('[class*="reactorInfo_"] strong, [class*="defaultColor_"]');
            const displayName = (nameEl?.textContent || "").trim();
            if (!displayName) return null;
            const users = UserStore.getUsers();
            const matches = [];
            for (const id in users) {
                const u = users[id];
                if (!u) continue;
                if (u.username === displayName || u.globalName === displayName) matches.push(u.id);
            }
            if (matches.length === 1) return matches[0];
            return null;
        } catch (_) {
            return null;
        }
    }
    addStyles() {
        this.removeStyles();
        const hideBlockedBanner = this.settings.places.messages ? `\n            [class*="messageGroupBlocked"],\n            [class*="blockedSystemMessage"],\n            [class*="groupStart"]:has([class*="blocked"]),\n            li[class*="messageListItem"]:has([class*="messageGroupBlocked"]),\n            li[class*="messageListItem"]:has([class*="blockedSystemMessage"]),\n            li[class*="messageListItem"]:has([class*="blocked"][class*="message"]),\n            [class*="messageListItem"]:has([class*="messageGroupBlocked"]) {\n                display: none !important;\n                height: 0 !important;\n                min-height: 0 !important;\n                max-height: 0 !important;\n                padding: 0 !important;\n                margin: 0 !important;\n                overflow: hidden !important;\n                contain: size style !important;\n            }\n        ` : "";
        const eventsSidebarNameRule = this.settings.places.events ? `\n            li:has([data-list-item-id^="channels___upcoming-events-"]) {\n                visibility: hidden !important;\n            }\n            li:has([data-list-item-id^="channels___upcoming-events-"]):has([data-nmb-events-ready="true"]) {\n                visibility: visible !important;\n            }\n        ` : "";
        const noticeButtonStyles = `\n            .bd-notice button,\n            .bd-notice .bd-button,\n            .bd-notice [class*="button"],\n            .bd-notice [role="button"] {\n                background: transparent !important;\n                border: 1px solid var(--text-muted) !important;\n                color: var(--text-normal) !important;\n                transition: background 0.15s, border-color 0.15s !important;\n            }\n            .bd-notice button:hover,\n            .bd-notice .bd-button:hover,\n            .bd-notice [class*="button"]:hover,\n            .bd-notice [role="button"]:hover {\n                background: rgba(255, 255, 255, 0.08) !important;\n                border-color: var(--brand-experiment) !important;\n                color: var(--text-normal) !important;\n            }\n        `;
        BdApi.DOM.addStyle(this.pluginName, `\n            [data-hidden-blocked="true"],\n            [data-hidden-blocked="true"] * { ${this.hideStyles} }\n            h1[data-nmb-header-hidden="true"] {\n                font-size: 0 !important;\n                line-height: 0 !important;\n            }\n            h1[data-nmb-header-hidden="true"] [data-nmb-header-overlay="true"] {\n                font-size: var(--nmb-header-restore-size, 20px) !important;\n                line-height: var(--nmb-header-restore-line-height, normal) !important;\n            }\n            [data-nmb-zero-reaction="true"] { display: none !important; pointer-events: none !important; }\n            [data-nmb-hide-view-reactions="true"] { display: none !important; pointer-events: none !important; }\n            [class*="reactorClickable_"][data-nmb-reactor-hidden="true"],\n            [data-nmb-reactor-hidden="true"]:not([class*="reactorsContainer_"]):not([class*="reactors_"]) {\n                display: none !important;\n                pointer-events: none !important;\n                height: 0 !important;\n                min-height: 0 !important;\n                max-height: 0 !important;\n                margin: 0 !important;\n                padding: 0 !important;\n                overflow: hidden !important;\n            }\n            [data-nmb-reactor-remove-hidden="true"] {\n                display: none !important;\n                pointer-events: none !important;\n            }\n            [data-nmb-pin-badge-hidden="true"] {\n                display: none !important;\n                pointer-events: none !important;\n            }\n            [data-nmb-loading-hidden="true"] { display: none !important; pointer-events: none !important; }\n            [data-nmb-tab-hidden="true"] { display: none !important; pointer-events: none !important; }\n            [data-nmb-count-fixed="true"] {\n                font-size: 0 !important;\n                position: relative !important;\n            }\n            [data-nmb-count-fixed="true"]::after {\n                content: attr(data-nmb-real-count);\n                font-size: 14px;\n            }\n            [data-nmb-status-overridden="true"] {\n                display: none !important;\n            }\n            [class*="messageGroupStart"]:empty,\n            [class*="messageGroupBlocked"]:empty { display: none !important; }\n            [data-nmb-ghost="true"] {\n                display: none !important;\n                height: 0 !important;\n                min-height: 0 !important;\n                max-height: 0 !important;\n                padding: 0 !important;\n                margin: 0 !important;\n                overflow: hidden !important;\n                contain: size style !important;\n            }\n            ${eventsSidebarNameRule}\n            ${hideBlockedBanner}\n            [data-nmb-promoted="true"] [class*="compact"],\n            [data-nmb-promoted="true"] [class*="cozy"] { margin-top: 17px !important; }\n            [data-nmb-promoted="true"] [class*="avatar"],\n            [data-nmb-promoted="true"] img[class*="avatar"] { display: block !important; }\n            [data-nmb-promoted="true"] [class*="username"],\n            [data-nmb-promoted="true"] [class*="header_"],\n            [data-nmb-promoted="true"] [class*="cozyHeader"] { display: flex !important; }\n            [class*="channelInfo"] { display: flex !important; align-items: center !important; gap: 4px !important; }\n            [data-nmb-muted-voice="true"] svg,\n            [data-nmb-muted-voice="true"] [class*="icon"],\n            [data-nmb-muted-voice="true"] [class*="iconLive"] {\n                color: var(--channels-default) !important;\n                fill: currentColor !important;\n            }\n            [class*="bd-modal-large"],\n            [class*="bd-modal"][class*="large"] { width: 90vw !important; max-width: 860px !important; }\n            [class*="bd-modal-body"] { max-height: 82vh !important; }\n            .nmb-panel {\n                padding: 16px 20px;\n                color: var(--text-normal);\n                font-family: var(--font-primary);\n                max-width: 720px;\n                -webkit-font-smoothing: antialiased;\n                -moz-osx-font-smoothing: grayscale;\n                text-rendering: optimizeLegibility;\n                transform: translateZ(0);\n                backface-visibility: hidden;\n            }\n            .nmb-header-minimal {\n                display: flex;\n                align-items: baseline;\n                gap: 10px;\n                margin-bottom: 12px;\n                padding-bottom: 10px;\n                border-bottom: 1px solid var(--background-modifier-accent);\n            }\n            .nmb-plugin-name { font-size: 22px; font-weight: 700; color: var(--header-primary); }\n            .nmb-version { font-size: 15px; color: var(--text-muted); font-weight: 500; }\n            .nmb-section {\n                background: var(--background-secondary);\n                border-radius: 8px;\n                margin-bottom: 8px;\n                overflow: hidden;\n                border: 1px solid var(--background-modifier-accent);\n            }\n            .nmb-section-header {\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                padding: 10px 16px;\n                cursor: pointer;\n                user-select: none;\n                transition: background 160ms ease !important;\n                background: transparent;\n            }\n            .nmb-panel .nmb-section-header:hover { background: var(--background-modifier-hover) !important; }\n            .nmb-section-title {\n                font-size: 12px;\n                font-weight: 600;\n                text-transform: uppercase;\n                letter-spacing: 0.5px;\n                color: var(--header-secondary);\n                margin: 0;\n            }\n            .nmb-chevron {\n                width: 16px;\n                height: 16px;\n                color: var(--text-muted);\n                transition: transform 220ms ease;\n                flex-shrink: 0;\n            }\n            .nmb-section.is-open .nmb-chevron { transform: rotate(180deg); }\n            .nmb-section-body {\n                display: grid;\n                grid-template-rows: 0fr;\n                transition: grid-template-rows 200ms ease;\n            }\n            .nmb-section.is-open .nmb-section-body { grid-template-rows: 1fr; }\n            .nmb-section-body-inner { overflow: hidden; padding: 0 16px; }\n            .nmb-section.is-open .nmb-section-body-inner { padding: 4px 16px 10px; }\n            .nmb-row {\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                gap: 12px;\n                padding: 6px 6px;\n                border-radius: 4px;\n                transition: background 150ms ease !important;\n                background: transparent;\n            }\n            .nmb-panel .nmb-row:hover { background: var(--background-modifier-hover) !important; }\n            .nmb-row-label { font-size: 14px; color: var(--text-normal); }\n            .nmb-switch {\n                position: relative;\n                width: 34px;\n                height: 18px;\n                flex-shrink: 0;\n                border-radius: 9px;\n                background: var(--background-tertiary);\n                cursor: pointer;\n                transition: background 160ms ease, box-shadow 160ms ease;\n            }\n            .nmb-switch:hover { box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.25); }\n            .nmb-switch.is-on { background: var(--brand-experiment, #5865f2); }\n            .nmb-switch-knob {\n                position: absolute;\n                top: 2px;\n                left: 2px;\n                width: 14px;\n                height: 14px;\n                border-radius: 50%;\n                background: #fff;\n                box-shadow: 0 1px 2px rgba(0,0,0,0.3);\n                transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);\n            }\n            .nmb-switch.is-on .nmb-switch-knob { transform: translateX(16px); }\n            .nmb-actions {\n                display: flex;\n                align-items: center;\n                flex-wrap: wrap;\n                gap: 8px;\n                margin-top: 28px;\n                padding: 12px 0;\n                border-top: 1px solid var(--background-modifier-accent);\n            }\n            .nmb-update-btn {\n                display: inline-flex;\n                align-items: center;\n                gap: 6px;\n                border-radius: 6px;\n                font-weight: 600;\n                cursor: pointer;\n                transition: background 160ms ease, color 160ms ease, border-color 160ms ease, transform 120ms ease, box-shadow 160ms ease;\n                white-space: nowrap;\n                padding: 8px 14px;\n                font-size: 13px;\n                background: var(--brand-experiment, #5865f2);\n                color: #fff;\n                border: none;\n            }\n            .nmb-btn-icon { width: 14px; height: 14px; flex-shrink: 0; }\n            .nmb-update-btn:hover:not(:disabled) {\n                background: var(--brand-experiment-hover, #4752c4);\n                transform: translateY(-1px);\n                box-shadow: 0 2px 8px rgba(0,0,0,0.25);\n            }\n            .nmb-update-btn:disabled { opacity: 0.55; cursor: default; }\n            .nmb-update-btn.is-checking .nmb-btn-icon { animation: nmb-spin 0.8s linear infinite; }\n            @keyframes nmb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }\n            .nmb-update-btn.is-up-to-date {\n                background: var(--text-positive, #23a559);\n                color: #fff;\n                border: none;\n            }\n            .nmb-update-btn.is-up-to-date:hover:not(:disabled) {\n                background: #1e8f4e;\n                box-shadow: 0 2px 8px rgba(0,0,0,0.25);\n            }\n            .nmb-update-btn.is-update-available {\n                background: var(--brand-experiment, #5865f2);\n                color: #fff;\n                border: none;\n                animation: nmb-pulse-update 2s ease-in-out infinite;\n            }\n            .nmb-update-btn.is-update-available:hover { filter: brightness(1.1); }\n            .nmb-update-btn.is-error {\n                background: var(--text-danger, #f23f43);\n                color: #fff;\n                border: none;\n            }\n            .nmb-update-btn.is-error:hover:not(:disabled) {\n                background: #d73338;\n                box-shadow: 0 2px 8px rgba(0,0,0,0.25);\n            }\n            @keyframes nmb-pulse-update {\n                0%, 100% { box-shadow: 0 0 0 0 rgba(88,101,242,0.4); }\n                50% { box-shadow: 0 0 0 6px rgba(88,101,242,0); }\n            }\n            .nmb-last-check { font-size: 12px; color: var(--text-muted); }\n            .nmb-pins-empty-placeholder {\n                display: flex;\n                flex-direction: column;\n                align-items: center;\n                justify-content: center;\n                text-align: center;\n            }\n            .nmb-pins-empty-placeholder .image_e8b59c {\n                width: 120px;\n                height: 120px;\n                background-size: contain;\n                background-repeat: no-repeat;\n                background-position: center;\n            }\n            .nmb-pins-empty-placeholder .body_e8b59c {\n                display: block;\n                height: auto;\n                white-space: normal;\n            }\n            .nmb-pins-empty-footer {\n                flex-shrink: 0;\n            }\n            .nmb-injected-forum-empty {\n                display: flex;\n                flex-direction: column;\n                align-items: center;\n                justify-content: center;\n                text-align: center;\n                width: 100%;\n                padding: 60px 16px;\n                gap: 8px;\n            }\n\n            ${noticeButtonStyles}\n        `);
    }
    removeStyles() {
        try {
            BdApi.DOM.removeStyle(this.pluginName);
        } catch (_) {}
        document.getElementById(`${this.pluginName}-CSS`)?.remove();
    }
    toast(message, type = "info") {
        try {
            BdApi.UI.showToast(message, {
                type: type
            });
        } catch (_) {}
    }
    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "nmb-panel";
        panel.innerHTML = `\n            <div class="nmb-header-minimal">\n                <span class="nmb-plugin-name">\n                    <span class="nmb-version"> v${ByeBlocked.VERSION}</span>\n                </span>\n            </div>\n            ${this._renderSettingsSection("types", "Hide users by type", true)}\n            ${this._renderSettingsSection("places", "Where to hide", true)}\n            ${this._renderSettingsSection("behavior", "Behavior", true)}\n            <div class="nmb-actions">\n                <button class="nmb-update-btn" data-nmb-update-btn>\n                    <svg class="nmb-btn-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">\n                        <path d="M14 2v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>\n                        <path d="M13.5 7A5.5 5.5 0 1 1 10.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>\n                    </svg>\n                    <span class="nmb-btn-label">Check for updates</span>\n                </button>\n                <span class="nmb-last-check" data-nmb-last-check>Last check: ${this._formatDate(this._lastCheckTimestamp)}</span>\n            </div>\n        `;
        if (this._updateState.status === "available") {
            this._renderUpdateBtn(panel);
        } else {
            const oneHour = 36e5;
            const lastCheck = this._lastCheckTimestamp || 0;
            if (Date.now() - lastCheck > oneHour) {
                this.checkForUpdates(panel, true);
            } else {
                this._renderUpdateBtn(panel);
            }
        }
        panel.addEventListener("click", event => this._onSettingsPanelClick(event, panel));
        setTimeout(() => {
            panel.scrollIntoView({
                block: "start",
                behavior: "smooth"
            });
        }, 50);
        return panel;
    }
    _onSettingsPanelClick(event, panel) {
        const updateBtn = event.target.closest("[data-nmb-update-btn]");
        if (updateBtn) {
            if (this._updateState.status === "available" && this._updateState.remoteText) {
                this._autoInstall(this._updateState.latestVersion, this._updateState.remoteText, panel);
            } else {
                this.checkForUpdates(panel, false);
            }
            return;
        }
        const header = event.target.closest(".nmb-section-header");
        if (header) {
            header.closest(".nmb-section")?.classList.toggle("is-open");
            return;
        }
        const switchEl = event.target.closest(".nmb-switch");
        if (switchEl) {
            this._onSettingsToggle(switchEl);
        }
    }
    _onSettingsToggle(switchEl) {
        const { section, key } = switchEl.dataset;
        const next = !this.settings[section][key];
        this.settings[section][key] = next;
        switchEl.classList.toggle("is-on", next);
        this.saveSettings();
        if (section === "behavior" && key === "muteVoiceJoinLeaveSound") {
            if (next) {
                setTimeout(() => { this.patchSound(); this.patchSoundboardEffects(); this.toast("Voice sound suppression activated.", "info"); }, 1e3);
            } else {
                this.toast("Please reload the plugin for changes to take effect.", "warn");
            }
        }
        if (section === "behavior" && key === "muteBlockedVoiceAudio") {
            if (next) {
                setTimeout(() => { this.patchVoiceMute(); this.patchSound(); this.patchSoundboardEffects(); this.toast("Blocked users' voice audio will now be muted.", "info"); }, 200);
            } else {
                this._releaseAllVoiceMutes();
                this.toast("Please reload the plugin for changes to take effect.", "warn");
            }
        }
        if (section === "behavior" && key === "suppressTaskbarBadge") {
            this._refreshTaskbarBadge();
        }
        this.queueRefresh();
    }
    _renderSettingsSection(section, title, openByDefault = false) {
        const rows = Object.keys(this.settings[section]).map(key => this._renderSettingsRow(key, section)).join("");
        return `\n            <section class="nmb-section ${openByDefault ? "is-open" : ""}">\n                <div class="nmb-section-header">\n                    <p class="nmb-section-title">${title}</p>\n                    <svg class="nmb-chevron" viewBox="0 0 24 24" fill="none">\n                        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>\n                    </svg>\n                </div>\n                <div class="nmb-section-body">\n                    <div class="nmb-section-body-inner">${rows}</div>\n                </div>\n            </section>\n        `;
    }
    _renderSettingsRow(key, section) {
        const isOn = this.settings[section][key];
        const label = ByeBlocked.SETTINGS_LABELS[key] || key;
        return `\n                <div class="nmb-row">\n                    <div class="nmb-row-label-wrap">\n                        <span class="nmb-row-label">${label}</span>\n                    </div>\n                    <div class="nmb-switch ${isOn ? "is-on" : ""}" data-section="${section}" data-key="${key}">\n                        <div class="nmb-switch-knob"></div>\n                    </div>\n                </div>\n            `;
    }
};
