/**
 * @name ByeBlocked
 * @author 8ug8ird
 * @authorId 698947564459917343
 * @version 2.1.0
 * @description Hides blocked and ignored users from chat, voice, and member lists.
 * @source https://github.com/8ug8ird/ByeBlocked
 */
module.exports = class ByeBlocked {
    static VERSION="2.1.0";
    static RAW_URL="https://raw.githubusercontent.com/8ug8ird/ByeBlocked/refs/heads/main/ByeBlocked.plugin.js";
    static RELEASE_URL="https://github.com/8ug8ird/ByeBlocked";
    constructor() {
        this.pluginName = "ByeBlocked";
        this.observer = null;
        this.scanInterval = null;
        this.scanTimeout = null;
        this.refreshTimeout = null;
        this.saveTimeout = null;
        this._moduleRetryTimeout = null;
        this._nmbStartupFailures = [];
        this._nmbMissingCoreModules = [];
        this.relationshipChangeHandler = null;
        this._channelPinsChangeHandler = null;
        this._channelSwitchChangeHandler = null;
        this._lastWatchedChannelId = null;
        this._forumRetryScheduled = false;
        this._readStateRecheckScheduled = false;
        this._readStateRecheckInFlight = false;
        this.isRunning = false;
        this.guildChangeHandler = null;
        this.routerChangeHandler = null;
        this._routerUnsubscribe = null;
        this._refreshDebounce = null;
        this._chatContentObserver = null;
        this.patches = [];
        this.hiddenElements = new Set;
        this.hiddenParents = new Set;
        this.modules = {};
        this.originalVoiceMethods = {};
        this._soundPlayKey = null;
        this.settings = this.loadSettings();
        this._updateState = {
            status: "idle",
            latestVersion: null,
            remoteText: null
        };
        this._updateNotice = null;
        this._lastNotifiedVersion = null;
        this._periodicCheckInterval = null;
        this._lastCheckTimestamp = this.loadLastCheck();
        this._storePatched = false;
        this._readStatePatched = false;
        this._taskbarBadgePatched = false;
        this._taskbarElectronPatched = false;
        this._forumPostComponentPatched = false;
        this._messagesWrapPatched = false;
        this._rawGetMessages = null;
        this._updateResetTimer = null;
        this._oldUnblockedConnectedUsers = [];
        this._muteTimeout = null;
        this._lastStreamerId = null;
        this._dispatcherToken = null;
        this._lastActivityParticipantIds = new Set;
        this._inviteSuggestionsPatched = false;
        this._privateChannelStorePatched = false;
        this._mentionAutocompletePatched = false;
        this._activePostsPopoverPatched = false;
        this._lastContextMessageId = null;
        this._reactorModalPassTimer = null;
        this._contextMenuHandler = null;
        this._menuPortalObserver = null;
        this._roleSettingsClickHandler = null;
        this._blockedOnlyReadChannels = new Set;
        this._blockedReadCache = this.loadBlockedReadCache();
        this._notificationDispatcherPatched = false;
        this._blockedPinnedMessageIds = this.loadBlockedPinnedIds();
        this._pinPinnerByMessageId = this.loadPinPinnerCache();
        this._pendingPinsByChannel = new Map;
        this._channelPinsStorePatched = false;
        this._pinFluxPatched = false;
        this._soundboardPatched = false;
        this._guildMembersPagePatched = false;
        this._guildMemberStorePatched = false;
        this._memberListRowPatched = false;
        this._nmbDebugEnabled = false;
        this._nmbDebugEvents = [];
        this._nmbDebugPanelEl = null;
        this._nmbDebugMutObserver = null;
        this._historyPatchActive = false;
        this._origPushState = null;
        this._origReplaceState = null;
        this._storeResolveCache = {};
        this.hideStyles = `\n            display: none !important;\n            width: 0 !important;\n            height: 0 !important;\n            min-width: 0 !important;\n            min-height: 0 !important;\n            max-width: 0 !important;\n            max-height: 0 !important;\n            flex: 0 0 0 !important;\n            padding: 0 !important;\n            margin: 0 !important;\n            border: 0 !important;\n            overflow: hidden !important;\n            position: absolute !important;\n            opacity: 0 !important;\n            pointer-events: none !important;\n            transform: scale(0) !important;\n            visibility: hidden !important;\n            line-height: 0 !important;\n            font-size: 0 !important;\n            contain: size style !important;\n        `;
    }
    _nmbDescribeEl(el) {
        if (!el || !el.tagName) return "(no element)";
        const tag = el.tagName.toLowerCase();
        const cls = (el.className && typeof el.className === "string") ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
        const listId = el.dataset?.listItemId || el.getAttribute?.("data-list-item-id") || "";
        const text = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60);
        return `<${tag}${cls ? "." + cls : ""}>${listId ? ` [list-item=${listId}]` : ""}${text ? ` "${text}"` : " (empty)"}`;
    }
    enableDebug() {
        this._nmbDebugEnabled = true;
        this._nmbDebugEvents = [];
        console.log("%c[ByeBlocked debug] ON — hiding actions will now be logged and shown in the overlay panel", "color:#5865F2;font-weight:bold");
        this._nmbShowDebugPanel();
        return "ByeBlocked debug enabled. Reproduce the bug now, then check the panel (bottom-right) and console.";
    }
    disableDebug() {
        this._nmbDebugEnabled = false;
        this._nmbHideDebugPanel();
        console.log("%c[ByeBlocked debug] OFF", "color:#5865F2;font-weight:bold");
        return "ByeBlocked debug disabled.";
    }
    _nmbDebugLog(action, el, reason, userId) {
        if (!this._nmbDebugEnabled) return;
        const entry = {
            time: new Date().toLocaleTimeString(),
            action,
            reason,
            userId: userId || null,
            desc: this._nmbDescribeEl(el),
            el
        };
        this._nmbDebugEvents.push(entry);
        if (this._nmbDebugEvents.length > 300) this._nmbDebugEvents.shift();
        const color = action === "ghostHide" ? "#ed4245" : action === "hideParent" ? "#faa61a" : "#5865F2";
        console.log(`%c[ByeBlocked] ${action}`, `color:${color};font-weight:bold`, "reason:", reason, "userId:", userId, "el:", el, "text:", entry.desc);
        this._nmbRenderDebugPanel();
    }
    _nmbShowDebugPanel() {
        if (this._nmbDebugPanelEl && document.contains(this._nmbDebugPanelEl)) return;
        const panel = document.createElement("div");
        panel.id = "nmb-debug-panel";
        panel.style.cssText = `\n            position: fixed;\n            bottom: 16px;\n            right: 16px;\n            width: 420px;\n            max-height: 60vh;\n            background: #1e1f22;\n            color: #dcddde;\n            border: 1px solid #3a3c43;\n            border-radius: 8px;\n            font: 12px/1.4 monospace;\n            z-index: 999999;\n            box-shadow: 0 4px 20px rgba(0,0,0,0.6);\n            display: flex;\n            flex-direction: column;\n            overflow: hidden;\n        `;
        const header = document.createElement("div");
        header.style.cssText = "padding:8px 10px;background:#5865F2;color:#fff;font-weight:bold;display:flex;justify-content:space-between;align-items:center;cursor:move;";
        header.innerHTML = `<span>ByeBlocked Debug</span>`;
        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;gap:6px;";
        const mkBtn = (label, title) => {
            const b = document.createElement("button");
            b.textContent = label;
            b.title = title;
            b.style.cssText = "background:rgba(255,255,255,0.15);border:none;color:#fff;border-radius:4px;padding:2px 6px;cursor:pointer;font:11px monospace;";
            return b;
        };
        const clearBtn = mkBtn("Clear", "Clear log");
        clearBtn.onclick = () => {
            this._nmbDebugEvents = [];
            this._nmbRenderDebugPanel();
        };
        const scanBtn = mkBtn("Scan", "Force a full DOM scan now (like scanDom)");
        scanBtn.onclick = () => {
            try {
                this.scanDom();
            } catch (_) {}
        };
        const snapBtn = mkBtn("Snapshot", "Log a full snapshot of every currently-hidden element");
        snapBtn.onclick = () => this._nmbLogSnapshot();
        const closeBtn = mkBtn("✕", "Close panel (debug logging keeps running)");
        closeBtn.onclick = () => this._nmbHideDebugPanel();
        btnRow.append(clearBtn, scanBtn, snapBtn, closeBtn);
        header.appendChild(btnRow);
        const stats = document.createElement("div");
        stats.id = "nmb-debug-stats";
        stats.style.cssText = "padding:6px 10px;background:#2b2d31;border-bottom:1px solid #3a3c43;display:flex;gap:12px;flex-wrap:wrap;";
        const list = document.createElement("div");
        list.id = "nmb-debug-list";
        list.style.cssText = "overflow-y:auto;padding:6px 10px;flex:1;";
        panel.append(header, stats, list);
        document.body.appendChild(panel);
        this._nmbDebugPanelEl = panel;
        let dragging = false, offX = 0, offY = 0;
        header.addEventListener("mousedown", e => {
            dragging = true;
            const rect = panel.getBoundingClientRect();
            offX = e.clientX - rect.left;
            offY = e.clientY - rect.top;
        });
        document.addEventListener("mousemove", e => {
            if (!dragging) return;
            panel.style.left = `${e.clientX - offX}px`;
            panel.style.top = `${e.clientY - offY}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
        });
        document.addEventListener("mouseup", () => dragging = false);
        this._nmbRenderDebugPanel();
    }
    _nmbHideDebugPanel() {
        this._nmbDebugPanelEl?.remove();
        this._nmbDebugPanelEl = null;
    }
    _nmbRenderDebugPanel() {
        if (!this._nmbDebugPanelEl) return;
        const statsEl = this._nmbDebugPanelEl.querySelector("#nmb-debug-stats");
        const listEl = this._nmbDebugPanelEl.querySelector("#nmb-debug-list");
        if (!statsEl || !listEl) return;
        const hiddenBlockedCount = document.querySelectorAll('[data-hidden-blocked="true"]').length;
        const ghostCount = document.querySelectorAll('[data-nmb-ghost="true"]').length;
        const parentHiddenCount = document.querySelectorAll('[data-nmb-parent-hidden="true"]').length;
        statsEl.innerHTML = `\n            <span>hidden-blocked: <b style="color:#faa61a">${hiddenBlockedCount}</b></span>\n            <span>ghost: <b style="color:#ed4245">${ghostCount}</b></span>\n            <span>parent-hidden: <b style="color:#faa61a">${parentHiddenCount}</b></span>\n            <span>log: <b>${this._nmbDebugEvents.length}</b></span>\n        `;
        const recent = this._nmbDebugEvents.slice(-40).reverse();
        listEl.innerHTML = "";
        for (const entry of recent) {
            const row = document.createElement("div");
            row.style.cssText = "padding:4px 0;border-bottom:1px solid #2b2d31;";
            const color = entry.action === "ghostHide" ? "#ed4245" : entry.action === "hideParent" ? "#faa61a" : "#5865F2";
            row.innerHTML = `<span style="color:${color};font-weight:bold">${entry.time} ${entry.action}</span> <span style="color:#949ba4">(${entry.reason}${entry.userId ? ", user " + entry.userId : ""})</span><br><span style="color:#dcddde">${entry.desc.replace(/</g, "&lt;")}</span>`;
            const jumpBtn = document.createElement("button");
            jumpBtn.textContent = "highlight";
            jumpBtn.style.cssText = "margin-left:6px;background:#3a3c43;border:none;color:#fff;border-radius:3px;padding:1px 5px;cursor:pointer;font:10px monospace;";
            jumpBtn.onclick = () => {
                if (!entry.el || !document.contains(entry.el)) {
                    alert("Element no longer in DOM (probably re-rendered by Discord since this event).");
                    return;
                }
                entry.el.scrollIntoView({
                    block: "center",
                    behavior: "smooth"
                });
                const prevOutline = entry.el.style.outline;
                entry.el.style.outline = "3px solid #ed4245";
                setTimeout(() => entry.el.style.outline = prevOutline, 2000);
            };
            row.appendChild(jumpBtn);
            listEl.appendChild(row);
        }
    }
    _nmbLogSnapshot() {
        const groups = {
            "hidden-blocked": document.querySelectorAll('[data-hidden-blocked="true"]'),
            "ghost": document.querySelectorAll('[data-nmb-ghost="true"]'),
            "muted-voice": document.querySelectorAll('[data-nmb-muted-voice="true"]')
        };
        console.group("%c[ByeBlocked] Full snapshot", "color:#5865F2;font-weight:bold");
        for (const [ label, nodeList ] of Object.entries(groups)) {
            console.group(`${label} (${nodeList.length})`);
            nodeList.forEach(el => console.log(this._nmbDescribeEl(el), "reason:", el.dataset?.nmbReason || "(n/a)", el));
            console.groupEnd();
        }
        console.groupEnd();
        return `Snapshot logged to console: ${Object.entries(groups).map(([ k, v ]) => `${k}=${v.length}`).join(", ")}`;
    }
    _wpGetStore(...names) {
        for (const name of names) {
            try {
                const store = BdApi.Webpack.getStore(name);
                if (store) return store;
            } catch (_) {}
        }
        return this._wpGetStoreByHeuristic(names[0]);
    }
    _wpGetStoreByHeuristic(hintName) {
        if (!hintName) return null;
        const cacheKey = `store:${hintName}`;
        if (this._storeResolveCache && this._storeResolveCache[cacheKey]) return this._storeResolveCache[cacheKey];
        try {
            const stores = this._wpGetModule(m => m && typeof m === "object" && typeof m.addChangeListener === "function" && typeof m.getState === "function");
            if (!stores) return null;
            const allStores = Array.isArray(stores) ? stores : [stores];
            for (const mod of allStores) {
                const name = mod.getName?.() || mod.constructor?.displayName || mod.constructor?.name || "";
                if (name.toLowerCase().includes(hintName.toLowerCase().replace(/store$/i, ""))) {
                    if (!this._storeResolveCache) this._storeResolveCache = {};
                    this._storeResolveCache[cacheKey] = mod;
                    return mod;
                }
            }
            for (const mod of allStores) {
                try {
                    const state = mod.getState();
                    if (state && typeof state === "object") {
                        for (const key of Object.keys(state)) {
                            if (key.toLowerCase().includes(hintName.toLowerCase().replace(/store$/i, "").replace(/^./, c => c.toLowerCase()))) {
                                if (!this._storeResolveCache) this._storeResolveCache = {};
                                this._storeResolveCache[cacheKey] = mod;
                                return mod;
                            }
                        }
                    }
                } catch (_) {}
            }
        } catch (_) {}
        return null;
    }
    _wpGetModule(filter, opts) {
        try {
            return BdApi.Webpack.getModule(filter, opts);
        } catch (_) {
            return null;
        }
    }
    _wpGetBySource(source, opts) {
        try {
            return BdApi.Webpack.getBySource(source, opts);
        } catch (_) {
            return null;
        }
    }
    _wpGetModuleWithKey(filter) {
        try {
            return BdApi.Webpack.getModuleWithKey(filter);
        } catch (_) {
            return null;
        }
    }
    _safePatch(name, fn) {
        try {
            fn();
            return true;
        } catch (err) {
            this._nmbLogPatchFailure(name, err);
            return false;
        }
    }
    _nmbLogPatchFailure(name, err) {
        try {
            console.error(`%c[ByeBlocked] Patch "${name}" failed — this Discord update likely changed something the plugin depends on. The rest of ByeBlocked will keep running.`, "color:#f23f43;font-weight:bold", err);
            this._nmbStartupFailures = this._nmbStartupFailures || [];
            this._nmbStartupFailures.push({
                name: name,
                message: err?.message || String(err),
                time: Date.now()
            });
            if (this._nmbStartupFailures.length === 1) {
                this.toast(`⚠️ ByeBlocked: parte de uma funcionalidade (${name}) não pôde iniciar. Provavelmente o Discord mudou algo — o resto do plugin continua ativo. Veja o console para detalhes.`, "warn");
            }
        } catch (_) {}
    }
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
    _wpPatchRenderBySourceHeuristic(shouldSuppress, matchingStrings, label) {
        const self = this;
        const patched = this._wpPatchRenderByHeuristic(m => {
            if (typeof m !== "function") return false;
            try {
                const src = Function.prototype.toString.call(m);
                return matchingStrings.some(s => src.includes(s));
            } catch (_) { return false; }
        }, shouldSuppress, label);
        if (!patched) {
            try {
                const alt = this._wpGetModuleWithKey(m => {
                    if (typeof m !== "function") return false;
                    try {
                        const src = m.toString();
                        return matchingStrings.some(s => src.includes(s));
                    } catch (_) { return false; }
                });
                if (alt?.[0] && alt[1]) {
                    const [mod, key] = alt;
                    self.patches.push(BdApi.Patcher.instead(self.pluginName, mod, key, function(ctx, args, orig) {
                        try {
                            const props = args?.[0] || ctx?.props;
                            if (shouldSuppress(props, ctx, args)) return null;
                        } catch (_) {}
                        return orig.apply(ctx, args);
                    }));
                    return true;
                }
            } catch (_) {}
        }
        return patched;
    }
    _wpPatchRenderByHeuristic(moduleFilter, shouldSuppress, label) {
        const self = this;
        const patched = [];
        const tryPatch = (target, method, getProps) => {
            if (!target?.[method] || typeof target[method] !== "function") return false;
            self.patches.push(BdApi.Patcher.instead(self.pluginName, target, method, function(ctx, args, orig) {
                try {
                    const props = getProps ? getProps(ctx, args) : args?.[0] || ctx?.props;
                    if (shouldSuppress(props, ctx, args)) return null;
                } catch (_) {}
                return orig.apply(ctx, args);
            }));
            patched.push(method);
            return true;
        };
        try {
            const mod = this._wpGetModule(moduleFilter, {
                searchExports: true
            });
            if (!mod) return false;
            if (tryPatch(mod.prototype, "render", () => null)) {} else if (tryPatch(mod, "default", (ctx, args) => args?.[0])) {} else {
                const found = this._wpGetModuleWithKey(m => moduleFilter(m));
                if (found?.[0] && found[1]) tryPatch(found[0], found[1], (ctx, args) => args?.[0]);
            }
            if (patched.length) return true;
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
            BdApi.UI.showConfirmationModal("⚙️ ByeBlocked Settings", React.createElement(function() {
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
            this.toast("Go to BD Settings → Plugins → ByeBlocked ⚙️", "info");
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
                        this._updateNotice = BdApi.UI.showNotice(`🎉 ByeBlocked v${remote} is out! You're on v${local} — update available.`, {
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
            this.toast("Auto-install failed: " + err.message + " — download manually from GitHub.", "error");
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
                label: "Checking…",
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
                label: "Error — try again",
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
        return null;
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
            } else if (pinnerId && !this.shouldHide(pinnerId) && this._blockedPinnedMessageIds.has(messageId)) {
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
        if (!messageId || this._blockedPinnedMessageIds.has(messageId)) return;
        this._blockedPinnedMessageIds.add(String(messageId));
        this.saveBlockedPinnedIds();
        this.queueRefresh();
        this._forceReadStateRecheck();
        this._ackBlockedOnlyPins();
    }
    _unmarkMessageUnpinned(messageId) {
        if (!messageId || !this._blockedPinnedMessageIds.has(messageId)) return;
        this._blockedPinnedMessageIds.delete(messageId);
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
        if (!this.settings.places?.messages || !this._readStateHelpers) return;
        const helpers = this._readStateHelpers;
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
        const helpers = this._readStateHelpers;
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
        BdApi.Patcher.before(this.pluginName, electron, "setBadge", badgeBefore);
        this.patches.push(() => {
            try {
                BdApi.Patcher.unpatch(this.pluginName, electron, "setBadge");
            } catch (_) {}
        });
        try {
            const nativeApp = typeof DiscordNative !== "undefined" ? DiscordNative?.app : null;
            if (nativeApp?.setBadgeCount) {
                BdApi.Patcher.before(this.pluginName, nativeApp, "setBadgeCount", badgeBefore);
                this.patches.push(() => {
                    try {
                        BdApi.Patcher.unpatch(this.pluginName, nativeApp, "setBadgeCount");
                    } catch (_) {}
                });
            }
        } catch (_) {}
        try {
            const altElectron = this._wpGetModuleByKeys("setSystemTrayApplications", "setBadge");
            if (altElectron?.setBadge && altElectron !== electron) {
                BdApi.Patcher.before(this.pluginName, altElectron, "setBadge", badgeBefore);
                this.patches.push(() => {
                    try {
                        BdApi.Patcher.unpatch(this.pluginName, altElectron, "setBadge");
                    } catch (_) {}
                });
            }
        } catch (_) {}
        if (typeof electron.setSystemTrayIcon === "function") {
            BdApi.Patcher.before(this.pluginName, electron, "setSystemTrayIcon", (_, args) => {
                if (!self._taskbarBadgeEnabled()) return;
                if (!self._readStatePatched) {
                    if (args[0] === "UNREAD") args[0] = "DEFAULT";
                    return;
                }
                if (args[0] !== "UNREAD") return;
                const count = self._recomputeTaskbarBadgeCount();
                if (!count) args[0] = "DEFAULT";
            });
            this.patches.push(() => {
                try {
                    BdApi.Patcher.unpatch(this.pluginName, electron, "setSystemTrayIcon");
                } catch (_) {}
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
        this._readStateReloadRecheckTimers = [ 0, 150, 400, 900, 1800, 3500, 7e3, 12e3 ].map(delay => setTimeout(() => {
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
        this.observer?.disconnect();
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
        const MAX_ATTEMPTS = 40;
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
    _restartObserver() {
        this.observer?.disconnect();
        this.observer = new MutationObserver(mutations => {
            try {
                this._fastHideFromMutations(mutations);
            } catch (_) {}
            this.queueScan();
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
        const eventsGuardRule = this.settings.places.events ? `\n            li:has([data-list-item-id^="channels___upcoming-events-"]) {\n                visibility: hidden !important;\n            }\n        ` : "";
        style.textContent = `\n            [class*="messageGroupBlocked"],\n            [class*="blockedSystemMessage"],\n            li[class*="messageListItem"]:has([class*="messageGroupBlocked"]),\n            li[class*="messageListItem"]:has([class*="blockedSystemMessage"]) {\n                display: none !important;\n                height: 0 !important;\n                overflow: hidden !important;\n                contain: size style !important;\n            }\n            ${voiceTimerRule}\n            ${eventsGuardRule}\n        `;
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
this.patches.push(() => {
                if (this._historyPatchActive) {
                    history.pushState = this._origPushState;
                    history.replaceState = this._origReplaceState;
                    this._historyPatchActive = false;
                    this._origPushState = null;
                    this._origReplaceState = null;
                    this._storeResolveCache = {};
                }
            });
        } catch (_) {}
    }
    start(_retryAttempt = 0) {
        if (this.isRunning) return;
        this.isRunning = true;
        window.__byeBlocked = this;
        this._injectGuildSwitchGuard();
        this._safePatch("resolveModules", () => this.resolveModules());
        if (!this.modules.RelationshipStore?.isBlocked) {
            const maxAttempts = 12;
            if (_retryAttempt < maxAttempts) {
                this.isRunning = false;
                const delay = Math.min(1000 * Math.pow(1.5, _retryAttempt), 20000);
                console.warn(`%c[ByeBlocked] RelationshipStore not found yet (attempt ${_retryAttempt + 1}/${maxAttempts}). Discord may still be loading, or this update changed something. Retrying in ${Math.round(delay / 1000)}s...`, "color:#f0b232;font-weight:bold");
                clearTimeout(this._moduleRetryTimeout);
                this._moduleRetryTimeout = setTimeout(() => this.start(_retryAttempt + 1), delay);
                return;
            }
            this.isRunning = false;
            this.toast("ByeBlocked: não foi possível localizar o RelationshipStore do Discord após várias tentativas. O Discord provavelmente mudou algo — verifique se há uma atualização do plugin.", "error");
            console.error("[ByeBlocked] Giving up after repeated attempts to resolve RelationshipStore. This usually means Discord changed the module Bye Blocked depends on.");
            return;
        }
        clearTimeout(this._moduleRetryTimeout);
        this._safePatch("patchReadState", () => this.patchReadState());
        this._safePatch("scheduleReadStateReloadRechecks", () => this._scheduleReadStateReloadRechecks());
        this._safePatch("addStyles", () => this.addStyles());
        this._safePatch("patchStores", () => this.patchStores());
        this._safePatch("patchChannelPinsStore", () => this.patchChannelPinsStore());
        this._safePatch("patchPinFlux", () => this.patchPinFlux());
        this._safePatch("patchPrivateChannelStore", () => this.patchPrivateChannelStore());
        this._safePatch("patchGuildMemberStore", () => this.patchGuildMemberStore());
        this._safePatch("patchActivePostsPopoverComponent", () => this.patchActivePostsPopoverComponent());
        this._safePatch("patchReactions", () => this.patchReactions());
        this._safePatch("patchRelationshipUpdates", () => this.patchRelationshipUpdates());
        this._safePatch("patchBlockedMessageGroup", () => this.patchBlockedMessageGroup());
        this._safePatch("patchMessagesWrapComponent", () => this.patchMessagesWrapComponent());
        this._safePatch("patchForumPostComponent", () => this.patchForumPostComponent());
        this._safePatch("patchMessageStore", () => this.patchMessageStore());
        this._safePatch("restartObserver", () => this._restartObserver());
        this._safePatch("startReactionClickWatcher", () => this._startReactionClickWatcher());
        this._safePatch("startChannelSwitchWatcher", () => this._startChannelSwitchWatcher());
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
            this._safePatch("patchInviteSuggestions", () => this.patchInviteSuggestions());
            this._safePatch("patchMentionAutocomplete", () => this.patchMentionAutocomplete());
            this._safePatch("patchGuildMembersPageRow", () => this.patchGuildMembersPageRow());
            this._safePatch("patchMemberListRow", () => this.patchMemberListRow());
        }, 2e3);
        setTimeout(() => {
            this._safePatch("patchSoundboardEffects", () => this.patchSoundboardEffects());
            if (this.settings.behavior.muteVoiceJoinLeaveSound) {
                this._safePatch("patchSound", () => this.patchSound());
            }
        }, 2e3);
        this._patchHistoryApi();
        window.__byeBlockedToggleSound = enable => {
            if (enable === undefined) enable = !this.settings.behavior.muteVoiceJoinLeaveSound;
            this.settings.behavior.muteVoiceJoinLeaveSound = enable;
            this.saveSettings(true);
            this.toast(`Sound suppression ${enable ? "enabled" : "disabled"}. Reload plugin to apply.`, "info");
        };
        this._roleSettingsClickHandler = event => {
            const link = event.target.closest?.('[data-nmb-open-role-settings="true"]');
            if (!link) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                this._closeEventsPopoverFrom(link);
                this._openGuildRolesSettings();
            } catch (_) {
                this.toast("⚠️ Não foi possível abrir as configurações do servidor automaticamente.", "warn");
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
        this._nmbHideDebugPanel();
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
        for (const unpatch of this.patches.splice(0)) {
            try {
                unpatch();
            } catch (_) {}
        }
        try {
            BdApi.Patcher.unpatchAll(this.pluginName);
        } catch (_) {}
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
            try {
                this._routerUnsubscribe();
            } catch (_) {}
            this._routerUnsubscribe = null;
        }
        this._storePatched = false;
        this._readStatePatched = false;
        this._taskbarBadgePatched = false;
        this._taskbarElectronPatched = false;
        this._notificationDispatcherPatched = false;
        if (this._blockedOnlyReadChannels) this._blockedOnlyReadChannels.clear();
        this._forumPostComponentPatched = false;
        this._messagesWrapPatched = false;
        this._rawGetMessages = null;
        this.modules.ElectronModule = null;
        this._oldUnblockedConnectedUsers = [];
        this._soundPlayKey = null;
        this._lastStreamerId = null;
        this._lastActivityParticipantIds = new Set;
        this._inviteSuggestionsPatched = false;
        this._privateChannelStorePatched = false;
        this._mentionAutocompletePatched = false;
        this._activePostsPopoverPatched = false;
        this._guildMembersPagePatched = false;
        this._guildMemberStorePatched = false;
        this._memberListRowPatched = false;
        if (this._muteTimeout) {
            clearTimeout(this._muteTimeout);
            this._muteTimeout = null;
        }
        if (this._reactorModalPassTimer) {
            clearTimeout(this._reactorModalPassTimer);
            this._reactorModalPassTimer = null;
        }
        delete window.__byeBlockedToggleSound;
    }
    resolveModules() {
        const getStore = (...names) => this._wpGetStore(...names);
        const getModule = (filter, opts) => this._wpGetModule(filter, opts);
        this.modules.RelationshipStore = getStore("RelationshipStore", "RelationshipManagerStore");
        this.modules.GuildMemberStore = getStore("GuildMemberStore");
        this.modules.ReactionsStore = getStore("ReactionsStore", "MessageReactionsStore");
        this.modules.SortedVoiceStateStore = getStore("SortedVoiceStateStore", "VoiceStateStore");
        this.modules.StageChannelParticipantStore = getStore("StageChannelParticipantStore");
        this.modules.ChannelStore = getStore("ChannelStore");
        this.modules.MessageStore = getStore("MessageStore");
        this._resolveMessagesGet();
        this.modules.UserStore = getStore("UserStore");
        this.modules.SelectedGuildStore = getStore("SelectedGuildStore");
        this.modules.RelationshipUtils = getModule(m => m?.addRelationship && m?.removeRelationship);
        this.modules.SelectedChannelStore = getStore("SelectedChannelStore");
        this.modules.VoiceStateStore = getStore("VoiceStateStore");
        this.modules.MediaEngineStore = getStore("MediaEngineStore");
        this.modules.ReadStateStore = getStore("ReadStateStore", "ChannelReadStateStore");
        this.modules.GuildReadStateStore = getStore("GuildReadStateStore", "GuildUnreadStore");
        this.modules.GuildChannelStore = getStore("GuildChannelStore");
        this.modules.GuildStore = getStore("GuildStore");
        this.modules.PrivateChannelStore = getStore("PrivateChannelStore");
        this.modules.NotificationSettingsStore = getStore("NotificationSettingsStore");
        this.modules.ChannelPinsStore = getStore("ChannelPinsStore");
        this.modules.ActiveJoinedThreadsStore = getStore("ActiveJoinedThreadsStore");
        this.modules.ThreadStore = getStore("ActiveThreadsStore", "ThreadStore", "ForumChannelStore", "GuildThreadStore");
        this.modules.GuildScheduledEventStore = getStore("GuildScheduledEventStore");
        this._resolveDispatcher();
        this.modules.RTCConnectionUtils = getModule(m => typeof m?.getChannelId === "function" && typeof m?.getGuildId === "function");
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
            BdApi.Patcher.after(this.pluginName, this, "resolveModules", () => {
                this._resolveDispatcher();
                this._resolveMessagesGet();
                this._resolveSoundUtils();
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
            console.warn(`%c[ByeBlocked] Could not resolve module(s): ${missing.join(", ")}. Discord likely changed internals; ByeBlocked will retry automatically.`, "color:#f0b232;font-weight:bold");
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
        this.patches.push(BdApi.Patcher.after(this.pluginName, mod, key, function(_, args, result) {
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
        }));
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
            }, ["row__", "thread", "active"], "Active posts popover row");
        if (patched) this._activePostsPopoverPatched = true;
    }
    patchGuildMembersPageRow(attempt = 0) {
        if (!this.settings.places.memberList || this._guildMembersPagePatched) return;
        const self = this;
        const patched = this._wpPatchRenderBySourceHeuristic(props => {
            const userId = self.extractUserId(props);
            return !!(userId && self.shouldHide(userId));
        }, ["memberRow", "guildMember", "joinedAt", "userId"], "Guild members page row");
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
        }, ["nameplate", "hideClanTag", "colorRoleName", "shouldAnimateStatus"], "Member list row (sidebar)");
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
        if (stageStore?.getMutableParticipants) {
            this.patchAfter(stageStore, "getMutableParticipants", (_, __, ret) => {
                if (!this.settings.places.voiceChannels || !Array.isArray(ret)) return ret;
                return ret.filter(participant => !this.shouldHide(this.extractUserId(participant)));
            });
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
                this.patches.push(BdApi.Patcher.instead(this.pluginName, CardModule.prototype, "render", function(context, args, original) {
                    const result = beforeRender(context, [ context.props ]);
                    return result === null ? null : original.apply(context, args);
                }));
                patchedAny = true;
            } else if (CardModule?.default && looksLikeForumCardFn(CardModule.default)) {
                this.patches.push(BdApi.Patcher.instead(this.pluginName, CardModule, "default", function(context, args, original) {
                    const result = beforeRender(context, args);
                    return result === null ? null : original.apply(context, args);
                }));
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
                    this.patches.push(BdApi.Patcher.instead(this.pluginName, moduleObj, key, function(context, args, original) {
                        const result = beforeRender(context, args);
                        return result === null ? null : original.apply(context, args);
                    }));
                    patchedAny = true;
                }
            } catch (_) {}
        }
        if (patchedAny) this._forumPostComponentPatched = true;
    }
    patchBlockedMessageGroup() {
        if (!this.settings.places.messages) return;
        try {
            const BlockedMessageGroup = BdApi.Webpack.getModule(m => m?.displayName === "BlockedMessageGroup" || m?.name === "BlockedMessageGroup" || m?.prototype?.render?.toString?.().includes("MESSAGE_GROUP_BLOCKED") || typeof m === "function" && m.toString && m.toString().includes("messageGroupSpacing"));
            if (BlockedMessageGroup?.prototype?.render) {
                this.patches.push(BdApi.Patcher.instead(this.pluginName, BlockedMessageGroup.prototype, "render", () => null));
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
                this.patches.push(BdApi.Patcher.instead(this.pluginName, moduleObj, key, () => null));
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
                            this.patches.push(BdApi.Patcher.instead(this.pluginName, m, key, () => null));
                            patched = true;
                        }
                    } catch (_) {}
                }
                return false;
            }, {
                searchExports: true
            });
        } catch (_) {}
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
                this.patches.push(BdApi.Patcher.before(this.pluginName, MessagesWrap.prototype, "render", context => applyFilterToProps(context?.props)));
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
        this.patches.push(BdApi.Patcher.before(this.pluginName, Dispatcher, "dispatch", function(_, args) {
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
        }));
        this._pinFluxPatched = true;
    }
    patchReadState() {
        this._ensureTaskbarElectronPatch();
        if (!this.modules.ReadStateStore) return;
        if (this._readStatePatched) return;
        const self = this;
        const getChannelMessages = channelId => {
            try {
                const rawGetMessages = self._rawGetMessages;
                const ret = rawGetMessages ? rawGetMessages(channelId) : self.modules.MessageStore?.getMessages?.(channelId);
                if (Array.isArray(ret)) return ret;
                if (Array.isArray(ret?._array)) return ret._array;
                if (ret instanceof Map) return Array.from(ret.values());
                if (ret && typeof ret === "object") return Object.values(ret);
            } catch (_) {}
            return [];
        };
        const getAuthorId = msg => msg?.author?.id || msg?.authorId || msg?.user?.id;
        const isBlockedMessage = msg => {
            if (!msg) return false;
            if (msg.blocked === true) return true;
            const authorId = getAuthorId(msg);
            return !!(authorId && self.shouldHide(authorId));
        };
        this.patchAfter(this.modules.ReadStateStore, "getUnreadCount", function(_, args, ret) {
            if (!self.settings.places?.messages) return ret;
            if (!ret || typeof ret !== "number" || ret <= 0) return ret;
            const channelId = args?.[0];
            if (!channelId) return ret;
            try {
                const messages = getChannelMessages(channelId).slice().reverse();
                let hiddenCount = 0;
                for (let i = 0; i < ret && i < messages.length; i++) {
                    if (isBlockedMessage(messages[i])) hiddenCount++; else break;
                }
                return ret - hiddenCount;
            } catch (_) {
                return ret;
            }
        });
        const snowflakeGreater = (a, b) => {
            if (!a) return false;
            if (!b) return true;
            try {
                return BigInt(a) > BigInt(b);
            } catch (_) {
                return String(a) > String(b);
            }
        };
        const FORUM_CHANNEL_TYPE = 15;
        const flattenThreadEntries = list => {
            if (!list) return [];
            if (Array.isArray(list)) return list;
            return Object.values(list).flatMap(v => Array.isArray(v) ? v : [ v ]);
        };
        const getThreadOwnerId = threadOrId => {
            if (!threadOrId) return null;
            if (typeof threadOrId === "object") {
                const direct = threadOrId.ownerId || threadOrId.owner_id || threadOrId.thread?.ownerId || threadOrId.thread?.owner_id || threadOrId.channel?.ownerId || threadOrId.channel?.owner_id;
                if (direct) return direct;
                threadOrId = threadOrId.id || threadOrId.channel?.id;
            }
            if (!threadOrId) return null;
            try {
                const ch = self.modules.ChannelStore?.getChannel?.(threadOrId);
                return ch?.ownerId || ch?.owner_id || null;
            } catch (_) {
                return null;
            }
        };
        const isForumParentChannel = channelId => {
            try {
                return self.modules.ChannelStore?.getChannel?.(channelId)?.type === FORUM_CHANNEL_TYPE;
            } catch (_) {
                return false;
            }
        };
        const collectThreadsForParent = (channelId, guildId) => {
            const seen = new Map;
            const add = thread => {
                if (!thread) return;
                const id = thread?.id || thread?.channel?.id;
                if (id && !seen.has(id)) seen.set(id, thread);
            };
            try {
                const fn = self.modules.ChannelStore?.getAllThreadsForParent;
                if (typeof fn === "function") {
                    const threads = fn.call(self.modules.ChannelStore, channelId);
                    if (Array.isArray(threads)) threads.forEach(add);
                }
            } catch (_) {}
            try {
                const ts = self.modules.ThreadStore;
                if (typeof ts?.getThreadsForParent === "function") {
                    const args = guildId ? [ guildId, channelId ] : [ channelId ];
                    const ret = ts.getThreadsForParent(...args);
                    if (Array.isArray(ret)) ret.forEach(add); else if (ret && typeof ret === "object") Object.values(ret).forEach(add);
                }
            } catch (_) {}
            try {
                const ajs = self.modules.ActiveJoinedThreadsStore;
                if (ajs) {
                    const args = guildId ? [ guildId, channelId ] : [ channelId ];
                    flattenThreadEntries(ajs.getActiveJoinedThreadsForParent?.(...args)).forEach(add);
                    flattenThreadEntries(ajs.getActiveUnjoinedThreadsForParent?.(...args)).forEach(add);
                }
            } catch (_) {}
            return Array.from(seen.values());
        };
        const resolveForumActivityOwnerId = (parentChannelId, activityId) => {
            if (!activityId) return null;
            let ownerId = getThreadOwnerId(activityId);
            if (ownerId) return ownerId;
            const parent = self.modules.ChannelStore?.getChannel?.(parentChannelId);
            const guildId = parent?.guild_id;
            const threads = collectThreadsForParent(parentChannelId, guildId);
            for (const thread of threads) {
                const threadId = thread?.id || thread?.channel?.id;
                const lastMsgId = thread?.lastMessageId || thread?.channel?.lastMessageId;
                if (threadId !== activityId && lastMsgId !== activityId) continue;
                ownerId = getThreadOwnerId(thread);
                if (ownerId) return ownerId;
            }
            try {
                const getMessage = self.modules.MessageStore?.getMessage;
                if (typeof getMessage === "function") {
                    for (const thread of threads) {
                        const threadId = thread?.id || thread?.channel?.id;
                        if (!threadId) continue;
                        const msg = getMessage(threadId, activityId);
                        if (msg) return getAuthorId(msg);
                    }
                    const parentMsg = getMessage(parentChannelId, activityId);
                    if (parentMsg) return getAuthorId(parentMsg);
                }
            } catch (_) {}
            try {
                const msg = getChannelMessages(parentChannelId).find(m => m?.id === activityId);
                if (msg) return getAuthorId(msg);
            } catch (_) {}
            for (const thread of threads) {
                const threadId = thread?.id || thread?.channel?.id;
                if (!threadId) continue;
                try {
                    const msg = getChannelMessages(threadId).find(m => m?.id === activityId);
                    if (msg) return getAuthorId(msg);
                } catch (_) {}
            }
            if (guildId && self.modules.GuildChannelStore?.getChannels) {
                try {
                    const channelGroups = self.modules.GuildChannelStore.getChannels(guildId);
                    const allEntries = channelGroups ? Object.values(channelGroups).flat() : [];
                    for (const entry of allEntries) {
                        const ch = entry?.channel || entry;
                        if (!ch?.id || ch.parent_id !== parentChannelId) continue;
                        if (ch.id !== activityId && ch.lastMessageId !== activityId) continue;
                        ownerId = ch.ownerId || ch.owner_id;
                        if (ownerId) return ownerId;
                    }
                } catch (_) {}
            }
            return null;
        };
        const hasVisibleUnreadThreadsFromStore = (channelId, guildId) => {
            const ajs = self.modules.ActiveJoinedThreadsStore;
            if (!ajs) return null;
            try {
                const args = guildId ? [ guildId, channelId ] : [ channelId ];
                const visibleUnread = [ ...flattenThreadEntries(ajs.getActiveJoinedUnreadThreadsForParent?.(...args)), ...flattenThreadEntries(ajs.getActiveUnjoinedUnreadThreadsForParent?.(...args)) ];
                return visibleUnread.length > 0;
            } catch (_) {
                return null;
            }
        };
        const hasVisibleForumActivity = channelId => {
            try {
                if (self._hasBlockedOnlyReadActivity(channelId)) return false;
                if (!isForumParentChannel(channelId)) return null;
                const ackId = self.modules.ReadStateStore.ackMessageId ? self.modules.ReadStateStore.ackMessageId(channelId) : null;
                const lastActivityId = self.modules.ReadStateStore.lastMessageId ? self.modules.ReadStateStore.lastMessageId(channelId) : null;
                if (!snowflakeGreater(lastActivityId, ackId)) return false;
                const parent = self.modules.ChannelStore?.getChannel?.(channelId);
                const guildId = parent?.guild_id;
                const threads = collectThreadsForParent(channelId, guildId);
                if (threads.length) {
                    for (const thread of threads) {
                        const ownerId = getThreadOwnerId(thread);
                        const activityId = thread?.lastMessageId || thread?.channel?.lastMessageId || thread?.id;
                        if (!snowflakeGreater(activityId, ackId)) continue;
                        if (!ownerId) continue;
                        if (!self.shouldHide(ownerId)) return true;
                    }
                    const activityOwnerId = resolveForumActivityOwnerId(channelId, lastActivityId);
                    if (activityOwnerId) return !self.shouldHide(activityOwnerId);
                    return false;
                }
                const activityOwnerId = resolveForumActivityOwnerId(channelId, lastActivityId);
                if (activityOwnerId) return !self.shouldHide(activityOwnerId);
                const visibleUnread = hasVisibleUnreadThreadsFromStore(channelId, guildId);
                if (visibleUnread === true) return true;
                if (visibleUnread === false) return false;
                try {
                    if (self.modules.ReadStateStore.getUnreadCount?.(channelId) === 0) return false;
                } catch (_) {}
                return null;
            } catch (_) {
                return null;
            }
        };
        this.patchInstead(this.modules.ReadStateStore, "hasUnread", function(ctx, args, orig) {
            const channelId = args?.[0];
            if (channelId && self.settings.places?.messages && self._hasBlockedOnlyReadActivity(channelId)) return false;
            const ret = orig.apply(ctx, args);
            if (!ret) return ret;
            if (!self.settings.places?.messages) return ret;
            if (!channelId) return ret;
            try {
                if (isForumParentChannel(channelId)) {
                    const forumResult = hasVisibleForumActivity(channelId);
                    if (forumResult !== null) return forumResult;
                }
                const store = self.modules.ReadStateStore;
                const oldestUnreadId = store.getOldestUnreadMessageId ? store.getOldestUnreadMessageId(channelId) : null;
                const messages = getChannelMessages(channelId);
                if (!messages.length) {
                    const forumResult = hasVisibleForumActivity(channelId);
                    if (forumResult !== null) return forumResult;
                    const blockedOnly = self._resolveUnreadFromBlockedOnly(channelId, store, self._readStateHelpers || {
                        isBlockedMessage: isBlockedMessage,
                        resolveForumActivityOwnerId: resolveForumActivityOwnerId
                    });
                    if (blockedOnly === false) return false;
                    return ret;
                }
                if (oldestUnreadId) {
                    const idx = messages.findIndex(m => m?.id === oldestUnreadId);
                    if (idx !== -1) {
                        const unreadSlice = messages.slice(idx);
                        const anyVisibleUnread = unreadSlice.some(m => !isBlockedMessage(m));
                        return anyVisibleUnread;
                    }
                }
                const lastMessageId = store.lastMessageId ? store.lastMessageId(channelId) : null;
                const lastMessage = lastMessageId ? messages.find(m => m?.id === lastMessageId) : null;
                if (lastMessage && isBlockedMessage(lastMessage)) {
                    const anyVisibleUnread = messages.some(m => !isBlockedMessage(m));
                    if (!anyVisibleUnread) return false;
                }
                const blockedOnly = self._resolveUnreadFromBlockedOnly(channelId, store, self._readStateHelpers || {
                    isBlockedMessage: isBlockedMessage,
                    resolveForumActivityOwnerId: resolveForumActivityOwnerId
                });
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
                    if (isForumParentChannel(channelId)) {
                        const forumResult = hasVisibleForumActivity(channelId);
                        if (forumResult !== null) return forumResult;
                    }
                    const messages = getChannelMessages(channelId);
                    if (!messages.length) {
                        const forumResult = hasVisibleForumActivity(channelId);
                        if (forumResult !== null) return forumResult;
                        const store = self.modules.ReadStateStore;
                        const blockedOnly = self._resolveUnreadFromBlockedOnly(channelId, store, self._readStateHelpers || {
                            isBlockedMessage: isBlockedMessage,
                            resolveForumActivityOwnerId: resolveForumActivityOwnerId
                        });
                        if (blockedOnly === false) return false;
                    }
                    return ret;
                } catch (_) {
                    return ret;
                }
            });
        }
        const channelCountsAsGuildUnread = channelId => {
            const rs = self.modules.ReadStateStore;
            if (!rs || !channelId) return false;
            if (typeof rs.hasTrackedUnread === "function" && rs.hasTrackedUnread(channelId)) return true;
            if (typeof rs.hasUnreadOrMentions === "function" && rs.hasUnreadOrMentions(channelId)) return true;
            return !!rs.hasUnread?.(channelId);
        };
        if (this.modules.GuildReadStateStore && this.modules.GuildChannelStore) {
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
                    const visible = selectable.map(entry => entry?.channel?.id).filter(Boolean).some(channelCountsAsGuildUnread);
                    if (visible) return true;
                    if (self._guildHasBlockedOnlyUnread(guildId)) return false;
                    return false;
                } catch (_) {
                    return ret;
                }
            });
        }
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
            const isBlockedThreadEntry = entry => {
                const ownerId = getThreadOwnerId(entry);
                return !!(ownerId && self.shouldHide(ownerId));
            };
            const filterThreadList = list => {
                if (Array.isArray(list)) return list.filter(entry => !isBlockedThreadEntry(entry));
                if (list && typeof list === "object") {
                    const out = {};
                    for (const [key, val] of Object.entries(list)) {
                        if (Array.isArray(val)) {
                            const filtered = val.filter(entry => !isBlockedThreadEntry(entry));
                            if (filtered.length) out[key] = filtered;
                        } else if (val && typeof val === "object" && ("ownerId" in val || "owner_id" in val)) {
                            if (!isBlockedThreadEntry(val)) out[key] = val;
                        } else {
                            out[key] = val;
                        }
                    }
                    return out;
                }
                return list;
            };
            this.patchAfter(threadsStore, "getActiveJoinedUnreadThreadsForParent", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getActiveJoinedUnreadThreadsForGuild", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getActiveUnjoinedUnreadThreadsForParent", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getActiveUnjoinedUnreadThreadsForGuild", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getActiveJoinedThreadsForParent", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getActiveJoinedThreadsForGuild", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getActiveJoinedRelevantThreadsForParent", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getActiveJoinedRelevantThreadsForGuild", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getActiveUnjoinedThreadsForParent", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
            this.patchAfter(threadsStore, "getActiveUnjoinedThreadsForGuild", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.settings.places?.messages) return ret;
                try {
                    return filterThreadList(ret);
                } catch (_) {
                    return ret;
                }
            });
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
                self.patches.push(BdApi.Patcher.before(self.pluginName, Dispatcher, "dispatch", (_, args) => {
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
                }));
                self._notificationDispatcherPatched = true;
            }
        }
        this._readStatePatched = true;
        self._readStateHelpers = {
            getChannelMessages: getChannelMessages,
            isBlockedMessage: isBlockedMessage,
            isForumParentChannel: isForumParentChannel,
            hasVisibleForumActivity: hasVisibleForumActivity,
            resolveForumActivityOwnerId: resolveForumActivityOwnerId
        };
        self._applyBlockedReadCacheOnStartup();
        self._bootstrapBlockedUnreadSuppression();
        self._refreshTaskbarBadge();
    }
    patchBefore(target, method, callback) {
        try {
            if (!target?.[method]) return;
            this.patches.push(BdApi.Patcher.before(this.pluginName, target, method, callback));
        } catch (_) {}
    }
    patchInstead(target, method, callback) {
        try {
            if (!target?.[method]) return;
            this.patches.push(BdApi.Patcher.instead(this.pluginName, target, method, callback));
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
            const filtered = new Map;
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
    _startChannelSwitchWatcher() {
        if (this._channelSwitchChangeHandler) return;
        const store = this.modules.SelectedChannelStore;
        if (!store?.addChangeListener) return;
        this._lastWatchedChannelId = store.getChannelId?.() || null;
        this._channelSwitchChangeHandler = () => {
            const channelId = store.getChannelId?.() || null;
            if (channelId === this._lastWatchedChannelId) return;
            this._lastWatchedChannelId = channelId;
            for (const delay of [ 0, 50, 150, 400, 900 ]) {
                setTimeout(() => {
                    if (!this.isRunning) return;
                    try {
                        if (this.settings.places.messages) this.hideForumPosts();
                        if (this.settings.places.memberList) this.hideMemberRows();
                        if (this.settings.places.groupDms || this.settings.places.messages) this.hidePrivateChannels();
                    } catch (_) {}
                }, delay);
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
    queueScan() {
        if (!this.isRunning || this.scanTimeout) return;
        this._nmbWatchdogCheck();
        this.scanTimeout = setTimeout(() => {
            this.scanTimeout = null;
            this.scanDom();
        }, 0);
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
                console.warn(`%c[ByeBlocked] Watchdog detected a problem (store: ${storeBroken ? "missing" : "ok"}, observer: ${observerBroken ? "missing" : "ok"}, dispatcher: ${dispatcherBroken ? "missing" : "ok"}, msgStore: ${msgStoreBroken ? "missing" : "ok"}). Attempting self-heal...`, "color:#f0b232;font-weight:bold");
                if (storeBroken) {
                    this._safePatch("watchdog:resolveModules", () => this.resolveModules());
                }
                if (dispatcherBroken) {
                    this._safePatch("watchdog:resolveDispatcher", () => this._resolveDispatcher());
                }
                if (msgStoreBroken) {
                    this._safePatch("watchdog:resolveMessagesGet", () => this._resolveMessagesGet());
                }
                if (observerBroken || storeBroken) {
                    this._safePatch("watchdog:restartObserver", () => this._restartObserver());
                }
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
    }
    _startContextMenuWatcher() {
        if (this._contextMenuHandler) return;
        const resolveMessageId = fromEl => {
            const messageRow = fromEl?.closest?.('li[class*="messageListItem"], [class*="messageListItem"]');
            if (!messageRow) return null;
            const idMatch = messageRow.id?.match(/chat-messages-(?:\d+-)?(\d+)$/);
            return idMatch ? idMatch[1] : messageRow.id || null;
        };
        const capture = event => {
            const resolved = resolveMessageId(event.target);
            if (resolved) this._lastContextMessageId = resolved;
            for (const delay of [ 0, 50, 150, 300, 600 ]) {
                setTimeout(() => {
                    try {
                        if (this.settings.places.reactions) this._hideViewReactionsMenuItem();
                    } catch (_) {}
                }, delay);
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
                    const menuItem = node.id === "message-actions-reactions" ? node : node.querySelector?.("#message-actions-reactions");
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
            }, 20);
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
            const store = this.modules.ReactionsStore;
            if (!store || typeof store.getReactions !== "function" || !messageId) return true;
            const SelectedChannelStore = this.modules.SelectedChannelStore;
            const channelId = SelectedChannelStore?.getChannelId?.();
            if (!channelId) return true;
            const container = document.getElementById(`message-reactions-${messageId}`);
            if (!container) return true;
            const emojiImgs = container.querySelectorAll('img.emoji, img[class*="emoji"]');
            if (!emojiImgs.length) return false;
            for (const img of emojiImgs) {
                const name = img.getAttribute("data-name");
                if (!name) continue;
                const id = img.getAttribute("data-id") || null;
                let users;
                try {
                    users = this._getFilteredReactions(store, channelId, messageId, {
                        id: id,
                        name: name
                    }, 0);
                } catch (_) {
                    continue;
                }
                if (this._reactionUsersSize(users) > 0) return true;
            }
            return false;
        } catch (_) {
            return true;
        }
    }
    _hideViewReactionsMenuItem() {
        const item = document.getElementById("message-actions-reactions");
        if (!item) return;
        const focusedRow = document.querySelector('li[class*="messageListItem"][class*="contextMenuOpen"], li[class*="messageListItem"][aria-expanded="true"]');
        const idFromFocused = focusedRow?.id?.match(/chat-messages-(?:\d+-)?(\d+)$/)?.[1] || null;
        const messageId = idFromFocused || this._lastContextMessageId;
        const hasReal = this._messageHasRealReaction(messageId);
        if (item.dataset.nmbHideViewReactions === "true") delete item.dataset.nmbHideViewReactions;
        if (!hasReal) item.dataset.nmbHideViewReactions = "true";
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
                    if (placeholder && /Be the first|start this conversation|Seja o primeiro|começar essa conversa|empty/i.test(placeholder.textContent || "")) {
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
    _findLocalizedForumEmptyText() {
        const locale = this._getClientLocale();
        const ptBr = "Seja o primeiro a começar essa conversa!";
        const enUs = "Be the first to start this conversation!";
        const dict = {
            "pt-br": ptBr,
            pt: ptBr,
            "en-us": enUs,
            en: enUs
        };
        return dict[locale] || dict[locale.split("-")[0]] || enUs;
    }
    _findLocalizedForumEmptySubtitle(channelName) {
        const locale = this._getClientLocale();
        const ptBr = `Sobre o que você quer postar em #${channelName}?`;
        const enUs = `What do you want to post about in #${channelName}?`;
        const dict = {
            "pt-br": ptBr,
            pt: ptBr,
            "en-us": enUs,
            en: enUs
        };
        return dict[locale] || dict[locale.split("-")[0]] || enUs;
    }
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
                    }, 24);
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
            let rows = root.querySelectorAll('[class*="row__"]');
            if (!rows.length) {
                rows = Array.from(root.querySelectorAll('[role="button"]')).filter(el => !!this._threadFromRowFiber(el));
            }
            for (const row of rows) {
                if (!row || row.nodeType !== 1) continue;
                if (row.dataset?.hiddenBlocked === "true") continue;
                let authorId = null;
                const thread = this._threadFromRowFiber(row);
                if (thread) authorId = thread.ownerId || thread.owner_id || null;
                if (!authorId) {
                    const threadId = thread?.id || row.dataset?.listItemId?.match?.(/(\d{17,20})/)?.[1];
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
                }
            }
            if (rows.length > 0) {
                const stillVisible = Array.from(rows).some(r => r.dataset?.hiddenBlocked !== "true");
                if (!stillVisible) {
                    this.hideElement(root, "active-posts-popover-all-blocked", false);
                }
            }
        } catch (_) {}
    }
    hidePrivateChannels() {
        try {
            const dmRows = document.querySelectorAll('[data-list-item-id^="private-channels___"], [class*="privateChannels"] [class*="channel"]');
            for (const row of dmRows) {
                if (row.dataset?.hiddenBlocked === "true") continue;
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
    static get TOPICS_EMPTY_TRANSLATIONS() {
        const ptBr = {
            title: "Não há tópicos.",
            subtitle: "Mantenha o foco em uma conversa com um tópico — um canal de texto temporário.",
            button: "Criar tópico"
        };
        const enUs = {
            title: "There are no threads.",
            subtitle: "Stay focused on a conversation with a thread — a temporary text channel.",
            button: "Create Thread"
        };
        return {
            "pt-br": ptBr,
            pt: ptBr,
            "en-us": enUs,
            en: enUs
        };
    }
    _findLocalizedTopicsEmptyText() {
        const locale = this._getClientLocale();
        return ByeBlocked.TOPICS_EMPTY_TRANSLATIONS[locale] || ByeBlocked.TOPICS_EMPTY_TRANSLATIONS[locale.split("-")[0]] || ByeBlocked.TOPICS_EMPTY_TRANSLATIONS.en;
    }
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
            let target = allButtons.find(btn => normalize(btn) === "create thread") || allButtons.find(btn => normalize(btn) === "create") || allButtons.find(btn => normalize(btn) === "criar") || allButtons.find(btn => normalize(btn) === "criar tópico");
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
                if (!textContent.includes("topic") && !textContent.includes("thread") && !textContent.includes("tópic")) continue;
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
        for (const delay of [ 50, 150, 400 ]) {
            setTimeout(() => {
                if (!this.isRunning) return;
                try {
                    this.hideForumPosts();
                } catch (_) {}
            }, delay);
        }
        setTimeout(() => {
            this._forumRetryScheduled = false;
        }, 400);
    }
    _fastHideFromMutations(mutations) {
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                this._fastHideNode(node);
                const descendants = node.querySelectorAll ? node.querySelectorAll('li[class*="messageListItem"], [class*="messageListItem"], ' + '[class*="repliedMessage"], [class*="replyBar"], [class*="messageReference"], ' + '[data-list-item-id^="pins__"], [class*="messageGroupWrapper"], [class*="memberRow"], ' + '[role="listitem"][data-list-item-id]') : [];
                for (let d = 0; d < descendants.length; d++) {
                    this._fastHideNode(descendants[d]);
                }
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
                if (node.matches?.('[class*="memberRow"]') || node.querySelector?.('[class*="memberRow"]')) {
                    if (this.settings.places.memberList) {
                        this.hideMemberRows();
                    }
                }
                if (this.settings.places.memberList && (node.matches?.('[data-list-id^="members-"]') || node.querySelector?.('[data-list-id^="members-"]'))) {
                    this.hideMemberRows();
                }
                if (this.settings.places.events) {
                    const eventsSidebarItem = node.matches?.('[data-list-item-id^="channels___upcoming-events-"]') ? node : node.querySelector?.('[data-list-item-id^="channels___upcoming-events-"]');
                    if (eventsSidebarItem) {
                        const li = eventsSidebarItem.closest('li');
                        if (li && !li.querySelector('[data-nmb-events-ready="true"]')) {
                            li.dataset.nmbSidebarPreHidden = "true";
                            li.style.visibility = 'hidden';
                        }
                        try {
                            this._fixEventsSidebarCounterFor(eventsSidebarItem);
                        } catch (_) {}
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
                void el.offsetHeight;
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
                    void el.offsetHeight;
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
                const shouldHideByAuthor = userId && this.shouldHide(userId);
                const shouldHideByPinner = messageId && this._shouldHidePinnedMessage(channelId, messageId, null);
                if (shouldHideByAuthor || shouldHideByPinner) {
                    this.hideElement(pinCard, shouldHideByAuthor ? "fast-pin-author" : "fast-pin-by-blocked", shouldHideByAuthor ? userId : false);
                    void pinCard.offsetHeight;
                    const wrapper = pinCard.closest('[class*="messageGroupWrapper"]');
                    if (wrapper && wrapper.dataset?.hiddenBlocked !== "true") {
                        const siblingCards = Array.from(wrapper.querySelectorAll('[data-list-item-id^="pins__"]'));
                        if (siblingCards.every(card => card.dataset?.hiddenBlocked === "true")) {
                            this.hideElement(wrapper, "pinned-panel-residue", false);
                            void wrapper.offsetHeight;
                        }
                    }
                    const pinsRoot = el.closest('[data-list-id="pins"], [data-list-id*="pins"]');
                    if (pinsRoot) {
                        try {
                            this.cleanupPinnedPanelResidue();
                        } catch (_) {}
                    }
                }
            }
        }
        const hasBlockedClass = this.settings.places.messages && (el.matches?.('[class*="messageGroupBlocked"], [class*="blockedSystemMessage"]') || el.querySelector?.('[class*="messageGroupBlocked"]') || el.querySelector?.('[class*="blockedSystemMessage"]'));
        if (hasBlockedClass) {
            const directLi = el.closest?.('li[class*="messageListItem"]') || el.closest?.('[class*="messageListItem"]');
            if (directLi) {
                if (directLi.dataset?.hiddenBlocked !== "true") {
                    this.hideElement(directLi, "blocked-group-fast");
                    void directLi.offsetHeight;
                }
            } else if (el.matches?.('[class*="messageGroupBlocked"], [class*="blockedSystemMessage"]')) {
                if (el.dataset?.hiddenBlocked !== "true") {
                    this.hideElement(el, "blocked-group-fast");
                    void el.offsetHeight;
                }
            } else {
                const inner = el.querySelectorAll?.('[class*="messageGroupBlocked"], [class*="blockedSystemMessage"]') || [];
                for (let k = 0; k < inner.length; k++) {
                    const innerEl = inner[k];
                    const innerLi = innerEl.closest?.('li[class*="messageListItem"]') || innerEl.closest?.('[class*="messageListItem"]') || innerEl;
                    if (innerLi.dataset?.hiddenBlocked !== "true") {
                        this.hideElement(innerLi, "blocked-group-fast");
                        void innerLi.offsetHeight;
                    }
                }
            }
            return;
        }
        if (this.settings.places.messages && (el.matches?.('li[class*="messageListItem"], [class*="messageListItem"]') || el.matches?.('[class*="repliedMessage"], [class*="replyBar"], [class*="messageReference"]'))) {
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
                const replyMention = replyBar.querySelector("[data-user-id]");
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
            const rawText = (messageRow.innerText || "").replace(/\s+/g, " ").trim();
            if (rawText.length > 0 && this.isBlockedMessageBannerText(rawText)) {
                this.hideElement(messageRow, "blocked-group-fast");
                void messageRow.offsetHeight;
                return;
            }
        }
        if (this.settings.places.messages && el.matches?.('[class*="mention"]')) {
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
            this._removeAllVoiceInviteSuggestions();
            if (this.settings.places.voiceChannels) this.hideVoiceUsers();
            if (this.settings.places.memberList) this.hideMemberRows();
            if (this.settings.places.messages) this.hideMessages();
            if (this.settings.places.messages) this.hideMentions();
            if (this.settings.places.messages) this.hideForumPosts();
            if (this.settings.places.messages) {
                this.hideTopicPanelItems();
                this.fixEmptyTopicPanelState();
            }
            if (this.settings.places.messages) this.hidePinnedMessages();
            if (this.settings.places.messages) this.fixPinNotificationBadge();
            if (this.settings.places.groupDms || this.settings.places.messages) this.hidePrivateChannels();
            this.enforceEmptyDmSkeleton();
            if (this.settings.places.autocomplete) this.hideAutocompleteRows();
            if (this.settings.places.reactions) this.fixReactionCounts();
            if (this.settings.places.reactions) this.hideBlockedReactors();
            if (this.settings.places.events) this.hideBlockedEvents();
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
        const lis = document.querySelectorAll('li[class*="messageListItem"], li[class*="message_"], li[class*="cozy"], li[class*="compact"]');
        for (let i = 0; i < lis.length; i++) {
            const el = lis[i];
            if (el.dataset?.hiddenBlocked === "true") continue;
            if (el.dataset?.nmbGhost === "true") continue;
            const text = (el.innerText || "").replace(/\s+/g, " ").trim();
            if (text.length > 0) continue;
            if (el.offsetHeight <= 1) continue;
            this._ghostHide(el);
        }
        const wrappers = document.querySelectorAll('[class*="groupStart"] [class*="wrapper"], [class*="groupStart"] > [class*="cozy"]');
        for (let i = 0; i < wrappers.length; i++) {
            const el = wrappers[i];
            if (el.dataset?.hiddenBlocked === "true") continue;
            if (el.dataset?.nmbGhost === "true") continue;
            const text = (el.innerText || "").replace(/\s+/g, " ").trim();
            if (text.length > 0) continue;
            if (el.offsetHeight <= 1) continue;
            this._ghostHide(el);
        }
        const groupStarts = document.querySelectorAll('[class*="groupStart"]');
        for (let i = 0; i < groupStarts.length; i++) {
            const group = groupStarts[i];
            if (group.dataset?.nmbGhost === "true") continue;
            if (group.tagName?.toLowerCase() === "li") continue;
            let hasVisible = false;
            for (const child of group.children) {
                if (child.dataset?.hiddenBlocked === "true" || child.dataset?.nmbGhost === "true") continue;
                if (child.offsetParent !== null) {
                    hasVisible = true;
                    break;
                }
                const childText = (child.innerText || "").replace(/\s+/g, " ").trim();
                if (childText.length > 0) {
                    hasVisible = true;
                    break;
                }
            }
            if (!hasVisible) {
                const groupText = (group.innerText || "").replace(/\s+/g, " ").trim();
                if (groupText.length > 0) continue;
                this._ghostHide(group);
            }
        }
    }
    _ghostHide(el) {
        el.dataset.nmbGhost = "true";
        if (!el.hasAttribute("data-nmb-prev-ghost-style")) {
            el.setAttribute("data-nmb-prev-ghost-style", el.getAttribute("style") || "");
        }
        el.style.cssText = `\n            display: none !important;\n            height: 0 !important;\n            min-height: 0 !important;\n            max-height: 0 !important;\n            padding: 0 !important;\n            margin: 0 !important;\n            overflow: hidden !important;\n            contain: size style !important;\n        `;
        this._nmbDebugLog?.("ghostHide", el, "ghost-slot", null);
    }
    hidePinnedMessages() {
        if (!this.settings.places?.messages) return;
        const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
        const pinCards = document.querySelectorAll('[data-list-item-id^="pins__"]');
        for (let i = 0; i < pinCards.length; i++) {
            const pinCard = pinCards[i];
            if (pinCard.dataset?.hiddenBlocked === "true") continue;
            const listId = pinCard.dataset?.listItemId || "";
            const pinMatch = listId.match(/^pins_+(\d{17,20})$/);
            const messageId = pinMatch ? pinMatch[1] : null;
            const userId = this.findUserId(pinCard);
            const shouldHideByAuthor = userId && this.shouldHide(userId);
            const shouldHideByPinner = messageId && this._shouldHidePinnedMessage(channelId, messageId, null);
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
        const els = document.querySelectorAll('li[class*="messageListItem"], [class*="messageListItem"], [class*="blocked"], [class*="message-"], [class*="cozy-"], [class*="compact-"]');
        const parentSet = new Set;
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
            if (false && this.settings.places.messages && info.messageId && this._blockedPinnedMessageIds.has(info.messageId)) {
                this.hideElement(messageRow, "pinned-by-blocked", false);
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
            const visibleChildren = Array.from(parent.children).filter(child => !child.dataset?.hiddenBlocked && child.offsetParent !== null);
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
        this._nmbDebugLog?.("hideParent", el, reason, null);
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
        const els = document.querySelectorAll('[class*="voiceUser"], [class*="voiceUsers"] [data-list-item-id], [class*="listItem"][data-list-item-id]');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const userId = this.findUserId(el);
            if (!this.shouldHide(userId)) continue;
            const row = el.closest("li") || el;
            if (!this.isVoiceChannelShell(row)) this.hideElement(row, "voice-user", userId); else this.hideElement(el, "voice-user", userId);
        }
        this.fixVoiceCounters();
    }
    hideMemberRows() {
        const els = document.querySelectorAll('[data-list-item-id], [class*="member-"], [class*="member_"], [class*="memberRow"]');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const userId = this.findUserId(el);
            if (!this.shouldHide(userId)) continue;
            const row = el.closest("[data-list-item-id]") || el.closest('[class*="memberRow"]') || el;
            this.hideElement(row, row.matches?.('[class*="memberRow"]') ? "guild-members-page" : "member", userId);
        }
        this.fixGuildMembersPageCount();
    }
    static get EVENTS_EMPTY_TRANSLATIONS() {
        const ptBr = {
            title: "Não há eventos futuros.",
            subtitle: "Agende um evento para qualquer atividade planejada no seu servidor.",
            tip_prefix: "Você pode dar permissão para outras pessoas criarem eventos em ",
            tip_link: "configurações do servidor > cargos"
        };
        const enUs = {
            title: "No upcoming events.",
            subtitle: "Schedule an event for any planned activity in your server.",
            tip_prefix: "You can give other people permission to create events in ",
            tip_link: "server settings > roles"
        };
        return {
            "pt-br": ptBr,
            pt: ptBr,
            "en-us": enUs,
            en: enUs
        };
    }
    _findLocalizedEventsEmptyText() {
        const locale = this._getClientLocale();
        return ByeBlocked.EVENTS_EMPTY_TRANSLATIONS[locale] || ByeBlocked.EVENTS_EMPTY_TRANSLATIONS[locale.split("-")[0]] || ByeBlocked.EVENTS_EMPTY_TRANSLATIONS.en;
    }
    _buildEventsEmptySkeletonHtml() {
        const t = this._findLocalizedEventsEmptyText();
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
        const eventRegex = /\d+.*(?:event|evento|événement)|(?:event|evento|événement).*\d+/i;
        const seenNameEls = new Set;
        for (let i = 0; i < items.length; i++) {
            this._processEventsSidebarItem(items[i], eventRegex, seenNameEls);
        }
    }
    _fixEventsSidebarCounterFor(focusItem) {
        if (!focusItem) return;
        const eventRegex = /\d+.*(?:event|evento|événement)|(?:event|evento|événement).*\d+/i;
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
        if (hiddenEvents === 0) {
            if (nameEl.querySelector(':scope > [data-nmb-sidebar-overlay="true"]')) this._clearEventsSidebarOverlay(nameEl);
            if (badgeEl && badgeEl.dataset?.hiddenBlocked === "true") this.restoreElement(badgeEl);
            if (unreadEl && unreadEl.dataset?.hiddenBlocked === "true") this.restoreElement(unreadEl);
            this._setEventsReadyAndUnhide(nameEl, _processEventsLi);
            return;
        }
        if (totalEvents > 0 && totalEvents === hiddenEvents) {
            this._applyEventsSidebarOverlay(nameEl, genericLabel);
            if (badgeEl) this.hideElement(badgeEl, "events-sidebar-badge");
            if (unreadEl) this.hideElement(unreadEl, "events-sidebar-unread");
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
            if (direct) {
                found = direct;
                return;
            }
            const event = props?.guildScheduledEvent || props?.event || props?.scheduledEvent;
            if (event) {
                const nested = event.creatorId || event.creator_id || event.creator?.id;
                if (nested && /^\d{17,20}$/.test(String(nested))) found = String(nested);
            }
        }, 24);
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
                    this.toast("🚫 Este evento foi criado por um usuário bloqueado.", "info");
                }
            }
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
            this.toast("⚠️ Não foi possível identificar o servidor atual.", "warn");
            return;
        }
        const isSettingsGearIcon = el => {
            const path = el?.querySelector?.('svg path[fill-rule="evenodd"]');
            const d = path?.getAttribute("d") || "";
            return d.includes("M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0");
        };
        const ROLES_TAB_RE = /cargos|roles|rôles/i;
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
        this.toast("⚠️ Não foi possível abrir automaticamente. Abra manualmente em Configurações do servidor > Cargos.", "warn");
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
    hideEmptyMemberHeaders() {
        document.querySelectorAll("[data-list-item-id]").forEach(header => {
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
        const spans = Array.from(headerDiv.querySelectorAll("span"));
        const countSpan = spans.find(span => {
            if (span.className && span.className.includes("membersGroupName")) return false;
            return /[-–—]\s*\d+/.test(span.textContent || "");
        });
        if (countSpan) {
            if (!countSpan.hasAttribute("data-nmb-prev-text")) {
                countSpan.setAttribute("data-nmb-prev-text", countSpan.textContent);
            }
            countSpan.textContent = ` — ${count}`;
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
        this.cleanupPinnedPanelResidue();
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
    _getClientLocale() {
        try {
            const lang = document.documentElement?.lang || navigator.language || "en";
            return lang.toLowerCase();
        } catch (_) {
            return "en";
        }
    }
    static get PINS_EMPTY_TRANSLATIONS() {
        const ptBr = {
            body: "Este canal não tem<br>mensagens fixadas... por enquanto.",
            tip_label: "Fica a dica:",
            tip_text: "Usuários com a permissão “Gerenciar Mensagens” podem fixar uma mensagem no menu de contexto."
        };
        const enUs = {
            body: "This channel doesn't have<br>any pinned messages... yet.",
            tip_label: "Pro tip:",
            tip_text: 'Users with the "Manage Messages" permission can pin a message from the context menu.'
        };
        return {
            "pt-br": ptBr,
            pt: ptBr,
            "en-us": enUs,
            en: enUs
        };
    }
    _findLocalizedPinsEmptyText() {
        const locale = this._getClientLocale();
        const dict = ByeBlocked.PINS_EMPTY_TRANSLATIONS[locale] || ByeBlocked.PINS_EMPTY_TRANSLATIONS[locale.split("-")[0]];
        return dict?.body || null;
    }
    _findLocalizedPinsTipText() {
        const locale = this._getClientLocale();
        const dict = ByeBlocked.PINS_EMPTY_TRANSLATIONS[locale] || ByeBlocked.PINS_EMPTY_TRANSLATIONS[locale.split("-")[0]];
        return dict ? {
            label: dict.tip_label,
            text: dict.tip_text
        } : null;
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
            const channelRow = row.closest?.('[data-list-item-id*="channels"]') || row.closest?.("li") || row;
            const channelId = this.findChannelId(channelRow) || this.findChannelId(row);
            if (!channelId) return;
            const states = this.getRawVoiceStatesForChannel(channelId);
            const allHidden = states.length > 0 && states.every(state => this.shouldHide(this.extractUserId(state)));
            const anyBlocked = states.length > 0 && states.some(state => this.shouldHide(this.extractUserId(state)));
            const activeOnlyByDom = !states.length && this.looksLikeHiddenOnlyVoiceChannel(channelRow);
            const isHiddenOnly = allHidden || activeOnlyByDom;
            const hasBlockedUsers = anyBlocked || activeOnlyByDom;
            if (!isHiddenOnly && !hasBlockedUsers) {
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
        try {
            const raw = this.originalVoiceMethods.getVoiceStatesForChannel ? this.originalVoiceMethods.getVoiceStatesForChannel(channelId) : this.modules.SortedVoiceStateStore?.getVoiceStatesForChannel?.(channelId);
            const states = Array.isArray(raw) ? raw : Object.values(raw || {});
            if (states.length) return states;
            const guildId = this.modules.SelectedGuildStore?.getGuildId?.();
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
        const visit = props => {
            if (!props || typeof props !== "object") return;
            const message = props.message || props.baseMessage || props.referencedMessage?.message;
            if (message?.id && !info.messageId) info.messageId = message.id;
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
    findUserId(el) {
        if (!el) return null;
        try {
            if (el.dataset?.userId) return el.dataset.userId;
            if (el.dataset?.nmbUserId) return el.dataset.nmbUserId;
            const userIdEl = el.querySelector?.("[data-user-id]");
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
            const avatarMatch = avatar?.src?.match(/\/avatars\/(\d{17,20})/);
            if (avatarMatch) return avatarMatch[1];
        } catch (_) {}
        return null;
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
        const resolvedUserId = userId === false ? null : userId || this.findUserId(el);
        if (resolvedUserId) el.dataset.nmbUserId = resolvedUserId;
        el.dataset.hiddenBlocked = "true";
        el.dataset.nmbReason = reason;
        el.style.cssText = this.hideStyles;
        this.hiddenElements.add(el);
        this._nmbDebugLog?.("hideElement", el, reason, resolvedUserId);
    }
    restoreElement(el) {
        if (!el) return;
        const previous = el.getAttribute("data-nmb-prev-style");
        if (previous) el.setAttribute("style", previous); else el.removeAttribute("style");
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
    patchSound() {
        if (!this.settings.behavior.muteVoiceJoinLeaveSound) return;
        const SoundUtils = this.modules.SoundUtils;
        if (!SoundUtils) return;
        const playSoundKey = this._soundPlayKey || "playSound";
        if (typeof SoundUtils[playSoundKey] !== "function") return;
        const RTCUtils = this.modules.RTCConnectionUtils;
        const self = this;
        this.patches.push(BdApi.Patcher.instead(this.pluginName, SoundUtils, playSoundKey, function(context, args, originalMethod) {
            const soundType = args[0];
            const isVoiceEvent = [ "disconnect", "user_join", "user_leave", "user_moved", "stream_started", "stream_ended", "activity_launch" ].includes(soundType);
            if (!isVoiceEvent || !self.settings.behavior.muteVoiceJoinLeaveSound) {
                return originalMethod.apply(context, args);
            }
            if (soundType === "stream_started" || soundType === "stream_ended") {
                const streamerId = self._lastStreamerId;
                if (!streamerId) return originalMethod.apply(context, args);
                if (self.shouldHide(streamerId)) return;
                return originalMethod.apply(context, args);
            }
            if (soundType === "activity_launch") {
                const participantIds = self._lastActivityParticipantIds;
                if (!participantIds || !participantIds.size) return originalMethod.apply(context, args);
                const allBlocked = [ ...participantIds ].every(id => self.shouldHide(id));
                if (allBlocked) return;
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
            let voiceStatesById = {};
            try {
                voiceStatesById = self.modules.VoiceStateStore?.getVoiceStatesForChannel?.(channelId) || {};
            } catch (_) {}
            const currentIds = new Set(Object.keys(voiceStatesById).filter(Boolean));
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
        }));
    }
    patchSoundboardEffects() {
        if (this._soundboardPatched) return;
        const Dispatcher = this.modules.Dispatcher;
        if (!Dispatcher || typeof Dispatcher.dispatch !== "function") return;
        this._soundboardPatched = true;
        const self = this;
        this.patches.push(BdApi.Patcher.before(this.pluginName, Dispatcher, "dispatch", function(context, args) {
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
                if (!self.settings.behavior.muteVoiceJoinLeaveSound) return;
                const senderId = action.userId;
                if (senderId && self.shouldHide(senderId)) {
                    action.type = "_BYEBLOCKED_SUPPRESSED_VOICE_CHANNEL_EFFECT_SEND";
                }
                return;
            }
        }));
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
            if (!this._pendingPinsByChannel) this._pendingPinsByChannel = new Map;
            if (channelId) {
                if (!this._pendingPinsByChannel.has(channelId)) this._pendingPinsByChannel.set(channelId, new Set);
                this._pendingPinsByChannel.get(channelId).add(messageId);
            }
            const self = this;
            setTimeout(() => {
                self._resolvePendingPinFromStore(channelId, messageId);
            }, 1500);
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
            } else {
                this._handleUnresolvedPin(channelId, messageId);
                const queue = pending.get(channelId);
                if (queue) {
                    queue.delete(messageId);
                    if (!queue.size) pending.delete(channelId);
                }
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
        this.patches.push(BdApi.Patcher.after(this.pluginName, mod, key, function(context, args, result) {
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
        }));
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
        const hideBlockedBanner = this.settings.places.messages ? `\n            [class*="messageGroupBlocked"],\n            [class*="blockedSystemMessage"],\n            [class*="messageGroupStart"]:has([class*="blocked"]),\n            li[class*="messageListItem"]:has([class*="messageGroupBlocked"]),\n            li[class*="messageListItem"]:has([class*="blockedSystemMessage"]),\n            li[class*="messageListItem"]:has([class*="blocked"][class*="message"]),\n            [class*="messageListItem"]:has([class*="messageGroupBlocked"]) {\n                display: none !important;\n                height: 0 !important;\n                min-height: 0 !important;\n                max-height: 0 !important;\n                padding: 0 !important;\n                margin: 0 !important;\n                overflow: hidden !important;\n                contain: size style !important;\n            }\n        ` : "";
        const eventsSidebarNameRule = this.settings.places.events ? `\n            li:has([data-list-item-id^="channels___upcoming-events-"]) {\n                visibility: hidden !important;\n            }\n            li:has([data-list-item-id^="channels___upcoming-events-"]):has([data-nmb-events-ready="true"]) {\n                visibility: visible !important;\n            }\n        ` : "";
        const noticeButtonStyles = `\n            .bd-notice button,\n            .bd-notice .bd-button,\n            .bd-notice [class*="button"],\n            .bd-notice [role="button"] {\n                background: transparent !important;\n                border: 1px solid var(--text-muted) !important;\n                color: var(--text-normal) !important;\n                transition: background 0.15s, border-color 0.15s !important;\n            }\n            .bd-notice button:hover,\n            .bd-notice .bd-button:hover,\n            .bd-notice [class*="button"]:hover,\n            .bd-notice [role="button"]:hover {\n                background: rgba(255, 255, 255, 0.08) !important;\n                border-color: var(--brand-experiment) !important;\n                color: var(--text-normal) !important;\n            }\n        `;
        BdApi.DOM.addStyle(this.pluginName, `\n            [data-hidden-blocked="true"],\n            [data-hidden-blocked="true"] * { ${this.hideStyles} }\n            h1[data-nmb-header-hidden="true"] {\n                font-size: 0 !important;\n                line-height: 0 !important;\n            }\n            h1[data-nmb-header-hidden="true"] [data-nmb-header-overlay="true"] {\n                font-size: var(--nmb-header-restore-size, 20px) !important;\n                line-height: var(--nmb-header-restore-line-height, normal) !important;\n            }\n            [data-nmb-zero-reaction="true"] { display: none !important; pointer-events: none !important; }\n            [data-nmb-hide-view-reactions="true"] { display: none !important; pointer-events: none !important; }\n            [class*="reactorClickable_"][data-nmb-reactor-hidden="true"],\n            [data-nmb-reactor-hidden="true"]:not([class*="reactorsContainer_"]):not([class*="reactors_"]) {\n                display: none !important;\n                pointer-events: none !important;\n                height: 0 !important;\n                min-height: 0 !important;\n                max-height: 0 !important;\n                margin: 0 !important;\n                padding: 0 !important;\n                overflow: hidden !important;\n            }\n            [data-nmb-reactor-remove-hidden="true"] {\n                display: none !important;\n                pointer-events: none !important;\n            }\n            [data-nmb-pin-badge-hidden="true"] {\n                display: none !important;\n                pointer-events: none !important;\n            }\n            [data-nmb-loading-hidden="true"] { display: none !important; pointer-events: none !important; }\n            [data-nmb-tab-hidden="true"] { display: none !important; pointer-events: none !important; }\n            [data-nmb-count-fixed="true"] {\n                font-size: 0 !important;\n                position: relative !important;\n            }\n            [data-nmb-count-fixed="true"]::after {\n                content: attr(data-nmb-real-count);\n                font-size: 14px;\n            }\n            [class*="messageGroupStart"]:empty,\n            [class*="messageGroupBlocked"]:empty { display: none !important; }\n            [data-nmb-ghost="true"] {\n                display: none !important;\n                height: 0 !important;\n                min-height: 0 !important;\n                max-height: 0 !important;\n                padding: 0 !important;\n                margin: 0 !important;\n                overflow: hidden !important;\n                contain: size style !important;\n            }\n            ${eventsSidebarNameRule}\n            ${hideBlockedBanner}\n            [data-nmb-promoted="true"] [class*="compact"],\n            [data-nmb-promoted="true"] [class*="cozy"] { margin-top: 17px !important; }\n            [data-nmb-promoted="true"] [class*="avatar"],\n            [data-nmb-promoted="true"] img[class*="avatar"] { display: block !important; }\n            [data-nmb-promoted="true"] [class*="username"],\n            [data-nmb-promoted="true"] [class*="header_"],\n            [data-nmb-promoted="true"] [class*="cozyHeader"] { display: flex !important; }\n            [class*="channelInfo"] { display: flex !important; align-items: center !important; gap: 4px !important; }\n            [data-nmb-muted-voice="true"] svg,\n            [data-nmb-muted-voice="true"] [class*="icon"],\n            [data-nmb-muted-voice="true"] [class*="iconLive"] {\n                color: var(--channels-default) !important;\n                fill: currentColor !important;\n            }\n            [class*="bd-modal-large"],\n            [class*="bd-modal"][class*="large"] { width: 90vw !important; max-width: 860px !important; }\n            [class*="bd-modal-body"] { max-height: 82vh !important; }\n            .nmb-panel {\n                padding: 16px 20px;\n                color: var(--text-normal);\n                font-family: var(--font-primary);\n                max-width: 720px;\n                -webkit-font-smoothing: antialiased;\n                -moz-osx-font-smoothing: grayscale;\n                text-rendering: optimizeLegibility;\n                transform: translateZ(0);\n                backface-visibility: hidden;\n            }\n            .nmb-header-minimal {\n                display: flex;\n                align-items: baseline;\n                gap: 10px;\n                margin-bottom: 12px;\n                padding-bottom: 10px;\n                border-bottom: 1px solid var(--background-modifier-accent);\n            }\n            .nmb-plugin-name { font-size: 22px; font-weight: 700; color: var(--header-primary); }\n            .nmb-version { font-size: 15px; color: var(--text-muted); font-weight: 500; }\n            .nmb-section {\n                background: var(--background-secondary);\n                border-radius: 8px;\n                margin-bottom: 8px;\n                overflow: hidden;\n                border: 1px solid var(--background-modifier-accent);\n            }\n            .nmb-section-header {\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                padding: 10px 16px;\n                cursor: pointer;\n                user-select: none;\n                transition: background 160ms ease !important;\n                background: transparent;\n            }\n            .nmb-panel .nmb-section-header:hover { background: var(--background-modifier-hover) !important; }\n            .nmb-section-title {\n                font-size: 12px;\n                font-weight: 600;\n                text-transform: uppercase;\n                letter-spacing: 0.5px;\n                color: var(--header-secondary);\n                margin: 0;\n            }\n            .nmb-chevron {\n                width: 16px;\n                height: 16px;\n                color: var(--text-muted);\n                transition: transform 220ms ease;\n                flex-shrink: 0;\n            }\n            .nmb-section.is-open .nmb-chevron { transform: rotate(180deg); }\n            .nmb-section-body {\n                display: grid;\n                grid-template-rows: 0fr;\n                transition: grid-template-rows 200ms ease;\n            }\n            .nmb-section.is-open .nmb-section-body { grid-template-rows: 1fr; }\n            .nmb-section-body-inner { overflow: hidden; padding: 0 16px; }\n            .nmb-section.is-open .nmb-section-body-inner { padding: 4px 16px 10px; }\n            .nmb-row {\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                gap: 12px;\n                padding: 6px 6px;\n                border-radius: 4px;\n                transition: background 150ms ease !important;\n                background: transparent;\n            }\n            .nmb-panel .nmb-row:hover { background: var(--background-modifier-hover) !important; }\n            .nmb-row-label { font-size: 14px; color: var(--text-normal); }\n            .nmb-switch {\n                position: relative;\n                width: 34px;\n                height: 18px;\n                flex-shrink: 0;\n                border-radius: 9px;\n                background: var(--background-tertiary);\n                cursor: pointer;\n                transition: background 160ms ease, box-shadow 160ms ease;\n            }\n            .nmb-switch:hover { box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.25); }\n            .nmb-switch.is-on { background: var(--brand-experiment, #5865f2); }\n            .nmb-switch-knob {\n                position: absolute;\n                top: 2px;\n                left: 2px;\n                width: 14px;\n                height: 14px;\n                border-radius: 50%;\n                background: #fff;\n                box-shadow: 0 1px 2px rgba(0,0,0,0.3);\n                transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);\n            }\n            .nmb-switch.is-on .nmb-switch-knob { transform: translateX(16px); }\n            .nmb-actions {\n                display: flex;\n                align-items: center;\n                flex-wrap: wrap;\n                gap: 8px;\n                margin-top: 28px;\n                padding: 12px 0;\n                border-top: 1px solid var(--background-modifier-accent);\n            }\n            .nmb-update-btn {\n                display: inline-flex;\n                align-items: center;\n                gap: 6px;\n                border-radius: 6px;\n                font-weight: 600;\n                cursor: pointer;\n                transition: background 160ms ease, color 160ms ease, border-color 160ms ease, transform 120ms ease, box-shadow 160ms ease;\n                white-space: nowrap;\n                padding: 8px 14px;\n                font-size: 13px;\n                background: var(--brand-experiment, #5865f2);\n                color: #fff;\n                border: none;\n            }\n            .nmb-btn-icon { width: 14px; height: 14px; flex-shrink: 0; }\n            .nmb-update-btn:hover:not(:disabled) {\n                background: var(--brand-experiment-hover, #4752c4);\n                transform: translateY(-1px);\n                box-shadow: 0 2px 8px rgba(0,0,0,0.25);\n            }\n            .nmb-update-btn:disabled { opacity: 0.55; cursor: default; }\n            .nmb-update-btn.is-checking .nmb-btn-icon { animation: nmb-spin 0.8s linear infinite; }\n            @keyframes nmb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }\n            .nmb-update-btn.is-up-to-date {\n                background: var(--text-positive, #23a559);\n                color: #fff;\n                border: none;\n            }\n            .nmb-update-btn.is-up-to-date:hover:not(:disabled) {\n                background: #1e8f4e;\n                box-shadow: 0 2px 8px rgba(0,0,0,0.25);\n            }\n            .nmb-update-btn.is-update-available {\n                background: var(--brand-experiment, #5865f2);\n                color: #fff;\n                border: none;\n                animation: nmb-pulse-update 2s ease-in-out infinite;\n            }\n            .nmb-update-btn.is-update-available:hover { filter: brightness(1.1); }\n            .nmb-update-btn.is-error {\n                background: var(--text-danger, #f23f43);\n                color: #fff;\n                border: none;\n            }\n            .nmb-update-btn.is-error:hover:not(:disabled) {\n                background: #d73338;\n                box-shadow: 0 2px 8px rgba(0,0,0,0.25);\n            }\n            @keyframes nmb-pulse-update {\n                0%, 100% { box-shadow: 0 0 0 0 rgba(88,101,242,0.4); }\n                50% { box-shadow: 0 0 0 6px rgba(88,101,242,0); }\n            }\n            .nmb-last-check { font-size: 12px; color: var(--text-muted); }\n            .nmb-pins-empty-placeholder {\n                display: flex;\n                flex-direction: column;\n                align-items: center;\n                justify-content: center;\n                text-align: center;\n            }\n            .nmb-pins-empty-placeholder .image_e8b59c {\n                width: 120px;\n                height: 120px;\n                background-size: contain;\n                background-repeat: no-repeat;\n                background-position: center;\n            }\n            .nmb-pins-empty-placeholder .body_e8b59c {\n                display: block;\n                height: auto;\n                white-space: normal;\n            }\n            .nmb-pins-empty-footer {\n                flex-shrink: 0;\n            }\n            .nmb-injected-forum-empty {\n                display: flex;\n                flex-direction: column;\n                align-items: center;\n                justify-content: center;\n                text-align: center;\n                width: 100%;\n                padding: 60px 16px;\n                gap: 8px;\n            }\n\n            ${noticeButtonStyles}\n        `);
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
        panel.innerHTML = `\n            <div class="nmb-header-minimal">\n                <span class="nmb-plugin-name">\n                    <span class="nmb-version"> v${ByeBlocked.VERSION}</span>\n                </span>\n            </div>\n            ${this.renderSettingsGroup("types", "Hide users by type", true)}\n            ${this.renderSettingsGroup("places", "Where to hide", true)}\n            ${this.renderSettingsGroup("behavior", "Behavior", true)}\n            <div class="nmb-actions">\n                <button class="nmb-update-btn" data-nmb-update-btn>\n                    <svg class="nmb-btn-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">\n                        <path d="M14 2v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>\n                        <path d="M13.5 7A5.5 5.5 0 1 1 10.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>\n                    </svg>\n                    <span class="nmb-btn-label">Check for updates</span>\n                </button>\n                <span class="nmb-last-check" data-nmb-last-check>Last check: ${this._formatDate(this._lastCheckTimestamp)}</span>\n            </div>\n        `;
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
                const {section: section, key: key} = switchEl.dataset;
                const next = !this.settings[section][key];
                this.settings[section][key] = next;
                switchEl.classList.toggle("is-on", next);
                this.saveSettings();
                if (section === "behavior" && key === "muteVoiceJoinLeaveSound") {
                    if (next) {
                        setTimeout(() => {
                            this.patchSound();
                            this.patchSoundboardEffects();
                            this.toast("🔊 Voice sound suppression activated.", "info");
                        }, 1e3);
                    } else {
                        this.toast("🔄 Please reload the plugin for changes to take effect.", "warn");
                    }
                }
                if (section === "behavior" && key === "suppressTaskbarBadge") {
                    this._refreshTaskbarBadge();
                }
                this.queueRefresh();
                return;
            }
        });
        setTimeout(() => {
            panel.scrollIntoView({
                block: "start",
                behavior: "smooth"
            });
        }, 50);
        return panel;
    }
    renderSettingsGroup(section, title, openByDefault = false) {
        const labels = {
            blocked: "Blocked users",
            ignored: "Muted/ignored users",
            messages: "Messages & chat",
            memberList: "Member list & members page",
            voiceChannels: "Voice channels",
            groupDms: "Group DMs",
            autocomplete: "Autocomplete & suggestions (mentions, invite picker)",
            reactions: "Message reactions",
            events: "Scheduled events (hide events created by blocked users)",
            autoCheckUpdates: "Auto-check updates on startup",
            muteVoiceJoinLeaveSound: "Silence join/leave sounds for blocked users",
            suppressTaskbarBadge: "Hide taskbar & tray badge for blocked-only activity"
        };
        const rows = Object.keys(this.settings[section]).map(key => {
            const isOn = this.settings[section][key];
            return `\n                <div class="nmb-row">\n                    <div class="nmb-row-label-wrap">\n                        <span class="nmb-row-label">${labels[key] || key}</span>\n                    </div>\n                    <div class="nmb-switch ${isOn ? "is-on" : ""}" data-section="${section}" data-key="${key}">\n                        <div class="nmb-switch-knob"></div>\n                    </div>\n                </div>\n            `;
        }).join("");
        return `\n            <section class="nmb-section ${openByDefault ? "is-open" : ""}">\n                <div class="nmb-section-header">\n                    <p class="nmb-section-title">${title}</p>\n                    <svg class="nmb-chevron" viewBox="0 0 24 24" fill="none">\n                        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>\n                    </svg>\n                </div>\n                <div class="nmb-section-body">\n                    <div class="nmb-section-body-inner">${rows}</div>\n                </div>\n            </section>\n        `;
    }
};
