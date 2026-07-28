/**
 * @name Probe
 * @author 8ug8ird
 * @authorId 698947564459917343
 * @version 0.3.2
 * @description Compatibility watchdog for ByeBlocked
 * @source https://github.com/8ug8ird/ByeBlocked
 */

function makeEntity(fields) {

    return {
        id: fields.id,
        type: fields.type,
        name: fields.name,
        aliases: fields.aliases || [],
        discoveredVia: fields.discoveredVia,
        confidence: fields.confidence,
        confidenceReason: fields.confidenceReason,
        data: fields.data || {},
        timestamp: Date.now()
    };
}

async function yieldToUI(iteration, interval) {
    if (iteration > 0 && iteration % interval === 0) {
        await new Promise(r => setTimeout(r, 0));
    }
}

class ScannerLogger {
    constructor(prefix) {
        this.prefix = prefix;
        this.entries = [];
    }
    log(moduleName, message, level = "info") {
        const entry = { moduleName, message, level, timestamp: Date.now() };
        this.entries.push(entry);
        const tag = `[${this.prefix}:${moduleName}]`;
        try {
            if (level === "error") console.error(tag, message);
            else if (level === "warn") console.warn(tag, message);
            else console.log(tag, message);
        } catch (_) {}
    }
    dump() {
        return this.entries.slice();
    }
}

class ModuleRunner {
    constructor(logger) {
        this.logger = logger;
    }
    async run(moduleInstance) {
        const name = moduleInstance.moduleName;
        const startedAt = Date.now();
        const stats = {
            moduleName: name,
            status: "ok",
            entitiesFound: 0,
            errors: [],
            startedAt,
            finishedAt: null,
            durationMs: null
        };
        try {
            if (typeof moduleInstance.isImplemented === "function" && !moduleInstance.isImplemented()) {
                stats.status = "not_implemented";
                this.logger.log(name, "reserved module, not implemented yet — skipped.", "info");
                stats.finishedAt = Date.now();
                stats.durationMs = stats.finishedAt - startedAt;
                return { entities: [], stats };
            }
            const entities = await moduleInstance.scan();
            stats.entitiesFound = Array.isArray(entities) ? entities.length : 0;
            stats.finishedAt = Date.now();
            stats.durationMs = stats.finishedAt - startedAt;
            this.logger.log(name, `done: ${stats.entitiesFound} entity(ies) in ${stats.durationMs}ms`, "info");
            return { entities: Array.isArray(entities) ? entities : [], stats };
        } catch (err) {
            stats.status = "error";
            stats.errors.push(String(err && err.message || err));
            stats.finishedAt = Date.now();
            stats.durationMs = stats.finishedAt - startedAt;
            this.logger.log(name, `failed: ${err && err.message || err}`, "error");
            return { entities: [], stats };
        }
    }
}
class WebpackBootstrap {
    constructor(logger) {
        this.logger = logger;
        this._wpRequire = null;
    }

    static get MIN_HEALTHY_CACHE_SIZE() { return 50; }

    getRequire(forceRecapture = false) {
        if (this._wpRequire && !forceRecapture) return this._wpRequire;

        const chunkName = "webpackChunkdiscord_app";
        if (!Array.isArray(window[chunkName])) {
            this.logger.log("WebpackBootstrap", `${chunkName} not found on window — Discord may not have loaded yet, or the chunk name changed in this build.`, "warn");
            return this._wpRequire;
        }

        let captured = null;
        try {
            window[chunkName].push([
                [Symbol("deep-scanner-probe")],
                {},
                (wpRequireCandidate) => { captured = wpRequireCandidate; }
            ]);
        } catch (err) {
            this.logger.log("WebpackBootstrap", `failed to push probe chunk: ${err && err.message || err}`, "error");
            return this._wpRequire;
        }

        if (!captured || typeof captured.c !== "object") {
            this.logger.log("WebpackBootstrap", "probe chunk did not return a usable wpRequire with a cache (.c) — webpack layout may have changed in this build.", "warn");
            return this._wpRequire;
        }

        const cacheSize = Object.keys(captured.c).length;
        const factorySize = captured.m && typeof captured.m === "object" ? Object.keys(captured.m).length : 0;

        if (cacheSize < WebpackBootstrap.MIN_HEALTHY_CACHE_SIZE) {
            this.logger.log(
                "WebpackBootstrap",
                `capture looks premature (only ${cacheSize} resolved modules, ${factorySize} factories) — Discord probably hasn't finished loading chunks yet. ${this._wpRequire ? "Keeping previous capture." : "No previous capture to fall back on; returning this anyway."}`,
                "warn"
            );
            if (this._wpRequire) {
                const prevSize = Object.keys(this._wpRequire.c || {}).length;
                if (prevSize >= cacheSize) return this._wpRequire;
            }
        }

        this._wpRequire = captured;
        this.logger.log("WebpackBootstrap", `wpRequire captured: ${cacheSize} resolved modules, ${factorySize} factories.`, "info");
        return this._wpRequire;
    }

    getModuleFactories() {
        const wpRequire = this._wpRequire;
        if (!wpRequire) return null;
        const cache = wpRequire.c || {};

        this._cacheDeps = null;

        try {
            for (const key of Reflect.ownKeys(wpRequire)) {
                if (typeof key !== "string" || key === "c" || key === "caller" || key === "arguments") continue;
                try {
                    const val = wpRequire[key];
                    if (typeof val === "object" && val !== null) {
                        let found = false;
                        for (const ck of Object.keys(cache).slice(0, 20)) {
                            try { if (typeof val[ck] === "function") { found = true; break; } } catch (_) {}
                        }
                        if (found) {
                            if (key !== "m") this.logger.log("WebpackBootstrap", `found factories via "${String(key)}".`, "info");
                            return val;
                        }
                    }
                } catch (_) {}
            }
        } catch (_) {}

        try {
            const chunkArray = window.webpackChunkdiscord_app;
            if (Array.isArray(chunkArray)) {
                const merged = {};
                for (const entry of chunkArray) {
                    if (Array.isArray(entry) && entry.length >= 2) {
                        const mods = entry[1];
                        if (typeof mods === "object" && mods !== null) {
                            Object.assign(merged, mods);
                        }
                    }
                }
                let anyMatch = false;
                for (const ck of Object.keys(cache).slice(0, 20)) {
                    try { if (typeof merged[ck] === "function") { anyMatch = true; break; } } catch (_) {}
                }
                if (anyMatch) {
                    this.logger.log("WebpackBootstrap", `found ${Object.keys(merged).length} factories via webpackChunkdiscord_app.`, "info");
                    return merged;
                }
                if (Object.keys(merged).length > 0) {
                    this.logger.log("WebpackBootstrap", `found ${Object.keys(merged).length} factories via webpackChunkdiscord_app (no cache overlap, returning anyway).`, "info");
                    return merged;
                }
            }
        } catch (_) {}

        try {
            const sample = cache[Object.keys(cache)[0]];
            if (sample && Array.isArray(sample.children)) {
                this._cacheDeps = true;
            }
        } catch (_) {}

        return null;
    }
}

class WebpackScanner {
    constructor(options = {}) {
        this.moduleName = "WebpackScanner";
        this.bootstrap = options.bootstrap;
        this.logger = options.logger;
        this.scanDepth = options.scanDepth || "light";
        this.deepScanModuleIds = options.deepScanModuleIds instanceof Set
            ? options.deepScanModuleIds
            : new Set(options.deepScanModuleIds || []);
        this._liveValueCallback = options.liveValueCallback || null;
        this._minifiedNamePattern = /^[A-Za-z_$]{1,3}\d*$/;
        this._moduleFactories = null;
    }

    isImplemented() { return true; }

    _shouldDeepScan(moduleId) {
        return this.scanDepth === "deep" || this.deepScanModuleIds.has(moduleId);
    }

    _looksMinified(name) {
        return !name || this._minifiedNamePattern.test(name);
    }

    _identifyExport(exportValue, exportKey) {
        const genericTypeNames = new Set([
            "Object", "Function", "AsyncFunction", "GeneratorFunction",
            "Array", "Promise", "Map", "Set", "WeakMap", "WeakSet",
            "String", "Boolean", "Number", "Symbol",
            "Error", "TypeError", "RangeError", "Proxy", "Reflect", "Date", "RegExp"
        ]);

        const boundNamePattern = /^bound\s/;

        const isGenericFunctionName = (name) =>
            genericTypeNames.has(name) || boundNamePattern.test(name);

        if (exportValue && typeof exportValue.displayName === "string" && !this._looksMinified(exportValue.displayName)) {
            return { name: exportValue.displayName, discoveredVia: "displayName-field", confidence: "high" };
        }
        if (typeof exportValue === "function" && typeof exportValue.name === "string"
            && !this._looksMinified(exportValue.name) && !isGenericFunctionName(exportValue.name)) {
            return { name: exportValue.name, discoveredVia: "function-name", confidence: "high" };
        }
        if (exportValue && exportValue.constructor && typeof exportValue.constructor.name === "string"
            && !this._looksMinified(exportValue.constructor.name)
            && !genericTypeNames.has(exportValue.constructor.name)) {
            return { name: exportValue.constructor.name, discoveredVia: "constructor-name", confidence: "high" };
        }
        if (exportKey && exportKey !== "default" && !this._looksMinified(exportKey)) {
            return { name: exportKey, discoveredVia: "export-key", confidence: "medium" };
        }
        if (typeof exportValue === "function" && typeof exportValue.name === "string" && exportValue.name.length > 0) {
            return { name: exportValue.name, discoveredVia: "function-name-minified", confidence: "low" };
        }
        return null;
    }

    _classifyExportType(value) {
        if (value === null || value === undefined) return "nullish";
        if (typeof value === "function") {
            try {
                return value.toString().startsWith("class ") ? "class" : "function";
            } catch (_) {
                return "function";
            }
        }
        if (Array.isArray(value)) return "array";
        return typeof value;
    }

    _buildFunctionSignature(fn) {
        try {
            const src = fn.toString();
            const paramsMatch = src.match(/^[^(]*\(([^)]*)\)/);
            const params = paramsMatch ? paramsMatch[1].split(",").map(p => p.trim()).filter(Boolean) : [];
            return {
                paramNames: params,
                paramCount: params.length,
                sourceLength: src.length,
                isAsync: /^\s*async[\s(]/.test(src),
                isClass: src.startsWith("class ")
            };
        } catch (_) {
            return null;
        }
    }

    _extractRequires(factoryFn) {
        try {
            const src = factoryFn.toString();
            const requires = [];

            let requireParam = "__webpack_require__";
            const sigMatch = src.match(/^(?:function\s*[\w$]*\s*)?[\w$]*\s*\(\s*[\w$]+\s*,\s*[\w$]+\s*,\s*([\w$]+)\s*\)\s*(?:=>)?\s*\{/);
            if (sigMatch) {
                requireParam = sigMatch[1];
            }

            const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const rp = esc(requireParam);

            const requireParamRe = new RegExp(rp + "\\s*\\(\\s*(\\d+)\\s*\\)", "g");
            let m;
            while ((m = requireParamRe.exec(src)) !== null) {
                requires.push(m[1]);
            }

            const requireParamStrRe = new RegExp(rp + "\\s*\\(\\s*[\"']([^\"']+)[\"']\\s*\\)", "g");
            while ((m = requireParamStrRe.exec(src)) !== null) {
                requires.push(m[1]);
            }

            const requireStrRe = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
            while ((m = requireStrRe.exec(src)) !== null) {
                requires.push(m[1]);
            }
            const requireNumRe = /require\s*\(\s*(\d+)\s*\)/g;
            while ((m = requireNumRe.exec(src)) !== null) {
                requires.push(m[1]);
            }

            const requireDotRe = new RegExp(rp + "\\.\\w+\\s*\\(\\s*(\\d+)\\s*\\)", "g");
            while ((m = requireDotRe.exec(src)) !== null) {
                requires.push(m[1]);
            }
            const requireDotStrRe = new RegExp(rp + "\\.\\w+\\s*\\(\\s*[\"']([^\"']+)[\"']\\s*\\)", "g");
            while ((m = requireDotStrRe.exec(src)) !== null) {
                requires.push(m[1]);
            }

            if (requires.length === 0) return undefined;
            return [...new Set(requires)];
        } catch (_) {
            return undefined;
        }
    }

    _scanSingleExport(moduleId, exportKey, exportValue, factoryFn) {
        if (exportValue === null || exportValue === undefined) return null;
        const exportType = this._classifyExportType(exportValue);
        if (["nullish", "string", "number", "boolean", "symbol"].includes(exportType) && exportKey !== "default") {
            return null;
        }

        const identity = this._identifyExport(exportValue, exportKey);
        const entityId = `webpackModule:${moduleId}:${exportKey}`;
        const name = identity ? identity.name : `module_${moduleId}_${exportKey}`;

        let keyCount = 0;
        try {
            keyCount = (typeof exportValue === "object" || typeof exportValue === "function")
                ? Object.keys(exportValue).length
                : 0;
        } catch (_) {}

        const data = {
            moduleId,
            exportKey,
            exportType,
            keyCount
        };

        if (typeof exportValue === "function") {
            if (this._shouldDeepScan(moduleId)) {
                data.functionSignature = this._buildFunctionSignature(exportValue);
            }
            try {
                const src = exportValue.toString();
                const MAX_SNIPPET = 400;
                data.sourceSnippet = src.length > MAX_SNIPPET ? src.slice(0, MAX_SNIPPET) : src;
                data.sourceTruncated = src.length > MAX_SNIPPET;
            } catch (_) {}
        }

        if (typeof exportValue === "object" || typeof exportValue === "function") {
            try {
                const ownNames = Object.getOwnPropertyNames(exportValue);
                let protoNames = [];
                const proto = Object.getPrototypeOf(exportValue);
                if (proto && proto !== Object.prototype && proto !== Function.prototype) {
                    protoNames = Object.getOwnPropertyNames(proto);
                }
                const allNames = [...new Set([...ownNames, ...protoNames])]
                    .filter(n => n !== "constructor" && n !== "__proto__");
                if (allNames.length > 0) {
                    data.protoMethods = allNames.slice(0, 100);
                }
            } catch (_) {}
        }

        if (typeof factoryFn === "function") {
            const requires = this._extractRequires(factoryFn);
            if (requires) {
                data.requires = requires;
            }
        }

        return makeEntity({
            id: entityId,
            type: "webpackModule",
            name,
            aliases: identity && identity.name !== exportKey ? [exportKey] : [],
            discoveredVia: identity ? identity.discoveredVia : "moduleId-fallback",
            confidence: identity ? identity.confidence : "low",
            confidenceReason: identity
                ? `Name inferred via ${identity.discoveredVia}.`
                : "No reliable name signal found; using moduleId+exportKey as the identifier.",
            data
        });
    }

    async scan() {
        const wpRequire = this.bootstrap.getRequire();
        if (!wpRequire) {
            this.logger.log(this.moduleName, "wpRequire unavailable — no modules could be scanned.", "warn");
            return [];
        }

        const cache = wpRequire.c;
        this._moduleFactories = this.bootstrap.getModuleFactories();

        const ownKeys = Object.getOwnPropertyNames(wpRequire).filter(k => k !== "c" && k !== "caller" && k !== "arguments" && k !== "prototype" && k !== "name" && k !== "length" && k !== "constructor");
        this.logger.log(this.moduleName, `wpRequire ownKeys: [${ownKeys.join(", ")}]. m=${typeof wpRequire.m !== "undefined" ? typeof wpRequire.m : "undefined"}`, "info");

        if (this._moduleFactories) {
            const mk = Object.keys(this._moduleFactories).slice(0, 10);
            this.logger.log(this.moduleName, `moduleFactories sample keys: [${mk.join(", ")}]`, "info");
        } else {
            this.logger.log(this.moduleName, "module factories not found — factory source unavailable (require() extraction for this module will be skipped).", "warn");
        }
        const entities = [];
        const liveValues = [];
        const moduleIds = Object.keys(cache);

        for (let i = 0; i < moduleIds.length; i++) {
            const moduleId = moduleIds[i];
            await yieldToUI(i, 500);
            let moduleObj;
            try {
                moduleObj = cache[moduleId];
            } catch (_) {
                continue;
            }
            if (!moduleObj || !moduleObj.exports) continue;

            let exportsObj;
            try {
                exportsObj = moduleObj.exports;
            } catch (_) {
                continue;
            }

            let factoryFn;
            if (this._moduleFactories) {
                factoryFn = this._moduleFactories[moduleId];
                if (typeof factoryFn !== "function") {
                    factoryFn = this._moduleFactories[Number(moduleId)];
                }
            }
            if (typeof factoryFn !== "function" && typeof moduleObj === "object") {
                for (const prop of ["factory", "fn", "f", "execute", "load"]) {
                    try {
                        const v = moduleObj[prop];
                        if (typeof v === "function") { factoryFn = v; break; }
                    } catch (_) {}
                }
            }

            try {
                if (typeof exportsObj === "object" || typeof exportsObj === "function") {
                    const keys = Object.keys(exportsObj);
                    if (keys.length === 0) {
                        const entity = this._scanSingleExport(moduleId, "default", exportsObj, factoryFn);
                        if (entity) {
                            entities.push(entity);
                            liveValues.push({ entity, liveValue: exportsObj });
                        }
                    } else {
                        for (const key of keys) {
                            let value;
                            try {
                                value = exportsObj[key];
                            } catch (_) {
                                continue;
                            }
                            const entity = this._scanSingleExport(moduleId, key, value, factoryFn);
                            if (entity) {
                                entities.push(entity);
                                liveValues.push({ entity, liveValue: value });
                            }
                        }
                    }
                } else {
                    const entity = this._scanSingleExport(moduleId, "default", exportsObj, factoryFn);
                    if (entity) {
                        entities.push(entity);
                        liveValues.push({ entity, liveValue: exportsObj });
                    }
                }
            } catch (err) {
                this.logger.log(this.moduleName, `error processing module ${moduleId}: ${err && err.message || err}`, "warn");
            }
        }

        if (typeof this._liveValueCallback === "function") {
            try {
                this._liveValueCallback(liveValues);
            } catch (_) {}
        }

        return entities;
    }
}

class StoreScanner {
    static get KNOWN_STORE_NAME_GROUPS() {
        return {
            RELATIONSHIP: ["RelationshipStore", "RelationshipManagerStore", "RelationshipStoreManager"],
            GUILD_MEMBER: ["GuildMemberStore", "MemberStore", "GuildMembersStore"],
            REACTIONS: ["ReactionsStore", "MessageReactionsStore", "ReactionStore"],
            VOICE_STATE: ["SortedVoiceStateStore", "VoiceStateStore", "SortedVoiceStatesStore"],
            STAGE_PARTICIPANT: ["StageChannelParticipantStore", "StageParticipantStore"],
            STAGE_INSTANCE: ["StageInstanceStore", "StageInstancesStore"],
            ACTIVITY: ["ChannelRTCStore", "ActivityStore", "EmbeddedActivityStore", "ActivityParticipantsStore", "ActivityManagerStore"],
            CHANNEL: ["ChannelStore", "ChannelsStore"],
            MESSAGE: ["MessageStore", "MessagesStore", "ChannelMessagesStore"],
            USER: ["UserStore", "UsersStore", "CurrentUserStore"],
            SELECTED_GUILD: ["SelectedGuildStore", "SelectedGuildIdStore"],
            SELECTED_CHANNEL: ["SelectedChannelStore", "ChannelSelectedStore"],
            CALL: ["CallStore", "VoiceCallStore"],
            MEDIA_ENGINE: ["MediaEngineStore", "MediaEngineManagerStore"],
            READ_STATE: ["ReadStateStore", "ChannelReadStateStore", "ReadStatesStore"],
            GUILD_READ_STATE: ["GuildReadStateStore", "GuildUnreadStore", "GuildReadStatesStore"],
            GUILD_CHANNEL: ["GuildChannelStore", "GuildChannelsStore"],
            GUILD: ["GuildStore", "GuildsStore"],
            PRIVATE_CHANNEL: ["PrivateChannelStore", "PrivateChannelsStore"],
            NOTIFICATION_SETTINGS: ["NotificationSettingsStore", "NotificationStore"],
            CHANNEL_PINS: ["ChannelPinsStore", "PinnedMessagesStore"],
            ACTIVE_JOINED_THREADS: ["ActiveJoinedThreadsStore", "JoinedThreadsStore"],
            THREAD: ["ActiveThreadsStore", "ThreadStore", "ForumChannelStore", "GuildThreadStore", "ThreadsStore"],
            GUILD_SCHEDULED_EVENT: ["GuildScheduledEventStore", "ScheduledEventStore", "GuildEventsStore"],
            CHANNEL_STATUS: ["ChannelStatusStore", "VoiceChannelStatusStore", "ChannelStatusesStore"]
        };
    }

    constructor(options = {}) {
        this.moduleName = "StoreScanner";
        this.logger = options.logger;
        this.bootstrap = options.bootstrap;
        this.webpackEntitiesProvider = options.webpackEntitiesProvider;
        this._knownStoreInstances = new Set();
    }

    isImplemented() { return true; }

    _classifyStoreShape(value) {
        if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
        const checks = [
            {
                name: "addChangeListener+getState",
                test: () => typeof value.addChangeListener === "function" && typeof value.getState === "function",
                discoveredVia: "structural-shape:addChangeListener+getState",
                confidence: "high"
            },
            {
                name: "emit+getState",
                test: () => typeof value.emit === "function" && typeof value.getState === "function",
                discoveredVia: "structural-shape:emit+getState",
                confidence: "high"
            },
            {
                name: "addReactChangeListener+getState",
                test: () => typeof value.addReactChangeListener === "function" && typeof value.getState === "function",
                discoveredVia: "structural-shape:addReactChangeListener+getState",
                confidence: "high"
            },
            {
                name: "_dispatcher+getState",
                test: () => value._dispatcher && typeof value.getState === "function",
                discoveredVia: "structural-shape:_dispatcher+getState",
                confidence: "medium"
            },
            {
                name: "handleDispatch+getState",
                test: () => typeof value.handleDispatch === "function" && typeof value.getState === "function",
                discoveredVia: "structural-shape:handleDispatch+getState",
                confidence: "medium"
            },
            {
                name: "prototype-flux",
                test: () => {
                    try {
                        const proto = Object.getPrototypeOf(value);
                        return proto && (
                            typeof proto.addChangeListener === "function" ||
                            typeof proto.emit === "function"
                        );
                    } catch (_) { return false; }
                },
                discoveredVia: "structural-shape:prototype-flux",
                confidence: "medium"
            }
        ];
        for (const check of checks) {
            try {
                if (check.test()) {
                    return {
                        pattern: check.name,
                        discoveredVia: check.discoveredVia,
                        confidence: check.confidence,
                        confidenceReason: `Matched Flux Store shape pattern: ${check.name}.`
                    };
                }
            } catch (_) {}
        }
        return null;
    }

    _hasStoreShape(value) {
        return this._classifyStoreShape(value) !== null;
    }

    _extractMethodNames(value) {
        if (!value || (typeof value !== "object" && typeof value !== "function")) return [];
        const names = new Set();
        try {
            for (const k of Object.keys(value)) {
                try { if (typeof value[k] === "function") names.add(k); } catch (_) {}
            }
        } catch (_) {}
        try {
            const proto = Object.getPrototypeOf(value);
            if (proto && proto !== Object.prototype) {
                for (const k of Object.getOwnPropertyNames(proto)) {
                    if (k === "constructor") continue;
                    try { if (typeof proto[k] === "function") names.add(k); } catch (_) {}
                }
            }
        } catch (_) {}
        return [...names].sort().slice(0, 200);
    }

    _bestNameForStore(storeInstance, fallbackName) {
        try {
            if (typeof storeInstance.getName === "function") {
                const n = storeInstance.getName();
                if (typeof n === "string" && n.length > 0) return n;
            }
        } catch (_) {}
        if (storeInstance.constructor && typeof storeInstance.constructor.name === "string"
            && storeInstance.constructor.name !== "Object" && storeInstance.constructor.name.length > 0) {
            return storeInstance.constructor.name;
        }
        return fallbackName;
    }

    async _scanKnownNames() {
        const entities = [];
        if (typeof BdApi === "undefined" || !BdApi.Webpack || typeof BdApi.Webpack.getStore !== "function") {
            this.logger.log(this.moduleName, "BdApi.Webpack.getStore unavailable — skipping known-name lookup phase.", "warn");
            return entities;
        }

        for (const [groupKey, candidateNames] of Object.entries(StoreScanner.KNOWN_STORE_NAME_GROUPS)) {
            let found = null;
            let matchedName = null;
            for (const name of candidateNames) {
                try {
                    const store = BdApi.Webpack.getStore(name);
                    if (store) {
                        found = store;
                        matchedName = name;
                        break;
                    }
                } catch (_) {
                }
            }
            if (!found) continue;

            this._knownStoreInstances.add(found);

            const shape = this._classifyStoreShape(found);
            entities.push(makeEntity({
                id: `store:known:${groupKey}`,
                type: "store",
                name: this._bestNameForStore(found, matchedName),
                aliases: candidateNames.filter(n => n !== matchedName),
                discoveredVia: "known-name-lookup",
                confidence: "high",
                confidenceReason: `Resolved via BdApi.Webpack.getStore("${matchedName}"), a trusted BetterDiscord Store-resolution API.`,
                data: {
                    matchedName,
                    candidateGroup: groupKey,
                    hasStoreShape: shape !== null,
                    matchedPattern: shape ? shape.pattern : null,
                    methodNames: this._extractMethodNames(found)
                }
            }));
        }

        return entities;
    }

    async _scanStructural() {
        const entities = [];
        if (typeof this.webpackEntitiesProvider !== "function") {
            this.logger.log(this.moduleName, "no webpackEntitiesProvider configured — skipping structural discovery phase.", "warn");
            return entities;
        }

        let webpackEntities = [];
        try {
            webpackEntities = this.webpackEntitiesProvider() || [];
        } catch (err) {
            this.logger.log(this.moduleName, `webpackEntitiesProvider threw: ${err && err.message || err}`, "warn");
            return entities;
        }

        for (let i = 0; i < webpackEntities.length; i++) {
            await yieldToUI(i, 500);
            const { entity, liveValue } = webpackEntities[i];
            const shape = this._classifyStoreShape(liveValue);
            if (!shape) continue;
            if (this._knownStoreInstances.has(liveValue)) continue;

            const looksLikeStoreName = /store$/i.test(entity.name) || /manager$/i.test(entity.name);
            const confidence = looksLikeStoreName ? shape.confidence : "low";
            const extraReason = looksLikeStoreName
                ? " Name also matches a Store-like pattern."
                : " Name gives no additional confirmation.";

            entities.push(makeEntity({
                id: `store:structural:${entity.data.moduleId}:${entity.data.exportKey}`,
                type: "store",
                name: this._bestNameForStore(liveValue, entity.name),
                aliases: entity.aliases || [],
                discoveredVia: shape.discoveredVia,
                confidence: confidence,
                confidenceReason: shape.confidenceReason + extraReason,
                data: {
                    sourceModuleId: entity.data.moduleId,
                    sourceExportKey: entity.data.exportKey,
                    matchedPattern: shape.pattern,
                    methodNames: this._extractMethodNames(liveValue)
                }
            }));
        }

        return entities;
    }

    async _scanConsumers() {
        const entities = [];
        const knownEntities = this._scanKnownNameEntitiesCache || [];
        const structuralEntities = this._scanStructuralEntitiesCache || [];
        const allStoreEntities = [...knownEntities, ...structuralEntities];

        if (allStoreEntities.length === 0) return entities;

        const storeNames = allStoreEntities.map(e => e.name);
        const wpRequire = this.bootstrap?.getRequire();
        if (!wpRequire?.c) return entities;

        const ids = Object.keys(wpRequire.c);
        const storeNamePattern = new RegExp(`\\b(${storeNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|")})\\b`, 'g');

        const consumersByStore = {};
        for (const name of storeNames) consumersByStore[name] = { uses: [], observes: [], modifies: [] };

        for (let i = 0; i < ids.length; i++) {
            await yieldToUI(i, 500);
            try {
                const mod = wpRequire.c[ids[i]];
                if (!mod || !mod.exports) continue;
                const exp = mod.exports;
                const vals = typeof exp === "object" ? Object.values(exp) : [exp];
                for (const val of vals) {
                    if (typeof val !== "function") continue;
                    const src = val.toString();
                    if (!src.match(storeNamePattern)) continue;
                    for (const name of storeNames) {
                        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const nameRe = new RegExp(`\\b${escaped}\\b`);
                        if (!nameRe.test(src)) continue;
                        const uses = nameRe.test(src);
                        const observes = /addChangeListener|addListener|subscribe/.test(src) && nameRe.test(src);
                        const modifies = /\.dispatch\s*\(/.test(src) && nameRe.test(src);
                        if (uses) consumersByStore[name].uses.push(ids[i]);
                        if (observes) consumersByStore[name].observes.push(ids[i]);
                        if (modifies) consumersByStore[name].modifies.push(ids[i]);
                    }
                }
            } catch (_) {}
        }

        for (const storeName of storeNames) {
            const info = consumersByStore[storeName];
            if (info.uses.length === 0 && info.observes.length === 0 && info.modifies.length === 0) continue;
            entities.push(makeEntity({
                id: `store:consumers:${storeName}`,
                type: "store",
                name: `${storeName}_Consumers`,
                aliases: [],
                discoveredVia: "webpack-scan:store-references",
                confidence: "medium",
                confidenceReason: `Found ${info.uses.length} modules referencing ${storeName} by name in their source.`,
                data: {
                    storeName,
                    usesCount: info.uses.length,
                    observesCount: info.observes.length,
                    modifiesCount: info.modifies.length,
                    consumerModuleIds: info.uses.slice(0, 30),
                    observerModuleIds: info.observes.slice(0, 20),
                    modifierModuleIds: info.modifies.slice(0, 20)
                }
            }));
        }

        return entities;
    }

    async scan() {
        const knownNameEntities = await this._scanKnownNames();
        this._scanKnownNameEntitiesCache = knownNameEntities;
        const structuralEntities = await this._scanStructural();
        this._scanStructuralEntitiesCache = structuralEntities;
        const consumerEntities = await this._scanConsumers();
        return [...knownNameEntities, ...structuralEntities, ...consumerEntities];
    }
}
const COMPATIBILITY_CHECKS = [
    { plugin: "ByeBlocked", label: "RelationshipStore", kind: "storeName", candidates: ["RelationshipStore", "RelationshipManagerStore", "RelationshipStoreManager"] },
    { plugin: "ByeBlocked", label: "GuildMemberStore", kind: "storeName", candidates: ["GuildMemberStore", "MemberStore", "GuildMembersStore"] },
    { plugin: "ByeBlocked", label: "ReactionsStore", kind: "storeName", candidates: ["ReactionsStore", "MessageReactionsStore", "ReactionStore"] },
    { plugin: "ByeBlocked", label: "SortedVoiceStateStore", kind: "storeName", candidates: ["SortedVoiceStateStore", "VoiceStateStore", "SortedVoiceStatesStore"], requiresContext: "voiceCall" },
    { plugin: "ByeBlocked", label: "StageChannelParticipantStore", kind: "storeName", candidates: ["StageChannelParticipantStore", "StageParticipantStore"], requiresContext: "stageChannel" },
    { plugin: "ByeBlocked", label: "StageInstanceStore", kind: "storeName", candidates: ["StageInstanceStore", "StageInstancesStore"], requiresContext: "stageChannel" },
    { plugin: "ByeBlocked", label: "ActivityStore", kind: "storeName", candidates: ["ChannelRTCStore", "ActivityStore", "EmbeddedActivityStore", "ActivityParticipantsStore", "ActivityManagerStore"],
      requiresContext: "voiceCallWithActivity",
      note: "CORRECTED after reading ByeBlocked's actual source: this.modules.ActivityStore is used to filter PARTICIPANTS of an Activity/Watch-Together inside a voice channel (calls getParticipants()/getActivityParticipants(), guarded by typeof checks — tolerant of missing methods). It is NOT rich-presence/status (that's PresenceStore, unrelated). Confirmed live: none of the original 4 candidates exist in current builds; the real Store is ChannelRTCStore (has getParticipants + getActivityParticipants; getEmbeddedActivityParticipants is gone). Not a hard dependency — ByeBlocked already checks each method with typeof before patching, so once STORE_NAMES.ACTIVITY includes \"ChannelRTCStore\" as a candidate, no other code change is needed."
    },
    { plugin: "ByeBlocked", label: "ChannelStore", kind: "storeName", candidates: ["ChannelStore", "ChannelsStore"] },
    { plugin: "ByeBlocked", label: "MessageStore", kind: "storeName", candidates: ["MessageStore", "MessagesStore", "ChannelMessagesStore"] },
    { plugin: "ByeBlocked", label: "UserStore", kind: "storeName", candidates: ["UserStore", "UsersStore", "CurrentUserStore"] },
    { plugin: "ByeBlocked", label: "SelectedGuildStore", kind: "storeName", candidates: ["SelectedGuildStore", "SelectedGuildIdStore"] },
    { plugin: "ByeBlocked", label: "SelectedChannelStore", kind: "storeName", candidates: ["SelectedChannelStore", "ChannelSelectedStore"] },
    { plugin: "ByeBlocked", label: "CallStore", kind: "storeName", candidates: ["CallStore", "VoiceCallStore"], requiresContext: "voiceCall" },
    { plugin: "ByeBlocked", label: "VoiceStateStore", kind: "storeName", candidates: ["VoiceStateStore", "VoiceStatesStore"], requiresContext: "voiceCall" },
    { plugin: "ByeBlocked", label: "MediaEngineStore", kind: "storeName", candidates: ["MediaEngineStore", "MediaEngineManagerStore"], requiresContext: "voiceCallWithVideo" },
    { plugin: "ByeBlocked", label: "ReadStateStore", kind: "storeName", candidates: ["ReadStateStore", "ChannelReadStateStore", "ReadStatesStore"] },
    { plugin: "ByeBlocked", label: "GuildReadStateStore", kind: "storeName", candidates: ["GuildReadStateStore", "GuildUnreadStore", "GuildReadStatesStore"] },
    { plugin: "ByeBlocked", label: "GuildChannelStore", kind: "storeName", candidates: ["GuildChannelStore", "GuildChannelsStore"] },
    { plugin: "ByeBlocked", label: "GuildStore", kind: "storeName", candidates: ["GuildStore", "GuildsStore"] },
    { plugin: "ByeBlocked", label: "PrivateChannelStore", kind: "storeName", candidates: ["PrivateChannelStore", "PrivateChannelsStore"],
      note: "CORRECTED after reading ByeBlocked's actual source (resolveModules(), ~line 3083): its real fallback checks ChannelStore for ANY of getPrivateChannels/getPrivateChannelIds/getMutablePrivateChannels — not just the first two as previously assumed here.",
      methodFallback: {
        storeCandidates: ["ChannelStore", "ChannelsStore"],
        methodNames: ["getMutablePrivateChannels", "getPrivateChannelIds", "getPrivateChannels", "getSortedPrivateChannels"],
        originalMethodNames: ["getPrivateChannels", "getPrivateChannelIds", "getMutablePrivateChannels"]
      }
    },
    { plugin: "ByeBlocked", label: "NotificationSettingsStore", kind: "storeName", candidates: ["NotificationSettingsStore", "NotificationStore"] },
    { plugin: "ByeBlocked", label: "ChannelPinsStore", kind: "storeName", candidates: ["ChannelPinsStore", "PinnedMessagesStore"] },
    { plugin: "ByeBlocked", label: "ActiveJoinedThreadsStore", kind: "storeName", candidates: ["ActiveJoinedThreadsStore", "JoinedThreadsStore"] },
    { plugin: "ByeBlocked", label: "ThreadStore", kind: "storeName", candidates: ["ActiveThreadsStore", "ThreadStore", "ForumChannelStore", "GuildThreadStore", "ThreadsStore"] },
    { plugin: "ByeBlocked", label: "GuildScheduledEventStore", kind: "storeName", candidates: ["GuildScheduledEventStore", "ScheduledEventStore", "GuildEventsStore"] },
    { plugin: "ByeBlocked", label: "ChannelStatusStore", kind: "storeName", candidates: ["ChannelStatusStore", "VoiceChannelStatusStore", "ChannelStatusesStore"] },

    { plugin: "ByeBlocked", label: "RelationshipUtils", kind: "structuralModule",
      filter: { keys: ["addRelationship", "removeRelationship"] },
      note: "getModule(m => m?.addRelationship && m?.removeRelationship). Used via this.modules.RelationshipUtils for block/unblock/friend." },
    { plugin: "ByeBlocked", label: "RTCConnectionUtils", kind: "structuralModule",
      filter: { keys: ["getChannelId", "getGuildId"], requireFunctions: true },
      requiresContext: "voiceCall",
      note: "getModule(m => typeof m?.getChannelId === 'function' && typeof m?.getGuildId === 'function'). Used for RTC/voice connection state." },
    { plugin: "ByeBlocked", label: "RTCParticipantsModule", kind: "structuralModule",
      filter: { keysAny: ["getParticipants", "getVoiceParticipants"], excludeKeys: ["getChannelId"], requireFunctions: true, searchExports: true },
      requiresContext: "voiceCall",
      note: "getModule with searchExports: true. Used for voice channel participant filtering." },

    { plugin: "ByeBlocked", label: "playSound function", kind: "sourceString", needles: ["playSound"], minHits: 1 },
    { plugin: "ByeBlocked", label: "BlockedMessageGroup render", kind: "sourceString", needles: ["MESSAGE_GROUP_BLOCKED", "blockedMessageGroup", "BlockedMessages", "blockedMessages", "messageGroupSpacing", "isBlockedMessage", "BLOCKED_MESSAGE"], minHits: 2 },
    { plugin: "ByeBlocked", label: "MessagesWrap component", kind: "sourceString", needles: ["MessagesWrap"], minHits: 1 },

    { plugin: "ByeBlocked", label: "Channel class (isGroupDM/isDM)", kind: "protoShape", methods: ["isGroupDM", "isDM"] },
    { plugin: "ByeBlocked", label: "CallButtons component (renderVoiceCallButton)", kind: "protoShape", methods: ["render", "renderVoiceCallButton"] },

    { plugin: "ByeBlocked", label: "Voice participant grid card (participant userId prop)", kind: "domProp",
      selector: "[class*='voiceUser'], [class*='participant']",
      expectedPropAny: ["userId", "user", "participantUserId"],
      maxHops: 15,
      requiresContext: "voiceCallWithVideo",
      note: "Covers the case where the participant card component turned into a bare function component (no prototype methods left to fingerprint via protoShape) — this walks Fiber return pointers looking for the user-identifying prop instead of relying on any class shape." },
    { plugin: "ByeBlocked", label: "Member list row (member userId prop)", kind: "domProp",
      selector: "[class*='member'][role='listitem'], [class*='memberInner']",
      expectedPropAny: ["user", "userId"],
      maxHops: 15,
      requiresContext: "memberListOpen",
      note: "Fiber-walk fallback for the member list row component, used when neither storeName nor protoShape can pin down how a blocked member's identity reaches the row." },

    { plugin: "ByeBlocked", label: "Runtime: notification dispatcher patch", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "dispatcherPatch",
      relatedChecks: ["SelectedChannelStore", "ChannelStore", "ReadStateStore"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for its notification/badge-suppression dispatch patch against the structural health of the Stores it depends on to install that patch." },
    { plugin: "ByeBlocked", label: "Runtime: voice channel user hiding", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "voice",
      relatedChecks: ["SortedVoiceStateStore", "Voice participant grid card (participant userId prop)"],
      requiresContext: "voiceCall",
      note: "Cross-references ByeBlocked's own HealthMonitor entry for hiding blocked users in voice channel lists against the structural health of the voice DOM/store fingerprints it depends on." },
    { plugin: "ByeBlocked", label: "Runtime: message list filtering", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "messages",
      relatedChecks: ["MessageStore", "BlockedMessageGroup render", "MessagesWrap component"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for hiding blocked users' messages against the structural health of the message-store/DOM fingerprints it depends on." },
    { plugin: "ByeBlocked", label: "Runtime: reaction list filtering", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "reactions",
      relatedChecks: ["ReactionsStore"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for hiding blocked users' reactions against the structural health of ReactionsStore." },
    { plugin: "ByeBlocked", label: "Runtime: blocked voice audio muting", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "voiceAudio",
      relatedChecks: ["MediaEngineStore", "SortedVoiceStateStore"],
      requiresContext: "voiceCall",
      note: "Cross-references ByeBlocked's own HealthMonitor entry for muting blocked users' voice audio against the structural health of the media engine / voice state Stores." },
    { plugin: "ByeBlocked", label: "Runtime: group DM hiding", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "groupDms",
      relatedChecks: ["PrivateChannelStore", "Channel class (isGroupDM/isDM)"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for hiding group DMs from blocked-only participants against the structural health of PrivateChannelStore and the Channel class shape." },

    { plugin: "ByeBlocked", label: "Runtime: member list filtering", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "members",
      relatedChecks: ["Member list row (member userId prop)"],
      requiresContext: "memberListOpen",
      note: "Cross-references ByeBlocked's own HealthMonitor entry for hiding blocked users from the member list against the structural health of the member-list-row DOM fingerprint. ByeBlocked's own check function samples up to 40 live [data-list-item-id] rows each cycle, so a degraded result here reflects a real observed leak, not just a theoretical one." },
    { plugin: "ByeBlocked", label: "Runtime: scheduled event creator hiding", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "events",
      relatedChecks: ["GuildScheduledEventStore"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for hiding scheduled events created by blocked users against the structural health of GuildScheduledEventStore. Only meaningful when the guild has scheduled events visible; ByeBlocked's own check no-ops (returns healthy) if settings.places.events is off." },
    { plugin: "ByeBlocked", label: "Runtime: voice user component patch", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "voiceUserComponentPatch",
      relatedChecks: ["Voice participant grid card (participant userId prop)"],
      requiresContext: "voiceCall",
      note: "Cross-references ByeBlocked's own HealthMonitor entry for whether its patch on the voice-user component is still attached against the structural health of the voice participant card fingerprint. Distinct from the 'Runtime: voice channel user hiding' check above: that one verifies blocked users are actually hidden; this one only verifies the patch itself is still installed (it can be installed but silently no-op if Discord changed the component around it)." },

    { plugin: "ByeBlocked", label: "InviteQueryModule (queryFriends/queryDMUsers)", kind: "sourceString",
      needles: ["queryFriends", "queryDMUsers", "friendSuggestions"], minHits: 2,
      note: "Fingerprint for the invite-suggestions module ByeBlocked resolves via _wpGetBySource / source-fingerprint fallback (see resolveInviteQueryModule). Was previously untracked by Probe — ByeBlocked's own 'inviteQueryModule' health check had no relatedChecks to cross-reference against, so a degradation there always diagnosed as 'unknown'." },
    { plugin: "ByeBlocked", label: "Runtime: invite suggestions filtering", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "inviteQueryModule",
      relatedChecks: ["InviteQueryModule (queryFriends/queryDMUsers)"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for the invite-suggestions patch against the structural health of the InviteQueryModule source fingerprint. Only meaningful when settings.places.autocomplete is on; ByeBlocked's own check no-ops otherwise." },

    { plugin: "ByeBlocked", label: "Autocomplete row component (patchAutocompleteRowComponent target)", kind: "sourceString",
      needles: ["autocomplete", "aria-selected", "user", "userId"], minHits: 3,
      note: "Fingerprint for the function ByeBlocked patches via BdApi.Webpack.getWithKey(m => ... AUTOCOMPLETE_TERMS, 3-of-4 match) in patchAutocompleteRowComponent(). Was previously untracked — ByeBlocked's own 'autocompleteRowPatch' health check had no relatedChecks to cross-reference against." },
    { plugin: "ByeBlocked", label: "Runtime: autocomplete row patch", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "autocompleteRowPatch",
      relatedChecks: ["Autocomplete row component (patchAutocompleteRowComponent target)"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for whether the autocomplete-row patch is still attached against the structural health of that component's source fingerprint. Verifies the patch itself is installed, not that filtering is visibly working — pair with a live autocomplete check (type @ in a message box) to confirm end-to-end." },

    { plugin: "ByeBlocked", label: "Forum post card component (patchForumPostComponent target)", kind: "sourceString",
      needles: ["mainCard_", "forumPostItem", "ForumPostCard", "forum-channel-list-"], minHits: 2,
      note: "Fingerprint for the module ByeBlocked patches via looksLikeForumCardFn (2-of-4 match on FORUM_CARD_STRINGS) in patchForumPostComponent(). Was previously untracked — ByeBlocked's own 'forumPostPatch' health check had no relatedChecks to cross-reference against." },
    { plugin: "ByeBlocked", label: "Runtime: forum post card patch", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "forumPostPatch",
      relatedChecks: ["Forum post card component (patchForumPostComponent target)"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for whether the forum-post-card patch is still attached against the structural health of that component's source fingerprint. Only meaningful in servers using Forum channels." },

    { plugin: "ByeBlocked", label: "Runtime: voice states alt-method filter", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "voiceStatesAltFilter",
      relatedChecks: ["SortedVoiceStateStore"],
      requiresContext: "voiceCall",
      note: "Cross-references ByeBlocked's own HealthMonitor entry for the profile-popout voice-states alt method (patchStores() resolves this dynamically as getVoiceStatesForChannelAlt or an equivalent name via _findVoiceStatesAltMethodName) against the structural health of SortedVoiceStateStore, the store this alt method lives on regardless of its exact name. The method name itself isn't independently fingerprinted since it's resolved dynamically at runtime, not via a fixed candidate list — the store it hangs off of is the meaningful structural anchor here." }
];

class ModuleFinder {
    constructor(options = {}) {
        this.moduleName = "ModuleFinder";
        this.logger = options.logger;
        this.bootstrap = options.bootstrap;
        this.checks = options.checks || COMPATIBILITY_CHECKS;
    }

    _collectSearchTerms(currentCheckResults) {
        const resultByLabel = new Map();
        for (const r of currentCheckResults || []) resultByLabel.set(`${r.plugin}::${r.label}`, r.status);

        const terms = new Set();
        for (const check of this.checks) {
            const key = `${check.plugin}::${check.label}`;
            const status = resultByLabel.get(key);
            if (status === "resolved") continue;
            if (check.kind === "sourceString" && Array.isArray(check.needles)) {
                for (const n of check.needles) terms.add(n);
            } else if (check.kind === "protoShape" && Array.isArray(check.methods)) {
                for (const m of check.methods) terms.add(m);
            }
        }
        return [...terms];
    }

    async find(currentCheckResults, onProgress) {
        const wpRequire = this.bootstrap.getRequire();
        const factories = this.bootstrap.getModuleFactories();
        if (!wpRequire || !factories) {
            this.logger.log(this.moduleName, "no wpRequire cache or factory map available — cannot search.", "warn");
            return { searched: 0, candidatesFound: 0, candidates: [] };
        }

        const searchTerms = this._collectSearchTerms(currentCheckResults);
        if (searchTerms.length === 0) {
            this.logger.log(this.moduleName, "nothing to search for — all checks already resolved.");
            return { searched: 0, candidatesFound: 0, candidates: [] };
        }
        const searchTermsLower = searchTerms.map(t => t.toLowerCase());

        const resolvedIds = new Set(Object.keys(wpRequire.c || {}));
        const unresolvedIds = Object.keys(factories).filter(id => !resolvedIds.has(id));
        this.logger.log(this.moduleName, `searching ${unresolvedIds.length} unresolved factory(ies) for terms: [${searchTerms.join(", ")}]`);

        const candidates = [];
        let scanned = 0;
        for (const id of unresolvedIds) {
            scanned++;
            await yieldToUI(scanned, 400);
            try {
                const src = factories[id].toString();
                const srcLower = src.toLowerCase();
                const matchedTerms = searchTermsLower.filter(t => srcLower.includes(t));
                if (matchedTerms.length > 0) {
                    candidates.push({
                        id,
                        matchedTerms,
                        matchedTermCount: matchedTerms.length,
                        sourcePreview: src.length > 200 ? src.slice(0, 200) : src
                    });
                }
            } catch (_) {}
        }
        candidates.sort((a, b) => b.matchedTermCount - a.matchedTermCount);
        this.logger.log(this.moduleName, `found ${candidates.length} candidate(s) out of ${unresolvedIds.length} unresolved factory(ies) — not executed, source-text match only.`);

        return {
            searched: unresolvedIds.length,
            candidatesFound: candidates.length,
            candidates: candidates.slice(0, 100)
        };
    }
}

class CompatibilityModule {
    constructor(options = {}) {
        this.moduleName = "Compatibility";
        this.logger = options.logger;
        this.allEntities = options.allEntities || [];
        this.checks = options.checks || COMPATIBILITY_CHECKS;
    }

    isImplemented() { return true; }

    setEntities(entities) {
        this.allEntities = entities || [];
    }

    _levenshtein(a, b) {
        const al = a.length, bl = b.length;
        if (al === 0) return bl;
        if (bl === 0) return al;
        const row = new Array(bl + 1);
        for (let j = 0; j <= bl; j++) row[j] = j;
        for (let i = 1; i <= al; i++) {
            let prev = row[0];
            row[0] = i;
            for (let j = 1; j <= bl; j++) {
                const tmp = row[j];
                row[j] = Math.min(
                    row[j] + 1,
                    row[j - 1] + 1,
                    prev + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
                prev = tmp;
            }
        }
        return row[bl];
    }

    _loadPluginHealthSnapshot(pluginName, dataKey) {
        try {
            if (typeof BdApi === "undefined" || !BdApi.Data || typeof BdApi.Data.load !== "function") return null;
            const snapshot = BdApi.Data.load(pluginName, dataKey);
            if (!snapshot || !Array.isArray(snapshot.checks)) return null;
            return snapshot;
        } catch (_) {
            return null;
        }
    }

    _diagnosePluginHealthDegradation(check, resultsSoFar) {
        const relatedLabels = check.relatedChecks || [];
        const related = relatedLabels.map(label => {
            const found = resultsSoFar.find(r => r.plugin === check.plugin && r.label === label);
            return found ? { label, status: found.status, note: found.note } : { label, status: "not_found_in_checklist", note: null };
        });

        const structurallyUnhealthy = new Set(["not_resolved", "fallback_broken", "plausible", "fallback_renamed"]);
        const suspects = related.filter(r => structurallyUnhealthy.has(r.status));

        if (relatedLabels.length === 0) {
            return {
                verdict: "unknown",
                summary: `This health check declares no relatedChecks to cross-reference against, so Probe cannot distinguish a Discord-side change from a plugin-side bug here. Add relatedChecks (labels of storeName/structuralModule/sourceString checks this runtime feature depends on) to get an automatic diagnosis.`,
                relatedChecksExamined: related
            };
        }

        if (suspects.length > 0) {
            return {
                verdict: "likely_discord_change",
                summary: `${suspects.length}/${related.length} related structural check(s) also show a problem in this same scan: [${suspects.map(s => `${s.label} (${s.status})`).join(", ")}]. This is consistent with Discord having changed or renamed something ByeBlocked depends on — the runtime failure is likely a downstream symptom, not a standalone bug. Start investigating with the structural check(s) above.`,
                relatedChecksExamined: related
            };
        }

        return {
            verdict: "likely_plugin_bug",
            summary: `All ${related.length} related structural check(s) resolved cleanly in this same scan: [${related.map(r => r.label).join(", ")}]. Discord's modules/stores this feature depends on appear structurally intact, so the runtime failure is more likely a logic or timing bug inside ByeBlocked itself (e.g. a one-time init step that ran before a dependency was ready, with no retry) rather than a Discord-side change. Worth checking ByeBlocked's own init/retry logic for this feature before assuming Discord changed anything.`,
            relatedChecksExamined: related
        };
    }

    _checkPluginHealthCheck(check, resultsSoFar) {
        const pluginName = check.sourcePlugin || check.plugin;
        const dataKey = check.dataKey || "healthSnapshotForProbe";
        const snapshot = this._loadPluginHealthSnapshot(pluginName, dataKey);

        if (!snapshot) {
            return {
                status: "cannot_verify",
                confidence: "low",
                matchedVia: null,
                note: `No health snapshot found at BdApi.Data("${pluginName}", "${dataKey}"). Either ${pluginName} isn't running, hasn't published a snapshot yet (first ~2s after its HealthMonitor starts), or the data key changed. This is not evidence of a real problem.`
            };
        }

        const entry = snapshot.checks.find(c => c.name === check.healthCheckName);
        if (!entry) {
            return {
                status: "cannot_verify",
                confidence: "low",
                matchedVia: null,
                note: `${pluginName}'s published health snapshot exists (captured ${new Date(snapshot.publishedAt).toLocaleString("en-US")}) but has no check named "${check.healthCheckName}". It may have been renamed or removed in a newer ${pluginName} version, or hasn't been registered yet this session (some health checks only register after a first successful patch).`
            };
        }

        const ageMs = Date.now() - (snapshot.publishedAt || 0);
        const staleWarning = ageMs > 10 * 60 * 1000
            ? ` (snapshot is ${Math.round(ageMs / 60000)}min old — may not reflect current state; ask the user to reopen ${pluginName}'s settings or wait for its next health cycle.)`
            : "";

        if (!entry.degraded) {
            return {
                status: "resolved",
                confidence: "high",
                matchedVia: `${pluginName}.HealthMonitor:${check.healthCheckName}`,
                note: `${pluginName} reports this runtime feature as healthy (failStreak: ${entry.failStreak}, lifetime failures: ${entry.totalFailures}).${staleWarning}`
            };
        }

        const diagnosis = this._diagnosePluginHealthDegradation(check, resultsSoFar);
        const verdictStatus = diagnosis.verdict === "likely_discord_change" ? "not_resolved" : "fallback_broken";

        return {
            status: verdictStatus,
            confidence: diagnosis.verdict === "unknown" ? "low" : "medium",
            matchedVia: `${pluginName}.HealthMonitor:${check.healthCheckName}`,
            note: `${pluginName} reports this runtime feature as DEGRADED (failStreak: ${entry.failStreak}, lifetime failures: ${entry.totalFailures}, degraded ${entry.degradedCount} time(s) this session).${staleWarning} Diagnosis: ${diagnosis.summary}`,
            investigation: {
                investigatedAt: Date.now(),
                technique: "pluginHealthCheck:cross-reference-structural-checks",
                verdict: diagnosis.verdict,
                healthEntrySnapshot: entry,
                snapshotPublishedAt: snapshot.publishedAt,
                snapshotDiscordBuildNumber: snapshot.discordBuildNumber,
                relatedChecksExamined: diagnosis.relatedChecksExamined,
                summary: diagnosis.summary
            }
        };
    }

    _investigateStoreName(check, stores) {
        const scored = stores.map(s => {
            const distances = check.candidates.map(c => this._levenshtein(c.toLowerCase(), (s.name || "").toLowerCase()));
            return { s, bestDistance: Math.min(...distances) };
        }).sort((a, b) => a.bestDistance - b.bestDistance);

        const closestCandidates = scored.slice(0, 5).map(({ s, bestDistance }) => ({
            storeName: s.name,
            aliases: s.aliases || [],
            nameDistanceToClosestCandidate: bestDistance,
            confidence: s.confidence,
            discoveredVia: s.discoveredVia,
            methodNamesSample: (s.data?.methodNames || []).slice(0, 30)
        }));

        return {
            investigatedAt: Date.now(),
            technique: "storeName:name-similarity-rank",
            totalStoresScanned: stores.length,
            closestCandidates,
            summary: closestCandidates.length > 0
                ? `Closest known store by name is "${closestCandidates[0].storeName}" (edit distance ${closestCandidates[0].nameDistanceToClosestCandidate} from the nearest expected candidate). Check methodNamesSample to see if it exposes the shape ByeBlocked needs under a new name.`
                : `No store entities at all were present in this snapshot to compare against — StoreScanner likely found nothing this session (re-scan after more navigation).`
        };
    }

    _checkStoreName(check) {
        const stores = this.allEntities.filter(e => e.type === "store");
        for (const candidate of check.candidates) {
            const match = stores.find(s => s.name === candidate || (s.aliases || []).includes(candidate));
            if (match) {
                return {
                    status: "resolved",
                    confidence: match.confidence,
                    matchedVia: candidate,
                    note: candidate === check.candidates[0]
                        ? "Primary candidate name resolved directly."
                        : `Primary candidate name(s) [${check.candidates.slice(0, check.candidates.indexOf(candidate)).join(", ")}] did NOT resolve — only fell back to "${candidate}". Update ByeBlocked's candidate order if this persists.`
                };
            }
        }
        if (typeof BdApi !== "undefined" && BdApi.Webpack && typeof BdApi.Webpack.getStore === "function") {
            for (const candidate of check.candidates) {
                try {
                    const live = BdApi.Webpack.getStore(candidate);
                    if (live) {
                        return {
                            status: "resolved",
                            confidence: "medium",
                            matchedVia: `${candidate} (live)`,
                            note: `Not found in snapshot entities, but resolved live via BdApi.Webpack.getStore("${candidate}"). The StoreScanner may have missed it (lazy-loaded or structural scan gap); re-scan after more navigation may also capture it as an entity.`
                        };
                    }
                } catch (_) {}
            }
        }
        if (check.methodFallback) {
            const fb = check.methodFallback;
            const fallbackResult = this._checkMethodFallback(fb);
            if (fallbackResult) return fallbackResult;
        }

        const extraNote = check.note ? ` ${check.note}` : "";
        return {
            status: "not_resolved",
            confidence: "high",
            matchedVia: null,
            note: `None of [${check.candidates.join(", ")}] found as a Store entity (name or alias) in this scan. Either the Store was renamed, or it hasn't been loaded yet this session (re-scan after navigating more of the app before treating this as a real break).${extraNote}`,
            investigation: this._investigateStoreName(check, stores)
        };
    }

    _checkMethodFallback(fb) {
        if (typeof BdApi === "undefined" || !BdApi.Webpack || typeof BdApi.Webpack.getStore !== "function") {
            return null;
        }
        let fallbackStore = null;
        let matchedStoreName = null;
        for (const name of fb.storeCandidates || []) {
            try {
                const s = BdApi.Webpack.getStore(name);
                if (s) { fallbackStore = s; matchedStoreName = name; break; }
            } catch (_) {}
        }
        if (!fallbackStore) return null;

        const hasMethod = (m) => {
            try { return typeof fallbackStore[m] === "function"; } catch (_) { return false; }
        };

        const originalStillPresent = (fb.originalMethodNames || []).filter(hasMethod);
        if (originalStillPresent.length > 0) {
            return {
                status: "resolved",
                confidence: "medium",
                matchedVia: `${matchedStoreName}.${originalStillPresent[0]} (fallback)`,
                note: `Dedicated Store not found, but the dependent plugin's documented fallback (${matchedStoreName}) still exposes its original method(s) [${originalStillPresent.join(", ")}]. Fallback code should work unmodified.`
            };
        }

        const renamedEquivalent = (fb.methodNames || []).filter(hasMethod);
        if (renamedEquivalent.length > 0) {
            return {
                status: "fallback_renamed",
                confidence: "high",
                matchedVia: `${matchedStoreName}.${renamedEquivalent[0]}`,
                note: `Dedicated Store not found. The plugin's fallback Store (${matchedStoreName}) still exists, but its original fallback method(s) [${(fb.originalMethodNames || []).join(", ")}] are gone — Discord renamed them. Found equivalent method(s) instead: [${renamedEquivalent.join(", ")}]. The dependent plugin's fallback code needs to be updated to call these new method names, or it will silently misbehave (not crash, just stop working).`
            };
        }

        return {
            status: "fallback_broken",
            confidence: "high",
            matchedVia: null,
            note: `Dedicated Store not found. The plugin's documented fallback Store (${matchedStoreName}) exists, but NONE of its expected method names — original [${(fb.originalMethodNames || []).join(", ")}] or known alternatives [${(fb.methodNames || []).join(", ")}] — are present. The fallback itself is broken; this needs a real code fix in the dependent plugin, not just a name update.`
        };
    }

    _investigateSourceString(check, modules, needleLower) {
        const scored = [];
        for (const m of modules) {
            const snippet = m.data?.sourceSnippet || "";
            const snippetLower = snippet.toLowerCase();
            const haystackName = `${m.name || ""} ${(m.aliases || []).join(" ")}`.toLowerCase();
            const matchedInSnippet = needleLower.filter(n => snippetLower.includes(n));
            const matchedInName = needleLower.filter(n => haystackName.includes(n.slice(0, 20)));
            const matchedStrings = [...new Set([...matchedInSnippet, ...matchedInName])];
            if (matchedStrings.length === 0) continue;
            scored.push({
                moduleKey: m.id,
                moduleName: m.name,
                matchedStrings,
                missingStrings: needleLower.filter(n => !matchedStrings.includes(n)),
                hitCount: matchedStrings.length,
                sourceSnippet: snippet ? snippet.slice(0, 400) : null,
                sourceTruncated: !!m.data?.sourceTruncated
            });
        }
        scored.sort((a, b) => b.hitCount - a.hitCount);
        const closestCandidates = scored.slice(0, 3);

        return {
            investigatedAt: Date.now(),
            technique: "sourceString:partial-score",
            totalModulesScanned: modules.length,
            modulesWithAnyHit: scored.length,
            closestCandidates,
            summary: closestCandidates.length > 0
                ? `Closest candidate "${closestCandidates[0].moduleName}" (${closestCandidates[0].moduleKey}) matched ${closestCandidates[0].hitCount}/${check.needles.length} needle(s): [${closestCandidates[0].matchedStrings.join(", ")}]. Missing: [${closestCandidates[0].missingStrings.join(", ") || "none"}].`
                : `No module in this snapshot has any needle term in its captured snippet or name — the target module likely wasn't resolved this session at all (lazy-loaded), rather than the fingerprint being wrong.`
        };
    }

    _checkSourceString(check) {
        const modules = this.allEntities.filter(e => e.type === "webpackModule");
        const needleLower = check.needles.map(n => n.toLowerCase());
        const minHits = check.minHits || 1;

        const sourceHits = [];
        for (const m of modules) {
            const snippet = m.data?.sourceSnippet;
            if (!snippet) continue;
            const snippetLower = snippet.toLowerCase();
            const matchedNeedles = needleLower.filter(n => snippetLower.includes(n));
            if (matchedNeedles.length > 0) {
                sourceHits.push({ id: m.id, matchedNeedles });
            }
        }
        const distinctNeedlesFound = new Set(sourceHits.flatMap(h => h.matchedNeedles));
        if (distinctNeedlesFound.size >= minHits) {
            return {
                status: "resolved",
                confidence: "medium",
                matchedVia: sourceHits.map(h => h.id).slice(0, 3),
                note: `Found ${distinctNeedlesFound.size}/${check.needles.length} needle term(s) [${[...distinctNeedlesFound].join(", ")}] present in captured source of ${sourceHits.length} webpackModule entity(ies) (meets minHits: ${minHits}). This confirms the fingerprint's target text still exists in this build — it does not confirm the surrounding code structure ByeBlocked patches is unchanged.`
            };
        }
        if (sourceHits.length > 0) {
            return {
                status: "plausible",
                confidence: "low",
                matchedVia: sourceHits.map(h => h.id).slice(0, 3),
                note: `Found ${distinctNeedlesFound.size}/${check.needles.length} needle term(s) in captured source — below this fingerprint's minHits threshold (${minHits}). Partial match: could mean the fingerprint is degrading, or just that the visible source snippet (truncated) cut off the rest.`,
                investigation: this._investigateSourceString(check, modules, needleLower)
            };
        }

        const needleLowerShort = needleLower.map(n => n.slice(0, 20));
        const nameHits = modules.filter(m => {
            const haystack = `${m.name || ""} ${(m.aliases || []).join(" ")}`.toLowerCase();
            return needleLowerShort.some(n => haystack.includes(n));
        });
        if (nameHits.length > 0) {
            return {
                status: "plausible",
                confidence: "low",
                matchedVia: nameHits.map(h => h.id).slice(0, 3),
                note: `No source-snippet match, but ${nameHits.length} webpackModule entity(ies) have a name/alias echoing this fingerprint's needle terms. Weaker signal than a direct source match — confirm by testing the plugin directly.`,
                investigation: this._investigateSourceString(check, modules, needleLower)
            };
        }
        return {
            status: "cannot_verify",
            confidence: "low",
            matchedVia: null,
            note: "No webpackModule entity in this scan has a captured source snippet or name/alias matching any needle term. This does NOT mean the fingerprint is broken — the target module may not have been resolved (lazy-loaded) this session, or its match sits past the truncated snippet window. Treat as inconclusive, not as a failure.",
            investigation: this._investigateSourceString(check, modules, needleLower)
        };
    }

    _investigateProtoShape(check, modules) {
        const required = check.methods;
        const scored = modules
            .map(m => {
                const proto = m.data.protoMethods || [];
                const overlap = required.filter(name => proto.includes(name));
                return { m, overlap };
            })
            .filter(x => x.overlap.length > 0)
            .sort((a, b) => b.overlap.length - a.overlap.length);

        const closestCandidates = scored.slice(0, 3).map(({ m, overlap }) => ({
            moduleKey: m.id,
            moduleName: m.name,
            matchedMethods: overlap,
            missingMethods: required.filter(name => !overlap.includes(name)),
            fullPrototypeMethodList: (m.data.protoMethods || []).slice(0, 100)
        }));

        return {
            investigatedAt: Date.now(),
            technique: "protoShape:overlap-rank",
            totalModulesScanned: modules.length,
            modulesWithAnyOverlap: scored.length,
            closestCandidates,
            summary: closestCandidates.length > 0
                ? `Closest candidate "${closestCandidates[0].moduleName}" (${closestCandidates[0].moduleKey}) has ${closestCandidates[0].matchedMethods.length}/${required.length} required method(s): [${closestCandidates[0].matchedMethods.join(", ")}]. Missing: [${closestCandidates[0].missingMethods.join(", ")}] — check fullPrototypeMethodList for a plausible rename (e.g. a same-arity method with a similar name).`
                : `No module in this snapshot's captured prototype data shares even one required method — the target module likely wasn't resolved this session at all, rather than the shape being gone.`
        };
    }

    _checkProtoShape(check) {
        const modules = this.allEntities.filter(e => e.type === "webpackModule" && Array.isArray(e.data?.protoMethods));
        const required = check.methods;
        const matches = modules.filter(m => required.every(name => m.data.protoMethods.includes(name)));
        if (matches.length > 0) {
            return {
                status: "resolved",
                confidence: "medium",
                matchedVia: matches.map(m => m.id).slice(0, 3),
                note: `Found ${matches.length} webpackModule entity(ies) exposing all required method(s) [${required.join(", ")}] via own properties or one prototype level. This confirms the shape exists in this build — it does not confirm this is the exact same object ByeBlocked's own lookup resolves to.`
            };
        }
        const partial = modules.filter(m => required.some(name => m.data.protoMethods.includes(name)));
        if (partial.length > 0) {
            return {
                status: "plausible",
                confidence: "low",
                matchedVia: partial.map(m => m.id).slice(0, 3),
                note: `No single entity exposes all required methods [${required.join(", ")}], but ${partial.length} entity(ies) expose at least one. Could mean the shape moved across objects, or that this scan's module coverage (only modules resolved this session) is incomplete.`,
                investigation: this._investigateProtoShape(check, modules)
            };
        }
        return {
            status: "cannot_verify",
            confidence: "low",
            matchedVia: null,
            note: `No webpackModule entity in this scan's captured method-name data exposes any of [${required.join(", ")}]. This does NOT mean the shape is gone — the target module may not have been resolved (lazy-loaded) this session. Treat as inconclusive, not as a failure.`,
            investigation: this._investigateProtoShape(check, modules)
        };
    }

    _investigateStructuralModule(check) {
        const filter = check.filter;
        if (typeof BdApi === "undefined" || !BdApi.Webpack || typeof BdApi.Webpack.getModule !== "function") {
            return {
                investigatedAt: Date.now(),
                technique: "structuralModule:relaxed-filter",
                unavailable: true,
                summary: "Live module lookup (BdApi.Webpack.getModule) unavailable in this environment — cannot relax the filter to find a closest candidate."
            };
        }
        const opts = filter.searchExports ? { searchExports: true } : undefined;
        const requiredAllKeys = filter.keys || [];
        const requiredAnyKeys = filter.keysAny || [];
        const excludeKeys = filter.excludeKeys || [];
        const checkFn = (m, k) => filter.requireFunctions ? (typeof m[k] === "function") : !!m[k];

        const perKeyFindings = [];
        for (const key of [...requiredAllKeys, ...requiredAnyKeys]) {
            try {
                const relaxedFilter = (m) => {
                    if (!m || typeof m !== "object") return false;
                    const otherAllKeys = requiredAllKeys.filter(k => k !== key);
                    if (!otherAllKeys.every(k => checkFn(m, k))) return false;
                    if (excludeKeys.some(k => checkFn(m, k))) return false;
                    return true;
                };
                const found = BdApi.Webpack.getModule(relaxedFilter, opts);
                if (found) {
                    const actualKeys = Object.keys(found).filter(k => typeof found[k] === "function").slice(0, 40);
                    perKeyFindings.push({
                        missingKey: key,
                        foundModuleSatisfiesOthers: true,
                        actualFunctionKeysSample: actualKeys,
                        hasMissingKeyAnyway: !!found[key]
                    });
                }
            } catch (_) {}
        }

        return {
            investigatedAt: Date.now(),
            technique: "structuralModule:relaxed-filter",
            requiredAllKeys,
            requiredAnyKeys,
            excludeKeys,
            perKeyFindings,
            summary: perKeyFindings.length > 0
                ? `Relaxing the filter one key at a time found a module satisfying all OTHER conditions when ignoring "${perKeyFindings[0].missingKey}". Its actual function keys are listed in actualFunctionKeysSample — look there for a renamed equivalent.`
                : `Even relaxing one required key at a time found no candidate module. This suggests either the whole structural pattern moved to a very different module shape, or the module simply hasn't loaded this session (lazy-loaded).`
        };
    }

    _checkStructuralModule(check) {
        if (!check.filter || typeof BdApi === "undefined" || !BdApi.Webpack || typeof BdApi.Webpack.getModule !== "function") {
            return { status: "cannot_verify", confidence: "low", matchedVia: null, note: "Live module lookup unavailable — skip structural module check." };
        }
        const filter = check.filter;
        const buildFilter = () => {
            return (m) => {
                if (!m || typeof m !== "object") return false;
                if (filter.keys) {
                    const checkFn = filter.requireFunctions ? (k => typeof m[k] === "function") : (k => m[k]);
                    if (!filter.keys.every(checkFn)) return false;
                }
                if (filter.keysAny) {
                    const checkFn = filter.requireFunctions ? (k => typeof m[k] === "function") : (k => m[k]);
                    if (!filter.keysAny.some(checkFn)) return false;
                }
                if (filter.excludeKeys) {
                    const checkFn = filter.requireFunctions ? (k => typeof m[k] === "function") : (k => m[k]);
                    if (filter.excludeKeys.some(checkFn)) return false;
                }
                return true;
            };
        };
        try {
            const opts = filter.searchExports ? { searchExports: true } : undefined;
            const found = BdApi.Webpack.getModule(buildFilter(), opts);
            if (found) {
                return {
                    status: "resolved",
                    confidence: "high",
                    matchedVia: "structural-module:live-getModule",
                    note: `Resolved via BdApi.Webpack.getModule matching the described structural pattern.${check.note ? ` ${check.note}` : ""}`
                };
            }
        } catch (_) {}
        return {
            status: "not_resolved",
            confidence: "medium",
            matchedVia: null,
            note: `BdApi.Webpack.getModule did not resolve any module matching the described filter during this scan. This may be a lazy-loaded module (re-scan after navigating to relevant parts of Discord), or the structural pattern may need updating.${check.note ? ` ${check.note}` : ""}`,
            investigation: this._investigateStructuralModule(check)
        };
    }

    _findFiberKey(domNode) {
        try {
            for (const key of Object.keys(domNode)) {
                if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) return key;
            }
        } catch (_) {}
        return null;
    }

    _getFiberForNode(domNode) {
        const key = this._findFiberKey(domNode);
        if (!key) return null;
        try { return domNode[key] || null; } catch (_) { return null; }
    }

    _describeFiberHop(fiber, hopIndex) {
        const type = fiber?.type;
        const isClassComponent = typeof type === "function" && !!type.prototype && !!type.prototype.isReactComponent;
        const hasRender = isClassComponent && typeof type.prototype.render === "function";
        let ownProps = [];
        let stateOwnKeys = [];
        try {
            if (fiber?.memoizedProps && typeof fiber.memoizedProps === "object") {
                ownProps = Object.keys(fiber.memoizedProps).slice(0, 40);
            }
        } catch (_) {}
        try {
            if (fiber?.memoizedState && typeof fiber.memoizedState === "object") {
                stateOwnKeys = Object.keys(fiber.memoizedState).slice(0, 20);
            }
        } catch (_) {}
        let componentName = null;
        try {
            componentName = (typeof type === "function" && (type.displayName || type.name)) || (typeof type === "string" ? type : null);
        } catch (_) {}

        return {
            hop: hopIndex,
            componentName: componentName || null,
            isClassComponent,
            hasRender,
            propsFound: ownProps,
            stateKeysFound: stateOwnKeys
        };
    }

    _checkDomProp(check) {
        if (typeof document === "undefined") {
            return { status: "cannot_verify", confidence: "low", matchedVia: null, note: "No DOM available in this environment — skip domProp check." };
        }
        let node = null;
        try {
            node = document.querySelector(check.selector);
        } catch (err) {
            return { status: "cannot_verify", confidence: "low", matchedVia: null, note: `Invalid or unmatched selector "${check.selector}": ${err && err.message || err}` };
        }
        if (!node) {
            return {
                status: "cannot_verify",
                confidence: "low",
                matchedVia: null,
                note: `No DOM element matched selector "${check.selector}" in this scan. This almost always means the required UI context wasn't open (see requiresContext) rather than the selector being wrong — open the relevant screen and re-scan.`
            };
        }

        const fiber = this._getFiberForNode(node);
        if (!fiber) {
            return {
                status: "cannot_verify",
                confidence: "low",
                matchedVia: null,
                note: `Matched DOM element for "${check.selector}", but no React Fiber key (__reactFiber$* / __reactInternalInstance$*) was found on it. React's internal key prefix may have changed.`
            };
        }

        const maxHops = check.maxHops || 15;
        const expectedProp = check.expectedProp || null;
        const expectedPropAny = check.expectedPropAny || null;
        const hops = [];
        let current = fiber;
        let resolvedHop = null;

        for (let i = 0; i < maxHops && current; i++) {
            const desc = this._describeFiberHop(current, i);
            hops.push(desc);
            const propsHere = desc.propsFound;
            const matchesExpected = expectedProp ? propsHere.includes(expectedProp)
                : expectedPropAny ? expectedPropAny.some(p => propsHere.includes(p))
                : false;
            if (matchesExpected && !resolvedHop) resolvedHop = desc;
            current = current.return;
        }

        if (resolvedHop) {
            return {
                status: "resolved",
                confidence: "medium",
                matchedVia: `dom-fiber:hop-${resolvedHop.hop}:${resolvedHop.componentName || "anonymous"}`,
                note: `Found expected prop(s) at Fiber hop ${resolvedHop.hop} (component: ${resolvedHop.componentName || "anonymous"}, ${resolvedHop.isClassComponent ? "class" : "function"} component) walking up from "${check.selector}". This confirms the prop still flows through this part of the tree — it does not confirm the exact same patch point ByeBlocked targets.`
            };
        }

        return {
            status: "cannot_verify",
            confidence: "low",
            matchedVia: null,
            note: `Walked ${hops.length} Fiber hop(s) up from "${check.selector}" without finding the expected prop(s) [${expectedProp || (expectedPropAny || []).join(", ")}]. This does not confirm the prop is gone — Discord's component tree shape (how many hops, class vs function component) may have shifted; see investigation.domHops for what was actually found at each level.`,
            investigation: {
                investigatedAt: Date.now(),
                technique: "domProp:fiber-walk",
                selector: check.selector,
                domHops: hops,
                summary: hops.length > 0
                    ? `Walked ${hops.length} hop(s). Last hop reached: ${hops[hops.length - 1].componentName || "anonymous"} (${hops[hops.length - 1].isClassComponent ? "class" : "function"} component, hasRender: ${hops[hops.length - 1].hasRender}). None exposed the expected prop(s) — inspect propsFound per hop for a renamed equivalent.`
                    : "No hops were walkable at all — the Fiber tree may be unusually shallow here, or the element matched is not inside a React root."
            }
        };
    }

    async scan() {
        const entities = [];
        const results = [];

        const deferred = [];

        for (const check of this.checks) {
            if (check.kind === "pluginHealthCheck") { deferred.push(check); continue; }
            let result;
            if (check.kind === "storeName") result = this._checkStoreName(check);
            else if (check.kind === "sourceString") result = this._checkSourceString(check);
            else if (check.kind === "protoShape") result = this._checkProtoShape(check);
            else if (check.kind === "structuralModule") result = this._checkStructuralModule(check);
            else if (check.kind === "domProp") result = this._checkDomProp(check);
            else {
                result = { status: "cannot_verify", confidence: "low", matchedVia: null, note: `Unknown check kind "${check.kind}".` };
            }
            results.push({ plugin: check.plugin, label: check.label, kind: check.kind, requiresContext: check.requiresContext || null, ...result });
        }

        for (const check of deferred) {
            const result = this._checkPluginHealthCheck(check, results);
            results.push({ plugin: check.plugin, label: check.label, kind: check.kind, requiresContext: check.requiresContext || null, ...result });
        }

        const byPlugin = {};
        for (const r of results) {
            if (!byPlugin[r.plugin]) {
                byPlugin[r.plugin] = {
                    resolved: 0, not_resolved: 0, plausible: 0, cannot_verify: 0,
                    fallback_renamed: 0, fallback_broken: 0,
                    total: 0
                };
            }
            byPlugin[r.plugin][r.status] = (byPlugin[r.plugin][r.status] || 0) + 1;
            byPlugin[r.plugin].total++;
        }

        const unresolvedStatuses = new Set(["cannot_verify", "not_resolved", "plausible", "fallback_broken"]);
        const pendingByContext = {};
        for (const r of results) {
            if (!r.requiresContext) continue;
            if (!unresolvedStatuses.has(r.status)) continue;
            if (!pendingByContext[r.requiresContext]) pendingByContext[r.requiresContext] = [];
            pendingByContext[r.requiresContext].push({ plugin: r.plugin, label: r.label, status: r.status });
        }
        const pendingContexts = Object.entries(pendingByContext).map(([context, checks]) => ({
            context,
            affectedCheckCount: checks.length,
            checks
        }));

        entities.push(makeEntity({
            id: "compatibility:report",
            type: "compatibility",
            name: "CompatibilityReport",
            aliases: [],
            discoveredVia: "entity-cross-reference:declared-checks",
            confidence: "high",
            confidenceReason: "Each check's status is derived directly from entities already present in this snapshot — no speculation beyond what's stated in each result's own note.",
            data: {
                summaryByPlugin: byPlugin,
                checks: results,
                pendingContexts
            }
        }));

        const brokenStatuses = new Set(["not_resolved", "fallback_broken"]);
        const brokenResults = results.filter(r => brokenStatuses.has(r.status));
        const brokenCount = brokenResults.length;
        const brokenLabels = brokenResults.map(r => r.label);

        const renamedResults = results.filter(r => r.status === "fallback_renamed");
        const renamedCount = renamedResults.length;
        const renamedLabels = renamedResults.map(r => r.label);

        const logLevel = brokenCount > 0 ? "warn" : (renamedCount > 0 ? "warn" : "info");
        let message = `ran ${results.length} compatibility check(s) across ${Object.keys(byPlugin).length} plugin(s) — ${brokenCount} not resolved: [${brokenLabels.join(", ")}]`;
        if (renamedCount > 0) {
            message += ` — ${renamedCount} resolved via fallback but method(s) renamed (update needed, not urgent): [${renamedLabels.join(", ")}]`;
        }
        if (pendingContexts.length > 0) {
            message += ` — ${pendingContexts.length} context(s) needed for deeper investigation: [${pendingContexts.map(p => `${p.context} (${p.affectedCheckCount})`).join(", ")}]`;
        }
        this.logger.log(this.moduleName, message, logLevel);
        return entities;
    }
}
class class_Probe {
    constructor() {
        this.pluginName = "Probe";
        this.logger = new ScannerLogger("Probe");
        this.runner = new ModuleRunner(this.logger);
        this.webpackBootstrap = new WebpackBootstrap(this.logger);
        this.lastSnapshot = null;

        this.webpackScanDepth = "light";
        this.webpackDeepScanModuleIds = new Set();

        this._webpackLiveValues = [];
        this._allEntities = [];

        this._autoCheckIntervalMs = 5 * 60 * 1000;
        this._autoCheckTimer = null;
        this._autoScanInFlight = false;
    }

    _provideWebpackEntities() {
        return this._webpackLiveValues;
    }

    start() {
        this.logger.log("core", "plugin started.");
        this._startAutoCheck();
    }

    stop() {
        this._stopAutoCheck();
        this.logger.log("core", "plugin stopped.");
    }

    _peekBuildNumber() {
        try {
            return (window?.GLOBAL_ENV?.RELEASE_CHANNEL && window?.GLOBAL_ENV?.BUILD_NUMBER)
                ? `${window.GLOBAL_ENV.RELEASE_CHANNEL}-${window.GLOBAL_ENV.BUILD_NUMBER}`
                : null;
        } catch (_) {
            return null;
        }
    }

    _startAutoCheck() {
        this._stopAutoCheck();
        const poll = async () => {
            if (this._autoScanInFlight) return;
            const liveBuild = this._peekBuildNumber();
            if (!liveBuild) return;
            const lastKnown = this.lastSnapshot?.discordBuildNumber ?? this.loadLastSnapshot()?.discordBuildNumber;
            if (lastKnown === liveBuild) return;
            this._autoScanInFlight = true;
            try {
                this.logger.log("core", `build change detected (${lastKnown || "none"} → ${liveBuild}) — running compatibility check automatically.`, "info");
                const snapshot = await this.runFullScan();
                this._notifyIfBroken(snapshot);
            } catch (err) {
                this.logger.log("core", `auto-triggered scan failed: ${err && err.message || err}`, "error");
            } finally {
                this._autoScanInFlight = false;
            }
        };
        this._autoCheckTimer = setInterval(poll, this._autoCheckIntervalMs);
        setTimeout(poll, 15000);
    }

    _stopAutoCheck() {
        if (this._autoCheckTimer) {
            clearInterval(this._autoCheckTimer);
            this._autoCheckTimer = null;
        }
    }

    _notifyIfBroken(snapshot) {
        try {
            const compat = snapshot.entities.find(e => e.type === "compatibility");
            if (!compat) return;
            const diff = snapshot.compatibilityDiff;
            const brokenNow = (compat.data.checks || []).filter(c => c.status === "not_resolved" || c.status === "fallback_broken");
            if (brokenNow.length > 0) {
                BdApi.UI.showToast(
                    `Probe: Discord update broke ${brokenNow.length} ByeBlocked check(s) — ${brokenNow.map(c => c.label).slice(0, 3).join(", ")}${brokenNow.length > 3 ? "…" : ""}`,
                    { type: "error", timeout: 10000 }
                );
            } else if (diff && diff.hasPreviousScan && diff.changedChecks.length > 0) {
                BdApi.UI.showToast(`Probe: Discord updated — compatibility re-checked, all still resolved.`, { type: "success" });
            }
        } catch (_) {}
    }

    _buildModuleList() {
        const webpackScanner = new WebpackScanner({
            bootstrap: this.webpackBootstrap,
            logger: this.logger,
            scanDepth: this.webpackScanDepth,
            deepScanModuleIds: this.webpackDeepScanModuleIds,
            liveValueCallback: (values) => {
                this._webpackLiveValues = values;
            }
        });

        const storeScanner = new StoreScanner({
            logger: this.logger,
            bootstrap: this.webpackBootstrap,
            webpackEntitiesProvider: () => this._provideWebpackEntities()
        });

        const compatibility = new CompatibilityModule({
            logger: this.logger,
            allEntities: this._allEntities
        });

        return [webpackScanner, storeScanner, compatibility];
    }

    async findMissingModules(onProgress) {
        const startedAt = Date.now();
        this.webpackBootstrap.getRequire(true);

        const currentChecks = this.lastSnapshot?.entities?.find(e => e.type === "compatibility")?.data?.checks
            || this.loadLastSnapshot()?.entities?.find(e => e.type === "compatibility")?.data?.checks
            || [];

        const finder = new ModuleFinder({
            logger: this.logger,
            bootstrap: this.webpackBootstrap,
            checks: COMPATIBILITY_CHECKS
        });

        const result = await finder.find(currentChecks, onProgress);
        this.logger.log("core", `findMissingModules: found ${result.candidatesFound} candidate(s) in ${Date.now() - startedAt}ms (read-only — nothing executed).`);
        return result;
    }

    async runFullScan() {
        const startedAt = Date.now();

        const freshRequire = this.webpackBootstrap.getRequire(true);
        const resolvedCount = freshRequire && freshRequire.c ? Object.keys(freshRequire.c).length : 0;
        const factoryCount = freshRequire && freshRequire.m ? Object.keys(freshRequire.m).length : 0;
        this.logger.log("core", `scan start — wpRequire: ${resolvedCount} resolved modules, ${factoryCount} factories.`, "info");

        const previousSnapshot = this.loadLastSnapshot();

        const [webpackScanner, storeScanner, compatibility] = this._buildModuleList();
        const allEntities = [];
        const moduleStats = [];

        for (const mod of [webpackScanner, storeScanner]) {
            const { entities, stats } = await this.runner.run(mod);
            allEntities.push(...entities);
            moduleStats.push(stats);
        }
        this._allEntities = allEntities;

        compatibility.setEntities(allEntities);
        const { entities: compatEntities, stats: compatStats } = await this.runner.run(compatibility);
        allEntities.push(...compatEntities);
        moduleStats.push(compatStats);

        const buildNumber = this._detectBuildNumber();
        const compatibilityDiff = this._diffAgainstPrevious(allEntities, previousSnapshot, buildNumber);
        const snapshot = {
            schemaVersion: "0.3.2",
            capturedAt: startedAt,
            discordBuildNumber: buildNumber,
            entities: allEntities,
            moduleStats,
            summary: this._buildSummary(allEntities, moduleStats),
            compatibilityDiff
        };

        this._allEntities = allEntities;
        this.lastSnapshot = snapshot;
        this._persistSnapshot(snapshot);

        const overallStats = this._computeOverallStats(snapshot);
        if (compatibilityDiff.hasPreviousScan && compatibilityDiff.changedChecks.length > 0) {
            this.logger.log("core",
                `scan complete: ${allEntities.length} entity(ies) in ${Date.now() - startedAt}ms — Compatibility: ${overallStats.overall} — ` +
                `${compatibilityDiff.changedChecks.length} check(s) changed status since last scan: ` +
                `${compatibilityDiff.changedChecks.map(c => `${c.label} (${c.before}→${c.after})`).join(", ")}`,
                "warn");
        } else {
            this.logger.log("core", `scan complete: ${allEntities.length} entity(ies) in ${Date.now() - startedAt}ms — Compatibility: ${overallStats.overall} — status unchanged since last scan.`);
        }
        return snapshot;
    }

    _diffAgainstPrevious(currentEntities, previousSnapshot, currentBuildNumber) {
        if (!previousSnapshot || !Array.isArray(previousSnapshot.entities)) {
            return { hasPreviousScan: false, changedChecks: [], matchedViaDrifts: [], newStores: [], missingStores: [] };
        }

        const prevCompat = previousSnapshot.entities.find(e => e.type === "compatibility");
        const currCompat = currentEntities.find(e => e.type === "compatibility");
        const changedChecks = [];
        const matchedViaDrifts = [];
        if (prevCompat && currCompat) {
            const prevByLabel = Object.create(null);
            for (const c of prevCompat.data.checks || []) prevByLabel[`${c.plugin}::${c.label}`] = c;
            for (const c of currCompat.data.checks || []) {
                const key = `${c.plugin}::${c.label}`;
                const prev = prevByLabel[key];
                if (prev && prev.status !== c.status) {
                    changedChecks.push({ plugin: c.plugin, label: c.label, before: prev.status, after: c.status });
                } else if (
                    prev && prev.status === "resolved" && c.status === "resolved" &&
                    prev.matchedVia && c.matchedVia && prev.matchedVia !== c.matchedVia
                ) {
                    matchedViaDrifts.push({ plugin: c.plugin, label: c.label, before: prev.matchedVia, after: c.matchedVia });
                }
            }
        }

        const prevStoreEntities = previousSnapshot.entities.filter(e => e.type === "store");
        const currStoreEntities = currentEntities.filter(e => e.type === "store");
        const prevStores = new Set(prevStoreEntities.map(e => e.name));
        const currStores = currStoreEntities.map(e => e.name);
        const currStoresSet = new Set(currStores);
        const newStores = currStores.filter(n => !prevStores.has(n));
        const missingStores = [...prevStores].filter(n => !currStoresSet.has(n));

        const structuralChanges = [];
        const buildChanged = !!previousSnapshot.discordBuildNumber && !!currentBuildNumber
            && previousSnapshot.discordBuildNumber !== currentBuildNumber;
        if (buildChanged) {
            const prevByName = new Map(prevStoreEntities.map(e => [e.name, e]));
            const currByName = new Map(currStoreEntities.map(e => [e.name, e]));
            const allNames = new Set([...prevByName.keys(), ...currByName.keys()]);
            for (const name of allNames) {
                const prev = prevByName.get(name);
                const curr = currByName.get(name);
                if (!prev || !curr) {
                    continue;
                }
                const prevMethods = new Set(prev.data?.methodNames || []);
                const currMethods = new Set(curr.data?.methodNames || []);
                if (prevMethods.size === 0 && currMethods.size === 0) {
                    structuralChanges.push({ name, status: "not_observed", note: "No method-name data captured in either scan for this store." });
                    continue;
                }
                const added = [...currMethods].filter(m => !prevMethods.has(m));
                const removed = [...prevMethods].filter(m => !currMethods.has(m));
                if (added.length === 0 && removed.length === 0) {
                    structuralChanges.push({ name, status: "unchanged" });
                } else {
                    structuralChanges.push({ name, status: "changed", added, removed });
                }
            }
        }

        return {
            hasPreviousScan: true,
            previousScanCapturedAt: previousSnapshot.capturedAt,
            previousBuildNumber: previousSnapshot.discordBuildNumber || null,
            buildChanged,
            changedChecks,
            matchedViaDrifts,
            newStores,
            missingStores,
            structuralChanges
        };
    }

    _detectBuildNumber() {
        try {
            return (window?.GLOBAL_ENV?.RELEASE_CHANNEL && window?.GLOBAL_ENV?.BUILD_NUMBER)
                ? `${window.GLOBAL_ENV.RELEASE_CHANNEL}-${window.GLOBAL_ENV.BUILD_NUMBER}`
                : null;
        } catch (_) {
            return null;
        }
    }

    _buildSummary(entities, moduleStats) {
        const byType = {};
        for (const e of entities) {
            byType[e.type] = (byType[e.type] || 0) + 1;
        }
        const byConfidence = { high: 0, medium: 0, low: 0 };
        for (const e of entities) {
            if (byConfidence[e.confidence] !== undefined) byConfidence[e.confidence]++;
        }
        const compatEntity = entities.find(e => e.type === "compatibility");
        return {
            totalEntities: entities.length,
            byType,
            byConfidence,
            modulesRun: moduleStats.length,
            modulesOk: moduleStats.filter(s => s.status === "ok").length,
            modulesError: moduleStats.filter(s => s.status === "error").length,
            modules: moduleStats.map(s => ({
                name: s.moduleName,
                status: s.status,
                entities: s.entitiesFound,
                durationMs: s.durationMs,
                errors: s.errors.length > 0 ? s.errors : undefined
            })),
            compatibilitySummary: compatEntity ? compatEntity.data.summaryByPlugin : null,
            scanCoverageNote: "Partial scan: only webpack modules already resolved in this session are captured. CompatibilityModule falls back to a live BdApi.Webpack lookup for anything missing from the snapshot, so this gap matters less here than it would for a full structural map — but navigating through more of the app before re-scanning still helps."
        };
    }

    _persistSnapshot(snapshot) {
        try {
            BdApi.Data.save(this.pluginName, "lastSnapshot", snapshot);
        } catch (err) {
            this.logger.log("core", `failed to persist snapshot: ${err && err.message || err}`, "warn");
        }
        this._appendToCheckHistory(snapshot);
    }

    static get MAX_CHECK_HISTORY_ENTRIES() { return 30; }

    _appendToCheckHistory(snapshot) {
        try {
            const compat = snapshot.entities.find(e => e.type === "compatibility");
            if (!compat) return;
            const record = {
                capturedAt: snapshot.capturedAt,
                discordBuildNumber: snapshot.discordBuildNumber || null,
                checks: (compat.data.checks || []).map(c => ({
                    plugin: c.plugin,
                    label: c.label,
                    status: c.status,
                    matchedVia: c.matchedVia || null
                }))
            };
            const history = this._loadCheckHistory();
            history.push(record);
            while (history.length > class_Probe.MAX_CHECK_HISTORY_ENTRIES) history.shift();
            BdApi.Data.save(this.pluginName, "checkHistory", history);
        } catch (err) {
            this.logger.log("core", `failed to append check history: ${err && err.message || err}`, "warn");
        }
    }

    _loadCheckHistory() {
        try {
            const history = BdApi.Data.load(this.pluginName, "checkHistory");
            return Array.isArray(history) ? history : [];
        } catch (_) {
            return [];
        }
    }

    _summarizeCheckHistory(label, plugin) {
        const history = this._loadCheckHistory();
        const relevant = [];
        for (const record of history) {
            const found = (record.checks || []).find(c => c.plugin === plugin && c.label === label);
            if (found) relevant.push({ capturedAt: record.capturedAt, status: found.status, matchedVia: found.matchedVia });
        }
        const observed = relevant.filter(r => r.status !== "cannot_verify");
        const unhealthy = observed.filter(r => r.status === "not_resolved" || r.status === "fallback_broken");
        const distinctMatchedVia = [...new Set(observed.map(r => r.matchedVia).filter(Boolean))];
        return {
            scansConsidered: relevant.length,
            scansObserved: observed.length,
            unhealthyCount: unhealthy.length,
            distinctMatchedVia,
            matchedViaDrift: distinctMatchedVia.length > 1
        };
    }

    loadLastSnapshot() {
        try {
            return BdApi.Data.load(this.pluginName, "lastSnapshot") || null;
        } catch (_) {
            return null;
        }
    }

    exportSnapshotAsFile(snapshot) {
        try {
            const data = snapshot || this.lastSnapshot;
            if (!data) {
                BdApi.UI.showToast("No snapshot available — run a scan first.", { type: "warn" });
                return;
            }
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const stamp = new Date(data.capturedAt).toISOString().replace(/[:.]/g, "-");
            a.href = url;
            a.download = `Probe-scan_${stamp}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            BdApi.UI.showToast("Snapshot exported.", { type: "success" });
        } catch (err) {
            this.logger.log("core", `failed to export: ${err && err.message || err}`, "error");
            BdApi.UI.showToast("Failed to export snapshot — check the console.", { type: "error" });
        }
    }


    _styleButton(btn, variant = "secondary") {
        btn.style.padding = "6px 12px";
        btn.style.borderRadius = "4px";
        btn.style.border = "none";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "13px";
        btn.style.fontWeight = "500";
        if (variant === "primary") {
            btn.style.background = "var(--brand-experiment, #5865f2)";
            btn.style.color = "#fff";
        } else {
            btn.style.background = "var(--background-modifier-selected, #3a3c43)";
            btn.style.color = "var(--text-normal)";
        }
    }

    _statusColor(status) {
        switch (status) {
            case "resolved": return "#3ba55c";
            case "plausible": return "#faa61a";
            case "cannot_verify": return "#949cf7";
            case "fallback_renamed": return "#faa61a";
            case "fallback_broken": return "#ed4245";
            case "not_resolved": return "#ed4245";
            default: return "var(--text-normal)";
        }
    }

    _computeOverallStats(snapshot) {
        const compatEntities = (snapshot?.entities || []).filter(e => e.type === "compatibility");
        const totals = { total: 0, resolved: 0, failed: 0, warnings: 0, contextsMissing: 0 };
        for (const ce of compatEntities) {
            for (const counts of Object.values(ce.data.summaryByPlugin || {})) {
                totals.total += counts.total || 0;
                totals.resolved += counts.resolved || 0;
                totals.failed += (counts.not_resolved || 0) + (counts.fallback_broken || 0);
                totals.warnings += (counts.fallback_renamed || 0) + (counts.plausible || 0);
                totals.contextsMissing += counts.cannot_verify || 0;
            }
        }
        const totalScanTimeMs = (snapshot?.moduleStats || []).reduce((sum, s) => sum + (s.durationMs || 0), 0);
        const overall = totals.failed > 0 ? "FAIL" : totals.warnings > 0 ? "WARN" : "PASS";
        return { ...totals, totalScanTimeMs, overall };
    }

    _buildFindResultBlock(result) {
        const box = document.createElement("div");
        box.style.padding = "8px 10px";
        box.style.marginBottom = "10px";
        box.style.borderRadius = "4px";
        box.style.background = "var(--background-modifier-accent)";
        box.style.fontSize = "12px";

        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.marginBottom = "4px";
        title.textContent = `${result.candidatesFound} unresolved module(s) mention pending-check terms (read-only — none executed):`;
        box.appendChild(title);

        const hint = document.createElement("div");
        hint.style.opacity = "0.7";
        hint.style.marginBottom = "6px";
        hint.textContent = "Open the Discord screen where the matching feature lives, then re-run the compatibility check — that lets the module load normally instead of being forced.";
        box.appendChild(hint);

        for (const c of result.candidates.slice(0, 20)) {
            const line = document.createElement("div");
            line.style.marginBottom = "2px";
            line.style.fontFamily = "monospace";
            line.textContent = `#${c.id} — matches: [${c.matchedTerms.join(", ")}]`;
            box.appendChild(line);
        }
        if (result.candidates.length > 20) {
            const more = document.createElement("div");
            more.style.opacity = "0.6";
            more.style.marginTop = "4px";
            more.textContent = `...and ${result.candidates.length - 20} more (export the full snapshot to see all).`;
            box.appendChild(more);
        }
        return box;
    }

    _buildOverallSummaryBlock(snapshot) {
        const stats = this._computeOverallStats(snapshot);
        const box = document.createElement("div");
        box.style.padding = "10px 12px";
        box.style.marginBottom = "10px";
        box.style.borderRadius = "4px";
        box.style.background = "var(--background-secondary)";
        box.style.fontSize = "12px";

        const topRow = document.createElement("div");
        topRow.style.display = "flex";
        topRow.style.justifyContent = "space-between";
        topRow.style.alignItems = "center";
        topRow.style.marginBottom = "6px";

        const overallLabel = document.createElement("div");
        overallLabel.style.fontWeight = "700";
        overallLabel.style.fontSize = "14px";
        overallLabel.style.color = stats.overall === "FAIL" ? this._statusColor("not_resolved")
            : stats.overall === "WARN" ? this._statusColor("plausible")
            : this._statusColor("resolved");
        overallLabel.textContent = `Compatibility: ${stats.overall}`;
        topRow.appendChild(overallLabel);

        const timeLabel = document.createElement("div");
        timeLabel.style.opacity = "0.7";
        timeLabel.textContent = `Scan time: ${stats.totalScanTimeMs}ms`;
        topRow.appendChild(timeLabel);

        box.appendChild(topRow);

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(90px, 1fr))";
        grid.style.gap = "4px";
        const cells = [
            ["Checks", `${stats.resolved} / ${stats.total}`, null],
            ["Resolved", String(stats.resolved), this._statusColor("resolved")],
            ["Failed", String(stats.failed), stats.failed > 0 ? this._statusColor("not_resolved") : null],
            ["Warnings", String(stats.warnings), stats.warnings > 0 ? this._statusColor("plausible") : null],
            ["Contexts missing", String(stats.contextsMissing), null]
        ];
        for (const [label, value, color] of cells) {
            const cell = document.createElement("div");
            const valEl = document.createElement("div");
            valEl.style.fontWeight = "600";
            valEl.style.fontSize = "13px";
            if (color) valEl.style.color = color;
            valEl.textContent = value;
            const labelEl = document.createElement("div");
            labelEl.style.opacity = "0.6";
            labelEl.style.fontSize = "10px";
            labelEl.textContent = label;
            cell.appendChild(valEl);
            cell.appendChild(labelEl);
            grid.appendChild(cell);
        }
        box.appendChild(grid);
        return box;
    }

    _buildChecksList(snapshot) {
        const wrap = document.createElement("div");
        const compatEntity = snapshot?.entities?.find(e => e.type === "compatibility");
        if (!compatEntity) {
            wrap.textContent = "No compatibility data in this snapshot. Run a scan.";
            wrap.style.opacity = "0.7";
            return wrap;
        }

        wrap.appendChild(this._buildOverallSummaryBlock(snapshot));

        const diff = snapshot.compatibilityDiff;
        if (diff && diff.hasPreviousScan && (diff.changedChecks.length > 0 || (diff.matchedViaDrifts || []).length > 0 || diff.newStores.length > 0 || diff.missingStores.length > 0)) {
            const diffBox = document.createElement("div");
            diffBox.style.padding = "8px 10px";
            diffBox.style.marginBottom = "10px";
            diffBox.style.borderRadius = "4px";
            diffBox.style.background = "var(--background-modifier-accent)";
            diffBox.style.fontSize = "12px";
            const diffTitle = document.createElement("div");
            diffTitle.style.fontWeight = "600";
            diffTitle.style.marginBottom = "4px";
            diffTitle.textContent = `Changed since last scan (${new Date(diff.previousScanCapturedAt).toLocaleString("en-US")}):`;
            diffBox.appendChild(diffTitle);
            for (const c of diff.changedChecks) {
                const line = document.createElement("div");
                line.style.color = this._statusColor(c.after);
                line.textContent = `${c.plugin}: ${c.label} — ${c.before} → ${c.after}`;
                diffBox.appendChild(line);
            }
            for (const d of (diff.matchedViaDrifts || [])) {
                const line = document.createElement("div");
                line.style.color = this._statusColor("plausible");
                line.textContent = `${d.plugin}: ${d.label} — still resolved, but via a different match than last scan (${d.before} → ${d.after}). Possible early sign of an in-progress rename.`;
                diffBox.appendChild(line);
            }
            if (diff.missingStores.length > 0) {
                const line = document.createElement("div");
                line.style.color = this._statusColor("not_resolved");
                line.textContent = `Store(s) no longer found: ${diff.missingStores.join(", ")}`;
                diffBox.appendChild(line);
            }
            if (diff.newStores.length > 0) {
                const line = document.createElement("div");
                line.style.opacity = "0.8";
                line.textContent = `New store(s) resolved this scan: ${diff.newStores.join(", ")}`;
                diffBox.appendChild(line);
            }
            wrap.appendChild(diffBox);
        }

        if (diff && diff.buildChanged && Array.isArray(diff.structuralChanges) && diff.structuralChanges.length > 0) {
            const buildBox = document.createElement("div");
            buildBox.style.padding = "8px 10px";
            buildBox.style.marginBottom = "10px";
            buildBox.style.borderRadius = "4px";
            buildBox.style.background = "var(--background-modifier-accent)";
            buildBox.style.fontSize = "12px";
            const buildTitle = document.createElement("div");
            buildTitle.style.fontWeight = "600";
            buildTitle.style.marginBottom = "4px";
            buildTitle.textContent = `Build changed (${diff.previousBuildNumber || "unknown"} → ${snapshot.discordBuildNumber || "unknown"}) — per-store structural comparison:`;
            buildBox.appendChild(buildTitle);
            const order = { changed: 0, unchanged: 1, not_observed: 2 };
            const sortedChanges = [...diff.structuralChanges].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
            for (const sc of sortedChanges) {
                const line = document.createElement("div");
                line.style.marginBottom = "2px";
                if (sc.status === "changed") {
                    line.style.color = this._statusColor("not_resolved");
                    const addedTxt = sc.added.length > 0 ? ` +[${sc.added.join(", ")}]` : "";
                    const removedTxt = sc.removed.length > 0 ? ` -[${sc.removed.join(", ")}]` : "";
                    line.textContent = `${sc.name}: changed${addedTxt}${removedTxt}`;
                } else if (sc.status === "unchanged") {
                    line.style.opacity = "0.6";
                    line.textContent = `${sc.name}: unchanged`;
                } else {
                    line.style.opacity = "0.5";
                    line.style.fontStyle = "italic";
                    line.textContent = `${sc.name}: not observed in one of the two scans (lazy-loaded — not a finding)`;
                }
                buildBox.appendChild(line);
            }
            wrap.appendChild(buildBox);
        }

        const { summaryByPlugin, checks, pendingContexts } = compatEntity.data;

        if (Array.isArray(pendingContexts) && pendingContexts.length > 0) {
            const ctxBox = document.createElement("div");
            ctxBox.style.padding = "8px 10px";
            ctxBox.style.marginBottom = "10px";
            ctxBox.style.borderRadius = "4px";
            ctxBox.style.background = "var(--background-modifier-accent)";
            ctxBox.style.fontSize = "12px";
            const ctxTitle = document.createElement("div");
            ctxTitle.style.fontWeight = "600";
            ctxTitle.style.marginBottom = "4px";
            ctxTitle.textContent = `${pendingContexts.length} scenario(s) needed for deeper investigation — open these, then re-scan:`;
            ctxBox.appendChild(ctxTitle);
            for (const p of pendingContexts) {
                const line = document.createElement("div");
                line.style.marginBottom = "2px";
                line.textContent = `${p.context} — affects ${p.affectedCheckCount} check(s): ${p.checks.map(c => c.label).join(", ")}`;
                ctxBox.appendChild(line);
            }
            wrap.appendChild(ctxBox);
        }

        for (const [plugin, counts] of Object.entries(summaryByPlugin || {})) {
            const header = document.createElement("div");
            header.style.fontWeight = "600";
            header.style.marginBottom = "6px";
            header.style.marginTop = "10px";
            const brokenTotal = (counts.not_resolved || 0) + (counts.fallback_broken || 0);
            const warnTotal = (counts.fallback_renamed || 0) + (counts.plausible || 0);
            const unverifiedTotal = counts.cannot_verify || 0;
            header.textContent = brokenTotal > 0
                ? `${plugin} — ${brokenTotal} check(s) BROKEN`
                : warnTotal > 0
                    ? `${plugin} — ${warnTotal} check(s) need attention`
                    : unverifiedTotal > 0
                        ? `${plugin} — ${counts.resolved} of ${counts.total} checks resolved (${unverifiedTotal} inconclusive — see cannot_verify below)`
                        : `${plugin} — all ${counts.total} checks resolved`;
            header.style.color = brokenTotal > 0 ? this._statusColor("not_resolved")
                : warnTotal > 0 ? this._statusColor("plausible")
                : unverifiedTotal > 0 ? this._statusColor("cannot_verify")
                : this._statusColor("resolved");
            wrap.appendChild(header);
        }

        const priority = { not_resolved: 0, fallback_broken: 1, fallback_renamed: 2, plausible: 3, cannot_verify: 4, resolved: 5 };
        const sorted = [...(checks || [])].sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));

        const list = document.createElement("div");
        list.style.marginTop = "8px";
        for (const check of sorted) {
            const row = document.createElement("div");
            row.style.padding = "6px 8px";
            row.style.borderLeft = `3px solid ${this._statusColor(check.status)}`;
            row.style.marginBottom = "4px";
            row.style.background = "var(--background-secondary)";
            row.style.fontSize = "12px";

            const title = document.createElement("div");
            title.style.fontWeight = "600";
            title.textContent = `[${check.status}] ${check.plugin}: ${check.label}`;
            row.appendChild(title);

            const hist = this._summarizeCheckHistory(check.label, check.plugin);
            if (hist.scansObserved >= 2) {
                const histLine = document.createElement("div");
                histLine.style.fontSize = "11px";
                histLine.style.marginTop = "2px";
                histLine.style.opacity = "0.75";
                const parts = [];
                if (hist.unhealthyCount > 0) {
                    histLine.style.opacity = "1";
                    histLine.style.color = this._statusColor("plausible");
                    parts.push(`unhealthy in ${hist.unhealthyCount} of the last ${hist.scansObserved} observed scan(s)`);
                } else {
                    parts.push(`healthy in all ${hist.scansObserved} of the last observed scans`);
                }
                if (hist.matchedViaDrift) {
                    histLine.style.opacity = "1";
                    histLine.style.color = this._statusColor("plausible");
                    parts.push(`resolved via ${hist.distinctMatchedVia.length} different matches recently (possible drift)`);
                }
                histLine.textContent = `History: ${parts.join(" — ")}.`;
                row.appendChild(histLine);
            }

            if (check.investigation?.verdict && check.investigation.verdict !== "unknown") {
                const verdictTag = document.createElement("div");
                verdictTag.style.marginTop = "3px";
                verdictTag.style.display = "inline-block";
                verdictTag.style.padding = "2px 6px";
                verdictTag.style.borderRadius = "3px";
                verdictTag.style.fontSize = "11px";
                verdictTag.style.fontWeight = "600";
                if (check.investigation.verdict === "likely_discord_change") {
                    verdictTag.style.background = "rgba(237, 66, 69, 0.15)";
                    verdictTag.style.color = this._statusColor("not_resolved");
                    verdictTag.textContent = "⚠ Likely Discord update broke this";
                } else {
                    verdictTag.style.background = "rgba(250, 166, 26, 0.15)";
                    verdictTag.style.color = this._statusColor("plausible");
                    verdictTag.textContent = "🔧 Likely a ByeBlocked-side bug";
                }
                row.appendChild(verdictTag);
            }

            if (check.note) {
                const note = document.createElement("div");
                note.style.opacity = "0.75";
                note.style.marginTop = "2px";
                note.textContent = check.note;
                row.appendChild(note);
            }

            if (check.requiresContext) {
                const ctxTag = document.createElement("div");
                ctxTag.style.opacity = "0.6";
                ctxTag.style.marginTop = "2px";
                ctxTag.style.fontStyle = "italic";
                ctxTag.textContent = `requires context: ${check.requiresContext}`;
                row.appendChild(ctxTag);
            }

            if (check.investigation) {
                const details = document.createElement("details");
                details.style.marginTop = "4px";

                const summaryRow = document.createElement("summary");
                summaryRow.style.cursor = "pointer";
                summaryRow.style.display = "flex";
                summaryRow.style.alignItems = "center";
                summaryRow.style.justifyContent = "space-between";
                summaryRow.style.gap = "8px";

                const summaryLabel = document.createElement("span");
                summaryLabel.style.color = "var(--text-link, #949cf7)";
                summaryLabel.textContent = "Investigation details";
                summaryRow.appendChild(summaryLabel);

                const copyBtn = document.createElement("button");
                copyBtn.type = "button";
                copyBtn.textContent = "📋 Copy";
                copyBtn.style.fontSize = "11px";
                copyBtn.style.padding = "2px 8px";
                copyBtn.style.borderRadius = "3px";
                copyBtn.style.border = "1px solid var(--background-modifier-accent, #4a4a4a)";
                copyBtn.style.background = "var(--background-secondary, #2b2d31)";
                copyBtn.style.color = "var(--text-normal)";
                copyBtn.style.cursor = "pointer";
                copyBtn.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const payload = {
                        plugin: check.plugin,
                        label: check.label,
                        status: check.status,
                        verdict: check.investigation?.verdict,
                        note: check.note,
                        investigation: check.investigation
                    };
                    let text;
                    try {
                        text = JSON.stringify(payload, null, 2);
                    } catch (_) {
                        text = "(could not serialize investigation data)";
                    }
                    const restoreLabel = () => { copyBtn.textContent = "📋 Copy"; };
                    const onCopyOk = () => { copyBtn.textContent = "✅ Copied!"; setTimeout(restoreLabel, 1500); };
                    const onCopyFail = () => { copyBtn.textContent = "⚠ Copy failed"; setTimeout(restoreLabel, 1500); };
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(onCopyOk).catch(onCopyFail);
                    } else {
                        try {
                            const ta = document.createElement("textarea");
                            ta.value = text;
                            ta.style.position = "fixed";
                            ta.style.opacity = "0";
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand("copy");
                            document.body.removeChild(ta);
                            onCopyOk();
                        } catch (_) {
                            onCopyFail();
                        }
                    }
                };
                summaryRow.appendChild(copyBtn);
                details.appendChild(summaryRow);

                const invSummary = document.createElement("div");
                invSummary.style.marginTop = "4px";
                invSummary.style.opacity = "0.85";
                invSummary.textContent = check.investigation.summary || "";
                details.appendChild(invSummary);

                const pre = document.createElement("pre");
                pre.style.whiteSpace = "pre-wrap";
                pre.style.wordBreak = "break-word";
                pre.style.fontSize = "11px";
                pre.style.marginTop = "4px";
                pre.style.padding = "6px";
                pre.style.background = "var(--background-tertiary, rgba(0,0,0,0.15))";
                pre.style.borderRadius = "3px";
                pre.style.maxHeight = "260px";
                pre.style.overflow = "auto";
                try {
                    pre.textContent = JSON.stringify(check.investigation, null, 2);
                } catch (_) {
                    pre.textContent = "(could not serialize investigation data)";
                }
                details.appendChild(pre);

                row.appendChild(details);
            }
            list.appendChild(row);
        }
        wrap.appendChild(list);
        return wrap;
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.style.padding = "12px";
        panel.style.color = "var(--text-normal)";

        const title = document.createElement("h3");
        const liveVersion = (() => {
            try { return BdApi.Plugins.get("Probe")?.version || null; } catch (_) { return null; }
        })();
        title.textContent = liveVersion ? `Probe v${liveVersion}` : "Probe";
        title.style.marginBottom = "4px";
        panel.appendChild(title);

        const desc = document.createElement("p");
        desc.textContent = "Compatibility check for ByeBlocked";
        desc.style.fontSize = "12px";
        desc.style.opacity = "0.7";
        desc.style.marginBottom = "12px";
        panel.appendChild(desc);

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.gap = "8px";
        btnRow.style.marginBottom = "12px";

        const scanBtn = document.createElement("button");
        scanBtn.textContent = "Run compatibility check";
        this._styleButton(scanBtn, "primary");
        btnRow.appendChild(scanBtn);

        const findBtn = document.createElement("button");
        findBtn.textContent = "🔍 Find missing modules";
        this._styleButton(findBtn, "secondary");
        findBtn.title = "Searches Discord's not-yet-loaded modules for the ones ByeBlocked's pending checks need, and executes only the likely matches (capped per run) instead of requiring you to navigate to that screen manually.";
        btnRow.appendChild(findBtn);

        const exportBtn = document.createElement("button");
        exportBtn.textContent = "Export .json";
        this._styleButton(exportBtn, "secondary");
        exportBtn.onclick = () => this.exportSnapshotAsFile(this._panelSnapshot);
        btnRow.appendChild(exportBtn);

        const copyAllBtn = document.createElement("button");
        copyAllBtn.textContent = "📋 Copy report";
        this._styleButton(copyAllBtn, "secondary");
        copyAllBtn.onclick = () => {
            const snapshot = this._panelSnapshot;
            if (!snapshot) return;
            let text;
            try {
                text = JSON.stringify(snapshot, null, 2);
            } catch (_) {
                text = "(could not serialize snapshot)";
            }
            const restore = () => { copyAllBtn.textContent = "📋 Copy report"; };
            const ok = () => { copyAllBtn.textContent = "✅ Copied!"; setTimeout(restore, 1500); };
            const fail = () => { copyAllBtn.textContent = "⚠ Copy failed"; setTimeout(restore, 1500); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(ok).catch(fail);
            } else {
                try {
                    const ta = document.createElement("textarea");
                    ta.value = text;
                    ta.style.position = "fixed";
                    ta.style.opacity = "0";
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand("copy");
                    document.body.removeChild(ta);
                    ok();
                } catch (_) {
                    fail();
                }
            }
        };
        btnRow.appendChild(copyAllBtn);

        panel.appendChild(btnRow);

        const metaEl = document.createElement("div");
        metaEl.style.fontSize = "11px";
        metaEl.style.opacity = "0.6";
        metaEl.style.marginBottom = "10px";
        panel.appendChild(metaEl);

        const contentEl = document.createElement("div");
        panel.appendChild(contentEl);

        const render = () => {
            this._panelSnapshot = this.lastSnapshot || this.loadLastSnapshot();
            metaEl.textContent = this._panelSnapshot
                ? `Captured at: ${new Date(this._panelSnapshot.capturedAt).toLocaleString("en-US")} — build: ${this._panelSnapshot.discordBuildNumber || "unknown"}`
                : "No scan yet.";
            contentEl.innerHTML = "";
            if (this._lastFindResult && this._lastFindResult.candidatesFound > 0) {
                contentEl.appendChild(this._buildFindResultBlock(this._lastFindResult));
            }
            contentEl.appendChild(this._buildChecksList(this._panelSnapshot));
        };

        scanBtn.onclick = async () => {
            scanBtn.disabled = true;
            scanBtn.textContent = "Scanning...";
            scanBtn.style.opacity = "0.6";
            try {
                await this.runFullScan();
            } catch (err) {
                this.logger.log("core", `scan failed from panel: ${err && err.message || err}`, "error");
                BdApi.UI.showToast(`Scan failed: ${err.message}`, { type: "error" });
            }
            scanBtn.disabled = false;
            scanBtn.textContent = "Run compatibility check";
            scanBtn.style.opacity = "1";
            render();
        };

        findBtn.onclick = async () => {
            findBtn.disabled = true;
            const originalLabel = "🔍 Find missing modules";
            findBtn.textContent = "Searching...";
            findBtn.style.opacity = "0.6";
            try {
                const result = await this.findMissingModules();
                this._lastFindResult = result;
                if (result.candidatesFound === 0) {
                    BdApi.UI.showToast(
                        "No unresolved module looks like a match for the pending checks — they likely need a different Discord screen open (e.g. a voice call, a DM) to load at all. Navigate there, then re-run the compatibility check.",
                        { type: "warn" }
                    );
                } else {
                    BdApi.UI.showToast(
                        `Found ${result.candidatesFound} candidate module(s) that mention the pending checks' terms — see the list below. This is read-only (nothing was executed); open the matching screen in Discord, then re-run the compatibility check to confirm.`,
                        { type: "info" }
                    );
                }
            } catch (err) {
                this.logger.log("core", `findMissingModules failed from panel: ${err && err.message || err}`, "error");
                BdApi.UI.showToast(`Find missing modules failed: ${err.message}`, { type: "error" });
            }
            findBtn.disabled = false;
            findBtn.textContent = originalLabel;
            findBtn.style.opacity = "1";
            render();
        };

        render();
        return panel;
    }
}

module.exports = class_Probe;
