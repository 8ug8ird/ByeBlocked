/**
 * @name ByeBlocked
 * @author 8ug8ird
 * @authorId 698947564459917343
 * @version 1.0.13
 * @description Hides blocked and ignored users from chat, voice, and member lists.
 * @source https://github.com/8ug8ird/ByeBlocked
 */

module.exports = class ByeBlocked {
    static VERSION     = "1.0.13";
    static RAW_URL     = "https://raw.githubusercontent.com/8ug8ird/ByeBlocked/refs/heads/main/ByeBlocked.plugin.js";
    static RELEASE_URL = "https://github.com/8ug8ird/ByeBlocked";

    constructor() {
        this.pluginName = "ByeBlocked";
        this.observer = null;
        this.scanInterval = null;
        this.scanTimeout = null;
        this.refreshTimeout = null;
        this.saveTimeout = null;
        this.relationshipChangeHandler = null;
        this.isRunning = false;

        this.guildChangeHandler = null;
        this.routerChangeHandler = null;
        this._routerUnsubscribe = null;
        this._refreshDebounce = null;
        this._chatContentObserver = null;

        this.patches = [];
        this.hiddenElements = new Set();
        this.hiddenParents = new Set();
        this.modules = {};
        this.originalVoiceMethods = {};
        this.settings = this.loadSettings();
        this._updateState = { status: "idle", latestVersion: null, remoteText: null };
        this._updateNotice = null;
        this._lastNotifiedVersion = null;
        this._periodicCheckInterval = null;
        this._lastCheckTimestamp = this.loadLastCheck();

        this.hideStyles = `
            display: none !important;
            width: 0 !important;
            height: 0 !important;
            min-width: 0 !important;
            min-height: 0 !important;
            max-width: 0 !important;
            max-height: 0 !important;
            flex: 0 0 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            border: 0 !important;
            overflow: hidden !important;
            position: absolute !important;
            opacity: 0 !important;
            pointer-events: none !important;
            transform: scale(0) !important;
            visibility: hidden !important;
            line-height: 0 !important;
            font-size: 0 !important;
            contain: size style !important;
        `;
    }

    _formatDate(timestamp) {
        if (!timestamp) return "No check yet";
        try {
            const date = new Date(timestamp);
            return date.toLocaleString('en-US', {
                month: '2-digit',
                day: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
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
            BdApi.UI.showConfirmationModal(
                '⚙️ ByeBlocked Settings',
                React.createElement(function() {
                    const ref = React.useRef(null);
                    React.useEffect(function() {
                        if (ref.current) {
                            ref.current.appendChild(self.getSettingsPanel());
                        }
                    }, []);
                    return React.createElement('div', { ref });
                }),
                { confirmText: 'Done', cancelText: null, size: 'large' }
            );
        } catch(_) {
            this.toast('Go to BD Settings → Plugins → ByeBlocked ⚙️', 'info');
        }
    }

    async checkForUpdatesAuto() {
        if (this._updateState.status === "checking") return;
        this._updateState = { status: "checking", latestVersion: null, remoteText: null };

        try {
            const text = await this._httpsGet(ByeBlocked.RAW_URL);
            const match = text.match(/@version\s+([\d.]+)/);
            if (!match) throw new Error("Version tag not found");

            const remote = match[1];
            const local  = ByeBlocked.VERSION;
            const hasUpdate = this._compareVersions(remote, local) > 0;

            this._updateLastCheckTime();

            if (hasUpdate) {
                if (remote !== this._lastNotifiedVersion) {
                    this._lastNotifiedVersion = remote;
                    this._removeNotice();

                    try {
                        this._updateNotice = BdApi.UI.showNotice(
                            `🎉 ByeBlocked v${remote} is out! You're on v${local} - update available.`,
                            {
                                timeout: 0,
                                buttons: [
                                    {
                                        label: "Install now",
                                        onClick: () => {
                                            if (this._updateNotice) {
                                                try { this._updateNotice.close(); } catch (_) {}
                                                this._updateNotice = null;
                                            }
                                            this._autoInstall(remote, text);
                                        }
                                    },
                                    {
                                        label: "View on GitHub",
                                        onClick: () => {
                                            try { require("electron").shell.openExternal(ByeBlocked.RELEASE_URL); }
                                            catch (_) { window.open(ByeBlocked.RELEASE_URL, "_blank"); }
                                        }
                                    }
                                ]
                            }
                        );
                    } catch (_) {
                        this.toast(`🎉 ByeBlocked v${remote} available! Go to settings.`, "info");
                    }
                }

                this._updateState = { status: "available", latestVersion: remote, remoteText: text };
            } else {
                this._updateState = { status: "idle", latestVersion: null, remoteText: null };
            }
        } catch (_) {
            this._updateState = { status: "idle", latestVersion: null, remoteText: null };
        }
    }

    _removeNotice() {
        try {
            if (this._updateNotice) {
                if (typeof this._updateNotice.close === 'function') {
                    this._updateNotice.close();
                } else if (typeof this._updateNotice.remove === 'function') {
                    this._updateNotice.remove();
                }
                this._updateNotice = null;
            }
            document.querySelectorAll('.bd-notice').forEach(el => {
                if (el.textContent && el.textContent.includes('ByeBlocked')) {
                    const closeBtn = el.querySelector('.bd-close-button, [aria-label="Close"]');
                    if (closeBtn) closeBtn.click();
                    else el.remove();
                }
            });
        } catch (_) {}
    }

    async checkForUpdates(panelRef = null, silent = false) {
        if (this._updateState.status === "checking") return;
        this._updateState = { status: "checking", latestVersion: null, remoteText: null };
        this._renderUpdateBtn(panelRef);

        try {
            const text = await this._httpsGet(ByeBlocked.RAW_URL);
            const match = text.match(/@version\s+([\d.]+)/);
            if (!match) throw new Error("Version tag not found in remote file");

            const remote = match[1];
            const local  = ByeBlocked.VERSION;
            const hasUpdate = this._compareVersions(remote, local) > 0;

            this._updateLastCheckTime();
            this._updatePanelInfo(panelRef);

            if (hasUpdate) {
                this._updateState = { status: "available", latestVersion: remote, remoteText: text };
                this._renderUpdateBtn(panelRef);
                if (!silent) {
                    try {
                        this._updateNotice = BdApi.UI.showNotice(
                            `🎉 ByeBlocked v${remote} is out! You're on v${local} — update available.`,
                            {
                                timeout: 0,
                                buttons: [
                                    {
                                        label: "Install now",
                                        onClick: () => {
                                            if (this._updateNotice) {
                                                try { this._updateNotice.close(); } catch (_) {}
                                                this._updateNotice = null;
                                            }
                                            this._autoInstall(remote, text, panelRef);
                                        }
                                    },
                                    {
                                        label: "View on GitHub",
                                        onClick: () => {
                                            try { require("electron").shell.openExternal(ByeBlocked.RELEASE_URL); }
                                            catch (_) { window.open(ByeBlocked.RELEASE_URL, "_blank"); }
                                        }
                                    }
                                ]
                            }
                        );
                    } catch (_) {
                        this.toast(`Update available: v${remote}. Visit GitHub to download.`, "info");
                    }
                }
            } else {
                this._updateState = { status: "upToDate", latestVersion: remote, remoteText: null };
                this._renderUpdateBtn(panelRef);
                if (!silent) {
                    this.toast("ByeBlocked is up to date!", "success");
                }
            }
        } catch (err) {
            this._updateState = { status: "error", latestVersion: null, remoteText: null };
            this._renderUpdateBtn(panelRef);
            if (!silent) {
                this.toast("Error checking for updates: " + err.message, "error");
                console.error("[ByeBlocked] Manual check error:", err);
            }
        }
    }

    _updatePanelInfo(panelRef) {
        if (!panelRef) return;
        const infoEl = panelRef.querySelector('[data-nmb-last-check]');
        if (infoEl) {
            infoEl.textContent = `Last check: ${this._formatDate(this._lastCheckTimestamp)}`;
        }
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

        const _require = typeof window !== "undefined" && typeof window.require === "function"
            ? window.require
            : (typeof __non_webpack_require__ !== "undefined" ? __non_webpack_require__ : null);

        if (_require) {
            return new Promise((resolve, reject) => {
                try {
                    const https  = _require("https");
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
                        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                        const chunks = [];
                        res.on("data", c => chunks.push(c));
                        res.on("end",  () => resolve(Buffer.concat(chunks).toString("utf8")));
                        res.on("error", reject);
                    });
                    req.on("error", reject);
                    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
                    req.end();
                } catch (err) { reject(err); }
            });
        }

        const res = await fetch(url, {
            headers: { "User-Agent": "ByeBlocked-UpdateChecker/1.0", "Cache-Control": "no-cache" }
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
        try {
            this._removeNotice();

            const fs   = require("fs");
            const path = require("path");
            const pluginsDir = BdApi.Plugins.folder;
            const dest = path.join(pluginsDir, "ByeBlocked.plugin.js");
            fs.writeFileSync(dest, remoteText, "utf8");

            this._updateState = { status: "upToDate", latestVersion: remoteVersion, remoteText: null };
            this._renderUpdateBtn(panelRef);
            this._lastNotifiedVersion = remoteVersion;

            this.toast(`ByeBlocked updated to v${remoteVersion}!`, "success");

            setTimeout(() => {
                try {
                    const pluginName = this.pluginName;
                    if (BdApi.Plugins.isEnabled(pluginName)) {
                        BdApi.Plugins.disable(pluginName);
                    }
                    BdApi.Plugins.enable(pluginName);
                    this.toast(`Plugin successfully re-activated (v${remoteVersion})!`, "success");
                } catch (e) {
                    console.error("[ByeBlocked] Error reactivating:", e);
                    this.toast("Plugin updated, but couldn't auto-reactivate. Disable and re-enable manually.", "warn");
                }
            }, 800);
        } catch (err) {
            this.toast("Auto-install failed: " + err.message + " — download manually from GitHub.", "error");
            try { require("electron").shell.openExternal(ByeBlocked.RELEASE_URL); }
            catch (_) { window.open(ByeBlocked.RELEASE_URL, "_blank"); }
        }
    }

    _renderUpdateBtn(panelRef) {
        if (!panelRef) return;
        const btn = panelRef.querySelector("[data-nmb-update-btn]");
        if (!btn) return;

        const iconPaths = {
            idle:      `<path d="M14 2v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 7A5.5 5.5 0 1 1 10.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
            checking:  `<path d="M14 2v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 7A5.5 5.5 0 1 1 10.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
            upToDate:  `<path d="M2.5 8.5l3.5 3.5 7.5-7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
            available: `<path d="M8 2v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
            error:     `<path d="M8 3.5v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>`
        };

        const states = {
            idle:      { label: "Check for updates",  cls: "",                    disabled: false },
            checking:  { label: "Checking…",           cls: "is-checking",         disabled: true  },
            upToDate:  { label: "Up to date",          cls: "is-up-to-date",       disabled: false },
            available: { label: "Install update",      cls: "is-update-available", disabled: false },
            error:     { label: "Error — try again",   cls: "is-error",            disabled: false }
        };
        const s    = states[this._updateState.status] || states.idle;
        const icon = iconPaths[this._updateState.status] || iconPaths.idle;

        const labelEl = btn.querySelector(".nmb-btn-label");
        const iconEl  = btn.querySelector(".nmb-btn-icon");
        if (labelEl) labelEl.textContent = s.label;
        if (iconEl)  iconEl.innerHTML = icon;
        btn.disabled  = s.disabled;
        btn.className = "nmb-update-btn " + s.cls;

        if (this._updateState.status === "available" && this._updateState.latestVersion) {
            btn.title = `v${this._updateState.latestVersion} available`;
        } else {
            btn.title = "";
        }
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
                groupDms: true
            },
            behavior: {
                autoCheckUpdates: true
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
            merged[section] = Object.assign({}, defaults[section], stored?.[section]);
        }
        return merged;
    }

    _cancelAllNavTimers() {
        if (this.scanTimeout)           { clearTimeout(this.scanTimeout);           this.scanTimeout = null; }
        if (this._refreshDebounce)      { clearTimeout(this._refreshDebounce);      this._refreshDebounce = null; }
        if (this._guildSwitchWaitTimeout){ clearTimeout(this._guildSwitchWaitTimeout); this._guildSwitchWaitTimeout = null; }
    }

    _handleNavigation() {
        if (!this.isRunning) return;
        this._cancelAllNavTimers();

        this.observer?.disconnect();

        this._injectGuildSwitchGuard();

        this._waitForChatReady(0);
    }

    _waitForChatReady(attempts) {
        const MAX_ATTEMPTS = 40;
        const INTERVAL     = 50;

        if (!this.isRunning) {
            this._removeGuildSwitchGuard();
            this._restartObserver();
            return;
        }

        const chatReady =
            document.querySelector('[class*="chatContent"]')         ||
            document.querySelector('[data-list-id*="chat-messages"]') ||
            document.querySelector('[class*="privateChannels"]')     ||
            document.querySelector('[class*="friendsContainer"]')    ||
            document.querySelector('[class*="noFriendsText"]');

        if (chatReady || attempts >= MAX_ATTEMPTS) {
            this.hiddenElements.clear();
            this.hiddenParents.clear();
            this._removeGuildSwitchGuard();
            this._restartObserver();

            this.scanDom();
            this._guildSwitchWaitTimeout = setTimeout(() => {
                if (!this.isRunning) return;
                this.scanDom();
                this._guildSwitchWaitTimeout = null;
            }, 400);
        } else {
            this._guildSwitchWaitTimeout = setTimeout(() => {
                this._waitForChatReady(attempts + 1);
            }, INTERVAL);
        }
    }

    _restartObserver() {
        this.observer?.disconnect();
        this.observer = new MutationObserver((mutations) => {
            if (this.settings.places.messages) {
                try { this._fastHideFromMutations(mutations); } catch (_) {}
            }
            this.queueScan();
        });
        if (document.body) this.observer.observe(document.body, { childList: true, subtree: true });
    }

    _injectGuildSwitchGuard() {
        if (document.getElementById('nmb-guild-switch-guard')) return;
        const style = document.createElement('style');
        style.id = 'nmb-guild-switch-guard';
        style.textContent = `
            [class*="messageGroupBlocked"],
            [class*="blockedSystemMessage"],
            li[class*="messageListItem"]:has([class*="messageGroupBlocked"]),
            li[class*="messageListItem"]:has([class*="blockedSystemMessage"]) {
                display: none !important;
                height: 0 !important;
                overflow: hidden !important;
                contain: size style !important;
            }
        `;
        document.head.appendChild(style);
    }

    _removeGuildSwitchGuard() {
        document.getElementById('nmb-guild-switch-guard')?.remove();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        this.resolveModules();
        if (!this.modules.RelationshipStore?.isBlocked) {
            this.isRunning = false;
            this.toast("Could not find Discord RelationshipStore.", "error");
            return;
        }

        this.addStyles();

        this.patchStores();
        this.patchRelationshipUpdates();
        this.patchBlockedMessageGroup();

        this._restartObserver();
        this.scanInterval = setInterval(() => this.queueScan(), 4000);

        this.queueRefresh();

        if (this.settings.behavior.autoCheckUpdates) {
            setTimeout(() => this.checkForUpdatesAuto(), 5000);
            this._periodicCheckInterval = setInterval(() => this.checkForUpdatesAuto(), 7200000);
        }

        try {
            const Dispatcher = BdApi.Webpack.getModule(
                m => m?.dispatch && m?.subscribe && m?.unsubscribe,
                { searchExports: false }
            );
            if (Dispatcher) {
                this._navFluxHandler = () => this._handleNavigation();
                Dispatcher.subscribe("CHANNEL_SELECT", this._navFluxHandler);
                Dispatcher.subscribe("GUILD_CHANGE",   this._navFluxHandler);
                this.patches.push(() => {
                    try { Dispatcher.unsubscribe("CHANNEL_SELECT", this._navFluxHandler); } catch (_) {}
                    try { Dispatcher.unsubscribe("GUILD_CHANGE",   this._navFluxHandler); } catch (_) {}
                });
            } else {
                const origPushState    = history.pushState;
                const origReplaceState = history.replaceState;
                const self = this;
                history.pushState    = function(...a) { origPushState.apply(this, a);    self._handleNavigation(); };
                history.replaceState = function(...a) { origReplaceState.apply(this, a); self._handleNavigation(); };
                this.patches.push(() => {
                    history.pushState    = origPushState;
                    history.replaceState = origReplaceState;
                });
            }
        } catch (_) {}

    }

    stop() {
        this.isRunning = false;

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

        this.observer?.disconnect();
        this.observer = null;
        clearInterval(this.scanInterval);
        clearTimeout(this.scanTimeout);
        clearTimeout(this.refreshTimeout);
        clearTimeout(this.saveTimeout);
        this.scanInterval = null;
        this.scanTimeout = null;
        this.refreshTimeout = null;

        try {
            this.modules.RelationshipStore?.removeChangeListener?.(this.relationshipChangeHandler);
        } catch (_) {}
        this.relationshipChangeHandler = null;

        for (const unpatch of this.patches.splice(0)) {
            try { unpatch(); } catch (_) {}
        }
        try { BdApi.Patcher.unpatchAll(this.pluginName); } catch (_) {}
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
        if (this._routerUnsubscribe) {
            try { this._routerUnsubscribe(); } catch (_) {}
            this._routerUnsubscribe = null;
        }
    }


    resolveModules() {
        const getStore = name => {
            try { return BdApi.Webpack.getStore(name); }
            catch (_) { return null; }
        };
        const getModule = filter => {
            try { return BdApi.Webpack.getModule(filter); }
            catch (_) { return null; }
        };

        this.modules.RelationshipStore = getStore("RelationshipStore");
        this.modules.SortedVoiceStateStore = getStore("SortedVoiceStateStore");
        this.modules.StageChannelParticipantStore = getStore("StageChannelParticipantStore");
        this.modules.ChannelStore = getStore("ChannelStore");
        this.modules.MessageStore = getStore("MessageStore");
        this.modules.UserStore = getStore("UserStore");
        this.modules.SelectedGuildStore = getStore("SelectedGuildStore");
        this.modules.RelationshipUtils = getModule(m => m?.addRelationship && m?.removeRelationship);
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
        if (stageStore?.getMutableParticipants) {
            this.patchAfter(stageStore, "getMutableParticipants", (_, __, ret) => {
                if (!this.settings.places.voiceChannels || !Array.isArray(ret)) return ret;
                return ret.filter(participant => !this.shouldHide(this.extractUserId(participant)));
            });
        }

        const channelStore = this.modules.ChannelStore;
        if (channelStore?.getChannel) {
            this.patchAfter(channelStore, "getChannel", (_, __, channel) => {
                if (!this.settings.places.groupDms || !channel?.isGroupDM?.()) return channel;
                const clone = Object.assign(Object.create(Object.getPrototypeOf(channel)), channel);
                if (Array.isArray(clone.rawRecipients)) clone.rawRecipients = clone.rawRecipients.filter(user => !this.shouldHide(user?.id));
                if (Array.isArray(clone.recipients)) clone.recipients = clone.recipients.filter(id => !this.shouldHide(id));
                return clone;
            });
        }
    }

    patchRelationshipUpdates() {
        this.relationshipChangeHandler = () => this.queueRefresh();
        try {
            this.modules.RelationshipStore?.addChangeListener?.(this.relationshipChangeHandler);
        } catch (_) {}

        const utils = this.modules.RelationshipUtils;
        if (utils?.addRelationship) this.patchAfter(utils, "addRelationship", () => this.queueRefresh());
        if (utils?.removeRelationship) this.patchAfter(utils, "removeRelationship", () => this.queueRefresh());
    }

    patchBlockedMessageGroup() {
        if (!this.settings.places.messages) return;

        try {
            const BlockedMessageGroup = BdApi.Webpack.getModule(m =>
                m?.displayName === "BlockedMessageGroup" ||
                m?.name === "BlockedMessageGroup" ||
                m?.prototype?.render?.toString?.().includes("MESSAGE_GROUP_BLOCKED") ||
                (typeof m === 'function' && m.toString && m.toString().includes('messageGroupSpacing'))
            );
            if (BlockedMessageGroup?.prototype?.render) {
                this.patches.push(BdApi.Patcher.instead(this.pluginName, BlockedMessageGroup.prototype, "render", () => null));
                return;
            }
        } catch (_) {}

        const BLOCKED_STRINGS = [
            "MESSAGE_GROUP_BLOCKED",
            "blockedMessageGroup",
            "BlockedMessages",
            "blockedMessages",
            "messageGroupSpacing",
            "isBlockedMessage",
            "BLOCKED_MESSAGE",
        ];
        try {
            const result = BdApi.Webpack.getModuleWithKey(m => {
                if (!m || typeof m !== "function") return false;
                try {
                    const src = Function.prototype.toString.call(m);
                    return BLOCKED_STRINGS.some(s => src.includes(s));
                } catch (_) { return false; }
            });
            if (result) {
                const [moduleObj, key] = result;
                this.patches.push(BdApi.Patcher.instead(this.pluginName, moduleObj, key, () => null));
                return;
            }
        } catch (_) {}

        try {
            let patched = false;
            BdApi.Webpack.getModule((m) => {
                if (patched || !m || typeof m !== "object") return false;
                for (const key of Object.keys(m)) {
                    if (patched) break;
                    const val = m[key];
                    if (typeof val !== "function") continue;
                    try {
                        const src = Function.prototype.toString.call(val);
                        if (BLOCKED_STRINGS.some(s => src.includes(s))) {
                            this.patches.push(BdApi.Patcher.instead(this.pluginName, m, key, () => null));
                            patched = true;
                        }
                    } catch (_) {}
                }
                return false;
            }, { searchExports: true });
        } catch (_) {}
    }

    patchAfter(target, method, callback) {
        try {
            if (!target?.[method]) return;
            this.patches.push(BdApi.Patcher.after(this.pluginName, target, method, callback));
        } catch (_) {}
    }

    filterVoiceStates(value) {
        if (!value) return value;
        if (Array.isArray(value)) return value.filter(state => !this.shouldHide(this.extractUserId(state)));

        if (value instanceof Map) {
            const filtered = new Map();
            for (const [key, item] of value) {
                const next = this.filterVoiceStates(item);
                const userId = this.extractUserId(item) || key;
                if (Array.isArray(next) ? next.length : !this.shouldHide(userId)) filtered.set(key, next);
            }
            return filtered;
        }

        if (typeof value === "object") {
            const filtered = {};
            for (const [key, item] of Object.entries(value)) {
                if (Array.isArray(item)) {
                    const next = this.filterVoiceStates(item);
                    if (next.length) filtered[key] = next;
                    continue;
                }
                const userId = this.extractUserId(item) || key;
                if (!this.shouldHide(userId)) filtered[key] = item;
            }
            return filtered;
        }

        return value;
    }

    shouldHide(userId, isSpammer = false) {
        if (!userId) return false;
        try {
            if (this.settings.types.blocked && this.modules.RelationshipStore?.isBlocked?.(userId)) return true;
            if (this.settings.types.ignored && this.modules.RelationshipStore?.isIgnored?.(userId)) return true;
            return Boolean(isSpammer);
        } catch (_) {
            return false;
        }
    }

    queueRefresh() {
        clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(() => {
            this.restoreUnhiddenElements();
            this.queueScan();
        }, 10);
    }

    queueScan() {
        if (!this.isRunning || this.scanTimeout) return;
        this.scanTimeout = setTimeout(() => {
            this.scanTimeout = null;
            this.scanDom();
        }, 0);
    }

    queueDiscordUpdate() {

    }

    startObserver() {
        this.observer?.disconnect();
        this.observer = new MutationObserver((mutations) => {
            if (this.settings.places.messages) {
                try { this._fastHideFromMutations(mutations); } catch (_) {}
            }
            this.queueScan();
        });
        if (document.body) this.observer.observe(document.body, {childList: true, subtree: true});
    }

    _fastHideFromMutations(mutations) {
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                this._fastHideNode(node);
                const descendants = node.querySelectorAll ? node.querySelectorAll(
                    'li[class*="messageListItem"], [class*="messageListItem"], ' +
                    '[class*="repliedMessage"], [class*="replyBar"], [class*="messageReference"]'
                ) : [];
                for (let d = 0; d < descendants.length; d++) {
                    this._fastHideNode(descendants[d]);
                }
            }
        }
    }

    _fastHideNode(el) {
        if (!el || el.nodeType !== 1) return;
        if (el.dataset?.hiddenBlocked === "true") return;
        if (el.dataset?.nmbGhost === "true") return;

        const hasBlockedClass =
            el.matches?.('[class*="messageGroupBlocked"], [class*="blockedSystemMessage"]') ||
            el.querySelector?.('[class*="messageGroupBlocked"]') ||
            el.querySelector?.('[class*="blockedSystemMessage"]');

        if (hasBlockedClass) {
            const li = el.closest?.('li[class*="messageListItem"]') || el.closest?.('[class*="messageListItem"]') || el;
            if (li.dataset?.hiddenBlocked !== "true") {
                this.hideElement(li, "blocked-group-fast");
                void li.offsetHeight;
            }
            return;
        }

        if (el.matches?.('li[class*="messageListItem"], [class*="messageListItem"]') ||
            el.matches?.('[class*="repliedMessage"], [class*="replyBar"], [class*="messageReference"]')) {

            let messageRow = el;
            if (el.matches?.('[class*="repliedMessage"], [class*="replyBar"], [class*="messageReference"]')) {
                messageRow = el.closest?.('li[class*="messageListItem"]') || el.closest?.('[class*="messageListItem"]');
                if (!messageRow) return;
            }

            if (messageRow.dataset?.hiddenBlocked === "true") return;

            const userId = this.findUserId(messageRow);
            if (userId && this.shouldHide(userId)) {
                this.hideElement(messageRow, "fast-message", userId);
                void messageRow.offsetHeight;
                return;
            }

            const replyBar = messageRow.querySelector('[class*="repliedMessage"], [class*="replyBar"], [class*="messageReference"]');
            if (replyBar) {
                const replyMention = replyBar.querySelector('[data-user-id]');
                const replyUserId = replyMention?.dataset?.userId || this.findUserId(replyBar);
                if (replyUserId && this.shouldHide(replyUserId)) {
                    this.hideElement(messageRow, "fast-reply-to-blocked", replyUserId);
                    void messageRow.offsetHeight;
                    return;
                }
                if (replyBar.matches('[class*="blocked"]') || replyBar.querySelector('[class*="blocked"]')) {
                    this.hideElement(messageRow, "fast-reply-blocked-class");
                    void messageRow.offsetHeight;
                    return;
                }
            }

            const mentions = messageRow.querySelectorAll?.('[class*="mention"]');
            if (mentions) {
                for (let i = 0; i < mentions.length; i++) {
                    const mention = mentions[i];
                    const mentionedId = this.findUserId(mention);
                    if (mentionedId && this.shouldHide(mentionedId)) {
                        this.hideElement(messageRow, "fast-mention", mentionedId);
                        void messageRow.offsetHeight;
                        return;
                    }
                }
            }

            const rawText = (messageRow.innerText || "").replace(/\s+/g, ' ').trim();
            if (rawText.length > 0 && this.isBlockedMessageBannerText(rawText)) {
                this.hideElement(messageRow, "blocked-group-fast");
                void messageRow.offsetHeight;
                return;
            }
        }

        if (el.matches?.('[class*="mention"]')) {
            const userId = this.findUserId(el);
            if (userId && this.shouldHide(userId)) {
                const messageRow = el.closest('li[class*="messageListItem"]') || el.closest('[class*="messageListItem"]');
                if (messageRow) {
                    this.hideElement(messageRow, "fast-mention", userId);
                    void messageRow.offsetHeight;
                } else {
                    this.hideElement(el, "fast-mention", userId);
                    void el.offsetHeight;
                }
            }
        }
    }


    scanDom() {
        try {
            this.restoreUnhiddenElements();
            if (this.settings.places.voiceChannels) this.hideVoiceUsers();
            if (this.settings.places.memberList) this.hideMemberRows();
            if (this.settings.places.messages) this.hideMessages();
            if (this.settings.places.messages) this.hideMentions();
            this.hideEmptyMemberHeaders();
            this.fixMemberGroupCounts();
            this.fixVoiceChannelIconColors();
            this.hideOrphanedDividers();
            this.collapseGhostSlots();
            this.promoteOrphanedMessages();
        } catch (_) {}
    }


    promoteOrphanedMessages() {
        document.querySelectorAll('[data-nmb-promoted="true"]').forEach(el => {
            const prev = this._prevVisibleLi(el);
            if (prev && prev.dataset?.hiddenBlocked !== "true") {
                this._demoteMessage(el);
            }
        });

        const hiddenLis = document.querySelectorAll(
            'li[data-hidden-blocked="true"], [data-hidden-blocked="true"][class*="messageListItem"]'
        );
        for (let i = 0; i < hiddenLis.length; i++) {
            const hidden = hiddenLis[i];
            const next = this._nextVisibleLi(hidden);
            if (!next) continue;
            if (next.dataset?.hiddenBlocked === "true") continue;
            if (next.dataset?.nmbPromoted === "true") continue;

            const groupStartAttr = next.getAttribute("data-message-group-start");
            const isCompact = next.className?.includes?.("compact") || !!next.querySelector('[class*="compact"]');
            const hasHeader = !!next.querySelector('[class*="groupStart"], [class*="cozyHeader"], [class*="header_"], img[src*="/avatars/"]');

            if (groupStartAttr === "false" || (!hasHeader && !isCompact)) {
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

                const key = "groupStart" in props ? "groupStart"
                    : "isGroupStart" in props ? "isGroupStart"
                    : null;
                if (key) {
                    if (!li.dataset.nmbOrigGroupStart) {
                        li.dataset.nmbOrigGroupStart = String(props[key]);
                    }
                    break;
                }

                const msg = props.message || props.childMessage;
                if (msg && "groupStart" in msg) {
                    if (!li.dataset.nmbOrigGroupStart) {
                        li.dataset.nmbOrigGroupStart = String(msg.groupStart);
                    }
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
        const lis = document.querySelectorAll(
            'li[class*="messageListItem"], li[class*="message_"], li[class*="cozy"], li[class*="compact"]'
        );
        for (let i = 0; i < lis.length; i++) {
            const el = lis[i];
            if (el.dataset?.hiddenBlocked === "true") continue;
            if (el.dataset?.nmbGhost === "true") continue;
            const text = (el.innerText || "").replace(/\s+/g, ' ').trim();
            if (text.length > 0) continue;
            if (el.offsetHeight <= 1) continue;
            this._ghostHide(el);
        }

        const wrappers = document.querySelectorAll(
            '[class*="groupStart"] [class*="wrapper"], [class*="groupStart"] > [class*="cozy"]'
        );
        for (let i = 0; i < wrappers.length; i++) {
            const el = wrappers[i];
            if (el.dataset?.hiddenBlocked === "true") continue;
            if (el.dataset?.nmbGhost === "true") continue;
            const text = (el.innerText || "").replace(/\s+/g, ' ').trim();
            if (text.length > 0) continue;
            if (el.offsetHeight <= 1) continue;
            this._ghostHide(el);
        }

        const groupStarts = document.querySelectorAll('[class*="groupStart"]');
        for (let i = 0; i < groupStarts.length; i++) {
            const group = groupStarts[i];
            let hasVisible = false;
            for (const child of group.children) {
                if (child.dataset?.hiddenBlocked !== "true" && child.offsetParent !== null) {
                    hasVisible = true;
                    break;
                }
            }
            if (!hasVisible && group.offsetHeight > 1) {
                this._ghostHide(group);
            }
        }
    }

    _ghostHide(el) {
        el.dataset.nmbGhost = "true";
        if (!el.hasAttribute("data-nmb-prev-ghost-style")) {
            el.setAttribute("data-nmb-prev-ghost-style", el.getAttribute("style") || "");
        }
        el.style.cssText = `
            display: none !important;
            height: 0 !important;
            min-height: 0 !important;
            max-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: hidden !important;
            contain: size style !important;
        `;
    }

    hideMessages() {
        const els = document.querySelectorAll('li[class*="messageListItem"], [class*="messageListItem"], [class*="blocked"], [class*="message-"], [class*="cozy-"], [class*="compact-"]');
        const parentSet = new Set();

        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const messageRow = el.closest('li[class*="messageListItem"]') || el;
            if (messageRow.dataset?.hiddenBlocked === "true") continue;

            const info = this.getMessageInfo(messageRow);
            if (this.settings.places.messages && this.shouldHide(info.authorId, info.isSpammer)) {
                this.hideElement(messageRow, "message", info.authorId);
                const parent = messageRow.parentElement;
                if (parent && !parent.dataset?.hiddenBlocked) parentSet.add(parent);
                continue;
            }
            if (this.settings.places.messages && this.shouldHide(info.referencedAuthorId)) {
                this.hideElement(messageRow, "reply-to-blocked", info.referencedAuthorId);
                const parent = messageRow.parentElement;
                if (parent && !parent.dataset?.hiddenBlocked) parentSet.add(parent);
                continue;
            }
            if (this.settings.places.messages && info.isBlockedGroup) {
                const target = el.closest("li") || messageRow;
                this.hideElement(target, "blocked-group");
                const parent = target.parentElement;
                if (parent && !parent.dataset?.hiddenBlocked) parentSet.add(parent);
                continue;
            }

            const text = (messageRow.innerText || "").trim();
            if (this.settings.places.messages && this.isBlockedMessageBannerText(text)) {
                this.hideElement(messageRow, "blocked-group-text");
                const parent = messageRow.parentElement;
                if (parent && !parent.dataset?.hiddenBlocked) parentSet.add(parent);
            }
        }

        for (const parent of parentSet) {
            const visibleChildren = Array.from(parent.children).filter(child => 
                !child.dataset?.hiddenBlocked && child.offsetParent !== null
            );
            if (visibleChildren.length === 0) {
                this.hideParent(parent, "empty-message-group");
            }
        }

        if (this.settings.places.messages) this.hideBlockedMessageTextBanners();
    }

    hideParent(el, reason = "empty-parent") {
        if (!el || el.dataset?.hiddenBlocked === "true") return;
        if (!el.hasAttribute("data-nmb-prev-style")) el.setAttribute("data-nmb-prev-style", el.getAttribute("style") || "");
        el.dataset.hiddenBlocked = "true";
        el.dataset.nmbReason = reason;
        el.style.cssText = this.hideStyles;
        this.hiddenParents.add(el);
        el.dataset.nmbParentHidden = "true";
    }

    restoreParent(el) {
        if (!el) return;
        const previous = el.getAttribute("data-nmb-prev-style");
        if (previous) el.setAttribute("style", previous);
        else el.removeAttribute("style");
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
            const userId = el.dataset?.nmbUserId;
            if (userId && !this.shouldHide(userId)) this.restoreElement(el);
        }

        for (const parent of Array.from(this.hiddenParents)) {
            if (!document.contains(parent)) {
                this.hiddenParents.delete(parent);
                continue;
            }
            const visibleChildren = Array.from(parent.children).filter(child => 
                !child.dataset?.hiddenBlocked && child.offsetParent !== null
            );
            if (visibleChildren.length > 0) {
                this.restoreParent(parent);
            }
        }

        document.querySelectorAll('[data-nmb-ghost="true"]').forEach(slot => {
            const prev = slot.getAttribute("data-nmb-prev-ghost-style");
            if (prev) slot.setAttribute("style", prev);
            else slot.removeAttribute("style");
            delete slot.dataset.nmbGhost;
            slot.removeAttribute("data-nmb-prev-ghost-style");
        });
    }

    restoreAllElements() {
        document.querySelectorAll('[data-nmb-promoted="true"]').forEach(el => {
            try { this._demoteMessage(el); } catch (_) {
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
        document.querySelectorAll('[data-nmb-prev-text]').forEach(el => this.restoreTemporaryText(el));
        document.querySelectorAll('[data-nmb-muted-voice]').forEach(row => this.restoreVoiceChannelIcon(row));
        document.querySelectorAll('[data-nmb-prev-icon-style]').forEach(icon => {
            const previous = icon.getAttribute("data-nmb-prev-icon-style");
            if (previous) icon.setAttribute("style", previous);
            else icon.removeAttribute("style");
            icon.removeAttribute("data-nmb-prev-icon-style");
        });
        document.querySelectorAll('[data-nmb-ghost="true"]').forEach(slot => {
            const prev = slot.getAttribute("data-nmb-prev-ghost-style");
            if (prev) slot.setAttribute("style", prev);
            else slot.removeAttribute("style");
            delete slot.dataset.nmbGhost;
            slot.removeAttribute("data-nmb-prev-ghost-style");
        });
        this.hiddenElements.clear();
        this.hiddenParents.clear();
    }

    hideVoiceUsers() {
        const els = document.querySelectorAll('[class*="voiceUser"], [class*="voiceUsers"] [data-list-item-id], [class*="listItem"][data-list-item-id]');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const userId = this.findUserId(el);
            if (!this.shouldHide(userId)) continue;
            const row = el.closest('li') || el;
            if (!this.isVoiceChannelShell(row)) this.hideElement(row, "voice-user", userId);
            else this.hideElement(el, "voice-user", userId);
        }
        this.fixVoiceCounters();
    }

    hideMemberRows() {
        const els = document.querySelectorAll('[data-list-item-id], [class*="member-"], [class*="member_"]');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const userId = this.findUserId(el);
            if (!this.shouldHide(userId)) continue;
            this.hideElement(el.closest('[data-list-item-id]') || el, "member", userId);
        }
    }

    hideBlockedMessageTextBanners() {
        const roots = document.querySelectorAll('[class*="chatContent"], [class*="messagesWrapper"], [data-list-id*="chat-messages"]');
        for (let i = 0; i < roots.length; i++) {
            const root = roots[i];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode: node => this.isBlockedMessageBannerText(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
            });

            const matches = [];
            while (walker.nextNode()) matches.push(walker.currentNode);

            for (let j = 0; j < matches.length; j++) {
                const node = matches[j];
                let candidate = node.parentElement;
                let best = candidate;
                for (let k = 0; k < 8 && candidate && candidate !== root; k++, candidate = candidate.parentElement) {
                    const text = (candidate.innerText || "").trim();
                    if (this.isBlockedMessageBannerText(text)) best = candidate;
                    if (candidate.matches?.('li[class*="messageListItem"], [class*="messageListItem"], [role="group"], [class*="blocked"]')) {
                        best = candidate;
                        break;
                    }
                }
                if (best && best !== root) {
                    const target = best.closest("li") || best;
                    this.hideElement(target, "blocked-group-text");
                }
            }
        }
    }

    isBlockedMessageBannerText(text) {
        return /(?:^|\s)(?:\d+\s+)?(?:blocked\s+messages?|messages?\s+blocked|mensage(?:m|ns)\s+bloquead[ao]s?)(?:\s*[—]\s*(?:mostrar|show))?(?:\s|$)/i.test(String(text || "").trim());
    }

    hideMentions() {
        const els = document.querySelectorAll('[class*="mention"], [class*="messageContent"] [data-user-id]');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const userId = this.findUserId(el);
            if (this.shouldHide(userId)) {
                const messageRow = el.closest('li[class*="messageListItem"]') || el.closest('[class*="messageListItem"]');
                if (messageRow) {
                    this.hideElement(messageRow, "mention", userId);
                } else {
                    this.hideElement(el, "mention", userId);
                }
            }
        }
    }

    hideEmptyMemberHeaders() {
        document.querySelectorAll('[data-list-item-id]').forEach(header => {
            if (header.dataset?.hiddenBlocked === "true") return;
            const id = header.dataset?.listItemId || "";
            if (/\d{17,20}$/.test(id)) return;

            let seenMember = false;
            let seenVisible = false;
            let next = header.nextElementSibling;
            while (next) {
                const nextId = next.dataset?.listItemId || "";
                if (!/\d{17,20}$/.test(nextId)) break;
                seenMember = true;
                if (next.dataset?.hiddenBlocked !== "true") {
                    seenVisible = true;
                    break;
                }
                next = next.nextElementSibling;
            }
            if (seenMember && !seenVisible) this.hideElement(header, "empty-member-header");
        });
    }

    fixMemberGroupCounts() {
        document.querySelectorAll('[class*="membersGroup"], [data-list-item-id]').forEach(header => {
            if (header.dataset?.hiddenBlocked === "true" || !this.isMemberGroupHeader(header)) return;

            const count = this.countVisibleMembersAfter(header);
            if (count === null) return;
            if (count <= 0) {
                this.hideElement(header, "empty-member-header");
                return;
            }

            this.updateMemberGroupVisibleCount(header, count);
        });
    }

    isMemberGroupHeader(el) {
        const text = (el.textContent || "").trim();
        if (!text || /\d{17,20}$/.test(el.dataset?.listItemId || "")) return false;
        if (/[\s\u00A0]+[-–—][\s\u00A0]*\d+\s*$/.test(text)) return true;
        return Boolean(String(el.className || "").includes("membersGroup"));
    }

    countVisibleMembersAfter(header) {
        let count = 0;
        let sawMember = false;
        let next = header.nextElementSibling;

        while (next) {
            if (this.isMemberGroupHeader(next)) break;
            const userId = this.findUserId(next);
            if (userId) {
                sawMember = true;
                if (next.dataset?.hiddenBlocked !== "true" && !this.shouldHide(userId)) count++;
            }
            next = next.nextElementSibling;
        }

        return sawMember ? count : null;
    }

    updateMemberGroupVisibleCount(header, count) {
        const headerDiv = header.querySelector('[class*="membersGroupHeader"]') || header;
        const spans = Array.from(headerDiv.querySelectorAll('span'));
        
        const countSpan = spans.find(span => {
            if (span.className && span.className.includes('membersGroupName')) return false;
            return /[-–—]\s*\d+/.test(span.textContent || "");
        });

        if (countSpan) {
            if (!countSpan.hasAttribute("data-nmb-prev-text")) {
                countSpan.setAttribute("data-nmb-prev-text", countSpan.textContent);
            }
            countSpan.textContent = `\u00A0— ${count}`;
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
        document.querySelectorAll('li:has([class*="divider"]), [class*="divider_"], [class*="divider-"]').forEach(divider => {
            if (divider.dataset?.hiddenBlocked === "true") return;
            let next = divider.nextElementSibling;
            let hasVisibleMessage = false;
            while (next) {
                const className = String(next.className || "");
                if (next.querySelector?.('[class*="divider"]') || className.includes("divider")) break;
                if (next.dataset?.hiddenBlocked !== "true" && (next.innerText || "").trim()) {
                    hasVisibleMessage = true;
                    break;
                }
                next = next.nextElementSibling;
            }
            if (!hasVisibleMessage) this.hideElement(divider, "orphan-divider");
        });
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

    fixVoiceChannelIconColors() {
        document.querySelectorAll('[data-list-item-id*="channels"], [class*="voiceChannel"], [class*="linkTop"], [class*="linkBottom"]').forEach(row => {
            const channelRow = row.closest?.('[data-list-item-id*="channels"]') || row.closest?.('li') || row;
            const channelId = this.findChannelId(channelRow) || this.findChannelId(row);
            if (!channelId) return;

            const states = this.getRawVoiceStatesForChannel(channelId);
            const allHidden = states.length > 0 && states.every(state => this.shouldHide(this.extractUserId(state)));
            const activeOnlyByDom = !states.length && this.looksLikeHiddenOnlyVoiceChannel(channelRow);
            const isHiddenOnly = allHidden || activeOnlyByDom;

            if (!isHiddenOnly) {
                this.restoreVoiceChannelIcon(channelRow);
                this.restoreVoiceChannelTimer(channelRow);
                return;
            }

            channelRow.dataset.nmbMutedVoice = "true";
            channelRow.querySelectorAll('svg, [class*="icon"], [class*="iconLive"]').forEach(icon => {
                if (!icon.hasAttribute("data-nmb-prev-icon-style")) icon.setAttribute("data-nmb-prev-icon-style", icon.getAttribute("style") || "");
                icon.style.setProperty("color", "var(--channels-default)", "important");
                icon.style.setProperty("fill", "currentColor", "important");
            });

            if (this.settings.places.voiceChannels) {
                channelRow.querySelectorAll('[class*="timer"], [class*="voiceTimer"], [role="timer"], [class*="tabularNumbers"]').forEach(el => {
                    this.hideElement(el, "voice-timer");
                });
            }
        });
    }

    looksLikeHiddenOnlyVoiceChannel(row) {
        const link = row.matches?.('[data-list-item-id*="channels"]') ? row : row.querySelector?.('[data-list-item-id*="channels"]');
        const label = `${link?.getAttribute?.("aria-label") || ""} ${row.textContent || ""}`;
        const hasLiveIcon = Boolean(row.querySelector?.('[class*="iconLive"]'));
        const hasCallDuration = /dura(?:ç|c)[aã]o da chamada|call duration|duration/i.test(label);
        if (!hasLiveIcon && !hasCallDuration) return false;

        const container = row.closest?.('li') || row;
        const visibleVoiceRows = Array.from(container.querySelectorAll?.('[class*="voiceUser"], [class*="voiceUser_"], [class*="voiceUser-"], [data-list-item-id*="voice"]') || [])
            .filter(el => el.dataset?.hiddenBlocked !== "true" && el.offsetParent !== null);
        return visibleVoiceRows.length === 0;
    }

    restoreVoiceChannelIcon(row) {
        if (!row?.dataset?.nmbMutedVoice) return;
        delete row.dataset.nmbMutedVoice;
        row.querySelectorAll('[data-nmb-prev-icon-style]').forEach(icon => {
            const previous = icon.getAttribute("data-nmb-prev-icon-style");
            if (previous) icon.setAttribute("style", previous);
            else icon.removeAttribute("style");
            icon.removeAttribute("data-nmb-prev-icon-style");
        });
    }

    restoreVoiceChannelTimer(row) {
        row?.querySelectorAll?.('[data-hidden-blocked="true"][data-nmb-reason="voice-timer"]').forEach(el => this.restoreElement(el));
    }

    getRawVoiceStatesForChannel(channelId) {
        try {
            const raw = this.originalVoiceMethods.getVoiceStatesForChannel
                ? this.originalVoiceMethods.getVoiceStatesForChannel(channelId)
                : this.modules.SortedVoiceStateStore?.getVoiceStatesForChannel?.(channelId);
            const states = Array.isArray(raw) ? raw : Object.values(raw || {});
            if (states.length) return states;

            const guildId = this.modules.SelectedGuildStore?.getGuildId?.();
            const byGuild = guildId && this.originalVoiceMethods.getVoiceStates
                ? this.originalVoiceMethods.getVoiceStates(guildId)
                : null;
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
            isSpammer: false
        };

        const visit = props => {
            if (!props || typeof props !== "object") return;
            const message = props.message || props.baseMessage || props.referencedMessage?.message;
            if (message?.author?.id && !info.authorId) info.authorId = message.author.id;
            if (props.author?.id && !info.authorId) info.authorId = props.author.id;
            if (props.user?.id && !info.authorId) info.authorId = props.user.id;
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

        this.walkFiberProps(el, visit, 24);
        if (!info.authorId) info.authorId = this.findUserId(el);
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

    findUserId(el) {
        if (!el) return null;
        try {
            if (el.dataset?.userId) return el.dataset.userId;
            if (el.dataset?.nmbUserId) return el.dataset.nmbUserId;
            const userIdEl = el.querySelector?.('[data-user-id]');
            if (userIdEl?.dataset?.userId) return userIdEl.dataset.userId;
        } catch (_) {}

        let found = null;
        this.walkFiberProps(el, props => {
            if (!found) found = this.extractUserId(props);
        }, 24);
        if (found) return found;

        try {
            const listId = el.dataset?.listItemId || "";
            const idMatch = listId.match(/(\d{17,20})$/) || el.id?.match(/(\d{17,20})/);
            if (idMatch) return idMatch[1];
            const avatar = el.querySelector?.('img[src*="/avatars/"]');
            const avatarMatch = avatar?.src?.match(/\/avatars\/(\d{17,20})\//);
            if (avatarMatch) return avatarMatch[1];
        } catch (_) {}

        return null;
    }

    extractUserId(value, depth = 0) {
        if (!value || depth > 3) return null;
        if (typeof value === "string" && /^\d{17,20}$/.test(value)) return value;
        if (typeof value !== "object") return null;

        const direct = value.userId || value.authorId || value.recipientId;
        if (direct && /^\d{17,20}$/.test(String(direct))) return String(direct);

        if (value.id && (value.username || value.discriminator || value.globalName) && /^\d{17,20}$/.test(String(value.id))) {
            return String(value.id);
        }

        const nested = value.user?.id || value.author?.id || value.member?.userId || value.member?.user?.id ||
            value.participant?.userId || value.participant?.user?.id || value.voiceState?.userId ||
            value.message?.author?.id || value.baseMessage?.author?.id || value.recipient?.id || value.channel?.recipientId;
        if (nested && /^\d{17,20}$/.test(String(nested))) return String(nested);

        for (const key of ["props", "memoizedProps", "pendingProps", "record", "row", "message"]) {
            if (value[key]) {
                const found = this.extractUserId(value[key], depth + 1);
                if (found) return found;
            }
        }
        return null;
    }

    walkFiberProps(el, visitor, maxDepth = 20) {
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
        const resolvedUserId = userId || this.findUserId(el);
        if (resolvedUserId) el.dataset.nmbUserId = resolvedUserId;
        el.dataset.hiddenBlocked = "true";
        el.dataset.nmbReason = reason;
        el.style.cssText = this.hideStyles;
        this.hiddenElements.add(el);
    }

    restoreElement(el) {
        if (!el) return;
        const previous = el.getAttribute("data-nmb-prev-style");
        if (previous) el.setAttribute("style", previous);
        else el.removeAttribute("style");
        delete el.dataset.hiddenBlocked;
        delete el.dataset.nmbReason;
        delete el.dataset.nmbUserId;
        el.removeAttribute("data-nmb-prev-style");
        this.hiddenElements.delete(el);
    }

    restoreTemporaryText(el) {
        const previous = el.getAttribute("data-nmb-prev-text");
        if (previous !== null) el.textContent = previous;
        el.removeAttribute("data-nmb-prev-text");
    }

    addStyles() {
        this.removeStyles();

        const hideBlockedBanner = this.settings.places.messages ? `
            [class*="messageGroupBlocked"],
            [class*="blockedSystemMessage"],
            [class*="messageGroupStart"]:has([class*="blocked"]),
            li[class*="messageListItem"]:has([class*="messageGroupBlocked"]),
            li[class*="messageListItem"]:has([class*="blockedSystemMessage"]),
            li[class*="messageListItem"]:has([class*="blocked"][class*="message"]),
            [class*="messageListItem"]:has([class*="messageGroupBlocked"]) {
                display: none !important;
                height: 0 !important;
                min-height: 0 !important;
                max-height: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: hidden !important;
                contain: size style !important;
            }
        ` : '';

        const noticeButtonStyles = `
            .bd-notice button,
            .bd-notice .bd-button,
            .bd-notice [class*="button"],
            .bd-notice [role="button"] {
                background: transparent !important;
                border: 1px solid var(--text-muted) !important;
                color: var(--text-normal) !important;
                transition: background 0.15s, border-color 0.15s !important;
            }
            .bd-notice button:hover,
            .bd-notice .bd-button:hover,
            .bd-notice [class*="button"]:hover,
            .bd-notice [role="button"]:hover {
                background: rgba(255, 255, 255, 0.08) !important;
                border-color: var(--brand-experiment) !important;
                color: var(--text-normal) !important;
            }
        `;

        BdApi.DOM.addStyle(this.pluginName, `
            [data-hidden-blocked="true"],
            [data-hidden-blocked="true"] * {
                ${this.hideStyles}
            }

            [class*="messageGroupStart"]:empty,
            [class*="messageGroupBlocked"]:empty {
                display: none !important;
            }

            [data-nmb-ghost="true"] {
                display: none !important;
                height: 0 !important;
                min-height: 0 !important;
                max-height: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: hidden !important;
                contain: size style !important;
            }

            ${hideBlockedBanner}

            [data-nmb-promoted="true"] [class*="compact"],
            [data-nmb-promoted="true"] [class*="cozy"] {
                margin-top: 17px !important;
            }
            [data-nmb-promoted="true"] [class*="avatar"],
            [data-nmb-promoted="true"] img[class*="avatar"] {
                display: block !important;
            }
            [data-nmb-promoted="true"] [class*="username"],
            [data-nmb-promoted="true"] [class*="header_"],
            [data-nmb-promoted="true"] [class*="cozyHeader"] {
                display: flex !important;
            }

            [class*="channelInfo"] {
                display: flex !important;
                align-items: center !important;
                gap: 4px !important;
            }

            [data-nmb-muted-voice="true"] svg,
            [data-nmb-muted-voice="true"] [class*="icon"],
            [data-nmb-muted-voice="true"] [class*="iconLive"] {
                color: var(--channels-default) !important;
                fill: currentColor !important;
            }

            [class*="bd-modal-large"],
            [class*="bd-modal"][class*="large"] {
                width: 90vw !important;
                max-width: 860px !important;
            }

            [class*="bd-modal-body"] {
                max-height: 82vh !important;
            }

            .nmb-panel {
                padding: 16px 20px;
                color: var(--text-normal);
                font-family: var(--font-primary);
                max-width: 720px;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                text-rendering: optimizeLegibility;
                transform: translateZ(0);
                backface-visibility: hidden;
            }

            .nmb-header-minimal {
                display: flex;
                align-items: baseline;
                gap: 10px;
                margin-bottom: 12px;
                padding-bottom: 10px;
                border-bottom: 1px solid var(--background-modifier-accent);
            }

            .nmb-plugin-name {
                font-size: 22px;
                font-weight: 700;
                color: var(--header-primary);
            }

            .nmb-version {
                font-size: 15px;
                color: var(--text-muted);
                font-weight: 500;
            }

            .nmb-section {
                background: var(--background-secondary);
                border-radius: 8px;
                margin-bottom: 8px;
                overflow: hidden;
                border: 1px solid var(--background-modifier-accent);
            }

            .nmb-section-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 16px;
                cursor: pointer;
                user-select: none;
                transition: background 160ms ease !important;
                background: transparent;
            }

            .nmb-panel .nmb-section-header:hover {
                background: var(--background-modifier-hover) !important;
            }

            .nmb-section-title {
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--header-secondary);
                margin: 0;
            }

            .nmb-chevron {
                width: 16px;
                height: 16px;
                color: var(--text-muted);
                transition: transform 220ms ease;
                flex-shrink: 0;
            }

            .nmb-section.is-open .nmb-chevron {
                transform: rotate(180deg);
            }

            .nmb-section-body {
                display: grid;
                grid-template-rows: 0fr;
                transition: grid-template-rows 200ms ease;
            }

            .nmb-section.is-open .nmb-section-body {
                grid-template-rows: 1fr;
            }

            .nmb-section-body-inner {
                overflow: hidden;
                padding: 0 16px;
            }

            .nmb-section.is-open .nmb-section-body-inner {
                padding: 4px 16px 10px;
            }

            .nmb-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 6px 6px;
                border-radius: 4px;
                transition: background 150ms ease !important;
                background: transparent;
            }

            .nmb-panel .nmb-row:hover {
                background: var(--background-modifier-hover) !important;
            }

            .nmb-row-label {
                font-size: 14px;
                color: var(--text-normal);
            }

            .nmb-switch {
                position: relative;
                width: 34px;
                height: 18px;
                flex-shrink: 0;
                border-radius: 9px;
                background: var(--background-tertiary);
                cursor: pointer;
                transition: background 160ms ease, box-shadow 160ms ease;
            }

            .nmb-switch:hover {
                box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.25);
            }

            .nmb-switch.is-on {
                background: var(--brand-experiment, #5865f2);
            }

            .nmb-switch-knob {
                position: absolute;
                top: 2px;
                left: 2px;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 1px 2px rgba(0,0,0,0.3);
                transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
            }

            .nmb-switch.is-on .nmb-switch-knob {
                transform: translateX(16px);
            }

            .nmb-actions {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 28px;
                padding: 12px 0;
                border-top: 1px solid var(--background-modifier-accent);
            }

            .nmb-update-btn {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                border-radius: 6px;
                font-weight: 600;
                cursor: pointer;
                transition: background 160ms ease, color 160ms ease, border-color 160ms ease, transform 120ms ease, box-shadow 160ms ease;
                white-space: nowrap;
            }

            .nmb-btn-icon {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
            }

            .nmb-update-btn {
                padding: 8px 14px;
                font-size: 13px;
                background: var(--brand-experiment, #5865f2);
                color: #fff;
                border: none;
            }

            .nmb-update-btn:hover:not(:disabled) {
                background: var(--brand-experiment-hover, #4752c4);
                transform: translateY(-1px);
                box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            }

            .nmb-update-btn:disabled {
                opacity: 0.55;
                cursor: default;
            }

            .nmb-update-btn.is-checking .nmb-btn-icon {
                animation: nmb-spin 0.8s linear infinite;
            }

            @keyframes nmb-spin {
                from { transform: rotate(0deg); }
                to   { transform: rotate(360deg); }
            }

            .nmb-update-btn.is-up-to-date {
                background: var(--text-positive, #23a559);
                color: #fff;
                border: none;
            }

            .nmb-update-btn.is-up-to-date:hover:not(:disabled) {
                background: #1e8f4e;
                box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            }

            .nmb-update-btn.is-update-available {
                background: var(--brand-experiment, #5865f2);
                color: #fff;
                border: none;
                animation: nmb-pulse-update 2s ease-in-out infinite;
            }

            .nmb-update-btn.is-update-available:hover {
                filter: brightness(1.1);
            }

            .nmb-update-btn.is-error {
                background: var(--text-danger, #f23f43);
                color: #fff;
                border: none;
            }

            .nmb-update-btn.is-error:hover:not(:disabled) {
                background: #d73338;
                box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            }

            @keyframes nmb-pulse-update {
                0%, 100% { box-shadow: 0 0 0 0 rgba(88,101,242,0.4); }
                50%       { box-shadow: 0 0 0 6px rgba(88,101,242,0); }
            }

            .nmb-last-check {
                font-size: 12px;
                color: var(--text-muted);
            }

            ${noticeButtonStyles}
        `);
    }

    removeStyles() {
        try { BdApi.DOM.removeStyle(this.pluginName); } catch (_) {}
        document.getElementById(`${this.pluginName}-CSS`)?.remove();
    }

    toast(message, type = "info") {
        try { BdApi.UI.showToast(message, {type}); } catch (_) {}
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "nmb-panel";

        panel.innerHTML = `
            <div class="nmb-header-minimal">
                <span class="nmb-plugin-name">
                    <span class="nmb-version"> v${ByeBlocked.VERSION}</span>
                </span>
            </div>

            ${this.renderSettingsGroup("types", "Hide users by type", true)}
            ${this.renderSettingsGroup("places", "Where to hide", true)}

            <div class="nmb-actions">
                <button class="nmb-update-btn" data-nmb-update-btn>
                    <svg class="nmb-btn-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M14 2v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M13.5 7A5.5 5.5 0 1 1 10.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                    <span class="nmb-btn-label">Check for updates</span>
                </button>
                <span class="nmb-last-check" data-nmb-last-check>Last check: ${this._formatDate(this._lastCheckTimestamp)}</span>
            </div>

        `;

        if (this._updateState.status === "available") {
            this._renderUpdateBtn(panel);
        } else {
            const oneHour = 3600000;
            const lastCheck = this._lastCheckTimestamp || 0;
            if (Date.now() - lastCheck > oneHour) {
                this.checkForUpdates(panel, true);
            } else {
                this._renderUpdateBtn(panel);
            }
        }

        panel.addEventListener("click", event => {
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
                const {section, key} = switchEl.dataset;
                const next = !this.settings[section][key];
                this.settings[section][key] = next;
                switchEl.classList.toggle("is-on", next);
                this.saveSettings();
                this.queueRefresh();
                return;
            }
        });

        setTimeout(() => {
            panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }, 50);

        return panel;
    }

    renderSettingsGroup(section, title, openByDefault = false) {
        const labels = {
            blocked: "Blocked users",
            ignored: "Muted/ignored users",
            messages: "Messages & chat",
            memberList: "Member list",
            voiceChannels: "Voice channels",
            groupDms: "Group DMs",
            autoCheckUpdates: "Auto-check updates on startup"
        };

        const rows = Object.keys(this.settings[section]).map(key => {
            const isOn = this.settings[section][key];
            return `
                <div class="nmb-row">
                    <div class="nmb-row-label-wrap">
                        <span class="nmb-row-label">${labels[key] || key}</span>
                    </div>
                    <div class="nmb-switch ${isOn ? "is-on" : ""}" data-section="${section}" data-key="${key}">
                        <div class="nmb-switch-knob"></div>
                    </div>
                </div>
            `;
        }).join("");

        return `
            <section class="nmb-section ${openByDefault ? "is-open" : ""}">
                <div class="nmb-section-header">
                    <p class="nmb-section-title">${title}</p>
                    <svg class="nmb-chevron" viewBox="0 0 24 24" fill="none">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
                <div class="nmb-section-body">
                    <div class="nmb-section-body-inner">${rows}</div>
                </div>
            </section>
        `;
    }
};
