/**
 * @name Probe
 * @author 8ug8ird
 * @authorId 698947564459917343
 * @version 0.4.1
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

function _hashSource(str) {
    if (!str) return null;
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}

function _unwrapReactComponent(v) {
    if (typeof v === "function") return v;
    if (v && typeof v === "object") {
        const typeofTag = v.$$typeof?.toString?.() || "";
        if (typeofTag.includes("react.memo") && typeof v.type === "function") return v.type;
        if (typeofTag.includes("react.forward_ref") && typeof v.render === "function") return v.render;
        for (const nestedKey of ["type", "render", "Component", "default"]) {
            if (typeof v[nestedKey] === "function") return v[nestedKey];
        }
    }
    return null;
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
                this.logger.log(name, "reserved module, not implemented yet - skipped.", "info");
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
            this.logger.log("WebpackBootstrap", `${chunkName} not found on window - Discord may not have loaded yet, or the chunk name changed in this build.`, "warn");
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
            this.logger.log("WebpackBootstrap", "probe chunk did not return a usable wpRequire with a cache (.c) - webpack layout may have changed in this build.", "warn");
            return this._wpRequire;
        }

        const cacheSize = Object.keys(captured.c).length;
        const factorySize = captured.m && typeof captured.m === "object" ? Object.keys(captured.m).length : 0;

        if (cacheSize < WebpackBootstrap.MIN_HEALTHY_CACHE_SIZE) {
            this.logger.log(
                "WebpackBootstrap",
                `capture looks premature (only ${cacheSize} resolved modules, ${factorySize} factories) - Discord probably hasn't finished loading chunks yet. ${this._wpRequire ? "Keeping previous capture." : "No previous capture to fall back on; returning this anyway."}`,
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

        const unwrapped = typeof exportValue === "function" ? exportValue : _unwrapReactComponent(exportValue);
        if (typeof unwrapped === "function") {
            if (this._shouldDeepScan(moduleId)) {
                data.functionSignature = this._buildFunctionSignature(unwrapped);
            }
            try {
                const src = unwrapped.toString();
                const MAX_SNIPPET = 400;
                data.sourceSnippet = src.length > MAX_SNIPPET ? src.slice(0, MAX_SNIPPET) : src;
                data.sourceTruncated = src.length > MAX_SNIPPET;
                data.sourceHash = _hashSource(src);
                if (unwrapped !== exportValue) {
                    data.sourceUnwrappedFrom = exportValue?.$$typeof?.toString?.() || "wrapped-component";
                }
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
            this.logger.log(this.moduleName, "wpRequire unavailable - no modules could be scanned.", "warn");
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
            this.logger.log(this.moduleName, "module factories not found - factory source unavailable (require() extraction for this module will be skipped).", "warn");
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
            this.logger.log(this.moduleName, "BdApi.Webpack.getStore unavailable - skipping known-name lookup phase.", "warn");
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
            this.logger.log(this.moduleName, "no webpackEntitiesProvider configured - skipping structural discovery phase.", "warn");
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
                        const modifies = /\.dispatch\s*\(|\.dispatchAction\s*\(/.test(src) && nameRe.test(src);
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
    { plugin: "ByeBlocked", label: "RelationshipStore", kind: "storeName", candidates: ["RelationshipStore", "RelationshipManagerStore", "RelationshipStoreManager"],
      expectedMethods: ["isBlocked", "isIgnored"],
      note: "expectedMethods reflects ByeBlocked's RELATIONSHIP_METHOD_NAMES groups (isBlocked/isIgnored each have their own name-fallback list ByeBlocked already tries - these two are the anchor names most builds have used historically, used here only to score broad-scan replacement candidates by behavior, not as the only accepted names)." },
    { plugin: "ByeBlocked", label: "GuildMemberStore", kind: "storeName", candidates: ["GuildMemberStore", "MemberStore", "GuildMembersStore"] },
    { plugin: "ByeBlocked", label: "ReactionsStore", kind: "storeName", candidates: ["ReactionsStore", "MessageReactionsStore", "ReactionStore"] },
    { plugin: "ByeBlocked", label: "SortedVoiceStateStore", kind: "storeName", candidates: ["SortedVoiceStateStore", "VoiceStateStore", "SortedVoiceStatesStore"], requiresContext: "voiceCall" },
    { plugin: "ByeBlocked", label: "StageChannelParticipantStore", kind: "storeName", candidates: ["StageChannelParticipantStore", "StageParticipantStore"], requiresContext: "stageChannel" },
    { plugin: "ByeBlocked", label: "StageInstanceStore", kind: "storeName", candidates: ["StageInstanceStore", "StageInstancesStore"], requiresContext: "stageChannel" },
    { plugin: "ByeBlocked", label: "ActivityStore", kind: "storeName", candidates: ["ChannelRTCStore", "ActivityStore", "EmbeddedActivityStore", "ActivityParticipantsStore", "ActivityManagerStore"],
      requiresContext: "voiceCallWithActivity",
      expectedMethods: ["getParticipants", "getActivityParticipants"],
      note: "CORRECTED after reading ByeBlocked's actual source: this.modules.ActivityStore is used to filter PARTICIPANTS of an Activity/Watch-Together inside a voice channel (calls getParticipants()/getActivityParticipants(), guarded by typeof checks - tolerant of missing methods). It is NOT rich-presence/status (that's PresenceStore, unrelated). Confirmed live: none of the original 4 candidates exist in current builds; the real Store is ChannelRTCStore (has getParticipants + getActivityParticipants; getEmbeddedActivityParticipants is gone). Not a hard dependency - ByeBlocked already checks each method with typeof before patching, so once STORE_NAMES.ACTIVITY includes \"ChannelRTCStore\" as a candidate, no other code change is needed."
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
      note: "CORRECTED after reading ByeBlocked's actual source (resolveModules(), ~line 3083): its real fallback checks ChannelStore for ANY of getPrivateChannels/getPrivateChannelIds/getMutablePrivateChannels - not just the first two as previously assumed here.",
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
      note: "Covers the case where the participant card component turned into a bare function component (no prototype methods left to fingerprint via protoShape) - this walks Fiber return pointers looking for the user-identifying prop instead of relying on any class shape." },
    { plugin: "ByeBlocked", label: "Member list row (member userId prop)", kind: "domProp",
      selector: "[class*='member'][role='listitem'], [class*='memberInner']",
      expectedPropAny: ["user", "userId"],
      maxHops: 15,
      requiresContext: "memberListOpen",
      note: "Fiber-walk fallback for the member list row component, used when neither storeName nor protoShape can pin down how a blocked member's identity reaches the row." },
    { plugin: "ByeBlocked", label: "Private channel row component (patchPrivateChannelRowComponent target)", kind: "domProp",
      selector: '[data-list-item-id*="private-channels"][data-list-item-id*="___"]',
      expectedPropAny: ["channel"],
      maxHops: 40,
      note: "Fiber-walk fallback for the group-DM row component, mirroring ByeBlocked's own ROW_SELECTOR and 40-hop Fiber walk in patchPrivateChannelRowComponent() (v2.5.0). This confirms a 'channel' prop reaches this part of the tree - the same structural prerequisite ByeBlocked's patch relies on - but not that the channel is specifically a Group DM (ByeBlocked further checks channel.isGroupDM via looksLikeGroupDmChannel, which this check doesn't replicate). No requiresContext is declared: unlike voice/stage/memberList, 'has at least one Group DM in the channel list' isn't something _detectActiveContexts can reliably signal, and the patch itself is a no-op entirely when settings.places.groupDms is off - cannot_verify is the correct default when there's simply nothing to find, same as how the 'events' health check is documented to no-op when its setting is disabled." },

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
      relatedChecks: ["PrivateChannelStore", "Channel class (isGroupDM/isDM)", "Private channel row component (patchPrivateChannelRowComponent target)"],
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
      note: "Fingerprint for the invite-suggestions module ByeBlocked resolves via _wpGetBySource / source-fingerprint fallback (see resolveInviteQueryModule). Was previously untracked by Probe - ByeBlocked's own 'inviteQueryModule' health check had no relatedChecks to cross-reference against, so a degradation there always diagnosed as 'unknown'." },
    { plugin: "ByeBlocked", label: "Runtime: invite suggestions filtering", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "inviteQueryModule",
      relatedChecks: ["InviteQueryModule (queryFriends/queryDMUsers)"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for the invite-suggestions patch against the structural health of the InviteQueryModule source fingerprint. Only meaningful when settings.places.autocomplete is on; ByeBlocked's own check no-ops otherwise." },

    { plugin: "ByeBlocked", label: "Autocomplete row component (patchAutocompleteRowComponent target)", kind: "sourceString",
      needles: ["autocomplete", "aria-selected", "user", "userId"], minHits: 3,
      note: "Fingerprint for the function ByeBlocked patches via BdApi.Webpack.getWithKey(m => ... AUTOCOMPLETE_TERMS, 3-of-4 match) in patchAutocompleteRowComponent(). Was previously untracked - ByeBlocked's own 'autocompleteRowPatch' health check had no relatedChecks to cross-reference against." },
    { plugin: "ByeBlocked", label: "Runtime: autocomplete row patch", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "autocompleteRowPatch",
      relatedChecks: ["Autocomplete row component (patchAutocompleteRowComponent target)"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for whether the autocomplete-row patch is still attached against the structural health of that component's source fingerprint. Verifies the patch itself is installed, not that filtering is visibly working - pair with a live autocomplete check (type @ in a message box) to confirm end-to-end." },

    { plugin: "ByeBlocked", label: "Forum post card component (patchForumPostComponent target)", kind: "sourceString",
      needles: ["mainCard_", "forumPostItem", "ForumPostCard", "forum-channel-list-"], minHits: 2,
      note: "Fingerprint for the module ByeBlocked patches via looksLikeForumCardFn (2-of-4 match on FORUM_CARD_STRINGS) in patchForumPostComponent(). Was previously untracked - ByeBlocked's own 'forumPostPatch' health check had no relatedChecks to cross-reference against." },
    { plugin: "ByeBlocked", label: "Runtime: forum post card patch", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "forumPostPatch",
      relatedChecks: ["Forum post card component (patchForumPostComponent target)"],
      requiresContext: "forumChannelOpen",
      note: "Cross-references ByeBlocked's own HealthMonitor entry for whether the forum-post-card patch is still attached against the structural health of that component's source fingerprint. Only meaningful in servers using Forum channels - the underlying module can resolve successfully in Webpack (see relatedChecks) well before the patch itself gets a chance to attach, since patchForumPostComponent() only runs meaningfully once a Forum channel's card component actually renders. ByeBlocked's own health check (v2.5.0+) already guards against this by checking for forum DOM markers before considering itself degraded, but requiresContext is declared here too so Probe's own UI groups it correctly." },

    { plugin: "ByeBlocked", label: "Runtime: voice states alt-method filter", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "voiceStatesAltFilter",
      relatedChecks: ["SortedVoiceStateStore"],
      requiresContext: "voiceCall",
      note: "Cross-references ByeBlocked's own HealthMonitor entry for the profile-popout voice-states alt method (patchStores() resolves this dynamically as getVoiceStatesForChannelAlt or an equivalent name via _findVoiceStatesAltMethodName) against the structural health of SortedVoiceStateStore, the store this alt method lives on regardless of its exact name. The method name itself isn't independently fingerprinted since it's resolved dynamically at runtime, not via a fixed candidate list - the store it hangs off of is the meaningful structural anchor here." },

    { plugin: "ByeBlocked", label: "Runtime: message filter effectiveness (raw data check)", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "messageFilterEffectiveness",
      relatedChecks: ["MessageStore"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for whether _filterMessagesCollectionUncached actually removes blocked-author messages from the raw MessageStore data for the current channel, against the structural health of MessageStore itself. Distinct from the 'Runtime: message list filtering' DOM-sampling check: this one inspects the raw pre-render message collection directly, so it can catch a MessageStore data-shape change even before/without any blocked message being visibly rendered on screen. Was previously untracked by Probe - ByeBlocked's own 'messageFilterEffectiveness' health check had no relatedChecks to cross-reference against." },

    { plugin: "ByeBlocked", label: "Runtime: autocomplete filtering (live DOM)", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "autocomplete",
      relatedChecks: ["Autocomplete row component (patchAutocompleteRowComponent target)"],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for whether blocked users are actually hidden from live channel/mention autocomplete rows in the DOM, against the structural health of the autocomplete row component's source fingerprint. Distinct from 'Runtime: autocomplete row patch': that one only verifies the patch is still attached; this one samples up to 40 live [role=\"option\"] rows and verifies none of them belong to a blocked user. Only meaningful when settings.places.autocomplete is on; ByeBlocked's own check no-ops otherwise. Was previously untracked by Probe." },

    { plugin: "ByeBlocked", label: "Runtime: DOM removal guard stability", kind: "pluginHealthCheck",
      sourcePlugin: "ByeBlocked", dataKey: "healthSnapshotForProbe", healthCheckName: "domRemovalGuardSwallowRate",
      relatedChecks: [],
      note: "Cross-references ByeBlocked's own HealthMonitor entry for how often its Node.prototype.removeChild/insertBefore guard has to swallow a NotFoundError to avoid crashing (threshold: 20 swallows per check window) against Probe. No relatedChecks: this guard protects DOM operations across every UI-facing patch in the plugin rather than one specific feature, so there's no single structural module/store it makes sense to cross-reference - Probe will report 'unknown' verdict on a degradation here by design (see _diagnosePluginHealthDegradation), same as ByeBlocked's own inviteQueryModule and autocompleteRowPatch checks did before their relatedChecks were added above. A rising swallow rate is still meaningful on its own: it suggests Discord changed how it reconciles the DOM around elements ByeBlocked is hiding/removing." }
];

function _loadDependencyManifest() {
    try {
        if (typeof BdApi === "undefined" || !BdApi.Data || typeof BdApi.Data.load !== "function") return null;
        const manifest = BdApi.Data.load("ByeBlocked", "dependencyManifest");
        if (!manifest || !Array.isArray(manifest.dependencies)) return null;
        return manifest;
    } catch (_) {
        return null;
    }
}

function buildCompatibilityChecks(logger) {
    const manifest = _loadDependencyManifest();
    if (!manifest) return COMPATIBILITY_CHECKS;

    const manifestByLabel = new Map(manifest.dependencies.map(d => [d.label, d]));
    const mergedLabels = new Set();
    const MERGEABLE_FIELDS = ["kind", "candidates", "filter", "needles", "minHits", "methodFallback", "fuzzyFallback", "requiresContext"];

    const merged = COMPATIBILITY_CHECKS.map(check => {
        const dep = manifestByLabel.get(check.label);
        if (!dep) return check;
        mergedLabels.add(check.label);
        const next = { ...check };
        for (const field of MERGEABLE_FIELDS) {
            if (dep[field] !== undefined) next[field] = dep[field];
        }
        return next;
    });

    const added = [];
    for (const dep of manifest.dependencies) {
        if (mergedLabels.has(dep.label)) continue;
        added.push({ plugin: "ByeBlocked", ...dep, note: dep.note || "Declared in ByeBlocked's DEPENDENCY_MANIFEST, no matching entry in Probe's COMPATIBILITY_CHECKS yet - add relatedChecks/note here once triaged." });
    }

    if (logger && added.length > 0) {
        logger.log("core", `dependency manifest: ${added.length} new check(s) from ByeBlocked not previously tracked: [${added.map(d => d.label).join(", ")}]`, "info");
    }

    return [...merged, ...added];
}

class ModuleFinder {
    constructor(options = {}) {
        this.moduleName = "ModuleFinder";
        this.logger = options.logger;
        this.bootstrap = options.bootstrap;
        this.checks = options.checks || COMPATIBILITY_CHECKS;
    }

    _collectPendingNeedleGroups(currentCheckResults) {
        const resultByLabel = new Map();
        for (const r of currentCheckResults || []) resultByLabel.set(`${r.plugin}::${r.label}`, r.status);

        const groups = [];
        for (const check of this.checks) {
            const key = `${check.plugin}::${check.label}`;
            const status = resultByLabel.get(key);
            if (status === "resolved") continue;
            if (check.kind === "sourceString" && Array.isArray(check.needles)) {
                groups.push({
                    plugin: check.plugin,
                    label: check.label,
                    needles: check.needles,
                    minHits: typeof check.minHits === "number" ? check.minHits : check.needles.length
                });
            } else if (check.kind === "protoShape" && Array.isArray(check.methods)) {
                groups.push({
                    plugin: check.plugin,
                    label: check.label,
                    needles: check.methods,
                    minHits: check.methods.length
                });
            }
        }
        return groups;
    }

    async find(currentCheckResults, onProgress) {
        const wpRequire = this.bootstrap.getRequire();
        const factories = this.bootstrap.getModuleFactories();
        if (!wpRequire || !factories) {
            this.logger.log(this.moduleName, "no wpRequire cache or factory map available - cannot search.", "warn");
            return { searched: 0, candidatesFound: 0, candidates: [] };
        }

        const needleGroups = this._collectPendingNeedleGroups(currentCheckResults);
        if (needleGroups.length === 0) {
            this.logger.log(this.moduleName, "nothing to search for - all checks already resolved.");
            return { searched: 0, candidatesFound: 0, candidates: [] };
        }
        const groupsLower = needleGroups.map(g => ({ ...g, needlesLower: g.needles.map(n => n.toLowerCase()) }));
        const allTermsForLog = [...new Set(groupsLower.flatMap(g => g.needles))];

        const resolvedIds = new Set(Object.keys(wpRequire.c || {}));
        const unresolvedIds = Object.keys(factories).filter(id => !resolvedIds.has(id));
        this.logger.log(this.moduleName, `searching ${unresolvedIds.length} unresolved factory(ies) against ${needleGroups.length} pending check(s), terms: [${allTermsForLog.join(", ")}].`);

        const candidates = [];
        let scanned = 0;
        for (const id of unresolvedIds) {
            scanned++;
            await yieldToUI(scanned, 400);
            try {
                const src = factories[id].toString();
                const srcLower = src.toLowerCase();
                const matchedChecks = [];
                const matchedTermsSet = new Set();
                for (const group of groupsLower) {
                    const hits = group.needlesLower.filter(n => srcLower.includes(n));
                    if (hits.length >= group.minHits) {
                        matchedChecks.push({ plugin: group.plugin, label: group.label, hitCount: hits.length, needed: group.minHits });
                        for (const h of hits) matchedTermsSet.add(h);
                    }
                }
                if (matchedChecks.length > 0) {
                    const matchedTerms = [...matchedTermsSet];
                    candidates.push({
                        id,
                        matchedChecks,
                        matchedTerms,
                        matchedTermCount: matchedTerms.length,
                        sourcePreview: src.length > 200 ? src.slice(0, 200) : src
                    });
                }
            } catch (_) {}
        }
        candidates.sort((a, b) => (b.matchedChecks.length - a.matchedChecks.length) || (b.matchedTermCount - a.matchedTermCount));
        this.logger.log(this.moduleName, `found ${candidates.length} candidate(s) out of ${unresolvedIds.length} unresolved factory(ies) - not executed, per-check minHits match only.`);

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
        this.activeContexts = options.activeContexts instanceof Set ? options.activeContexts : new Set();
        this.historyLookup = typeof options.historyLookup === "function" ? options.historyLookup : null;
    }

    isImplemented() { return true; }

    setEntities(entities) {
        this.allEntities = entities || [];
    }

    static get FEATURE_MAP() {
        return {
            messages: { label: "Messages", tier: "critical", checks: ["messages", "dispatcherPatch"] },
            members: { label: "Member list", tier: "critical", checks: ["members"] },
            groupDms: { label: "Group DMs", tier: "critical", checks: ["groupDms"] },
            voice: { label: "Voice", tier: "important", checks: ["voice", "voiceAudio", "voiceUserComponentPatch"] },
            reactions: { label: "Reactions", tier: "important", checks: ["reactions"] },
            autocomplete: { label: "Autocomplete", tier: "important", checks: ["autocomplete", "autocompleteRowPatch", "inviteQueryModule"] },
            events: { label: "Scheduled events", tier: "optional", checks: ["events"] },
            forum: { label: "Forum posts", tier: "optional", checks: ["forumPostPatch"] },
            profilePopout: { label: "Profile popout (voice states)", tier: "optional", checks: ["voiceStatesAltFilter"] }
        };
    }

    _computeFeatureSummary(results) {
        const byHealthCheckName = new Map();
        for (const r of results) {
            if (r.kind !== "pluginHealthCheck" || !r.healthCheckName) continue;
            byHealthCheckName.set(r.healthCheckName, r);
        }

        const brokenStatuses = new Set(["not_resolved", "fallback_broken"]);
        const features = [];
        const tierCounts = {
            critical: { healthy: 0, total: 0 },
            important: { healthy: 0, total: 0 },
            optional: { healthy: 0, total: 0 }
        };

        for (const [key, def] of Object.entries(CompatibilityModule.FEATURE_MAP)) {
            const subResults = def.checks
                .map(name => byHealthCheckName.get(name))
                .filter(Boolean);

            if (subResults.length === 0) {
                features.push({ key, label: def.label, tier: def.tier, status: "cannot_verify", reason: "No matching health data in this scan.", checks: [] });
                continue;
            }

            const activeBroken = subResults.filter(r => brokenStatuses.has(r.status) && r.contextActive !== false);
            const heartbeatIssues = subResults.filter(r => r.status === "plausible" && r.heartbeat && r.heartbeat.tracked && !r.heartbeat.alive);
            const anyCannotVerify = subResults.some(r => r.status === "cannot_verify");

            let status, reason;
            if (activeBroken.length > 0) {
                status = "degraded";
                reason = `${activeBroken.map(r => r.label).join(", ")} failed.`;
            } else if (heartbeatIssues.length > 0) {
                status = "heartbeat_stale";
                reason = `${heartbeatIssues.map(r => r.label).join(", ")} installed and not explicitly failing, but its heartbeat hasn't fired recently - may not be triggering in practice.`;
            } else if (anyCannotVerify && subResults.every(r => r.status === "cannot_verify")) {
                status = "cannot_verify";
                reason = "No health data published yet for this feature.";
            } else {
                status = "healthy";
                reason = null;
            }

            tierCounts[def.tier].total++;
            if (status === "healthy") tierCounts[def.tier].healthy++;

            features.push({
                key, label: def.label, tier: def.tier, status, reason,
                checks: subResults.map(r => ({ label: r.label, healthCheckName: r.healthCheckName, status: r.status }))
            });
        }

        const pct = tier => tierCounts[tier].total === 0 ? null : Math.round(100 * tierCounts[tier].healthy / tierCounts[tier].total);
        const criticalPct = pct("critical");
        const overall = criticalPct === null ? "UNKNOWN" : criticalPct < 100 ? "UNSAFE" : "SAFE";

        return {
            features,
            byTier: {
                critical: { ...tierCounts.critical, pct: criticalPct },
                important: { ...tierCounts.important, pct: pct("important") },
                optional: { ...tierCounts.optional, pct: pct("optional") }
            },
            overall
        };
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
                summary: `${suspects.length}/${related.length} related structural check(s) also show a problem in this same scan: [${suspects.map(s => `${s.label} (${s.status})`).join(", ")}]. This is consistent with Discord having changed or renamed something ByeBlocked depends on - the runtime failure is likely a downstream symptom, not a standalone bug. Start investigating with the structural check(s) above.`,
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
            ? ` (snapshot is ${Math.round(ageMs / 60000)}min old - may not reflect current state; ask the user to reopen ${pluginName}'s settings or wait for its next health cycle.)`
            : "";

        if (!entry.degraded) {
            const heartbeat = this._evaluateHeartbeat(entry, snapshot);
            if (heartbeat.tracked && !heartbeat.alive) {
                const heartbeatIssue = heartbeat.neverFired
                    ? `never reported a heartbeat since this snapshot was published (${Math.round((Date.now() - (snapshot.publishedAt || 0)) / 60000)}min ago) despite the startup grace window having passed`
                    : `last reported a heartbeat ${Math.round(heartbeat.msSinceHeartbeat / 60000)}min ago, past the stale threshold`;
                return {
                    status: "plausible",
                    confidence: "medium",
                    matchedVia: `${pluginName}.HealthMonitor:${check.healthCheckName}`,
                    note: `${pluginName} reports this feature as installed and not explicitly degraded (failStreak: ${entry.failStreak}, lifetime failures: ${entry.totalFailures}), but its heartbeat ${heartbeatIssue}. This means the patch is present but its trigger event may not be firing in practice - worth exercising this feature directly to confirm it actually works, not just that it installed.${staleWarning}`,
                    heartbeat
                };
            }
            return {
                status: "resolved",
                confidence: "high",
                matchedVia: `${pluginName}.HealthMonitor:${check.healthCheckName}`,
                note: `${pluginName} reports this runtime feature as healthy (failStreak: ${entry.failStreak}, lifetime failures: ${entry.totalFailures}).${staleWarning}`,
                heartbeat
            };
        }

        const diagnosis = this._diagnosePluginHealthDegradation(check, resultsSoFar);
        const verdictStatus = diagnosis.verdict === "likely_discord_change" ? "not_resolved" : "fallback_broken";

        return {
            status: verdictStatus,
            confidence: diagnosis.verdict === "unknown" ? "low" : "medium",
            matchedVia: `${pluginName}.HealthMonitor:${check.healthCheckName}`,
            note: `${pluginName} reports this runtime feature as DEGRADED (failStreak: ${entry.failStreak}, lifetime failures: ${entry.totalFailures}, degraded ${entry.degradedCount} time(s) this session).${staleWarning} Diagnosis: ${diagnosis.summary}`,
            heartbeat: this._evaluateHeartbeat(entry, snapshot),
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

    _evaluateHeartbeat(entry, snapshot) {
        if (!("lastHeartbeatAt" in entry)) return { tracked: false };

        const STARTUP_GRACE_MS = 2 * 60 * 1000;
        const STALE_MS = 10 * 60 * 1000;

        if (entry.lastHeartbeatAt == null) {
            const pastGrace = !!snapshot.publishedAt && (Date.now() - snapshot.publishedAt) > STARTUP_GRACE_MS;
            return { tracked: true, alive: !pastGrace, neverFired: true };
        }

        const stale = typeof entry.msSinceHeartbeat === "number" && entry.msSinceHeartbeat > STALE_MS;
        return { tracked: true, alive: !stale, neverFired: false, msSinceHeartbeat: entry.msSinceHeartbeat };
    }

    _investigateStoreNameBroad(check) {
        if (typeof BdApi === "undefined" || !BdApi.Webpack || typeof BdApi.Webpack.getModules !== "function") {
            return { technique: "storeName:broad-shape-scan", skipped: true, reason: "BdApi.Webpack.getModules unavailable in this BD version." };
        }

        let liveStores = [];
        try {
            liveStores = BdApi.Webpack.getModules(m => m && typeof m.getName === "function" && m._dispatchToken !== undefined) || [];
        } catch (err) {
            return { technique: "storeName:broad-shape-scan", skipped: true, reason: `getModules threw: ${err && err.message || err}` };
        }

        const expectedMethods = Array.isArray(check.expectedMethods) ? check.expectedMethods : [];

        const scored = [];
        for (const store of liveStores) {
            let name = null;
            try { name = store.getName(); } catch (_) {}
            if (!name || typeof name !== "string" || name.length <= 1) continue;
            if (check.candidates.includes(name)) continue;

            let methodNames = [];
            try {
                for (const k of Object.keys(store)) {
                    try { if (typeof store[k] === "function") methodNames.push(k); } catch (_) {}
                }
                const proto = Object.getPrototypeOf(store);
                if (proto && proto !== Object.prototype) {
                    for (const k of Object.getOwnPropertyNames(proto)) {
                        if (k === "constructor") continue;
                        try { if (typeof proto[k] === "function" && !methodNames.includes(k)) methodNames.push(k); } catch (_) {}
                    }
                }
            } catch (_) {}

            const methodHits = expectedMethods.filter(m => methodNames.includes(m));
            const methodScore = expectedMethods.length > 0 ? methodHits.length / expectedMethods.length : 0;

            const bestNameDistance = Math.min(...check.candidates.map(c => this._levenshtein(c.toLowerCase(), name.toLowerCase())));
            const maxLen = Math.max(...check.candidates.map(c => c.length), name.length, 1);
            const nameScore = 1 - Math.min(bestNameDistance / maxLen, 1);

            const combinedScore = expectedMethods.length > 0
                ? (methodScore * 0.75) + (nameScore * 0.25)
                : nameScore * 0.5;

            scored.push({
                storeName: name,
                methodHits,
                methodHitCount: methodHits.length,
                methodsExpectedCount: expectedMethods.length,
                nameDistanceToClosestCandidate: bestNameDistance,
                combinedScore: Math.round(combinedScore * 1000) / 1000,
                methodNamesSample: methodNames.sort().slice(0, 30),
                replacementSnippet: JSON.stringify(name)
            });
        }

        scored.sort((a, b) => b.combinedScore - a.combinedScore);
        const top = scored.slice(0, 5);

        return {
            technique: "storeName:broad-shape-scan",
            skipped: false,
            totalLiveStoresScanned: liveStores.length,
            usedExpectedMethods: expectedMethods,
            candidates: top,
            summary: top.length > 0
                ? (expectedMethods.length > 0
                    ? `Best broad-scan match is "${top[0].storeName}" (${top[0].methodHitCount}/${top[0].methodsExpectedCount} expected methods present, name distance ${top[0].nameDistanceToClosestCandidate}). If this looks right, add "${top[0].storeName}" to this check's candidates array in ByeBlocked's STORE_NAMES.`
                    : `Best broad-scan match by name alone is "${top[0].storeName}" (no expectedMethods declared for this check, so this is name-similarity only - verify manually before using). Consider adding expectedMethods to this check for a stronger signal next time.`)
                : `No live Store (out of ${liveStores.length} scanned) stood out as a plausible replacement.`
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
                : `No store entities at all were present in this snapshot to compare against - StoreScanner likely found nothing this session (re-scan after more navigation).`
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
                        : `Primary candidate name(s) [${check.candidates.slice(0, check.candidates.indexOf(candidate)).join(", ")}] did NOT resolve - only fell back to "${candidate}". Update ByeBlocked's candidate order if this persists.`
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
        const narrowInvestigation = this._investigateStoreName(check, stores);
        const NEAR_MATCH_DISTANCE_THRESHOLD = 3;
        const narrowFoundNothingUseful = narrowInvestigation.closestCandidates.length === 0
            || narrowInvestigation.closestCandidates[0].nameDistanceToClosestCandidate > NEAR_MATCH_DISTANCE_THRESHOLD;
        const broadInvestigation = narrowFoundNothingUseful ? this._investigateStoreNameBroad(check) : null;

        return {
            status: "not_resolved",
            confidence: "high",
            matchedVia: null,
            note: `None of [${check.candidates.join(", ")}] found as a Store entity (name or alias) in this scan. Either the Store was renamed, or it hasn't been loaded yet this session (re-scan after navigating more of the app before treating this as a real break).${extraNote}`,
            investigation: broadInvestigation
                ? { ...narrowInvestigation, broadScan: broadInvestigation }
                : narrowInvestigation
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
                note: `Dedicated Store not found. The plugin's fallback Store (${matchedStoreName}) still exists, but its original fallback method(s) [${(fb.originalMethodNames || []).join(", ")}] are gone - Discord renamed them. Found equivalent method(s) instead: [${renamedEquivalent.join(", ")}]. The dependent plugin's fallback code needs to be updated to call these new method names, or it will silently misbehave (not crash, just stop working).`
            };
        }

        return {
            status: "fallback_broken",
            confidence: "high",
            matchedVia: null,
            note: `Dedicated Store not found. The plugin's documented fallback Store (${matchedStoreName}) exists, but NONE of its expected method names - original [${(fb.originalMethodNames || []).join(", ")}] or known alternatives [${(fb.methodNames || []).join(", ")}] - are present. The fallback itself is broken; this needs a real code fix in the dependent plugin, not just a name update.`
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
                : `No module in this snapshot has any needle term in its captured snippet or name - the target module likely wasn't resolved this session at all (lazy-loaded), rather than the fingerprint being wrong.`
        };
    }

    _scanNeedlesAgainstModules(modules, needleLower) {
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
        return { sourceHits, distinctNeedlesFound };
    }

    _checkSourceString(check) {
        const modules = this.allEntities.filter(e => e.type === "webpackModule");
        const needleLower = check.needles.map(n => n.toLowerCase());
        const minHits = check.minHits || 1;

        const { sourceHits, distinctNeedlesFound } = this._scanNeedlesAgainstModules(modules, needleLower);
        if (distinctNeedlesFound.size >= minHits) {
            return {
                status: "resolved",
                confidence: "medium",
                matchedVia: sourceHits.map(h => h.id).slice(0, 3),
                note: `Found ${distinctNeedlesFound.size}/${check.needles.length} needle term(s) [${[...distinctNeedlesFound].join(", ")}] present in captured source of ${sourceHits.length} webpackModule entity(ies) (meets minHits: ${minHits}). This confirms the fingerprint's target text still exists in this build - it does not confirm the surrounding code structure ByeBlocked patches is unchanged.`
            };
        }

        if (check.fuzzyFallback && Array.isArray(check.fuzzyFallback.needles) && check.fuzzyFallback.needles.length > 0) {
            const fuzzyNeedleLower = check.fuzzyFallback.needles.map(n => n.toLowerCase());
            const fuzzyMinHits = check.fuzzyFallback.minHits || fuzzyNeedleLower.length;
            const fuzzy = this._scanNeedlesAgainstModules(modules, fuzzyNeedleLower);
            if (fuzzy.distinctNeedlesFound.size >= fuzzyMinHits) {
                return {
                    status: "resolved",
                    confidence: "medium",
                    matchedVia: fuzzy.sourceHits.map(h => h.id).slice(0, 3),
                    note: `Primary needle term(s) [${check.needles.join(", ")}] didn't meet minHits (${minHits}), but fuzzyFallback needle term(s) [${[...fuzzy.distinctNeedlesFound].join(", ")}] were found instead (meets fallback minHits: ${fuzzyMinHits}). This matches a known alternative build layout for this fingerprint, declared by the dependent plugin - still confirms the target text exists, not the surrounding code structure.`
                };
            }
        }

        if (sourceHits.length > 0) {
            const hitModulesById = new Map(modules.map(m => [m.id, m]));
            const hitModules = sourceHits.map(h => hitModulesById.get(h.id)).filter(Boolean);
            const allHitsTruncated = hitModules.length > 0 && hitModules.every(m => !!m.data?.sourceTruncated);
            const verdict = allHitsTruncated ? "likely_truncation" : "likely_real_partial_match";

            const note = allHitsTruncated
                ? `Found ${distinctNeedlesFound.size}/${check.needles.length} needle term(s) in captured source - below this fingerprint's minHits threshold (${minHits}). Every matching module's snippet was truncated, so the missing term(s) may simply sit past the 200-char capture window rather than being absent from the build. Lower-priority than a partial match against a complete snippet.`
                : `Found ${distinctNeedlesFound.size}/${check.needles.length} needle term(s) in captured source - below this fingerprint's minHits threshold (${minHits}). At least one matching module's snippet was captured in full and still lacks the missing term(s), so truncation doesn't explain the gap - this is a stronger signal the fingerprint may be degrading.`;

            return {
                status: "plausible",
                confidence: "low",
                matchedVia: sourceHits.map(h => h.id).slice(0, 3),
                note,
                investigation: { ...this._investigateSourceString(check, modules, needleLower), verdict }
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
                note: `No source-snippet match, but ${nameHits.length} webpackModule entity(ies) have a name/alias echoing this fingerprint's needle terms. Weaker signal than a direct source match - confirm by testing the plugin directly.`,
                investigation: this._investigateSourceString(check, modules, needleLower)
            };
        }
        try {
            if (typeof BdApi?.Webpack?.getWithKey === "function") {
                const liveHit = BdApi.Webpack.getWithKey(m => {
                    const fn = _unwrapReactComponent(m) || (typeof m === "function" ? m : null);
                    if (!fn) return false;
                    try {
                        const src = Function.prototype.toString.call(fn).toLowerCase();
                        return needleLower.filter(n => src.includes(n)).length >= minHits;
                    } catch (_) { return false; }
                });
                let pair = null;
                if (liveHit) {
                    if (Array.isArray(liveHit)) pair = liveHit;
                    else if (typeof liveHit[Symbol.iterator] === "function" || typeof liveHit.next === "function") {
                        const spread = [...liveHit];
                        if (spread.length && spread[0] !== undefined) pair = spread;
                    }
                }
                if (pair && pair[0] !== undefined) {
                    return {
                        status: "resolved",
                        confidence: "medium",
                        matchedVia: ["live:getWithKey"],
                        note: `Not found in the static WebpackScanner snapshot, but a live BdApi.Webpack.getWithKey search (same needle terms, minHits: ${minHits}) found a matching module just now. This is the same "exists but not export-scannable" situation ByeBlocked's own fallback patches handle via direct Fiber walk - treat as a real match, not a weaker one.`,
                        investigation: this._investigateSourceString(check, modules, needleLower)
                    };
                }
            }
        } catch (_) {}
        return {
            status: "cannot_verify",
            confidence: "low",
            matchedVia: null,
            note: "No webpackModule entity in this scan has a captured source snippet or name/alias matching any needle term, and a live getWithKey search found no match either. This does NOT mean the fingerprint is broken - the target module may not have been resolved (lazy-loaded) this session, or its match sits past the truncated snippet window. Treat as inconclusive, not as a failure.",
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
                ? `Closest candidate "${closestCandidates[0].moduleName}" (${closestCandidates[0].moduleKey}) has ${closestCandidates[0].matchedMethods.length}/${required.length} required method(s): [${closestCandidates[0].matchedMethods.join(", ")}]. Missing: [${closestCandidates[0].missingMethods.join(", ")}] - check fullPrototypeMethodList for a plausible rename (e.g. a same-arity method with a similar name).`
                : `No module in this snapshot's captured prototype data shares even one required method - the target module likely wasn't resolved this session at all, rather than the shape being gone.`
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
                note: `Found ${matches.length} webpackModule entity(ies) exposing all required method(s) [${required.join(", ")}] via own properties or one prototype level. This confirms the shape exists in this build - it does not confirm this is the exact same object ByeBlocked's own lookup resolves to.`
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
            note: `No webpackModule entity in this scan's captured method-name data exposes any of [${required.join(", ")}]. This does NOT mean the shape is gone - the target module may not have been resolved (lazy-loaded) this session. Treat as inconclusive, not as a failure.`,
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
                summary: "Live module lookup (BdApi.Webpack.getModule) unavailable in this environment - cannot relax the filter to find a closest candidate."
            };
        }
        const opts = filter.searchExports ? { searchExports: true } : undefined;
        const requiredAllKeys = filter.keys || [];
        const requiredAnyKeys = filter.keysAny || [];
        const excludeKeys = filter.excludeKeys || [];
        const checkFn = (m, k) => filter.requireFunctions ? (typeof m[k] === "function") : !!m[k];

        const perKeyFindings = [];
        for (const key of [...requiredAllKeys, ...requiredAnyKeys]) {
            const isAnyKey = !requiredAllKeys.includes(key);
            try {
                const otherAllKeys = isAnyKey ? requiredAllKeys : requiredAllKeys.filter(k => k !== key);
                const otherAnyKeys = isAnyKey ? [] : requiredAnyKeys;
                const relaxedFilter = (m) => {
                    if (!m || typeof m !== "object") return false;
                    if (!otherAllKeys.every(k => checkFn(m, k))) return false;
                    if (otherAnyKeys.length > 0 && !otherAnyKeys.some(k => checkFn(m, k))) return false;
                    if (excludeKeys.some(k => checkFn(m, k))) return false;
                    return true;
                };
                const found = BdApi.Webpack.getModule(relaxedFilter, opts);
                if (found) {
                    const actualKeys = Object.keys(found).filter(k => typeof found[k] === "function").slice(0, 40);

                    const alreadyKnownKeys = new Set([...otherAllKeys, ...otherAnyKeys, ...excludeKeys]);
                    const renameCandidates = actualKeys
                        .filter(k => !alreadyKnownKeys.has(k))
                        .map(k => ({ key: k, distance: this._levenshtein(key.toLowerCase(), k.toLowerCase()) }))
                        .sort((a, b) => a.distance - b.distance)
                        .slice(0, 3);

                    perKeyFindings.push({
                        missingKey: key,
                        missingKeyField: isAnyKey ? "keysAny" : "keys",
                        foundModuleSatisfiesOthers: true,
                        actualFunctionKeysSample: actualKeys,
                        hasMissingKeyAnyway: !!found[key],
                        renameCandidates,
                        replacementSnippet: (renameCandidates.length > 0 && renameCandidates[0].distance <= 6)
                            ? JSON.stringify(isAnyKey
                                ? [...requiredAnyKeys.filter(k => k !== key), renameCandidates[0].key]
                                : [...otherAllKeys, renameCandidates[0].key])
                            : null
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
                ? (perKeyFindings[0].replacementSnippet
                    ? `Relaxing the filter one key at a time found a module satisfying all OTHER conditions when ignoring "${perKeyFindings[0].missingKey}" (from ${perKeyFindings[0].missingKeyField}). Best rename guess: "${perKeyFindings[0].renameCandidates[0].key}" (name distance ${perKeyFindings[0].renameCandidates[0].distance}) - see replacementSnippet for a ready-to-paste updated ${perKeyFindings[0].missingKeyField} array. Verify this key actually behaves the same before using it.`
                    : `Relaxing the filter one key at a time found a module satisfying all OTHER conditions when ignoring "${perKeyFindings[0].missingKey}" (from ${perKeyFindings[0].missingKeyField}). Its actual function keys are listed in actualFunctionKeysSample - look there for a renamed equivalent (no close-enough name match to auto-suggest one).`)
                : `Even relaxing one required key at a time found no candidate module. This suggests either the whole structural pattern moved to a very different module shape, or the module simply hasn't loaded this session (lazy-loaded).`
        };
    }

    _checkStructuralModule(check) {
        if (!check.filter || typeof BdApi === "undefined" || !BdApi.Webpack || typeof BdApi.Webpack.getModule !== "function") {
            return { status: "cannot_verify", confidence: "low", matchedVia: null, note: "Live module lookup unavailable - skip structural module check." };
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
            return { status: "cannot_verify", confidence: "low", matchedVia: null, note: "No DOM available in this environment - skip domProp check." };
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
                note: `No DOM element matched selector "${check.selector}" in this scan. This almost always means the required UI context wasn't open (see requiresContext) rather than the selector being wrong - open the relevant screen and re-scan.`
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
                note: `Found expected prop(s) at Fiber hop ${resolvedHop.hop} (component: ${resolvedHop.componentName || "anonymous"}, ${resolvedHop.isClassComponent ? "class" : "function"} component) walking up from "${check.selector}". This confirms the prop still flows through this part of the tree - it does not confirm the exact same patch point ByeBlocked targets.`
            };
        }

        return {
            status: "cannot_verify",
            confidence: "low",
            matchedVia: null,
            note: `Walked ${hops.length} Fiber hop(s) up from "${check.selector}" without finding the expected prop(s) [${expectedProp || (expectedPropAny || []).join(", ")}]. This does not confirm the prop is gone - Discord's component tree shape (how many hops, class vs function component) may have shifted; see investigation.domHops for what was actually found at each level.`,
            investigation: {
                investigatedAt: Date.now(),
                technique: "domProp:fiber-walk",
                selector: check.selector,
                domHops: hops,
                summary: hops.length > 0
                    ? `Walked ${hops.length} hop(s). Last hop reached: ${hops[hops.length - 1].componentName || "anonymous"} (${hops[hops.length - 1].isClassComponent ? "class" : "function"} component, hasRender: ${hops[hops.length - 1].hasRender}). None exposed the expected prop(s) - inspect propsFound per hop for a renamed equivalent.`
                    : "No hops were walkable at all - the Fiber tree may be unusually shallow here, or the element matched is not inside a React root."
            }
        };
    }

    _applyHistoryCoverage(result, check, contextActive) {
        if (contextActive || result.status !== "cannot_verify" || !this.historyLookup) return result;
        let hist;
        try {
            hist = this.historyLookup(check.label, check.plugin);
        } catch (_) {
            return result;
        }
        if (!hist || hist.scansObserved < 2) return result;

        if (hist.unhealthyCount > 0) {
            return {
                ...result,
                historicalCoverage: {
                    verdict: "unstable",
                    note: `Context not active this scan, so this can't be checked directly - but history shows it was unhealthy in ${hist.unhealthyCount} of the last ${hist.scansObserved} scan(s) where it *was* checked. Worth visiting this screen to confirm current state rather than assuming it's fine.`
                }
            };
        }

        return result;
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
            const contextActive = !check.requiresContext || this.activeContexts.has(check.requiresContext);
            result = this._applyHistoryCoverage(result, check, contextActive);
            results.push({ plugin: check.plugin, label: check.label, kind: check.kind, requiresContext: check.requiresContext || null, contextActive, healthCheckName: null, ...result });
        }

        for (const check of deferred) {
            const result = this._checkPluginHealthCheck(check, results);
            const contextActive = !check.requiresContext || this.activeContexts.has(check.requiresContext);
            results.push({ plugin: check.plugin, label: check.label, kind: check.kind, requiresContext: check.requiresContext || null, contextActive, healthCheckName: check.healthCheckName || null, ...result });
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

        const byPluginContextAware = {};
        for (const r of results) {
            if (!byPluginContextAware[r.plugin]) {
                byPluginContextAware[r.plugin] = {
                    resolved: 0, not_resolved: 0, plausible: 0, cannot_verify: 0,
                    fallback_renamed: 0, fallback_broken: 0, context_not_active: 0,
                    total: 0
                };
            }
            const bucket = byPluginContextAware[r.plugin];
            const statusIsNonFinal = new Set(["not_resolved", "cannot_verify", "plausible", "fallback_broken"]).has(r.status);
            if (!r.contextActive && statusIsNonFinal) {
                bucket.context_not_active++;
            } else {
                bucket[r.status] = (bucket[r.status] || 0) + 1;
            }
            bucket.total++;
        }

        const relatedChecksIndex = new Map();
        for (const check of this.checks) {
            if (check.kind !== "pluginHealthCheck" || !Array.isArray(check.relatedChecks)) continue;
            for (const relatedLabel of check.relatedChecks) {
                if (!relatedChecksIndex.has(relatedLabel)) relatedChecksIndex.set(relatedLabel, []);
                relatedChecksIndex.get(relatedLabel).push(check.healthCheckName);
            }
        }
        const healthResultByCheckName = new Map();
        for (const r of results) {
            if (r.kind === "pluginHealthCheck" && r.healthCheckName) healthResultByCheckName.set(r.healthCheckName, r);
        }

        const contextlessUnresolved = [];
        for (const r of results) {
            if (r.requiresContext || r.status !== "cannot_verify") continue;
            const linkedHealthCheckNames = relatedChecksIndex.get(r.label) || [];
            const linkedHealthResults = linkedHealthCheckNames.map(name => healthResultByCheckName.get(name)).filter(Boolean);
            const anyLinkedHealthy = linkedHealthResults.some(hr => hr.status === "resolved");
            const anyLinkedDegraded = linkedHealthResults.some(hr => hr.status === "not_resolved" || hr.status === "fallback_broken" || hr.status === "plausible");

            if (anyLinkedHealthy && !anyLinkedDegraded) {
                continue;
            }
            contextlessUnresolved.push({
                plugin: r.plugin, label: r.label, status: r.status, kind: r.kind, note: r.note || null,
                linkedHealthCheckStatus: linkedHealthResults.length > 0
                    ? linkedHealthResults.map(hr => `${hr.label}: ${hr.status}`).join(", ")
                    : "no linked runtime health check found"
            });
        }

        const unresolvedStatuses = new Set(["cannot_verify", "not_resolved", "plausible", "fallback_broken"]);
        const pendingByContext = {};
        for (const r of results) {
            if (!r.requiresContext) continue;
            if (!unresolvedStatuses.has(r.status)) continue;
            if (!pendingByContext[r.requiresContext]) pendingByContext[r.requiresContext] = [];
            pendingByContext[r.requiresContext].push({ plugin: r.plugin, label: r.label, status: r.status, contextActive: r.contextActive, kind: r.kind, historicalCoverage: r.historicalCoverage || null });
        }
        const pendingContexts = Object.entries(pendingByContext).map(([context, checks]) => {
            const suspiciousChecks = checks.filter(c => c.contextActive);
            const hardSuspicious = suspiciousChecks.filter(c => c.kind !== "domProp");
            const softSuspicious = suspiciousChecks.filter(c => c.kind === "domProp");

            const unstableCovered = checks.filter(c => c.historicalCoverage && c.historicalCoverage.verdict === "unstable").length;

            return {
                context,
                affectedCheckCount: checks.length,
                genuinelySuspicious: suspiciousChecks.length,
                genuinelySuspiciousNote: softSuspicious.length > 0
                    ? `${softSuspicious.length} of these are domProp check(s) where context detection and the check use independent selectors - a mismatch here can mean one selector drifted, not that the feature broke. Treat as "worth a second look", not confirmed. ${hardSuspicious.length > 0 ? `${hardSuspicious.length} other check(s) here use context-independent signals (store lookups, etc.) and are a stronger signal.` : ""}`.trim()
                    : null,
                coverage: {
                    unstableCovered,
                    note: unstableCovered > 0
                        ? `${unstableCovered} of these show unstable history (unhealthy in a recent scan) even though context isn't active right now - worth checking sooner rather than assuming it's fine.`
                        : null
                },
                checks
            };
        });

        const featureSummary = this._computeFeatureSummary(results);

        entities.push(makeEntity({
            id: "compatibility:report",
            type: "compatibility",
            name: "CompatibilityReport",
            aliases: [],
            discoveredVia: "entity-cross-reference:declared-checks",
            confidence: "high",
            confidenceReason: "Each check's status is derived directly from entities already present in this snapshot - no speculation beyond what's stated in each result's own note.",
            data: {
                summaryByPlugin: byPlugin,
                summaryByPluginContextAware: byPluginContextAware,
                checks: results,
                pendingContexts,
                contextlessUnresolved,
                featureSummary
            }
        }));

        const brokenStatuses = new Set(["not_resolved", "fallback_broken"]);
        const brokenResults = results.filter(r => brokenStatuses.has(r.status) && r.contextActive);
        const brokenCount = brokenResults.length;
        const brokenLabels = brokenResults.map(r => r.label);

        const contextSkippedResults = results.filter(r => brokenStatuses.has(r.status) && !r.contextActive);
        const contextSkippedCount = contextSkippedResults.length;

        const renamedResults = results.filter(r => r.status === "fallback_renamed");
        const renamedCount = renamedResults.length;
        const renamedLabels = renamedResults.map(r => r.label);

        const logLevel = brokenCount > 0 ? "warn" : (renamedCount > 0 ? "warn" : "info");
        let message = `ran ${results.length} compatibility check(s) across ${Object.keys(byPlugin).length} plugin(s) - ${brokenCount} genuinely not resolved (context active or n/a): [${brokenLabels.join(", ")}]`;
        if (contextSkippedCount > 0) {
            message += ` - ${contextSkippedCount} more not resolved but their required context wasn't active this scan (not a real signal): [${contextSkippedResults.map(r => `${r.label} (needs ${r.requiresContext})`).join(", ")}]`;
        }
        if (renamedCount > 0) {
            message += ` - ${renamedCount} resolved via fallback but method(s) renamed (update needed, not urgent): [${renamedLabels.join(", ")}]`;
        }
        if (pendingContexts.length > 0) {
            message += ` - ${pendingContexts.length} context(s) needed for deeper investigation: [${pendingContexts.map(p => `${p.context} (${p.affectedCheckCount})`).join(", ")}]`;
        }
        this.logger.log(this.moduleName, message, logLevel);
        return entities;
    }
}
class FingerprintWatchdog {
    constructor(options = {}) {
        this.moduleName = "FingerprintWatchdog";
        this.logger = options.logger;
        this.bootstrap = options.bootstrap;
        this.checks = options.checks || [];
        this.compatibilityResults = options.compatibilityResults || [];

        this._gatewayActionPattern = /\b(MESSAGE_CREATE|MESSAGE_UPDATE|MESSAGE_DELETE|CHANNEL_CREATE|GUILD_MEMBER_(?:ADD|REMOVE|UPDATE)|VOICE_STATE_UPDATE|PRESENCE_UPDATE|RELATIONSHIP_(?:ADD|REMOVE))\b/;
    }

    isImplemented() { return true; }

    _fingerprintScanForNeedles(wpRequire, needles, minHits) {
        if (!wpRequire || !wpRequire.c) return { found: false, moduleId: null, hitCount: 0, hits: [] };
        const needlesLower = needles.map(n => n.toLowerCase());

        for (const [moduleId, mod] of Object.entries(wpRequire.c)) {
            let exp;
            try { exp = mod && mod.exports; } catch (_) { continue; }
            if (!exp) continue;

            const candidateExports = typeof exp === "function" ? [exp] : Object.values(exp).filter(v => v && (typeof v === "function" || typeof v === "object"));
            if (typeof exp === "object") candidateExports.push(exp);

            for (const target of candidateExports) {
                let methodNames = [];
                try {
                    methodNames = Object.getOwnPropertyNames(target);
                    const proto = Object.getPrototypeOf(target);
                    if (proto && proto !== Object.prototype && proto !== Function.prototype) {
                        methodNames = [...new Set([...methodNames, ...Object.getOwnPropertyNames(proto)])];
                    }
                } catch (_) {}
                const methodHits = needlesLower.filter(n => methodNames.some(m => m.toLowerCase() === n));
                if (methodHits.length >= (minHits ?? needles.length)) {
                    return { found: true, moduleId, hitCount: methodHits.length, hits: methodHits, matchedVia: "prototype-method-names" };
                }

                if (typeof target === "function") {
                    let src;
                    try { src = target.toString(); } catch (_) { continue; }
                    const srcLower = src.toLowerCase();
                    const textHits = needlesLower.filter(n => srcLower.includes(n));
                    if (textHits.length >= (minHits ?? needles.length)) {
                        return { found: true, moduleId, hitCount: textHits.length, hits: textHits, matchedVia: "source-text", gatewayActionDetected: this._gatewayActionPattern.test(src) };
                    }
                }
            }
        }
        return { found: false, moduleId: null, hitCount: 0, hits: [] };
    }

    _crossCheckStoreName(check) {
        const officialHits = [];
        if (typeof BdApi !== "undefined" && BdApi.Webpack && typeof BdApi.Webpack.getStore === "function") {
            for (const candidate of check.candidates) {
                try {
                    const store = BdApi.Webpack.getStore(candidate);
                    if (store) officialHits.push({ candidate, viaOfficialApi: true });
                } catch (_) {}
            }
        }

        if (!check.expectedMethods || check.expectedMethods.length === 0) {
            return { officialHits, fingerprint: { found: false, moduleId: null, hitCount: 0, hits: [] }, skipped: true };
        }

        const wpRequire = this.bootstrap.getRequire();
        const fp = this._fingerprintScanForNeedles(wpRequire, check.expectedMethods, Math.min(2, check.expectedMethods.length));

        return { officialHits, fingerprint: fp, skipped: false };
    }

    _crossCheckSourceOrProto(check) {
        const wpRequire = this.bootstrap.getRequire();
        const needles = check.kind === "protoShape" ? check.methods : check.needles;
        const minHits = check.kind === "protoShape" ? check.methods.length : (check.minHits ?? needles.length);
        const fp = this._fingerprintScanForNeedles(wpRequire, needles, minHits);
        return { officialHits: [], fingerprint: fp };
    }

    _detectDrift(check, compatResult, crossCheck) {
        const compatResolved = compatResult && compatResult.status === "resolved";
        const fingerprintResolved = crossCheck.fingerprint.found;

        if (compatResolved && !fingerprintResolved) {
            return {
                driftType: "api-found-fingerprint-missed",
                severity: "info",
                message: `"${check.label}": BD's public API/heuristics resolved (matchedVia="${compatResult.matchedVia}"), but the independent textual fingerprinting scan did NOT find anything matching. Could just be a difference in search strategy (not necessarily an error) - but worth checking whether matchedVia is still the right module.`
            };
        }

        if (!compatResolved && fingerprintResolved) {
            return {
                driftType: "fingerprint-found-api-missed",
                severity: "warn",
                message: `"${check.label}": BD's public API/heuristics did NOT resolve, but the textual fingerprinting scan found a plausible candidate (moduleId=${crossCheck.fingerprint.moduleId}, ${crossCheck.fingerprint.hitCount} hit(s): [${crossCheck.fingerprint.hits.join(", ")}]). This is a strong candidate to manually add to the check's candidates/needles - NOT applied automatically.`
            };
        }

        if (compatResolved && fingerprintResolved && check.kind === "storeName") {
            const matchedViaStr = Array.isArray(compatResult.matchedVia) ? compatResult.matchedVia[0] : compatResult.matchedVia;
            const officialCandidateNames = crossCheck.officialHits.map(h => h.candidate);
            if (officialCandidateNames.length && matchedViaStr && !officialCandidateNames.some(name => matchedViaStr.includes(name))) {
                return {
                    driftType: "matched-via-mismatch",
                    severity: "warn",
                    message: `"${check.label}": possible mismatch - CompatibilityModule reports matchedVia="${matchedViaStr}", but the official check via BdApi.Webpack.getStore resolved through [${officialCandidateNames.join(", ")}]. Worth manually confirming it's the same Store.`
                };
            }
        }

        return null;
    }

    async scan() {
        const wpRequire = this.bootstrap.getRequire();
        if (!wpRequire) {
            this.logger.log(this.moduleName, "wpRequire unavailable - watchdog can't run the cross-check scan.", "warn");
            return [];
        }

        const resultByLabel = new Map();
        for (const r of this.compatibilityResults) resultByLabel.set(`${r.plugin}::${r.label}`, r);

        const drifts = [];
        let crossChecked = 0;

        for (const check of this.checks) {
            if (check.kind !== "storeName" && check.kind !== "sourceString" && check.kind !== "protoShape") continue;

            const compatResult = resultByLabel.get(`${check.plugin}::${check.label}`);
            const crossCheck = check.kind === "storeName"
                ? this._crossCheckStoreName(check)
                : this._crossCheckSourceOrProto(check);

            if (crossCheck.skipped) continue;

            crossChecked++;
            const drift = this._detectDrift(check, compatResult, crossCheck);
            if (drift) {
                drifts.push({ plugin: check.plugin, label: check.label, ...drift });
                this.logger.log(this.moduleName, `[DRIFT:${drift.driftType}] ${drift.message}`, drift.severity === "warn" ? "warn" : "info");
            }
        }

        if (drifts.length === 0) {
            this.logger.log(this.moduleName, `cross-check scan complete: ${crossChecked} check(s) compared, no drift between public API and fingerprinting.`, "info");
        } else {
            const hasWarnDrift = drifts.some(d => d.severity === "warn");
            const summaryLevel = hasWarnDrift ? "warn" : "info";
            this.logger.log(this.moduleName, `cross-check scan complete: ${crossChecked} check(s) compared, ${drifts.length} drift(s) detected (${drifts.filter(d => d.severity === "warn").length} warn, ${drifts.filter(d => d.severity === "info").length} info). See the [DRIFT:*] lines above for details.`, summaryLevel);
        }

        return [{
            id: "fingerprint-watchdog:summary",
            type: "fingerprintWatchdog",
            name: "FingerprintWatchdog",
            data: {
                crossCheckedCount: crossChecked,
                driftCount: drifts.length,
                drifts
            }
        }];
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
        this._lastNotifiedBrokenSignature = null;

        this._scanInFlight = false;
        this._checkHistoryCache = null;

        this._watchModeActive = false;
        this._dispatcher = null;
        this._watchDispatcherSubscriptions = [];
        this._watchMutationObserver = null;
        this._watchSeenContexts = new Set();
        this._watchScanInFlight = false;
        this._watchStartedAt = null;
        this._watchOnUpdate = null;

        this._watchSessionChanges = [];
        this._watchSessionEndedAt = null;
        this._watchNextScanTrigger = null;
    }

    _provideWebpackEntities() {
        return this._webpackLiveValues;
    }

    start() {
        this.logger.log("core", "plugin started.");
        this._startAutoCheck();
        this.startWatchMode();
    }

    stop() {
        this._stopAutoCheck();
        this.stopWatchMode();
        this.logger.log("core", "plugin stopped.");
    }

    _resolveDispatcher() {
        if (this._dispatcher) return this._dispatcher;
        try {
            if (typeof BdApi === "undefined" || !BdApi.Webpack || typeof BdApi.Webpack.getModule !== "function") return null;

            const found = BdApi.Webpack.getModule(
                (m) => m && typeof m.subscribe === "function" && typeof m.dispatch === "function" && m._actionHandlers,
                { first: true }
            );
            if (found) {
                this._dispatcher = found;
                this.logger.log("core", "Flux Dispatcher resolved for watch mode's event-driven context detection.", "info");
                return found;
            }

            const wasmCandidate = BdApi.Webpack.getModule(
                (m) => m && typeof m.connectStore === "function" && typeof m.dispatchAction === "function",
                { first: true }
            );
            if (wasmCandidate) {
                this.logger.log(
                    "core",
                    "Flux Dispatcher found, but it's the newer WASM-backed variant (connectStore/dispatchAction) - watch mode's event-driven subscribe path doesn't support this shape yet, falling back to DOM observation only.",
                    "warn"
                );
            }
            return null;
        } catch (_) {
            return null;
        }
    }

    _detectActiveContexts() {
        const active = new Set();
        try {
            const getStore = (typeof BdApi !== "undefined" && BdApi.Webpack && typeof BdApi.Webpack.getStore === "function")
                ? BdApi.Webpack.getStore.bind(BdApi.Webpack)
                : null;
            if (getStore) {
                let callStore = null;
                for (const name of StoreScanner.KNOWN_STORE_NAME_GROUPS.CALL) {
                    callStore = getStore(name);
                    if (callStore) break;
                }
                let selectedChannelStore = null;
                for (const name of StoreScanner.KNOWN_STORE_NAME_GROUPS.SELECTED_CHANNEL) {
                    selectedChannelStore = getStore(name);
                    if (selectedChannelStore) break;
                }
                let inVoiceCall = false;
                try {
                    if (callStore && selectedChannelStore && typeof selectedChannelStore.getChannelId === "function") {
                        const channelId = selectedChannelStore.getChannelId();
                        if (channelId && typeof callStore.getCall === "function" && callStore.getCall(channelId)) {
                            inVoiceCall = true;
                        } else if (typeof callStore.getAllCalls === "function") {
                            const calls = callStore.getAllCalls();
                            inVoiceCall = calls && Object.keys(calls).length > 0;
                        }
                    }
                } catch (_) {}
                if (inVoiceCall) {
                    active.add("voiceCall");
                    try {
                        let mediaEngineStore = null;
                        for (const name of StoreScanner.KNOWN_STORE_NAME_GROUPS.MEDIA_ENGINE) {
                            mediaEngineStore = getStore(name);
                            if (mediaEngineStore) break;
                        }
                        const hasVideo = mediaEngineStore && (
                            (typeof mediaEngineStore.isLocalVideoEnabled === "function" && mediaEngineStore.isLocalVideoEnabled()) ||
                            (typeof mediaEngineStore.isLocalVideoAutoDisabled === "function" && !mediaEngineStore.isLocalVideoAutoDisabled())
                        );
                        if (hasVideo) active.add("voiceCallWithVideo");
                    } catch (_) {}
                    try {
                        let activityStore = null;
                        for (const name of StoreScanner.KNOWN_STORE_NAME_GROUPS.ACTIVITY) {
                            activityStore = getStore(name);
                            if (activityStore) break;
                        }
                        let hasActivity = false;
                        if (activityStore && selectedChannelStore && typeof selectedChannelStore.getChannelId === "function") {
                            const channelId = selectedChannelStore.getChannelId();
                            if (channelId) {
                                if (typeof activityStore.getParticipants === "function") {
                                    const participants = activityStore.getParticipants(channelId);
                                    hasActivity = Array.isArray(participants) ? participants.length > 0 : !!participants;
                                } else if (typeof activityStore.getActivityParticipants === "function") {
                                    const participants = activityStore.getActivityParticipants(channelId);
                                    hasActivity = Array.isArray(participants) ? participants.length > 0 : !!participants;
                                }
                            }
                        }
                        if (hasActivity) active.add("voiceCallWithActivity");
                    } catch (_) {}
                }
                try {
                    let stageInstanceStore = null;
                    for (const name of StoreScanner.KNOWN_STORE_NAME_GROUPS.STAGE_INSTANCE) {
                        stageInstanceStore = getStore(name);
                        if (stageInstanceStore) break;
                    }
                    if (stageInstanceStore && selectedChannelStore && typeof selectedChannelStore.getChannelId === "function") {
                        const channelId = selectedChannelStore.getChannelId();
                        if (channelId && typeof stageInstanceStore.getStageInstance === "function" && stageInstanceStore.getStageInstance(channelId)) {
                            active.add("stageChannel");
                        }
                    }
                } catch (_) {}
            }
        } catch (_) {}

        try {
            if (document.querySelector('[class*="memberRow"], [class*="membersHeader"], [class*="member"][role="listitem"], [class*="memberInner"]')) {
                active.add("memberListOpen");
            }
        } catch (_) {}
        try {
            if (document.querySelector('[data-list-id^="forum-channel-list-"], [class*="mainCard_"]')) {
                active.add("forumChannelOpen");
            }
        } catch (_) {}

        return active;
    }

    async _onWatchModeSignal(reason) {
        if (!this._watchModeActive || this._watchScanInFlight) return;
        let activeNow;
        try {
            activeNow = this._detectActiveContexts();
        } catch (err) {
            this.logger.log("core", `watch mode: context detection failed: ${err && err.message || err}`, "warn");
            return;
        }
        try {
            console.debug(
                `[Probe:core] watch signal (${reason}) - active contexts now: [${[...activeNow].join(", ") || "none"}] - ` +
                `already seen this session: [${[...this._watchSeenContexts].join(", ") || "none"}]`
            );
        } catch (_) {}
        const newContexts = [...activeNow].filter(ctx => !this._watchSeenContexts.has(ctx));
        if (newContexts.length === 0) return;

        this._watchScanInFlight = true;
        try {
            for (const ctx of newContexts) this._watchSeenContexts.add(ctx);
            this.logger.log("core", `watch mode: new context(s) detected [${newContexts.join(", ")}] (via ${reason}) - running compatibility check.`, "info");
            this._watchNextScanTrigger = newContexts;
            const snapshot = await this.runFullScan();
            try {
                this._lastFindResult = await this.findMissingModules();
            } catch (err) {
                this.logger.log("core", `watch mode: automatic findMissingModules failed: ${err && err.message || err}`, "warn");
            }
            if (this._watchOnUpdate) {
                try { this._watchOnUpdate(snapshot); } catch (_) {}
            }
        } catch (err) {
            this.logger.log("core", `watch mode: scan failed: ${err && err.message || err}`, "error");
        } finally {
            this._watchScanInFlight = false;
        }
    }

    static get WATCH_DISPATCHER_ACTION_TYPES() {
        return [
            "VOICE_STATE_UPDATES", "CALL_UPDATE", "VOICE_CHANNEL_SELECT",
            "STREAM_START", "STREAM_STOP", "MEDIA_ENGINE_SET_VIDEO_ENABLED",
            "STAGE_INSTANCE_CREATE", "STAGE_INSTANCE_DELETE", "STAGE_INSTANCE_UPDATE",
            "EMBEDDED_ACTIVITY_UPDATE", "CHANNEL_SELECT"
        ];
    }

    _subscribeWatchDispatcher(dispatcher) {
        for (const actionType of class_Probe.WATCH_DISPATCHER_ACTION_TYPES) {
            const handler = () => { this._onWatchModeSignal(`dispatcher:${actionType}`); };
            try {
                dispatcher.subscribe(actionType, handler);
                this._watchDispatcherSubscriptions.push({ actionType, handler });
            } catch (err) {
                this.logger.log("core", `watch mode: failed to subscribe to ${actionType}: ${err && err.message || err}`, "warn");
            }
        }
        this.logger.log("core", `watch mode: subscribed to ${this._watchDispatcherSubscriptions.length}/${class_Probe.WATCH_DISPATCHER_ACTION_TYPES.length} Dispatcher action(s) for voice/stage/activity, plus DOM observation for member list/forum.`, "info");
    }

    startWatchMode(onUpdate) {
        if (this._watchModeActive) return;
        this._watchModeActive = true;
        this._watchSeenContexts = new Set();
        this._watchStartedAt = Date.now();
        this._watchOnUpdate = typeof onUpdate === "function" ? onUpdate : null;
        this._watchSessionChanges = [];
        this._watchSessionEndedAt = null;

        const dispatcher = this._resolveDispatcher();
        this._watchDispatcherSubscriptions = [];
        if (dispatcher) {
            this._subscribeWatchDispatcher(dispatcher);
        } else {
            this.logger.log("core", "watch mode started - Flux Dispatcher not resolved yet, will retry once in 5s; member list/forum are covered via DOM observation in the meantime.", "warn");
            setTimeout(() => {
                if (!this._watchModeActive || this._watchDispatcherSubscriptions.length > 0) return;
                const retried = this._resolveDispatcher();
                if (retried) {
                    this._subscribeWatchDispatcher(retried);
                    this.logger.log("core", "watch mode: Flux Dispatcher resolved on retry - voice/stage/activity now covered live.", "info");
                } else {
                    this.logger.log("core", "watch mode: Flux Dispatcher still not resolved after retry - voice/stage/activity won't update live this session.", "warn");
                }
            }, 5000);
        }

        try {
            let debounceTimer = null;
            this._watchMutationObserver = new MutationObserver(() => {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => { this._onWatchModeSignal("dom-mutation"); }, 250);
            });
            this._watchMutationObserver.observe(document.body, { childList: true, subtree: true });
        } catch (err) {
            this.logger.log("core", `watch mode: failed to start DOM observation: ${err && err.message || err}`, "warn");
            this._watchMutationObserver = null;
        }

        this._onWatchModeSignal("initial-check");

        this.findMissingModules()
            .then((result) => {
                this._lastFindResult = result;
                if (this._watchOnUpdate) { try { this._watchOnUpdate(); } catch (_) {} }
            })
            .catch((err) => { this.logger.log("core", `watch mode: initial findMissingModules failed: ${err && err.message || err}`, "warn"); });
    }

    _recordWatchSessionChanges(triggeredByContexts, snapshot) {
        const diff = snapshot?.compatibilityDiff;
        if (!diff || !diff.hasPreviousScan) return;
        const hasAnything = diff.changedChecks.length > 0
            || (diff.matchedViaDrifts || []).length > 0
            || diff.missingStores.length > 0
            || diff.newStores.length > 0;
        if (!hasAnything) return;
        this._watchSessionChanges.push({
            at: snapshot.capturedAt,
            triggeredByContexts: [...triggeredByContexts],
            changedChecks: diff.changedChecks,
            matchedViaDrifts: diff.matchedViaDrifts || [],
            missingStores: diff.missingStores,
            newStores: diff.newStores
        });
    }

    stopWatchMode() {
        if (this._watchDispatcherSubscriptions.length > 0) {
            const dispatcher = this._dispatcher;
            for (const { actionType, handler } of this._watchDispatcherSubscriptions) {
                try {
                    if (dispatcher && typeof dispatcher.unsubscribe === "function") dispatcher.unsubscribe(actionType, handler);
                } catch (_) {}
            }
            this._watchDispatcherSubscriptions = [];
        }
        if (this._watchMutationObserver) {
            try { this._watchMutationObserver.disconnect(); } catch (_) {}
            this._watchMutationObserver = null;
        }
        if (this._watchModeActive) {
            const seenList = [...this._watchSeenContexts];
            this.logger.log("core", `watch mode stopped - contexts seen this session: [${seenList.join(", ") || "none"}] - ${this._watchSessionChanges.length} scan(s) found changes.`, "info");
        }
        this._watchModeActive = false;
        this._watchScanInFlight = false;
        this._watchOnUpdate = null;
        this._watchNextScanTrigger = null;
        this._watchSessionEndedAt = Date.now();
    }

    isWatchModeActive() {
        return this._watchModeActive;
    }


    _startAutoCheck() {
        this._stopAutoCheck();
        const poll = async () => {
            if (this._autoScanInFlight) return;
            const liveBuild = this._detectBuildNumber();
            if (!liveBuild) return;
            const lastKnown = this.lastSnapshot?.discordBuildNumber ?? this.loadLastSnapshot()?.discordBuildNumber;
            if (lastKnown === liveBuild) return;
            this._autoScanInFlight = true;
            try {
                this.logger.log("core", `build change detected (${lastKnown || "none"} → ${liveBuild}) - running compatibility check automatically.`, "info");
                await this.runFullScan();
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
            const brokenSignature = brokenNow.map(c => c.label).sort().join("|");

            if (brokenNow.length > 0) {
                if (brokenSignature === this._lastNotifiedBrokenSignature) return;
                this._lastNotifiedBrokenSignature = brokenSignature;
                BdApi.UI.showToast(
                    `Probe: Discord update broke ${brokenNow.length} ByeBlocked check(s) - ${brokenNow.map(c => c.label).slice(0, 3).join(", ")}${brokenNow.length > 3 ? "…" : ""}`,
                    { type: "error", timeout: 10000 }
                );
            } else {
                const wasBroken = !!this._lastNotifiedBrokenSignature;
                this._lastNotifiedBrokenSignature = null;
                if (wasBroken) {
                    BdApi.UI.showToast(`Probe: previously broken check(s) are now resolved.`, { type: "success" });
                } else if (diff && diff.hasPreviousScan && diff.changedChecks.length > 0) {
                    BdApi.UI.showToast(`Probe: Discord updated - compatibility re-checked, all still resolved.`, { type: "success" });
                }
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
            allEntities: this._allEntities,
            checks: buildCompatibilityChecks(this.logger),
            activeContexts: this._detectActiveContexts(),
            historyLookup: (label, plugin) => this._summarizeCheckHistory(label, plugin)
        });

        return [webpackScanner, storeScanner, compatibility];
    }

    _buildFingerprintWatchdog(compatEntities) {
        const compatibilityResults = (compatEntities || [])
            .filter(e => e.type === "compatibility" && Array.isArray(e.data?.checks))
            .flatMap(e => e.data.checks);

        return new FingerprintWatchdog({
            logger: this.logger,
            bootstrap: this.webpackBootstrap,
            checks: buildCompatibilityChecks(this.logger),
            compatibilityResults
        });
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
            checks: buildCompatibilityChecks(this.logger)
        });

        const result = await finder.find(currentChecks, onProgress);

        this.logger.log("core", `findMissingModules: found ${result.candidatesFound} candidate(s) in ${Date.now() - startedAt}ms (read-only - nothing executed).`);

        return result;
    }

    async runFullScan() {
        if (this._scanInFlight) {
            this.logger.log("core", "scan already in progress - skipping concurrent runFullScan.", "warn");
            return this.lastSnapshot || this.loadLastSnapshot() || null;
        }
        this._scanInFlight = true;
        try {
            return await this._runFullScanImpl();
        } finally {
            this._scanInFlight = false;
        }
    }

    async _runFullScanImpl() {
        const startedAt = Date.now();

        const freshRequire = this.webpackBootstrap.getRequire(true);
        const resolvedCount = freshRequire && freshRequire.c ? Object.keys(freshRequire.c).length : 0;
        const factoryCount = freshRequire && freshRequire.m ? Object.keys(freshRequire.m).length : 0;
        this.logger.log("core", `scan start - wpRequire: ${resolvedCount} resolved modules, ${factoryCount} factories.`, "info");

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

        const fingerprintWatchdog = this._buildFingerprintWatchdog(compatEntities);
        const { entities: watchdogEntities, stats: watchdogStats } = await this.runner.run(fingerprintWatchdog);
        allEntities.push(...watchdogEntities);
        moduleStats.push(watchdogStats);

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

        if (this._watchModeActive) {
            const trigger = this._watchNextScanTrigger || ["manual/auto-check (not a new screen)"];
            this._watchNextScanTrigger = null;
            this._recordWatchSessionChanges(trigger, snapshot);
        }

        const overallStats = this._computeOverallStats(snapshot);
        if (compatibilityDiff.hasPreviousScan && compatibilityDiff.changedChecks.length > 0) {
            this.logger.log("core",
                `scan complete: ${allEntities.length} entity(ies) in ${Date.now() - startedAt}ms - Compatibility: ${overallStats.overall} - ` +
                `${compatibilityDiff.changedChecks.length} check(s) changed status since last scan: ` +
                `${compatibilityDiff.changedChecks.map(c => `${c.label} (${c.before}→${c.after})`).join(", ")}`,
                "warn");
        } else {
            this.logger.log("core", `scan complete: ${allEntities.length} entity(ies) in ${Date.now() - startedAt}ms - Compatibility: ${overallStats.overall} - status unchanged since last scan.`);
        }
        this._notifyIfBroken(snapshot);
        return snapshot;
    }

    _sourceHashForMatchedVia(matchedVia, snapshotEntities) {
        if (!matchedVia) return null;
        const id = Array.isArray(matchedVia) ? matchedVia[0] : matchedVia;
        if (typeof id !== "string" && typeof id !== "number") return null;
        const entity = snapshotEntities.find(e => e.type === "webpackModule" && e.data?.moduleId === id);
        return entity?.data?.sourceHash || null;
    }

    _matchedViaEqual(a, b) {
        if (a === b) return true;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((v, i) => v === b[i]);
        }
        return false;
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
                    prev.matchedVia && c.matchedVia && !this._matchedViaEqual(prev.matchedVia, c.matchedVia)
                ) {
                    const prevHash = this._sourceHashForMatchedVia(prev.matchedVia, previousSnapshot.entities);
                    const currHash = this._sourceHashForMatchedVia(c.matchedVia, currentEntities);
                    const hashComparable = !!prevHash && !!currHash;
                    matchedViaDrifts.push({
                        plugin: c.plugin,
                        label: c.label,
                        before: prev.matchedVia,
                        after: c.matchedVia,
                        sourceHashComparable: hashComparable,
                        likelyRenumberedOnly: hashComparable ? prevHash === currHash : null
                    });
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
            scanCoverageNote: "Partial scan: only webpack modules already resolved in this session are captured. CompatibilityModule falls back to a live BdApi.Webpack lookup for anything missing from the snapshot, so this gap matters less here than it would for a full structural map - but navigating through more of the app before re-scanning still helps."
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
            this._checkHistoryCache = null;
        } catch (err) {
            this.logger.log("core", `failed to append check history: ${err && err.message || err}`, "warn");
        }
    }

    _loadCheckHistory() {
        if (this._checkHistoryCache) return this._checkHistoryCache;
        try {
            const history = BdApi.Data.load(this.pluginName, "checkHistory");
            const result = Array.isArray(history) ? history : [];
            this._checkHistoryCache = result;
            return result;
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
                BdApi.UI.showToast("No snapshot available - run a scan first.", { type: "warn" });
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
            BdApi.UI.showToast("Failed to export snapshot - check the console.", { type: "error" });
        }
    }

    _styleButton(btn, variant = "secondary") {
        btn.style.padding = "6px 12px";
        btn.style.borderRadius = "4px";
        btn.style.border = "none";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "13px";
        btn.style.fontWeight = "500";
        btn.style.whiteSpace = "nowrap";
        if (variant === "primary") {
            btn.style.background = "var(--brand-experiment, #5865f2)";
            btn.style.color = "#fff";
        } else if (variant === "danger") {
            btn.style.background = "var(--background-modifier-selected, #3a3c43)";
            btn.style.color = this._statusColor("not_resolved");
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

    _statusGroupMeta(groupKey) {
        switch (groupKey) {
            case "broken": return { label: "Broken", color: this._statusColor("not_resolved"), icon: "\u26D4" };
            case "warning": return { label: "Needs attention", color: this._statusColor("plausible"), icon: "\u26A0\uFE0F" };
            case "cannot_verify": return { label: "Cannot verify (inconclusive)", color: this._statusColor("cannot_verify"), icon: "\u2753" };
            case "resolved": return { label: "Resolved", color: this._statusColor("resolved"), icon: "\u2705" };
            default: return { label: groupKey, color: "var(--text-normal)", icon: "" };
        }
    }

    _groupKeyForStatus(status) {
        if (status === "not_resolved" || status === "fallback_broken") return "broken";
        if (status === "fallback_renamed" || status === "plausible") return "warning";
        if (status === "cannot_verify") return "cannot_verify";
        return "resolved";
    }

    _computeOverallStats(snapshot) {
        const compatEntities = (snapshot?.entities || []).filter(e => e.type === "compatibility");
        const totals = {
            total: 0, resolved: 0, failed: 0, warnings: 0,
            contextsMissing: 0, contextSkipped: 0,
            historyCoveredUnstable: 0
        };
        for (const ce of compatEntities) {
            const summaries = ce.data.summaryByPluginContextAware || ce.data.summaryByPlugin || {};
            for (const counts of Object.values(summaries)) {
                totals.total += counts.total || 0;
                totals.resolved += counts.resolved || 0;
                totals.failed += (counts.not_resolved || 0) + (counts.fallback_broken || 0);
                totals.warnings += (counts.fallback_renamed || 0) + (counts.plausible || 0);
                totals.contextsMissing += counts.cannot_verify || 0;
                totals.contextSkipped += counts.context_not_active || 0;
            }
            for (const c of ce.data.checks || []) {
                if (c.historicalCoverage && c.historicalCoverage.verdict === "unstable") totals.historyCoveredUnstable++;
            }
        }
        const totalScanTimeMs = (snapshot?.moduleStats || []).reduce((sum, s) => sum + (s.durationMs || 0), 0);
        const overall = totals.failed > 0 ? "FAIL" : totals.warnings > 0 ? "WARN" : "PASS";
        return { ...totals, totalScanTimeMs, overall };
    }

    _copyToClipboard(text, btn, restoreLabel) {
        const restore = () => { btn.textContent = restoreLabel; };
        const onOk = () => { btn.textContent = "\u2705 Copied!"; setTimeout(restore, 1500); };
        const onFail = () => { btn.textContent = "\u26A0 Copy failed"; setTimeout(restore, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(onOk).catch(onFail);
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
                onOk();
            } catch (_) {
                onFail();
            }
        }
    }

    _el(tag, styles, text) {
        const e = document.createElement(tag);
        if (styles) Object.assign(e.style, styles);
        if (text !== undefined) e.textContent = text;
        return e;
    }

    _badge(text, color) {
        const b = this._el("span", {
            display: "inline-block",
            padding: "2px 7px",
            borderRadius: "3px",
            fontSize: "11px",
            fontWeight: "600",
            marginLeft: "6px",
            background: "rgba(255,255,255,0.06)",
            color: color || "var(--text-normal)"
        }, text);
        return b;
    }

    _buildOverviewTab(snapshot) {
        const wrap = this._el("div");
        const compatEntity = snapshot?.entities?.find(e => e.type === "compatibility");
        if (!compatEntity) {
            wrap.appendChild(this._el("div", { opacity: "0.7", padding: "20px 0", textAlign: "center" },
                "No scan yet. Run a compatibility check to see results here."));
            return wrap;
        }

        wrap.appendChild(this._buildOverallSummaryBlock(snapshot));

        const { featureSummary } = compatEntity.data;
        if (featureSummary) {
            wrap.appendChild(this._buildFeatureSummaryBlock(featureSummary));
        }

        const watchdogEntity = snapshot?.entities?.find(e => e.type === "fingerprintWatchdog");
        if (watchdogEntity && watchdogEntity.data.driftCount > 0) {
            wrap.appendChild(this._buildFingerprintWatchdogBlock(watchdogEntity.data));
        }

        const diff = snapshot.compatibilityDiff;
        const hasDiff = diff && diff.hasPreviousScan && (diff.changedChecks.length > 0 || (diff.matchedViaDrifts || []).length > 0 || diff.newStores.length > 0 || diff.missingStores.length > 0);
        if (hasDiff) wrap.appendChild(this._buildDiffBlock(diff));

        if (diff && diff.buildChanged && Array.isArray(diff.structuralChanges) && diff.structuralChanges.length > 0) {
            wrap.appendChild(this._buildStructuralChangesBlock(diff, snapshot));
        }

        const { pendingContexts } = compatEntity.data;
        if (Array.isArray(pendingContexts) && pendingContexts.length > 0) {
            wrap.appendChild(this._buildPendingContextsBlock(pendingContexts));
        }

        if (this._lastFindResult && this._lastFindResult.candidatesFound > 0) {
            wrap.appendChild(this._buildFindResultBlock(this._lastFindResult));
        }

        if (!hasDiff && (!Array.isArray(pendingContexts) || pendingContexts.length === 0) && (!this._lastFindResult || this._lastFindResult.candidatesFound === 0)) {
            wrap.appendChild(this._el("div", { opacity: "0.55", fontSize: "12px", padding: "6px 2px" },
                "Nothing else to flag right now - check the Checks tab for the full breakdown."));
        }

        return wrap;
    }

    _featureStatusMeta(status) {
        switch (status) {
            case "healthy": return { label: "Working", color: this._statusColor("resolved"), icon: "\u2705" };
            case "degraded": return { label: "Broken", color: this._statusColor("not_resolved"), icon: "\u26D4" };
            case "heartbeat_stale": return { label: "Installed but not firing", color: this._statusColor("plausible"), icon: "\uD83D\uDC94" };
            case "cannot_verify": return { label: "No data yet", color: this._statusColor("cannot_verify"), icon: "\u2753" };
            default: return { label: status, color: "var(--text-normal)", icon: "" };
        }
    }

    _buildFeatureSummaryBlock(featureSummary) {
        const overallMeta = featureSummary.overall === "SAFE"
            ? { label: "All critical features confirmed working", color: this._statusColor("resolved"), icon: "\u2705" }
            : featureSummary.overall === "UNSAFE"
            ? { label: "At least one critical feature is broken or not firing", color: this._statusColor("not_resolved"), icon: "\u26D4" }
            : { label: "No critical feature data in this scan yet - open ByeBlocked's settings or wait for its next health cycle", color: this._statusColor("cannot_verify"), icon: "\u2753" };

        const box = this._el("div", {
            padding: "12px 14px", marginBottom: "14px", borderRadius: "8px",
            background: "var(--background-secondary)", fontSize: "12px",
            border: `1px solid ${overallMeta.color}33`
        });

        box.appendChild(this._el("div", {
            fontWeight: "700", fontSize: "13px", marginBottom: "10px",
            color: overallMeta.color, display: "flex", alignItems: "center", gap: "6px"
        }, `${overallMeta.icon} ${overallMeta.label}`));

        const tierOrder = ["critical", "important", "optional"];
        const tierLabels = { critical: "Critical", important: "Important", optional: "Optional" };
        for (const tier of tierOrder) {
            const tierFeatures = featureSummary.features.filter(f => f.tier === tier);
            if (tierFeatures.length === 0) continue;
            box.appendChild(this._el("div", {
                fontSize: "10.5px", fontWeight: "600", opacity: "0.6", marginTop: "8px", marginBottom: "4px", textTransform: "uppercase"
            }, tierLabels[tier]));
            for (const f of tierFeatures) {
                const meta = this._featureStatusMeta(f.status);
                const row = this._el("div", {
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "4px 8px", marginBottom: "2px", borderRadius: "4px",
                    background: "var(--background-modifier-accent)"
                });
                const left = this._el("div", { display: "flex", alignItems: "center", gap: "6px" });
                left.appendChild(this._el("span", {}, meta.icon));
                left.appendChild(this._el("span", { fontWeight: "500" }, f.label));
                row.appendChild(left);
                row.appendChild(this._el("span", { color: meta.color, fontWeight: "600", fontSize: "11px" }, meta.label));
                box.appendChild(row);
                if (f.reason) {
                    box.appendChild(this._el("div", { fontSize: "10.5px", opacity: "0.7", marginLeft: "4px", marginBottom: "4px" }, f.reason));
                }
            }
        }

        return box;
    }

    _buildFingerprintWatchdogBlock(watchdogData) {
        const box = this._el("div", {
            padding: "10px 12px", marginBottom: "10px", borderRadius: "6px",
            background: "var(--background-modifier-accent)", fontSize: "12px"
        });

        const driftTypeMeta = {
            "fingerprint-found-api-missed": { color: this._statusColor("not_resolved"), icon: "\u26A0\uFE0F" },
            "api-found-fingerprint-missed": { color: this._statusColor("cannot_verify"), icon: "\u2139\uFE0F" },
            "matched-via-mismatch": { color: this._statusColor("plausible"), icon: "\u26A0\uFE0F" }
        };

        const hasWarnDrift = watchdogData.drifts.some(d => d.severity === "warn");
        const headerColor = hasWarnDrift ? this._statusColor("not_resolved") : this._statusColor("cannot_verify");
        const headerIcon = hasWarnDrift ? "\u26A0\uFE0F" : "\u2139\uFE0F";

        box.appendChild(this._el("div", { fontWeight: "600", marginBottom: "6px", color: headerColor },
            `${headerIcon} Fingerprint Watchdog: ${watchdogData.driftCount} drift(s) between BD's public API and independent source-fingerprinting (${watchdogData.crossCheckedCount} check(s) cross-verified):`));

        for (const d of watchdogData.drifts) {
            const meta = driftTypeMeta[d.driftType] || { color: "var(--text-normal)", icon: "\u2022" };
            box.appendChild(this._el("div", { color: meta.color, marginBottom: "2px" },
                `${meta.icon} ${d.plugin}: ${d.label} - ${d.message}`));
        }

        box.appendChild(this._el("div", { opacity: "0.65", fontSize: "10.5px", marginTop: "6px" },
            "Read-only comparison - nothing is applied automatically. \"Fingerprint found, API missed\" candidates are worth adding to the check's candidates/needles manually after you confirm they're the right module."));

        return box;
    }


    _buildOverallSummaryBlock(snapshot) {
        const stats = this._computeOverallStats(snapshot);
        const overallColor = stats.overall === "FAIL" ? this._statusColor("not_resolved")
            : stats.overall === "WARN" ? this._statusColor("plausible")
            : this._statusColor("resolved");
        const overallLabel = stats.overall === "FAIL" ? "Not compatible"
            : stats.overall === "WARN" ? "Mostly compatible"
            : "Compatible";
        const overallIcon = stats.overall === "FAIL" ? "\u26D4" : stats.overall === "WARN" ? "\u26A0\uFE0F" : "\u2705";

        const box = this._el("div", {
            padding: "14px",
            marginBottom: "14px",
            borderRadius: "8px",
            background: "var(--background-secondary)",
            fontSize: "12px",
            border: `1px solid ${overallColor}33`
        });

        const topRow = this._el("div", { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "6px" });

        const statusPill = this._el("div", {
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "4px 10px", borderRadius: "20px",
            background: `${overallColor}22`, color: overallColor,
            fontWeight: "700", fontSize: "14px"
        });
        statusPill.textContent = `${overallIcon} ${overallLabel}`;
        topRow.appendChild(statusPill);
        topRow.appendChild(this._el("div", { opacity: "0.6", fontSize: "11px" }, `Scan took ${stats.totalScanTimeMs}ms`));
        box.appendChild(topRow);

        const grid = this._el("div", { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "10px 8px" });
        const cells = [
            ["Checks passed", `${stats.resolved} / ${stats.total}`, null],
            ["Failed", String(stats.failed), stats.failed > 0 ? this._statusColor("not_resolved") : null],
            ["Warnings", String(stats.warnings), stats.warnings > 0 ? this._statusColor("plausible") : null],
            ["Needs more info", String(stats.contextsMissing), null],
            ["Not applicable now", String(stats.contextSkipped), null]
        ];
        if (stats.historyCoveredUnstable > 0) {
            cells.push(["Unstable history", String(stats.historyCoveredUnstable), this._statusColor("not_resolved")]);
        }
        for (const [label, value, color] of cells) {
            const cell = this._el("div");
            const valEl = this._el("div", { fontWeight: "700", fontSize: "16px" }, value);
            if (color) valEl.style.color = color;
            cell.appendChild(valEl);
            cell.appendChild(this._el("div", { opacity: "0.6", fontSize: "10.5px", marginTop: "1px" }, label));
            grid.appendChild(cell);
        }
        box.appendChild(grid);
        return box;
    }

    _buildDiffBlock(diff) {
        const diffBox = this._el("div", {
            padding: "10px 12px", marginBottom: "10px", borderRadius: "6px",
            background: "var(--background-modifier-accent)", fontSize: "12px"
        });
        diffBox.appendChild(this._el("div", { fontWeight: "600", marginBottom: "6px" },
            `Changed since last scan (${new Date(diff.previousScanCapturedAt).toLocaleString("en-US")}):`));
        for (const c of diff.changedChecks) {
            diffBox.appendChild(this._el("div", { color: this._statusColor(c.after), marginBottom: "2px" },
                `${c.plugin}: ${c.label} - ${c.before} \u2192 ${c.after}`));
        }
        const fmtMatchedVia = (v) => Array.isArray(v) ? `[${v.join(", ")}]` : String(v);
        for (const d of (diff.matchedViaDrifts || [])) {
            const beforeTxt = fmtMatchedVia(d.before);
            const afterTxt = fmtMatchedVia(d.after);
            let line;
            if (d.sourceHashComparable && d.likelyRenumberedOnly) {
                line = this._el("div", { color: "var(--text-muted)", marginBottom: "2px" },
                    `${d.plugin}: ${d.label} - matched a different module id than last scan (${beforeTxt} \u2192 ${afterTxt}), but source content is identical (likely just renumbered by webpack).`);
            } else if (d.sourceHashComparable) {
                line = this._el("div", { color: this._statusColor("not_resolved"), marginBottom: "2px" },
                    `${d.plugin}: ${d.label} - still resolved, but via a different match AND different source content (${beforeTxt} \u2192 ${afterTxt}). Worth reviewing.`);
            } else {
                line = this._el("div", { color: this._statusColor("plausible"), marginBottom: "2px" },
                    `${d.plugin}: ${d.label} - still resolved, but via a different match than last scan (${beforeTxt} \u2192 ${afterTxt}). Possible early sign of an in-progress rename.`);
            }
            diffBox.appendChild(line);
        }
        if (diff.missingStores.length > 0) {
            diffBox.appendChild(this._el("div", { color: this._statusColor("not_resolved"), marginBottom: "2px" },
                `Store(s) no longer found: ${diff.missingStores.join(", ")}`));
        }
        if (diff.newStores.length > 0) {
            diffBox.appendChild(this._el("div", { opacity: "0.8", marginBottom: "2px" },
                `New store(s) resolved this scan: ${diff.newStores.join(", ")}`));
        }
        return diffBox;
    }

    _buildStructuralChangesBlock(diff, snapshot) {
        const buildBox = this._el("div", {
            padding: "10px 12px", marginBottom: "10px", borderRadius: "6px",
            background: "var(--background-modifier-accent)", fontSize: "12px"
        });
        buildBox.appendChild(this._el("div", { fontWeight: "600", marginBottom: "6px" },
            `Build changed (${diff.previousBuildNumber || "unknown"} \u2192 ${snapshot.discordBuildNumber || "unknown"}) - per-store structural comparison:`));
        const order = { changed: 0, unchanged: 1, not_observed: 2 };
        const sortedChanges = [...diff.structuralChanges].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        for (const sc of sortedChanges) {
            let line;
            if (sc.status === "changed") {
                const addedTxt = sc.added.length > 0 ? ` +[${sc.added.join(", ")}]` : "";
                const removedTxt = sc.removed.length > 0 ? ` -[${sc.removed.join(", ")}]` : "";
                line = this._el("div", { color: this._statusColor("not_resolved"), marginBottom: "2px" },
                    `${sc.name}: changed${addedTxt}${removedTxt}`);
            } else if (sc.status === "unchanged") {
                line = this._el("div", { opacity: "0.6", marginBottom: "2px" }, `${sc.name}: unchanged`);
            } else {
                line = this._el("div", { opacity: "0.5", fontStyle: "italic", marginBottom: "2px" },
                    `${sc.name}: not observed in one of the two scans (lazy-loaded - not a finding)`);
            }
            buildBox.appendChild(line);
        }
        return buildBox;
    }

    _buildPendingContextsBlock(pendingContexts) {
        const ctxBox = this._el("div", {
            padding: "10px 12px", marginBottom: "10px", borderRadius: "6px",
            background: "var(--background-modifier-accent)", fontSize: "12px"
        });
        ctxBox.appendChild(this._el("div", { fontWeight: "600", marginBottom: "6px" },
            `${pendingContexts.length} scenario(s) needed for deeper investigation - open these, then re-scan:`));
        for (const p of pendingContexts) {
            const hasHardSuspicion = p.genuinelySuspicious > 0 && !p.genuinelySuspiciousNote;
            const hasSoftSuspicion = p.genuinelySuspicious > 0 && !!p.genuinelySuspiciousNote;
            let suspiciousNote = "";
            if (hasHardSuspicion) {
                suspiciousNote = ` (${p.genuinelySuspicious} of these failed WITH the context already active - may be a real break, not just missing navigation)`;
            } else if (hasSoftSuspicion) {
                suspiciousNote = ` (${p.genuinelySuspicious} of these failed WITH the context already active - but detection uses a separate selector from the check itself, so this may just mean one selector drifted rather than the feature breaking; worth a second look, not confirmed)`;
            }
            const line = this._el("div", { marginBottom: "2px" },
                `${p.context} - affects ${p.affectedCheckCount} check(s): ${p.checks.map(c => c.label).join(", ")}${suspiciousNote}`);
            if (hasHardSuspicion) line.style.color = this._statusColor("not_resolved");
            else if (hasSoftSuspicion) line.style.color = this._statusColor("cannot_verify");
            ctxBox.appendChild(line);

            if (p.coverage && p.coverage.note) {
                const coverageLine = this._el("div", {
                    fontSize: "11px", marginBottom: "6px", marginLeft: "8px",
                    opacity: "0.9", color: this._statusColor("not_resolved")
                }, `⚠ ${p.coverage.note}`);
                ctxBox.appendChild(coverageLine);
            }
        }
        return ctxBox;
    }

    _buildFindResultBlock(result) {
        const box = this._el("div", {
            padding: "10px 12px", marginBottom: "10px", borderRadius: "6px",
            background: "var(--background-modifier-accent)", fontSize: "12px"
        });
        box.appendChild(this._el("div", { fontWeight: "600", marginBottom: "4px" },
            `${result.candidatesFound} unresolved module(s) likely match a pending check (read-only - none executed):`));
        box.appendChild(this._el("div", { opacity: "0.7", marginBottom: "6px" },
            "Open the Discord screen where the matching feature lives, then re-run the compatibility check - that lets the module load normally instead of being forced."));

        for (const c of result.candidates.slice(0, 20)) {
            const checksTxt = Array.isArray(c.matchedChecks) && c.matchedChecks.length > 0
                ? c.matchedChecks.map(mc => `${mc.label} (${mc.hitCount}/${mc.needed})`).join("; ")
                : (c.matchedTerms || []).join(", ");
            box.appendChild(this._el("div", { marginBottom: "2px", fontFamily: "monospace" }, `#${c.id} - matches: ${checksTxt}`));
        }
        if (result.candidates.length > 20) {
            box.appendChild(this._el("div", { opacity: "0.6", marginTop: "4px" },
                `...and ${result.candidates.length - 20} more (export the full snapshot to see all).`));
        }
        return box;
    }

    _buildChecksTab(snapshot) {
        const wrap = this._el("div");
        const compatEntity = snapshot?.entities?.find(e => e.type === "compatibility");
        if (!compatEntity) {
            wrap.appendChild(this._el("div", { opacity: "0.7", padding: "20px 0", textAlign: "center" }, "No compatibility data in this snapshot. Run a scan."));
            return wrap;
        }

        const { summaryByPlugin, summaryByPluginContextAware, checks } = compatEntity.data;
        const effectiveSummaryByPlugin = summaryByPluginContextAware || summaryByPlugin;

        for (const [plugin, counts] of Object.entries(effectiveSummaryByPlugin || {})) {
            wrap.appendChild(this._buildPluginChecksSection(plugin, counts, checks));
        }
        return wrap;
    }

    _buildPluginChecksSection(plugin, counts, checks) {
        const section = this._el("div", { marginBottom: "14px" });

        const brokenTotal = (counts.not_resolved || 0) + (counts.fallback_broken || 0);
        const warnTotal = (counts.fallback_renamed || 0) + (counts.plausible || 0);
        const unverifiedTotal = counts.cannot_verify || 0;
        const contextSkippedTotal = counts.context_not_active || 0;

        const pluginChecks = (checks || []).filter(c => c.plugin === plugin);
        const plausibleChecks = pluginChecks.filter(c => c.status === "plausible");
        const likelyTruncationCount = plausibleChecks.filter(c => c.investigation?.verdict === "likely_truncation").length;
        const allWarningsAreLikelyTruncation = warnTotal > 0
            && (counts.fallback_renamed || 0) === 0
            && plausibleChecks.length === (counts.plausible || 0)
            && likelyTruncationCount === plausibleChecks.length;

        const contextSkippedSuffix = contextSkippedTotal > 0 ? ` (+${contextSkippedTotal} skipped, context not active)` : "";
        const headerText = brokenTotal > 0
            ? `${plugin} - ${brokenTotal} check(s) BROKEN${contextSkippedSuffix}`
            : warnTotal > 0
                ? allWarningsAreLikelyTruncation
                    ? `${plugin} - ${warnTotal} check(s) show a partial match, likely just truncated snippets (low priority)${contextSkippedSuffix}`
                    : `${plugin} - ${warnTotal} check(s) need attention${contextSkippedSuffix}`
                : unverifiedTotal > 0
                    ? `${plugin} - ${counts.resolved} of ${counts.total} checks resolved (${unverifiedTotal} inconclusive - see cannot_verify below)${contextSkippedSuffix}`
                    : `${plugin} - all ${counts.total} checks resolved${contextSkippedSuffix}`;
        const headerColor = brokenTotal > 0 ? this._statusColor("not_resolved")
            : warnTotal > 0 ? (allWarningsAreLikelyTruncation ? "var(--text-muted, #949ba4)" : this._statusColor("plausible"))
            : unverifiedTotal > 0 ? this._statusColor("cannot_verify")
            : this._statusColor("resolved");
        section.appendChild(this._el("div", { fontWeight: "700", fontSize: "13px", marginBottom: "8px", color: headerColor }, headerText));

        const groups = { broken: [], warning: [], cannot_verify: [], resolved: [] };
        for (const check of pluginChecks) {
            groups[this._groupKeyForStatus(check.status)].push(check);
        }

        const groupOrder = ["broken", "warning", "cannot_verify", "resolved"];
        for (const groupKey of groupOrder) {
            const items = groups[groupKey];
            if (items.length === 0) continue;
            section.appendChild(this._buildStatusGroup(groupKey, items));
        }

        return section;
    }

    _buildStatusGroup(groupKey, items) {
        const meta = this._statusGroupMeta(groupKey);
        const openByDefault = groupKey !== "resolved";

        const details = this._el("details", { marginBottom: "6px" });
        if (openByDefault) details.open = true;

        const summary = this._el("summary", {
            cursor: "pointer", fontWeight: "600", fontSize: "12px",
            padding: "6px 8px", borderRadius: "4px",
            background: "var(--background-secondary)",
            color: meta.color, listStyle: "none", display: "flex", alignItems: "center", gap: "6px"
        });
        summary.appendChild(document.createTextNode(`${meta.icon} ${meta.label}`));
        summary.appendChild(this._badge(String(items.length), meta.color));
        details.appendChild(summary);

        const list = this._el("div", { marginTop: "6px", paddingLeft: "4px" });
        const priority = { not_resolved: 0, fallback_broken: 1, fallback_renamed: 2, plausible: 3, cannot_verify: 4, resolved: 5 };
        const sorted = [...items].sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
        for (const check of sorted) {
            list.appendChild(this._buildCheckRow(check));
        }
        details.appendChild(list);
        return details;
    }

    _buildCheckRow(check) {
        const row = this._el("div", {
            padding: "6px 8px",
            borderLeft: `3px solid ${this._statusColor(check.status)}`,
            marginBottom: "4px",
            background: "var(--background-secondary)",
            fontSize: "12px"
        });

        row.appendChild(this._el("div", { fontWeight: "600" }, `[${check.status}] ${check.plugin}: ${check.label}`));

        if (check.heartbeat && check.heartbeat.tracked && !check.heartbeat.alive) {
            const hb = check.heartbeat;
            const hbLine = this._el("div", {
                fontSize: "11px", marginTop: "3px", padding: "4px 6px",
                borderRadius: "4px", background: "var(--background-modifier-accent)",
                color: this._statusColor("plausible")
            });
            hbLine.appendChild(this._el("div", { fontWeight: "600", marginBottom: "2px" }, "\uD83D\uDC94 HEARTBEAT: NOT FIRING"));
            hbLine.appendChild(document.createTextNode(
                hb.neverFired
                    ? "Patch is installed but has never reported a heartbeat since it started."
                    : `Patch is installed but hasn't reported a heartbeat in ${Math.round(hb.msSinceHeartbeat / 60000)}min.`
            ));
            row.appendChild(hbLine);
        }

        if (check.historicalCoverage) {
            const hc = check.historicalCoverage;
            const coverageLine = this._el("div", {
                fontSize: "11px", marginTop: "3px", padding: "4px 6px",
                borderRadius: "4px", background: "var(--background-modifier-accent)",
                color: this._statusColor("not_resolved")
            });
            coverageLine.appendChild(this._el("div", { fontWeight: "600", marginBottom: "2px" }, "⚠ HISTORY: UNSTABLE"));
            coverageLine.appendChild(document.createTextNode(hc.note));
            row.appendChild(coverageLine);
        }

        const hist = this._summarizeCheckHistory(check.label, check.plugin);
        if (hist.scansObserved >= 2) {
            const histLine = this._el("div", { fontSize: "11px", marginTop: "2px", opacity: "0.75" });
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
            histLine.textContent = `History: ${parts.join(" - ")}.`;
            row.appendChild(histLine);
        }

        if (check.investigation?.verdict && check.investigation.verdict !== "unknown") {
            row.appendChild(this._buildVerdictTag(check.investigation.verdict));
        }

        if (check.note) {
            row.appendChild(this._el("div", { opacity: "0.75", marginTop: "2px" }, check.note));
        }

        if (check.requiresContext) {
            row.appendChild(this._el("div", { opacity: "0.6", marginTop: "2px", fontStyle: "italic" }, `requires context: ${check.requiresContext}`));
        }

        if (check.investigation) {
            row.appendChild(this._buildInvestigationDetails(check));
        }

        return row;
    }

    _buildVerdictTag(verdict) {
        const tag = this._el("div", {
            marginTop: "3px", display: "inline-block", padding: "2px 6px",
            borderRadius: "3px", fontSize: "11px", fontWeight: "600"
        });
        if (verdict === "likely_discord_change") {
            tag.style.background = "rgba(237, 66, 69, 0.15)";
            tag.style.color = this._statusColor("not_resolved");
            tag.textContent = "\u26A0 Likely Discord update broke this";
        } else if (verdict === "likely_truncation") {
            tag.style.background = "rgba(148, 155, 164, 0.15)";
            tag.style.color = "var(--text-muted, #949ba4)";
            tag.textContent = "\u2702\uFE0F Likely just a truncated snippet";
        } else if (verdict === "likely_real_partial_match") {
            tag.style.background = "rgba(250, 166, 26, 0.15)";
            tag.style.color = this._statusColor("plausible");
            tag.textContent = "\uD83D\uDD0D Partial match against full source - worth a look";
        } else {
            tag.style.background = "rgba(250, 166, 26, 0.15)";
            tag.style.color = this._statusColor("plausible");
            tag.textContent = "\uD83D\uDD27 Likely a ByeBlocked-side bug";
        }
        return tag;
    }

    _buildInvestigationDetails(check) {
        const details = this._el("details", { marginTop: "4px" });

        const summaryRow = this._el("summary", {
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px"
        });
        summaryRow.appendChild(this._el("span", { color: "var(--text-link, #949cf7)" }, "Investigation details"));

        const copyBtn = this._el("button", {
            fontSize: "11px", padding: "2px 8px", borderRadius: "3px",
            border: "1px solid var(--background-modifier-accent, #4a4a4a)",
            background: "var(--background-secondary, #2b2d31)", color: "var(--text-normal)", cursor: "pointer"
        }, "\uD83D\uDCCB Copy");
        copyBtn.type = "button";
        copyBtn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const payload = {
                plugin: check.plugin, label: check.label, status: check.status,
                verdict: check.investigation?.verdict, note: check.note, investigation: check.investigation
            };
            let text;
            try { text = JSON.stringify(payload, null, 2); } catch (_) { text = "(could not serialize investigation data)"; }
            this._copyToClipboard(text, copyBtn, "\uD83D\uDCCB Copy");
        };
        summaryRow.appendChild(copyBtn);
        details.appendChild(summaryRow);

        const topBroadCandidate = check.investigation?.broadScan?.candidates?.[0];
        if (topBroadCandidate && topBroadCandidate.storeName) {
            const replaceBtn = this._el("button", {
                marginLeft: "6px", fontSize: "11px", padding: "2px 6px", cursor: "pointer"
            }, `\uD83D\uDCCB Copy replacement: "${topBroadCandidate.storeName}"`);
            replaceBtn.title = topBroadCandidate.methodsExpectedCount > 0
                ? `${topBroadCandidate.methodHitCount}/${topBroadCandidate.methodsExpectedCount} expected methods matched. Copies just the name string, ready to add to this check's candidates array.`
                : `Name-similarity match only (no expectedMethods declared for this check) - verify manually. Copies just the name string.`;
            replaceBtn.onclick = () => this._copyToClipboard(topBroadCandidate.replacementSnippet, replaceBtn, replaceBtn.textContent);
            summaryRow.appendChild(replaceBtn);
        }

        const topStructuralFinding = (check.investigation?.perKeyFindings || []).find(f => f.replacementSnippet);
        if (topStructuralFinding) {
            const bestGuess = topStructuralFinding.renameCandidates[0];
            const structBtn = this._el("button", {
                marginLeft: "6px", fontSize: "11px", padding: "2px 6px", cursor: "pointer"
            }, `\uD83D\uDCCB Copy updated ${topStructuralFinding.missingKeyField}: "${bestGuess.key}"`);
            structBtn.title = `Name-similarity guess only (distance ${bestGuess.distance} from "${topStructuralFinding.missingKey}") - the old key's behavior couldn't be compared since it's gone this session. Copies a ready-to-paste ${topStructuralFinding.missingKeyField} array with "${topStructuralFinding.missingKey}" replaced by "${bestGuess.key}". Verify this key actually behaves the same before using it.`;
            structBtn.onclick = () => this._copyToClipboard(topStructuralFinding.replacementSnippet, structBtn, structBtn.textContent);
            summaryRow.appendChild(structBtn);
        }

        details.appendChild(this._el("div", { marginTop: "4px", opacity: "0.85" }, check.investigation.summary || ""));

        const pre = this._el("pre", {
            whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "11px", marginTop: "4px",
            padding: "6px", background: "var(--background-tertiary, rgba(0,0,0,0.15))",
            borderRadius: "3px", maxHeight: "260px", overflow: "auto"
        });
        try { pre.textContent = JSON.stringify(check.investigation, null, 2); } catch (_) { pre.textContent = "(could not serialize investigation data)"; }
        details.appendChild(pre);

        return details;
    }

    _buildWatchTab() {
        const wrap = this._el("div");

        const statusBox = this._el("div", {
            padding: "10px 12px", marginBottom: "12px", borderRadius: "6px",
            background: "var(--background-secondary)", fontSize: "12px"
        });
        if (this.isWatchModeActive()) {
            const seen = [...this._watchSeenContexts];
            const elapsed = this._watchStartedAt ? Math.round((Date.now() - this._watchStartedAt) / 1000) : 0;
            statusBox.appendChild(this._el("div", { fontWeight: "600", color: this._statusColor("resolved"), marginBottom: "4px" },
                `\uD83D\uDC41 Watching (${elapsed}s)`));
            statusBox.appendChild(this._el("div", { opacity: "0.75" },
                `Screens seen this session: ${seen.length > 0 ? seen.join(", ") : "none yet"}. Re-checks automatically when a new one opens, and also scans for missing modules automatically.`));
        } else {
            statusBox.appendChild(this._el("div", { fontWeight: "600", opacity: "0.7" }, "\u23F9 Not watching"));
            statusBox.appendChild(this._el("div", { opacity: "0.6", marginTop: "4px" },
                "Start watching to have Probe quietly track which Discord screens you visit and re-run checks automatically."));
        }
        wrap.appendChild(statusBox);

        const summaryBlock = this._buildWatchSessionSummaryBlock();
        if (summaryBlock) {
            wrap.appendChild(summaryBlock);
        } else {
            wrap.appendChild(this._el("div", { opacity: "0.55", fontSize: "12px", padding: "6px 2px" },
                "No changes recorded yet this session."));
        }

        return wrap;
    }

    _buildWatchSessionSummaryBlock() {
        const entries = this._watchSessionChanges;
        if (!entries || entries.length === 0) return null;

        const box = this._el("div", {
            padding: "10px 12px", marginBottom: "10px", borderRadius: "6px",
            border: "1px solid var(--background-modifier-accent)",
            background: "var(--background-secondary)", fontSize: "12px"
        });

        const isActive = this.isWatchModeActive();
        const totalChanges = entries.reduce((sum, e) =>
            sum + e.changedChecks.length + e.matchedViaDrifts.length + e.missingStores.length + e.newStores.length, 0);
        box.appendChild(this._el("div", { fontWeight: "600", marginBottom: "6px" }, isActive
            ? `\uD83D\uDCCB Watch session so far: ${totalChanges} change(s) found across ${entries.length} scan(s)`
            : `\uD83D\uDCCB Watch session summary (ended ${this._watchSessionEndedAt ? new Date(this._watchSessionEndedAt).toLocaleTimeString("en-US") : ""}): ${totalChanges} change(s) found across ${entries.length} scan(s)`));

        for (const entry of entries) {
            box.appendChild(this._el("div", { opacity: "0.7", marginTop: "6px" },
                `\u2192 triggered by opening: ${entry.triggeredByContexts.join(", ")} (${new Date(entry.at).toLocaleTimeString("en-US")})`));

            for (const c of entry.changedChecks) {
                box.appendChild(this._el("div", { color: this._statusColor(c.after), marginLeft: "10px" },
                    `${c.plugin}: ${c.label} - ${c.before} \u2192 ${c.after}`));
            }
            const fmtMatchedVia = (v) => Array.isArray(v) ? `[${v.join(", ")}]` : String(v);
            for (const d of entry.matchedViaDrifts) {
                let line;
                if (d.sourceHashComparable && d.likelyRenumberedOnly) {
                    line = this._el("div", { color: "var(--text-muted)", marginLeft: "10px" },
                        `${d.plugin}: ${d.label} - matched a different module id (likely just renumbered).`);
                } else if (d.sourceHashComparable) {
                    line = this._el("div", { color: this._statusColor("not_resolved"), marginLeft: "10px" },
                        `${d.plugin}: ${d.label} - resolved via different match AND different source content (${fmtMatchedVia(d.before)} \u2192 ${fmtMatchedVia(d.after)}). Worth reviewing.`);
                } else {
                    line = this._el("div", { color: this._statusColor("plausible"), marginLeft: "10px" },
                        `${d.plugin}: ${d.label} - resolved via a different match than before. Possible early sign of an in-progress rename.`);
                }
                box.appendChild(line);
            }
            if (entry.missingStores.length > 0) {
                box.appendChild(this._el("div", { color: this._statusColor("not_resolved"), marginLeft: "10px" },
                    `Store(s) no longer found: ${entry.missingStores.join(", ")}`));
            }
            if (entry.newStores.length > 0) {
                box.appendChild(this._el("div", { opacity: "0.8", marginLeft: "10px" },
                    `New store(s) resolved: ${entry.newStores.join(", ")}`));
            }
        }

        return box;
    }

    _buildInvestigationTab(snapshot) {
        const wrap = this._el("div");
        const compatEntity = snapshot?.entities?.find(e => e.type === "compatibility");
        if (!compatEntity) {
            wrap.appendChild(this._el("div", { opacity: "0.7", padding: "20px 0", textAlign: "center" }, "No compatibility data in this snapshot. Run a scan."));
            return wrap;
        }

        const checks = compatEntity.data.checks || [];
        const flagged = checks.filter(c => c.status !== "resolved" && c.investigation);

        if (flagged.length === 0) {
            wrap.appendChild(this._el("div", { opacity: "0.6", padding: "20px 0", textAlign: "center" },
                "Nothing needs investigation right now - every non-resolved check either has no investigation data or everything is passing."));
            return wrap;
        }

        wrap.appendChild(this._el("div", { opacity: "0.7", fontSize: "12px", marginBottom: "10px" },
            `${flagged.length} check(s) with investigation data, sorted by severity:`));

        const priority = { not_resolved: 0, fallback_broken: 1, fallback_renamed: 2, plausible: 3, cannot_verify: 4 };
        const sorted = [...flagged].sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
        for (const check of sorted) {
            wrap.appendChild(this._buildCheckRow(check));
        }

        return wrap;
    }

    _buildTabBar(tabs, activeKey, onSelect) {
        const bar = this._el("div", {
            display: "flex", gap: "4px", marginBottom: "14px",
            borderBottom: "1px solid var(--background-modifier-accent)"
        });
        for (const tab of tabs) {
            const isActive = tab.key === activeKey;
            const btn = this._el("button", {
                padding: "8px 14px",
                border: "none",
                borderRadius: "4px 4px 0 0",
                borderBottom: isActive ? "2px solid var(--brand-experiment, #5865f2)" : "2px solid transparent",
                background: isActive ? "var(--background-modifier-selected, #3a3c43)" : "transparent",
                color: isActive ? "var(--text-normal)" : "var(--text-muted, #949ba4)",
                fontWeight: isActive ? "600" : "500",
                fontSize: "13px",
                cursor: "pointer",
                transition: "background 0.1s ease"
            });
            btn.type = "button";
            btn.textContent = tab.badge ? `${tab.label} (${tab.badge})` : tab.label;
            btn.onclick = () => onSelect(tab.key);
            bar.appendChild(btn);
        }
        return bar;
    }

    getSettingsPanel() {
        const panel = this._el("div", { padding: "14px", color: "var(--text-normal)" });

        panel.appendChild(this._el("p", {
            fontSize: "12px", opacity: "0.65", marginTop: "0", marginBottom: "14px", lineHeight: "1.5"
        }, "Checks whether ByeBlocked is still compatible with your current Discord version."));

        const primaryRow = this._el("div", { display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" });

        const scanBtn = this._el("button", {}, "\u25B6\uFE0F  Run compatibility check");
        this._styleButton(scanBtn, "primary");
        primaryRow.appendChild(scanBtn);

        const watchBtn = this._el("button", {});
        this._styleButton(watchBtn, "secondary");
        watchBtn.title = "While active, quietly watches which screens you visit (voice call, video/screen share, Activity/Watch-Together, Stage, member list, forum channel) and re-runs the compatibility check by itself the first time a screen you haven't visited this session opens. Also automatically scans for missing modules already present in the downloaded bundle (same as clicking \"Find missing modules\"), so some cannot_verify checks may resolve without navigating anywhere. No toasts - just check back on this panel whenever you like. Starts automatically when the plugin loads, so you don't have to remember to click it; stops automatically if you close Discord or disable the plugin, and you can still stop/restart it manually here anytime.";
        primaryRow.appendChild(watchBtn);

        panel.appendChild(primaryRow);

        const secondaryRow = this._el("div", { display: "flex", gap: "8px", marginBottom: "10px", flexWrap: "wrap" });

        const findBtn = this._el("button", {}, "\uD83D\uDD0D  Find missing modules");
        this._styleButton(findBtn, "secondary");
        findBtn.title = "Searches Discord's not-yet-loaded modules for source-text matches against ByeBlocked's pending checks (read-only - nothing is executed). Shows ranked candidates so you know which Discord screen to open to let the real module load normally, then re-run the compatibility check.";
        secondaryRow.appendChild(findBtn);

        const exportBtn = this._el("button", {}, "\u2B07\uFE0F  Export .json");
        this._styleButton(exportBtn, "secondary");
        exportBtn.title = "Saves the full scan result as a .json file.";
        exportBtn.onclick = () => this.exportSnapshotAsFile(this._panelSnapshot);
        secondaryRow.appendChild(exportBtn);

        panel.appendChild(secondaryRow);

        const metaEl = this._el("div", {
            fontSize: "11px", opacity: "0.55", marginBottom: "14px",
            paddingBottom: "12px", borderBottom: "1px solid var(--background-modifier-accent)"
        });
        panel.appendChild(metaEl);

        const tabBarSlot = this._el("div");
        panel.appendChild(tabBarSlot);

        const contentEl = this._el("div");
        panel.appendChild(contentEl);

        if (!this._activeTab) this._activeTab = "overview";

        const render = () => {
            this._panelSnapshot = this.lastSnapshot || this.loadLastSnapshot();
            metaEl.textContent = this._panelSnapshot
                ? `Captured at: ${new Date(this._panelSnapshot.capturedAt).toLocaleString("en-US")} - build: ${this._panelSnapshot.discordBuildNumber || "unknown"}`
                : "No scan yet.";

            const stats = this._panelSnapshot ? this._computeOverallStats(this._panelSnapshot) : null;
            const watchBadge = this._watchSessionChanges && this._watchSessionChanges.length > 0
                ? this._watchSessionChanges.reduce((sum, e) => sum + e.changedChecks.length + e.matchedViaDrifts.length + e.missingStores.length + e.newStores.length, 0)
                : null;
            const investigationCount = this._panelSnapshot?.entities?.find(e => e.type === "compatibility")?.data?.checks
                ?.filter(c => c.status !== "resolved" && c.investigation)?.length || null;

            const tabs = [
                { key: "overview", label: "Overview", badge: stats && (stats.failed + stats.warnings) > 0 ? stats.failed + stats.warnings : null },
                { key: "checks", label: "Checks", badge: stats ? `${stats.resolved}/${stats.total}` : null },
                { key: "watch", label: "Watch", badge: this.isWatchModeActive() ? "\u25CF" : watchBadge },
                { key: "investigation", label: "Investigation", badge: investigationCount || null }
            ];

            tabBarSlot.innerHTML = "";
            tabBarSlot.appendChild(this._buildTabBar(tabs, this._activeTab, (key) => {
                this._activeTab = key;
                render();
            }));

            contentEl.innerHTML = "";
            if (this._activeTab === "overview") contentEl.appendChild(this._buildOverviewTab(this._panelSnapshot));
            else if (this._activeTab === "checks") contentEl.appendChild(this._buildChecksTab(this._panelSnapshot));
            else if (this._activeTab === "watch") contentEl.appendChild(this._buildWatchTab());
            else if (this._activeTab === "investigation") contentEl.appendChild(this._buildInvestigationTab(this._panelSnapshot));
        };

        const updateWatchBtnLabel = () => {
            if (this.isWatchModeActive()) {
                watchBtn.textContent = "\u23F9 Stop watching";
            } else {
                watchBtn.textContent = "\uD83D\uDC41 Start watching";
            }
            watchBtn.style.opacity = "1";
        };

        watchBtn.onclick = () => {
            if (this.isWatchModeActive()) {
                this.stopWatchMode();
            } else {
                this.startWatchMode(() => { render(); updateWatchBtnLabel(); });
            }
            updateWatchBtnLabel();
            render();
        };

        scanBtn.onclick = async () => {
            if (this._scanInFlight) {
                BdApi.UI.showToast("Probe: a scan is already running - wait for it to finish.", { type: "warn" });
                return;
            }
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
            scanBtn.textContent = "\u25B6\uFE0F  Run compatibility check";
            scanBtn.style.opacity = "1";
            render();
        };

        findBtn.onclick = async () => {
            findBtn.disabled = true;
            const originalLabel = "\uD83D\uDD0D  Find missing modules";
            findBtn.textContent = "Searching...";
            findBtn.style.opacity = "0.6";
            try {
                const result = await this.findMissingModules();
                this._lastFindResult = result;
                if (result.candidatesFound === 0) {
                    BdApi.UI.showToast(
                        "No unresolved module looks like a match for the pending checks - they likely need a different Discord screen open (e.g. a voice call, a DM) to load at all. Navigate there, then re-run the compatibility check.",
                        { type: "warn" }
                    );
                } else {
                    BdApi.UI.showToast(
                        `Found ${result.candidatesFound} candidate module(s) for the pending checks (read-only - nothing executed). Open the matching Discord screen so they load normally, then re-run the compatibility check. See the Overview tab for details.`,
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

        if (this.isWatchModeActive()) {
            this._watchOnUpdate = () => { render(); updateWatchBtnLabel(); };
        }
        updateWatchBtnLabel();
        render();
        return panel;
    }
}

module.exports = class_Probe;
