/**
 * @name ByeBlocked
 * @author 8ug8ird
 * @authorId 698947564459917343
 * @version 2.11.0
 * @description Hides blocked and ignored users
 * @source https://github.com/8ug8ird/ByeBlocked
 */


function _recordPatchCatch(label, owner = null, error = null) {
    try {
        const ownerIsPlugin = !!(owner && owner._patcher && typeof owner._logThrottled === "function");
        const plugin = ownerIsPlugin ? owner : (typeof window !== "undefined" ? window.__byeBlocked : null);
        const key = `catch:${label}`;
        plugin?._patcher?._recordSilently(key);
        plugin?._logThrottled?.(key, error || "A guarded ByeBlocked operation failed. See _patcher.report() for failure counts.");
    } catch (_) {}
}

const _temporaryTextEdits = new WeakMap();
const _temporaryTextNodeEdits = new WeakMap();
function _setTemporaryText(element, value, place = null) {
    if (!element) return false;
    const desired = String(value ?? "");
    if (element.textContent === desired) return true;
    let records = _temporaryTextEdits.get(element);
    if (!records) records = new Map();
    const collect = node => {
        if (node.nodeType === 3) return [node];
        return Array.from(node.childNodes || []).flatMap(collect);
    };
    let nodes = collect(element);
    for (const [node, record] of records) {
        if (!element.contains(node)) records.delete(node);
        else if (record.added && nodes.some(other => other !== node && !records.get(other)?.added)) {
            if (node.data === record.written) node.parentNode.removeChild(node);
            records.delete(node);
        }
    }
    nodes = collect(element);
    if (!nodes.length) {
        if (!desired) return true;
        const node = element.ownerDocument.createTextNode("");
        element.appendChild(node);
        const record = { original: "", written: "", added: true };
        records.set(node, record);
        _temporaryTextNodeEdits.set(node, record);
        nodes = [node];
    }
    const current = nodes.map(node => node.data).join("");
    let prefix = 0, suffix = 0;
    while (prefix < current.length && prefix < desired.length && current[prefix] === desired[prefix]) prefix++;
    while (suffix < current.length - prefix && suffix < desired.length - prefix
        && current[current.length - 1 - suffix] === desired[desired.length - 1 - suffix]) suffix++;
    const end = current.length - suffix;
    const replacement = desired.slice(prefix, desired.length - suffix);
    let offset = 0, inserted = false;
    _temporaryTextEdits.set(element, records);
    element.setAttribute("data-nmb-text-edit", "true");
    if (place) element.setAttribute("data-nmb-text-place", place);
    for (const node of nodes) {
        const text = node.data;
        const nextOffset = offset + text.length;
        if (nextOffset >= prefix && offset <= end) {
            const from = Math.max(0, prefix - offset);
            const to = Math.min(text.length, end - offset);
            const next = text.slice(0, from) + (inserted ? "" : replacement) + text.slice(to);
            inserted = true;
            if (next !== text) {
                let record = _temporaryTextNodeEdits.get(node);
                if (!record) record = { original: text, written: text, added: false };
                else if (text !== record.written) {
                    record.original = text;
                    record.added = false;
                }
                records.set(node, record);
                _temporaryTextNodeEdits.set(node, record);
                node.data = next;
                record.written = next;
            }
        }
        offset = nextOffset;
    }
    return true;
}

function _restoreTemporaryText(element) {
    const records = _temporaryTextEdits.get(element);
    if (!records) return false;
    for (const [node, record] of records) {
        if (_temporaryTextNodeEdits.get(node) !== record) continue;
        _temporaryTextNodeEdits.delete(node);
        if (!element.contains(node) || node.data !== record.written) continue;
        if (record.added) node.parentNode.removeChild(node);
        else node.data = record.original;
    }
    _temporaryTextEdits.delete(element);
    element.removeAttribute("data-nmb-text-edit");
    element.removeAttribute("data-nmb-text-place");
    element.removeAttribute("data-nmb-prev-text");
    element.removeAttribute("data-nmb-orig-text");
    return true;
}

function _restoreTemporaryTexts(place = null) {
    document.querySelectorAll("[data-nmb-text-edit]").forEach(element => {
        if (place && element.getAttribute("data-nmb-text-place") !== place) return;
        try { _restoreTemporaryText(element); }
        catch (error) { _recordPatchCatch("dom.restoreTemporaryText", null, error); }
    });
}

function _surfaceRetry(plugin, capabilities) {
    const operations = {
        guardEnter: (...args) => plugin._retryGuardEnter(...args),
        guardExit: (...args) => plugin._retryGuardExit(...args),
        delay: (...args) => plugin._retryDelay(...args),
        schedule: (...args) => plugin._scheduleRetry(...args),
        cancel: id => plugin._cancelRetry(id),
    };
    const api = {};
    for (const name of capabilities) {
        if (!Object.prototype.hasOwnProperty.call(operations, name)) {
            throw new Error("Unknown retry capability: " + name);
        }
        api[name] = operations[name];
    }
    return Object.freeze(api);
}

function _forgetReplacedPatches(target, installedMethods, refs) {
    for (const [method, patchedFn] of refs || []) {
        if (target[method] !== patchedFn) {
            installedMethods?.delete(method);
            refs.delete(method);
        }
    }
}

function _isAfterPatchBatchCurrent(target, methods, installedMethods, refs) {
    if (!target || !installedMethods || !refs) return false;
    const applicable = methods.filter(method => typeof target[method] === "function");
    return applicable.length > 0 && applicable.every(method => installedMethods.has(method) && refs.get(method) === target[method]);
}

function _getStorePatchState(owner, store, methodsKey, refsKey = null) {
    const methodsByStore = owner[methodsKey] ||= new WeakMap();
    let methods = methodsByStore.get(store);
    if (!methods) methodsByStore.set(store, methods = new Set());
    let refs = null;
    if (refsKey) {
        const refsByStore = owner[refsKey] ||= new WeakMap();
        refs = refsByStore.get(store);
        if (!refs) refsByStore.set(store, refs = new Map());
    }
    return { methods, refs };
}

function _installAfterPatchBatch(target, filters, installedMethods, refs, install) {
    if (refs) _forgetReplacedPatches(target, installedMethods, refs);
    let patchedAny = false, failedPatch = false;
    for (const { method, callback, countsForSuccess = true } of filters) {
        if (typeof target[method] !== "function") continue;
        if (!installedMethods.has(method)) {
            const unpatch = install(target, method, callback);
            if (typeof unpatch !== "function") { failedPatch = true; continue; }
            installedMethods.add(method);
            refs?.set(method, target[method]);
        }
        if (countsForSuccess) patchedAny = true;
    }
    return patchedAny && !failedPatch;
}

function _surfaceUserVisibility(plugin) {
    return Object.freeze({ shouldHide: userId => plugin.shouldHide(userId) });
}

function _surfaceFiberProps(plugin) {
    return Object.freeze({ walkProps: (...args) => plugin.walkFiberProps(...args) });
}

function _runningLifecycle(plugin) {
    return Object.freeze({ get isRunning() { return plugin.isRunning; } });
}

const _SEL = Object.freeze({
    channelNotice: '[class*="channelNotice_"]',
    messageGroupWrapper: '[class*="messageGroupWrapper"]',
    chatContent: '[class*="chatContent"]',
    scroller: '[class*="scroller"]',
    reactionRemove: '[class*="reactionRemove"], [class*="removeReaction"], button[aria-label*="Remove"], button[aria-label*="Remover"]',
    reactionInner: '[class*="reactionInner"]',
    reactorDisplayName: '[class*="reactorInfo_"] strong, [class*="defaultColor_"]',
    voiceUser: '[class*="voiceUser"]',
    messageRow: 'li[class*="messageListItem"], [class*="messageListItem"]',
    messageItemLi: 'li[class*="messageListItem"]',
    messageItem: '[class*="messageListItem"]',
    reactorClickable: '[class*="reactorClickable_"]',
    reactorsContainers: '[class*="reactorsContainer_"], [class*="reactors_"]',
    memberRow: '[class*="memberRow"]',
    blockedMessage: '[class*="messageGroupBlocked"], [class*="blockedSystemMessage"]',
    pinCard: '[data-list-item-id^="pins__"]',
    channelRow: '[data-list-item-id*="channels"]',
    memberListContainer: '[data-list-id^="members-"]',
    rowEl: '[class*="row__"]',
    privateChannelRow: '[data-list-item-id*="private-channels"][data-list-item-id*="___"]'
});

const _ATTR = Object.freeze({
    prevText: "data-nmb-prev-text",
    origAriaLabel: "data-nmb-orig-aria-label",
    prevStyle: "data-nmb-prev-style",
    prevRingingStyle: "data-nmb-prev-ringing-style",
    origText: "data-nmb-orig-text",
    relabelPending: "data-nmb-relabel-pending",
    prevIconStyle: "data-nmb-prev-icon-style",
    prevGhostStyle: "data-nmb-prev-ghost-style",
    eventsPendingSince: "data-nmb-events-pending-since"
});

function _isNativeClass(fn) {
    try { return typeof fn === "function" && /^class[\s{]/.test(Function.prototype.toString.call(fn)); }
    catch (_) { return false; }
}

function _memoizeByRef(owner, cacheField, value, compute) {
    if (!value) return value;
    if (!owner[cacheField]) owner[cacheField] = new WeakMap();
    const cache = owner[cacheField];
    if (typeof value === "object") {
        const cached = cache.get(value);
        if (cached !== undefined) return cached;
    }
    const result = compute(value);
    if (typeof value === "object") {
        try { cache.set(value, result); } catch (_) {}
    }
    return result;
}

const _CALL_PARTICIPANT_KEYS = ["participants", "filteredParticipants", "voiceParticipants", "gridParticipants", "streams", "tiles"];

function _restoreGhostStyle(element) {
    const previous = element.getAttribute(_ATTR.prevGhostStyle);
    if (previous) element.setAttribute("style", previous); else element.removeAttribute("style");
    delete element.dataset.nmbGhost;
    element.removeAttribute(_ATTR.prevGhostStyle);
}

function _getUnreadPins(items, lastPinTs) {
    return lastPinTs ? items.filter(item => {
        const ts = item?.pinnedAt instanceof Date ? item.pinnedAt.getTime() : new Date(item?.pinnedAt || 0).getTime();
        const cmpTs = lastPinTs instanceof Date ? lastPinTs.getTime() : new Date(lastPinTs).getTime();
        return ts > cmpTs;
    }) : items;
}

function _messageCollectionToArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?._array)) return value._array;
    if (value instanceof Map) return Array.from(value.values());
    return value && typeof value === "object" ? Object.values(value) : null;
}

function _filterArrayPreservingIdentity(items, predicate) {
    const filtered = items.filter(predicate);
    return filtered.length === items.length ? items : filtered;
}

function _hideBlockedRows(surface, selector, label, resolveTarget = row => row) {
    const rows = document.querySelectorAll(selector);
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.dataset?.hiddenBlocked === "true") continue;
        const userId = surface.api.identity.findUserId(row);
        if (userId && surface.api.visibility.shouldHide(userId)) {
            const target = resolveTarget(row);
            if (target) surface.api.dom.hideElement(target, label, userId);
        }
    }
}


class ModuleResolver {
    constructor(options = {}) {
        this._cache = new Map();
        this._cacheMaxSize = options.cacheMaxSize || 50;
        this._resolutions = new Map();
    }
    _note(label, strategy, matchedName = null) {
        if (!label) return;
        try {
            const prev = this._resolutions.get(label);
            if (!prev || prev.strategy !== strategy || prev.matchedName !== matchedName) {
                this._resolutions.set(label, { strategy, at: Date.now(), matchedName });
            }
        } catch (error) { _recordPatchCatch("resolver.note", null, error); }
    }
    _miss(label) { this._note(label, 'missing'); return null; }
    _recordScoredCandidate(label, info) {
        if (!label) return;
        try {
            if (!this._scoredCandidates) this._scoredCandidates = new Map();
            this._scoredCandidates.set(label, { ...info, at: Date.now() });
        } catch (error) { _recordPatchCatch("resolver.recordScoredCandidate", null, error); }
    }
    scoredCandidateReport() {
        const out = {};
        if (this._scoredCandidates) for (const [label, v] of this._scoredCandidates) out[label] = v;
        return out;
    }
    scoredCandidateFor(label) {
        return this._scoredCandidates ? (this._scoredCandidates.get(label) || null) : null;
    }
    resolutionReport() {
        const out = {};
        for (const [label, v] of this._resolutions) out[label] = v.strategy;
        return out;
    }
    matchedNameFor(label) {
        const v = this._resolutions.get(label);
        return v ? v.matchedName : null;
    }
    resolveSimple(key, ...names) {
        return this.setSimple(key, this.getStore(...names));
    }
    simple(key) {
        return this._simpleStores ? this._simpleStores.get(key) : undefined;
    }
    setSimple(key, value) {
        if (!this._simpleStores) this._simpleStores = new Map();
        this._simpleStores.set(key, value);
        return value;
    }
    _cacheSet(k, mod) {
        if (this._cache.size >= this._cacheMaxSize && !this._cache.has(k)) {
            this._cache.delete(this._cache.keys().next().value);
        }
        this._cache.set(k, mod);
        return mod;
    }
    getStore(...names) {
        for (const n of names) { try { const s = BdApi.Webpack.getStore(n); if (s) { this._note('store:' + names[0], 'exact', n); return s; } } catch (error) { _recordPatchCatch("resolver.getStore", null, error); } }
        const h = this.byHeuristic(names[0]);
        return h ? (this._note('store:' + names[0], 'heuristic'), h) : this._miss('store:' + names[0]);
    }
    byHeuristic(hint) {
        if (!hint) return null;
        const k = 'st:' + hint;
        if (this._cache.has(k)) return this._cache.get(k);
        const t = hint.replace(/store$/i, '').toLowerCase();
        try {
            const stores = this.get(m => m && typeof m === 'object' && typeof m.addChangeListener === 'function' && typeof m.getState === 'function');
            if (!stores) return null;
            const all = Array.isArray(stores) ? stores : [stores];
            for (const mod of all) {
                const n = (mod.getName?.() || mod.constructor?.displayName || mod.constructor?.name || '').toLowerCase();
                if (n.includes(t)) return this._cacheSet(k, mod);
            }
            for (const mod of all) {
                try {
                    const state = mod.getState();
                    if (state && typeof state === 'object')
                        for (const key of Object.keys(state))
                            if (key.toLowerCase().includes(t)) return this._cacheSet(k, mod);
                } catch (error) { _recordPatchCatch("resolver.heuristic.readState", null, error); }
            }
        } catch (error) { _recordPatchCatch("resolver.heuristic.resolve", null, error); }
        return null;
    }
    get(f, o, label) {
        try { const m = BdApi.Webpack.getModule(f, o); if (m) { this._note(label, 'filter'); return m; } } catch (error) { _recordPatchCatch("resolver.getModule", null, error); }
        return this._miss(label);
    }
    getBySource(s, o, label) {
        try { const m = BdApi.Webpack.getBySource(s, o); if (m) { this._note(label, 'source'); return m; } } catch (error) { _recordPatchCatch("resolver.getBySource", null, error); }
        return this._miss(label);
    }
    getBySourceAny(...sources) {
        for (const s of sources) { try { const m = BdApi.Webpack.getBySource(s); if (m) return m; } catch (error) { _recordPatchCatch("resolver.getBySourceAny", null, error); } }
        return null;
    }
    getWithKey(f, label) {
        try {
            const raw = BdApi.Webpack.getWithKey(f);
            if (raw) {
                if (Array.isArray(raw)) { this._note(label, 'withKey'); return raw; }
                if (typeof raw[Symbol.iterator] === 'function' || typeof raw.next === 'function') {
                    const pair = [...raw];
                    if (pair.length && pair[0] !== undefined) { this._note(label, 'withKey'); return pair; }
                }
            }
        } catch (error) { _recordPatchCatch("resolver.getWithKey", null, error); }
        return this._miss(label);
    }
    findByKeys(...keys) {
        for (const key of keys) { try { const m = BdApi.Webpack.getByKeys(key); if (m) return m; } catch (error) { _recordPatchCatch("resolver.findByKeys.single", null, error); } }
        try { const m = this.get(mod => mod && typeof mod === 'object' && keys.every(k => k in mod)); if (m) return m; } catch (error) { _recordPatchCatch("resolver.findByKeys.shape", null, error); }
        try { return BdApi.Webpack.getByKeys(...keys); } catch (_) { return null; }
    }
    findFnKey(mod, ...needles) {
        if (!mod || typeof mod !== 'object') return null;
        try {
            for (const [key, val] of Object.entries(mod)) {
                if (typeof val !== 'function') continue;
                const src = val.toString();
                if (needles.every(n => src.includes(n))) return key;
            }
        } catch (error) { _recordPatchCatch("resolver.findFnKey", null, error); }
        return null;
    }
    findFnKeyFuzzy(mod, ...needles) {
        if (!mod || typeof mod !== 'object') return null;
        try {
            let best = null, bestScore = 0;
            for (const [key, val] of Object.entries(mod)) {
                if (typeof val !== 'function') continue;
                try {
                    const src = val.toString();
                    let score = 0;
                    for (const n of needles) { if (src.includes(n)) score++; }
                    if (score > bestScore) { bestScore = score; best = key; }
                    if (score === needles.length) return key;
                } catch (error) { _recordPatchCatch("resolver.findFnKeyFuzzy.source", null, error); }
            }
            return best;
        } catch (error) { _recordPatchCatch("resolver.findFnKeyFuzzy", null, error); }
        return null;
    }
}
class PatchManager {
    constructor(p) { this.p = p; this.failCounts = {}; }
    _isWritable(t, m) {
        try {
            let obj = t;
            while (obj) {
                const desc = Object.getOwnPropertyDescriptor(obj, m);
                if (desc) return !!(desc.set || desc.writable !== false && !("get" in desc && !desc.set));
                obj = Object.getPrototypeOf(obj);
            }
            return true;
        } catch (_) { return true; }
    }
    _refuseClassTarget(kind, t, m) {
        if (!_isNativeClass(t?.[m])) return false;
        this._warn(`patch:${kind}:${m}:class-constructor`, new Error(`refusing to patch native class constructor "${t[m]?.name || m}" (BdApi.Patcher would call it without 'new')`));
        return true;
    }
    _recordSilently(l) {
        try { this.failCounts[l] = (this.failCounts[l] || 0) + 1; } catch (_) {}
    }
    _patch(kind, t, m, fn) {
        try {
            if (!t?.[m]) return false;
            if (!this._isWritable(t, m)) { this._recordSilently(`patch:${kind}:${m}`); return false; }
            if (this._refuseClassTarget(kind, t, m)) return false;
            const unpatch = BdApi.Patcher[kind](this.p.pluginName, t, m, fn);
            if (typeof unpatch === "function") return unpatch;
            this._recordSilently(`patch:${kind}:${m}:no-unpatch`);
            return false;
        } catch (e) { this._warn(`patch:${kind}:${m}`, e); return false; }
    }
    before(t, m, fn) { return this._patch("before", t, m, fn); }
    after(t, m, fn) { return this._patch("after", t, m, fn); }
    instead(t, m, fn) { return this._patch("instead", t, m, fn); }
    safe(l, fn) { try { fn(); return true; } catch (e) { this._warn(l, e); return false; } }
    cleanup() { try { BdApi.Patcher.unpatchAll(this.p.pluginName); } catch (error) { _recordPatchCatch("PatchManager.cleanup.L298", this.p, error); } }
    _logFail(l, err) { this._warn(l, err); }
    _warn(l, e) {
        try {
            this.failCounts[l] = (this.failCounts[l] || 0) + 1;
            if (typeof this.p?._logThrottled === "function") this.p._logThrottled(l, e);
            else if (this.p?.logger) this.p.logger.warn(l, e);
            else console.warn("[ByeBlocked] " + l + ": " + (e?.message || String(e)));
        } catch (_) {}
    }
    report() {
        const entries = Object.entries(this.failCounts).sort((a, b) => b[1] - a[1]);
        if (!entries.length) { console.info("[ByeBlocked] No failures registered."); return {}; }
        console.table(entries.map(([label, count]) => ({ label, count })));
        return Object.fromEntries(entries);
    }
    unwrapComponent(v) {
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
    getComponentSource(fn) {
        try {
            if (fn.prototype?.render && typeof fn.prototype.render === "function") return fn.prototype.render.toString();
            return Function.prototype.toString.call(fn);
        } catch (_) { return null; }
    }
    sourceTermMatches(value, terms) {
        const fn = this.unwrapComponent(value);
        if (!fn) return [];
        const source = this.getComponentSource(fn);
        if (!source) return [];
        return terms.filter(term => source.includes(term));
    }
    resolvePatchTarget(mod, key) {
        const raw = mod?.[key];
        const fn = this.unwrapComponent(raw);
        if (!fn) return null;
        if (_isNativeClass(fn)) {
            const proto = fn.prototype;
            if (proto && typeof proto.render === "function") return { target: proto, key: "render", fn, isClass: true };
            return null;
        }
        if (raw === fn) return { target: mod, key, fn };
        const nestedKey = (typeof raw.type === "function") ? "type"
            : (typeof raw.render === "function") ? "render"
            : (typeof raw.Component === "function") ? "Component"
            : (typeof raw.default === "function") ? "default"
            : "render";
        return { target: raw, key: nestedKey, fn };
    }
    patchBySourceTerms({ terms, requiredMatches = 1, apply, label = null, onCandidate = null }) {
        const srcFilter = v => {
            const hits = this.sourceTermMatches(v, terms);
            if (onCandidate) { try { onCandidate(hits); } catch (error) { _recordPatchCatch("PatchManager.patchBySourceTerms.L358", this.p, error); } }
            return hits.length >= requiredMatches;
        };
        try {
            const found = this.p._r.getWithKey(srcFilter, label);
            if (found?.[0] && found[1] != null && apply(found[0], found[1])) return true;
        } catch (e) { this._warn(label || "patchBySourceTerms", e); }
        try {
            const directModule = this.p._r.get(srcFilter, { searchExports: true }, label);
            if (directModule && typeof directModule === "object") {
                for (const key of Object.keys(directModule)) {
                    let value;
                    try { value = directModule[key]; } catch (_) { continue; }
                    if (srcFilter(value) && apply(directModule, key)) return true;
                }
            } else if (typeof directModule === "function" && directModule.prototype?.render && srcFilter(directModule)) {
                if (apply(directModule.prototype, "render")) return true;
            }
        } catch (e) { this._warn(label || "patchBySourceTerms", e); }
        try {
            const wholeModule = this.p._r.get(exportsObj => {
                if (!exportsObj || typeof exportsObj !== "object") return false;
                try { return Object.values(exportsObj).some(srcFilter); } catch (_) { return false; }
            }, { defaultExport: false });
            if (wholeModule && typeof wholeModule === "object") {
                for (const key of Object.keys(wholeModule)) {
                    let val;
                    try { val = wholeModule[key]; } catch (_) { continue; }
                    if (!srcFilter(val)) continue;
                    if (apply(wholeModule, key)) return true;
                }
            }
        } catch (e) { this._warn(label || "patchBySourceTerms", e); }
        return false;
    }
    patchBySourceTermsScored({ terms, requiredMatches = 1, apply, label = null }) {
        let best = null;
        let closestMiss = null;
        let qualifyingCount = 0;
        let runnerUpHitCount = 0;
        try {
            const srcFilter = v => this.sourceTermMatches(v, terms).length > 0;
            const candidates = BdApi.Webpack.getModules(mod => {
                if (!mod || typeof mod !== "object") return false;
                try { return Object.values(mod).some(srcFilter); } catch (_) { return false; }
            }) || [];
            for (const mod of candidates) {
                let keys;
                try { keys = Object.keys(mod); } catch (_) { continue; }
                for (const key of keys) {
                    let value;
                    try { value = mod[key]; } catch (_) { continue; }
                    const hits = this.sourceTermMatches(value, terms);
                    if (!hits.length) continue;
                    if (!closestMiss || hits.length > closestMiss.hits.length) closestMiss = { mod, key, hits };
                    if (hits.length < requiredMatches) continue;
                    qualifyingCount++;
                    if (!best || hits.length > best.hits.length) {
                        if (best) runnerUpHitCount = Math.max(runnerUpHitCount, best.hits.length);
                        best = { mod, key, hits };
                    } else {
                        runnerUpHitCount = Math.max(runnerUpHitCount, hits.length);
                    }
                }
            }
        } catch (e) { this._warn(label || "patchBySourceTermsScored", e); }
        if (!best) {
            this.p._r._note(label, "missing");
            return { patched: false, bestHitCount: closestMiss?.hits.length || 0, bestHitStrings: closestMiss?.hits || [] };
        }
        const applied = (() => { try { return apply(best.mod, best.key); } catch (e) { this._warn(label || "patchBySourceTermsScored", e); return false; } })();
        if (applied) {
            this.p._r._note(label, "scored", best.key);
            const ambiguous = qualifyingCount > 1 && runnerUpHitCount === best.hits.length;
            this.p._r._recordScoredCandidate?.(label, { matchedKey: best.key, hitCount: best.hits.length, requiredMatches, totalTermCount: terms.length, qualifyingCandidates: qualifyingCount, ambiguous });
            return { patched: true, bestHitCount: best.hits.length, bestHitStrings: best.hits };
        }
        return { patched: false, bestHitCount: best.hits.length, bestHitStrings: best.hits };
    }
    patchMethod(options) {
        const { label, isPatched, attempt = 0, maxAttempts = 20, delayMs = 2000, useBackoff = true, resolve, apply, onExhausted, self } = options;
        const owner = self || this.p;
        if (isPatched.call(owner)) { this.p._retryGuardExit(label); return true; }
        if (!this.p._retryGuardEnter(label, attempt)) return false;
        const retry = reason => {
            if (attempt < maxAttempts) {
                const delay = useBackoff ? this.p._retryDelay(attempt, delayMs) : delayMs;
                this.p._scheduleRetry(() => this.patchMethod({ ...options, attempt: attempt + 1 }), delay);
                return false;
            }
            if (onExhausted) {
                try { onExhausted.call(owner, reason); }
                catch (error) { _recordPatchCatch("PatchManager.patchMethod.exhausted", this.p, error); }
            } else this._warn(label, new Error(label + ": ran out of attempts " + reason));
            this.p._retryGuardExit(label);
            return false;
        };
        let target;
        try { target = resolve.call(owner, attempt); }
        catch (error) { this._warn(label, error); }
        if (!target) return retry("resolving target");
        let installed = false;
        try { installed = apply.call(owner, target) === true; }
        catch (error) { this._warn(label, error); }
        if (!installed) return retry("installing patch");
        this.p._retryGuardExit(label);
        return true;
    }
    patchComponent({ label, isPatched, attempt = 0, maxAttempts = 20, delayMs = 3000, terms, requiredMatches = 1, unpatchFnsKey, inProgressKey = null, applyPatch, useGuard = false, onExhausted, self }) {
        const target_self = self || this.p;
        const infra = this.p;
        if (isPatched.call(target_self)) return true;
        if (useGuard && !infra._retryGuardEnter(label, attempt)) return false;
        if (attempt === 0) {
            if (inProgressKey) {
                if (target_self[inProgressKey]) return false;
                target_self[inProgressKey] = true;
            }
            const prior = target_self[unpatchFnsKey];
            if (Array.isArray(prior) && prior.length) {
                for (const unpatch of prior) { try { unpatch?.(); } catch (error) { _recordPatchCatch("PatchManager.patchComponent.L426", this.p, error); } }
            }
            target_self[unpatchFnsKey] = [];
        }
        if (!Array.isArray(target_self[unpatchFnsKey])) target_self[unpatchFnsKey] = [];
        const { patched: found } = this.patchBySourceTermsScored({
            terms, requiredMatches, label,
            apply: (mod, key) => {
                const resolved = this.resolvePatchTarget(mod, key);
                if (!resolved) return false;
                return applyPatch.call(target_self, resolved, target_self[unpatchFnsKey]);
            }
        });
        if (found) {
            if (inProgressKey) target_self[inProgressKey] = false;
            if (useGuard) infra._retryGuardExit(label);
            return true;
        }
        if (attempt < maxAttempts) {
            infra._scheduleRetry(() => this.patchComponent({ label, isPatched, attempt: attempt + 1, maxAttempts, delayMs, terms, requiredMatches, unpatchFnsKey, inProgressKey, applyPatch, useGuard, onExhausted, self }), infra._retryDelay(attempt, delayMs));
        } else {
            if (onExhausted) { try { onExhausted.call(target_self); } catch (error) { _recordPatchCatch("PatchManager.patchComponent.L447", this.p, error); } }
            else {
                if (inProgressKey) target_self[inProgressKey] = false;
                this._logFail(label, new Error(`${label}: ran out of attempts - weak indicators did not find the module; see maintenance notes`));
            }
            if (useGuard) infra._retryGuardExit(label);
        }
        return false;
    }
}

class RetryManager {
    constructor({ isAlive, getEpoch, onWarn, ownerInstance } = {}) {
        this._isAlive = typeof isAlive === 'function' ? isAlive : () => true;
        this._getEpoch = typeof getEpoch === 'function' ? getEpoch : () => 0;
        this._onWarn = typeof onWarn === 'function' ? onWarn : () => {};
        this._ownerInstance = ownerInstance || null;
        this._timers = new Set();
        this._inFlight = Object.create(null);
    }
    delay(attempt, steadyDelayMs = 2000) {
        const fastSteps = [100, 300, 600, 1000];
        if (attempt < fastSteps.length) {
            return Math.min(fastSteps[attempt], steadyDelayMs);
        }
        return steadyDelayMs;
    }
    guardEnter(name, attempt) {
        if (attempt !== 0) return true;
        if (this._inFlight[name]) return false;
        this._inFlight[name] = true;
        return true;
    }
    guardExit(name) {
        this._inFlight[name] = false;
    }
    schedule(fn, delay, opts = {}) {
        const epochAtSchedule = this._getEpoch();
        const ignoreAlive = !!opts.ignoreAlive;
        let id = null;
        id = setTimeout(() => {
            this._timers.delete(id);
            if (!ignoreAlive && !this._isAlive()) return;
            if (this._getEpoch() !== epochAtSchedule) return;
            try {
                if (typeof window !== 'undefined' && window.__byeBlocked && this._ownerInstance && window.__byeBlocked !== this._ownerInstance) {
                    return;
                }
            } catch (_) {}
            try { fn(); } catch (e) { try { this._onWarn('RetryManager.schedule', e); } catch (_) {} }
        }, delay);
        this._timers.add(id);
        return id;
    }
    cancel(id) {
        if (id == null) return;
        clearTimeout(id);
        this._timers.delete(id);
    }
    cancelAll() {
        for (const id of this._timers) clearTimeout(id);
        this._timers.clear();
        this._inFlight = Object.create(null);
    }
}

class ResourceManager {
    constructor({ onWarn, getEpoch, isAlive } = {}) {
        this._onWarn = typeof onWarn === 'function' ? onWarn : () => {};
        this._ownEpoch = 0;
        this._getEpoch = typeof getEpoch === 'function' ? getEpoch : () => this._ownEpoch;
        this._isAlive = typeof isAlive === 'function' ? isAlive : () => true;
        this._scopes = new Map();
        this._disposed = false;
    }
    _stale(epoch) { return this._disposed || this._getEpoch() !== epoch; }
    _scope(name) {
        let s = this._scopes.get(name);
        if (!s) {
            s = { timers: new Set(), intervals: new Set(), frames: new Set(), listeners: new Set(), observers: new Set(), disposers: new Set() };
            this._scopes.set(name, s);
        }
        return s;
    }
    _warn(label, e) { try { this._onWarn(label, e); } catch (_) {} }
    _schedule(scope, kind, fn, schedule) {
        if (this._disposed) return null;
        const s = this._scope(scope);
        const epoch = this._getEpoch();
        let id = null;
        id = schedule(() => {
            if (kind !== 'interval') s[kind + 's'].delete(id);
            if (s.disposed || this._stale(epoch)) return;
            try { fn(); } catch (e) { this._warn('ResourceManager.' + kind + ':' + scope, e); }
        });
        s[kind + 's'].add(id);
        return id;
    }
    timer(scope, fn, delay) {
        return this._schedule(scope, 'timer', fn, callback => setTimeout(callback, delay));
    }
    _cancel(scope, kind, id, cancel) {
        if (id == null) return;
        cancel(id);
        this._scopes.get(scope)?.[kind + 's'].delete(id);
    }
    clearTimer(scope, id) {
        this._cancel(scope, 'timer', id, value => clearTimeout(value));
    }
    debounce(scope, fn, delay) {
        if (this._disposed) return;
        const s = this._scope(scope);
        if (s.debounceTimer != null) return;
        const epoch = this._getEpoch();
        s.debounceTimer = this.timer(scope, () => {
            s.debounceTimer = null;
            if (s.disposed || this._stale(epoch)) return;
            try { fn(); } catch (e) { this._warn('ResourceManager.debounce:' + scope, e); }
        }, delay);
    }
    cancelDebounce(scope) {
        const s = this._scopes.get(scope);
        if (!s || s.debounceTimer == null) return;
        this.clearTimer(scope, s.debounceTimer);
        s.debounceTimer = null;
    }
    interval(scope, fn, delay) {
        return this._schedule(scope, 'interval', fn, callback => setInterval(callback, delay));
    }
    clearInterval(scope, id) {
        this._cancel(scope, 'interval', id, value => clearInterval(value));
    }
    clearFrame(scope, id) {
        this._cancel(scope, 'frame', id, value => cancelAnimationFrame(value));
    }
    frame(scope, fn) {
        return this._schedule(scope, 'frame', fn, callback => requestAnimationFrame(callback));
    }
    listener(scope, target, type, handler, options) {
        if (this._disposed || !target?.addEventListener) return () => {};
        const s = this._scope(scope);
        const rec = { target, type, handler, options };
        target.addEventListener(type, handler, options);
        s.listeners.add(rec);
        return () => this._removeListener(s, rec);
    }
    _removeListener(s, rec) {
        if (!s.listeners.delete(rec)) return;
        try { rec.target.removeEventListener(rec.type, rec.handler, rec.options); } catch (error) { this._warn("ResourceManager._removeListener.L593", error); }
    }
    observer(scope, observer) {
        if (!observer) return observer;
        if (this._disposed) { try { observer.disconnect(); } catch (error) { this._warn("ResourceManager.observer.L597", error); } return observer; }
        this._scope(scope).observers.add(observer);
        return observer;
    }
    releaseObserver(scope, observer) {
        if (!observer) return;
        try { observer.disconnect(); } catch (error) { this._warn("ResourceManager.releaseObserver.L603", error); }
        this._scopes.get(scope)?.observers.delete(observer);
    }
    onDispose(scope, fn) {
        if (this._disposed) { try { fn(); } catch (e) { this._warn('ResourceManager.onDispose:' + scope, e); } return () => {}; }
        const s = this._scope(scope);
        s.disposers.add(fn);
        return () => s.disposers.delete(fn);
    }
    disposeScope(name) {
        const s = this._scopes.get(name);
        if (!s) return;
        s.disposed = true;
        this._scopes.delete(name);
        const release = (kind, values, dispose) => {
            for (const value of [...values]) {
                try { dispose(value); }
                catch (error) { this._warn(`ResourceManager.dispose:${name}:${kind}`, error); }
            }
            values.clear();
        };
        release('timer', s.timers, clearTimeout);
        release('interval', s.intervals, clearInterval);
        release('frame', s.frames, cancelAnimationFrame);
        for (const rec of [...s.listeners]) this._removeListener(s, rec);
        release('observer', s.observers, observer => observer.disconnect());
        release('callback', s.disposers, dispose => dispose());
    }
    disposeAll() {
        this._disposed = true;
        this._ownEpoch++;
        for (const name of [...this._scopes.keys()]) this.disposeScope(name);
    }
    reset() {
        this.disposeAll();
        this._disposed = false;
    }
}

class IdentityResolver {
    constructor(plugin) {
        this.p = plugin;
    }
    _isUserId(value) {
        return /^\d{17,20}$/.test(String(value));
    }
    findUsersByName(name) {
        if (!name) return [];
        const UserStore = this.p.modules.UserStore;
        if (!UserStore || typeof UserStore.getUsers !== "function") return [];
        const target = String(name).toLowerCase();
        const users = UserStore.getUsers();
        const matches = [];
        for (const id in users) {
            const user = users[id];
            const names = [ user?.username, user?.globalName, user?.displayName ].filter(Boolean).map(value => String(value).trim().toLowerCase());
            if (names.includes(target)) matches.push({ id: String(id), user });
        }
        return matches;
    }
    _findUserIdDataAttr(el) {
        if (el.dataset?.userId) return el.dataset.userId;
        const uidEl = el.querySelector?.("[data-user-id]");
        return uidEl?.dataset?.userId || null;
    }
    fromElement(el) {
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
        } catch (_) { _recordPatchCatch("identity.fromElement.data", this.p); }
        let found = null;
        try {
            const avatar = el.querySelector?.('img[src*="/avatars/"]');
            const avatarMatch = avatar?.src?.match(/\/avatars\/(\d{17,20})/);
            if (avatarMatch) found = avatarMatch[1];
        } catch (_) { _recordPatchCatch("identity.fromElement.avatar", this.p); }
        if (!found) {
            this.walkFiberShallow(el, props => {
                if (!found) found = this.fromProps(props);
            });
        }
        if (found && identityKey) {
            try { el.dataset.nmbUserId = found; el.dataset.nmbUserIdKey = identityKey; } catch (_) {}
        }
        return found;
    }
    fromElementAll(el) {
        if (!el) return [];
        const ids = new Set();
        try {
            const uidEls = el.querySelectorAll?.("[data-user-id]") || [];
            for (const node of uidEls) {
                const id = node.dataset?.userId;
                if (id) ids.add(id);
            }
            if (el.dataset?.userId) ids.add(el.dataset.userId);
        } catch (error) { _recordPatchCatch("identity.fromElementAll.data", this.p, error); }
        try {
            const avatars = el.querySelectorAll?.('img[src*="/avatars/"]') || [];
            for (const avatar of avatars) {
                const m = avatar.src?.match(/\/avatars\/(\d{17,20})/);
                if (m) ids.add(m[1]);
            }
        } catch (error) { _recordPatchCatch("identity.fromElementAll.avatars", this.p, error); }
        try {
            this.walkFiberShallow(el, props => {
                for (const id of this._extractAllFromProps(props)) ids.add(id);
            });
        } catch (error) { _recordPatchCatch("identity.fromElementAll.fiber", this.p, error); }
        if (!ids.size) {
            const single = this.fromElement(el);
            if (single) ids.add(single);
        }
        return Array.from(ids);
    }
    _extractAllFromProps(value, depth = 0, out = new Set()) {
        if (!value || depth > 3 || typeof value !== "object") return out;
        const recipients = value.recipients || value.rawRecipients || value.channel?.recipients || value.channel?.rawRecipients;
        if (Array.isArray(recipients)) {
            for (const r of recipients) {
                const id = r?.id || r;
                if (id && this._isUserId(id)) out.add(String(id));
            }
        }
        const single = this.fromProps(value, depth);
        if (single) out.add(single);
        for (const key of [ "props", "memoizedProps", "pendingProps", "channel" ]) {
            if (value[key]) this._extractAllFromProps(value[key], depth + 1, out);
        }
        return out;
    }
    _walkFibers(el, visitor, maxDepth, label) {
        try {
            let fiber = BdApi.ReactUtils.getInternalInstance(el);
            for (let i = 0; i < maxDepth && fiber; i++, fiber = fiber.return) {
                const result = visitor(fiber);
                if (result) return result;
            }
        } catch (err) {
            this.p._patcher._logFail(label, err);
        }
        return null;
    }
    walkFiberShallow(el, visitor) {
        this._walkFibers(el, fiber => {
            if (fiber.memoizedProps) visitor(fiber.memoizedProps);
        }, 10, "_walkFiberPropsShallow");
    }
    fromProps(value, depth = 0) {
        if (!value || depth > 3) return null;
        if (typeof value === "string" && this._isUserId(value)) return value;
        if (typeof value !== "object") return null;
        const direct = value.userId || value.authorId || value.recipientId || value.ownerId || value.owner_id || value.creatorId || value.creator_id;
        if (direct && this._isUserId(direct)) return String(direct);
        if (value.id && (value.username || value.discriminator || value.globalName) && this._isUserId(value.id)) {
            return String(value.id);
        }
        const nested = value.user?.id || value.author?.id || value.member?.userId || value.member?.user?.id || value.guildMember?.userId || value.guildMember?.user?.id || value.participant?.userId || value.participant?.user?.id || value.voiceState?.userId || value.message?.author?.id || value.baseMessage?.author?.id || value.recipient?.id || value.channel?.recipientId || value.reactor?.id || value.reactor?.user?.id || value.reactorInfo?.id || value.reactorInfo?.user?.id || value.creator?.id || value.guildScheduledEvent?.creatorId || value.event?.creatorId;
        if (nested && this._isUserId(nested)) return String(nested);
        for (const key of [ "props", "memoizedProps", "pendingProps", "record", "row", "message", "reactor", "reactorInfo" ]) {
            if (value[key]) {
                const found = this.fromProps(value[key], depth + 1);
                if (found) return found;
            }
        }
        return null;
    }
    walkFiber(el, visitor, maxDepth = 12) {
        this._walkFibers(el, fiber => {
            visitor(fiber.memoizedProps);
            visitor(fiber.pendingProps);
        }, maxDepth, "walkFiberProps");
    }
    fromFiber(el, predicate, maxHops = 20, label = "findComponentViaFiber") {
        return this._walkFibers(el, fiber => {
            if (typeof fiber.type === "function" && predicate(fiber.type, fiber.memoizedProps || fiber.pendingProps, fiber)) return fiber.type;
        }, maxHops, label);
    }
    fromChannel(el) {
        if (!el) return null;
        try {
            const listId = el.dataset?.listItemId || el.querySelector?.("[data-list-item-id]")?.dataset?.listItemId || "";
            const ids = listId.match(/\d{17,20}/g) || el.id?.match(/\d{17,20}/g);
            if (ids?.length) return ids[ids.length - 1];
            if (el.dataset?.channelId) return el.dataset.channelId;
            const hrefEl = el.matches?.("a[href*='/channels/']") ? el : el.querySelector?.("a[href*='/channels/']");
            const hrefMatch = hrefEl?.getAttribute?.("href")?.match(/\/channels\/(?:@me|\d+)\/(\d{17,20})/);
            if (hrefMatch) return hrefMatch[1];
        } catch (error) { _recordPatchCatch("identity.fromChannel", this.p, error); }
        return null;
    }
}


function createMemberSurfaceApi(plugin) {
    return Object.freeze({
        get memberListEnabled() { return !!plugin.settings.places?.memberList; },
        stores: Object.freeze({
            get GuildMemberStore() { return plugin.modules.GuildMemberStore; },
            get GuildStore() { return plugin.modules.GuildStore; },
            get UserStore() { return plugin.modules.UserStore; },
        }),
        identity: Object.freeze({
            findUserId: element => plugin.findUserId(element),
            extractUserId: (value, depth) => plugin.extractUserId(value, depth),
        }),
        fiber: Object.freeze({ findComponent: (...args) => plugin.findComponentViaFiber(...args) }),
        moduleResolver: Object.freeze({ getWithKey: (...args) => plugin._r.getWithKey(...args) }),
        navigation: Object.freeze({ registerRetryHook: (...args) => plugin._registerNavigationRetryHook(...args) }),
        visibility: _surfaceUserVisibility(plugin),
        dom: Object.freeze({
            hideElement: (...args) => plugin.hideElement(...args),
        }),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            warn: (...args) => plugin._patcher?._warn(...args),
            logFailure: (...args) => plugin._patcher._logFail(...args),
            after: (...args) => plugin.patchAfter(...args),
            instead: (...args) => plugin.patchInstead(...args),
            resolvePatchTarget: (...args) => plugin._patcher.resolvePatchTarget(...args),
            patchRenderBySourceHeuristic: (...args) => plugin._wpPatchRenderBySourceHeuristic(...args),
        }),
        retry: _surfaceRetry(plugin, ["guardEnter","guardExit","delay","schedule"]),
        lifecycle: _runningLifecycle(plugin),
        health: Object.freeze({
            register: (...args) => plugin._health?.register(...args),
            scoredCandidateFor: label => plugin._r.scoredCandidateFor(label),
        }),
    });
}

class MemberSurface {
    constructor(api) {
        this.api = api;
    }
    patchEarly() {
        this.api.patching.safe('patchGuildMemberStore', () => this.patchGuildMemberStore());
    }
    patchLate() {
        this.api.patching.safe('patchGuildMembersPageRow', () => this.patchGuildMembersPageRow());
        this.api.patching.safe('patchMemberListRow', () => this.patchMemberListRow());
    }
    scan() {
        this.hideMemberRows();
    }
    scanCounts() {
        this.fixMemberGroupCounts();
    }
    recover() {
        try { this.hideMemberRows(); } catch (error) { _recordPatchCatch("members.recover", null, error); }
        try { this._warnIfAmbiguousScoredPatch(); } catch (error) { _recordPatchCatch("members.recover.scoreDiagnostic", null, error); }
    }
    _warnIfAmbiguousScoredPatch() {
        for (const label of ["patchGuildMembersPageRow", "patchMemberListRow:heuristic"]) {
            const info = this.api.health.scoredCandidateFor(label);
            if (info?.ambiguous) {
                this.api.patching.warn(label, new Error(`health check failed shortly after a scored patch (${info.hitCount}/${info.totalTermCount} terms, ${info.qualifyingCandidates} candidates tied) - the heuristic may have picked the wrong module. Consider tightening the term list for this patch.`));
            }
        }
    }
    registerHealthChecks() {
        this.api.health.register(
            "members",
            () => {
                if (!this.api.memberListEnabled) return true;
                const els = document.querySelectorAll('[data-list-item-id]:not([data-hidden-blocked="true"])');
                let sample = 0;
                for (let i = 0; i < els.length && sample < 40; i++) {
                    const el = els[i];
                    if (!el.closest?.(_SEL.memberListContainer)) continue;
                    sample++;
                    const userId = this.api.identity.findUserId(el);
                    if (userId && this.api.visibility.shouldHide(userId)) return false;
                }
                return true;
            },
            () => this.recover()
        );
    }
    stop() {
        this._guildMembersPagePatched = false;
        this._guildMemberStorePatched = false;
        this._guildMemberStorePatchTarget = null;
        this._guildMemberStorePatchedMethods = new WeakMap();
        this._guildMemberStorePatchedMethodRefs = new WeakMap();
        this._memberListRowPatched = false;
        this._memberListRowWaitCycles = 0;
        this._guildMembersPageRowWaitCycles = 0;
    }
    isGuildMemberStorePatchCurrent() {
        const store = this.api.stores.GuildMemberStore;
        if (!this._guildMemberStorePatched || !store || this._guildMemberStorePatchTarget !== store) return false;
        const refs = this._guildMemberStorePatchedMethodRefs?.get(store);
        if (!refs || !refs.size) return false;
        return [...refs].every(([method, patchedFn]) => store[method] === patchedFn);
    }
    patchGuildMemberStore(attempt = 0) {
        if (!this.api.memberListEnabled || this.isGuildMemberStorePatchCurrent()) return;
        const store = this.api.stores.GuildMemberStore;
        if (this._guildMemberStorePatchTarget !== store) this._guildMemberStorePatched = false;
        if (!this.api.retry.guardEnter("patchGuildMemberStore", attempt)) return;
        if (!store) {
            this._retryGuildMemberStore(attempt, "GuildMemberStore unavailable after several attempts");
            return;
        }
        this._guildMemberStorePatchTarget = store;
        this._guildMemberStorePatched = this._installGuildMemberStoreFilters(store, this._createGuildMemberStoreFilters());
        if (this._guildMemberStorePatched) this.api.retry.guardExit("patchGuildMemberStore");
        else this._retryGuildMemberStore(attempt, "could not install all applicable patches on GuildMemberStore after several attempts (methods unavailable or patcher rejected a patch)");
    }
    _retryGuildMemberStore(attempt, failureMessage) {
        if (attempt < 15) {
            this.api.retry.schedule(() => this.patchGuildMemberStore(attempt + 1), this.api.retry.delay(attempt, 2000));
            return;
        }
        this.api.patching.warn("patchGuildMemberStore", new Error(failureMessage));
        this.api.retry.guardExit("patchGuildMemberStore");
    }
    _createGuildMemberStoreFilters() {
        const api = this.api;
        const isHiddenId = id => id && api.visibility.shouldHide(id);
        return [
            { method: "getMemberIds", callback: (_, __, result) => {
                if (!api.memberListEnabled || !Array.isArray(result)) return result;
                return result.filter(id => !isHiddenId(id));
            } },
            { method: "getMembers", callback: (_, __, result) => {
                if (!api.memberListEnabled || !Array.isArray(result)) return result;
                return result.filter(member => !isHiddenId(member?.userId || member?.user?.id || api.identity.extractUserId(member)));
            } },
            { method: "getMember", callback: (_, args, result) => this._filterGuildMemberResult(args, result) },
            { method: "getNickname", countsForSuccess: false, callback: (_, args, result) => {
                if (!api.memberListEnabled) return result;
                return isHiddenId(args?.[1]) ? null : result;
            } },
        ];
    }
    _filterGuildMemberResult(args, result) {
        const api = this.api;
        if (!api.memberListEnabled || !result) return result;
        const guildId = args?.[0];
        const userId = args?.[1] || result.userId || result.user?.id;
        if (!userId) return result;
        try {
            const myId = api.stores.UserStore?.getCurrentUser?.()?.id;
            if (!guildId || (myId && userId === myId)) return result;
            const guild = api.stores.GuildStore?.getGuild?.(guildId);
            if (guild && (userId === guildId || userId === guild.ownerId || userId === guild.owner_id)) return result;
        } catch (error) { _recordPatchCatch("members.guildMemberProtection", api, error); }
        return api.visibility.shouldHide(userId) ? null : result;
    }
    _installGuildMemberStoreFilters(store, filters) {
        const { methods, refs } = _getStorePatchState(this, store, "_guildMemberStorePatchedMethods", "_guildMemberStorePatchedMethodRefs");
        return _installAfterPatchBatch(store, filters, methods, refs, (...args) => this.api.patching.after(...args));
    }
    patchGuildMembersPageRow(attempt = 0) {
        if (!this.api.memberListEnabled || this._guildMembersPagePatched) return;
        this._ensureGuildMembersPageRowRetryListener();
        const self = this.api;
        const patchedViaHeuristic = this.api.patching.patchRenderBySourceHeuristic(props => {
            if (!self.memberListEnabled) return false;
            const userId = self.identity.extractUserId(props);
            return !!(userId && self.visibility.shouldHide(userId));
        }, [
            "joinedAt", "userId",
            "memberRow", "guildMember", "roleIcon", "premiumSince", "pendingMember",
            "member", "listItem", "memberListItem", "avatarDecoration", "nick",
            "roleIcons", "premiumSubscriber", "colorRoleId", "colorString", "isOwner"
        ], 3, "patchGuildMembersPageRow");
        if (patchedViaHeuristic) {
            this._guildMembersPagePatched = true;
            return;
        }
        const rowSelector = _SEL.memberRow + ', [data-list-item-id]:not([data-list-item-id^="pins__"]):not([data-list-item-id*="channels"])';
        const hadCandidateRows = document.querySelector(rowSelector) !== null;
        const RowComponent = hadCandidateRows ? this._findGuildMembersPageRowComponent(rowSelector) : null;
        const patched = RowComponent ? this._patchExactGuildMembersPageRowComponent(RowComponent) : false;
        if (patched) {
            this._guildMembersPagePatched = true;
            return;
        }
        if (!hadCandidateRows) {
            if (this._guildMembersPageRowWaitCycles === undefined) this._guildMembersPageRowWaitCycles = 0;
            this._guildMembersPageRowWaitCycles++;
            if (this._guildMembersPageRowWaitCycles < 750) {
                this.api.retry.schedule(() => this.patchGuildMembersPageRow(attempt), 400);
                return;
            }
            this.api.patching.logFailure("patchGuildMembersPageRow", new Error("gave up waiting for the guild members page to appear on screen after ~5 minutes"));
            return;
        }
        this._guildMembersPageRowWaitCycles = 0;
        if (attempt < 20) {
            this.api.retry.schedule(() => this.patchGuildMembersPageRow(attempt + 1), this.api.retry.delay(attempt, 2500));
        } else {
            this.api.patching.logFailure("patchGuildMembersPageRow", new Error("ran out of attempts - indicators did not find the module via heuristic, and fiber-walk fallback also failed to locate a row with a resolvable user id; see maintenance notes"));
        }
    }
    _shouldSuppressGuildMembersPageRow(props) {
        return this._shouldSuppressMemberListRow(props);
    }
    _findGuildMembersPageRowComponent(rowSelector) {
        return this._findMemberListRowComponent(rowSelector, "patchGuildMembersPageRow:fiberWalk");
    }
    _patchExactGuildMembersPageRowComponent(Comp) {
        return this._patchExactMemberRowComponent(Comp, {
            marker: "__byeblockedGuildMembersPageRowPatched", suppress: "_shouldSuppressGuildMembersPageRow",
            renderError: "MemberSurface._patchExactGuildMembersPageRowComponent.instead",
            resolveError: "MemberSurface._patchExactGuildMembersPageRowComponent.resolve"
        });
    }
    _ensureGuildMembersPageRowRetryListener() {
        if (this._guildMembersPageRowRetryListenerAdded) return;
        this._guildMembersPageRowRetryListenerAdded = true;
        this._registerMemberRowRetry("guildMembersPageRow", "_guildMembersPagePatched", "_guildMembersPageRowWaitCycles", "patchGuildMembersPageRow");
    }
    _shouldSuppressMemberListRow(props) {
        if (!this.api.memberListEnabled || !props || typeof props !== "object") return false;
        const userId = props?.user?.id || this.api.identity.extractUserId(props);
        return !!(userId && this.api.visibility.shouldHide(userId));
    }
    _findMemberListRowComponent(rowSelector, label = "patchMemberListRow:fiberWalk") {
        const candidates = document.querySelectorAll(rowSelector);
        for (const el of candidates) {
            const match = this.api.fiber.findComponent(el, (type, props) => {
                if (!props || typeof props !== "object") return false;
                const uid = props.user?.id || this.api.identity.extractUserId(props.user) || this.api.identity.extractUserId(props);
                return !!uid;
            }, 20, label);
            if (match) return match;
        }
        return null;
    }
    _patchExactMemberListRowComponent(Comp) {
        return this._patchExactMemberRowComponent(Comp, {
            marker: "__byeblockedMemberRowPatched", suppress: "_shouldSuppressMemberListRow",
            renderError: "MemberSurface._patchExactMemberListRowComponent.L1007",
            resolveError: "MemberSurface._patchExactMemberListRowComponent.L1014"
        });
    }
    _patchExactMemberRowComponent(Comp, { marker, suppress, renderError, resolveError }) {
        if (!Comp || Comp[marker]) return !!Comp?.[marker];
        try {
            const found = this.api.moduleResolver.getWithKey(m => m === Comp);
            if (found?.[0] && found[1]) {
                const resolved = this.api.patching.resolvePatchTarget(found[0], found[1]);
                if (!resolved) return false;
                const patched = this.api.patching.instead(resolved.target, resolved.key, function(ctx, args, orig) {
                    try {
                        if (this[suppress](args?.[0] || ctx?.props)) return null;
                    } catch (error) { _recordPatchCatch(renderError, null, error); }
                    return orig.apply(ctx, args);
                }.bind(this));
                if (!patched) return false;
                Comp[marker] = true;
                return true;
            }
        } catch (error) { _recordPatchCatch(resolveError, null, error); }
        return false;
    }
    patchMemberListRow(attempt = 0) {
        if (!this.api.memberListEnabled || this._memberListRowPatched) return;
        this._ensureMemberListRowRetryListener();
        const suppressByProps = props => this._shouldSuppressMemberListRow(props);
        const patchedViaHeuristic = this.api.patching.patchRenderBySourceHeuristic(
            suppressByProps,
            [
                "guildId", "user",
                "isOwner", "isMobileOnline", "isVROnline", "premiumSince",
                "colorString", "avatarDecoration", "statusColor", "activity"
            ],
            3,
            "patchMemberListRow:heuristic"
        );
        if (patchedViaHeuristic) {
            this._memberListRowPatched = true;
            return;
        }
        const rowSelector = '[data-list-item-id^="members-"], ul[aria-label] > li, [role="listitem"]';
        const hadCandidateRows = document.querySelector(rowSelector) !== null;
        const RowComponent = hadCandidateRows ? this._findMemberListRowComponent(rowSelector) : null;
        const patched = RowComponent ? this._patchExactMemberListRowComponent(RowComponent) : false;
        if (patched) {
            this._memberListRowPatched = true;
            return;
        }
        if (!hadCandidateRows) {
            if (!this._isMemberListOpen()) {
                return;
            }
            if (this._memberListRowWaitCycles === undefined) this._memberListRowWaitCycles = 0;
            this._memberListRowWaitCycles++;
            if (this._memberListRowWaitCycles < 750) {
                this.api.retry.schedule(() => this.patchMemberListRow(attempt), 400);
                return;
            }
            this.api.patching.logFailure("patchMemberListRow", new Error("gave up waiting for the member list to appear on screen after ~5 minutes"));
            return;
        }
        this._memberListRowWaitCycles = 0;
        if (attempt < 20) {
            this.api.retry.schedule(() => this.patchMemberListRow(attempt + 1), this.api.retry.delay(attempt, 2500));
        } else {
            this.api.patching.logFailure("patchMemberListRow", new Error("ran out of attempts - could not locate a member-list row with both guildId and a resolvable user id in its DOM/Fiber tree; the member list may not have been open/rendered during any attempt. See maintenance notes."));
        }
    }
    _isMemberListOpen() {
        try {
            return !!document.querySelector(_SEL.memberListContainer);
        } catch (_) {
            return false;
        }
    }
    _ensureMemberListRowRetryListener() {
        this._registerMemberRowRetry("memberListRow", "_memberListRowPatched", "_memberListRowWaitCycles", "patchMemberListRow");
    }
    _registerMemberRowRetry(name, patchedKey, waitKey, patchMethod) {
        const surface = this;
        const self = this.api;
        this.api.navigation.registerRetryHook(name, () => {
            if (!self.lifecycle.isRunning) return;
            if (!surface[patchedKey]) {
                surface[waitKey] = 0;
                surface[patchMethod](0);
            }
        });
    }
    hideMemberRows() {
        for (const element of this._collectMemberRowElements()) {
            const userId = this.api.identity.findUserId(element);
            if (this.api.visibility.shouldHide(userId)) this._hideMemberRowElement(element, userId);
        }
        this.fixGuildMembersPageCount();
        try { this.fixMemberGroupCounts(); } catch (error) { _recordPatchCatch("members.fixGroupCounts", null, error); }
    }
    *_collectMemberRowElements() {
        const rowSelector = '[data-list-item-id]:not([data-hidden-blocked="true"]), [class*="member-"]:not([data-hidden-blocked="true"]), [class*="member_"]:not([data-hidden-blocked="true"]), [class*="memberRow"]:not([data-hidden-blocked="true"])';
        const roots = [];
        const sidebarContainers = document.querySelectorAll(_SEL.memberListContainer);
        for (let i = 0; i < sidebarContainers.length; i++) roots.push(sidebarContainers[i]);
        const pageCounters = document.querySelectorAll('[class*="membersCount"]');
        for (let i = 0; i < pageCounters.length; i++) {
            const scope = pageCounters[i].closest('[class*="members"]') || pageCounters[i].parentElement?.parentElement;
            if (scope) roots.push(scope);
        }
        if (!roots.length) roots.push(document);
        const seen = new Set();
        for (const root of roots) {
            for (const element of root.querySelectorAll(rowSelector)) {
                if (seen.has(element)) continue;
                seen.add(element);
                yield element;
            }
        }
    }
    _hideMemberRowElement(element, userId) {
        const row = element.closest("[data-list-item-id]") || element.closest(_SEL.memberRow) || element;
        this.api.dom.hideElement(row, row.matches?.(_SEL.memberRow) ? "guild-members-page" : "member", userId);
    }
    _countVisibleMemberRows(rows) {
        let visible = 0;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].dataset?.hiddenBlocked !== "true") visible++;
        }
        return visible;
    }
    _setMemberCountText(element, value, previous = null) {
        if (!element.hasAttribute(_ATTR.prevText)) element.setAttribute(_ATTR.prevText, previous ?? element.textContent);
        _setTemporaryText(element, value, "memberList");
    }
    fixGuildMembersPageCount() {
        if (!this.api.memberListEnabled) return;
        const counters = document.querySelectorAll('[class*="membersCount"]');
        const scopes = new Set();
        for (let i = 0; i < counters.length; i++) {
            const counter = counters[i];
            const scope = counter.closest('[class*="members"]') || counter.parentElement?.parentElement;
            if (!scope) continue;
            scopes.add(scope);
            const rows = scope.querySelectorAll(_SEL.memberRow);
            if (!rows.length) continue;
            const visible = this._countVisibleMemberRows(rows);
            const text = counter.textContent || "";
            const updated = text.replace(/\b\d[\d.,]*\b/, String(visible));
            if (updated === text || !/\d/.test(text)) continue;
            this._setMemberCountText(counter, updated, text);
        }
        if (scopes.size) {
            for (const scope of scopes) this._fixGuildMembersShowingCountFooter(scope);
        } else {
            this._fixGuildMembersShowingCountFooter(document);
        }
    }
    _fixGuildMembersShowingCountFooter(root) {
        const searchRoot = root || document;
        const showingRegex = /^(?:mostrando|showing)\s+\d[\d.,]*\s+(?:membros?|members?)$/i;
        const candidates = searchRoot.querySelectorAll("div[data-text-variant], span[data-text-variant], p[data-text-variant], div, span, p");
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            const strong = el.querySelector(":scope > strong");
            if (!strong) continue;
            const text = (el.textContent || "").trim().replace(/\s+/g, " ");
            if (!showingRegex.test(text)) continue;
            let scope = el;
            let rows = null;
            for (let k = 0; k < 6 && scope; k++, scope = scope.parentElement) {
                const found = scope.querySelectorAll(_SEL.memberRow);
                if (found.length) {
                    rows = found;
                    break;
                }
            }
            if (!rows || !rows.length) continue;
            const visible = this._countVisibleMemberRows(rows);
            const currentNum = parseInt((strong.textContent || "").replace(/[^\d]/g, ""), 10);
            if (Number.isNaN(currentNum) || currentNum === visible) continue;
            this._setMemberCountText(strong, String(visible));
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
                this.api.dom.hideElement(header, "empty-member-header");
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
        let sawAnySibling = false;
        let next = header.nextElementSibling;
        while (next) {
            if (this.isMemberGroupHeader(next)) break;
            sawAnySibling = true;
            if (next.dataset?.hiddenBlocked === "true") { next = next.nextElementSibling; continue; }
            const userId = this.api.identity.findUserId(next);
            if (userId) {
                sawMember = true;
                if (!this.api.visibility.shouldHide(userId)) count++;
            }
            next = next.nextElementSibling;
        }
        if (sawMember) return count;
        if (sawAnySibling && this._headerReportsNonZeroCount(header)) return 0;
        if (!sawAnySibling && this._headerReportsNonZeroCount(header) && header.nextElementSibling && this.isMemberGroupHeader(header.nextElementSibling)) return 0;
        return null;
    }
    _headerReportsNonZeroCount(header) {
        const text = (header.textContent || "").trim();
        const match = text.match(/[\u2013\u2014]\s*(\d+)\s*$/);
        return !!(match && parseInt(match[1], 10) > 0);
    }
    updateMemberGroupVisibleCount(header, count) {
        const headerDiv = header.querySelector('[class*="membersGroupHeader"]') || header;
        const spans = Array.from(headerDiv.querySelectorAll("span"));
        const countSpan = spans.find(span => {
            if (span.className && span.className.includes("membersGroupName")) return false;
            return /[\u2013\u2014]\s*\d+/.test(span.textContent || "");
        });
        if (countSpan) {
            this._setMemberCountText(countSpan, `\u00a0\u2014 ${count}`);
        }
        const hiddenSpan = header.querySelector('[class*="hiddenVisually"]');
        if (hiddenSpan) {
            this._setMemberCountText(hiddenSpan, hiddenSpan.textContent.replace(/\d+/, count));
        }
    }
}
function createAutocompleteSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({
            get autocompleteEnabled() { return !!plugin.settings?.places?.autocomplete; },
            get messagesEnabled() { return !!plugin.settings?.places?.messages; },
        }),
        identity: Object.freeze({ findUserId: element => plugin.findUserId(element) }),
        visibility: Object.freeze({
            shouldHide: userId => plugin.shouldHide(userId),
            isThreadOwnerFilteringCovered: () => plugin._isThreadOwnerFilteringCovered(),
        }),
        dom: Object.freeze({ hideElement: (...args) => plugin.hideElement(...args) }),
        moduleResolver: Object.freeze({
            getWithKey: (...args) => plugin._r.getWithKey(...args),
            getBySource: (...args) => plugin._r.getBySource(...args),
            get: (...args) => plugin._r.get(...args),
            findFunctionKeyFuzzy: (...args) => plugin._wpFindFnKeyFuzzy(...args),
            getChannel: channelId => plugin.modules.ChannelStore?.getChannel?.(channelId),
        }),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            warn: (...args) => plugin._patcher?._warn(...args),
            logFailure: (...args) => plugin._patcher._logFail(...args),
            instead: (...args) => plugin.patchInstead(...args),
            after: (...args) => plugin.patchAfter(...args),
            patchRenderBySourceHeuristic: (...args) => plugin._wpPatchRenderBySourceHeuristic(...args),
            patchInviteSuggestions: () => plugin.patchInviteSuggestions(),
        }),
        diagnostics: Object.freeze({ warn: (...args) => plugin.logger?.warn(...args) }),
        invite: Object.freeze({
            get suggestionsPatched() { return !!(plugin._inviteSuggestionsPatched || (plugin.modules.InviteQueryModule && plugin.modules.InviteQueryComposeKey)); },
        }),
        retry: _surfaceRetry(plugin, ["schedule","delay","guardEnter","guardExit"]),
        health: Object.freeze({
            heartbeat: name => plugin._health?.heartbeat(name),
            register: (...args) => plugin._health?.register(...args),
        }),
        coordination: Object.freeze({
            get scanInFlight() { return plugin.scanInFlight; },
            queueScan: (...args) => plugin.queueScan(...args),
        }),
    });
}

class AutocompleteSurface {
    constructor(api) {
        this.api = api;
    }
    patchEarly() {
        this.api.patching.safe('patchActivePostsPopoverComponent', () => this.patchActivePostsPopoverComponent());
    }
    patchLate() {
        this.api.patching.safe('patchMentionAutocomplete', () => this.patchMentionAutocomplete());
        this.api.patching.safe('patchAutocompleteRowComponent', () => this.patchAutocompleteRowComponent());
    }
    scan() {
        this.hideAutocompleteRows();
    }
    registerHealthChecks() {
        this.api.health.register(
            "autocomplete",
            () => {
                if (!this.api.settings.autocompleteEnabled) return true;
                const rows = document.querySelectorAll('[data-list-id^="channel-autocomplete"] [role="option"]:not([data-hidden-blocked="true"]), [data-list-id^="mention-autocomplete"] [role="option"]:not([data-hidden-blocked="true"])');
                let sample = 0;
                for (let i = 0; i < rows.length && sample < 40; i++) {
                    const row = rows[i];
                    sample++;
                    const userId = this.api.identity.findUserId(row);
                    if (userId && this.api.visibility.shouldHide(userId)) return false;
                }
                return true;
            },
            () => {
                if (this.api.coordination.scanInFlight) return;
                try { this.api.coordination.queueScan(); } catch (error) { _recordPatchCatch("autocomplete.healthRescan", this, error); }
            }
        );
        this.api.health.register(
            "autocompleteRowPatch",
            () => !this.api.settings.autocompleteEnabled || !!this._autocompleteRowPatched,
            () => {
                this.api.diagnostics.warn("The autocomplete row patch appears inactive - Discord may have changed the component's structure. Consider updating the plugin.");
                try { this.patchAutocompleteRowComponent(); } catch (error) { _recordPatchCatch("autocomplete.patchRepair", this, error); }
            }
        );
        this.api.health.register(
            "inviteQueryModule",
            () => !this.api.settings.autocompleteEnabled || this.api.invite.suggestionsPatched,
            () => {
                this.api.diagnostics.warn("The invite suggestions patch appears inactive - Discord may have changed the invite query module. Consider updating the plugin.");
                try { this.api.patching.patchInviteSuggestions(); } catch (error) { _recordPatchCatch("autocomplete.invitePatchRepair", this, error); }
            }
        );
        this.api.health.register(
            "activePostsPopover",
            () => {
                if (!this.api.settings.messagesEnabled || this._activePostsPopoverPatched) return true;
                if (this.api.visibility.isThreadOwnerFilteringCovered()) return true;
                try { return !document.querySelector('[class*="activePostsPopout_"], [class*="activePostsWrapper_"]'); } catch (_) { return true; }
            },
            () => {
                if (!this.api.visibility.isThreadOwnerFilteringCovered()) {
                    try { this.patchActivePostsPopoverComponent(); } catch (error) { _recordPatchCatch("activePostsPopover.patchRepair", this, error); }
                }
            },
            2,
            () => this.api.visibility.isThreadOwnerFilteringCovered()
        );
    }
    stop() {
        this._autocompleteRowPatched = false;
        this._mentionAutocompletePatched = false;
        this._activePostsPopoverPatched = false;
    }
    hideAutocompleteRows() {
        _hideBlockedRows(this, '[data-list-id^="channel-autocomplete"] [role="option"], [data-list-id^="mention-autocomplete"] [role="option"]', "autocomplete");
    }
    _createAutocompleteRowFilter(api, isClass) {
        return function(ctx, args, orig) {
            api.health.heartbeat("autocompleteRowPatch");
            try {
                if (!api.settings.autocompleteEnabled) return orig.apply(ctx, args);
                const props = isClass ? ctx?.props || {} : args?.[0] || ctx?.props;
                const uid = props?.user?.id || props?.userId || props?.suggestion?.id;
                if (uid && api.visibility.shouldHide(uid)) return null;
            } catch (error) {
                _recordPatchCatch(isClass ? "AutocompleteSurface.patchAutocompleteRowComponent.L1395" : "AutocompleteSurface.patchAutocompleteRowComponent.L1409", null, error);
            }
            return orig.apply(ctx, args);
        };
    }
    patchAutocompleteRowComponent(attempt = 0) {
        if (!this.api.settings.autocompleteEnabled) return;
        if (this._autocompleteRowPatched) return;
        const api = this.api;
        try {
            const AUTOCOMPLETE_TERMS = ["autocomplete", "aria-selected", "user", "userId"];
            const AUTOCOMPLETE_REQUIRED = 3;
            const LABEL = "Autocomplete row component (patchAutocompleteRowComponent target)";
            const result = this.api.moduleResolver.getWithKey(m => {
                const isClass = typeof m === "function" && /^class\s/.test(Function.prototype.toString.call(m));
                if (typeof m !== "function") return false;
                try {
                    if (isClass) {
                        const proto = m.prototype;
                        if (!proto || (typeof proto.render !== "function" && typeof proto.renderContent !== "function")) return false;
                        const renderSrc = Function.prototype.toString.call(proto.renderContent || proto.render);
                        return AUTOCOMPLETE_TERMS.filter(t => renderSrc.includes(t)).length >= AUTOCOMPLETE_REQUIRED;
                    }
                    const src = Function.prototype.toString.call(m);
                    if (src.startsWith("class ")) return false;
                    return AUTOCOMPLETE_TERMS.filter(t => src.includes(t)).length >= AUTOCOMPLETE_REQUIRED;
                } catch (_) { return false; }
            }, LABEL);
            if (result) {
                let [mod, key] = result;
                if (mod && key == null) key = this.api.moduleResolver.findFunctionKeyFuzzy(mod, ...AUTOCOMPLETE_TERMS);
                if (mod && key) {
                const candidate = mod[key];
                const isClassTarget = typeof candidate === "function" && /^class\s/.test(Function.prototype.toString.call(candidate));
                if (isClassTarget) {
                    const proto = candidate.prototype;
                    const renderMethod = typeof proto.render === "function" ? "render" : (typeof proto.renderContent === "function" ? "renderContent" : null);
                    if (proto && renderMethod) {
                        const installed = this.api.patching.instead(proto, renderMethod, this._createAutocompleteRowFilter(api, true));
                        if (installed) {
                            this._autocompleteRowPatched = true;
                            return;
                        }
                    }
                } else {
                const installed = this.api.patching.instead(mod, key, this._createAutocompleteRowFilter(api, false));
                if (installed) {
                    this._autocompleteRowPatched = true;
                    return;
                }
                }
                }
            }
        } catch (err) { this.api.patching.warn("patchAutocompleteRowComponent", err); }
        if (!this._autocompleteRowPatched && attempt < 6) {
            this.api.retry.schedule(() => this.patchAutocompleteRowComponent(attempt + 1), this.api.retry.delay(attempt, 5000));
        } else if (!this._autocompleteRowPatched) {
            this.api.patching.warn("patchAutocompleteRowComponent", new Error("ran out of attempts - no module matched the autocomplete-row term set; Discord likely renamed something in this component"));
        }
    }
    _findMentionAutocompleteTarget() {
        const STRICT_SOURCES = ["queryMentionResults", "mention-autocomplete", "getMentionSuggestions"];
        let mod = null;
        let key = null;
        for (const source of STRICT_SOURCES) {
            mod = this.api.moduleResolver.getBySource(source, { defaultExport: false }) || this.api.moduleResolver.getBySource(source);
            if (mod) {
                key = this.api.moduleResolver.findFunctionKeyFuzzy(mod, source, "mention", "suggest");
                if (key && _isNativeClass(mod[key])) key = null;
                if (key) break;
            }
        }
        if (!mod || !key) {
            const WEAK_INDICATORS = ["mention", "suggest", "autocomplete", "queryresult"];
            const REQUIRED_MATCHES = 3;
            const matchesSource = value => {
                if (typeof value !== "function" || _isNativeClass(value)) return false;
                try {
                    const source = value.toString().toLowerCase();
                    return WEAK_INDICATORS.filter(term => source.includes(term)).length >= REQUIRED_MATCHES;
                } catch (_) { return false; }
            };
            const candidateModules = this.api.moduleResolver.get(m => {
                if (typeof m !== "object" || !m) return false;
                return Object.values(m).some(matchesSource);
            }, { first: false, searchExports: true }) || [];
            for (const candidate of candidateModules) {
                for (const k of Object.keys(candidate)) {
                    if (matchesSource(candidate[k])) {
                        mod = candidate; key = k; break;
                    }
                }
                if (mod && key) break;
            }
        }
        if (!mod || !key || typeof mod[key] !== "function" || _isNativeClass(mod[key])) return null;
        return { module: mod, key };
    }
    _filterMentionAutocompleteResult(result) {
        if (!this.api.settings.autocompleteEnabled || !result) return result;
        const filterUser = user => {
            const id = user?.id || user?.userId || user?.user?.id;
            return !(id && this.api.visibility.shouldHide(id));
        };
        const looksLikeUserArray = users => users.length === 0 || users.some(user => user?.id || user?.userId || user?.user?.id);
        if (Array.isArray(result) && looksLikeUserArray(result)) return result.filter(filterUser);
        for (const key of ["results", "users"]) {
            if (Array.isArray(result[key]) && looksLikeUserArray(result[key])) result[key] = result[key].filter(filterUser);
        }
        return result;
    }
    patchMentionAutocomplete(attempt = 0) {
        if (this._mentionAutocompletePatched || !this.api.settings.autocompleteEnabled) return;
        const target = this._findMentionAutocompleteTarget();
        const installed = target && this.api.patching.after(target.module, target.key, (_, __, result) => this._filterMentionAutocompleteResult(result));
        if (installed) {
            this._mentionAutocompletePatched = true;
        } else if (attempt < 20) {
            this.api.retry.schedule(() => this.patchMentionAutocomplete(attempt + 1), this.api.retry.delay(attempt, 3e3));
        } else {
            this.api.patching.logFailure("patchMentionAutocomplete", new Error(target
                ? "mention autocomplete patch failed after several attempts"
                : "ran out of attempts - indicators did not find the module; see maintenance notes"));
        }
    }
    patchActivePostsPopoverComponent(attempt = 0) {
        if (!this.api.settings.messagesEnabled || this._activePostsPopoverPatched) return;
        if (!this.api.retry.guardEnter("patchActivePostsPopoverComponent", attempt)) return;
        const api = this.api;
        const diagnosticLabel = this.api.visibility.isThreadOwnerFilteringCovered() ? null : "patchActivePostsPopoverComponent";
        const patched = this.api.patching.patchRenderBySourceHeuristic(props => {
            if (!api.settings.messagesEnabled) return false;
            const thread = props?.thread || props?.item?.thread || props?.data?.thread;
            const ownerId = thread?.ownerId || thread?.owner_id;
            if (ownerId && api.visibility.shouldHide(ownerId)) return true;
            const threadId = thread?.id;
            if (threadId) {
                const ch = api.moduleResolver.getChannel(threadId);
                const oid = ch?.ownerId || ch?.owner_id;
                if (oid && api.visibility.shouldHide(oid)) return true;
            }
            return false;
        }, ["row__", "thread", "active", "ownerId", "recipients", "activePost", "threadId", "forumPost", "postRow", "lastMessageId"], 2, diagnosticLabel);
        if (patched) {
            this._activePostsPopoverPatched = true;
            this.api.retry.guardExit("patchActivePostsPopoverComponent");
            return;
        }
        if (attempt < 6) {
            this.api.retry.schedule(() => this.patchActivePostsPopoverComponent(attempt + 1), this.api.retry.delay(attempt, 5000));
        } else {
            this.api.retry.guardExit("patchActivePostsPopoverComponent");
            try {
                const popoverOpen = document.querySelector('[class*="activePostsPopout_"], [class*="activePostsWrapper_"]');
                if (popoverOpen && !this.api.visibility.isThreadOwnerFilteringCovered()) {
                    this.api.patching.warn("patchActivePostsPopoverComponent", new Error("ran out of attempts to locate the active posts popover module"));
                }
            } catch (error) { _recordPatchCatch("AutocompleteSurface.patchActivePostsPopoverComponent.L1525", null, error); }
        }
    }
}

function createEventSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({ get eventsEnabled() { return !!plugin.settings?.places?.events; } }),
        stores: Object.freeze({
            get GuildScheduledEventStore() { return plugin.modules.GuildScheduledEventStore; },
            get SelectedGuildStore() { return plugin.modules.SelectedGuildStore; },
            get ChannelStore() { return plugin.modules.ChannelStore; },
            get GuildStore() { return plugin.modules.GuildStore; },
            get ReadStateStore() { return plugin.modules.ReadStateStore; },
        }),
        visibility: Object.freeze({
            shouldHide: userId => plugin.shouldHide(userId),
            extractUserId: value => plugin.extractUserId(value),
        }),
        identity: Object.freeze({
            findUserId: element => plugin.findUserId(element),
            findUsersByName: name => plugin._identity.findUsersByName(name),
        }),
        dom: Object.freeze({
            hideElement: (...args) => plugin.hideElement(...args),
            restoreElement: element => plugin.restoreElement(element),
        }),
        fiber: _surfaceFiberProps(plugin),
        notifications: Object.freeze({ toast: (...args) => plugin.toast(...args) }),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            warn: (...args) => plugin._patcher?._warn(...args),
            after: (...args) => plugin.patchAfter(...args),
        }),
        retry: _surfaceRetry(plugin, ["delay","schedule","guardEnter","guardExit"]),
        health: Object.freeze({ register: (...args) => plugin._health?.register(...args) }),
        coordination: Object.freeze({
            get scanInFlight() { return plugin.scanInFlight; },
            queueScan: (...args) => plugin.queueScan(...args),
        }),
    });
}

class EventSurface {
    constructor(api) {
        this.api = api;
        this._eventStorePatchedMethods = new WeakMap();
        this._eventStorePatchedMethodRefs = new WeakMap();
        this._eventUnreadPatchedMethods = new WeakMap();
        this._eventUnreadPatchedMethodRefs = new WeakMap();
    }
    get guildScheduledEventStorePatched() {
        const store = this.api.stores.GuildScheduledEventStore;
        return _isAfterPatchBatchCurrent(store, ["getGuildScheduledEventsByIndex", "getGuildEventCountByIndex", "getGuildScheduledEventsForGuild", "getGuildScheduledEvent"],
            this._eventStorePatchedMethods.get(store), this._eventStorePatchedMethodRefs.get(store));
    }
    get eventsSidebarUnreadPatched() {
        const store = this.api.stores.ReadStateStore;
        return _isAfterPatchBatchCurrent(store, ["getUnreadCount", "getMentionCount", "hasUnread", "hasUnreadOrMentions", "hasTrackedUnread"],
            this._eventUnreadPatchedMethods.get(store), this._eventUnreadPatchedMethodRefs.get(store));
    }
    patchEarly() {
        this.api.patching.safe('patchGuildScheduledEventStore', () => this.patchGuildScheduledEventStore());
        this.api.patching.safe('patchEventsSidebarUnread', () => this.patchEventsSidebarUnread());
    }
    scan() {
        this.hideBlockedEvents();
        this.hideSidebarEventItems();
    }
    registerHealthChecks() {
        this.api.health.register(
            "events",
            () => {
                if (!this.api.settings.eventsEnabled) return true;
                const cards = document.querySelectorAll('[class*="card__"]:not([data-hidden-blocked="true"])');
                let sample = 0;
                for (let i = 0; i < cards.length && sample < 25; i++) {
                    const card = cards[i];
                    if (!card.querySelector('[class*="creator_"]')) continue;
                    sample++;
                    const userId = this.resolveEventCreatorId(card);
                    if (userId && this.api.visibility.shouldHide(userId)) return false;
                }
                return true;
            },
            () => {
                if (this.api.coordination.scanInFlight) return;
                try { this.api.coordination.queueScan(); } catch (error) { _recordPatchCatch("events.healthRescan", null, error); }
            }
        );
    }
    stop() {
        this._eventStorePatchedMethods = new WeakMap();
        this._eventStorePatchedMethodRefs = new WeakMap();
        this._eventUnreadPatchedMethods = new WeakMap();
        this._eventUnreadPatchedMethodRefs = new WeakMap();
    }
    hideBlockedEvents() {
        const containers = new Set;
        const cards = document.querySelectorAll('[class*="card__"]');
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const creatorEl = card.querySelector('[class*="creator_"]');
            if (!creatorEl) continue;
            const container = card.closest('[class*="content_"]') || card.parentElement;
            if (container) containers.add(container);
            if (card.dataset?.hiddenBlocked === "true") continue;
            const userId = this.resolveEventCreatorId(card);
            if (userId && this.api.visibility.shouldHide(userId)) {
                this.api.dom.hideElement(card, "guild-event", userId);
            }
        }
        for (const container of containers) this._fixEmptyEventsPopoverState(container);
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
        this._fixEventsPopoverHeaderCount(container, visible, hiddenBlocked);
    }
    _fixEventsPopoverHeaderCount(container, visible, hiddenBlocked) {
        const root = container.closest('[class*="root_"]') || container.parentElement;
        if (!root) return;
        const heading = root.querySelector('h1[id], [class*="header_"] h1');
        if (!heading) return;
        if (!heading.hasAttribute(_ATTR.origText)) {
            heading.setAttribute(_ATTR.origText, heading.textContent || "");
        }
        const originalText = heading.getAttribute(_ATTR.origText);
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
        if (!heading.hasAttribute(_ATTR.origAriaLabel)) {
            heading.setAttribute(_ATTR.origAriaLabel, heading.getAttribute("aria-label") || "");
        }
        heading.setAttribute("aria-label", desired);
    }
    restoreAllHeaderOverlays() {
        document.querySelectorAll('[data-nmb-header-hidden="true"]').forEach(h => this._clearEventsHeaderOverlay(h));
        document.querySelectorAll('[data-nmb-header-overlay="true"]').forEach(o => o.remove());
    }
    _clearEventsHeaderOverlay(heading) {
        const overlay = heading.querySelector(':scope > [data-nmb-header-overlay="true"]');
        overlay?.remove();
        heading.removeAttribute("data-nmb-header-hidden");
        heading.style.removeProperty("--nmb-header-restore-size");
        heading.style.removeProperty("--nmb-header-restore-line-height");
        if (heading.hasAttribute(_ATTR.origAriaLabel)) {
            const origLabel = heading.getAttribute(_ATTR.origAriaLabel);
            if (origLabel) heading.setAttribute("aria-label", origLabel); else heading.removeAttribute("aria-label");
            heading.removeAttribute(_ATTR.origAriaLabel);
        }
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
            overlay.style.cssText = `
                position: absolute !important;
                inset: 0 !important;
                pointer-events: none !important;
                z-index: 1 !important;
                overflow: hidden !important;
                white-space: nowrap !important;
                text-overflow: ellipsis !important;
                visibility: visible !important;
                color: ${color} !important;
            `;
            overlay.textContent = desiredText;
            nameEl.appendChild(overlay);
        }
        nameEl.style.setProperty("color", "transparent", "important");
        nameEl.setAttribute("data-nmb-sidebar-hidden", "true");
        if (!nameEl.hasAttribute(_ATTR.origAriaLabel)) {
            nameEl.setAttribute(_ATTR.origAriaLabel, nameEl.getAttribute("aria-label") || "");
        }
        nameEl.setAttribute("aria-label", desiredText);
    }
    clearEventsSidebarOverlay(nameEl) {
        if (!nameEl) return;
        const overlay = nameEl.querySelector(':scope > [data-nmb-sidebar-overlay="true"]');
        overlay?.remove();
        nameEl.removeAttribute("data-nmb-sidebar-hidden");
        nameEl.style.removeProperty("--nmb-sidebar-color");
        nameEl.style.removeProperty("color");
        nameEl.style.removeProperty("position");
        if (nameEl.hasAttribute(_ATTR.origAriaLabel)) {
            const origLabel = nameEl.getAttribute(_ATTR.origAriaLabel);
            if (origLabel) nameEl.setAttribute("aria-label", origLabel); else nameEl.removeAttribute("aria-label");
            nameEl.removeAttribute(_ATTR.origAriaLabel);
        }
    }
    _fixEventsSidebarCounter() {
        const items = document.querySelectorAll('nav [role="listitem"], nav a, nav div[role="button"], nav [class*="link__"], nav [class*="basicChannelRowLink"]');
        const eventRegex = /\d+.*(?:event|evento|événement)|(?:event|evento|événement).*\d+/i;
        const seenNameEls = new Set;
        for (let i = 0; i < items.length; i++) {
            this._processEventsSidebarItem(items[i], eventRegex, seenNameEls);
        }
    }
    fixEventsSidebarCounterFor(focusItem) {
        if (!focusItem) return;
        const eventRegex = /\d+.*(?:event|evento|événement)|(?:event|evento|événement).*\d+/i;
        const item = focusItem.matches?.('[role="listitem"], a, div[role="button"], [class*="link__"], [class*="basicChannelRowLink"]') ? focusItem : focusItem.querySelector?.('[role="listitem"], a, div[role="button"], [class*="link__"], [class*="basicChannelRowLink"]') || focusItem;
        this._processEventsSidebarItem(item, eventRegex, null);
    }
    _prepareEventsSidebarItem(item, eventRegex, seenNameEls) {
        if (!item) return;
        if (item.querySelector('[class*="card__"], [class*="content_"]')) return;
        const nameEl = item.querySelector('[class*="name__"]');
        if (!nameEl) return;
        const _processEventsLi = item.closest('li');
        const currentText = this._getTextExcludingOverlay(nameEl);
        const isEventText = eventRegex.test(currentText);
        const hasOrigText = nameEl.hasAttribute(_ATTR.origText);
        const origText = hasOrigText ? nameEl.getAttribute(_ATTR.origText) : "";
        const hasOverlay = nameEl.querySelector(':scope > [data-nmb-sidebar-overlay="true"]');
        if (isEventText) {
            if (!hasOrigText || (currentText !== origText && origText)) {
                nameEl.setAttribute(_ATTR.origText, currentText);
            }
        } else if (!hasOrigText) {
            if (hasOverlay) this.clearEventsSidebarOverlay(nameEl);
            this._setEventsReadyAndUnhide(nameEl, _processEventsLi);
            return;
        } else if (!eventRegex.test(origText)) {
            if (hasOverlay) this.clearEventsSidebarOverlay(nameEl);
            this._setEventsReadyAndUnhide(nameEl, _processEventsLi);
            return;
        }
        if (seenNameEls) {
            if (seenNameEls.has(nameEl)) return;
            seenNameEls.add(nameEl);
        }
        return { nameEl, listItem: _processEventsLi, storedOrigText: nameEl.getAttribute(_ATTR.origText) };
    }

    _updateEventsSidebarItem(item, nameEl, listItem, storedOrigText) {
        const { total: totalEvents, hidden: hiddenEvents } = this._getGuildEventCounts();
        const display = this._getEventsSidebarDisplay(storedOrigText, totalEvents, hiddenEvents);
        if (display.state === "pending") {
            const pendingGenericLabel = display.genericLabel;
            this._applyEventsSidebarOverlay(nameEl, pendingGenericLabel);
            const firstSeenAt = nameEl.hasAttribute(_ATTR.eventsPendingSince) ? parseInt(nameEl.getAttribute(_ATTR.eventsPendingSince), 10) : Date.now();
            if (!nameEl.hasAttribute(_ATTR.eventsPendingSince)) nameEl.setAttribute(_ATTR.eventsPendingSince, String(firstSeenAt));
            if (Date.now() - firstSeenAt > 5000) this._setEventsReadyAndUnhide(nameEl, listItem);
            return;
        }
        nameEl.removeAttribute(_ATTR.eventsPendingSince);
        const row = item.closest('[class*="wrapper_"]') || item.parentElement;
        const badgeEl = row ? row.querySelector('[class*="numberBadge"]') : null;
        const unreadEl = row ? row.querySelector('[class*="unread__"][class*="unreadImportant__"], [class*="unreadImportant__"]') : null;
        const genericLabel = display.genericLabel;
        if (display.state === "hidden") {
            if (listItem) {
                this.api.dom.hideElement(listItem, "events-tab-all-blocked", false);
            } else {
                this._applyEventsSidebarOverlay(nameEl, genericLabel);
                if (badgeEl) this.api.dom.hideElement(badgeEl, "events-sidebar-badge");
                if (unreadEl) this.api.dom.hideElement(unreadEl, "events-sidebar-unread");
            }
            this._setEventsReadyAndUnhide(nameEl, null);
            return;
        }
        if (listItem?.dataset?.hiddenBlocked === "true") this.api.dom.restoreElement(listItem);
        if (display.state === "unchanged") {
            if (nameEl.querySelector(':scope > [data-nmb-sidebar-overlay="true"]')) this.clearEventsSidebarOverlay(nameEl);
            if (badgeEl && badgeEl.dataset?.hiddenBlocked === "true") this.api.dom.restoreElement(badgeEl);
            if (unreadEl && unreadEl.dataset?.hiddenBlocked === "true") this.api.dom.restoreElement(unreadEl);
            this._setEventsReadyAndUnhide(nameEl, listItem);
            return;
        }
        if (badgeEl && badgeEl.dataset?.hiddenBlocked === "true") this.api.dom.restoreElement(badgeEl);
        if (unreadEl && unreadEl.dataset?.hiddenBlocked === "true") this.api.dom.restoreElement(unreadEl);
        if (display.hasNumericLabel) {
            this._applyEventsSidebarOverlay(nameEl, display.label);
            if (badgeEl && display.badgeChanged && badgeEl.textContent !== display.badgeText) {
                _setTemporaryText(badgeEl, display.badgeText, "events");
            }
        }
        this._setEventsReadyAndUnhide(nameEl, listItem);
    }
    _getEventsSidebarDisplay(storedOrigText, totalEvents, hiddenEvents) {
        const genericLabel = storedOrigText.replace(/\d+/, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim() || storedOrigText;
        if (totalEvents === null) return { state: "pending", genericLabel };
        if (totalEvents - hiddenEvents <= 0) return { state: "hidden", genericLabel };
        if (hiddenEvents === 0) return { state: "unchanged", genericLabel };
        const match = storedOrigText.match(/\d+/);
        const originalNumber = match ? parseInt(match[0], 10) : null;
        const realNumber = originalNumber === null ? null : Math.max(0, originalNumber - hiddenEvents);
        return { state: "filtered", genericLabel, hasNumericLabel: !!match,
            label: realNumber > 0 ? storedOrigText.replace(/\d+/, realNumber) : genericLabel,
            badgeChanged: realNumber !== originalNumber, badgeText: realNumber > 0 ? String(realNumber) : "" };
    }

    _processEventsSidebarItem(item, eventRegex, seenNameEls) {
        const state = this._prepareEventsSidebarItem(item, eventRegex, seenNameEls);
        if (!state) return;
        this._updateEventsSidebarItem(item, state.nameEl, state.listItem, state.storedOrigText);
    }

    _setEventsReadyAndUnhide(nameEl, li) {
        if (li && li.dataset?.nmbSidebarPreHidden === "true") {
            delete li.dataset.nmbSidebarPreHidden;
            li.style.visibility = '';
        }
    }
    _getGuildEventCounts() {
        const fromStore = this.getGuildEventsFromStore();
        if (fromStore) return fromStore;
        const cards = document.querySelectorAll('[class*="card__"]');
        let total = 0;
        let hidden = 0;
        for (let i = 0; i < cards.length; i++) {
            if (!cards[i].querySelector('[class*="creator_"]')) continue;
            total++;
            if (cards[i].dataset?.hiddenBlocked === "true") hidden++;
        }
        return { total: total > 0 ? total : null, hidden };
    }
    getGuildEventsFromStore() {
        const store = this.api.stores.GuildScheduledEventStore;
        const guildId = this.api.stores.SelectedGuildStore?.getGuildId?.();
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
                if (creatorId && this.api.visibility.shouldHide(String(creatorId))) hidden++;
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

        const structural = this.findEventCreatorId(scope);
        if (structural) return structural;


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
        return null;
    }
    resolveUserIdByName(name) {
        if (!name) return null;
        if (/^\d{17,20}$/.test(name)) return name;
        const matches = this.api.identity.findUsersByName(name);
        return matches.length === 1 ? matches[0].id : null;
    }
    _eventCreatorId(event) {
        return event?.creatorId || event?.creator_id || event?.creator?.id;
    }
    findEventCreatorId(el) {
        if (!el) return null;
        let found = null;
        try {
            const listId = el.dataset?.listItemId || "";
            const eventId = listId.match(/(\d{17,20})$/)?.[1];
            if (eventId && this.api.stores.GuildScheduledEventStore) {
                const guildId = this.api.stores.SelectedGuildStore?.getGuildId?.();
                const ev = guildId
                    ? (this.api.stores.GuildScheduledEventStore.getEvent?.(guildId, eventId)
                        || this.api.stores.GuildScheduledEventStore.getGuildScheduledEvent?.(eventId))
                    : this.api.stores.GuildScheduledEventStore.getGuildScheduledEvent?.(eventId);
                const creatorId = this._eventCreatorId(ev);
                if (creatorId && /^\d{17,20}$/.test(String(creatorId))) found = String(creatorId);
            }
        } catch (error) { _recordPatchCatch("events.resolveCreatorFromStore", null, error); }
        if (!found) {
            this.api.fiber.walkProps(el, props => {
                if (found) return;
                const direct = this.api.visibility.extractUserId(props);
                if (direct) { found = direct; return; }
                const event = props?.guildScheduledEvent || props?.event || props?.scheduledEvent;
                if (event) {
                    const nested = this._eventCreatorId(event);
                    if (nested && /^\d{17,20}$/.test(String(nested))) found = String(nested);
                }
            }, 14);
        }
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
            if (userId && this.api.visibility.shouldHide(userId)) {
                const closeBtn = _findCloseButton(dialog);
                if (closeBtn) {
                    closeBtn.click();
                    this.api.notifications.toast("This event was created by a blocked user.", "info");
                }
            }
        }
    }
    hideSidebarEventItems() {
        const items = document.querySelectorAll('[data-list-item-id^="channels___guild_scheduled_event-"]');
        if (!items.length) return;
        const store = this.api.stores.GuildScheduledEventStore;
        const guildId = this.api.stores.SelectedGuildStore?.getGuildId?.();
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
                    if (creatorId && this.api.visibility.shouldHide(String(creatorId))) {
                        this.api.dom.hideElement(item, "sidebar-event-item", String(creatorId));
                    }
                } catch (error) { _recordPatchCatch("events.hideSidebarItemFromStore", null, error); }
            } else {
                const creator = this.resolveEventCreatorId(item) || this.api.identity.findUserId(item);
                if (creator && this.api.visibility.shouldHide(creator)) {
                    this.api.dom.hideElement(item, "sidebar-event-item", creator);
                }
            }
        }
    }
    patchGuildScheduledEventStore(attempt = 0) {
        if (this.guildScheduledEventStorePatched) return;
        if (!this.api.settings.eventsEnabled) return;
        if (!this.api.retry.guardEnter("patchGuildScheduledEventStore", attempt)) return;
        const store = this.api.stores.GuildScheduledEventStore;
        if (!store) {
            if (attempt < 15) { this.api.retry.schedule(() => this.patchGuildScheduledEventStore(attempt + 1), this.api.retry.delay(attempt, 2000)); return; }
            this.api.patching.warn("patchGuildScheduledEventStore", new Error("GuildScheduledEventStore unavailable after several attempts"));
            this.api.retry.guardExit("patchGuildScheduledEventStore");
            return;
        }
        const installed = this._installScheduledEventFilters(store);
        if (installed) {
            this.api.retry.guardExit("patchGuildScheduledEventStore");
            return;
        }
        this._retryScheduledEventStore(attempt);
    }
    _createScheduledEventFilters(store) {
        return [
            { method: "getGuildScheduledEventsByIndex", callback: (_, __, result) => this._filterScheduledEventCollection(result) },
            { method: "getGuildEventCountByIndex", callback: (_, args, result) => this._filterScheduledEventCount(store, args, result) },
            { method: "getGuildScheduledEventsForGuild", callback: (_, __, result) => this._filterScheduledEventCollection(result) },
            { method: "getGuildScheduledEvent", callback: (_, __, result) => this._filterSingleScheduledEvent(result) },
        ];
    }
    _isScheduledEventVisible(event) {
        if (!event) return false;
        const creatorId = this._eventCreatorId(event);
        return !creatorId || !this.api.visibility.shouldHide(String(creatorId));
    }
    _filterScheduledEventCollection(result) {
        if (!this.api.settings.eventsEnabled) return result;
        try {
            if (Array.isArray(result)) {
                return _filterArrayPreservingIdentity(result, event => this._isScheduledEventVisible(event));
            }
            if (!result || typeof result !== "object") return result;
            let changed = false;
            const filtered = {};
            for (const key of Object.keys(result)) {
                if (this._isScheduledEventVisible(result[key])) filtered[key] = result[key];
                else changed = true;
            }
            return changed ? filtered : result;
        } catch (_) { return result; }
    }
    _filterSingleScheduledEvent(result) {
        if (!this.api.settings.eventsEnabled) return result;
        try { return this._isScheduledEventVisible(result) ? result : null; }
        catch (_) { return result; }
    }
    _filterScheduledEventCount(store, args, result) {
        if (!this.api.settings.eventsEnabled || typeof result !== "number") return result;
        try {
            if (typeof store.getGuildScheduledEventsByIndex === "function") {
                const filtered = store.getGuildScheduledEventsByIndex(...args);
                if (Array.isArray(filtered)) return filtered.length;
            }
        } catch (_) {}
        return result;
    }
    _installScheduledEventFilters(store) {
        const { methods, refs } = _getStorePatchState(this, store, "_eventStorePatchedMethods", "_eventStorePatchedMethodRefs");
        return _installAfterPatchBatch(store, this._createScheduledEventFilters(store), methods, refs, (...args) => this.api.patching.after(...args));
    }
    _retryScheduledEventStore(attempt) {
        if (attempt < 15) {
            this.api.retry.schedule(() => this.patchGuildScheduledEventStore(attempt + 1), this.api.retry.delay(attempt, 2000));
        } else {
            this.api.patching.warn("patchGuildScheduledEventStore", new Error("could not install all applicable patches on GuildScheduledEventStore after several attempts (methods unavailable or patcher rejected a patch)"));
            this.api.retry.guardExit("patchGuildScheduledEventStore");
        }
    }
    patchEventsSidebarUnread(attempt = 0) {
        if (this.eventsSidebarUnreadPatched) return;
        if (!this.api.retry.guardEnter("patchEventsSidebarUnread", attempt)) return;
        const rs = this.api.stores.ReadStateStore;
        const installed = rs && this._installEventUnreadFilters(rs);
        if (installed) {
            this.api.retry.guardExit("patchEventsSidebarUnread");
            return;
        }
        if (attempt < 15) {
            this.api.retry.schedule(() => this.patchEventsSidebarUnread(attempt + 1), this.api.retry.delay(attempt, 2000));
        } else {
            this.api.patching.warn("patchEventsSidebarUnread", new Error(rs
                ? "could not install all applicable patches on ReadStateStore after several attempts (methods unavailable or patcher rejected a patch)"
                : "ReadStateStore unavailable after several attempts"));
            this.api.retry.guardExit("patchEventsSidebarUnread");
        }
    }
    _asKnownGuildEventsId(arg0) {
        const api = this.api;
        if (typeof arg0 !== "string" && typeof arg0 !== "number") return null;
        const id = String(arg0);
        try {
            const isChannel = !!api.stores.ChannelStore?.getChannel?.(id);
            if (isChannel) return null;
            const isGuild = !!api.stores.GuildStore?.getGuild?.(id);
            return isGuild ? id : null;
        } catch (_) {
            return null;
        }
    }
    _hasVisibleGuildEvents(guildId) {
        const api = this.api;
        try {
            const store = api.stores.GuildScheduledEventStore;
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
                const creatorId = this._eventCreatorId(ev);
                return !(creatorId && api.visibility.shouldHide(String(creatorId)));
            });
        } catch (_) {
            return true;
        }
    }
    _filterGuildEventUnreadResult(args, result, emptyValue, numericResult = false) {
        const api = this.api;
        if (!api.settings.eventsEnabled) return result;
        if (numericResult) {
            if (!result || typeof result !== "number" || result <= 0) return result;
        } else if (!result) {
            return result;
        }
        const guildId = this._asKnownGuildEventsId(args?.[0]);
        if (!guildId) return result;
        return this._hasVisibleGuildEvents(guildId) ? result : emptyValue;
    }
    _installEventUnreadFilters(store) {
        const { methods, refs } = _getStorePatchState(this, store, "_eventUnreadPatchedMethods", "_eventUnreadPatchedMethodRefs");
        const unreadMethods = [
            ["getUnreadCount", 0, true],
            ["getMentionCount", 0, true],
            ["hasUnread", false, false],
            ["hasUnreadOrMentions", false, false],
            ["hasTrackedUnread", false, false],
        ];
        const filters = unreadMethods.map(([method, emptyValue, numericResult]) => ({
            method, callback: (_, args, result) => this._filterGuildEventUnreadResult(args, result, emptyValue, numericResult),
        }));
        return _installAfterPatchBatch(store, filters, methods, refs, (...args) => this.api.patching.after(...args));
    }
}

function createGroupDmSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({
            get groupDmsEnabled() { return !!plugin.settings.places?.groupDms; },
            get groupDmsOrMessagesEnabled() { const pl = plugin.settings?.places; return !!(pl?.groupDms || pl?.messages); }, get channelListEnabled() { return plugin._placeEnabled("channelList"); },
        }),
        stores: Object.freeze({
            get ChannelStore() { return plugin.modules.ChannelStore; },
            get PrivateChannelStore() { return plugin.modules.PrivateChannelStore; },
            get UserStore() { return plugin.modules.UserStore; },
        }),
        moduleResolver: Object.freeze({
            get: (...args) => plugin._r?.get(...args),
            getStore: (...args) => plugin._r.getStore(...args),
            setPrivateChannelStore: store => { plugin.modules.PrivateChannelStore = store; },
        }),
        identity: Object.freeze({
            findUserId: element => plugin.findUserId(element),
            findAllUserIds: (...args) => plugin.findAllUserIds(...args),
            findChannelId: (...args) => plugin.findChannelId(...args),
        }),
        fiber: Object.freeze({ findComponent: (...args) => plugin.findComponentViaFiber(...args) }),
        visibility: _surfaceUserVisibility(plugin),
        dom: Object.freeze({ hideElement: (...args) => plugin.hideElement(...args) }),
        messages: Object.freeze({
            getChannelMessagesList: channelId => plugin._getChannelMessagesList(channelId),
            isMessageOfType: (message, typeKey) => plugin._isMessageOfType(message, typeKey),
        }),
        ghosting: Object.freeze({
            add: element => plugin._ghostedElements.add(element),
            delete: element => plugin._ghostedElements.delete(element),
        }),
        readState: Object.freeze({
            hasBlockedOnlyReadActivity: channelId => plugin._surfaces.readState.hasBlockedOnlyReadActivity(channelId),
            channelHasVisibleUnread: channelId => plugin._surfaces.readState.channelHasVisibleUnread(channelId),
        }),
        navigation: Object.freeze({
            registerRetryHook: (...args) => plugin._registerNavigationRetryHook(...args),
            isOnDmListScreen: () => plugin._isOnDmListScreen(),
        }),
        coordination: Object.freeze({
            handleRecipientAdd: message => plugin._handleGroupRecipientAdd(message),
            addStartupTimer: timerId => (plugin._startupTimers = plugin._startupTimers || []).push(timerId),
            removeStartupTimer: timerId => {
                const timers = plugin._startupTimers;
                const index = timers?.indexOf(timerId);
                if (index !== undefined && index !== -1) timers.splice(index, 1);
            },
            get scanInFlight() { return plugin.scanInFlight; },
            queueScan: (...args) => plugin.queueScan(...args),
        }),
        cache: Object.freeze({
            map: (namespace, maxSize) => plugin._cacheManager.map(namespace, maxSize),
            set: (namespace, key, value) => plugin._cacheManager.set(namespace, key, value),
        }),
        resources: Object.freeze({
            timer: (...args) => plugin._resources.timer(...args),
            clearTimer: (...args) => plugin._resources.clearTimer(...args),
            debounce: (...args) => plugin._resources.debounce(...args),
            cancelDebounce: (...args) => plugin._resources.cancelDebounce(...args),
            onDispose: (...args) => plugin._resources.onDispose(...args),
        }),
        lifecycle: Object.freeze({
            get isRunning() { return plugin.isRunning; },
            get instanceEpoch() { return plugin._instanceEpoch; },
        }),
        retry: _surfaceRetry(plugin, ["guardEnter","guardExit","schedule","delay","cancel"]),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            after: (...args) => plugin.patchAfter(...args),
            before: (...args) => plugin.patchBefore(...args),
            warn: (...args) => plugin._patcher?._warn(...args),
            logFailure: (...args) => plugin._patcher._logFail(...args),
        }),
        logger: Object.freeze({
            info: (...args) => plugin.logger?.info(...args),
            error: (...args) => plugin.logger?.error(...args),
        }),
        health: Object.freeze({ register: (...args) => plugin._health?.register(...args) }),
    });
}
class GroupDmSurface {
    constructor(api) {
        this.api = api;
        this._privateChannelStorePatched = false;
        this.groupDMPrototypePatched = false;
        this._groupDMOrigDescriptors = null;
        this._groupDMPrototypeRef = null;
        this._groupDMPrototypeSlowRetryWarned = false;
        this._groupDMPrototypeWatchCleanup = null;
        this._groupDMRecipientsSyms = null;
        this._groupDMMigratedInstances = new Set;
        this._groupDMMigratedOwnDescriptors = new WeakMap;
        this._groupDMGetterResolvingIds = null;
        this._migrateGroupDMInstanceValue = null;
        this._privateChannelRowPatched = false;
        this._rowPatchInFlight = false;
        this._rowPatchRetryTimeout = null;
        this._rowPatchWaitCycles = 0;
        this._groupDmRowRetryHandler = null;
        this._groupDmRowRetrySubscriptions = new Map();
        this._groupDmRowRetryTimer = null;
        this._filteredChannelCache = null;
        this._groupDMUnreadSectionObserver = null;
        this._groupDMUnreadSectionObserverPatched = false;
        this._groupDMUnreadSectionBootObserver = null;
        this._groupDMUnreadSectionBootTimeout = null;
        this._groupDMUnreadSectionBootAttempts = 0;
        this._groupDMUnreadGhostSignature = null;
    }
    registerHealthChecks() {
        this.api.health.register(
            "groupDms",
            () => {
                if (!(this.api.settings.groupDmsOrMessagesEnabled || this.api.settings.channelListEnabled)) return true;
                const els = document.querySelectorAll(`${_SEL.privateChannelRow}:not([data-hidden-blocked="true"]), [class*="privateChannels"] [class*="channel"]:not([data-hidden-blocked="true"])`);
                let sample = 0;
                for (let i = 0; i < els.length && sample < 40; i++) {
                    const row = els[i];
                    sample++;
                    if (this._isGroupDmRow(row)) {
                        if (this._groupDmRowLeaksBlockedName(row)) return false;
                    } else {
                        const userId = this.api.identity.findUserId(row);
                        if (userId && this.api.visibility.shouldHide(userId)) return false;
                    }
                }
                return true;
            },
            () => {
                try {
                    if (!this.api.coordination.scanInFlight) this.api.coordination.queueScan();
                    this.refreshGroupDmLabels();
                } catch (error) { _recordPatchCatch("groupDms.healthRescan", this, error); }
            },
            1
        );
    }
    enabled() {
        return !!(this.api.settings.groupDmsOrMessagesEnabled || this.api.settings.channelListEnabled);
    }
    scanExistingRecipientAdds() {
        try {
            const privateChannels = this.api.stores.PrivateChannelStore;
            const channelStore = this.api.stores.ChannelStore;
            if (!privateChannels || !channelStore) return;
            const channelIds = new Set;
            try { (privateChannels.getPrivateChannelIds?.() || []).forEach(id => channelIds.add(id)); } catch (error) { _recordPatchCatch("groupDms.scanPrivateChannelIds", this, error); }
            try {
                const mutable = privateChannels.getMutablePrivateChannels?.();
                if (mutable && typeof mutable === "object") Object.keys(mutable).forEach(id => channelIds.add(id));
            } catch (error) { _recordPatchCatch("groupDms.scanMutablePrivateChannels", this, error); }
            for (const channelId of channelIds) {
                try {
                    const channel = channelStore.getChannel?.(channelId);
                    if (!channel?.isGroupDM?.()) continue;
                    const messages = this.api.messages.getChannelMessagesList(channelId);
                    for (const message of messages) {
                        if (this.api.messages.isMessageOfType(message, "RECIPIENT_ADD")) {
                            this.api.coordination.handleRecipientAdd(message);
                        }
                    }
                } catch (error) { _recordPatchCatch("groupDms.scanRecipientAddsForChannel", this, error); }
            }
        } catch (error) { _recordPatchCatch("groupDms.scanExistingRecipientAdds", this, error); }
    }
    patchEarly() {
        this.api.patching.safe('patchPrivateChannelStore', () => this.patchPrivateChannelStore());
        this.api.patching.safe('patchGroupDMChannelPrototype', () => this.patchGroupDMChannelPrototype());
        this.api.patching.safe('patchGroupDMUnreadSectionObserver', () => this.patchGroupDMUnreadSectionObserver());
        this.api.patching.safe('patchPrivateChannelRowComponent', () => this.patchPrivateChannelRowComponent());
        this.api.patching.safe('watchForGroupDmRowRetry', () => this._watchForGroupDmRowRetry());
    }
    scan() {
        this.hidePrivateChannels();
    }
    patchPrivateChannelStore(attempt = 0) {
        if (this._privateChannelStorePatched) return;
        if (!this.api.retry.guardEnter("patchPrivateChannelStore", attempt)) return;
        let pcs = this.api.stores.PrivateChannelStore;
        if (!pcs) {
            try {
                const getStore = (...names) => this.api.moduleResolver.getStore(...names);
                pcs = getStore("PrivateChannelStore", "PrivateChannelsStore")
                    || (["getPrivateChannels", "getPrivateChannelIds", "getMutablePrivateChannels"].some(k => typeof this.api.stores.ChannelStore?.[k] === "function")
                        ? this.api.stores.ChannelStore
                        : null);
                if (pcs) this.api.moduleResolver.setPrivateChannelStore(pcs);
            } catch (error) { _recordPatchCatch("groupDms.resolvePrivateChannelStore", this, error); }
        }
        if (!pcs) {
            if (attempt < 20) { this.api.retry.schedule(() => this.patchPrivateChannelStore(attempt + 1), this.api.retry.delay(attempt, 2000)); return; }
            this.api.patching.warn("patchPrivateChannelStore", new Error("PrivateChannelStore unavailable after several attempts"));
            this.api.retry.guardExit("patchPrivateChannelStore");
            return;
        }
        const installed = this._installPrivateChannelStoreFilters(pcs);
        if (installed) {
            this._privateChannelStorePatched = true;
            this.api.retry.guardExit("patchPrivateChannelStore");
            return;
        }
        if (attempt < 20) {
            this.api.retry.schedule(() => this.patchPrivateChannelStore(attempt + 1), this.api.retry.delay(attempt, 2000));
        } else {
            this.api.patching.warn("patchPrivateChannelStore", new Error("could not install all applicable patches on PrivateChannelStore after several attempts (methods unavailable or patcher rejected a patch)"));
            this.api.retry.guardExit("patchPrivateChannelStore");
        }
    }
    _createPrivateChannelStoreFilters() {
        const surf = this;
        const self = this.api;
        const migrateIfGroupDM = ch => {
            try {
                if (ch?.isGroupDM?.() && surf._migrateGroupDMInstanceValue && surf._groupDMRecipientsSyms) {
                    const { RAW_RECIPIENTS, RAW_RECIPIENT_IDS } = surf._groupDMRecipientsSyms;
                    surf._migrateGroupDMInstanceValue(ch, "recipients", RAW_RECIPIENT_IDS);
                    surf._migrateGroupDMInstanceValue(ch, "rawRecipients", RAW_RECIPIENTS);
                }
            } catch (error) { _recordPatchCatch("groupDms.migrateChannelValue", surf, error); }
        };
        const filterIds = ids => {
            if (!Array.isArray(ids)) return ids;
            for (const id of ids) {
                try { migrateIfGroupDM(self.stores.ChannelStore?.getChannel?.(id)); } catch (error) { _recordPatchCatch("groupDms.migrateFilteredChannelIds", surf, error); }
            }
            return ids;
        };
        const filterMutable = obj => {
            for (const ch of (Array.isArray(obj) ? obj : Object.values(obj || {}))) {
                migrateIfGroupDM(ch);
            }
            return obj;
        };
        const createFilter = (method, apply) => ({ method, callback: (_, __, result) => {
            try { return apply(result); } catch (_) { return result; }
        } });
        return [
            createFilter("getPrivateChannelIds", filterIds),
            ...["getMutablePrivateChannels", "getPrivateChannels"].map(method => createFilter(method, filterMutable)),
        ];
    }
    _installPrivateChannelStoreFilters(store) {
        const { methods } = _getStorePatchState(this, store, "_privateStorePatchedMethods");
        return _installAfterPatchBatch(store, this._createPrivateChannelStoreFilters(), methods, null, (...args) => this.api.patching.after(...args));
    }
    _defineFilteredGroupDMGetter(proto, key, storageSym, mapToId, channelStore, pluginApi) {
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        if (desc && desc.get && desc.get.__nmbPatched) return true;
        if (!(key in this._groupDMOrigDescriptors)) {
            this._groupDMOrigDescriptors[key] = desc || null;
        }
        if (!this._groupDMGetterResolvingIds) this._groupDMGetterResolvingIds = new Set();
        const resolvingIds = this._groupDMGetterResolvingIds;
        Object.defineProperty(proto, key, {
            configurable: true,
            enumerable: true,
            get: function() {
                const live = (typeof window !== "undefined" && window.__byeBlocked) || pluginApi;
                if (!live?.isRunning) {
                    const raw = this[storageSym];
                    return Array.isArray(raw) ? raw : [];
                }
                let raw = this[storageSym];
                if (raw === undefined) {
                    const cid = this?.id;
                    if (cid !== undefined && resolvingIds.has(cid)) {
                        const placeholder = [];
                        placeholder.__nmbIncomplete = true;
                        return placeholder;
                    }
                    if (cid !== undefined) resolvingIds.add(cid);
                    let incomplete = false;
                    try {
                        const storeChannel = channelStore?.getChannel?.(cid);
                        if (storeChannel && storeChannel !== this) {
                            const fromStore = storeChannel[storageSym];
                            if (Array.isArray(fromStore)) raw = fromStore;
                            if (storeChannel[storageSym] === undefined) incomplete = true;
                        }
                    } catch (error) { _recordPatchCatch("groupDms.readRawRecipientsFromStore", live, error); }
                    finally { if (cid !== undefined) resolvingIds.delete(cid); }
                    if (raw === undefined || incomplete) {
                        const placeholder = [];
                        placeholder.__nmbIncomplete = true;
                        return placeholder;
                    }
                    try { this[storageSym] = raw; } catch (error) { _recordPatchCatch("GroupDmSurface._defineFilteredGroupDMGetter.fallback1", this, error); }
                }
                if (!Array.isArray(raw)) return raw;
                if (!live?.settings?.places?.groupDms) return raw;
                try {
                    if (!this.isGroupDM?.()) return raw;
                    return raw.filter(item => !live.shouldHide?.(mapToId(item)));
                } catch (error) { _recordPatchCatch("groupDms.filterRecipientGetter", live, error); return raw; }
            },
            set: function(value) { this[storageSym] = value; }
        });
        const newDesc = Object.getOwnPropertyDescriptor(proto, key);
        newDesc.get.__nmbPatched = true;
        return true;
    }

    _migrateGroupDMValue(instance, key, storageSym) {
        if (!instance || typeof instance !== "object") return false;
        this._groupDMMigratedInstances.add(instance);
        if (Object.prototype.hasOwnProperty.call(instance, key)) {
            const own = Object.getOwnPropertyDescriptor(instance, key);
            if (own && "value" in own) {
                instance[storageSym] = own.value;
                delete instance[key];
                const migrated = this._groupDMMigratedOwnDescriptors.get(instance) || {};
                migrated[key] = { descriptor: own, storageSym };
                this._groupDMMigratedOwnDescriptors.set(instance, migrated);
                return true;
            }
        }
        return false;
    }

    _resolveGroupDMChannelPrototype(channelStore, attempt) {
        let proto = null;
        try {
            const ChannelClass = this.api.moduleResolver.get(m => typeof m === "function" && m.prototype && typeof m.prototype.isGroupDM === "function" && typeof m.prototype.isDM === "function");
            if (ChannelClass?.prototype) {
                proto = ChannelClass.prototype;
            }
        } catch (error) { _recordPatchCatch("GroupDmSurface._resolveGroupDMChannelPrototype.fallback1", this, error); }
        if (!proto) {
            let sampleChannel = null;
            for (const [method, label] of [
                ["getPrivateChannels", "GroupDmSurface._resolveGroupDMChannelPrototype.fallback2"],
                ["getMutablePrivateChannels", "GroupDmSurface._resolveGroupDMChannelPrototype.fallback3"],
            ]) {
                if (sampleChannel) break;
                if (!channelStore?.[method]) continue;
                try {
                    const all = channelStore[method]();
                    const list = Array.isArray(all) ? all : Object.values(all || {});
                    sampleChannel = list.find(ch => ch?.isGroupDM?.());
                } catch (error) { _recordPatchCatch(label, this, error); }
            }
            if (!sampleChannel) {
                this._scheduleGroupDMPrototypeRetryOnDataReady(attempt);
                return undefined;
            }
            proto = Object.getPrototypeOf(sampleChannel);
        }
        return proto;
    }

    patchGroupDMChannelPrototype(attempt = 0) {
        if (!this.api.settings.groupDmsEnabled || this.groupDMPrototypePatched) return;
        if (!this.api.retry.guardEnter("patchGroupDMChannelPrototype", attempt)) return;
        const self = this.api;
        try {
            const cs = this.api.stores.ChannelStore;
            const proto = this._resolveGroupDMChannelPrototype(cs, attempt);
            if (proto === undefined) return;
            if (!proto || proto === Object.prototype) {
                if (attempt < 20) { this.api.retry.schedule(() => this.patchGroupDMChannelPrototype(attempt + 1), this.api.retry.delay(attempt, 2500)); return; }
                this.api.patching.logFailure("patchGroupDMChannelPrototype", new Error("invalid Channel prototype - see maintenance notes"));
                this.api.retry.guardExit("patchGroupDMChannelPrototype");
                return;
            }
            const RAW_RECIPIENTS = Symbol.for("ByeBlocked.nmbRawRecipients");
            const RAW_RECIPIENT_IDS = Symbol.for("ByeBlocked.nmbRawRecipientIds");
            if (!this._groupDMOrigDescriptors) this._groupDMOrigDescriptors = {};
            const migrateInstanceValue = (instance, key, storageSym) => this._migrateGroupDMValue(instance, key, storageSym);
            this._migrateGroupDMInstanceValue = migrateInstanceValue;
            if (cs?.getChannel) {
                this.api.patching.after(cs, "getChannel", (_, __, channel) => {
                    if (!channel || typeof channel !== "object") return channel;
                    try {
                        if (channel.isGroupDM?.()) {
                            migrateInstanceValue(channel, "recipients", RAW_RECIPIENT_IDS);
                            migrateInstanceValue(channel, "rawRecipients", RAW_RECIPIENTS);
                        }
                    } catch (error) { _recordPatchCatch("groupDms.migrateAfterChannelLookup", this, error); }
                    return channel;
                });
            }
            this._defineFilteredGroupDMGetter(proto, "recipients", RAW_RECIPIENT_IDS, r => r?.id || r, cs, self);
            this._defineFilteredGroupDMGetter(proto, "rawRecipients", RAW_RECIPIENTS, u => u?.id || u, cs, self);
            try {
                const allChannels = [];
                if (cs?.getPrivateChannels) {
                    const all = cs.getPrivateChannels();
                    allChannels.push(...(Array.isArray(all) ? all : Object.values(all || {})));
                }
                for (const ch of allChannels) {
                    if (!ch?.isGroupDM?.()) continue;
                    migrateInstanceValue(ch, "recipients", RAW_RECIPIENT_IDS);
                    migrateInstanceValue(ch, "rawRecipients", RAW_RECIPIENTS);
                }
            } catch (error) { _recordPatchCatch("groupDms.migrateExistingChannels", this, error); }
            this._groupDMRecipientsSyms = { RAW_RECIPIENTS, RAW_RECIPIENT_IDS };
            this._groupDMPrototypeRef = proto;
            this.groupDMPrototypePatched = true;
            this.api.retry.guardExit("patchGroupDMChannelPrototype");
            this.api.resources.timer('groupDms', () => {
                try { this.api.stores.PrivateChannelStore?.emitChange?.(); }
                catch (error) { _recordPatchCatch("groupDms.prototypePatch.emitPrivateChannels", this, error); }
                try { this.api.stores.ChannelStore?.emitChange?.(); }
                catch (error) { _recordPatchCatch("groupDms.prototypePatch.emitChannels", this, error); }
            }, 0);
        } catch (e) {
            if (attempt < 20) { this.api.retry.schedule(() => this.patchGroupDMChannelPrototype(attempt + 1), this.api.retry.delay(attempt, 2500)); return; }
            this.api.patching.logFailure("patchGroupDMChannelPrototype", e);
            this.api.retry.guardExit("patchGroupDMChannelPrototype");
        }
    }
    _scheduleGroupDMPrototypeRetryOnDataReady(attempt) {
        this._teardownGroupDMPrototypeWatch();
        const FAST_RETRY_ATTEMPTS = 20;
        const isSlowPhase = attempt >= FAST_RETRY_ATTEMPTS;
        if (isSlowPhase && !this._groupDMPrototypeSlowRetryWarned) {
            this._groupDMPrototypeSlowRetryWarned = true;
            this.api.logger.info(`patchGroupDMChannelPrototype: no Group DM found after ${FAST_RETRY_ATTEMPTS} attempts - this is expected if you have none; will keep watching for one in the background instead of giving up.`);
        }
        let done = false;
        const stores = [this.api.stores.PrivateChannelStore, this.api.stores.ChannelStore].filter(s => s?.addChangeListener && s?.removeChangeListener);
        const cleanup = () => {
            if (done) return;
            done = true;
            this.api.resources.clearTimer('groupDmPrototypeWatch', timer);
            this.api.resources.clearTimer('groupDmPrototypeWatch', debounceTimer);
            for (const s of stores) { try { s.removeChangeListener(onChange); } catch (error) { _recordPatchCatch("GroupDmSurface._scheduleGroupDMPrototypeRetryOnDataReady.L2631", null, error); } }
            if (this._groupDMPrototypeWatchCleanup === cleanup) this._groupDMPrototypeWatchCleanup = null;
        };
        this._groupDMPrototypeWatchCleanup = cleanup;
        let debounceTimer = null;
        const onChange = () => {
            if (done || !this.api.lifecycle.isRunning || this.groupDMPrototypePatched) return;
            this.api.resources.clearTimer('groupDmPrototypeWatch', debounceTimer);
            debounceTimer = this.api.resources.timer('groupDmPrototypeWatch', () => {
                if (done || !this.api.lifecycle.isRunning || this.groupDMPrototypePatched) return;
                cleanup();
                this.patchGroupDMChannelPrototype(attempt + 1);
            }, 300);
        };
        for (const s of stores) { try { s.addChangeListener(onChange); } catch (error) { _recordPatchCatch("groupDms.watchPrototypeRetryStore", this, error); } }
        const backstopDelay = isSlowPhase ? 15000 : 2500;
        const timer = this.api.resources.timer('groupDmPrototypeWatch', () => {
            if (done || !this.api.lifecycle.isRunning || this.groupDMPrototypePatched) return;
            cleanup();
            this.patchGroupDMChannelPrototype(isSlowPhase ? attempt : attempt + 1);
        }, backstopDelay);
    }
    _restoreGroupDMInstanceProperties() {
        const recipientFields = [
            ["recipients", this._groupDMRecipientsSyms?.RAW_RECIPIENT_IDS],
            ["rawRecipients", this._groupDMRecipientsSyms?.RAW_RECIPIENTS],
        ];
        for (const instance of this._groupDMMigratedInstances || []) {
            const migrated = this._groupDMMigratedOwnDescriptors?.get(instance) || {};
            for (const [key, storageSym] of recipientFields) {
                if (!storageSym) continue;
                const ownEntry = migrated[key];
                const hasStoredValue = Object.prototype.hasOwnProperty.call(instance, storageSym);
                if (!ownEntry && !hasStoredValue) continue;
                const value = hasStoredValue ? instance[storageSym] : ownEntry.descriptor.value;
                try {
                    if (ownEntry) {
                        Object.defineProperty(instance, key, { ...ownEntry.descriptor, value });
                    } else if (!Reflect.set(instance, key, value)) {
                        Object.defineProperty(instance, key, {
                            configurable: true,
                            enumerable: true,
                            writable: true,
                            value,
                        });
                    }
                    if (hasStoredValue) delete instance[storageSym];
                } catch (error) {
                    try { this.api.logger.error(`stop:restoreGroupDMInstance:${key} threw`, error); } catch (error) { _recordPatchCatch("GroupDmSurface._restoreGroupDMInstanceProperties.fallback1", this, error); }
                }
            }
        }
        this._groupDMMigratedInstances?.clear();
        this._groupDMMigratedOwnDescriptors = new WeakMap;
    }
    _teardownGroupDMPrototypeWatch() {
        if (this._groupDMPrototypeWatchCleanup) {
            try { this._groupDMPrototypeWatchCleanup(); } catch (error) { _recordPatchCatch("GroupDmSurface._teardownGroupDMPrototypeWatch.L2688", null, error); }
            this._groupDMPrototypeWatchCleanup = null;
        }
    }
    getGroupDMRawRecipientIds(channel) {
        if (!channel) return [];
        const syms = this._groupDMRecipientsSyms;
        const sym = syms?.RAW_RECIPIENT_IDS;
        if (!sym) return channel.recipients || [];
        if (Object.prototype.hasOwnProperty.call(channel, sym)) return channel[sym] || [];
        if (this._migrateGroupDMInstanceValue) {
            try {
                this._migrateGroupDMInstanceValue(channel, "recipients", sym);
                if (Object.prototype.hasOwnProperty.call(channel, sym)) return channel[sym] || [];
            } catch (error) { _recordPatchCatch("GroupDmSurface.getGroupDMRawRecipientIds.fallback1", this, error); }
        }
        try {
            const cs = this.api.stores.ChannelStore;
            const fresh = channel.id && cs?.getChannel ? cs.getChannel(channel.id) : null;
            if (fresh && Object.prototype.hasOwnProperty.call(fresh, sym)) return fresh[sym] || [];
        } catch (error) { _recordPatchCatch("GroupDmSurface.getGroupDMRawRecipientIds.fallback2", this, error); }
        try {
            const viaGetter = channel.recipients;
            if (Array.isArray(viaGetter) && !viaGetter.__nmbIncomplete) return viaGetter;
        } catch (error) { _recordPatchCatch("GroupDmSurface.getGroupDMRawRecipientIds.fallback3", this, error); }
        return null;
    }
    _ensurePrivateChannelRowRetryListener() {
        const surf = this;
        const self = this.api;
        this.api.navigation.registerRetryHook("privateChannelRow", () => {
            if (!self.lifecycle.isRunning) return;
            if (!surf._privateChannelRowPatched && !surf._rowPatchInFlight) {
                surf._rowPatchWaitCycles = 0;
                surf.patchPrivateChannelRowComponent(0);
            }
        });
    }
    _hasAnyGroupDMInData() {
        try {
            const cs = this.api.stores.ChannelStore;
            if (!cs) return false;
            const collect = fn => {
                if (typeof fn !== "function") return [];
                const all = fn.call(cs);
                return Array.isArray(all) ? all : Object.values(all || {});
            };
            const lists = [collect(cs.getPrivateChannels), collect(cs.getMutablePrivateChannels)];
            for (const list of lists) {
                if (list.some(ch => ch?.isGroupDM?.())) return true;
            }
        } catch (error) { _recordPatchCatch("groupDms.findAnyGroupDM", this, error); }
        return false;
    }
    _buildFilteredGroupDMChannel(channel) {
        try {
            if (!this.api.settings.groupDmsEnabled) return channel;
            if (!channel || !channel.isGroupDM?.()) return channel;
            const recipients = channel.recipients;
            const rawRecipients = channel.rawRecipients;
            if (!Array.isArray(recipients) && !Array.isArray(rawRecipients)) return channel;
            const filteredRecipients = Array.isArray(recipients) ? recipients.filter(id => !id || !this.api.visibility.shouldHide(id?.id || id)) : recipients;
            const filteredRaw = Array.isArray(rawRecipients) ? rawRecipients.filter(user => !user || !this.api.visibility.shouldHide(user?.id || user)) : rawRecipients;
            if (filteredRecipients?.length === recipients?.length && filteredRaw?.length === rawRecipients?.length) return channel;
            const idOf = value => (value && (value.id ?? value)) + '';
            const signature = channel.id + '|' + (Array.isArray(filteredRecipients) ? filteredRecipients.map(idOf).join(',') : '') + '|' + (Array.isArray(filteredRaw) ? filteredRaw.map(idOf).join(',') : '');
            const cached = this._filteredChannelCache.get(channel.id);
            if (cached && cached.sig === signature) return cached.clone;
            const clone = Object.create(Object.getPrototypeOf(channel));
            Object.assign(clone, channel, { recipients: filteredRecipients, rawRecipients: filteredRaw });
            this.api.cache.set("groupDm.filteredChannel", channel.id, { sig: signature, clone });
            return clone;
        } catch (error) {
            _recordPatchCatch("groupDms.buildFilteredChannel", this, error);
            return channel;
        }
    }

    _applyFilteredGroupDMChannelToProps(props) {
        if (!props || typeof props !== "object" || !props.channel) return;
        try {
            const filtered = this._buildFilteredGroupDMChannel(props.channel);
            if (filtered !== props.channel) props.channel = filtered;
        } catch (error) { _recordPatchCatch("groupDms.applyFilteredChannelToProps", this, error); }
    }

    _findGroupDMRowModuleHolding(targetFn) {
        try {
            const mod = this.api.moduleResolver.get(m => m && typeof m === "object" && Object.values(m).includes(targetFn), { searchExports: true }, "findModuleHolding");
            if (!mod) return null;
            const key = Object.keys(mod).find(name => mod[name] === targetFn);
            return key ? [mod, key] : null;
        } catch (_) {
            return null;
        }
    }

    _resolveGroupDmRowPatchTarget(component) {
        if (typeof component?.prototype?.render === "function") {
            return { target: component.prototype, method: "render", instanceProps: true,
                description: "class component", detail: component.displayName || component.name };
        }
        const direct = this._findGroupDMRowModuleHolding(component);
        if (direct) return { target: direct[0], method: direct[1], instanceProps: false,
            description: "functional component, module located by identity", detail: direct[1] };
        const inner = component.type || component.render;
        if (typeof inner !== "function") return null;
        const wrapped = this._findGroupDMRowModuleHolding(inner);
        return wrapped ? { target: wrapped[0], method: wrapped[1], instanceProps: false,
            description: "memo/forwardRef, module located by identity", detail: wrapped[1] } : null;
    }
    _tryPatchGroupDMRowComponentFromEl(element) {
        const component = this.api.fiber.findComponent(element, (_, props) => {
            const channel = props?.channel;
            return !!channel && typeof channel === "object" && typeof channel.isGroupDM === "function";
        }, 40, "patchPrivateChannelRowComponent:fiberWalk");
        if (!component) return false;
        const resolved = this._resolveGroupDmRowPatchTarget(component);
        if (!resolved) return false;
        const unpatch = this.api.patching.before(resolved.target, resolved.method, (context, args) => {
            const props = resolved.instanceProps ? context?.props : args?.[0];
            this._applyFilteredGroupDMChannelToProps(props);
        });
        if (typeof unpatch !== "function") return false;
        this._privateChannelRowPatched = true;
        this.api.logger.info("patchPrivateChannelRowComponent: found via Fiber (" + resolved.description + ")", resolved.detail);
        return true;
    }

    patchPrivateChannelRowComponent(attempt = 0) {
        if (!this.api.settings.groupDmsEnabled) return;
        if (this._privateChannelRowPatched) return;
        this._ensurePrivateChannelRowRetryListener();
        if (attempt === 0) {
            if (this._rowPatchInFlight) return;
            this._rowPatchInFlight = true;
        }
        if (this.groupDMPrototypePatched) {
            this._rowPatchInFlight = false;
            this.api.logger.info("patchPrivateChannelRowComponent: recipients/rawRecipients already filtered at the prototype level, skipping the row component patch (it's redundant here)");
            return;
        }
        if (attempt === 0 && !this._hasAnyGroupDMInData()) {
            this._rowPatchInFlight = false;
            this._rowPatchWaitCycles = 0;
            this.api.logger.info("patchPrivateChannelRowComponent: no Group DM in data yet, deferring to passive watch instead of DOM polling");
            this._watchForGroupDmRowRetry();
            return;
        }
        const PROTOTYPE_GRACE_ATTEMPTS = 5;
        if (attempt < PROTOTYPE_GRACE_ATTEMPTS && !this.groupDMPrototypePatched) {
            this.api.retry.schedule(() => this.patchPrivateChannelRowComponent(attempt + 1), 300);
            return;
        }
        this._filteredChannelCache = this.api.cache.map("groupDm.filteredChannel", 200);
        let hadCandidateRows = false;
        try {
            const rows = document.querySelectorAll(_SEL.privateChannelRow);
            hadCandidateRows = rows.length > 0;
            for (const row of rows) {
                if (this._tryPatchGroupDMRowComponentFromEl(row)) {
                    this._rowPatchInFlight = false;
                    return;
                }
            }
        } catch (err) {
            this.api.patching.logFailure("patchPrivateChannelRowComponent:domScan", err);
        }
        if (!hadCandidateRows) {
            if (!this.api.navigation.isOnDmListScreen()) {
                this.api.retry.cancel(this._rowPatchRetryTimeout);
                this._rowPatchInFlight = false;
                return;
            }
            if (this._rowPatchWaitCycles === undefined) this._rowPatchWaitCycles = 0;
            this._rowPatchWaitCycles++;
            if (this._rowPatchWaitCycles < 750) {
                this.api.retry.cancel(this._rowPatchRetryTimeout);
                this._rowPatchRetryTimeout = this.api.retry.schedule(() => this.patchPrivateChannelRowComponent(attempt), 400);
                return;
            }
            this._rowPatchInFlight = false;
            this.api.patching.logFailure("patchPrivateChannelRowComponent", new Error("gave up waiting for a Group DM row to appear in the sidebar after ~5 minutes"));
            return;
        }
        this._rowPatchWaitCycles = 0;
        if (attempt < 20) {
            this.api.retry.cancel(this._rowPatchRetryTimeout);
            this._rowPatchRetryTimeout = this.api.retry.schedule(() => this.patchPrivateChannelRowComponent(attempt + 1), this.api.retry.delay(attempt, 1500));
        } else {
            this._rowPatchInFlight = false;
            this.api.patching.logFailure("patchPrivateChannelRowComponent", new Error("no group DM row found in the DOM after several attempts - see maintenance notes"));
        }
    }
    _createGroupDmRowRetryHandler() {
        return () => {
            if (!this.api.lifecycle.isRunning || this._privateChannelRowPatched || this._rowPatchInFlight) return;
            if (!this.api.settings.groupDmsEnabled || !this._hasAnyGroupDMInData()) return;
            this.api.resources.clearTimer("groupDmRowRetry", this._groupDmRowRetryTimer);
            this._groupDmRowRetryTimer = this.api.resources.timer("groupDmRowRetry", () => {
                this._groupDmRowRetryTimer = null;
                if (this.api.lifecycle.isRunning && !this._privateChannelRowPatched && !this._rowPatchInFlight) {
                    this.patchPrivateChannelRowComponent();
                }
            }, 500);
        };
    }
    _watchForGroupDmRowRetry() {
        const candidates = [...new Set([this.api.stores.PrivateChannelStore, this.api.stores.ChannelStore])]
            .filter(store => typeof store?.addChangeListener === "function" && typeof store.removeChangeListener === "function");
        if (!this._groupDmRowRetryHandler && !candidates.length) return false;
        if (!this._groupDmRowRetryHandler) this._groupDmRowRetryHandler = this._createGroupDmRowRetryHandler();
        const handler = this._groupDmRowRetryHandler;
        const subscribed = new Map();
        for (const [store, active] of this._groupDmRowRetrySubscriptions) {
            if (active && candidates.includes(store)) subscribed.set(store, true);
            else {
                try { store.removeChangeListener(handler); }
                catch (error) {
                    subscribed.set(store, active);
                    _recordPatchCatch("groupDms.unwatchReplacedStore", this, error);
                }
            }
        }
        for (const store of candidates) {
            if (subscribed.has(store)) continue;
            try { store.addChangeListener(handler); subscribed.set(store, true); }
            catch (error) {
                _recordPatchCatch("groupDms.watchRowRetryStore", this, error);
                try { store.removeChangeListener(handler); }
                catch (cleanupError) {
                    subscribed.set(store, false);
                    _recordPatchCatch("groupDms.rollbackRowRetryStore", this, cleanupError);
                }
            }
        }
        this._groupDmRowRetrySubscriptions = subscribed;
        return candidates.some(store => subscribed.get(store) === true);
    }
    _stopGroupDmRowRetryWatcher() {
        this.api.resources.clearTimer("groupDmRowRetry", this._groupDmRowRetryTimer);
        this._groupDmRowRetryTimer = null;
        const remaining = new Map();
        for (const [store, active] of this._groupDmRowRetrySubscriptions) {
            try { store.removeChangeListener(this._groupDmRowRetryHandler); }
            catch (error) { remaining.set(store, active); _recordPatchCatch("groupDms.stopRowRetryStore", this, error); }
        }
        this._groupDmRowRetrySubscriptions = remaining;
        if (!remaining.size) this._groupDmRowRetryHandler = null;
        return remaining.size === 0;
    }
    _getPrivateChannelRowAction(isGroupDm, userId, channelListEnabled, groupDmsEnabled) {
        if (isGroupDm) return groupDmsEnabled ? "relabel" : "keep";
        if (!channelListEnabled || !userId) return "keep";
        return this.api.visibility.shouldHide(userId) ? "hide" : "keep";
    }
    _applyPrivateChannelRowAction(row, action, userId) {
        if (action === "relabel") {
            if (row.dataset.nmbRelabeled !== "true") row.setAttribute(_ATTR.relabelPending, "true");
            this.relabelGroupDmRow(row);
        } else if (action === "hide") {
            this.api.dom.hideElement(row, "dm-blocked", userId);
        }
    }
    hidePrivateChannels() {
        try {
            const channelListEnabled = this.api.settings.channelListEnabled !== false;
            const groupDmsEnabled = !!this.api.settings.groupDmsOrMessagesEnabled;
            if (!channelListEnabled && !groupDmsEnabled) return;
            const rows = document.querySelectorAll(`${_SEL.privateChannelRow}:not([data-hidden-blocked="true"]), [class*="privateChannels"] [class*="channel"]:not([data-hidden-blocked="true"])`);
            for (const row of rows) {
                const isGroupDm = this._isGroupDmRow(row);
                const userId = !isGroupDm && channelListEnabled ? this.api.identity.findUserId(row) : null;
                const action = this._getPrivateChannelRowAction(isGroupDm, userId, channelListEnabled, groupDmsEnabled);
                this._applyPrivateChannelRowAction(row, action, userId);
            }
        } catch (error) { _recordPatchCatch("groupDms.hidePrivateChannels", null, error); }
    }
    _scheduleGroupDmRelabelRetry(row, retryCount) {
        if (row.dataset.nmbRelabelRetryScheduled) return;
        row.dataset.nmbRelabelRetryScheduled = "true";
        const epochAtSchedule = this.api.lifecycle.instanceEpoch;
        const timerId = this.api.resources.timer('groupDmRelabel', () => {
            this.api.coordination.removeStartupTimer(timerId);
            delete row.dataset.nmbRelabelRetryScheduled;
            if (!this.api.lifecycle.isRunning || this.api.lifecycle.instanceEpoch !== epochAtSchedule) {
                row.removeAttribute?.(_ATTR.relabelPending);
                return;
            }
            row.dataset.nmbRelabelRetryCount = String(retryCount + 1);
            if (row.isConnected) this.relabelGroupDmRow(row);
            else row.removeAttribute?.(_ATTR.relabelPending);
        }, 400);
        this.api.coordination.addStartupTimer(timerId);
    }
    _applyGroupDmRowLabels(row, visibleIds) {
        const nameFor = id => {
            try {
                const user = this.api.stores.UserStore?.getUser?.(id?.id || id);
                return user?.globalName || user?.username || (id?.id || id);
            } catch (_) { return id?.id || id; }
        };
        const newName = visibleIds.length ? visibleIds.map(nameFor).join(", ") : "Grupo";
        const memberCount = visibleIds.length + 1;
        row.querySelectorAll('[class*="name__"] [class*="overflow"], [class*="channelNameMeasurement"]').forEach(el => {
            if (el.textContent === newName) return;
            if (el.dataset.nmbOrigText === undefined) el.dataset.nmbOrigText = el.textContent;
            _setTemporaryText(el, newName, "groupDms");
        });
        row.querySelectorAll('[class*="subtext__"]').forEach(el => {
            const formatted = this._formatMemberCount(memberCount, el.textContent);
            if (el.textContent === formatted) return;
            if (el.dataset.nmbOrigText === undefined) el.dataset.nmbOrigText = el.textContent;
            _setTemporaryText(el, formatted, "groupDms");
        });
        const link = row.querySelector("a[aria-label]");
        if (link) {
            const suffix = link.getAttribute("aria-label")?.match(/\(([^)]*)\),\s*\d+\s*.*/)?.[1];
            const newAriaLabel = `${newName}${suffix ? ` (${suffix})` : ""}, ${this._formatMemberCount(memberCount, "")}`.trim();
            if (link.getAttribute("aria-label") !== newAriaLabel) {
                if (link.dataset.nmbOrigAriaLabel === undefined) link.dataset.nmbOrigAriaLabel = link.getAttribute("aria-label") || "";
                link.setAttribute("aria-label", newAriaLabel);
            }
        }
    }
    relabelGroupDmRow(row) {
        try {
            const channelId = this.api.identity.findChannelId(row);
            const channel = channelId ? this.api.stores.ChannelStore?.getChannel?.(channelId) : null;
            if (!channel?.isGroupDM?.()) {
                row.dataset.nmbRelabeled = "true";
                row.removeAttribute(_ATTR.relabelPending);
                return;
            }
            this._relabelGroupDmAvatarStack(row);
            const rawResult = this.getGroupDMRawRecipientIds(channel);
            if (rawResult === null) {
                const retryCount = Number(row.dataset.nmbRelabelRetryCount || 0);
                if (retryCount >= 10) {
                    row.dataset.nmbRelabeled = "true";
                    row.removeAttribute(_ATTR.relabelPending);
                    return;
                }
                this._scheduleGroupDmRelabelRetry(row, retryCount);
                return;
            }
            const allIds = rawResult;
            if (!allIds.length) {
                row.dataset.nmbRelabeled = "true";
                row.removeAttribute(_ATTR.relabelPending);
                return;
            }
            const visibleIds = allIds.filter(id => !this.api.visibility.shouldHide(id?.id || id));
            this._applyGroupDmRowLabels(row, visibleIds);
            row.dataset.nmbRelabeled = "true";
            row.removeAttribute(_ATTR.relabelPending);
        } catch (error) { _recordPatchCatch("groupDms.relabelRow", null, error); }
    }
    static get GROUP_DM_DEFAULT_AVATAR_SRC() {
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAclBMVEXkQjX////zrKf85+b40Mz1uLPrcWf629nnWU776OblTULnWk7+8/LmTkLlTkL63Nn2xL/uiYHtfXTxoJr629rzraf0rKfuiYDqcWj98/LvlY3vlI3zrKbsfXTyoJrwlY3xoZr75+btiYH0ubPwlI3pZVsifO9tAAABD0lEQVR4Xu3Vx2oFMQyF4XNsTy+3l/T+/q+YKxADJslA7miToG/zgzfC2CD8lnPOOeecc86dQ0OuihriSWqqPVDd42KIUksVJ6sRwFZr5UA13aGXmqmZKQHstDYKZgKAUmtjz0wE0GltMEc9498Z0DBTARi0NgIzBYCz1kbJTCcztUaOnOjvjFI7w4qTagRw0poZjlRhBNBGqa2u2JMvoYTYaieufQ3rpif7JoVNDWunxEzaQKCULvcQ+UXcQDxKF2rf+K1ixEWSLtJWzOWrueulSyT+KOFiJ13gmTNuAQzaK9WRM25GAEl7nRNn3QF4l5q/gFoD+NBep+GsqI8QzZb93PL//wOcc84555xz7hP3uQljb066+AAAAABJRU5ErkJggg==";
    }
    getGroupDMIconURL(channel) {
        if (!channel) return null;
        try {
            if (channel.icon) {
                return `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.png?size=128`;
            }
        } catch (error) { _recordPatchCatch("GroupDmSurface.getGroupDMIconURL.fallback1", this, error); }
        return GroupDmSurface.GROUP_DM_DEFAULT_AVATAR_SRC;
    }
    _relabelGroupDmAvatarStack(row) {
        try {
            const avatarImgs = Array.from(row.querySelectorAll?.(
                'img[src*="/avatars/"], img[src*="/embed/avatars/"], img[src*="/assets/"], img[src*="/channel-icons/"], [class*="avatarStack"] img, [class*="avatar__"] img'
            ) || []);
            if (!avatarImgs.length) return;
            const channelId = this.api.identity.findChannelId(row);
            const channel = channelId ? this.api.stores.ChannelStore?.getChannel?.(channelId) : null;
            const defaultSrc = this.getGroupDMIconURL(channel);
            if (!defaultSrc) return;
            let visibleCount = null;
            try {
                if (channel?.isGroupDM?.()) {
                    const allIds = this.getGroupDMRawRecipientIds(channel);
                    if (Array.isArray(allIds)) {
                        visibleCount = allIds.filter(id => !this.api.visibility.shouldHide(id?.id || id)).length;
                    }
                }
            } catch (error) { _recordPatchCatch("GroupDmSurface._relabelGroupDmAvatarStack.fallback1", this, error); }
            const shouldCollapseToSingle = visibleCount !== null && visibleCount <= 1 && avatarImgs.length > 1;
            if (!shouldCollapseToSingle && row.dataset?.nmbAvatarCollapsed === "true") {
                this._restoreGroupDmAvatarRow(row);
            }
            if (shouldCollapseToSingle) {
                const keep = avatarImgs[0];
                const stack = keep.closest('[class*="avatarStack"], [class*="avatarMulti"]');
                if (keep.dataset.nmbOrigSrc === undefined) keep.dataset.nmbOrigSrc = keep.src;
                if (keep.dataset.nmbOrigStyle === undefined) keep.dataset.nmbOrigStyle = keep.getAttribute("style") || "";
                if ((keep.src || "").split("?")[0] !== defaultSrc.split("?")[0]) keep.src = defaultSrc;
                keep.style.cssText = (keep.dataset.nmbOrigStyle || "") + ";width:32px;height:32px;min-width:32px;min-height:32px;border-radius:50%;object-fit:cover;display:block;";
                for (let i = 1; i < avatarImgs.length; i++) avatarImgs[i].setAttribute("data-nmb-avatar-extra", "true");
                if (stack) {
                    if (stack.dataset.nmbOrigStackStyle === undefined) stack.dataset.nmbOrigStackStyle = stack.getAttribute("style") || "";
                    stack.style.clipPath = "none";
                    stack.style.overflow = "visible";
                }
                row.dataset.nmbAvatarCollapsed = "true";
                return;
            }
            for (const img of avatarImgs) {
                const currentBase = (img.src || "").split("?")[0];
                const targetBase = defaultSrc.split("?")[0];
                if (currentBase === targetBase) continue;
                if (img.dataset.nmbOrigSrc === undefined) img.dataset.nmbOrigSrc = img.src;
                img.src = defaultSrc;
            }
        } catch (error) { _recordPatchCatch("groupDms.relabelAvatarStack", null, error); }
    }
    _restoreGroupDmAvatarRow(row) {
        try {
            row.querySelectorAll("[data-nmb-avatar-extra]").forEach(el => el.removeAttribute("data-nmb-avatar-extra"));
            row.querySelectorAll("[data-nmb-orig-stack-style]").forEach(stack => {
                const prev = stack.dataset.nmbOrigStackStyle;
                if (prev) stack.setAttribute("style", prev); else stack.removeAttribute("style");
                delete stack.dataset.nmbOrigStackStyle;
            });
            row.querySelectorAll("img[data-nmb-orig-src]").forEach(img => {
                if (img.dataset.nmbOrigStyle !== undefined) {
                    if (img.dataset.nmbOrigStyle) img.setAttribute("style", img.dataset.nmbOrigStyle); else img.removeAttribute("style");
                    delete img.dataset.nmbOrigStyle;
                }
                if (img.src !== img.dataset.nmbOrigSrc) img.src = img.dataset.nmbOrigSrc;
                delete img.dataset.nmbOrigSrc;
            });
            delete row.dataset.nmbAvatarCollapsed;
        } catch (error) { _recordPatchCatch("groupDms.restoreAvatarRow", null, error); }
    }
    restoreAllGroupDmAvatars() {
        try {
            const rows = new Set();
            document.querySelectorAll("[data-nmb-avatar-collapsed], img[data-nmb-orig-src], [data-nmb-avatar-extra], [data-nmb-orig-stack-style]").forEach(el => {
                rows.add(el.closest("[data-nmb-avatar-collapsed]") || el.closest("li") || el.parentElement || el);
            });
            rows.forEach(row => this._restoreGroupDmAvatarRow(row));
        } catch (error) { _recordPatchCatch("groupDms.restoreAllAvatars", null, error); }
    }
    _formatMemberCount(count, originalText) {
        try {
            const match = (originalText || "").match(/\d+\s*(.*)$/);
            const label = match ? match[1] : (count === 1 ? "membro" : "membros");
            return `${count} ${label}`;
        } catch (_) {
            return `${count} membros`;
        }
    }
    _collectAvatarHashesFromImg(img) {
        const hashes = [];
        try {
            const src = img?.src || img?.currentSrc || "";
            const match = src.match(/\/avatars\/\d{17,20}\/(a_)?([a-fA-F0-9]+)\.\w+/);
            if (match) hashes.push((match[1] || "") + match[2]);
        } catch (error) { _recordPatchCatch("GroupDmSurface._collectAvatarHashesFromImg.fallback1", this, error); }
        return hashes;
    }
    _groupDmRowHasBlockedIdentity(row) {
        try {
            const ids = this.api.identity.findAllUserIds(row);
            for (const id of ids) {
                if (this.api.visibility.shouldHide(id)) return true;
            }
        } catch (error) { _recordPatchCatch("groupDms.leakCheck.identity", this, error); }
        try {
            const uidEls = row.querySelectorAll?.("[data-user-id]") || [];
            for (const node of uidEls) {
                const id = node.dataset?.userId;
                if (id && this.api.visibility.shouldHide(id)) return true;
            }
        } catch (error) { _recordPatchCatch("groupDms.leakCheck.userIds", this, error); }
        return false;
    }
    _groupDmRowLeaksBlockedVisibleData(row, channel) {
        try {
            const allIds = this.getGroupDMRawRecipientIds(channel) || [];
            const userStore = this.api.stores.UserStore;
            const blockedHashes = new Set();
            const blockedNames = new Set();
            for (const entry of allIds) {
                const id = entry?.id || entry;
                if (!id || !this.api.visibility.shouldHide(id)) continue;
                const user = userStore?.getUser?.(id);
                if (user?.avatar) blockedHashes.add(user.avatar);
                for (const name of [user?.globalName, user?.username]) {
                    if (typeof name === "string" && name.trim()) blockedNames.add(name.trim().toLocaleLowerCase());
                }
            }
            if (blockedNames.size) {
                const nameNodes = row.querySelectorAll?.('[class*="name__"] [class*="overflow"], [class*="channelNameMeasurement"], a[aria-label]') || [];
                for (const node of nameNodes) {
                    const values = [node.textContent, node.getAttribute?.("aria-label")].filter(Boolean);
                    for (const value of values) {
                        const segments = String(value).split(",").map(segment => segment.trim().toLocaleLowerCase());
                        for (const name of blockedNames) {
                            if (segments.some(segment => segment === name || segment.startsWith(`${name} (`))) return true;
                        }
                    }
                }
            }
            if (blockedHashes.size) {
                const proxiedImgs = row.querySelectorAll?.('img[src*="/assets/"], [class*="avatarStack"] img, [class*="avatar__"] img') || [];
                for (const img of proxiedImgs) {
                    const hashes = this._collectAvatarHashesFromImg(img);
                    for (const hash of hashes) {
                        if (blockedHashes.has(hash)) return true;
                    }
                }
            }
        } catch (error) { _recordPatchCatch("groupDms.leakCheck.visibleData", this, error); }
        return false;
    }
    _groupDmRowHasBlockedRecipient(channel) {
        try {
            const allIds = this.getGroupDMRawRecipientIds(channel) || [];
            return allIds.some(id => this.api.visibility.shouldHide(id?.id || id));
        } catch (error) { _recordPatchCatch("groupDms.leakCheck.recipients", this, error); }
        return false;
    }
    _groupDmRowLeaksBlockedName(row) {
        let channel = null;
        let isGroupDM = false;
        try {
            const channelId = this.api.identity.findChannelId(row);
            channel = channelId ? this.api.stores.ChannelStore?.getChannel?.(channelId) : null;
            isGroupDM = !!channel?.isGroupDM?.();
        } catch (error) { _recordPatchCatch("groupDms.leakCheck.channel", this, error); }

        if (!isGroupDM && this._groupDmRowHasBlockedIdentity(row)) return true;
        if (isGroupDM && this._groupDmRowLeaksBlockedVisibleData(row, channel)) return true;
        if (isGroupDM && row.dataset?.nmbRelabeled !== "true" && this._groupDmRowHasBlockedRecipient(channel)) return true;
        return false;
    }
    refreshGroupDmLabels() {
        this.api.resources.timer('groupDms', () => {
            try { this.api.stores.PrivateChannelStore?.emitChange?.(); } catch (error) { _recordPatchCatch("groupDms.refreshPrivateChannels", null, error); }
            try { this.api.stores.ChannelStore?.emitChange?.(); } catch (error) { _recordPatchCatch("groupDms.refreshChannels", null, error); }
        }, 0);
    }
    _isGroupDmRow(row) {
        if (row.dataset.nmbIsGroupDm === "true") return true;
        try {
            const channelId = this.api.identity.findChannelId(row);
            const channel = channelId ? this.api.stores.ChannelStore?.getChannel?.(channelId) : null;
            if (channel?.isGroupDM) {
                const result = channel.isGroupDM();
                if (result) row.dataset.nmbIsGroupDm = "true";
                return result;
            }
        } catch (error) { _recordPatchCatch("groupDms.updateUnreadGhosts", null, error); }
        try {
            if (row.querySelector?.('[class*="avatarStack"], [class*="groupAvatar"], [class*="avatarMulti"]')) return true;
        } catch (error) { _recordPatchCatch("GroupDmSurface._isGroupDmRow.fallback1", this, error); }
        return false;
    }
    _updateGroupDMUnreadSectionGhostStyle() {
        try {
            const section = this._findGroupDMUnreadSection();
            if (!section) { this._removeGroupDMUnreadSectionGhostStyle(); return; }
            this._lastKnownGroupDMUnreadSection = section;
            const items = section.querySelectorAll('[data-list-item-id^="guildsnav___"]');
            const suppressedIds = [];
            const suppressedWrappers = new Set();
            for (const item of items) {
                const listId = item.getAttribute("data-list-item-id") || "";
                const channelId = listId.replace(/^guildsnav___/, "");
                if (channelId && this._isChannelOnlySuppressedActivity(channelId)) {
                    suppressedIds.push(listId);
                    const wrapper = this._findGuildsnavItemWrapper(channelId) || item;
                    suppressedWrappers.add(wrapper);
                }
            }
            const signature = suppressedIds.slice().sort().join(",");
            if (signature === this._groupDMUnreadGhostSignature) return;
            this._groupDMUnreadGhostSignature = signature;
            const previouslyGhosted = section.querySelectorAll('[data-nmb-ghost="true"]');
            for (const el of previouslyGhosted) {
                if (!suppressedWrappers.has(el)) {
                    delete el.dataset.nmbGhost;
                    this.api.ghosting.delete(el);
                }
            }
            for (const wrapper of suppressedWrappers) {
                if (wrapper.dataset.nmbGhost !== "true") {
                    wrapper.dataset.nmbGhost = "true";
                    this.api.ghosting.add(wrapper);
                }
            }
        } catch (error) { _recordPatchCatch("GroupDmSurface._updateGroupDMUnreadSectionGhostStyle.L3248", null, error); }
    }
    _removeGroupDMUnreadSectionGhostStyle() {
        try {
            const section = this._lastKnownGroupDMUnreadSection || document.getElementById("guild-list-unread-dms");
            if (section) {
                section.querySelectorAll('[data-nmb-ghost="true"]').forEach(el => {
                    delete el.dataset.nmbGhost;
                    this.api.ghosting.delete(el);
                });
            }
            this._groupDMUnreadGhostSignature = null;
        } catch (error) { _recordPatchCatch("groupDms.removeUnreadGhosts", null, error); }
    }
    _isChannelOnlySuppressedActivity(channelId) {
        if (!channelId) return false;
        try {
            if (!this.api.readState.hasBlockedOnlyReadActivity(channelId)) return false;
            return !this.api.readState.channelHasVisibleUnread(channelId);
        } catch (error) {
            _recordPatchCatch("groupDms.isChannelOnlySuppressedActivity", null, error);
            return false;
        }
    }
    _findGuildsnavItemWrapper(channelId) {
        try {
            const el = document.querySelector(`[data-list-item-id="guildsnav___${channelId}"]`);
            if (!el) return null;
            const listItem = el.closest('[class*="listItem_"]');
            if (listItem?.parentElement && /height\s*:/.test(listItem.parentElement.getAttribute('style') || '')) {
                return listItem.parentElement;
            }
            return listItem || el.closest('div[style*="height"]') || el;
        } catch (error) {
            _recordPatchCatch("groupDms.findUnreadItemWrapper", null, error);
            return null;
        }
    }
    applyGroupDMUnreadSectionGhosting() {
        this._updateGroupDMUnreadSectionGhostStyle();
    }
    _findGroupDMUnreadSection() {
        const byId = document.getElementById("guild-list-unread-dms");
        if (byId) return byId;
        try {
            const anchorItem = document.querySelector('[data-list-item-id^="guildsnav___"]');
            if (!anchorItem) return null;
            let node = anchorItem.parentElement;
            for (let hops = 0; node && hops < 6; hops++, node = node.parentElement) {
                if (node.querySelectorAll('[data-list-item-id^="guildsnav___"]').length >= 1
                    && !node.querySelector('[data-list-id="guildsnav"]')) {
                    return node;
                }
            }
        } catch (error) { _recordPatchCatch("groupDms.findUnreadSectionFallback", null, error); }
        return null;
    }
    patchGroupDMUnreadSectionObserver() {
        if (this._groupDMUnreadSectionObserverPatched) return;
        const surf = this;
        const self = this.api;
        const attach = () => {
            const section = this._findGroupDMUnreadSection();
            if (!section) return false;
            if (this._groupDMUnreadSectionObserver) return true;
            this.applyGroupDMUnreadSectionGhosting();
            this._groupDMUnreadSectionObserver = new MutationObserver(() => {
                self.resources.debounce('groupDmUnread', () => surf.applyGroupDMUnreadSectionGhosting(), 30);
            });
            this._groupDMUnreadSectionObserver.observe(section, { childList: true, subtree: true });
            this._groupDMUnreadSectionObservedNode = section;
            return true;
        };
        if (attach()) {
            this._groupDMUnreadSectionObserverPatched = true;
            this._registerGroupDMUnreadSectionHealthCheck();
            return;
        }
        const nav = document.querySelector('nav[aria-label] [role="tree"][data-list-id="guildsnav"]')
            || document.querySelector('[role="tree"][data-list-id="guildsnav"]');
        if (!nav) {
            if ((this._groupDMUnreadSectionBootAttempts = (this._groupDMUnreadSectionBootAttempts || 0) + 1) < 20) {
                this.api.retry.schedule(() => this.patchGroupDMUnreadSectionObserver(), 1000);
            }
            return;
        }
        if (this._groupDMUnreadSectionBootObserver) {
            try { this._groupDMUnreadSectionBootObserver.disconnect(); } catch (error) { _recordPatchCatch("GroupDmSurface.patchGroupDMUnreadSectionObserver.L3320", null, error); }
            this._groupDMUnreadSectionBootObserver = null;
        }
        this.api.resources.clearTimer('groupDMUnreadSectionBoot', this._groupDMUnreadSectionBootTimeout);
        const bootObserver = new MutationObserver(() => {
            if (attach()) {
                bootObserver.disconnect();
                if (this._groupDMUnreadSectionBootObserver === bootObserver) this._groupDMUnreadSectionBootObserver = null;
                this.api.resources.clearTimer('groupDMUnreadSectionBoot', this._groupDMUnreadSectionBootTimeout);
                this._groupDMUnreadSectionBootTimeout = null;
                this._groupDMUnreadSectionObserverPatched = true;
                this._registerGroupDMUnreadSectionHealthCheck();
            }
        });
        bootObserver.observe(nav, { childList: true, subtree: true });
        this._groupDMUnreadSectionBootObserver = bootObserver;
        this._groupDMUnreadSectionBootTimeout = this.api.resources.timer('groupDMUnreadSectionBoot', () => {
            try { bootObserver.disconnect(); } catch (error) { _recordPatchCatch("GroupDmSurface.patchGroupDMUnreadSectionObserver.L3336", null, error); }
            if (this._groupDMUnreadSectionBootObserver === bootObserver) this._groupDMUnreadSectionBootObserver = null;
            this._groupDMUnreadSectionBootTimeout = null;
            if ((this._groupDMUnreadSectionBootAttempts = (this._groupDMUnreadSectionBootAttempts || 0) + 1) < 20) {
                this.api.retry.schedule(() => this.patchGroupDMUnreadSectionObserver(), 1000);
            }
        }, 15000);
    }
    _registerGroupDMUnreadSectionHealthCheck() {
        if (this._groupDMUnreadSectionHealthScheduled) return;
        this._groupDMUnreadSectionHealthScheduled = true;
        const surf = this;
        const tick = () => {
            if (!surf._groupDMUnreadSectionHealthScheduled) return;
            const node = surf._groupDMUnreadSectionObservedNode;
            const stale = surf._groupDMUnreadSectionObserverPatched && (!node || !node.isConnected);
            if (stale) {
                try { surf._groupDMUnreadSectionObserver?.disconnect(); } catch (error) { _recordPatchCatch("GroupDmSurface.healthCheck.disconnect", null, error); }
                surf._groupDMUnreadSectionObserver = null;
                surf._groupDMUnreadSectionObservedNode = null;
                surf._groupDMUnreadSectionObserverPatched = false;
                surf._removeGroupDMUnreadSectionGhostStyle();
                surf.patchGroupDMUnreadSectionObserver();
            }
            surf._groupDMUnreadSectionHealthTimer = surf.api.resources.timer('groupDmUnreadHealth', tick, 5000);
        };
        this._groupDMUnreadSectionHealthTimer = this.api.resources.timer('groupDmUnreadHealth', tick, 5000);
    }
    stop() {
        if (this._rowPatchRetryTimeout) {
            this.api.retry.cancel(this._rowPatchRetryTimeout);
            this._rowPatchRetryTimeout = null;
        }
        this._rowPatchInFlight = false;
        this._stopGroupDmRowRetryWatcher();
        this._groupDMUnreadSectionObserver?.disconnect();
        this._groupDMUnreadSectionObserver = null;
        this._groupDMUnreadSectionObservedNode = null;
        this._groupDMUnreadSectionObserverPatched = false;
        this._groupDMUnreadSectionBootObserver?.disconnect();
        this._groupDMUnreadSectionBootObserver = null;
        this.api.resources.clearTimer('groupDMUnreadSectionBoot', this._groupDMUnreadSectionBootTimeout);
        this._groupDMUnreadSectionBootTimeout = null;
        this._groupDMUnreadSectionBootAttempts = 0;
        this._groupDMUnreadSectionHealthScheduled = false;
        this.api.resources.clearTimer('groupDmUnreadHealth', this._groupDMUnreadSectionHealthTimer);
        this._groupDMUnreadSectionHealthTimer = null;
        this.api.resources.cancelDebounce('groupDmUnread');
        try { this._removeGroupDMUnreadSectionGhostStyle(); } catch (e) { try { this.api.logger.error('stop:removeGroupDMUnreadSectionGhostStyle threw', e); } catch (error) { _recordPatchCatch("GroupDmSurface.stop.fallback1", this, error); } }
        this._filteredChannelCache?.clear();
        this._privateChannelStorePatched = false;
        this._privateStorePatchedMethods = new WeakMap();
        this.groupDMPrototypePatched = false;
        this._privateChannelRowPatched = false;
        this._migrateGroupDMInstanceValue = null;
        this._teardownGroupDMPrototypeWatch();
        try {
            if (this._groupDMPrototypeRef && this._groupDMOrigDescriptors) {
                const proto = this._groupDMPrototypeRef;
                for (const key of Object.keys(this._groupDMOrigDescriptors)) {
                    try {
                        const currentDesc = Object.getOwnPropertyDescriptor(proto, key);
                        if (!currentDesc || !currentDesc.get || !currentDesc.get.__nmbPatched) continue;
                        const origDesc = this._groupDMOrigDescriptors[key];
                        if (origDesc) {
                            Object.defineProperty(proto, key, origDesc);
                        } else {
                            delete proto[key];
                        }
                    } catch (e) { try { this.api.logger.error(`stop:restoreGroupDMPrototype:${key} threw`, e); } catch (error) { _recordPatchCatch("GroupDmSurface.stop.fallback2", this, error); } }
                }
            }
        } catch (error) { _recordPatchCatch("GroupDmSurface.stop.L3389", null, error); }
        this._restoreGroupDMInstanceProperties();
        this._groupDMOrigDescriptors = null;
        this._groupDMPrototypeRef = null;
        this._groupDMRecipientsSyms = null;
        this._groupDMGetterResolvingIds = null;
        this._groupDMPrototypeSlowRetryWarned = false;
    }
}
function createForumSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({ get messagesEnabled() { return !!(plugin.settings?.places?.threads || plugin.settings?.places?.messages); } }),
        stores: Object.freeze({
            get ChannelStore() { return plugin.modules.ChannelStore; },
            get SelectedChannelStore() { return plugin.modules.SelectedChannelStore; },
        }),
        constants: Object.freeze({
            get CHANNEL_TYPES() { return plugin.constructor.CHANNEL_TYPES; },
            get TOPIC_HEADER_LOCALE() { return plugin.constructor.TOPIC_HEADER_LOCALE; },
        }),
        visibility: _surfaceUserVisibility(plugin),
        identity: Object.freeze({ findUserId: element => plugin.findUserId(element) }),
        dom: Object.freeze({
            hideElement: (...args) => plugin.hideElement(...args),
            restoreElement: element => plugin.restoreElement(element),
        }),
        fiber: _surfaceFiberProps(plugin),
        channels: Object.freeze({
            isCurrentChannelForum: () => plugin._isCurrentChannelForum(),
            isForumParentChannel: channelId => plugin._isForumParentChannel(channelId),
        }),
        navigation: Object.freeze({ registerRetryHook: (...args) => plugin._registerNavigationRetryHook(...args) }),
        observers: Object.freeze({ trackTransient: observer => plugin._trackTransientObserver(observer) }),
        resources: Object.freeze({ timer: (...args) => plugin._resources.timer(...args) }),
        lifecycle: _runningLifecycle(plugin),
        logger: Object.freeze({ info: (...args) => {
            if (plugin.logger) plugin.logger.info(...args);
            else console.info("[ByeBlocked]", ...args);
        } }),
        health: Object.freeze({ heartbeat: name => plugin._health?.heartbeat(name), register: (...args) => plugin._health?.register(...args) }),
        diagnostics: Object.freeze({ warn: (...args) => plugin.logger?.warn(...args) }),
        domState: Object.freeze({ hasForumPostView: () => !!document.querySelector('[data-list-id^="forum-channel-list-"], [class*="mainCard_"]') }),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            before: (...args) => plugin.patchBefore(...args),
            warn: (...args) => plugin._patcher?._warn(...args),
            unwrap: component => plugin._patcher?.unwrapComponent?.(component),
        }),
        moduleResolver: Object.freeze({ getWithKey: (...args) => plugin._r.getWithKey(...args) }),
        retry: _surfaceRetry(plugin, ["delay","schedule","guardEnter","guardExit"]),
    });
}

class ForumSurface {
    constructor(api) {
        this.api = api;
        this.forumPostComponentPatched = false;
        this._forumPostWaitCycles = 0;
        this._forumRetryScheduled = false;
    }
    enabled() {
        return this.api.settings.messagesEnabled;
    }
    registerHealthChecks() {
        this.api.health.register(
            "forumPostPatch",
            () => {
                if (!this.api.settings.messagesEnabled || this.forumPostComponentPatched) return true;
                try { return !this.api.domState.hasForumPostView(); } catch (_) { return true; }
            },
            () => {
                this.api.diagnostics.warn("The forum post card patch appears inactive - Discord may have changed the component's structure. Consider updating the plugin.");
                try { this.patchForumPostComponent(); } catch (error) { _recordPatchCatch("forums.patchRepair", this, error); }
            }
        );
    }
    patchEarly() {
        this.api.patching.safe('patchForumPostComponent', () => this.patchForumPostComponent());
    }
    scan() {
        this.hideForumPosts();
        this.hideTopicPanelItems();
        this.fixEmptyTopicPanelState();
    }
    stop() {
        this.forumPostComponentPatched = false;
        this._forumPostWaitCycles = 0;
        this._forumRetryScheduled = false;
    }
    _collectForumCandidates() {
        const selectors = [
            '[class*="card_"][data-item-role="item"]',
            '[data-item-role="item"]',
            '[data-list-id^="forum-channel-list-"]',
            '[class*="mainCard_"]',
        ];
        const seen = new Set;
        const candidates = [];
        for (const selector of selectors) {
            let found;
            try { found = document.querySelectorAll(selector); } catch (_) { continue; }
            for (const element of found) {
                if (seen.has(element)) continue;
                seen.add(element);
                candidates.push(element);
            }
        }
        return candidates;
    }
    _isForumRowListProps(props) {
        return !!(props && typeof props === "object"
            && typeof props.renderRow === "function"
            && ("rowHeight" in props || "chunkSize" in props)
            && !props.renderRow.__byeblockedWrapped);
    }
    _wrapForumRenderRow(originalRenderRow) {
        if (typeof originalRenderRow !== "function" || originalRenderRow.__byeblockedWrapped) return originalRenderRow;
        const api = this.api;
        const surface = this;
        const wrapped = function(...args) {
            api.health.heartbeat("forumPostPatch");
            try {
                if (api.settings.messagesEnabled) {
                    const rowArg = args?.[0];
                    const row = (rowArg && typeof rowArg === "object" && "row" in rowArg) ? rowArg.row : rowArg;
                    const threadId = surface._extractForumThreadId(row) || surface._extractForumThreadId(rowArg);
                    const authorId = surface._getForumThreadAuthorId(threadId);
                    if (authorId && api.visibility.shouldHide(authorId)) return null;
                }
            } catch (error) { _recordPatchCatch("forums.filterRenderedRow", this, error); }
            return originalRenderRow.apply(this, args);
        };
        wrapped.__byeblockedWrapped = true;
        return wrapped;
    }
    _extractForumThreadId(row) {
        if (row == null) return null;
        if (typeof row === "string" || typeof row === "number") return row;
        if (typeof row === "object") return row.threadId || row.id || row.channelId || null;
        return null;
    }
    _getForumThreadAuthorId(threadId) {
        if (!threadId) return null;
        try {
            const channel = this.api.stores.ChannelStore?.getChannel?.(threadId);
            return channel?.ownerId || channel?.owner_id || null;
        } catch (_) {
            return null;
        }
    }
    _wrapForumRowProps(props) {
        try {
            if (props && typeof props.renderRow === "function" && !props.renderRow.__byeblockedWrapped) {
                props.renderRow = this._wrapForumRenderRow(props.renderRow);
            }
        } catch (error) { _recordPatchCatch("forums.filterRowProps", this, error); }
    }
    _patchForumCandidate(candidateEl) {
        let fiber = null;
        try { fiber = BdApi.ReactUtils.getInternalInstance(candidateEl); } catch (_) {}
        for (let hop = 0; hop < 30 && fiber; hop++, fiber = fiber.return) {
            const props = fiber.memoizedProps || fiber.pendingProps;
            if (!this._isForumRowListProps(props)) continue;
            const componentType = fiber.type;
            const isPlainFunction = typeof componentType === "function";
            const isWrapperObject = componentType && typeof componentType === "object"
                && (typeof componentType.render === "function" || typeof componentType.type === "function");
            if (!isPlainFunction && !isWrapperObject) continue;
            if (isPlainFunction && componentType.prototype && typeof componentType.prototype.render === "function") {
                this.api.patching.before(componentType.prototype, "render", context => this._wrapForumRowProps(context?.props));
                return true;
            }
            if (isWrapperObject) {
                const wrapperKey = typeof componentType.render === "function" ? "render" : "type";
                try {
                    this.api.patching.before(componentType, wrapperKey, (_, args) => this._wrapForumRowProps(args?.[0]));
                    return true;
                } catch (error) { _recordPatchCatch("forums.patchWrappedRow", this, error); }
                continue;
            }
            try {
                const found = this.api.moduleResolver.getWithKey(m => m === componentType || this.api.patching.unwrap(m) === componentType, "Forum row-list functional component");
                if (found?.[0] && found[1] != null) {
                    const [moduleObj, key] = found;
                    this.api.patching.before(moduleObj, key, (_, args) => this._wrapForumRowProps(args?.[0]));
                    return true;
                }
            } catch (error) { _recordPatchCatch("forums.patchFunctionalRow", this, error); }
        }
        return false;
    }
    patchForumPostComponent(attempt = 0) {
        if (!this.api.settings.messagesEnabled) return;
        if (this.forumPostComponentPatched) return;
        if (!this.api.retry.guardEnter("patchForumPostComponent", attempt)) return;
        this._ensureForumPostRetryListener();
        const forumCandidates = this._collectForumCandidates();
        const hadCandidateEl = forumCandidates.length > 0;
        let patchedAny = false;
        try {
            for (const candidate of forumCandidates) {
                if (this._patchForumCandidate(candidate)) {
                    patchedAny = true;
                    break;
                }
            }
        } catch (error) { _recordPatchCatch("forums.patchCandidateList", this, error); }
        if (patchedAny) {
            this.forumPostComponentPatched = true;
            this.api.retry.guardExit("patchForumPostComponent");
            return;
        }
        if (!hadCandidateEl) {
            if (!this.api.channels.isCurrentChannelForum()) {
                this.api.retry.guardExit("patchForumPostComponent");
                return;
            }
            if (this._forumPostWaitCycles === undefined) this._forumPostWaitCycles = 0;
            this._forumPostWaitCycles++;
            if (this._forumPostWaitCycles < 750) {
                this.api.retry.schedule(() => this.patchForumPostComponent(attempt || 1), 400);
                return;
            }
            try {
                this.api.logger.info("patchForumPostComponent: no forum channel post list detected after ~5 minutes, will stop waiting (this is expected if the user never opened a forum channel)");
            } catch (_) {}
            this.api.retry.guardExit("patchForumPostComponent");
            return;
        }
        this._forumPostWaitCycles = 0;
        if (attempt < 20) {
            this.api.retry.schedule(() => this.patchForumPostComponent(attempt + 1), this.api.retry.delay(attempt, 5000));
            return;
        }
        this.api.patching.warn("patchForumPostComponent", new Error("ran out of attempts to locate the forum row-list component - this patch only works while a forum channel's post list is open, so it may simply not have been mounted yet during any attempt"));
        this.api.retry.guardExit("patchForumPostComponent");
    }
    _ensureForumPostRetryListener() {
        const surf = this;
        const api = this.api;
        this.api.navigation.registerRetryHook("forumPost", () => {
            if (!api.lifecycle.isRunning) return;
            if (!surf.forumPostComponentPatched) {
                surf._forumPostWaitCycles = 0;
                surf.patchForumPostComponent(1);
            }
        });
    }
    _getForumThreadOwnerId(card) {
        try {
            const idEl = card.querySelector("[data-item-id]");
            const threadId = idEl?.dataset?.itemId || card.dataset?.itemId;
            if (!threadId) return null;
            return this._getForumThreadAuthorId(threadId);
        } catch (_) {
            return null;
        }
    }
    hideForumPosts() {
        try {
            const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
            if (!channelId || !this.api.channels.isForumParentChannel(channelId)) return;
            for (const list of document.querySelectorAll('[data-list-id^="forum-channel-list-"]')) {
                for (const card of this._collectForumPostCards(list)) {
                    if (card.dataset?.hiddenBlocked === "true") continue;
                    const authorId = this._readForumPostAuthorId(card);
                    const content = this._readForumPostContent(card);
                    if (this._shouldHideForumPost(authorId, content)) this.api.dom.hideElement(card, "forum-post-only-blocked", authorId || null);
                }
            }
        } catch (error) { _recordPatchCatch("forums.hidePosts", this, error); }
    }
    _collectForumPostCards(list) {
        let cards = Array.from(list.querySelectorAll('[class*="card_"]')).filter(card => {
            const cls = card.className;
            return !/headerRow_/.test(cls);
        });
        if (!cards.length) {
            cards = Array.from(list.children).filter(el => el.nodeType === 1 && el.matches('a, div, [role="listitem"], [data-item-id], [class*="card_"], [class*="post_"], [class*="thread_"]'));
        }
        return cards;
    }
    _readForumPostAuthorId(card) {
        let authorId = this._getForumThreadOwnerId(card);
        if (!authorId) authorId = this.api.identity.findUserId(card);
        if (!authorId) {
            const threadId = card.dataset?.itemId || card.querySelector("[data-item-id]")?.dataset?.itemId;
            if (threadId && this.api.stores.ChannelStore?.getChannel) {
                try { const ch = this.api.stores.ChannelStore.getChannel(threadId); authorId = ch?.ownerId || ch?.owner_id; } catch (error) { _recordPatchCatch("forums.readCardOwner", null, error); }
            }
        }
        return authorId;
    }
    _readForumPostContent(card) {
        const messageContent = card.querySelector('[class*="message_"], [class*="messageFocusBlock"]');
        const blockedMessage = card.querySelector('[data-hidden-blocked="true"], [class*="blockedMessage"]');
        const placeholder = card.querySelector('text-md\\/medium, .text-md\\/medium, [class*="empty"]');
        return {
            hasBlockedMessage: blockedMessage?.dataset?.hiddenBlocked === "true",
            hasEmptyPlaceholder: !!placeholder && /Be the first|start this conversation|Seja o primeiro|começar essa conversa|empty/i.test(placeholder.textContent || ""),
            hasNoVisibleMessage: !!messageContent && !messageContent.querySelector(':not([data-hidden-blocked="true"])'),
        };
    }
    _shouldHideForumPost(authorId, content) {
        return !!(authorId && this.api.visibility.shouldHide(authorId)) || content.hasBlockedMessage || content.hasEmptyPlaceholder || content.hasNoVisibleMessage;
    }
    isCurrentChannelForumOrThread() {
        try {
            const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
            const channel = channelId ? this.api.stores.ChannelStore?.getChannel?.(channelId) : null;
            return !!(channel && (channel.type === this.api.constants.CHANNEL_TYPES.GUILD_FORUM || channel.type === this.api.constants.CHANNEL_TYPES.GUILD_MEDIA || channel.isThread?.()));
        } catch (_) {
            return false;
        }
    }
    hideTopicPanelItems() {
        try {
            if (!this.isCurrentChannelForumOrThread()) return;
            let topicItems = document.querySelectorAll('main [class*="container_"]');
            if (!topicItems.length) {
                topicItems = document.querySelectorAll('[data-list-item-id*="forum"], [data-list-item-id*="thread"], [class*="thread_"], [class*="forum_"], [role="listitem"]');
            }
            for (const item of topicItems) {
                if (item.tagName === "MAIN") continue;
                if (item.dataset?.hiddenBlocked === "true") continue;
                let authorId = null;
                const listId = item.dataset?.listItemId || item.getAttribute("data-list-item-id") || "";
                let threadId = (listId.match(/(\d{17,20})/) || [])[1] || null;
                if (!threadId) {
                    try {
                        const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
                        if (channelId) {
                            const channel = this.api.stores.ChannelStore?.getChannel?.(channelId);
                            if (channel?.type === this.api.constants.CHANNEL_TYPES.GUILD_FORUM || channel?.type === this.api.constants.CHANNEL_TYPES.GUILD_MEDIA) {
                                const threads = this.api.stores.ChannelStore?.getThreads?.(channelId) || channel?.threads || [];
                                for (const t of threads) {
                                    if (t?.id && /^\d{17,20}$/.test(String(t.id)) && (
                                        (item.getAttribute("aria-label") || "").includes(t.name || "") ||
                                        (item.textContent || "").includes(t.name || "")
                                    )) { threadId = String(t.id); break; }
                                }
                            }
                        }
                    } catch (error) { _recordPatchCatch("forums.resolveActiveThread", null, error); }
                }
                if (!threadId) {
                    this.api.fiber.walkProps(item, props => {
                        if (threadId) return;
                        const candidate = props?.threadId || props?.thread?.id;
                        if (candidate && /^\d{17,20}$/.test(String(candidate))) threadId = String(candidate);
                    }, 12);
                }
                if (threadId && this.api.stores.ChannelStore && typeof this.api.stores.ChannelStore.getChannel === "function") {
                    try {
                        const thread = this.api.stores.ChannelStore.getChannel(threadId);
                        if (thread) authorId = thread.ownerId || thread.owner_id || thread.message?.author?.id;
                    } catch (error) { _recordPatchCatch("forums.readThreadOwner", null, error); }
                }
                if (!authorId) authorId = this.api.identity.findUserId(item);
                if (authorId && this.api.visibility.shouldHide(authorId)) {
                    this.api.dom.hideElement(item, "topic-panel-blocked", authorId);
                }
            }
        } catch (error) { _recordPatchCatch("forums.hideTopicPanelItems", this, error); }
    }
    findActivePostsPopoverRoot(node) {
        try {
            if (node.matches?.('[class*="popout__"][class*="popover_"]')) return node;
            if (node.querySelector) {
                const direct = node.querySelector('[class*="popout__"][class*="popover_"]');
                if (direct) return direct;
            }
            if (node.matches?.(_SEL.rowEl) || node.querySelector && node.querySelector(_SEL.rowEl)) {
                const rowEl = node.matches?.(_SEL.rowEl) ? node : node.querySelector(_SEL.rowEl);
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
        } catch (error) { _recordPatchCatch("forums.findThreadPopout", null, error); }
        return null;
    }
    _threadFromRowFiber(row) {
        let found = null;
        try {
            const listId = row.dataset?.listItemId || "";
            const idMatch = listId.match(/(\d{17,20})/);
            const threadId = idMatch?.[1];
            if (threadId && this.api.stores.ChannelStore?.getChannel) {
                const ch = this.api.stores.ChannelStore.getChannel(threadId);
                if (ch && (ch.type === this.api.constants.CHANNEL_TYPES.PUBLIC_THREAD || ch.type === this.api.constants.CHANNEL_TYPES.PRIVATE_THREAD)) found = ch;
            }
        } catch (error) { _recordPatchCatch("forums.readThreadChannel", null, error); }
        if (!found) {
            this.api.fiber.walkProps(row, props => {
                if (!found && props?.thread) found = props.thread;
            }, 10);
        }
        return found;
    }
    watchActivePostsPopoverContent(popoverRoot) {
        try {
            if (!popoverRoot || popoverRoot.dataset?.nmbPopoverWatched === "true") return;
            popoverRoot.dataset.nmbPopoverWatched = "true";
            const observer = new MutationObserver(() => {
                if (!document.contains(popoverRoot)) {
                    dispose();
                    return;
                }
                try {
                    if (this.api.settings.messagesEnabled) this.hideActivePostsPopover(popoverRoot);
                } catch (error) { _recordPatchCatch("forums.activePostsPopoverMutation", this, error); }
            });
            const dispose = this.api.observers.trackTransient(observer);
            observer.observe(popoverRoot, {
                childList: true,
                subtree: true,
                attributes: true
            });
            this.api.resources.timer('activePostsPopoverWatch', dispose, 15e3);
        } catch (error) { _recordPatchCatch("forums.watchActivePostsPopover", this, error); }
    }
    hideActivePostsPopover(root) {
        if (!root) return;
        try {
            const rowSel = _SEL.rowEl;
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
                    if (threadId && this.api.stores.ChannelStore?.getChannel) {
                        try {
                            const ch = this.api.stores.ChannelStore.getChannel(threadId);
                            authorId = ch?.ownerId || ch?.owner_id || null;
                        } catch (error) { _recordPatchCatch("forums.readCountOwner", null, error); }
                    }
                }
                if (!authorId) authorId = this.api.identity.findUserId(row);
                if (authorId && this.api.visibility.shouldHide(authorId)) {
                    this.api.dom.hideElement(row, "active-posts-popover-blocked", authorId);
                } else {
                    visibleCount++;
                }
            }
            if (visibleCount === 0) {
                this.api.dom.hideElement(root, "active-posts-popover-all-blocked", false);
            }
        } catch (error) { _recordPatchCatch("forums.hideActivePostsPopover", this, error); }
    }
    fixEmptyTopicPanelState() {
        try {
            if (!this.isCurrentChannelForumOrThread()) return;
            const headers = document.querySelectorAll('[class*="sectionHeader_"]');
            for (const header of headers) {
                const textContent = (header.textContent || "").toLowerCase();
                const topicLabel = (_locale(_getLocale(), this.api.constants.TOPIC_HEADER_LOCALE) || 'topic').toLowerCase();
                if (!textContent.includes("topic") && !textContent.includes("thread") && !textContent.includes(topicLabel)) continue;
                const scrollerContent = header.parentElement;
                if (!scrollerContent) continue;
                const topics = Array.from(scrollerContent.querySelectorAll('[class*="container_"]'));
                if (topics.length === 0) continue;
                let visibleCount = 0;
                let hiddenBlockedCount = 0;
                for (const topic of topics) {
                    if (topic.dataset?.hiddenBlocked === "true") hiddenBlockedCount++; else if (topic.offsetParent !== null) visibleCount++;
                }
                if (visibleCount === 0 && hiddenBlockedCount > 0) {
                    this.api.dom.hideElement(header, "empty-topic-header");
                } else if (visibleCount > 0) {
                    this.api.dom.restoreElement(header);
                    if (!header.dataset.nmbOrigText) header.dataset.nmbOrigText = header.textContent;
                    const originalText = header.dataset.nmbOrigText;
                    const match = originalText.match(/\d+/);
                    if (match) {
                        const originalNumber = parseInt(match[0], 10);
                        const realNumber = Math.max(0, originalNumber - hiddenBlockedCount);
                        const currentDisplayedNumber = parseInt(header.textContent.match(/\d+/)?.[0] || "0", 10);
                        if (realNumber !== currentDisplayedNumber) {
                            _setTemporaryText(header, originalText.replace(/\d+/, realNumber), "messages");
                        }
                    }
                }
            }
        } catch (error) { _recordPatchCatch("forums.fixEmptyTopicPanelState", this, error); }
    }
    scheduleForumRetry() {
        if (this._forumRetryScheduled) return;
        this._forumRetryScheduled = true;
        const delays = [ 100, 400 ];
        for (let d = 0; d < delays.length; d++) {
            this.api.resources.timer('forumRetry', () => {
                if (!this.api.lifecycle.isRunning) return;
                try { this.hideForumPosts(); } catch (error) { _recordPatchCatch("forums.retryScan", this, error); }
            }, delays[d]);
        }
        this.api.resources.timer('forumRetry', () => { this._forumRetryScheduled = false; }, 400);
    }
}
function createPinSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({ get messagesEnabled() { return !!plugin.settings?.places?.pins; } }),
        constants: Object.freeze({
            get ACTIONS() { return plugin.constructor.ACTIONS; },
        }),
        stores: Object.freeze({
            get SelectedChannelStore() { return plugin.modules.SelectedChannelStore; },
            get ChannelPinsStore() { return plugin.modules.ChannelPinsStore; },
            get ReadStateStore() { return plugin.modules.ReadStateStore; },
            get MessageStore() { return plugin.modules.MessageStore; },
            ensureDispatcher() {
                if (!plugin.modules.Dispatcher) {
                    try { plugin.modules.Dispatcher = plugin.modules.SelectedChannelStore?._dispatcher || null; } catch (error) { _recordPatchCatch("pins.resolveDispatcher", null, error); }
                }
                return plugin.modules.Dispatcher;
            },
        }),
        identity: Object.freeze({
            findUserId: element => plugin.findUserId(element),
            shouldHide: userId => plugin.shouldHide(userId),
        }),
        messages: Object.freeze({
            getChannelMessagesList: channelId => plugin._getChannelMessagesList(channelId),
            isMessageOfType: (message, typeKey) => plugin._isMessageOfType(message, typeKey),
        }),
        dom: Object.freeze({ hideElement: (...args) => plugin.hideElement(...args) }),
        readState: Object.freeze({
            lastPinTimestamp: channelId => plugin.modules.ReadStateStore?.lastPinTimestamp?.(channelId),
            forceRecheck: (...args) => plugin._surfaces.readState.forceReadStateRecheck(...args),
        }),
        groupDms: Object.freeze({ handleRecipientAdd: message => plugin._handleGroupRecipientAdd(message) }),
        coordination: Object.freeze({
            queueScan: (...args) => plugin.queueScan(...args),
            queueRefresh: (...args) => plugin.queueRefresh(...args),
            get scanInFlight() { return plugin.scanInFlight; },
        }),
        persistence: Object.freeze({
            load: key => BdApi.Data.load(plugin.pluginName, key),
            save: (key, value) => BdApi.Data.save(plugin.pluginName, key, value),
        }),
        resources: Object.freeze({ timer: (...args) => plugin._resources.timer(...args) }),
        lifecycle: _runningLifecycle(plugin),
        retry: _surfaceRetry(plugin, ["guardEnter","guardExit","schedule","delay"]),
        health: Object.freeze({
            register: (...args) => plugin._health?.register(...args),
            hasBlockedUserInSample: selector => plugin._hasBlockedUserInSample(selector),
        }),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            after: (...args) => plugin.patchAfter(...args),
            before: (...args) => plugin.patchBefore(...args),
            warn: (...args) => plugin._patcher?._warn(...args),
        }),
    });
}

class PinSurface {
    constructor(api) {
        this.api = api;
        this._channelPinsStorePatched = false;
        this._pinFluxPatched = false;
        this._blockedPinnedMessageIds = this.loadBlockedPinnedIds();
        this._pinPinnerByMessageId = this.loadPinPinnerCache();
        this._pendingPinsByChannel = new Map();
    }
    patchEarly() {
        this.api.patching.safe('patchChannelPinsStore', () => this.patchChannelPinsStore());
        this.api.patching.safe('patchPinFlux', () => this.patchPinFlux());
    }
    stop() {
        this._channelPinsStorePatched = false;
        this._pinFluxPatched = false;
        this._pendingPinsByChannel.clear();
    }
    registerHealthChecks() {
        this.api.health.register(
            "pinnedMessages",
            () => {
                if (!this.api.settings.messagesEnabled) return true;
                return !this.api.health.hasBlockedUserInSample('[class*="pinnedMessage"], [class*="pinnedItem"], [role="dialog"] [class*="pin"] [class*="message_"]');
            },
            () => {
                if (this.api.coordination.scanInFlight) return;
                try { this.api.coordination.queueScan(); } catch (error) { _recordPatchCatch("pins.healthRescan", this, error); }
            }
        );
    }

    loadBlockedPinnedIds() {
        try {
            const stored = this.api.persistence.load("blockedPinnedIds");
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
            this.api.persistence.save("blockedPinnedIds", ids);
        } catch (error) { _recordPatchCatch("pins.saveBlockedPinnedIds", this, error); }
    }

    loadPinPinnerCache() {
        try {
            const stored = this.api.persistence.load("pinPinnerCache");
            if (stored && typeof stored === "object") return new Map(Object.entries(stored));
        } catch (error) { _recordPatchCatch("pins.loadPinnerCache", this, error); }
        return new Map;
    }

    savePinPinnerCache() {
        try {
            const entries = Array.from(this._pinPinnerByMessageId.entries()).slice(-500);
            this._pinPinnerByMessageId = new Map(entries);
            this.api.persistence.save("pinPinnerCache", Object.fromEntries(entries));
        } catch (error) { _recordPatchCatch("pins.savePinnerCache", this, error); }
    }

    _rememberPinPinner(messageId, pinnerId) {
        if (!messageId || !pinnerId) return;
        const key = String(messageId);
        const val = String(pinnerId);
        if (this._pinPinnerByMessageId.get(key) === val) return;
        this._pinPinnerByMessageId.set(key, val);
        this.savePinPinnerCache();
    }

    _findPinSystemMessage(channelId, messageId) {
        if (!channelId || !messageId) return null;
        const list = this.api.messages.getChannelMessagesList(channelId);
        for (let i = list.length - 1; i >= 0; i--) {
            const msg = list[i];
            if (!this.api.messages.isMessageOfType(msg, "CHANNEL_PINNED_MESSAGE")) continue;
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

    _pendingPinQueue(channelId) {
        if (!this._pendingPinsByChannel) this._pendingPinsByChannel = new Map;
        if (!this._pendingPinsByChannel.has(channelId)) this._pendingPinsByChannel.set(channelId, new Set);
        return this._pendingPinsByChannel.get(channelId);
    }
    _schedulePinPinnerRetry(channelId, messageId, attempt = 0) {
        if (!channelId || !messageId) return;
        const queue = this._pendingPinQueue(channelId);
        if (!attempt && queue.has(messageId)) return;
        if (!attempt) queue.add(messageId);
        const delays = [1500, 3000, 6000];
        const maxAttempts = delays.length;
        const delay = attempt < maxAttempts ? delays[attempt] : 10000;
        this.api.resources.timer('pinPinnerRetry', () => {
            if (!this.api.lifecycle.isRunning) return;
            const pending = this._pendingPinsByChannel;
            if (!pending || !pending.has(channelId) || !pending.get(channelId).has(messageId)) return;
            if (this._pinPinnerByMessageId.has(String(messageId))) {
                this._cleanupPendingPin(channelId, messageId);
                return;
            }
            this._resolvePendingPinFromStore(channelId, messageId);
            if (attempt + 1 < maxAttempts) {
                this._pendingPinQueue(channelId).add(messageId);
                this._schedulePinPinnerRetry(channelId, messageId, attempt + 1);
            }
        }, delay);
    }

    shouldHidePinnedMessage(channelId, messageId, pinItem) {
        if (!messageId) return false;
        if (this._blockedPinnedMessageIds.has(String(messageId))) return true;
        const authorId = pinItem?.message?.author?.id;
        if (authorId && this.api.identity.shouldHide(authorId)) return true;
        const pinnerId = this._resolvePinPinnerId(channelId, messageId, pinItem);
        if (pinnerId && this.api.identity.shouldHide(pinnerId)) {
            this._markMessagePinnedByBlocked(messageId);
            return true;
        }
        return false;
    }

    _extractPinActionPinnerId(action) {
        if (!action || typeof action !== "object") return null;
        return action.pinnedBy?.id || action.pinnedById || action.userId || action.user?.id || action.pin?.pinnedBy?.id || action.pinned_by?.id || null;
    }

    processPinStoreItems(channelId, items) {
        if (!channelId || !Array.isArray(items)) return;
        let changed = false;
        for (const item of items) {
            const messageId = item?.message?.id;
            if (!messageId) continue;
            const pinnerId = this._resolvePinPinnerId(channelId, messageId, item);
            if (pinnerId && this.api.identity.shouldHide(pinnerId)) {
                if (!this._blockedPinnedMessageIds.has(String(messageId))) changed = true;
                this._markMessagePinnedByBlocked(messageId);
            } else if (pinnerId && !this.api.identity.shouldHide(pinnerId) && this._blockedPinnedMessageIds.has(String(messageId))) {
                changed = true;
                this._unmarkMessageUnpinned(messageId);
            }
        }
        if (changed) this.api.coordination.queueScan();
    }

    _ackBlockedOnlyPins() {
        try {
            const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
            if (!channelId) return;
            const rs = this.api.stores.ReadStateStore;
            const pinsStore = this.api.stores.ChannelPinsStore;
            if (!rs || !pinsStore?.getPins) return;
            const items = pinsStore.getPins(channelId)?.items;
            if (!Array.isArray(items) || !items.length) return;
            const lastPinTs = this.api.readState.lastPinTimestamp(channelId);
            const newPins = _getUnreadPins(items, lastPinTs);
            if (!newPins.length) return;
            const allBlocked = newPins.every(item => {
                const messageId = item?.message?.id;
                return messageId && this.shouldHidePinnedMessage(channelId, messageId, item);
            });
            if (!allBlocked) return;
            const ack = rs.ackPins || rs.ackPinnedMessages || rs.ackChannelPins;
            if (typeof ack === "function") ack.call(rs, channelId); else this.api.readState.forceRecheck(true);
        } catch (error) { _recordPatchCatch("pins.ackBlockedOnlyPins", this, error); }
    }

    _markMessagePinnedByBlocked(messageId) {
        if (!messageId || this._blockedPinnedMessageIds.has(String(messageId))) return;
        this._blockedPinnedMessageIds.add(String(messageId));
        this.saveBlockedPinnedIds();
        this.api.coordination.queueRefresh();
        this.api.readState.forceRecheck();
        this._ackBlockedOnlyPins();
    }

    _unmarkMessageUnpinned(messageId) {
        if (!messageId || !this._blockedPinnedMessageIds.has(String(messageId))) return;
        this._blockedPinnedMessageIds.delete(String(messageId));
        this.saveBlockedPinnedIds();
        this.api.readState.forceRecheck();
    }

    scanForBlockedPinSystemMessages(ret) {
        try {
            if (!ret) return;
            const list = _messageCollectionToArray(ret);
            if (!Array.isArray(list) || !list.length) return;
            for (let i = 0; i < list.length; i++) {
                const msg = list[i];
                if (!this.api.messages.isMessageOfType(msg, "CHANNEL_PINNED_MESSAGE")) continue;
                this._handlePinSystemMessage(msg);
            }
        } catch (error) { _recordPatchCatch("pins.scanSystemMessages", this, error); }
    }

    patchChannelPinsStore(attempt = 0) {
        if (!this.api.settings.messagesEnabled) return;
        if (this._channelPinsStorePatched) return;
        if (!this.api.retry.guardEnter("patchChannelPinsStore", attempt)) return;
        const store = this.api.stores.ChannelPinsStore;
        if (!store || typeof store.getPins !== "function") {
            if (attempt < 15) { this.api.retry.schedule(() => this.patchChannelPinsStore(attempt + 1), this.api.retry.delay(attempt, 2000)); return; }
            this.api.patching.warn("patchChannelPinsStore", new Error("ChannelPinsStore.getPins unavailable after several attempts"));
            this.api.retry.guardExit("patchChannelPinsStore");
            return;
        }
        const self = this;
        const installed = this.api.patching.after(store, "getPins", function(_, args, ret) {
            const channelId = args?.[0];
            if (!channelId || !ret || !Array.isArray(ret.items)) return ret;
            self.processPinStoreItems(channelId, ret.items);
            const filteredItems = ret.items.filter(item => {
                const messageId = item?.message?.id;
                return messageId ? !self.shouldHidePinnedMessage(channelId, messageId, item) : true;
            });
            if (filteredItems.length === ret.items.length) return ret;
            return Object.assign({}, ret, { items: filteredItems });
        });
        if (!installed) {
            if (attempt < 15) {
                this.api.retry.schedule(() => this.patchChannelPinsStore(attempt + 1), this.api.retry.delay(attempt, 2000));
            } else {
                this.api.patching.warn("patchChannelPinsStore", new Error("getPins patch failed after several attempts"));
                this.api.retry.guardExit("patchChannelPinsStore");
            }
            return;
        }
        this._channelPinsStorePatched = true;
        this.api.retry.guardExit("patchChannelPinsStore");
    }

    patchPinFlux(attempt = 0) {
        if (this._pinFluxPatched) return;
        if (!this.api.retry.guardEnter("patchPinFlux", attempt)) return;
        const Dispatcher = this.api.stores.ensureDispatcher();
        if (!Dispatcher || typeof Dispatcher.dispatch !== "function") {
            if (attempt < 15) { this.api.retry.schedule(() => this.patchPinFlux(attempt + 1), this.api.retry.delay(attempt, 2000)); return; }
            this.api.patching.warn("patchPinFlux", new Error("Dispatcher unavailable after several attempts"));
            this.api.retry.guardExit("patchPinFlux");
            return;
        }
        const self = this;
        const installed = this.api.patching.before(Dispatcher, "dispatch", function(_, args) {
            try {
                const action = args?.[0];
                if (!action || typeof action !== "object") return;
                if (action.type === self.api.constants.ACTIONS.MESSAGE_CREATE && self.api.messages.isMessageOfType(action.message, "RECIPIENT_ADD")) {
                    self.api.groupDms.handleRecipientAdd(action.message);
                    return;
                }
                if (!self.api.settings.messagesEnabled) return;
                if (action.type === self.api.constants.ACTIONS.MESSAGE_PIN_ADD) {
                    self._handlePinAdd(action);
                    return;
                }
                if (action.type === self.api.constants.ACTIONS.MESSAGE_PIN_REMOVE) {
                    self._unmarkMessageUnpinned(action.messageId);
                    return;
                }
                if (action.type === self.api.constants.ACTIONS.MESSAGE_CREATE && self.api.messages.isMessageOfType(action.message, "CHANNEL_PINNED_MESSAGE")) {
                    self._handlePinSystemMessage(action.message);
                    return;
                }
                if (action.type === self.api.constants.ACTIONS.MESSAGE_UPDATE && action.message) {
                    self.api.coordination.queueScan();
                    return;
                }
                const channelId = action.channelId || action.channel_id;
                if (channelId && (action.type === self.api.constants.ACTIONS.CHANNEL_PINS_UPDATE || action.type === self.api.constants.ACTIONS.LOAD_PINNED_MESSAGES_SUCCESS || action.type === self.api.constants.ACTIONS.FETCH_PINNED_MESSAGES_SUCCESS)) {
                    self.scanExistingPinsForChannel(channelId);
                    self.processPinStoreItems(channelId, action.items || action.pins?.items);
                    self.api.readState.forceRecheck(true);
                    self.api.coordination.queueScan();
                }
            } catch (e) {
                self.api.patching.warn("patchPinFlux", e);
            }
        });
        if (!installed) {
            if (attempt < 15) {
                this.api.retry.schedule(() => this.patchPinFlux(attempt + 1), this.api.retry.delay(attempt, 2000));
            } else {
                this.api.patching.warn("patchPinFlux", new Error("Dispatcher.dispatch patch failed after several attempts"));
                this.api.retry.guardExit("patchPinFlux");
            }
            return;
        }
        this._pinFluxPatched = true;
        this.api.retry.guardExit("patchPinFlux");
    }

    revalidateActiveChannelPins() {
        try {
            if (!this._blockedPinnedMessageIds || !this._blockedPinnedMessageIds.size) return;
            const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
            if (channelId) this.scanExistingPinsForChannel(channelId);
        } catch (error) { _recordPatchCatch("pins.revalidateActiveChannel", this, error); }
    }

    _handlePinAdd(action) {
        try {
            const pinnedById = this._extractPinActionPinnerId(action);
            const messageId = action.messageId || action.message?.id;
            const channelId = action.channelId || action.channel_id || null;
            if (!messageId) return;
            if (pinnedById) {
                this._rememberPinPinner(messageId, pinnedById);
                if (this.api.identity.shouldHide(pinnedById)) this._markMessagePinnedByBlocked(messageId); else this._unmarkMessageUnpinned(messageId);
                return;
            }
            this._schedulePinPinnerRetry(channelId, messageId);
        } catch (error) { _recordPatchCatch("pins.handlePinAdd", this, error); }
    }

    _resolvePendingPinFromStore(channelId, messageId) {
        try {
            if (!channelId || !messageId) return;
            const pending = this._pendingPinsByChannel;
            if (!pending || !pending.has(channelId) || !pending.get(channelId).has(messageId)) return;
            const store = this.api.stores.MessageStore;
            const getRaw = store?.getMessages || store?.getMessagesForChannel || store?.getMessagesForChannelId;
            let list = null;
            try {
                const ret = typeof getRaw === "function" ? getRaw.call(store, channelId) : null;
                list = _messageCollectionToArray(ret);
            } catch (error) { _recordPatchCatch("pins.resolvePendingPinStore", this, error); }
            let matched = null;
            if (Array.isArray(list)) {
                for (let i = list.length - 1; i >= 0; i--) {
                    const msg = list[i];
                    if (!this.api.messages.isMessageOfType(msg, "CHANNEL_PINNED_MESSAGE")) continue;
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
        } catch (error) { _recordPatchCatch("pins.resolvePendingPin", this, error); }
    }

    _handleUnresolvedPin(channelId, messageId) {
        try {
            const sys = this._findPinSystemMessage(channelId, messageId);
            const pinnerId = sys?.author?.id;
            if (pinnerId) {
                this._rememberPinPinner(messageId, pinnerId);
                if (this.api.identity.shouldHide(pinnerId)) this._markMessagePinnedByBlocked(messageId);
            }
        } catch (error) { _recordPatchCatch("pins.handleUnresolvedPin", this, error); }
    }

    _handlePinSystemMessage(msg) {
        try {
            if (!msg || !this.api.messages.isMessageOfType(msg, "CHANNEL_PINNED_MESSAGE")) return;
            const messageId = msg.messageReference?.message_id || msg.message_reference?.message_id;
            if (!messageId) return;
            const pinnedById = msg.author?.id;
            if (pinnedById) {
                this._rememberPinPinner(messageId, pinnedById);
                if (this.api.identity.shouldHide(pinnedById)) this._markMessagePinnedByBlocked(messageId); else this._unmarkMessageUnpinned(messageId);
            }
        } catch (error) { _recordPatchCatch("pins.handleSystemMessage", this, error); }
    }

    scanExistingPinsForChannel(channelId) {
        try {
            if (!channelId) return;
            const list = this.api.messages.getChannelMessagesList(channelId);
            for (let i = 0; i < list.length; i++) {
                const msg = list[i];
                if (this.api.messages.isMessageOfType(msg, "CHANNEL_PINNED_MESSAGE")) this._handlePinSystemMessage(msg);
            }
            const items = this.api.stores.ChannelPinsStore?.getPins?.(channelId)?.items;
            this.processPinStoreItems(channelId, items);
        } catch (error) { _recordPatchCatch("pins.scanExistingChannel", this, error); }
    }


    hidePinnedMessages() {
        if (!this.api.settings.messagesEnabled) return;
        const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
        const pinsItems = channelId ? this.api.stores.ChannelPinsStore?.getPins?.(channelId)?.items || [] : [];
        const pinCards = document.querySelectorAll(_SEL.pinCard);
        for (let i = 0; i < pinCards.length; i++) {
            const pinCard = pinCards[i];
            if (pinCard.dataset?.hiddenBlocked === "true") continue;
            const listId = pinCard.dataset?.listItemId || "";
            const pinMatch = listId.match(/^pins_+(\d{17,20})$/);
            const messageId = pinMatch ? pinMatch[1] : null;
            const userId = this.api.identity.findUserId(pinCard);
            const pinItem = messageId && pinsItems.length ? pinsItems.find(item => item?.message?.id === messageId) || null : null;
            const shouldHideByAuthor = userId && this.api.identity.shouldHide(userId);
            const shouldHideByPinner = messageId && this.shouldHidePinnedMessage(channelId, messageId, pinItem);
            if (!shouldHideByAuthor && !shouldHideByPinner) continue;
            this.api.dom.hideElement(pinCard, shouldHideByAuthor ? "pin-author" : "pin-by-blocked", shouldHideByAuthor ? userId : false);
            const wrapper = pinCard.closest(_SEL.messageGroupWrapper);
            if (wrapper && wrapper.dataset?.hiddenBlocked !== "true") {
                const siblingCards = Array.from(wrapper.querySelectorAll(_SEL.pinCard));
                if (siblingCards.length > 0 && siblingCards.every(card => card.dataset?.hiddenBlocked === "true")) {
                    this.api.dom.hideElement(wrapper, "pinned-panel-residue", false);
                }
            }
        }
        this.cleanupPinnedPanelResidue();
    }

    fixPinNotificationBadge() {
        if (!this.api.settings.messagesEnabled) return;
        const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
        if (!channelId) return;
        let showBadge = false;
        try {
            showBadge = !!this.api.stores.ReadStateStore?.hasUnreadPins?.(channelId);
        } catch (error) { _recordPatchCatch("pins.readNotificationBadge", this, error); }
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

    cleanupPinnedPanelResidue() {
        const pinsRoots = document.querySelectorAll('[data-list-id="pins"], [data-list-id*="pins"]');
        if (!pinsRoots.length) return;
        for (let i = 0; i < pinsRoots.length; i++) {
            const groups = pinsRoots[i].querySelectorAll(_SEL.messageGroupWrapper);
            for (let j = 0; j < groups.length; j++) {
                const wrapper = groups[j];
                if (wrapper.dataset?.hiddenBlocked === "true") continue;
                const pinCards = Array.from(wrapper.querySelectorAll(_SEL.pinCard));
                if (pinCards.length === 0) continue;
                if (pinCards.every(card => card.dataset?.hiddenBlocked === "true")) {
                    this.api.dom.hideElement(wrapper, "pinned-panel-residue", false);
                }
            }
        }
    }
}


function createMessageSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({ get messagesEnabled() { return !!plugin.settings?.places?.messages; }, get mentionsEnabled() { return plugin._placeEnabled("mentions"); }, get inboxEnabled() { return plugin._placeEnabled("inbox"); } }),
        identity: Object.freeze({
            findUserId: element => plugin.findUserId(element),
            walkFiberShallow: (element, visitor) => plugin._identity.walkFiberShallow(element, visitor),
            getMessageInfo: element => plugin.getMessageInfo(element),
        }),
        visibility: Object.freeze({
            shouldHide: (...args) => plugin.shouldHide(...args),
            isBlockedRelationship: userId => plugin._relIsBlockedFn?.(userId),
        }),
        health: Object.freeze({ register: (...args) => plugin._health?.register(...args) }),
        patching: Object.freeze({
            patchMessageStore: () => plugin.patchMessageStore(),
            patchMessagesWrapComponent: () => plugin.patchMessagesWrapComponent(),
            resetShouldHideCache: () => plugin._resetShouldHideCache(),
            resetMessageFilterCache: () => { plugin._messageFilterCache = new WeakMap(); },
            resetMessagePatches: () => { plugin._storePatched = false; plugin._messagesWrapPatched = false; },
        }),
        dom: Object.freeze({
            hideElement: (...args) => plugin.hideElement(...args),
            registerHiddenElement: element => plugin.hiddenElements.add(element),
            unregisterHiddenElement: element => plugin.hiddenElements.delete(element),
        }),
    });
}

class MessageSurface {
    constructor(api) {
        this.api = api;
    }
    registerHealthChecks() {
        this.api.health.register(
            "messages",
            () => {
                if (!this.api.settings.messagesEnabled) return true;
                const els = document.querySelectorAll(_SEL.messageItemLi);
                let sample = 0;
                for (let i = 0; i < els.length && sample < 40; i++) {
                    sample++;
                    const info = this.api.identity.getMessageInfo(els[i]);
                    if (this.api.visibility.shouldHide(info?.authorId, info?.isSpammer)) return false;
                }
                return true;
            },
            () => {
                try {
                    this.api.patching.resetMessagePatches();
                    this.api.patching.resetShouldHideCache();
                    this.api.patching.resetMessageFilterCache();
                    this.api.patching.patchMessageStore();
                    this.api.patching.patchMessagesWrapComponent();
                } catch (error) { _recordPatchCatch("messages.repairFilteringPatches", this, error); }
            }
        );
    }

    hideSingleMention(el) {
        if (!el || el.dataset?.nmbMentionHidden === "true") return;
        let userId = el.dataset?.userId || this.api.identity.findUserId(el);
        if (!userId) {
            this.api.identity.walkFiberShallow(el, props => {
                if (userId) return;
                const candidate = props?.user?.id || props?.userId || props?.message?.author?.id || props?.mentionedUser?.id;
                if (candidate && this.api.visibility.isBlockedRelationship(candidate)) userId = candidate;
            });
        }
        if (!(userId && this.api.visibility.shouldHide(userId))) return;
        const messageRow = el.closest(_SEL.messageRow);
        if (messageRow) {
            this.api.dom.hideElement(messageRow, "fast-mention", userId);
            return;
        }
        el.dataset.nmbMentionHidden = "true";
        el.dataset.nmbMentionUserId = userId;
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("pointer-events", "none", "important");
        this.api.dom.registerHiddenElement(el);
    }
    hideMentionsEverywhere() {
        try {
            const scope = document.querySelector(_SEL.chatContent) || document;
            if (this.api.settings?.mentionsEnabled === false) return;
            const mentions = scope.querySelectorAll('[class*="mention"]:not([data-nmb-mention-hidden="true"])');
            for (const mention of mentions) {
                this.hideSingleMention(mention);
            }
        } catch (error) { _recordPatchCatch("messages.hideMentionsEverywhere", this, error); }
    }
    hideInboxBlockedItems() {
        try {
            if (this.api.settings?.inboxEnabled === false) return;
            const roots = document.querySelectorAll(
                '[data-list-id*="recent-mentions"], [data-list-id*="inbox"], [class*="recentMentions"], [class*="inboxList"], [class*="messagesPopout"]'
            );
            let budget = 400;
            for (const root of roots) {
                if (budget <= 0) break;
                const items = root.querySelectorAll('[data-list-item-id]:not([data-hidden-blocked="true"]), [class*="messageContainer"]:not([data-hidden-blocked="true"]), li:not([data-hidden-blocked="true"])');
                for (const item of items) {
                    if (--budget < 0) break;
                    const userId = this.api.identity.findUserId(item);
                    if (userId && this.api.visibility.shouldHide(userId)) {
                        this.api.dom.hideElement(item, "inbox-blocked", userId);
                    }
                }
            }
        } catch (error) { _recordPatchCatch("messages.hideInboxBlockedItems", this, error); }
    }
    restoreHiddenMention(el) {
        if (!el || el.dataset?.nmbMentionHidden !== "true") return;
        el.style.removeProperty("display");
        el.style.removeProperty("visibility");
        el.style.removeProperty("pointer-events");
        delete el.dataset.nmbMentionHidden;
        delete el.dataset.nmbMentionUserId;
        this.api.dom.unregisterHiddenElement(el);
    }
    promoteOrphanedMessages() {
        try {
            const rows = document.querySelectorAll(`${_SEL.messageItemLi}:not([data-hidden-blocked="true"]):not([data-nmb-ghost="true"])`);
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const immediatePrev = row.previousElementSibling;
                const immediatePrevIsHiddenSibling = !!immediatePrev
                    && (immediatePrev.dataset?.hiddenBlocked === "true" || immediatePrev.dataset?.nmbGhost === "true");
                if (immediatePrevIsHiddenSibling) {
                    this._promoteMessage(row);
                } else if (row.dataset?.nmbPromoted === "true") {
                    this.demoteMessage(row);
                }
            }
        } catch (error) { _recordPatchCatch("messages.promoteOrphanedMessages", this, error); }
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
        } catch (error) { _recordPatchCatch("messages.resolvePromotedMessageGroup", this, error); }
        li.style.setProperty("--nmb-promoted", "1");
    }
    demoteMessage(li) {
        if (!li) return;
        delete li.dataset.nmbPromoted;
        li.removeAttribute("data-nmb-promoted");
        delete li.dataset.nmbOrigGroupStart;
        li.removeAttribute("data-nmb-orig-group-start");
        li.style.removeProperty("--nmb-promoted");
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
            if (!hasVisible) this.api.dom.hideElement(divider, "orphan-divider");
        }
    }
}

function createReactionSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({
            get reactionsEnabled() { return !!plugin.settings?.places?.reactions; },
            get autoAdvanceEmptyReactorTabs() { return !!plugin.settings?.places?.reactions; },
        }),
        constants: Object.freeze({
            get REACTION_READ_CACHE_MAX_SIZE() { return plugin.constructor.REACTION_READ_CACHE_MAX_SIZE; },
            get REACTION_READ_CACHE_TTL_MS() { return plugin.constructor.REACTION_READ_CACHE_TTL_MS; },
            get REACTION_NETWORK_BATCH_BUDGET() { return plugin.constructor.REACTION_NETWORK_BATCH_BUDGET; },
            get REACTION_NETWORK_MIN_GAP_MS() { return plugin.constructor.REACTION_NETWORK_MIN_GAP_MS; },
            get REACTION_STORE_CHANGE_DEBOUNCE_MS() { return plugin.constructor.REACTION_STORE_CHANGE_DEBOUNCE_MS; },
            get REACTION_FIX_MIN_INTERVAL_MS() { return plugin.constructor.REACTION_FIX_MIN_INTERVAL_MS; },
            get REACTION_VIEWPORT_MARGIN_PX() { return plugin.constructor.REACTION_VIEWPORT_MARGIN_PX; },
            get REACTION_ZERO_CONFIRM_MS() { return plugin.constructor.REACTION_ZERO_CONFIRM_MS; },
            get REACTION_RATE_LIMIT_COOLDOWN_MS() { return plugin.constructor.REACTION_RATE_LIMIT_COOLDOWN_MS; },
            get TAB_COUNTS_PENDING_SENTINEL() { return plugin.constructor.TAB_COUNTS_PENDING_SENTINEL; },
            get STORE_NAMES() { return plugin.constructor.STORE_NAMES; },
        }),
        stores: Object.freeze({
            get ReactionsStore() { return plugin.modules.ReactionsStore; },
            set ReactionsStore(value) { plugin.modules.ReactionsStore = value; },
            get SelectedChannelStore() { return plugin.modules.SelectedChannelStore; },
            get MessageStore() { return plugin.modules.MessageStore; },
            getStore: (...args) => plugin._r.getStore(...args),
        }),
        identity: Object.freeze({
            findUserId: element => plugin.findUserId(element),
            findUsersByName: displayName => plugin._identity.findUsersByName(displayName),
        }),
        visibility: _surfaceUserVisibility(plugin),
        fiber: _surfaceFiberProps(plugin),
        observers: Object.freeze({ trackTransient: observer => plugin._trackTransientObserver(observer) }),
        watchers: Object.freeze({
            startMenuPortalObserver: () => plugin._startMenuPortalObserver(),
        }),
        cache: Object.freeze({
            map: (namespace, maxSize) => plugin._cacheManager.map(namespace, maxSize),
            set: (namespace, key, value) => plugin._cacheManager.set(namespace, key, value),
        }),
        resources: Object.freeze({
            timer: (...args) => plugin._resources.timer(...args),
            clearTimer: (...args) => plugin._resources.clearTimer(...args),
        }),
        lifecycle: _runningLifecycle(plugin),
        retry: _surfaceRetry(plugin, ["guardEnter","guardExit","schedule"]),
        patching: Object.freeze({
            after: (...args) => plugin.patchAfter(...args),
            safe: (...args) => plugin._patcher.safe(...args),
            warn: (...args) => plugin._patcher?._warn(...args),
            logFailure: (...args) => plugin._patcher?._logFail(...args),
        }),
        diagnostics: Object.freeze({ warn: (...args) => plugin.logger?.warn(...args) }),
        health: Object.freeze({ register: (...args) => plugin._health?.register(...args) }),
        coordination: Object.freeze({
            get scanInFlight() { return plugin.scanInFlight; },
            queueScan: (...args) => plugin.queueScan(...args),
        }),
    });
}
class ReactionSurface {
    constructor(api) {
        this.api = api;
        this.hiddenReactorRows = new Set;
        this.hiddenReactorRemoveBtns = new Set;
        this._reactorModalPassTimer = null;
        this._reactorModalPassFirstScheduledAt = null;
        this._reactionClickHandler = null;
        this._contextMenuHandler = null;
        this._contextMenuDelays = null;
        this._lastContextMessageId = null;
        this._lastContextMessageIdAt = 0;
    }
    registerHealthChecks() {
        this.api.health.register(
            "reactions",
            () => {
                if (!this.api.settings.reactionsEnabled) return true;
                try {
                    const containers = document.querySelectorAll(_SEL.reactorsContainers);
                    let sample = 0;
                    for (let c = 0; c < containers.length && sample < 15; c++) {
                        const container = containers[c];
                        if (container.offsetParent === null) continue;
                        const rows = container.querySelectorAll(_SEL.reactorClickable);
                        for (const row of rows) {
                            if (row.dataset?.nmbReactorHidden === "true") continue;
                            sample++;
                            let userId = this.api.identity.findUserId(row);
                            if (!userId) userId = this.resolveReactorIdByName(row);
                            if (userId && this.api.visibility.shouldHide(userId)) return false;
                            if (sample >= 15) break;
                        }
                    }
                } catch (error) { _recordPatchCatch("reactions.healthCheck", this, error); }
                return true;
            },
            () => {
                if (this.api.coordination.scanInFlight) return;
                try { this.api.coordination.queueScan(); } catch (error) { _recordPatchCatch("reactions.healthRescan", this, error); }
            }
        );
    }
    patchEarly() {
        this.api.patching.safe('patchReactions', () => this.patchReactions());
        this.api.patching.safe('patchReactionRateLimitGuard', () => this._installReactionRateLimitGuard());
    }
    start() {
        this.api.patching.safe('startReactionClickWatcher', () => this._startReactionClickWatcher());
    }
    scan() {
        this.fixReactionCounts();
        this.hideBlockedReactors();
    }
    stop() {
        this._reactorNameCache = null;
        this._reactionReadCache = null;
        this._reactionZeroCandidates = null;
        if (this._fixReactionCountsThrottleTimer) {
            this.api.resources.clearTimer('reactionCounts', this._fixReactionCountsThrottleTimer);
            this._fixReactionCountsThrottleTimer = null;
        }
        this._lastFixReactionCountsAt = 0;
        this._reactionRateLimitedUntil = 0;
        if (this._reactionRateLimitHandler) {
            window.removeEventListener("unhandledrejection", this._reactionRateLimitHandler);
            this._reactionRateLimitHandler = null;
        }
        if (this._reactionStoreChangeDebounceTimer) {
            this.api.resources.clearTimer('reactionCounts', this._reactionStoreChangeDebounceTimer);
            this._reactionStoreChangeDebounceTimer = null;
        }
        if (this._reactionStoreChangeHandler) {
            try { this.api.stores.ReactionsStore?.removeChangeListener(this._reactionStoreChangeHandler); } catch (error) { _recordPatchCatch("ReactionSurface.stop.L4770", null, error); }
            this._reactionStoreChangeHandler = null;
        }
        this.api.resources.clearTimer('reactorId', this._reactorIdPendingRetryTimer);
        this._reactorIdPendingRetryTimer = null;
        if (this._reactionClickHandler) {
            document.removeEventListener("click", this._reactionClickHandler, true);
            this._reactionClickHandler = null;
        }
        if (this._contextMenuHandler) {
            document.removeEventListener("contextmenu", this._contextMenuHandler, true);
            document.removeEventListener("click", this._contextMenuHandler, true);
            this._contextMenuHandler = null;
        }
        this._lastContextMessageId = null;
        this._lastContextMessageIdAt = 0;
        this._reactionsPatched = false;
        if (this._reactorModalPassTimer) {
            this.api.resources.clearTimer('reactorModalPass', this._reactorModalPassTimer);
            this._reactorModalPassTimer = null;
        }
        this._reactorModalPassFirstScheduledAt = null;
    }
    _startReactionClickWatcher() {
        if (this._reactionClickHandler) return;
        this._reactionClickHandler = event => {
            const removeBtn = event.target.closest?.(_SEL.reactionRemove);
            if (removeBtn) {
                if (removeBtn.dataset?.nmbReactorRemoveHidden === "true") {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    return;
                }
                const entry = this._getReactorEntryRoot(removeBtn);
                const clickable = entry?.querySelector(_SEL.reactorClickable);
                const userId = this.resolveReactorIdFromRemoveButton(removeBtn) || (clickable ? this.api.identity.findUserId(clickable) || this.resolveReactorIdByName(clickable) : null);
                if (entry?.dataset?.nmbReactorHidden === "true" || userId && this.api.visibility.shouldHide(userId)) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    return;
                }
            }
            const reactionRow = event.target.closest?.(_SEL.reactionInner);
            const isModalTrigger = event.target.closest?.('[role="dialog"], [class*="reactionInner"], [class*="reactorsContainer_"], [class*="reactors_"]');
            if (!reactionRow && !isModalTrigger) return;
            const messageRow = event.target.closest?.(_SEL.messageRow);
            const idMatch = messageRow?.id?.match(/chat-messages-(?:\d+-)?(\d+)$/);
            if (idMatch) {
                this._lastContextMessageId = idMatch[1];
                this._lastContextMessageIdAt = Date.now();
            }
            if (reactionRow && !isModalTrigger?.matches?.('[role="dialog"]')) {
                this.fixReactionCounts();
                return;
            }
            this.scheduleReactorModalPass();
        };
        document.addEventListener("click", this._reactionClickHandler, true);
        this._startContextMenuWatcher();
        this.api.watchers.startMenuPortalObserver();
    }
    _startContextMenuWatcher() {
        if (this._contextMenuHandler) return;
        const resolveMessageId = fromEl => {
            const messageRow = fromEl?.closest?.(_SEL.messageRow);
            if (!messageRow) return null;
            const idMatch = messageRow.id?.match(/chat-messages-(?:\d+-)?(\d+)$/);
            return idMatch ? idMatch[1] : messageRow.id || null;
        };
        const isRelevantClick = event => {
            if (event.type === "contextmenu") return true;
            const target = event.target;
            if (target?.closest?.(_SEL.messageRow)) return true;
            if (target?.closest?.('[aria-haspopup="menu"], [aria-haspopup="true"], [role="menuitem"], [class*="buttonContainer"]')) return true;
            return false;
        };
        const capture = event => {
            if (!isRelevantClick(event)) return;
            const resolved = resolveMessageId(event.target);
            if (resolved) this._lastContextMessageId = resolved;
            const delays = this._contextMenuDelays || (this._contextMenuDelays = [ 50, 200, 450 ]);
            for (let d = 0; d < delays.length; d++) {
                this.api.resources.timer('contextMenu', () => {
                    try {
                        if (this.api.settings.reactionsEnabled) this.hideViewReactionsMenuItem();
                    } catch (error) { _recordPatchCatch("reactions.contextMenuRetry", this, error); }
                }, delays[d]);
            }
        };
        this._contextMenuHandler = capture;
        document.addEventListener("contextmenu", capture, true);
        document.addEventListener("click", capture, true);
    }
    watchReactorsModalContent(modalRoot) {
        try {
            if (!modalRoot || modalRoot.dataset?.nmbContentWatched === "true") return;
            modalRoot.dataset.nmbContentWatched = "true";
            const observer = new MutationObserver(() => {
                if (!document.contains(modalRoot)) {
                    dispose();
                    return;
                }
                this.scheduleReactorModalPass();
            });
            const dispose = this.api.observers.trackTransient(observer);
            observer.observe(modalRoot, {
                childList: true,
                subtree: true
            });
            this.api.resources.timer('reactorsModalWatch', dispose, 15e3);
            this.scheduleReactorModalPass();
        } catch (error) { _recordPatchCatch("reactions.reactorModalContentWatch", this, error); }
    }
    scheduleReactorModalPass() {
        if (!this.api.settings.reactionsEnabled) return;
        const now = Date.now();
        if (!this._reactorModalPassFirstScheduledAt) this._reactorModalPassFirstScheduledAt = now;
        this.api.resources.clearTimer('reactorModalPass', this._reactorModalPassTimer);
        const elapsed = now - this._reactorModalPassFirstScheduledAt;
        const maxWaitMs = 250;
        const delay = elapsed >= maxWaitMs ? 0 : 50;
        this._reactorModalPassTimer = this.api.resources.timer('reactorModalPass', () => {
            this._reactorModalPassTimer = null;
            this._reactorModalPassFirstScheduledAt = null;
            if (!this.api.lifecycle.isRunning) return;
            try {
                this.hideBlockedReactors();
            } catch (error) { _recordPatchCatch("reactions.reactorModalPass", this, error); }
        }, delay);
    }
    _rememberReactorsModalMessageId(modal, id) {
        modal.dataset.nmbMessageId = id;
        modal.dataset.nmbMessageIdReliable = "true";
        return id;
    }
    _resolveReactorsModalMessageId(modal) {
        const FRESH_CLICK_WINDOW_MS = 4000;
        const freshClickId = (this._lastContextMessageId
            && this._lastContextMessageIdAt
            && (Date.now() - this._lastContextMessageIdAt) < FRESH_CLICK_WINDOW_MS)
            ? this._lastContextMessageId
            : null;
        if (!modal) return freshClickId || this._lastContextMessageId;
        if (modal.dataset?.nmbMessageId && modal.dataset?.nmbMessageIdReliable === "true") {
            return modal.dataset.nmbMessageId;
        }
        let found = null;
        try {
            this.api.fiber.walkProps(modal, props => {
                if (found) return;
                for (const c of [ props?.messageId, props?.message?.id, props?.message_id ]) {
                    if (c && /^\d{17,20}$/.test(String(c))) {
                        found = String(c);
                        return;
                    }
                }
            }, 12);
        } catch (error) { _recordPatchCatch("ReactionSurface._resolveReactorsModalMessageId.fallback1", this, error); }
        if (found) {
            return this._rememberReactorsModalMessageId(modal, found);
        }
        if (freshClickId) {
            return this._rememberReactorsModalMessageId(modal, freshClickId);
        }
        let correlated = null;
        try {
            const anchor = modal.closest?.(_SEL.messageItem)
                || document.querySelector('[aria-expanded="true"][class*="reactionInner"]')?.closest(_SEL.messageItem);
            if (anchor) {
                const idMatch = anchor.id?.match(/chat-messages-(?:\d+-)?(\d+)$/);
                if (idMatch) correlated = idMatch[1];
            }
        } catch (error) { _recordPatchCatch("ReactionSurface._resolveReactorsModalMessageId.fallback2", this, error); }
        if (correlated) {
            return this._rememberReactorsModalMessageId(modal, correlated);
        }
        const bars = document.querySelectorAll('[id^="message-reactions-"]');
        for (const bar of bars) {
            if (bar.dataset?.nmbZeroReaction === "true") continue;
            const id = bar.id.match(/message-reactions-(\d+)$/)?.[1];
            if (id) {
                found = id;
                break;
            }
        }
        return found || this._lastContextMessageId;
    }
    _filterReactionUsers(result) {
        if (!result || !this.api.settings.reactionsEnabled) return result;
        if (result instanceof Map) {
            let hasBlocked = false;
            for (const [key, value] of result) {
                const userId = value?.id ?? (/^\d{17,20}$/.test(String(key)) ? String(key) : null);
                if (userId && this.api.visibility.shouldHide(userId)) { hasBlocked = true; break; }
            }
            if (!hasBlocked) return result;
            const filtered = new Map;
            for (const [key, value] of result) {
                const userId = value?.id ?? (/^\d{17,20}$/.test(String(key)) ? String(key) : null);
                if (userId && this.api.visibility.shouldHide(userId)) continue;
                filtered.set(key, value);
            }
            return filtered;
        }
        if (Array.isArray(result)) {
            const hasBlocked = result.some(user => user?.id && this.api.visibility.shouldHide(user.id));
            if (!hasBlocked) return result;
            return result.filter(user => {
                const userId = user?.id;
                return !(userId && this.api.visibility.shouldHide(userId));
            });
        }
        return result;
    }
    _reactionUsersSize(users) {
        if (users instanceof Map) return users.size;
        if (Array.isArray(users)) return users.length;
        return 0;
    }
    _reactionUsersComputable(users) {
        return users instanceof Map || Array.isArray(users);
    }
    _warnUncomputableReactions(emoji, reason) {
        const now = Date.now();
        if (this._lastUncomputableReactionsWarnAt && now - this._lastUncomputableReactionsWarnAt < 60000) return;
        this._lastUncomputableReactionsWarnAt = now;
        const emojiDesc = emoji && typeof emoji === "object" ? `${emoji.name || "?"}${emoji.id ? `:${emoji.id}` : " (unicode, id:null)"}` : String(emoji);
        this.api.patching.warn("_getFilteredReactions", new Error(`getReactions returned an unrecognized shape or threw for emoji ${emojiDesc} (${reason}) - treating as not-computable rather than 0 to avoid hiding legitimate reactions. This warning is throttled to once/60s.`));
    }
    _reactionReadCacheKey(channelId, messageId, emoji, burstType) {
        const emojiKey = emoji && typeof emoji === "object" ? (emoji.id || emoji.name || "?") : String(emoji);
        return `${channelId}:${messageId}:${emojiKey}:${burstType}`;
    }
    _getFilteredReactions(store, channelId, messageId, emoji, burstType = 0, opts = null) {
        if (!store || !channelId || !messageId) return null;
        const now = Date.now();
        const cacheKey = this._reactionReadCacheKey(channelId, messageId, emoji, burstType);
        this._reactionReadCache = this.api.cache.map("reactions.read", this.api.constants.REACTION_READ_CACHE_MAX_SIZE);
        const cached = this._reactionReadCache.get(cacheKey);
        if (cached && now - cached.at < this.api.constants.REACTION_READ_CACHE_TTL_MS) return cached.users;
        if (opts?.rateLimited) {
            if (this._reactionRateLimitedUntil && now < this._reactionRateLimitedUntil) {
                return cached ? cached.users : undefined;
            }
            if (this._reactionNetworkBudgetRemaining == null) {
                this._reactionNetworkBudgetRemaining = this.api.constants.REACTION_NETWORK_BATCH_BUDGET;
            }
            if (this._reactionNetworkBudgetRemaining <= 0) {
                return cached ? cached.users : undefined;
            }
            const lastNetworkRead = this._lastReactionNetworkReadAt || 0;
            if (now - lastNetworkRead < this.api.constants.REACTION_NETWORK_MIN_GAP_MS) {
                return cached ? cached.users : undefined;
            }
            this._reactionNetworkBudgetRemaining--;
            this._lastReactionNetworkReadAt = now;
        }
        let users;
        try {
            users = this._filterReactionUsers(store.getReactions(channelId, messageId, emoji, undefined, burstType));
            if (this._reactionUsersSize(users) === 0) {
                const burstUsers = this._filterReactionUsers(store.getReactions(channelId, messageId, emoji, undefined, 1));
                if (this._reactionUsersSize(burstUsers) > 0) users = burstUsers;
            }
            if (!this._reactionUsersComputable(users)) this._warnUncomputableReactions(emoji, "unrecognized-shape");
        } catch (err) {
            this._warnUncomputableReactions(emoji, err?.message || String(err));
            users = null;
        }
        this.api.cache.set("reactions.read", cacheKey, { users, at: now });
        return users;
    }
    _countReactorClickables(el) {
        if (!el?.querySelectorAll) return 0;
        return el.querySelectorAll(_SEL.reactorClickable).length;
    }
    _getReactorEntryRoot(node) {
        if (!node) return null;
        const container = node.closest(_SEL.reactorsContainers);
        if (!container) return node;
        let el = node.matches?.(_SEL.reactorClickable) ? node : node.parentElement;
        let best = node.matches?.(_SEL.reactorClickable) ? node : null;
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
        const removeSel = _SEL.reactionRemove;
        entry.querySelectorAll(removeSel).forEach(btn => {
            if (btn.dataset?.nmbReactorRemoveHidden !== "true") btn.dataset.nmbReactorRemoveHidden = "true";
            this.hiddenReactorRemoveBtns.add(btn);
        });
    }
    _hideReactorEntry(row) {
        if (!row) return;
        if (row.dataset?.nmbReactorHidden !== "true") row.dataset.nmbReactorHidden = "true";
        this.hiddenReactorRows.add(row);
        const entry = this._getReactorEntryRoot(row);
        if (entry && entry !== row && this._countReactorClickables(entry) === 1) {
            if (entry.dataset?.nmbReactorHidden !== "true") entry.dataset.nmbReactorHidden = "true";
            this.hiddenReactorRows.add(entry);
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
        const fromFiber = this.api.identity.findUserId(btn);
        if (fromFiber) return fromFiber;
        const label = btn.getAttribute("aria-label") || btn.getAttribute("title") || "";
        const match = label.match(/(?:from|de|for|para)\s+(.+?)(?:[''']s reaction|$)/i) || label.match(/(?:Remove|Remover).*?,\s*(.+)$/i);
        const displayName = (match?.[1] || "").trim();
        if (!displayName) return null;
        const matches = this.api.identity.findUsersByName(displayName);
        return matches.length === 1 ? matches[0].id : null;
    }
    _getRawReactionUserIds(channelId, messageId, emoji, distinguishUncomputable = false) {
        const store = this.api.stores.ReactionsStore;
        if (!store || !channelId || !messageId || !emoji?.name) return distinguishUncomputable ? null : [];
        const ids = [];
        let sawComputable = false;
        try {
            for (const burst of [ 0, 1 ]) {
                const raw = store.getReactions(channelId, messageId, emoji, undefined, burst);
                if (raw instanceof Map) {
                    sawComputable = true;
                    for (const [key, val] of raw) {
                        const id = /^\d{17,20}$/.test(String(key)) ? String(key) : val?.id;
                        if (id) ids.push(String(id));
                    }
                } else if (Array.isArray(raw)) {
                    sawComputable = true;
                    for (const u of raw) if (u?.id) ids.push(String(u.id));
                }
            }
        } catch (_) {
            if (distinguishUncomputable) return null;
        }
        if (distinguishUncomputable && !sawComputable) return null;
        return [ ...new Set(ids) ];
    }
    _readEmojiFromTab(tab) {
        const emojiImg = tab?.querySelector?.('img[class*="emoji"]');
        if (!emojiImg) return null;
        const name = emojiImg.getAttribute("alt") || emojiImg.getAttribute("data-name");
        let id = null;
        try {
            this.api.fiber.walkProps(emojiImg, props => {
                if (id) return;
                const e = props?.emoji;
                if (e && (e.name === name || !name) && e.id) id = String(e.id);
            }, 8);
        } catch (error) { _recordPatchCatch("ReactionSurface._readEmojiFromTab.fallback1", this, error); }
        const src = emojiImg.getAttribute("src") || "";
        if (!id) {
            const m = src.match(/\/emojis\/(\d{17,20})\./);
            if (m) id = m[1];
        }
        const nameLooksUnicode = !!name && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(name);
        const looksCustomPending = !id && !!name && !nameLooksUnicode;
        return { id, name, emojiImg, idPending: looksCustomPending };
    }
    _getActiveModalEmoji(modal) {
        const activeTab = modal?.querySelector?.('[class*="reactionSelected_"][aria-selected="true"]');
        if (!activeTab) return null;
        const emoji = this._readEmojiFromTab(activeTab);
        if (!emoji) return null;
        return { id: emoji.id, name: emoji.name, idPending: emoji.idPending };
    }
    _hideGhostReactorSlots(container, messageId, channelId, emoji) {
        if (!container || !messageId || !channelId || !emoji?.name) return;
        const blockedIds = this._getRawReactionUserIds(channelId, messageId, emoji).filter(id => this.api.visibility.shouldHide(id));
        if (!blockedIds.length) return;
        const removeSel = _SEL.reactionRemove;
        container.querySelectorAll(removeSel).forEach(btn => {
            if (btn.dataset?.nmbReactorRemoveHidden === "true") return;
            const userId = this.resolveReactorIdFromRemoveButton(btn);
            if (userId && this.api.visibility.shouldHide(userId)) {
                btn.dataset.nmbReactorRemoveHidden = "true";
                this.hiddenReactorRemoveBtns.add(btn);
                const entry = this._getReactorEntryRoot(btn);
                if (entry && this._countReactorClickables(entry) <= 1) {
                    entry.dataset.nmbReactorHidden = "true";
                    this.hiddenReactorRows.add(entry);
                }
                return;
            }
            const entry = this._getReactorEntryRoot(btn);
            if (!entry) return;
            const clickable = entry.querySelector(_SEL.reactorClickable);
            const nameEl = clickable?.querySelector(_SEL.reactorDisplayName);
            const avatar = clickable?.querySelector('img[src*="/avatars/"]');
            const hasIdentity = !!(nameEl?.textContent || "").trim() || !!avatar;
            const clickableHidden = clickable?.dataset?.nmbReactorHidden === "true";
            if (!clickable || clickableHidden && !hasIdentity) {
                btn.dataset.nmbReactorRemoveHidden = "true";
                this.hiddenReactorRemoveBtns.add(btn);
                if (this._countReactorClickables(entry) <= 1) {
                    entry.dataset.nmbReactorHidden = "true";
                    this.hiddenReactorRows.add(entry);
                }
            }
        });
    }
    _cleanupReactorModalLoading(container) {
        if (!container) return;
        const rows = container.querySelectorAll(_SEL.reactorClickable);
        rows.forEach(row => {
            if (row.dataset?.nmbReactorHidden === "true") return;
            const nameEl = row.querySelector(_SEL.reactorDisplayName);
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
        container.querySelectorAll('[class*="loadingMore"], [class*="loading_"], [class*="spinner_"], [class*="spinner__"], [class*="wandering"]').forEach(el => {
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
            const rows = container.querySelectorAll(_SEL.reactionInner);
            if (!rows.length) return false;
            const store = this.api.stores.ReactionsStore;
            const SelectedChannelStore = this.api.stores.SelectedChannelStore;
            const channelId = SelectedChannelStore?.getChannelId?.();
            if (!store || typeof store.getReactions !== "function" || !channelId) {
                return container.dataset.nmbZeroReaction !== "true";
            }
            for (const row of rows) {
                if (row.dataset.nmbZeroReaction === "true") continue;
                const emojiImg = row.querySelector('img.emoji, img[class*="emoji"]');
                const emojiName = emojiImg?.getAttribute("data-name");
                if (!emojiName) return true;
                const emojiId = emojiImg.getAttribute("data-id") || null;
                let users;
                try {
                    users = this._getFilteredReactions(store, channelId, messageId, { id: emojiId, name: emojiName }, 0, { rateLimited: true });
                } catch (_) {
                    return true;
                }
                if (!this._reactionUsersComputable(users)) return true;
                if (this._reactionUsersSize(users) > 0) return true;
            }
            return false;
        } catch (_) {
            return true;
        }
    }
    _REACTION_MENU_ITEM_IDS() {
        return [ "message-actions-reactions", "message-remove-emoji-reactions", "message-remove-reactions", "message-reactions" ];
    }
    hideViewReactionsMenuItem() {
        const focusedRow = document.querySelector(`${_SEL.messageItemLi}[class*="contextMenuOpen"], ${_SEL.messageItemLi}[aria-expanded="true"]`);
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
    watchContextMenuContent(menuRoot) {
        try {
            if (!menuRoot || menuRoot.dataset?.nmbMenuWatched === "true") return;
            menuRoot.dataset.nmbMenuWatched = "true";
            let applyTimer = null;
            const apply = () => {
                try { this._fixReactionMenuItems(this._lastContextMessageId); }
                catch (error) { _recordPatchCatch("reactions.contextMenuApply", this, error); }
            };
            const applyDebounced = () => {
                if (applyTimer) return;
                applyTimer = this.api.resources.timer('contextMenuWatch', () => { applyTimer = null; apply(); }, 60);
            };
            apply();
            const observer = new MutationObserver(() => {
                if (!document.contains(menuRoot)) { if (applyTimer) { this.api.resources.clearTimer('contextMenuWatch', applyTimer); applyTimer = null; } dispose(); return; }
                applyDebounced();
            });
            const dispose = this.api.observers.trackTransient(observer);
            observer.observe(menuRoot, { childList: true, subtree: true });
            this.api.resources.timer('contextMenuWatch', dispose, 1e4);
        } catch (error) { _recordPatchCatch("reactions.contextMenuWatch", this, error); }
    }
    _messageHasVisibleReactions(channelId, messageId) {
        if (!channelId || !messageId) return true;
        try {
            const msg = this.api.stores.MessageStore?.getMessage?.(channelId, messageId);
            const reactions = msg?.reactions;
            if (!Array.isArray(reactions) || reactions.length === 0) return false;
            const store = this.api.stores.ReactionsStore;
            if (!store || typeof store.getReactions !== "function") return true;
            for (const r of reactions) {
                const emoji = r?.emoji;
                if (!emoji) continue;
                const users = this._getFilteredReactions(store, channelId, messageId, emoji, r.burst_colors?.length ? 1 : 0);
                if (!this._reactionUsersComputable(users)) return true;
                if (this._reactionUsersSize(users) > 0) return true;
            }
            return false;
        } catch (_) {
            return true;
        }
    }
    _fixReactionMenuItems(messageId) {
        if (!this.api.settings.reactionsEnabled || !messageId) return;
        const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
        if (!channelId) return;
        if (this._messageHasVisibleReactions(channelId, messageId)) return;
        for (const itemId of this._REACTION_MENU_ITEM_IDS()) {
            const item = document.getElementById(itemId);
            if (item && item.dataset?.nmbHideViewReactions !== "true") item.dataset.nmbHideViewReactions = "true";
        }
    }
    fastHideReactionsFromMutations(mutations) {
        const reactionSel = '[id^="message-reactions-"], [class*="reactionInner"]';
        let found = false;
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                const tag = node.tagName;
                if (tag === 'LINK' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'META' || tag === 'TITLE') continue;
                const isReactionNode = node.matches?.(reactionSel) || node.querySelector?.(reactionSel);
                if (isReactionNode) {
                    found = true;
                }
            }
        }
        if (!found) return;
        this.fixReactionCounts();
        this.hideBlockedReactors();
    }
    _installReactionRateLimitGuard() {
        if (this._reactionRateLimitHandler) return;
        this._reactionRateLimitHandler = (event) => {
            try {
                const reason = event?.reason;
                const status = reason?.status ?? reason?.response?.status ?? reason?.code;
                const url = reason?.request?.url || reason?.url || reason?.message || "";
                const isReactionsRateLimit = status === 429 && typeof url === "string" && url.includes("/reactions/");
                if (!isReactionsRateLimit) return;
                this._reactionRateLimitedUntil = Date.now() + this.api.constants.REACTION_RATE_LIMIT_COOLDOWN_MS;
                this._reactionNetworkBudgetRemaining = 0;
                if (this._fixReactionCountsThrottleTimer) {
                    this.api.resources.clearTimer('reactionCounts', this._fixReactionCountsThrottleTimer);
                }
                this._scheduleReactionCountRefresh(this.api.constants.REACTION_RATE_LIMIT_COOLDOWN_MS);
            } catch (error) { _recordPatchCatch("reactions.rateLimitHandler", this, error); }
        };
        window.addEventListener("unhandledrejection", this._reactionRateLimitHandler);
    }
    patchReactions(attempt = 0) {
        if (!this.api.retry.guardEnter("patchReactions", attempt)) return;
        const store = this.api.stores.ReactionsStore;
        if (!store || typeof store.getReactions !== "function") {
            if (attempt > 4) {
                this.api.retry.guardExit("patchReactions");
                this.api.patching.logFailure("patchReactions", new Error("ran out of attempts - ReactionsStore.getReactions was not found; Discord likely renamed something and blocked-user reaction filtering will not work until the plugin is updated"));
                return;
            }
            this.api.retry.schedule(() => {
                const getStore = (...names) => this.api.stores.getStore(...names);
                this.api.stores.ReactionsStore = getStore(...this.api.constants.STORE_NAMES.REACTIONS);
                this.patchReactions(attempt + 1);
            }, 2e3);
            return;
        }
        if (!this._reactionsPatched) {
            const installed = this.api.patching.after(store, "getReactions", (_, __, result) => {
                return this._filterReactionUsers(result);
            });
            if (!installed) {
                if (attempt < 5) this.api.retry.schedule(() => this.patchReactions(attempt + 1), 2e3);
                else {
                    this.api.patching.logFailure("patchReactions", new Error("ReactionsStore.getReactions patch failed after several attempts"));
                    this.api.retry.guardExit("patchReactions");
                }
                return;
            }
            this._reactionsPatched = true;
        }
        if (!this._reactionStoreChangeHandler && typeof store.addChangeListener === "function") {
            this._reactionStoreChangeHandler = () => {
                if (this._reactionStoreChangeDebounceTimer) return;
                this._reactionStoreChangeDebounceTimer = this.api.resources.timer('reactionCounts', () => {
                    this._reactionStoreChangeDebounceTimer = null;
                    this._reactionReadCache?.clear();
                    if (this.api.lifecycle.isRunning && this.api.settings.reactionsEnabled) this.fixReactionCounts();
                }, this.api.constants.REACTION_STORE_CHANGE_DEBOUNCE_MS);
            };
            try { store.addChangeListener(this._reactionStoreChangeHandler); }
            catch (error) {
                try { store.removeChangeListener?.(this._reactionStoreChangeHandler); }
                catch (cleanupError) { _recordPatchCatch("reactions.removeFailedStoreListener", this, cleanupError); }
                this._reactionStoreChangeHandler = null;
                _recordPatchCatch("reactions.addStoreListener", this, error);
                if (attempt < 5) {
                    this.api.retry.schedule(() => this.patchReactions(attempt + 1), 2e3);
                    return;
                }
                this.api.patching.warn("patchReactions", new Error("failed to register ReactionsStore change listener after several attempts"));
            }
        }
        this.api.retry.guardExit("patchReactions");
    }
    _scheduleReactionCountRefresh(delay) {
        this._fixReactionCountsThrottleTimer = this.api.resources.timer('reactionCounts', () => {
            this._fixReactionCountsThrottleTimer = null;
            if (this.api.lifecycle.isRunning) this._fixReactionCountsNow();
        }, delay);
    }
    fixReactionCounts() {
        if (this._fixReactionCountsPending) return;
        this._fixReactionCountsPending = true;
        requestAnimationFrame(() => {
            this._fixReactionCountsPending = false;
            if (!this.api.lifecycle.isRunning) return;
            const now = Date.now();
            const minInterval = this.api.constants.REACTION_FIX_MIN_INTERVAL_MS;
            const lastRun = this._lastFixReactionCountsAt || 0;
            if (now - lastRun < minInterval) {
                if (this._fixReactionCountsThrottleTimer) return;
                this._scheduleReactionCountRefresh(minInterval - (now - lastRun));
                return;
            }
            this._fixReactionCountsNow();
        });
    }
    _isNearViewport(el, marginPx) {
        try {
            const rect = el.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight;
            return rect.bottom >= -marginPx && rect.top <= vh + marginPx;
        } catch (_) {
            return true;
        }
    }
    _updateReactionCountDisplay(countEl, realCount, displayedCount) {
        if (Number.isFinite(displayedCount) && realCount !== displayedCount) {
            countEl.setAttribute("data-nmb-real-count", String(realCount));
            countEl.dataset.nmbCountFixed = "true";
            countEl.setAttribute("aria-hidden", "true");
        } else if (countEl.dataset?.nmbCountFixed === "true") {
            delete countEl.dataset.nmbCountFixed;
            countEl.removeAttribute("data-nmb-real-count");
            countEl.removeAttribute("aria-hidden");
        }
    }
    _updateReactionCountRow(row, messageId, store, channelId) {
        const wrapper = row.closest('[class*="reaction_"]') || row.parentElement;
        const emojiImg = row.querySelector('img.emoji, img[class*="emoji"]');
        const countEl = row.querySelector('[class*="reactionCount"]');
        if (!emojiImg || !countEl) return "unavailable";
        const emojiName = emojiImg.getAttribute("data-name");
        if (!emojiName) return "unavailable";
        const emojiId = emojiImg.getAttribute("data-id") || null;
        const displayedCount = parseInt(countEl.textContent, 10);
        if (!Number.isFinite(displayedCount)) return "unavailable";
        let users;
        try {
            users = this._getFilteredReactions(store, channelId, messageId, { id: emojiId, name: emojiName }, 0, { rateLimited: true });
        } catch (_) {
            return "unavailable";
        }
        if (!this._reactionUsersComputable(users)) return "pending";
        const realCount = this._reactionUsersSize(users);
        const zeroKey = `${messageId}:${emojiId || emojiName}`;
        const now = Date.now();
        const firstSeenZeroAt = this._reactionZeroCandidates.get(zeroKey);
        const state = this._getReactionVisibilityState(realCount, firstSeenZeroAt, now);
        if (realCount <= 0 && !firstSeenZeroAt) {
            if (this._reactionZeroCandidates.size >= 500 && !this._reactionZeroCandidates.has(zeroKey)) {
                this._reactionZeroCandidates.delete(this._reactionZeroCandidates.keys().next().value);
            }
            this._reactionZeroCandidates.set(zeroKey, now);
        }
        if (state === "pending") return state;
        if (state === "visible" && this._reactionZeroCandidates.size) this._reactionZeroCandidates.delete(zeroKey);
        this._applyReactionRowVisibility(row, wrapper, countEl, realCount, displayedCount, state);
        return state;
    }
    _getReactionVisibilityState(realCount, firstSeenZeroAt, now) {
        if (realCount <= 0) {
            const pending = !firstSeenZeroAt || now - firstSeenZeroAt < this.api.constants.REACTION_ZERO_CONFIRM_MS;
            return pending ? "pending" : "hidden";
        }
        return "visible";
    }
    _applyReactionRowVisibility(row, wrapper, countEl, realCount, displayedCount, state) {
        if (state === "hidden") {
            if (row.dataset.nmbZeroReaction !== "true") row.dataset.nmbZeroReaction = "true";
            if (wrapper && wrapper.dataset.nmbZeroReaction !== "true") wrapper.dataset.nmbZeroReaction = "true";
            return;
        }
        if (row.dataset?.nmbZeroReaction === "true") delete row.dataset.nmbZeroReaction;
        if (wrapper && wrapper.dataset?.nmbZeroReaction === "true") delete wrapper.dataset.nmbZeroReaction;
        this._updateReactionCountDisplay(countEl, realCount, displayedCount);
    }
    _fixReactionCountsNow() {
        this._fixReactionCountsPending = false;
        this._lastFixReactionCountsAt = Date.now();
        const store = this.api.stores.ReactionsStore;
        if (!store || typeof store.getReactions !== "function") return;
        const SelectedChannelStore = this.api.stores.SelectedChannelStore;
        const channelId = SelectedChannelStore?.getChannelId?.();
        if (!channelId) return;
        if (!this._reactionZeroCandidates) this._reactionZeroCandidates = new Map();
        this._reactionNetworkBudgetRemaining = this.api.constants.REACTION_NETWORK_BATCH_BUDGET;
        const allContainers = document.querySelectorAll('[id^="message-reactions-"]');
        const containers = [];
        for (let i = 0; i < allContainers.length; i++) {
            if (this._isNearViewport(allContainers[i], this.api.constants.REACTION_VIEWPORT_MARGIN_PX)) containers.push(allContainers[i]);
        }
        for (let c = 0; c < containers.length; c++) {
            const container = containers[c];
            const messageIdMatch = container.id.match(/message-reactions-(\d+)$/);
            if (!messageIdMatch) continue;
            const messageId = messageIdMatch[1];
            const rows = container.querySelectorAll(_SEL.reactionInner);
            let visibleReactionCount = 0;
            for (let r = 0; r < rows.length; r++) {
                const state = this._updateReactionCountRow(rows[r], messageId, store, channelId);
                if (state === "visible" || state === "pending") visibleReactionCount++;
            }
            if (rows.length > 0 && visibleReactionCount === 0) {
                if (container.dataset.nmbZeroReaction !== "true") container.dataset.nmbZeroReaction = "true";
            } else if (container.dataset?.nmbZeroReaction === "true") {
                delete container.dataset.nmbZeroReaction;
            }
        }
    }
    _getBlockedReactorData(channelId, messageId, emoji) {
        let blockedIdSet = null;
        let reactionDataComputable = true;
        let idPending = false;
        if (emoji?.idPending) {
            reactionDataComputable = false;
            idPending = true;
        } else if (messageId && channelId && emoji) {
            try {
                const rawUsers = this._getRawReactionUserIds(channelId, messageId, emoji, true);
                if (rawUsers === null) {
                    reactionDataComputable = false;
                } else {
                    blockedIdSet = new Set(rawUsers.filter(id => this.api.visibility.shouldHide(id)));
                }
            } catch (_) {
                reactionDataComputable = false;
            }
        }
        return { blockedIdSet, reactionDataComputable, idPending };
    }
    _countVisibleReactors(rows, blockedIdSet) {
        let visibleRemaining = 0;
        let unresolvedCount = 0;
        rows.forEach(row => {
            if (row.dataset?.nmbReactorHidden === "true") return;
            let userId = this.api.identity.findUserId(row);
            if (!userId) userId = this.resolveReactorIdByName(row);
            const isBlocked = userId
                ? (blockedIdSet ? blockedIdSet.has(userId) : this.api.visibility.shouldHide(userId))
                : false;
            if (!userId && !blockedIdSet) {
                unresolvedCount++;
                return;
            }
            if (isBlocked) {
                this._hideReactorEntry(row);
            } else {
                visibleRemaining++;
            }
        });
        return { visibleRemaining, unresolvedCount };
    }
    _updateReactorModalEmptyState(container, modal, activeTab, allTabs, isEmpty) {
        if (isEmpty) {
            if (activeTab && activeTab.dataset.nmbTabHidden !== "true") activeTab.dataset.nmbTabHidden = "true";
            if (this.api.settings.autoAdvanceEmptyReactorTabs && allTabs.length > 1 && activeTab) {
                const activeTabKey = activeTab.querySelector('img[class*="emoji"]')?.getAttribute("alt") || "unknown";
                const otherTab = allTabs.find(tab => tab !== activeTab && tab.dataset.nmbTabHidden !== "true");
                if (otherTab && modal && modal.dataset.nmbSwitchedFrom !== activeTabKey) {
                    if (!modal.dataset.nmbTabEmptySeenAt || modal.dataset.nmbTabEmptySeenKey !== activeTabKey) {
                        modal.dataset.nmbTabEmptySeenAt = String(Date.now());
                        modal.dataset.nmbTabEmptySeenKey = activeTabKey;
                    } else if (Date.now() - Number(modal.dataset.nmbTabEmptySeenAt) > 900) {
                        modal.dataset.nmbSwitchedFrom = activeTabKey;
                        delete modal.dataset.nmbTabEmptySeenAt;
                        delete modal.dataset.nmbTabEmptySeenKey;
                        try {
                            otherTab.click();
                        } catch (err) {
                            this.api.diagnostics.warn("hideBlockedReactors: otherTab.click() failed, skipping auto-advance", err);
                        }
                    }
                }
            } else if (this.api.settings.autoAdvanceEmptyReactorTabs && allTabs.length <= 1 && modal && modal.dataset.nmbAutoClosed !== "true") {
                if (!modal.dataset.nmbEmptySeenAt) {
                    modal.dataset.nmbEmptySeenAt = String(Date.now());
                } else if (Date.now() - Number(modal.dataset.nmbEmptySeenAt) > 900) {
                    modal.dataset.nmbAutoClosed = "true";
                    const closeBtn = _findCloseButton(modal);
                    if (closeBtn) closeBtn.click();
                }
            }
            return;
        }
        if (activeTab?.dataset.nmbTabHidden === "true") delete activeTab.dataset.nmbTabHidden;
        if (modal?.dataset.nmbEmptySeenAt) delete modal.dataset.nmbEmptySeenAt;
        if (modal?.dataset.nmbSwitchedFrom) delete modal.dataset.nmbSwitchedFrom;
        if (modal?.dataset.nmbTabEmptySeenAt) delete modal.dataset.nmbTabEmptySeenAt;
        if (modal?.dataset.nmbTabEmptySeenKey) delete modal.dataset.nmbTabEmptySeenKey;
        this._cleanupReactorModalLoading(container);
    }
    _updateInactiveReactorTabs(allTabs, activeTab, realCounts) {
        allTabs.forEach(tab => {
            if (tab === activeTab) return;
            const realCount = realCounts.get(tab);
            if (realCount === 0) {
                if (tab.dataset.nmbTabHidden !== "true") tab.dataset.nmbTabHidden = "true";
            } else if (tab.dataset.nmbTabHidden === "true") {
                delete tab.dataset.nmbTabHidden;
            }
        });
    }
    hideBlockedReactors() {
        try {
            let anyIdPending = false;
            for (const container of document.querySelectorAll(_SEL.reactorsContainers)) {
                if (this._updateReactorsContainer(container)) anyIdPending = true;
            }
            if (anyIdPending) this._scheduleReactorIdentityRetry();
        } catch (error) { _recordPatchCatch("reactions.hideBlockedReactors", this, error); }
    }
    _updateReactorsContainer(container) {
        if (container.offsetParent === null) return false;
        const modal = container.closest('[role="dialog"]') || container.closest('[class*="layer"]');
        const messageId = this._resolveReactorsModalMessageId(modal || container);
        const rows = container.querySelectorAll(_SEL.reactorClickable);
        const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
        const allTabs = modal ? Array.from(modal.querySelectorAll('[class*="reactionSelected_"], [class*="reactionDefault_"]')) : [];
        const activeTab = allTabs.find(tab => tab.getAttribute("aria-selected") === "true") || null;
        if (allTabs.length > 0 && !activeTab) return false;
        const emoji = activeTab ? this._getActiveModalEmoji(modal) : null;
        const reactorData = this._getBlockedReactorData(channelId, messageId, emoji);
        const { blockedIdSet, reactionDataComputable, idPending } = reactorData;
        let anyIdPending = !!idPending;
        const { visibleRemaining, unresolvedCount } = reactionDataComputable
            ? this._countVisibleReactors(rows, blockedIdSet)
            : { visibleRemaining: 0, unresolvedCount: 0 };
        if (reactionDataComputable && messageId && channelId && emoji) {
            this._hideGhostReactorSlots(container, messageId, channelId, emoji);
            this.fixReactionCounts();
        }
        const realCounts = allTabs.length ? this._fixModalTabCounts(allTabs, messageId) : new Map;
        if (realCounts.get(this.api.constants.TAB_COUNTS_PENDING_SENTINEL)) anyIdPending = true;
        const activeTabRealCount = activeTab ? realCounts.get(activeTab) : undefined;
        const genuinelyEmpty = this._isReactorModalEmpty(reactionDataComputable, rows.length, unresolvedCount, visibleRemaining, realCounts.has(activeTab), activeTabRealCount);
        this._updateReactorModalEmptyState(container, modal, activeTab, allTabs, genuinelyEmpty);
        this._updateInactiveReactorTabs(allTabs, activeTab, realCounts);
        return anyIdPending;
    }
    _isReactorModalEmpty(dataComputable, rowCount, unresolvedCount, visibleRemaining, hasStoreCount, storeCount) {
        return (dataComputable && rowCount > 0 && unresolvedCount === 0 && visibleRemaining === 0)
            || (hasStoreCount && storeCount === 0);
    }
    _scheduleReactorIdentityRetry() {
        this.api.resources.clearTimer('reactorId', this._reactorIdPendingRetryTimer);
        this._reactorIdPendingRetryTimer = this.api.resources.timer('reactorId', () => {
            this._reactorIdPendingRetryTimer = null;
            if (!this.api.lifecycle.isRunning) return;
            try { this.hideBlockedReactors(); } catch (error) { _recordPatchCatch("reactions.retryScan", this, error); }
        }, 150);
    }
    _fixModalTabCounts(tabs, messageId) {
        const realCounts = new Map;
        try {
            const store = this.api.stores.ReactionsStore;
            if (!store || typeof store.getReactions !== "function") return realCounts;
            const SelectedChannelStore = this.api.stores.SelectedChannelStore;
            const channelId = SelectedChannelStore?.getChannelId?.();
            if (!channelId || !messageId) return realCounts;
            tabs.forEach(tab => {
                const emoji = this._readEmojiFromTab(tab);
                if (!emoji) return;
                const { id, name, emojiImg, idPending } = emoji;
                if (idPending) {
                    realCounts.set(this.api.constants.TAB_COUNTS_PENDING_SENTINEL, true);
                    return;
                }
                const countEl = Array.from(tab.children).find(child => child !== emojiImg && /^\d+$/.test((child.textContent || "").trim()));
                if (!name || !countEl) return;
                const users = this._getFilteredReactions(store, channelId, messageId, {
                    id: id,
                    name: name
                }, 0);
                if (!this._reactionUsersComputable(users)) return;
                const realCount = this._reactionUsersSize(users);
                realCounts.set(tab, realCount);
                const displayedCount = parseInt(countEl.textContent, 10);
                this._updateReactionCountDisplay(countEl, realCount, displayedCount);
            });
        } catch (error) { _recordPatchCatch("reactions.fixModalTabCounts", this, error); }
        return realCounts;
    }
    resolveReactorIdByName(row) {
        try {
            const nameEl = row.querySelector(_SEL.reactorDisplayName);
            const displayName = (nameEl?.textContent || "").trim();
            if (!displayName) return null;
            const REACTOR_NAME_CACHE_TTL_MS = 60000;
            const REACTOR_NAME_CACHE_MISS_TTL_MS = 2000;
            const now = Date.now();
            const REACTOR_NAME_CACHE_MAX_SIZE = 300;
            this._reactorNameCache = this.api.cache.map("reactions.reactorNames", REACTOR_NAME_CACHE_MAX_SIZE);
            const cached = this._reactorNameCache.get(displayName);
            if (cached) {
                const ttl = cached.id ? REACTOR_NAME_CACHE_TTL_MS : REACTOR_NAME_CACHE_MISS_TTL_MS;
                if ((now - cached.ts) < ttl) return cached.id;
            }
            const matches = this.api.identity.findUsersByName(displayName).map(match => String(match.user.id));
            let resolved = matches.length === 1 ? matches[0] : null;
            if (resolved === null && matches.length > 1) {
                const blockedMatch = matches.find(id => this.api.visibility.shouldHide?.(id));
                if (blockedMatch) resolved = blockedMatch;
            }
            this.api.cache.set("reactions.reactorNames", displayName, { id: resolved, ts: now });
            return resolved;
        } catch (_) {
            return null;
        }
    }
}
function createVoiceSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({
            get voiceChannelsEnabled() { return !!plugin.settings?.places?.voiceChannels; },
            get muteBlockedVoiceAudio() { return !!plugin.settings?.behavior?.muteBlockedVoiceAudio; },
        }),
        selectors: Object.freeze({
            get voiceUsers() { return [
                _SEL.voiceUser,
                _VOICE_CHANNEL_ARIA_LABEL_SEL.split(',').map(s => `${s} [data-list-item-id]`).join(','),
                '[data-list-item-id*="voice"]',
                '[class*="voiceUsers"] [data-list-item-id]'
            ].join(':not([data-hidden-blocked="true"]),') + ':not([data-hidden-blocked="true"])'; },
        }),
        constants: Object.freeze({
            get voiceStateUpdatesAction() { return plugin.constructor.ACTIONS.VOICE_STATE_UPDATES; },
            get durationLocale() { return plugin.constructor.DURATION_LOCALE; },
        }),
        stores: Object.freeze({
            get ChannelStore() { return plugin.modules.ChannelStore; },
            get Dispatcher() { return plugin.modules.Dispatcher; },
            get MediaEngineActions() { return plugin.modules.MediaEngineActions; },
            get RTCConnectionUtils() { return plugin.modules.RTCConnectionUtils; },
            get RTCParticipantsModule() { return plugin.modules.RTCParticipantsModule; },
            get SelectedChannelStore() { return plugin.modules.SelectedChannelStore; },
            get SelectedGuildStore() { return plugin.modules.SelectedGuildStore; },
            get SortedVoiceStateStore() { return plugin.modules.SortedVoiceStateStore; },
            get VoiceStateStore() { return plugin.modules.VoiceStateStore; },
        }),
        moduleResolver: Object.freeze({
            getWithKey: (...args) => plugin._r.getWithKey(...args),
            findFunctionKeyFuzzy: (...args) => plugin._wpFindFnKeyFuzzy(...args),
        }),
        identity: Object.freeze({
            extractUserId: value => plugin.extractUserId(value),
            findUserId: element => plugin.findUserId(element),
            findChannelId: value => plugin.findChannelId(value),
            getSelfUserId: () => plugin._getSelfUserId(),
        }),
        visibility: _surfaceUserVisibility(plugin),
        dom: Object.freeze({
            findChannelRowById: channelId => plugin._surfaces.channelStatus.findChannelRowById(channelId),
            hideElement: (...args) => plugin.hideElement(...args),
            restoreElement: element => plugin.restoreElement(element),
            get hideStyles() { return plugin.hideStyles; },
            trackHiddenElement: element => plugin.hiddenElements.add(element),
        }),
        localMute: Object.freeze({
            get muteKey() { return plugin._localMuteKey; },
            get muteIsToggle() { return plugin._localMuteIsToggle; },
            get volumeKey() { return plugin._localVolumeKey; },
            isMuted: (...args) => plugin._localMuteReadStore?.isLocalMute?.(...args),
            getVolume: (...args) => plugin._localMuteReadStore?.getLocalVolume?.(...args),
        }),
        originalVoiceMethods: Object.freeze({
            get getVoiceStates() { return plugin.originalVoiceMethods.getVoiceStates; },
            get getVoiceStatesForChannel() { return plugin.originalVoiceMethods.getVoiceStatesForChannel; },
        }),
        coordination: Object.freeze({
            seedBlockedChannelStatuses: () => plugin._surfaces.channelStatus.seedBlockedChannelStatuses(),
            reevaluateChannelStatusVisibility: channelId => plugin._surfaces.channelStatus.reevaluateChannelStatusVisibility(channelId),
            get scanInFlight() { return plugin.scanInFlight; },
            queueScan: (...args) => plugin.queueScan(...args),
        }),
        status: Object.freeze({ getBlockedText: channelId => plugin._blockedChannelStatuses?.get(channelId) || null }),
        health: Object.freeze({
            get available() { return !!plugin._health; },
            heartbeat: (...args) => plugin._health?.heartbeat(...args),
            register: (...args) => plugin._health?.register(...args),
            get activityPanelPatched() { return !!plugin._activityPanelComponentPatched; },
            repatchActivityPanel: () => { plugin._activityPanelComponentPatched = false; plugin.patchActivityPanelComponent(); },
            soundEnabled: () => !!(plugin.settings?.behavior?.muteVoiceJoinLeaveSound || plugin.settings?.behavior?.muteBlockedVoiceAudio),
            soundPatchHealthy: () => {
                const SoundUtils = plugin.modules.SoundUtils;
                const targetKey = plugin._soundPatchState?.targetKey;
                return !!(SoundUtils && targetKey && SoundUtils[targetKey] === plugin._soundPatchedFn && plugin._soundboardPatched);
            },
            repairSoundPatch: () => {
                plugin._soundPatchedFn = null;
                plugin._soundPatchState = null;
                plugin._surfaces.sound.patchSound();
                if (!plugin._soundboardPatched) plugin._surfaces.sound.patchSoundboardEffects();
            },
        }),
        diagnostics: Object.freeze({
            get lastVoiceStatesAltRawSample() { return plugin._lastVoiceStatesAltRawSample; },
            warn: (...args) => plugin._patcher?._warn(...args),
            loggerWarn: (...args) => plugin.logger?.warn(...args),
            throttled: (...args) => plugin._logThrottled(...args),
        }),
        lifecycle: _runningLifecycle(plugin),
        resources: Object.freeze({
            timer: (...args) => plugin._resources.timer(...args),
            interval: (...args) => plugin._resources.interval(...args),
            clearInterval: (...args) => plugin._resources.clearInterval(...args),
        }),
        retry: _surfaceRetry(plugin, ["schedule","delay"]),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            patchMethod: (...args) => plugin._patcher.patchMethod(...args),
            before: (...args) => plugin.patchBefore(...args),
            instead: (...args) => plugin.patchInstead(...args),
        }),
    });
}

class VoiceSurface {
    constructor(api) {
        this.api = api;
        this._voiceChannelMemberIds = new Map;
        this._voiceFakeTimers = new Map;
        this._voiceFakeTimerTick = null;
        this._selfJoinTimestamp = 0;
        this._lastSelfVoiceChannelId = null;
        this._mutedBlockedUserIds = new Set;
        this._seenVoiceOccupants = new Map;
        this._oldUnblockedConnectedUsers = new Set;
        this._preBlockVolumes = new Map;
        this._voiceMutePatched = false;
        this._lastSoundTrackedChannelId = null;
        this._voiceStateCallSig = null;
        this._statusModalClickHandler = null;
        this._lastClickedStatusChannelId = null;
    }
    start() {
        this._startChannelStatusModalWatcher();
    }
    patchLate() {
        if (!this.api.settings.muteBlockedVoiceAudio) return;
        this.api.patching.safe('patchVoiceMute', () => this.patchVoiceMute());
    }
    patchDeferred() {
        this.api.patching.safe('patchVoiceUserComponent', () => this.patchVoiceUserComponent());
    }
    stop() {
        if (this._voiceFakeTimerTick) {
            this.api.resources.clearInterval('voiceFakeTimer', this._voiceFakeTimerTick);
            this._voiceFakeTimerTick = null;
        }
        this._voiceFakeTimers.clear();
        this._voiceChannelMemberIds.clear();
        this._preBlockVolumes?.clear();
        this._voiceMutePatched = false;
        this.voiceUserComponentPatched = false;
        this._oldUnblockedConnectedUsers = new Set;
        this._lastSoundTrackedChannelId = null;
        this._voiceStateCallSig = null;
        if (this._statusModalClickHandler) {
            document.removeEventListener("click", this._statusModalClickHandler, true);
            this._statusModalClickHandler = null;
        }
        this._lastClickedStatusChannelId = null;
    }
    _startChannelStatusModalWatcher() {
        if (this._statusModalClickHandler) return;
        this._statusModalClickHandler = event => {
            try {
                const trigger = event.target?.closest?.('[class*="statusDiv" i][role="button"], [class*="channelStatus" i][role="button"], [class*="voiceChannelStatus" i][role="button"]');
                if (!trigger) return;
                const row = trigger.closest(_SEL.channelRow);
                const channelId = row ? this.api.identity.findChannelId(row) : null;
                if (channelId) this._lastClickedStatusChannelId = channelId;
            } catch (error) { _recordPatchCatch("voice.statusModalClick", this, error); }
        };
        document.addEventListener("click", this._statusModalClickHandler, true);
    }
    handleStatusModalMutationBatch(mutations) {
        if (!this.api.settings.voiceChannelsEnabled) return;
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
    }
    _maybeClearBlockedStatusEditor(editor) {
        try {
            if (editor.dataset?.nmbStatusChecked === "true") return;
            editor.dataset.nmbStatusChecked = "true";
            const channelId = this._lastClickedStatusChannelId
                || this.api.stores.SelectedChannelStore?.getVoiceChannelId?.()
                || this.api.stores.SelectedChannelStore?.getChannelId?.();
            if (!channelId) return;

            const blockedStatusText = this.api.status.getBlockedText(channelId);
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
                const execOk = document.execCommand("delete");
                const clearedByExec = execOk && (editor.textContent || "").trim() === "";
                if (clearedByExec) return;
                try {
                    const beforeInputEvent = new InputEvent("beforeinput", {
                        bubbles: true,
                        cancelable: true,
                        inputType: "deleteContentBackward"
                    });
                    editor.dispatchEvent(beforeInputEvent);
                    if ((editor.textContent || "").trim() === "") return;
                } catch (err) {
                    this.api.diagnostics.throttled("_maybeClearBlockedStatusEditor", `failed to dispatch synthetic beforeinput: ${err?.message || err}`, "warn");
                }
                this.api.diagnostics.throttled("_maybeClearBlockedStatusEditor", "could not clear the blocked status editor - execCommand and the synthetic beforeinput fallback had no effect; the blocked status may remain visible in the editor until the next manual edit", "warn");
            };
            this.api.resources.timer('clearBlockedStatusEditor', verifyAndClear, 30);
        } catch (error) { _recordPatchCatch("voice.clearBlockedStatusEditor", this, error); }
    }
    patchVoiceUserComponent(attempt = 0) {
        if (!this.api.settings.voiceChannelsEnabled) return;
        if (this.voiceUserComponentPatched) return;
        const self = this;
        try {
            const VOICE_USER_TERMS = ["userId", "speaking", "muted", "deafen", "ringing"];
            const VOICE_USER_REQUIRED = 3;
            const LABEL = "Voice user component (patchVoiceUserComponent target)";
            const result = this.api.moduleResolver.getWithKey(m => {
                if (typeof m !== "function") return false;
                try {
                    const src = Function.prototype.toString.call(m);
                    if (src.startsWith("class ")) return false;
                    return VOICE_USER_TERMS.filter(t => src.includes(t)).length >= VOICE_USER_REQUIRED;
                } catch (_) { return false; }
            }, LABEL);
            if (result) {
                let [mod, key] = result;
                if (mod && key == null) key = this.api.moduleResolver.findFunctionKeyFuzzy(mod, ...VOICE_USER_TERMS);
                if (mod && key) {
                const unpatch = this.api.patching.instead(mod, key, function(ctx, args, orig) {
                    self.api.health.heartbeat("voiceUserComponentPatch");
                    try {
                        const props = args?.[0] || ctx?.props;
                        const uid = props?.user?.id || props?.userId || self.api.identity.extractUserId(props);
                        if (uid && self.api.visibility.shouldHide(uid)) return null;
                    } catch (error) { _recordPatchCatch("voice.filterUserComponent", self, error); }
                    return orig.apply(ctx, args);
                });
                if (typeof unpatch === "function") {
                    this.voiceUserComponentPatched = true;
                    return true;
                }
                }
            }
        } catch (err) { this.api.diagnostics.warn("patchVoiceUserComponent", err); }
        if (!this.voiceUserComponentPatched && attempt < 6) {
            this.api.retry.schedule(() => this.patchVoiceUserComponent(attempt + 1), this.api.retry.delay(attempt, 5000));
        } else if (!this.voiceUserComponentPatched) {
            this.api.diagnostics.warn("patchVoiceUserComponent", new Error("ran out of attempts - no module matched the voice-user term set; Discord likely renamed something in this component"));
        }
    }

    filterVoiceStates(value) {
        return _memoizeByRef(this, "_voiceStateFilterCache", value, v => this._filterVoiceStatesUncached(v));
    }

    _filterVoiceStatesUncached(value) {
        if (!value) return value;
        if (Array.isArray(value)) {
            let changed = false;
            const filtered = value.filter(state => {
                const hide = this.api.visibility.shouldHide(this.api.identity.extractUserId(state));
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
                const userId = this.api.identity.extractUserId(item) || key;
                const keep = Array.isArray(next) ? next.length : !this.api.visibility.shouldHide(userId);
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
                const userId = this.api.identity.extractUserId(item) || key;
                if (!this.api.visibility.shouldHide(userId)) {
                    filtered[key] = item;
                } else {
                    changed = true;
                }
            }
            return changed ? filtered : value;
        }
        return value;
    }

    findVoiceStatesAltMethodName(store) {
        if (!store) return null;
        try {
            const proto = Object.getPrototypeOf(store);
            const names = Object.getOwnPropertyNames(proto).filter(name => {
                if (name === "constructor") return false;
                if (name === "getVoiceStatesForChannel" || name === "getVoiceStates") return false;
                if (typeof store[name] !== "function") return false;
                return /ForChannel/i.test(name) && /(Alt|V2|2$|Variant)/i.test(name) && store[name].length <= 2;
            });
            return names[0] || null;
        } catch (_) {
            return null;
        }
    }

    registerVoiceStatesAltHealthCheck(store, methodName) {
        if (!this.api.health.available || this._voiceStatesAltHealthRegistered) return;
        this._voiceStatesAltHealthRegistered = true;
        this.api.health.register(
            "voiceStatesAltFilter",
            () => {
                try {
                    if (typeof store[methodName] !== "function") return false;
                    const sample = this.api.diagnostics.lastVoiceStatesAltRawSample;
                    if (!sample || !sample.length) return true;
                    const filtered = this.filterVoiceStates(sample);
                    return Array.isArray(filtered)
                        ? filtered.every(item => !this.api.visibility.shouldHide(this.api.identity.extractUserId(item)))
                        : true;
                } catch (_) {
                    return false;
                }
            },
            () => {
                this.api.diagnostics.loggerWarn("The profile popout filter (voice states) appears to have stopped recognizing blocked users - Discord may have changed the data format. Consider updating the plugin.");
            },
            2
        );
    }

    _reapOrphanedVoiceWrappers() {
        const hiddenInner = document.querySelectorAll('[class*="voiceUser"][data-hidden-blocked="true"]');
        for (let i = 0; i < hiddenInner.length; i++) {
            const inner = hiddenInner[i];
            const wrapper = inner.closest('[class*="draggable__"]') || inner.closest("li");
            if (wrapper && wrapper !== inner && wrapper.dataset?.hiddenBlocked !== "true") {
                this.api.dom.hideElement(wrapper, "voice-user-orphan-wrapper", inner.dataset?.nmbUserId || null);
            }
        }
    }

    hideActivityUsers() {
        _hideBlockedRows(this, '[class*="activityPanel_"] [data-list-item-id], [class*="activityPanel_"] [class*="participant_"], [class*="activityPanel_"] [class*="user_"], [class*="streamPreview_"], [class*="streamTile_"], [class*="stream_"] [class*="user_"], [class*="activity_"] [class*="member_"], [class*="embeddedActivity_"] [class*="user_"], [class*="nowPlaying_"] [class*="user_"]', "activity-user");
    }

    scan() {
        _hideBlockedRows(
            this,
            [
                _SEL.voiceUser,
                _VOICE_CHANNEL_ARIA_LABEL_SEL.split(',').map(s => `${s} [data-list-item-id]`).join(','),
                '[data-list-item-id*="voice"]',
                '[class*="voiceUsers"] [data-list-item-id]',
                '[class*="listItem"][data-list-item-id]'
            ].join(':not([data-hidden-blocked="true"]),') + ':not([data-hidden-blocked="true"])',
            "voice-user",
            el => {
                const row = el.closest('[class*="draggable__"]') || el.closest('[data-list-item-id]') || el.closest("li") || el;
                return this.isVoiceChannelShell(row) ? el : row;
            }
        );
        this._reapOrphanedVoiceWrappers();
        this.fixVoiceCounters();
    }

    seedVoiceChannelMembers() {
        try {
            const voiceStore = this.api.stores.SortedVoiceStateStore || this.api.stores.VoiceStateStore;
            if (!voiceStore) return;
            document.querySelectorAll(_SEL.channelRow).forEach(row => {
                const channelId = this.api.identity.findChannelId(row);
                if (!channelId) return;
                const states = this.getRawVoiceStatesForChannel(channelId);
                if (!states.length) return;
                const memberIds = new Set(states.map(s => this.api.identity.extractUserId(s)).filter(Boolean));
                if (memberIds.size) this._voiceChannelMemberIds.set(channelId, memberIds);
            });
            const seededVoiceChannelId = this.getSelfVoiceChannelId();
            if (seededVoiceChannelId) {
                this._lastSelfVoiceChannelId = seededVoiceChannelId;
                if (!this._selfJoinTimestamp) this._selfJoinTimestamp = Date.now();

                this._lastSoundTrackedChannelId = seededVoiceChannelId;
                let liveStates = [];
                try { liveStates = this.getRawVoiceStatesForChannel(seededVoiceChannelId) || []; }
                catch (error) { _recordPatchCatch("voice.seedSelfChannelStates", null, error); }
                const liveIds = new Set(liveStates.map(s => this.api.identity.extractUserId(s)).filter(Boolean));
                const selfIdForSeed = this.api.identity.getSelfUserId?.();
                liveIds.delete(selfIdForSeed);
                this._oldUnblockedConnectedUsers = liveIds;
            }
        } catch (error) { _recordPatchCatch("voice.seedChannelMembers", null, error); }
        this.api.coordination.seedBlockedChannelStatuses();
    }

    _recheckVoiceAfterSelfJoin(channelId, selfId, membersByChannel, attempt) {
        if (!this.api.lifecycle.isRunning) return;
        const currentChannelId = this.getMediaEngineContext()?.channelId || null;
        if (currentChannelId !== channelId) return;
        const existingTimer = this._voiceFakeTimers.get(channelId);
        if (existingTimer?.joinStamp === this._selfJoinTimestamp) return;
        const rawStates = this.getRawVoiceStatesForChannel(channelId) || [];
        const memberIds = this._otherVoiceUserIds(rawStates, selfId);
        if (memberIds.length) {
            const memberSet = membersByChannel.get(channelId) || new Set;
            for (const id of memberIds) memberSet.add(id);
            memberSet.add(selfId);
            membersByChannel.set(channelId, memberSet);
        }
        const stillBlockedOnly = memberIds.length && memberIds.every(id => this.api.visibility.shouldHide(id));
        if (stillBlockedOnly) {
            this._resetFakeVoiceTimer(channelId);
            try { this.applyVoiceMuteForChannel(channelId); }
            catch (error) { _recordPatchCatch("voice.recheckMute", null, error); }
            try { this.fixVoiceChannelIconColors(); }
            catch (error) { _recordPatchCatch("voice.recheckIconColors", null, error); }
        } else if (attempt < 2) {
            this.api.retry.schedule(() => this._recheckVoiceAfterSelfJoin(channelId, selfId, membersByChannel, attempt + 1), 800);
        }
    }
    handleVoiceStateUpdatesForFakeTimer(voiceStates) {
        if (!this.api.settings.voiceChannelsEnabled) return;
        const selfId = this.api.identity.getSelfUserId();
        const statusChannelsToReevaluate = new Set;
        let selfLeftVoiceEntirely = false;
        for (const vs of voiceStates) {
            if (!vs) continue;
            const userId = vs.userId || this.api.identity.extractUserId(vs);
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
            if (this.api.visibility.shouldHide(userId)) {
                if (oldChannelId) statusChannelsToReevaluate.add(oldChannelId);
                if (newChannelId) statusChannelsToReevaluate.add(newChannelId);
            }
            if (selfId && userId === selfId) {
                this._trackOwnVoiceChannelChange(newChannelId, selfId);
                if (oldChannelId) this._voiceFakeTimers.delete(oldChannelId);
                if (!newChannelId) {
                    selfLeftVoiceEntirely = true;
                }
            }
            if (newChannelId) {
                const existingMembers = prevMembers.get(newChannelId) || new Set;
                existingMembers.add(userId);
                prevMembers.set(newChannelId, existingMembers);

                if (selfId && userId === selfId) {
                    this._handleOwnVoiceChannelJoin(newChannelId, selfId, existingMembers, prevMembers);
                }
            }
        }
        this._scheduleVoiceStatusReevaluation(statusChannelsToReevaluate, selfLeftVoiceEntirely);
    }
    _trackOwnVoiceChannelChange(newChannelId, selfId) {
        this._selfJoinTimestamp = Date.now();
        this._lastSelfVoiceChannelId = newChannelId || null;

        this._lastSoundTrackedChannelId = newChannelId || null;
        if (newChannelId) {
            let liveStates = [];
            try { liveStates = this.getRawVoiceStatesForChannel(newChannelId) || []; }
            catch (error) { _recordPatchCatch("voice.trackSelfChannelStates", null, error); }
            const liveIds = new Set(liveStates.map(s => this.api.identity.extractUserId(s)).filter(Boolean));
            liveIds.delete(selfId);
            this._oldUnblockedConnectedUsers = liveIds;
        } else {
            this._oldUnblockedConnectedUsers = new Set();
        }
    }
    _handleOwnVoiceChannelJoin(newChannelId, selfId, existingMembers, prevMembers) {
        let othersBeforeIEntered = [ ...existingMembers ].filter(id => id !== selfId);
        let usedFallback = false;

        if (!othersBeforeIEntered.length) {
            const rawStates = this.getRawVoiceStatesForChannel(newChannelId) || [];
            othersBeforeIEntered = this._otherVoiceUserIds(rawStates, selfId);
            usedFallback = true;
        }

        const anyBlockedBefore = othersBeforeIEntered.some(id => this.api.visibility.shouldHide(id));
        const anyUnblockedBefore = othersBeforeIEntered.some(id => !this.api.visibility.shouldHide(id));
        if (anyBlockedBefore && !anyUnblockedBefore) {
            this._resetFakeVoiceTimer(newChannelId);
        }
        try {
            this.applyVoiceMuteForChannel(newChannelId);
        } catch (error) { _recordPatchCatch("voice.muteAfterJoin", null, error); }

        if (usedFallback && !othersBeforeIEntered.length) {
            this.api.retry.schedule(() => this._recheckVoiceAfterSelfJoin(newChannelId, selfId, prevMembers, 0), 400);
        }
    }
    _scheduleVoiceStatusReevaluation(statusChannelsToReevaluate, selfLeftVoiceEntirely) {
        if (statusChannelsToReevaluate.size || selfLeftVoiceEntirely) {
            this.api.resources.timer('voiceStatusReevaluate', () => {
                if (!this.api.lifecycle.isRunning) return;
                try {
                    for (const chId of statusChannelsToReevaluate) this.api.coordination.reevaluateChannelStatusVisibility(chId);
                    if (selfLeftVoiceEntirely) this.fixVoiceChannelIconColors();
                } catch (error) { _recordPatchCatch("voice.reevaluateStatusAfterStateChange", null, error); }
            }, 0);
        }
    }

    getMediaEngineContext() {
        try {
            const RTCUtils = this.api.stores.RTCConnectionUtils;
            if (RTCUtils) {
                const channelId = RTCUtils.getChannelId?.();
                const guildId = RTCUtils.getGuildId?.();
                if (channelId) return { channelId: channelId, guildId: guildId || null, context: "default" };
            }
        } catch (error) { _recordPatchCatch("VoiceSurface.getMediaEngineContext.fallback1", this, error); }
        try {
            const candidate = this.api.stores.SelectedChannelStore?.getVoiceChannelId?.();
            if (candidate) return { channelId: candidate, guildId: null, context: "default" };
        } catch (error) { _recordPatchCatch("VoiceSurface.getMediaEngineContext.fallback2", this, error); }
        return null;
    }

    _setBlockedUserLocalMute(userId, mute) {
        const actions = this.api.stores.MediaEngineActions;
        if (!actions || !userId) return false;
        const ctx = this.getMediaEngineContext();
        const context = ctx?.context || "default";
        let applied = false;
        try {
            if (this.api.localMute.muteKey && typeof actions[this.api.localMute.muteKey] === "function") {
                if (this.api.localMute.muteIsToggle) {
                    let currentlyMuted = null;
                    try {
                        currentlyMuted = this.api.localMute.isMuted(userId, context);
                    } catch (error) { _recordPatchCatch("voice.readCurrentMuteState", this, error); }
                    if (currentlyMuted !== mute) {
                        actions[this.api.localMute.muteKey](userId, context);
                    }
                    applied = true;
                } else {
                    actions[this.api.localMute.muteKey](userId, mute, context);
                    applied = true;
                }
            }
        } catch (error) { _recordPatchCatch("voice.applyLocalMute", this, error); }
        try {
            if (this.api.localMute.volumeKey && typeof actions[this.api.localMute.volumeKey] === "function") {
                if (mute) {
                    if (!this._preBlockVolumes.has(userId)) {
                        let existingVolume = null;
                        try {
                            existingVolume = this.api.localMute.getVolume(userId, context);
                        } catch (error) { _recordPatchCatch("voice.readCurrentVolume", this, error); }
                        this._preBlockVolumes.set(userId, typeof existingVolume === "number" ? existingVolume : 100);
                    }
                    actions[this.api.localMute.volumeKey](userId, 0, context);
                } else {
                    const restoreVolume = this._preBlockVolumes.has(userId) ? this._preBlockVolumes.get(userId) : 100;
                    this._preBlockVolumes.delete(userId);
                    actions[this.api.localMute.volumeKey](userId, restoreVolume, context);
                }
                applied = true;
            }
        } catch (error) { _recordPatchCatch("voice.applyLocalVolume", this, error); }
        return applied;
    }

    applyVoiceMuteForChannel(channelId) {
        if (!this.api.settings.muteBlockedVoiceAudio) return;
        if (!channelId) return;
        try {
            const states = this.getRawVoiceStatesForChannel(channelId) || [];
            const selfId = this.api.identity.getSelfUserId();
            const seenThisPass = new Set;
            for (const state of states) {
                const userId = this.api.identity.extractUserId(state);
                if (!userId || userId === selfId) continue;
                seenThisPass.add(userId);
                if (!this._seenVoiceOccupants.has(channelId)) this._seenVoiceOccupants.set(channelId, new Set);
                this._seenVoiceOccupants.get(channelId).add(userId);
                if (this.api.visibility.shouldHide(userId)) {
                    this._muteBlockedVoiceUser(userId);
                } else if (this._mutedBlockedUserIds?.has(userId)) {
                    this._releaseVoiceMuteForUser(userId);
                }
            }
            const known = this._seenVoiceOccupants.get(channelId);
            if (known && known.size) {
                for (const userId of known) {
                    if (userId === selfId || seenThisPass.has(userId)) continue;
                    if (this.api.visibility.shouldHide(userId)) {
                        this._muteBlockedVoiceUser(userId);
                    }
                }
            }
        } catch (error) { _recordPatchCatch("voice.applyMuteForChannel", this, error); }
    }

    _releaseVoiceMuteForUser(userId) {
        if (!userId) return;
        if (!this._mutedBlockedUserIds || !this._mutedBlockedUserIds.has(userId)) return;
        this._setBlockedUserLocalMute(userId, false);
        this._mutedBlockedUserIds.delete(userId);
    }

    releaseAllVoiceMutes() {
        if (this._seenVoiceOccupants) this._seenVoiceOccupants.clear();
        if (!this._mutedBlockedUserIds || !this._mutedBlockedUserIds.size) return;
        for (const userId of [...this._mutedBlockedUserIds]) {
            this._setBlockedUserLocalMute(userId, false);
        }
        this._mutedBlockedUserIds.clear();
    }

    patchVoiceMute(attempt = 0) {
        this.api.patching.patchMethod({
            label: "patchVoiceMute",
            attempt,
            maxAttempts: 20,
            delayMs: 2000,
            useBackoff: false,
            isPatched() { return this._voiceMutePatched; },
            resolve() {
                const Dispatcher = this.api.stores.Dispatcher;
                return (Dispatcher && typeof Dispatcher.dispatch === "function") ? Dispatcher : null;
            },
            onExhausted(reason) {
                this.api.diagnostics.warn("patchVoiceMute", new Error(reason === "installing patch" ? "Voice mute target was found, but the patch could not be installed after several attempts" : "Dispatcher unavailable after several attempts - audio mute for blocked users may not react to real-time call joins/leaves"));
            },
            apply(Dispatcher) {
                this._mutedBlockedUserIds = this._mutedBlockedUserIds || new Set;
                const self = this;
                const unpatch = this.api.patching.before(Dispatcher, "dispatch", function(context, args) {
                    const action = args[0];
                    if (!action || typeof action !== "object") return;
                    if (action.type === self.api.constants.voiceStateUpdatesAction && Array.isArray(action.voiceStates)) {
                        try {
                            self._handleVoiceStateUpdatesForMute(action.voiceStates);
                        } catch (error) { _recordPatchCatch("voice.voiceStateMuteDispatcher", self, error); }
                    }
                });
                if (typeof unpatch !== "function") return false;
                this._voiceMutePatched = true;
                this._syncVoiceStateOnLoad(0);
                return true;
            },
            self: this
        });
    }

    _syncVoiceStateOnLoad(attempt) {
        if (!this.api.lifecycle.isRunning) return;
        try {
            const ctx = this.getMediaEngineContext();
            const channelId = ctx?.channelId || this.getSelfVoiceChannelId();
            if (channelId) {
                if (!this.api.stores.MediaEngineActions || (!this.api.localMute.muteKey && !this.api.localMute.volumeKey)) {
                    if (attempt < 20) {
                        this.api.retry.schedule(() => this._syncVoiceStateOnLoad(attempt + 1), 500);
                        return;
                    }
                    this.api.diagnostics.warn("_syncVoiceStateOnLoad", new Error("MediaEngineActions still unresolved after startup - blocked users already in a joined call may not be muted until their voice state changes"));
                }
                this.applyVoiceMuteForChannel(channelId);
                const states = this.getRawVoiceStatesForChannel(channelId) || [];
                if (this._isSelfInBlockedOnlyCall(channelId, states)) {
                    this._selfJoinTimestamp = this._selfJoinTimestamp || Date.now();
                    this._lastSelfVoiceChannelId = channelId;
                    this._resetFakeVoiceTimer(channelId);
                }
                return;
            }
        } catch (error) { _recordPatchCatch("voice.syncStateOnLoad", this, error); }
        if (attempt < 10) {
            this.api.retry.schedule(() => this._syncVoiceStateOnLoad(attempt + 1), 500);
        }
    }

    reapplyVoiceMuteIfNeeded() {
        if (!this.api.lifecycle.isRunning) return;
        if (!this.api.settings.muteBlockedVoiceAudio) return;
        try {
            const ctx = this.getMediaEngineContext();
            const channelId = ctx?.channelId || this.getSelfVoiceChannelId();
            if (channelId) this.applyVoiceMuteForChannel(channelId);
        } catch (error) { _recordPatchCatch("voice.reapplyMute", this, error); }
    }

    _handleVoiceStateUpdatesForMute(voiceStates) {
        if (!this.api.settings.muteBlockedVoiceAudio) return;
        const selfId = this.api.identity.getSelfUserId();
        const myChannelId = this.getMediaEngineContext()?.channelId || null;
        let selfChangedChannel = false;
        for (const vs of voiceStates) {
            if (!vs) continue;
            const userId = vs.userId || this.api.identity.extractUserId(vs);
            if (!userId) continue;
            const newChannelId = vs.channelId || null;
            if (userId === selfId) {
                selfChangedChannel = true;
                continue;
            }
            if (newChannelId && myChannelId && newChannelId === myChannelId) {
                if (!this._seenVoiceOccupants.has(myChannelId)) this._seenVoiceOccupants.set(myChannelId, new Set);
                this._seenVoiceOccupants.get(myChannelId).add(userId);
                if (this.api.visibility.shouldHide(userId)) {
                    this._muteBlockedVoiceUserWithConfirmation(userId, myChannelId);
                }
            } else if (myChannelId && (!newChannelId || newChannelId !== myChannelId)) {
                const set = this._seenVoiceOccupants.get(myChannelId);
                if (set) { set.delete(userId); if (!set.size) this._seenVoiceOccupants.delete(myChannelId); }
                if (this._mutedBlockedUserIds?.has(userId)) this._releaseVoiceMuteForUser(userId);
            }
        }
        if (selfChangedChannel) {
            this._confirmOwnVoiceChannelMute(myChannelId);
        }
    }
    _muteBlockedVoiceUser(userId) {
        if (!this._mutedBlockedUserIds) this._mutedBlockedUserIds = new Set;
        if (this._setBlockedUserLocalMute(userId, true)) {
            this._mutedBlockedUserIds.add(userId);
        }
    }
    _muteBlockedVoiceUserWithConfirmation(userId, myChannelId) {
        this._muteBlockedVoiceUser(userId);
        this.api.resources.timer('voiceMuteConfirm', () => {
            if (!this.api.lifecycle.isRunning) return;
            if (!this.api.settings.muteBlockedVoiceAudio) return;
            if (!this.api.visibility.shouldHide(userId)) return;
            const stillMyChannelId = this.getMediaEngineContext()?.channelId || this.getSelfVoiceChannelId();
            if (stillMyChannelId !== myChannelId) return;
            if (this._setBlockedUserLocalMute(userId, true)) {
                if (!this._mutedBlockedUserIds) this._mutedBlockedUserIds = new Set;
                this._mutedBlockedUserIds.add(userId);
            }
        }, 800);
    }
    _confirmOwnVoiceChannelMute(myChannelId) {
        const resolvedChannelId = myChannelId || this.getMediaEngineContext()?.channelId || this.getSelfVoiceChannelId();
        if (resolvedChannelId) {
            this.applyVoiceMuteForChannel(resolvedChannelId);
            this.api.resources.timer('voiceMuteConfirm', () => {
                if (!this.api.lifecycle.isRunning) return;
                const confirmChannelId = this.getMediaEngineContext()?.channelId || this.getSelfVoiceChannelId();
                if (confirmChannelId) this.applyVoiceMuteForChannel(confirmChannelId);
            }, 400);
        }
    }

    getSelfVoiceChannelId() {
        try {
            const rtcChannelId = this.getMediaEngineContext()?.channelId || null;
            if (rtcChannelId) return rtcChannelId;
        } catch (error) { _recordPatchCatch("VoiceSurface.getSelfVoiceChannelId.fallback1", this, error); }
        try {
            return this.api.stores.SelectedChannelStore?.getVoiceChannelId?.() || null;
        } catch (error) { _recordPatchCatch("VoiceSurface.getSelfVoiceChannelId.fallback2", this, error); }
        return this._lastSelfVoiceChannelId || null;
    }

    _otherVoiceUserIds(states, selfId) {
        return states.map(state => this.api.identity.extractUserId(state)).filter(id => id && id !== selfId);
    }

    _isSelfInBlockedOnlyCall(channelId, states) {
        if (!channelId) return false;
        const selfId = this.api.identity.getSelfUserId();
        const selfHere = this._channelContainsSelf(channelId, states)
            || this.getSelfVoiceChannelId() === channelId
            || this._lastSelfVoiceChannelId === channelId;
        if (!selfHere) return false;
        const others = this._otherVoiceUserIds(Array.isArray(states) ? states : [], selfId);
        if (!others.length) {
            const rawStates = this.getRawVoiceStatesForChannel(channelId) || [];
            const fallbackOthers = this._otherVoiceUserIds(rawStates, selfId);
            return fallbackOthers.length > 0 && fallbackOthers.every(id => this.api.visibility.shouldHide(id));
        }
        return others.every(id => this.api.visibility.shouldHide(id));
    }

    _resetFakeVoiceTimer(channelId) {
        this._voiceFakeTimers.set(channelId, {
            startedAt: Date.now(),
            active: true,
            joinStamp: this._selfJoinTimestamp || Date.now()
        });
        this._ensureFakeTimerTicker();
    }

    _ensureFakeTimerTicker() {
        if (this._voiceFakeTimerTick) return;
        this._voiceFakeTimerTick = this.api.resources.interval('voiceFakeTimer', () => {
            if (!this.api.lifecycle.isRunning || !this._voiceFakeTimers.size) {
                this.api.resources.clearInterval('voiceFakeTimer', this._voiceFakeTimerTick);
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
            const row = this.api.dom.findChannelRowById(channelId);
            if (!row) continue;
            const fakeEl = row.querySelector('[data-nmb-fake-timer="true"]');
            if (fakeEl) fakeEl.textContent = this._formatFakeTimerDuration(Date.now() - state.startedAt);
        }
    }

    _findVoiceTimerAnchor(channelRow) {
        if (!channelRow) return null;
        const link = channelRow.matches?.(_SEL.channelRow) ? channelRow : channelRow.querySelector?.(_SEL.channelRow);
        return link || channelRow;
    }

    _DEFAULT_FAKE_TIMER_STYLE() {
        return {
            fontFamily: "var(--font-code, ui-monospace, \"Source Code Pro\", Consolas, \"Andale Mono WT\", \"Andale Mono\", \"Lucida Console\", monospace)",
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

    _findVoiceTimerContainer(channelRow) {
        const candidates = [
            '[class*="tabularNumbers"][role="timer"]',
            '[role="timer"] [class*="tabularNumbers"]',
            '[class*="tabularNumbers"]',
            '[class*="timer"][role="timer"]',
            '[role="timer"]',
            '[class*="voiceTimer"]',
            '[class*="timer"]'
        ];
        for (const selector of candidates) {
            try {
                const el = channelRow.querySelector(selector);
                if (el) return el;
            } catch (error) { _recordPatchCatch("VoiceSurface._findVoiceTimerContainer.fallback1", this, error); }
        }
        return null;
    }

    _showFakeVoiceTimer(channelRow, channelId) {
        let state = this._voiceFakeTimers.get(channelId);
        if (!state) {
            state = { startedAt: Date.now(), active: true, joinStamp: this._selfJoinTimestamp || Date.now() };
            this._voiceFakeTimers.set(channelId, state);
            this._ensureFakeTimerTicker();
        } else if (!state.active) {
            state.active = true;
        }
        const timerContainer = this._findVoiceTimerContainer(channelRow);
        if (!timerContainer) {
            if (!state.retryCount) state.retryCount = 0;
            if (state.retryCount < 10) {
                state.retryCount++;
                state.active = true;
                this._scheduleFakeVoiceTimerRetry(channelId);
            } else {
                state.active = false;
            }
            return;
        }
        state.retryCount = 0;
        if (timerContainer.dataset.hiddenBlocked === "true") {
            this.api.dom.restoreElement(timerContainer);
        }
        const visibleTimerSpan = timerContainer.querySelector('span[aria-hidden="true"]') || timerContainer;
        if (!this._captureFakeVoiceTimerStyleSnapshot(state, visibleTimerSpan, channelId)) return;
        if (!visibleTimerSpan.hasAttribute(_ATTR.prevStyle)) {
            visibleTimerSpan.setAttribute(_ATTR.prevStyle, visibleTimerSpan.getAttribute("style") || "");
        }
        visibleTimerSpan.dataset.hiddenBlocked = "true";
        visibleTimerSpan.dataset.nmbReason = "voice-timer-faked";
        visibleTimerSpan.style.cssText = this.api.dom.hideStyles;
        this.api.dom.trackHiddenElement(visibleTimerSpan);
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
        if (fakeEl.dataset.hiddenBlocked === "true") this.api.dom.restoreElement(fakeEl);
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

    _captureFakeVoiceTimerStyleSnapshot(state, visibleTimerSpan, channelId) {
        const looksMonospace = fontFamily => /mono|code|consol|menlo|monaco/i.test(fontFamily || "");
        const isUsableSnapshot = snap => {
            if (!snap) return false;
            if (!(parseFloat(snap.fontSize) > 0)) return false;
            if (parseFloat(snap.lineHeight || "1") === 0) return false;
            return true;
        };
        const currentIsUsable = isUsableSnapshot(state.styleSnapshot);
        const currentIsMonospace = currentIsUsable && looksMonospace(state.styleSnapshot.fontFamily);
        if (!currentIsMonospace) {
            const computed = window.getComputedStyle(visibleTimerSpan);
            const candidate = {
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
            const candidateUsable = isUsableSnapshot(candidate);
            const candidateMonospace = candidateUsable && looksMonospace(candidate.fontFamily);

            if (candidateMonospace) {
                state.styleSnapshot = candidate;
                state.snapshotRetryCount = 0;
            } else {
                if (!state.snapshotRetryCount) state.snapshotRetryCount = 0;
                const stillHasRetries = state.snapshotRetryCount < 10;
                if (stillHasRetries) {
                    if (candidateUsable && !currentIsUsable) state.styleSnapshot = candidate;
                    state.snapshotRetryCount++;
                    this._scheduleFakeVoiceTimerRetry(channelId);
                    if (!isUsableSnapshot(state.styleSnapshot)) return false;
                } else if (!currentIsUsable) {
                    state.styleSnapshot = candidateUsable ? candidate : this._DEFAULT_FAKE_TIMER_STYLE();
                }
            }
        }
        return true;
    }

    _scheduleFakeVoiceTimerRetry(channelId) {
        this.api.resources.timer('voiceFakeTimerRow', () => {
            if (!this.api.lifecycle.isRunning) return;
            const freshRow = this.api.dom.findChannelRowById(channelId);
            if (freshRow) this._showFakeVoiceTimer(freshRow, channelId);
        }, 150);
    }

    _hideFakeVoiceTimer(channelRow, channelId) {
        const state = this._voiceFakeTimers.get(channelId);
        if (state) state.active = false;
        const timerContainer = this._findVoiceTimerContainer(channelRow);
        const fakeEl = (timerContainer || channelRow).querySelector('[data-nmb-fake-timer="true"]');
        if (fakeEl) fakeEl.remove();
        channelRow.querySelectorAll('[data-hidden-blocked="true"][data-nmb-reason="voice-timer-faked"]').forEach(el => this.api.dom.restoreElement(el));
    }

    fixVoiceCounters() {
        const voiceStore = this.api.stores.SortedVoiceStateStore;
        if (!voiceStore?.getVoiceStatesForChannel) return;
        const COUNTER_RE = /^\s*(\d+)\s*(?:\/\s*(\d+))?\s*$/;
        document.querySelectorAll('[class*="voiceUsers"], [class*="userLimit"]').forEach(counter => {
            const text = counter.textContent || "";
            const match = COUNTER_RE.exec(text);
            if (!match) return;
            const limit = match[2];
            const channel = counter.closest('[data-list-item-id], [id*="channels___"], [class*="voiceChannel"], [class*="channel-"]');
            const channelId = this.api.identity.findChannelId(channel);
            if (!channelId) return;
            const states = this.getRawVoiceStatesForChannel(channelId);
            const visible = states.filter(state => !this.api.visibility.shouldHide(this.api.identity.extractUserId(state))).length;
            _setTemporaryText(counter, limit ? `${visible} / ${limit}` : String(visible), "voiceChannels");
        });
    }

    _channelContainsSelf(channelId, states) {
        try {
            const selfId = this.api.identity.getSelfUserId();
            if (!selfId) return false;
            if (Array.isArray(states) && states.length) {
                return states.some(state => this.api.identity.extractUserId(state) === selfId);
            }
            const mySelectedVoiceChannel = this.api.stores.SelectedChannelStore?.getVoiceChannelId?.();
            return Boolean(mySelectedVoiceChannel && mySelectedVoiceChannel === channelId);
        } catch (_) {
            return false;
        }
    }

    fixVoiceChannelIconColors() {
        document.querySelectorAll('[data-list-item-id*="channels"], [class*="voiceChannel"], [class*="linkTop"], [class*="linkBottom"]').forEach(row => {
            const channelRow = row.closest?.(_SEL.channelRow) || row.closest?.("li") || row;
            const channelId = this.api.identity.findChannelId(channelRow) || this.api.identity.findChannelId(row);
            if (!channelId) return;
            const states = this.getRawVoiceStatesForChannel(channelId);
            const allHidden = states.length > 0 && states.every(state => this.api.visibility.shouldHide(this.api.identity.extractUserId(state)));
            const anyBlocked = states.length > 0 && states.some(state => this.api.visibility.shouldHide(this.api.identity.extractUserId(state)));
            const anyUnblockedPresent = states.length > 0 && states.some(state => !this.api.visibility.shouldHide(this.api.identity.extractUserId(state)));
            const activeOnlyByDom = !states.length && this.looksLikeHiddenOnlyVoiceChannel(channelRow);
            let timerState = this._voiceFakeTimers.get(channelId);
            let fakeResetExists = !!timerState;
            const emptySnapshotButWasHiddenOnly = !states.length && fakeResetExists && activeOnlyByDom;
            const isHiddenOnly = allHidden || activeOnlyByDom || emptySnapshotButWasHiddenOnly;
            const hasBlockedUsers = anyBlocked || activeOnlyByDom || emptySnapshotButWasHiddenOnly;
            const isMixedChannel = states.length > 0 && anyBlocked && anyUnblockedPresent;
            const selfInBlockedOnlyCall = this._isSelfInBlockedOnlyCall(channelId, states);
            const myVoiceChannelId = this.getSelfVoiceChannelId();
            const selfOnThisChannel = myVoiceChannelId === channelId
                || (!myVoiceChannelId && this._lastSelfVoiceChannelId === channelId);
            const selfDefinitelyElsewhere = myVoiceChannelId && myVoiceChannelId !== channelId;
            if (this.api.settings.voiceChannelsEnabled && selfInBlockedOnlyCall && selfOnThisChannel) {
                if (!timerState || timerState.joinStamp !== this._selfJoinTimestamp) {
                    this._resetFakeVoiceTimer(channelId);
                    timerState = this._voiceFakeTimers.get(channelId);
                    fakeResetExists = true;
                }
            }
            if (fakeResetExists && selfDefinitelyElsewhere) {
                this._voiceFakeTimers.delete(channelId);
                fakeResetExists = false;
            }
            if (!isHiddenOnly && !hasBlockedUsers) {
                this.restoreVoiceChannelIcon(channelRow);
                this.restoreVoiceChannelTimer(channelRow);
            } else if (isMixedChannel) {
                this.restoreVoiceChannelIcon(channelRow);
            } else {
                channelRow.dataset.nmbMutedVoice = "true";
                channelRow.querySelectorAll('svg, [class*="icon"], [class*="iconLive"]').forEach(icon => {
                    if (!icon.hasAttribute(_ATTR.prevIconStyle)) icon.setAttribute(_ATTR.prevIconStyle, icon.getAttribute("style") || "");
                    icon.style.setProperty("color", "var(--channels-default)", "important");
                    icon.style.setProperty("fill", "currentColor", "important");
                });
                if (this.api.settings.voiceChannelsEnabled && !fakeResetExists) {
                    channelRow.querySelectorAll('[class*="timer"], [class*="voiceTimer"], [role="timer"], [class*="tabularNumbers"]').forEach(el => {
                        this.api.dom.hideElement(el, "voice-timer");
                    });
                }
            }
            if (this.api.settings.voiceChannelsEnabled && fakeResetExists) {
                this._showFakeVoiceTimer(channelRow, channelId);
            } else {
                this._hideFakeVoiceTimer(channelRow, channelId);
            }
        });
    }

    looksLikeHiddenOnlyVoiceChannel(row) {
        const link = row.matches?.(_SEL.channelRow) ? row : row.querySelector?.(_SEL.channelRow);
        const label = `${link?.getAttribute?.("aria-label") || ""} ${row.textContent || ""}`;
        const hasLiveIcon = Boolean(row.querySelector?.('[class*="iconLive"]'));
        const durationLabels = [_locale(_getLocale(), this.api.constants.durationLocale), 'call duration', 'duration'].filter(Boolean);
        const hasCallDuration = durationLabels.some(l => label.toLowerCase().includes(l.toLowerCase()));
        if (!hasLiveIcon && !hasCallDuration) return false;
        const container = row.closest?.("li") || row;
        const visibleVoiceRows = Array.from(container.querySelectorAll?.('[class*="voiceUser"], [class*="voiceUser_"], [class*="voiceUser-"], [data-list-item-id*="voice"]') || []).filter(el => el.dataset?.hiddenBlocked !== "true" && el.offsetParent !== null);
        return visibleVoiceRows.length === 0;
    }

    restoreVoiceChannelIcon(row) {
        if (!row?.dataset?.nmbMutedVoice) return;
        delete row.dataset.nmbMutedVoice;
        row.querySelectorAll("[data-nmb-prev-icon-style]").forEach(icon => {
            const previous = icon.getAttribute(_ATTR.prevIconStyle);
            if (previous) icon.setAttribute("style", previous); else icon.removeAttribute("style");
            icon.removeAttribute(_ATTR.prevIconStyle);
        });
    }

    restoreVoiceChannelTimer(row) {
        row?.querySelectorAll?.('[data-hidden-blocked="true"][data-nmb-reason="voice-timer"]').forEach(el => this.api.dom.restoreElement(el));
    }

    _getRtcParticipantIdsForChannel(channelId) {
        const mod = this.api.stores.RTCParticipantsModule;
        if (!mod || !channelId) return null;
        try {
            const raw = mod.getParticipants ? mod.getParticipants(channelId) : mod.getVoiceParticipants(channelId);
            if (!Array.isArray(raw)) return null;
            const ids = raw.map(p => p?.user?.id || p?.id || this.api.identity.extractUserId(p)).filter(Boolean);
            return ids.length ? ids : null;
        } catch (_) {
            return null;
        }
    }

    getRawVoiceStatesForChannel(channelId) {
        const rtcIds = this._getRtcParticipantIdsForChannel(channelId);
        const gatewayStates = this._getRawVoiceStatesForChannelViaGateway(channelId, rtcIds);
        if (!rtcIds) return gatewayStates;

        const gatewayIds = new Set((gatewayStates || []).map(s => this.api.identity.extractUserId(s)));
        const missingIds = rtcIds.filter(id => id && !gatewayIds.has(id));
        if (!missingIds.length) return gatewayStates;

        const synthesized = missingIds
            .map(id => ({ userId: id, channelId }));
        return [...(gatewayStates || []), ...synthesized];
    }

    _readVoiceStatesWithSignature(signature, channelId, fn, reportFailure = true) {
        const normalize = raw => raw && typeof raw === "object"
            ? (Array.isArray(raw) ? raw : Object.values(raw)) : null;
        try {
            if (signature === 1) {
                const channel = this.api.stores.ChannelStore?.getChannel?.(channelId);
                if (!channel || !fn) return null;
                return normalize(fn(channel));
            }
            if (signature === 2) {
                const guildId = this.api.stores.ChannelStore?.getChannel?.(channelId)?.guild_id || this.api.stores.SelectedGuildStore?.getGuildId?.();
                if (!guildId || !fn) return null;
                return normalize(fn(guildId, channelId));
            }
            if (signature === 3) return fn ? normalize(fn(channelId)) : null;
            if (signature === 4) {
                const guildId = this.api.stores.ChannelStore?.getChannel?.(channelId)?.guild_id || this.api.stores.SelectedGuildStore?.getGuildId?.();
                const byGuild = guildId && this.api.originalVoiceMethods.getVoiceStates ? this.api.originalVoiceMethods.getVoiceStates(guildId) : null;
                return normalize(byGuild?.[channelId]);
            }
        } catch (error) {
            if (reportFailure) _recordPatchCatch("voice.learnedSignature:" + signature, this, error);
        }
        return null;
    }
    _getRawVoiceStatesForChannelViaGateway(channelId, knownRtcIds = null) {
        const store = this.api.stores.SortedVoiceStateStore;
        const original = this.api.originalVoiceMethods.getVoiceStatesForChannel;
        const source = original || store?.getVoiceStatesForChannel;
        const guildSource = this.api.originalVoiceMethods.getVoiceStates;
        if (this._voiceStateCallSource !== source || this._voiceStateGuildSource !== guildSource) {
            this._voiceStateCallSource = source;
            this._voiceStateGuildSource = guildSource;
            this._voiceStateCallSig = null;
            this._voiceStateCallSigMisses = 0;
        }
        const fn = original || (typeof source === "function" ? source.bind(store) : null);
        const hasKnownParticipants = Array.isArray(knownRtcIds) && knownRtcIds.length > 0;
        const learned = this._voiceStateCallSig;
        if (learned) {
            const states = this._readVoiceStatesWithSignature(learned, channelId, fn);
            if (states !== null) {
                if (states.length || !hasKnownParticipants) {
                    this._voiceStateCallSigMisses = 0;
                    return states;
                }
                this._voiceStateCallSigMisses = (this._voiceStateCallSigMisses || 0) + 1;
                if (this._voiceStateCallSigMisses < 30) return [];
            }
            this._voiceStateCallSig = null;
            this._voiceStateCallSigMisses = 0;
        }
        for (const signature of (fn ? [1, 2, 3, 4] : [4])) {
            const states = this._readVoiceStatesWithSignature(signature, channelId, fn, false);
            if (states === null) continue;
            if (states.length || !hasKnownParticipants) {
                this._voiceStateCallSig = signature;
                return states;
            }
        }
        return [];
    }

    isVoiceChannelShell(el) {
        if (!el) return false;
        const text = String(el.className || "");
        return text.includes("voiceChannel") || text.includes("linkTop") || text.includes("linkBottom") || Boolean(el.querySelector?.('[class*="channelInfo"]'));
    }
    registerHealthChecks() {
        this.api.health.register(
            "voice",
            () => {
                if (!this.api.settings.voiceChannelsEnabled) return true;
                const els = document.querySelectorAll(this.api.selectors.voiceUsers);
                let sample = 0;
                for (let i = 0; i < els.length && sample < 40; i++) {
                    sample++;
                    const userId = this.api.identity.findUserId(els[i]);
                    if (userId && this.api.visibility.shouldHide(userId)) return false;
                }
                return true;
            },
            () => {
                if (this.api.coordination.scanInFlight) return;
                try { this.api.coordination.queueScan(); } catch (error) { _recordPatchCatch("voice.healthRescan", this, error); }
            }
        );
        this.api.health.register(
            "voiceAudio",
            () => {
                if (!this.api.settings.muteBlockedVoiceAudio) return true;
                try {
                    const channelId = this.getSelfVoiceChannelId();
                    if (!channelId) return true;
                    const selfId = this.api.identity.getSelfUserId();
                    const states = this.getRawVoiceStatesForChannel(channelId) || [];
                    const shouldBeMuted = states.map(s => this.api.identity.extractUserId(s)).filter(id => id && id !== selfId && this.api.visibility.shouldHide(id));
                    if (!shouldBeMuted.length) return true;
                    for (const userId of shouldBeMuted) {
                        if (!this._mutedBlockedUserIds?.has(userId)) return false;
                        try { if (this.api.localMute.isMuted(userId, "default") === false) return false; }
                        catch (error) { _recordPatchCatch("voiceAudio.localMuteHealthCheck", this, error); }
                    }
                    return true;
                } catch (error) {
                    _recordPatchCatch("voiceAudio.healthCheck", this, error);
                    return true;
                }
            },
            () => {
                try {
                    const channelId = this.getSelfVoiceChannelId();
                    if (channelId) this.applyVoiceMuteForChannel(channelId);
                } catch (error) { _recordPatchCatch("voiceAudio.repair", this, error); }
            }
        );
        this.api.health.register(
            "voiceUserComponentPatch",
            () => !this.api.settings.voiceChannelsEnabled || !!this.voiceUserComponentPatched,
            () => {
                this.api.diagnostics.loggerWarn("The voice user component patch appears inactive - Discord may have changed the component's structure. Consider updating the plugin.");
                try { this.patchVoiceUserComponent(); } catch (error) { _recordPatchCatch("voiceUserComponent.patchRepair", this, error); }
            }
        );
        this.api.health.register(
            "activityPanelPatch",
            () => !this.api.settings.voiceChannelsEnabled || this.api.health.activityPanelPatched,
            () => {
                this.api.diagnostics.loggerWarn("The activity panel patch appears inactive - Discord may have changed the component's structure. Consider updating the plugin.");
                try { this.api.health.repatchActivityPanel(); } catch (error) { _recordPatchCatch("activityPanel.patchRepair", this, error); }
            }
        );
        this.api.health.register(
            "voiceSound",
            () => {
                try { return !this.api.health.soundEnabled() || this.api.health.soundPatchHealthy(); }
                catch (_) { return false; }
            },
            () => { try { this.api.health.repairSoundPatch(); } catch (error) { _recordPatchCatch("voice.soundPatchRepair", this, error); } }
        );
    }
}
function createStageSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({
            get voiceChannelsEnabled() { return !!plugin.settings?.places?.voiceChannels; },
        }),
        constants: Object.freeze({
            get STAGE_USER_SELECTOR() { return plugin.constructor.STAGE_USER_SELECTOR; },
            get CHANNEL_TYPES() { return plugin.constructor.CHANNEL_TYPES; },
        }),
        stores: Object.freeze({
            get StageChannelParticipantStore() { return plugin.modules.StageChannelParticipantStore; },
            get SelectedGuildStore() { return plugin.modules.SelectedGuildStore; },
            get SelectedChannelStore() { return plugin.modules.SelectedChannelStore; },
            get StageInstanceStore() { return plugin.modules.StageInstanceStore; },
            get VoiceStateStore() { return plugin.modules.VoiceStateStore; },
            get ChannelStore() { return plugin.modules.ChannelStore; },
        }),
        originalMethods: Object.freeze({
            get getMutableParticipants() { return plugin.originalStageMethods?.getMutableParticipants; },
            get getGuildScheduledEventsForGuild() { return plugin.originalEventMethods?.getGuildScheduledEventsForGuild; },
        }),
        identity: Object.freeze({
            findUserId: element => plugin.findUserId(element),
            extractUserId: value => plugin.extractUserId(value),
        }),
        visibility: _surfaceUserVisibility(plugin),
        dom: Object.freeze({
            hideElement: (...args) => plugin.hideElement(...args),
            restoreElement: element => plugin.restoreElement(element),
        }),
        fiber: _surfaceFiberProps(plugin),
        voice: Object.freeze({
            getRawVoiceStatesForChannel: channelId => plugin._surfaces.voice.getRawVoiceStatesForChannel(channelId),
            get userComponentPatched() { return !!plugin._surfaces.voice.voiceUserComponentPatched; },
        }),
        resources: Object.freeze({
            timer: (...args) => plugin._resources.timer(...args),
            onDispose: (...args) => plugin._resources.onDispose(...args),
        }),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            patchComponent: (...args) => plugin._patcher.patchComponent(...args),
            instead: (...args) => plugin.patchInstead(...args),
            logFailure: (...args) => plugin._patcher?._logFail(...args),
        }),
        diagnostics: Object.freeze({
            info: (...args) => plugin.logger?.info(...args),
            warn: (...args) => plugin.logger?.warn(...args),
            throttled: (...args) => plugin._logThrottled(...args),
        }),
        health: Object.freeze({
            register: (...args) => plugin._health?.register(...args),
            hasBlockedUserInSample: selector => plugin._hasBlockedUserInSample(selector),
        }),
        coordination: Object.freeze({
            get scanInFlight() { return plugin.scanInFlight; },
            queueScan: (...args) => plugin.queueScan(...args),
        }),
        retry: _surfaceRetry(plugin, ["schedule"]),
    });
}

class StageSurface {
    constructor(api) {
        this.api = api;
        this._resetRenderState();
    }
    _resetRenderState() {
        this._stageRenderComponentPatched = false;
        this._stageRenderComponentUnavailable = false;
        this._stageRenderComponentPatchInProgress = false;
        this._stageRenderUnpatchFns = [];
        this._stageBadgeRetryPending = null;
        this._stageNoticeRetryPending = false;
    }
    registerHealthChecks() {
        this.api.health.register(
            "stage",
            () => !this.api.settings.voiceChannelsEnabled || !this.api.health.hasBlockedUserInSample(this.api.constants.STAGE_USER_SELECTOR),
            () => {
                if (this.api.coordination.scanInFlight) return;
                try { this.api.coordination.queueScan(); } catch (error) { _recordPatchCatch("stage.healthRescan", this, error); }
            }
        );
        this.api.health.register(
            "stageRenderPatch",
            () => {
                if (!this.api.settings.voiceChannelsEnabled || this._stageRenderComponentUnavailable) return true;
                return !!this._stageRenderComponentPatched;
            },
            () => {
                if (this._stageRenderComponentUnavailable) return;
                if (this.api.voice.userComponentPatched) {
                    this.api.diagnostics.info("The dedicated stage render patch appears inactive, but patchVoiceUserComponent is active and already covers blocked users in Stage/voice channels. No action needed.");
                } else {
                    this.api.diagnostics.warn("The stage render patch appears inactive - Discord may have changed the component's structure. Consider updating the plugin.");
                }
                try { this._stageRenderComponentPatched = false; this.patchStageRenderComponent(); } catch (error) { _recordPatchCatch("stage.renderPatchRepair", this, error); }
            },
            2,
            () => this.api.voice.userComponentPatched
        );
    }
    scan() {
        this.hideStageUsers();
        this.fixStageAudienceCount();
        this.hideStageSpeakerRequests();
        this.hideBlockedStageNotice();
    }
    patchDeferred() {
        this.api.patching.safe('patchStageRenderComponent', () => this.patchStageRenderComponent());
    }
    stop() {
        this._resetRenderState();
    }
    patchStageRenderComponent(attempt = 0) {
        this.api.patching.patchComponent({
            label: "patchStageRenderComponent",
            attempt,
            maxAttempts: 8,
            delayMs: 3000,
            terms: ["seats", "claimedSeat", "speaking", "roomParticipants"],
            requiredMatches: 2,
            unpatchFnsKey: "_stageRenderUnpatchFns",
            inProgressKey: "_stageRenderComponentPatchInProgress",
            self: this,
            isPatched() { return this._stageRenderComponentPatched || this._stageRenderComponentUnavailable; },
            applyPatch(resolved, unpatchFns) {
                const self = this;
                const unpatch = self.api.patching.instead(resolved.target, resolved.key, function(ctx, args, orig) {
                    try {
                        const props = args?.[0] || ctx?.props;
                        if (!props) return orig.apply(ctx, args);
                        const p = props.participant;
                        const uid = p?.userId || p?.user?.id || props.user?.id || props.userId;
                        if (uid && self.api.settings.voiceChannelsEnabled && self.api.visibility.shouldHide(uid)) return null;
                    } catch (_) { _recordPatchCatch("patchStageRenderComponent.callback"); }
                    return orig.apply(ctx, args);
                });
                if (typeof unpatch !== "function") return false;
                unpatchFns.push(unpatch);
                this._stageRenderComponentPatched = true;
                return true;
            },
            onExhausted() {
                this.api.retry.schedule(() => {
                    if (typeof this._finalizeStageRenderComponentUnavailable === 'function') {
                        this._finalizeStageRenderComponentUnavailable();
                    }
                }, 4000);
            }
        });
    }
    _finalizeStageRenderComponentUnavailable() {
        if (this._stageRenderComponentPatched) return;
        this._stageRenderComponentUnavailable = true;
        this._stageRenderComponentPatchInProgress = false;
        if (this.api.voice.userComponentPatched) {
            this.api.diagnostics.info("patchStageRenderComponent: dedicated Stage seat component no longer found (likely merged into the voice-user row in a recent Discord update). No action needed - patchVoiceUserComponent and the DOM fallback already cover blocked users in Stage/voice channels.");
        } else {
            this.api.patching.logFailure("patchStageRenderComponent", new Error("ran out of attempts - weak indicators did not find the module; this dedicated stage seat component may have been merged into the voice user row / call grid components in a recent Discord update, both of which have their own independent patches. See maintenance notes."));
        }
    }
    hideStageUsers() {
        _hideBlockedRows(this, this.api.constants.STAGE_USER_SELECTOR, "stage-user");
        const stageStore = this.api.stores.StageChannelParticipantStore;
        const guildId = this.api.stores.SelectedGuildStore?.getGuildId?.();
        if (stageStore) this._clearBlockedStageSubtitles(stageStore, guildId);
    }
    _readStageParticipants(cid, stageStore) {
        const orig = this.api.originalMethods.getMutableParticipants;
        if (orig) {
            try { return orig(cid); } catch (error) { _recordPatchCatch("StageSurface.hideStageUsers.fallback1", this, error); }
        }
        try { return stageStore?.getMutableParticipants?.(cid); } catch (error) { _recordPatchCatch("StageSurface.hideStageUsers.fallback2", this, error); }
        return null;
    }
    _readStageGuildEvents(gid) {
        const orig = this.api.originalMethods.getGuildScheduledEventsForGuild;
        if (orig) {
            try { return orig(gid); } catch (error) { _recordPatchCatch("StageSurface.hideStageUsers.fallback3", this, error); }
        }
        return null;
    }
    _hasBlockedStageChannelActivity(cid, guildId, stageStore) {
        let hasBlockedParticipant = false;
        try {
            const raw = this._readStageParticipants(cid, stageStore);
            if (raw) {
                const list = Array.isArray(raw) ? raw : Object.values(raw);
                hasBlockedParticipant = list.some(p => {
                    const uid = this.api.identity.extractUserId(p);
                    return uid && this.api.visibility.shouldHide(uid);
                });
            }
        } catch (error) { _recordPatchCatch("stage.scanParticipants", this, error); }
        if (!hasBlockedParticipant && guildId) {
            try {
                const events = this._readStageGuildEvents(guildId);
                if (events) {
                    const evList = Array.isArray(events) ? events : Object.values(events);
                    hasBlockedParticipant = evList.some(ev => {
                        if (String(ev.channel_id) !== cid && String(ev.channelId) !== cid) return false;
                        const creatorId = ev.creatorId || ev.creator_id || ev.creator?.id;
                        return creatorId && this.api.visibility.shouldHide(String(creatorId));
                    });
                }
            } catch (error) { _recordPatchCatch("stage.scanGuildEvents", this, error); }
        }
        return hasBlockedParticipant;
    }
    _clearBlockedStageSubtitles(stageStore, guildId) {
        const channels = document.querySelectorAll('[data-list-item-id^="channels___"]');
        for (const link of channels) {
            const match = link.getAttribute('data-list-item-id')?.match(/channels___(\d+)/);
            if (!match || !this._hasBlockedStageChannelActivity(match[1], guildId, stageStore)) continue;
            const subtitle = link.querySelector('[class*="subtitle__"]');
            if (subtitle && subtitle.textContent.trim()) _setTemporaryText(subtitle, "", "voiceChannels");
        }
    }
    fixStageAudienceCount() {
        try {
            const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
            const stageStore = this.api.stores.StageChannelParticipantStore;
            let correctCount = null;
            if (channelId && stageStore) {
                try {
                    const isSpeaker = p => p && (p.role === "speaker" || p.type === "speaker" || p.speaker === true);
                    const audience = stageStore.getAudience?.(channelId) ?? stageStore.getListeners?.(channelId);
                    if (audience) {
                        const list = Array.isArray(audience) ? audience : Object.values(audience);
                        correctCount = list.filter(p => {
                            const uid = this.api.identity.extractUserId(p);
                            return !uid || !this.api.visibility.shouldHide(uid);
                        }).length;
                    } else {
                        const all = stageStore.getMutableParticipants?.(channelId);
                        if (all) {
                            const list = Array.isArray(all) ? all : Object.values(all);
                            correctCount = list.filter(p => {
                                if (isSpeaker(p)) return false;
                                const uid = this.api.identity.extractUserId(p);
                                return !uid || !this.api.visibility.shouldHide(uid);
                            }).length;
                        }
                    }
                } catch (error) { _recordPatchCatch("stage.audienceCount", this, error); }
            }
            if (correctCount === null) return;

            const replaceNum = (el, val) => { _setTemporaryText(el, el.textContent.replace(/\d+/, String(val)), "voiceChannels"); };
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

            const headers = document.querySelectorAll('[class*="text__"]');
            for (let i = 0; i < headers.length; i++) {
                if (hasNum(headers[i]) && /[\u2014\u2013-]/.test(headers[i].textContent)) {
                    replaceNum(headers[i], correctCount);
                }
            }
        } catch (error) { _recordPatchCatch("stage.fixAudienceCount", this, error); }
    }
    _setStageHandBadgeCount(badge, count) {
        const iconContainer = badge.closest('[class*="raisedHandIcon_"]') || badge.parentElement;
        const svg = iconContainer ? iconContainer.querySelector("svg") : null;
        if (count > 0) {
            if (badge.dataset.nmbHandOverride === "empty") {
                const prevStyle = badge.getAttribute("data-nmb-hand-prev-style");
                if (prevStyle) badge.setAttribute("style", prevStyle); else badge.removeAttribute("style");
                badge.removeAttribute("data-nmb-hand-prev-style");
                delete badge.dataset.nmbHandOverride;
            }
            _setTemporaryText(badge, String(count), "voiceChannels");
            if (svg) this._restoreHandIconMaskCutout(svg);
            return;
        }
        if (badge.dataset.nmbHandOverride !== "empty") {
            badge.setAttribute("data-nmb-hand-prev-style", badge.getAttribute("style") || "");
        }
        _setTemporaryText(badge, "", "voiceChannels");
        badge.style.setProperty("display", "none", "important");
        badge.dataset.nmbHandOverride = "empty";
        if (svg) this._fixHandIconMaskCutout(svg);
    }
    _getVisibleStageSpeakerRequestCount(channelId) {
        let visibleCount = 0;
        if (!this.api.stores.StageChannelParticipantStore) return visibleCount;
        try {
            const participants = this.api.stores.StageChannelParticipantStore.getMutableParticipants?.(channelId);
            const list = Array.isArray(participants) ? participants : (participants && typeof participants === "object" ? Object.values(participants) : []);
            const visible = list.filter(participant => {
                const userId = this.api.identity.extractUserId(participant);
                return !userId || !this.api.visibility.shouldHide(userId);
            });
            const requesters = visible.filter(participant =>
                participant?.voiceState?.requestToSpeakTimestamp || participant?.requestToSpeakTimestamp);
            visibleCount = requesters.length;
        } catch (error) { _recordPatchCatch("stage.speakerRequestCount", this, error); }
        return visibleCount;
    }
    hideStageSpeakerRequests() {
        try {
            const headingRe = /^(Pedidos para falar|Requests to Speak)(\s*[--]\s*\d+)?$/i;
            const headings = document.querySelectorAll('[class*="listTitle__"]');
            let anyPanelProcessed = false;
            let totalVisible = 0;
            let foundRelevantHeading = false;
            for (let h = 0; h < headings.length; h++) {
                const heading = headings[h];
                const text = (heading.textContent || "").trim();
                const match = text.match(headingRe);
                if (!match) continue;
                foundRelevantHeading = true;
                const baseLabel = match[1];
                const panel = heading.closest('[class*="content"]') || heading.parentElement;
                if (!panel) continue;
                anyPanelProcessed = true;
                const nativeEmpty = panel.querySelector('[class*="emptyStateContainer__"]');
                if (nativeEmpty) continue;
                const rowContainers = panel.querySelectorAll('[class*="participantRowContainer__"]');
                let anyHidden = false;
                let visible = 0;
                for (let i = 0; i < rowContainers.length; i++) {
                    const rowContainer = rowContainers[i];
                    const member = rowContainer.querySelector('[class*="participantMemberContainer__"]') || rowContainer;
                    if (rowContainer.dataset?.hiddenBlocked === "true") { anyHidden = true; continue; }
                    const userId = this.api.identity.findUserId(member);
                    if (userId && this.api.visibility.shouldHide(userId)) {
                        this.api.dom.hideElement(rowContainer, "stage-speaker-request", userId);
                        anyHidden = true;
                    } else {
                        visible++;
                    }
                }
                totalVisible += visible;
                if (!anyHidden) continue;
                if (visible > 0) {
                    _setTemporaryText(heading, `${baseLabel} - ${visible}`, "voiceChannels");
                    continue;
                }
                _setTemporaryText(heading, baseLabel, "voiceChannels");
            }
            if (foundRelevantHeading && anyPanelProcessed) {
                const badges = document.querySelectorAll('[class*="raisedHandCount__"]');
                for (let b = 0; b < badges.length; b++) this._setStageHandBadgeCount(badges[b], totalVisible);
                return;
            }
            const badges = document.querySelectorAll('[class*="raisedHandCount__"]');
            if (!badges.length) return;
            const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
            if (!channelId) return;
            const channel = this.api.stores.ChannelStore?.getChannel?.(channelId);
            if (!channel || channel.type !== 13) return;
            const storeVisible = this._getVisibleStageSpeakerRequestCount(channelId);
            for (let b = 0; b < badges.length; b++) this._setStageHandBadgeCount(badges[b], storeVisible);
        } catch (error) { _recordPatchCatch("stage.hideSpeakerRequests", this, error); }
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
    hideBlockedStageChannelNotice() {
        try {
            const notices = document.querySelectorAll(_SEL.channelNotice);
            for (let i = 0; i < notices.length; i++) {
                const notice = notices[i];
                const outer = notice.closest('[class*="container__"]') || notice;
                if (outer.dataset?.hiddenBlocked === "true") continue;
                const isLiveStageNotice = notice.querySelector('[class*="liveIndicator_"]') && notice.querySelector('[class*="stageIcon_"]');
                if (!isLiveStageNotice) continue;

                const channelId = this._resolveStageNoticeChannelId(notice);
                if (!channelId) {
                    this._retryStageNoticeSoon();
                    continue;
                }

                const uids = this._getStageChannelUserIds(channelId);
                if (!uids || !uids.length) {
                    this._retryStageNoticeSoon();
                    continue;
                }

                const allConnectedBlocked = uids.every(uid => this.api.visibility.shouldHide(uid));
                if (allConnectedBlocked) {
                    this.api.dom.hideElement(outer, "stage-channel-notice", false);
                }
            }
        } catch (error) { _recordPatchCatch("stage.hideChannelNotice", this, error); }
    }
    _retryStageNoticeSoon() {
        if (this._stageNoticeRetryPending) return;
        this._stageNoticeRetryPending = true;
        this.api.resources.onDispose('stage', () => { this._stageNoticeRetryPending = false; });
        this.api.resources.timer('stage', () => {
            this._stageNoticeRetryPending = false;
            try { this.hideBlockedStageChannelNotice(); } catch (error) { _recordPatchCatch("stage.noticeRetry", this, error); }
        }, 350);
    }

    _getStageChannelUserIds(channelId) {
        const ids = new Set();
        try {
            const vss = this.api.stores.VoiceStateStore;
            const map = vss?.getVoiceStatesForChannel?.(channelId);
            if (map && typeof map === "object") {
                for (const val of Object.values(map)) {
                    const uid = val?.userId || val?.user_id || val?.user?.id;
                    if (uid) ids.add(String(uid));
                }
            }
        } catch (error) { _recordPatchCatch("StageSurface._getStageChannelUserIds.fallback1", this, error); }
        if (!ids.size) {
            try {
                const states = this.api.voice.getRawVoiceStatesForChannel(channelId);
                (states || []).forEach(s => {
                    const uid = this.api.identity.extractUserId(s);
                    if (uid) ids.add(String(uid));
                });
            } catch (error) { _recordPatchCatch("StageSurface._getStageChannelUserIds.fallback2", this, error); }
        }
        return [...ids];
    }


    _resolveStageNoticeChannelId(notice) {

        try {
            const currentChannelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
            if (currentChannelId) {
                const ch = this.api.stores.ChannelStore?.getChannel?.(currentChannelId);
                if (ch?.type === this.api.constants.CHANNEL_TYPES.GUILD_STAGE_VOICE) return String(currentChannelId);
            }
        } catch (error) { _recordPatchCatch("StageSurface._resolveStageNoticeChannelId.fallback1", this, error); }


        try {
            const guildId = this.api.stores.SelectedGuildStore?.getGuildId?.();
            const stageStore = this.api.stores.StageInstanceStore;
            if (guildId && stageStore?.getStageInstancesByGuild) {
                const instances = stageStore.getStageInstancesByGuild(guildId);
                const channelIds = Object.keys(instances || {});
                if (channelIds.length === 1) return channelIds[0];
                if (channelIds.length > 1) {

                    const nameEl = notice.querySelector('[class*="eventName_"], [class*="channelName_"]');
                    const name = (nameEl?.textContent || "").trim();
                    if (name) {
                        for (const cid of channelIds) {
                            const inst = instances[cid];
                            if (inst?.topic === name) return cid;
                        }
                    }
                    return channelIds[0];
                }
            }
        } catch (error) { _recordPatchCatch("StageSurface._resolveStageNoticeChannelId.fallback2", this, error); }


        let found = null;
        this.api.fiber.walkProps(notice, props => {
            if (found || !props) return;
            const direct = props.channelId;
            if (direct && /^\d{17,20}$/.test(String(direct))) { found = String(direct); return; }
            const nested = props.channel?.id;
            if (nested && /^\d{17,20}$/.test(String(nested))) found = String(nested);
        }, 14);
        return found;
    }
    _areAllStageChannelUsersBlocked(channelId) {
        try {
            const uids = this._getStageChannelUserIds(channelId);
            if (!uids.length) return false;
            return uids.every(uid => this.api.visibility.shouldHide(uid));
        } catch (_) {
            return false;
        }
    }
    _isLiveStageBadge(badgeWrapper, itemContainer) {

        let found = null;
        try {
            this.api.fiber.walkProps(badgeWrapper, props => {
                if (found !== null || !props) return;
                if (typeof props.mediaState?.liveStage === "boolean") found = props.mediaState.liveStage;
            }, 16);
            if (found === null && itemContainer) {
                this.api.fiber.walkProps(itemContainer, props => {
                    if (found !== null || !props) return;
                    if (typeof props.mediaState?.liveStage === "boolean") found = props.mediaState.liveStage;
                }, 16);
            }
        } catch (error) { _recordPatchCatch("StageSurface._isLiveStageBadge.fallback1", this, error); }
        if (found !== null) return found;


        try {
            const a11yText = Array.from(itemContainer.querySelectorAll('[class*="hiddenVisually"]')).map(s => s.textContent || "").join(" | ");
            return /palco ao vivo|stage.*live|live.*stage/i.test(a11yText);
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

                const isStageBadge = this._isLiveStageBadge(badgeWrapper, itemContainer);

                if (badgeWrapper.dataset?.hiddenBlocked === "true") {
                    if (!isStageBadge) {
                        this.api.dom.restoreElement(badgeWrapper);
                        this._restoreGuildIconMask(itemContainer);
                        continue;
                    }
                    const guildIdRecheck = this._resolveGuildIdFromItem(itemContainer);
                    const channelIdRecheck = guildIdRecheck ? this._resolveGuildActiveStageChannelId(guildIdRecheck) : null;
                    const stillAllBlocked = channelIdRecheck ? this._areAllStageChannelUsersBlocked(channelIdRecheck) : true;
                    if (!stillAllBlocked) {
                        this.api.dom.restoreElement(badgeWrapper);
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
                if (!channelId) {
                    this._retryStageBadgeSoon(guildId);
                    continue;
                }

                const uids = this._getStageChannelUserIds(channelId);
                if (!uids.length) {
                    this._retryStageBadgeSoon(guildId);
                    continue;
                }

                const allConnectedBlocked = uids.every(uid => this.api.visibility.shouldHide(uid));
                if (allConnectedBlocked) {
                    this.api.dom.hideElement(badgeWrapper, "guild-stage-badge", false);
                    this._fixGuildIconMaskForHiddenBadge(itemContainer);
                }
            }
        } catch (error) { _recordPatchCatch("stage.hideGuildBadge", this, error); }
    }
    _retryStageBadgeSoon(guildId) {
        const key = String(guildId || "any");
        if (this._stageBadgeRetryPending?.[key]) return;
        if (!this._stageBadgeRetryPending) this._stageBadgeRetryPending = {};
        this._stageBadgeRetryPending[key] = true;
        this.api.resources.onDispose('stage', () => { if (this._stageBadgeRetryPending) delete this._stageBadgeRetryPending[key]; });
        this.api.resources.timer('stage', () => {
            if (this._stageBadgeRetryPending) delete this._stageBadgeRetryPending[key];
            try { this.hideBlockedGuildStageBadge(); } catch (error) { _recordPatchCatch("stage.badgeRetry", this, error); }
        }, 350);
    }
    _findGuildIconMaskSvg(itemContainer) {
        try {
            const direct = itemContainer.querySelector('svg:has(foreignObject[mask]), svg:has(foreignObject[data-nmb-mask-fixed="true"])');
            if (direct) return direct;
        } catch (error) { _recordPatchCatch("StageSurface._findGuildIconMaskSvg.fallback1", this, error); }
        const svgs = itemContainer.querySelectorAll('svg');
        for (const svg of svgs) {
            if (svg.querySelector('foreignObject[mask]') || svg.querySelector('foreignObject[data-nmb-mask-fixed="true"]')) return svg;
        }
        const fallback = itemContainer.querySelector('svg[class*="svg_cc5dd2"]');
        if (fallback) {
            this.api.diagnostics.throttled("_findGuildIconMaskSvg:obfuscatedFallback", "Using obfuscated class fallback (svg_cc5dd2) - Discord's structural markers weren't found. This selector may break on the next Discord update.");
        }
        return fallback;
    }
    _restoreGuildIconMask(itemContainer) {
        try {
            const svg = this._findGuildIconMaskSvg(itemContainer);
            if (!svg) return;
            const fixedForeignObjects = svg.querySelectorAll('foreignObject[data-nmb-mask-fixed="true"]');
            if (!fixedForeignObjects.length) return;
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
        } catch (err) {
            this.api.patching.logFailure("_restoreGuildIconMask", err);
        }
    }
    _fixGuildIconMaskForHiddenBadge(itemContainer) {
        try {
            const svg = this._findGuildIconMaskSvg(itemContainer);
            if (!svg) return;
            const foreignObjects = svg.querySelectorAll("foreignObject[mask]");
            if (!foreignObjects.length) return;
            for (let i = 0; i < foreignObjects.length; i++) {
                const fo = foreignObjects[i];
                if (fo.dataset?.nmbMaskFixed === "true") continue;
                const maskAttr = fo.getAttribute("mask") || "";
                const maskIdMatch = maskAttr.match(/url\(#([^)]+)\)/);
                if (!maskIdMatch) continue;
                const maskId = maskIdMatch[1];
                const maskEl = svg.querySelector(`mask#${CSS.escape(maskId)}`) || document.getElementById(maskId);
                if (!maskEl) continue;
                const usesBadgeCutout = !!maskEl.querySelector('[id*="upper_badge_masks"]') || Array.from(maskEl.querySelectorAll("use")).some(useEl => {
                    const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href") || "";
                    return href.includes("upper_badge_masks");
                });
                if (!usesBadgeCutout) continue;
                fo.setAttribute("data-nmb-prev-mask", maskAttr);
                fo.setAttribute("mask", "url(#svg-mask-squircle)");
                fo.dataset.nmbMaskFixed = "true";
            }
            const strokeMasks = svg.querySelectorAll('mask[id*="-stroke_mask"]');
            for (let i = 0; i < strokeMasks.length; i++) {
                const strokeMask = strokeMasks[i];
                if (!strokeMask || !strokeMask.innerHTML.includes("upper_badge_masks")) continue;
                const maskId = strokeMask.id;
                if (!maskId) continue;
                const usersOfStroke = svg.querySelectorAll(`[mask="url(#${maskId})"]`);
                if (!usersOfStroke.length) continue;
                usersOfStroke.forEach(el => {
                    if (el.dataset?.nmbStrokeHidden === "true") return;
                    el.style.setProperty("display", "none", "important");
                    el.dataset.nmbStrokeHidden = "true";
                });
            }
        } catch (err) {
            this.api.patching.logFailure("_fixGuildIconMaskForHiddenBadge", err);
        }
    }
    _fixHandIconMaskCutout(svg) {
        if (!svg || !svg.querySelectorAll) return;
        try {
            const gEls = svg.querySelectorAll("g[mask]");
            if (!gEls.length) return;
            for (let i = 0; i < gEls.length; i++) {
                const maskAttr = gEls[i].getAttribute("mask") || "";
                const maskIdMatch = maskAttr.match(/url\(#([^)]+)\)/);
                if (!maskIdMatch) continue;
                const maskId = maskIdMatch[1];
                if (!maskId) continue;
                const maskEl = svg.querySelector(`mask#${CSS.escape(maskId)}`) || document.getElementById(maskId);
                if (!maskEl || maskEl.dataset?.nmbHandMaskFixed === "true") continue;
                const cutout = maskEl.querySelector('circle[fill="black"], circle[fill="#000"], circle[fill="#000000"]');
                if (!cutout) continue;
                const placeholder = document.createComment("nmb-hand-cutout");
                cutout.replaceWith(placeholder);
                maskEl._nmbCutoutEl = cutout;
                maskEl._nmbCutoutPlaceholder = placeholder;
                maskEl.dataset.nmbHandMaskFixed = "true";
            }
        } catch (error) { _recordPatchCatch("StageSurface._fixHandIconMaskCutout.L7713", null, error); }
    }
    _restoreHandIconMaskCutout(svg) {
        if (!svg || !svg.querySelectorAll) return;
        try {
            const fixedMasks = svg.querySelectorAll('mask[data-nmb-hand-mask-fixed="true"]');
            if (!fixedMasks.length) return;
            fixedMasks.forEach(maskEl => {
                if (maskEl._nmbCutoutEl && maskEl._nmbCutoutPlaceholder) {
                    maskEl._nmbCutoutPlaceholder.replaceWith(maskEl._nmbCutoutEl);
                }
                delete maskEl._nmbCutoutEl;
                delete maskEl._nmbCutoutPlaceholder;
                delete maskEl.dataset.nmbHandMaskFixed;
            });
        } catch (error) { _recordPatchCatch("StageSurface._restoreHandIconMaskCutout.L7728", null, error); }
    }
    _resolveGuildIdFromItem(itemContainer) {
        const withListId = itemContainer.querySelector('[data-list-item-id^="guildsnav___"]') || (itemContainer.dataset?.listItemId ? itemContainer : null);
        if (withListId) {
            const listId = withListId.dataset?.listItemId || withListId.getAttribute("data-list-item-id") || "";
            const match = listId.match(/(\d{17,20})$/);
            if (match) return match[1];
        }
        let found = null;
        try {
            const selectedGuildId = this.api.stores.SelectedGuildStore?.getGuildId?.();
            if (selectedGuildId && /^\d{17,20}$/.test(String(selectedGuildId))
                && itemContainer.querySelector(`[data-list-item-id^="guildsnav___${selectedGuildId}"]`)) {
                found = String(selectedGuildId);
            }
        } catch (error) { _recordPatchCatch("StageSurface._resolveGuildIdFromItem.fallback1", this, error); }
        if (!found) {
            this.api.fiber.walkProps(itemContainer, props => {
                if (found || !props) return;
                const direct = props.guildId ?? props.channel?.guild_id;
                if (direct && /^\d{17,20}$/.test(String(direct))) found = String(direct);
            }, 14);
        }
        return found;
    }
    _resolveGuildActiveStageChannelIdViaStore(guildId) {
        try {
            const store = this.api.stores.StageInstanceStore;
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
                currentGuildId = this.api.stores.SelectedGuildStore?.getGuildId?.();
            } catch (error) { _recordPatchCatch("StageSurface._resolveGuildActiveStageChannelId.fallback1", this, error); }
            if (!currentGuildId || !guildId || String(currentGuildId) !== String(guildId)) return null;

            const notice = document.querySelector(_SEL.channelNotice);
            if (!notice) return null;
            const isLiveStageNotice = notice.querySelector('[class*="liveIndicator_"]') && notice.querySelector('[class*="stageIcon_"]');
            if (!isLiveStageNotice) return null;

            return this._resolveStageNoticeChannelId(notice);
        } catch (_) {
            return null;
        }
    }
}
function createBadgeSurfaceApi(plugin) {
    return Object.freeze({
        get enabled() {
            return !!(plugin.settings.places?.messages && plugin.settings.behavior?.suppressTaskbarBadge && plugin._notifEnabled("notifMessages") && plugin._placeEnabled("recentDms"));
        },
        stores: Object.freeze({
            get RelationshipStore() { return plugin.modules.RelationshipStore; },
            get NotificationSettingsStore() { return plugin.modules.NotificationSettingsStore; },
        }),
        readState: Object.freeze({
            filteredTotalMentionCount: () => plugin._surfaces.readState.filteredTotalMentionCount(),
            filteredHasAnyUnread: () => plugin._surfaces.readState.filteredHasAnyUnread(),
            isPatched: () => plugin._surfaces.readState.isPatched(),
            hasPendingUnreadResolution: () => plugin._surfaces.readState.hasPendingUnreadResolution(),
        }),
        moduleResolver: Object.freeze({
            findByKeys: (...keys) => plugin._r.findByKeys(...keys),
        }),
        electron: Object.freeze({
            get resolved() { return plugin.modules.ElectronModule; },
            setResolved: module => { plugin.modules.ElectronModule = module; },
        }),
        patching: Object.freeze({
            before: (...args) => plugin._patcher.before(...args),
        }),
    });
}

class BadgeSurface {
    constructor(api) {
        this.api = api;
        this._badgeCountCache = null;
        this._taskbarElectronPatched = false;
    }
    stop() {
        this._badgeCountCache = null;
        this._taskbarElectronPatched = false;
    }
    taskbarBadgeEnabled() {
        return this.api.enabled;
    }
    invalidateTaskbarBadgeCache() {
        this._badgeCountCache = null;
    }
    _recomputeTaskbarBadgeCount() {
        const TTL_MS = 250;
        const cached = this._badgeCountCache;
        if (cached && (Date.now() - cached.ts) < TTL_MS) return cached.value;
        const value = this._recomputeTaskbarBadgeCountUncached();
        this._badgeCountCache = { ts: Date.now(), value };
        return value;
    }
    _recomputeTaskbarBadgeCountUncached() {
        try {
            const rs = this.api.stores.RelationshipStore;
            const nss = this.api.stores.NotificationSettingsStore;
            const mentionCount = this.api.readState.filteredTotalMentionCount();
            const pendingRequests = typeof rs?.getPendingCount === "function" ? rs.getPendingCount() : 0;
            const hasUnread = this.api.readState.filteredHasAnyUnread();
            const disableUnreadBadge = typeof nss?.getDisableUnreadBadge === "function" ? nss.getDisableUnreadBadge() : false;
            let total = mentionCount + pendingRequests;
            if (!total && hasUnread && !disableUnreadBadge) total = -1;
            return total;
        } catch (_) {
            return null;
        }
    }
    _filterBadgeArgs(args) {
        if (!this.taskbarBadgeEnabled()) { return; }
        const requestedCount = args[0];
        if (typeof requestedCount !== "number" || !Number.isFinite(requestedCount) || requestedCount === 0) return;
        if (!this.api.readState.isPatched()) {
            args[0] = 0;
            return;
        }
        if (this.api.readState.hasPendingUnreadResolution()) {
            args[0] = 0;
            return;
        }
        const count = this._recomputeTaskbarBadgeCount();
        if (count === null || !Number.isFinite(count)) return;
        if (requestedCount < 0) {
            args[0] = count !== 0 ? requestedCount : 0;
        } else if (count < 0) {
            args[0] = -1;
        } else {
            args[0] = Math.min(requestedCount, count);
        }
    }
    ensureTaskbarElectronPatch() {
        if (this._taskbarElectronPatched) return;
        const electron = this.api.moduleResolver.findByKeys("setBadge", "setSystemTrayIcon");
        if (!electron?.setBadge) return;
        this.api.electron.setResolved(electron);
        const self = this;
        const badgeBefore = (_, args) => { self._filterBadgeArgs(args); };
        this.api.patching.before(electron, "setBadge", badgeBefore);
        try {
            const nativeApp = typeof DiscordNative !== "undefined" ? DiscordNative?.app : null;
            if (nativeApp?.setBadgeCount) {
                this.api.patching.before(nativeApp, "setBadgeCount", badgeBefore);
            }
        } catch (error) { _recordPatchCatch("BadgeSurface.ensureTaskbarElectronPatch.L7892", null, error); }
        try {
            const altElectron = this.api.moduleResolver.findByKeys("setSystemTrayApplications", "setBadge");
            if (altElectron?.setBadge && altElectron !== electron) {
                this.api.patching.before(altElectron, "setBadge", badgeBefore);
            }
        } catch (error) { _recordPatchCatch("BadgeSurface.ensureTaskbarElectronPatch.L7898", null, error); }
        if (typeof electron.setSystemTrayIcon === "function") {
            this.api.patching.before(electron, "setSystemTrayIcon", (_, args) => {
                if (!self.taskbarBadgeEnabled()) return;
                if (!self.api.readState.isPatched()) {
                    if (args[0] === "UNREAD") args[0] = "DEFAULT";
                    return;
                }
                if (args[0] !== "UNREAD") return;
                const count = self._recomputeTaskbarBadgeCount();
                if (!count) args[0] = "DEFAULT";
            });
        }
        const flashModule = typeof electron.flashFrame === "function"
            ? electron
            : (typeof DiscordNative !== "undefined" && typeof DiscordNative?.window?.flashFrame === "function" ? DiscordNative.window : null);
        if (flashModule && typeof flashModule.flashFrame === "function") {
            this.api.patching.before(flashModule, "flashFrame", (_, args) => {
                if (!self.taskbarBadgeEnabled()) return;
                if (args[0] !== true && args[0] !== 1) return;
                const count = self._recomputeTaskbarBadgeCount();
                if (!count) args[0] = false;
            });
        }
        this._taskbarElectronPatched = true;
        if (this.taskbarBadgeEnabled()) {
            try {
                electron.setBadge(0);
            } catch (error) { _recordPatchCatch("badge.clearInitialCount", this, error); }
            try {
                if (typeof electron.setSystemTrayIcon === "function") electron.setSystemTrayIcon("DEFAULT");
            } catch (error) { _recordPatchCatch("badge.clearInitialTrayIcon", this, error); }
        }
    }
    refreshTaskbarBadge() {
        if (!this.taskbarBadgeEnabled()) return;
        this.invalidateTaskbarBadgeCache();
        try {
            if (!this.api.readState.isPatched() || this.api.readState.hasPendingUnreadResolution()) return;
            const electron = this.api.electron.resolved;
            if (!electron?.setBadge) return;
            const count = this._recomputeTaskbarBadgeCount();
            if (!Number.isFinite(count) || this.api.readState.hasPendingUnreadResolution()) return;
            electron.setBadge(count);
            if (typeof electron.setSystemTrayIcon === "function") {
                electron.setSystemTrayIcon(count === 0 ? "DEFAULT" : "UNREAD");
            }
        } catch (error) { _recordPatchCatch("badge.refreshTaskbarBadge", this, error); }
    }
}
function createCallSurfaceApi(plugin) {
    return Object.freeze({
        settings: Object.freeze({
            get voiceChannelsEnabled() { return !!plugin.settings?.places?.voiceChannels; },
            get blockRingingFromBlocked() { return !!plugin.settings?.behavior?.blockRingingFromBlocked; },
        }),
        stores: Object.freeze({
            get ChannelStore() { return plugin.modules.ChannelStore; },
            get Dispatcher() { return plugin.modules.Dispatcher; },
            get SelectedChannelStore() { return plugin.modules.SelectedChannelStore; },
            get CallStore() { return plugin.modules.CallStore; },
        }),
        constants: Object.freeze({ get ACTIONS() { return plugin.constructor.ACTIONS; } }),
        identity: Object.freeze({
            extractUserId: value => plugin.extractUserId(value),
            findUserId: element => plugin.findUserId(element),
            getSelfUserId: () => plugin._getSelfUserId(),
        }),
        visibility: _surfaceUserVisibility(plugin),
        dom: Object.freeze({
            hideElement: (...args) => plugin.hideElement(...args),
            restoreElement: element => plugin.restoreElement(element),
        }),
        fiber: Object.freeze({
            findComponent: (...args) => plugin.findComponentViaFiber(...args),
            getInternalInstance: element => BdApi.ReactUtils.getInternalInstance(element),
        }),
        voice: Object.freeze({ getRawVoiceStatesForChannel: channelId => plugin._surfaces.voice.getRawVoiceStatesForChannel(channelId) }),
        moduleResolver: Object.freeze({
            get: (...args) => plugin._r.get(...args),
            getBySourceAny: (...args) => plugin._r.getBySourceAny(...args),
        }),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            before: (...args) => plugin.patchBefore(...args),
            after: (...args) => plugin.patchAfter(...args),
            instead: (...args) => plugin.patchInstead(...args),
            patchMethod: (...args) => plugin._patcher.patchMethod(...args),
            warn: (...args) => plugin._patcher?._warn(...args),
            logFailure: (...args) => plugin._patcher?._logFail(...args),
            patchRenderBySourceHeuristic: (...args) => plugin._wpPatchRenderBySourceHeuristic(...args),
        }),
        resources: Object.freeze({ timer: (...args) => plugin._resources.timer(...args) }),
        retry: _surfaceRetry(plugin, ["delay","schedule"]),
        lifecycle: Object.freeze({
            get isRunning() { return plugin.isRunning; },
            watchBefore: (target, method, callback) => BdApi.Patcher.before(plugin.pluginName, target, method, callback),
        }),
        diagnostics: Object.freeze({
            throttled: (...args) => plugin._logThrottled(...args),
        }),
        health: Object.freeze({
            register: (...args) => plugin._health?.register(...args),
            hasBlockedUserInSample: selector => plugin._hasBlockedUserInSample(selector),
            scoredCandidateFor: label => plugin._r.scoredCandidateFor(label),
        }),
        coordination: Object.freeze({
            get scanInFlight() { return plugin.scanInFlight; },
            queueScan: (...args) => plugin.queueScan(...args),
        }),
    });
}

class CallSurface {
    static get CALL_BUTTONS_STRINGS() {
        return [ "chatOpen", "maxSidebarWidth", "_callContainerRef", "_channelChatRef", "_wrapperRef", "inCall", "channel", "guild" ];
    }
    static get CALL_BUTTONS_REQUIRED() { return 3; }
    constructor(api) {
        this.api = api;
        this.callGridPatched = false;
        this._callGridPatchInFlight = false;
        this._callGridJoinUnpatch = null;
        this._callRingingPatched = false;
        this._callUiPatched = false;
        this._unwatchCallCreateForHideBlockedCallUI = null;
        this.blockedRingingChannels = null;
        this.blockedAutoJoinGuard = null;
        this._ringtoneAudioPatched = false;
        this._ringtoneAudioUnpatch = null;
    }
    registerHealthChecks() {
        this.api.health.register(
            "callGrid",
            () => !this.api.settings.voiceChannelsEnabled || !this.api.health.hasBlockedUserInSample('[class*="tileSizer"], [class*="tile_"], [class*="videoWrapper_"], [class*="voiceUserTile"], [class*="participantWrapper_"]'),
            () => {
                const info = this.api.health.scoredCandidateFor("patchCallGridParticipants:perParticipant");
                if (info?.ambiguous) {
                    this.api.patching.warn("patchCallGridParticipants", new Error(`health check failed shortly after a scored patch (${info.hitCount}/${info.totalTermCount} terms, ${info.qualifyingCandidates} candidates tied) - the heuristic may have picked the wrong module. Consider tightening the term list for this patch.`));
                }
                if (this.api.coordination.scanInFlight) return;
                try { this.api.coordination.queueScan(); } catch (error) { _recordPatchCatch("callGrid.healthRescan", this, error); }
            }
        );
    }
    patchEarly() {
        this.api.patching.safe('patchCallGridParticipants', () => this.patchCallGridParticipants());
        this.api.patching.safe('watchVoiceJoinForGridPatch', () => this._watchVoiceJoinForGridPatch());
    }
    patchLate() {
        if (!this.api.settings.blockRingingFromBlocked) return;
        this.api.patching.safe('patchBlockedCallRinging', () => this.patchBlockedCallRinging());
        this.api.patching.safe('patchRingtoneAudio', () => this.patchRingtoneAudio());
        this.api.patching.safe('watchCallCreateForHideBlockedCallUI', () => this.watchCallCreateForHideBlockedCallUI());
    }
    stop() {
        this._callGridPatchInFlight = false;
        try { this._callGridJoinUnpatch?.(); } catch (error) { _recordPatchCatch("call.stopGridWatcher", this, error); }
        this._callGridJoinUnpatch = null;
        this.callGridPatched = false;
        this._callUiPatched = false;
        try {
            this.unpatchRingtoneAudio();
        } catch (error) { _recordPatchCatch("CallSurface.stop.L8051", null, error); }
        this._callRingingPatched = false;
        try {
            this.stopWatchCallCreateForHideBlockedCallUI();
        } catch (error) { _recordPatchCatch("CallSurface.stop.L8055", null, error); }
        this.blockedRingingChannels?.clear();
        this.blockedAutoJoinGuard?.clear();
    }
    _filterParticipantArray(arr) {
        if (!Array.isArray(arr) || !arr.length) return arr;
        let changed = false;
        const next = arr.filter(item => {
            const uid = this.api.identity.extractUserId(item) || this.api.identity.extractUserId(item?.props) || this.api.identity.extractUserId(item?.participant) || this.api.identity.extractUserId(item?.user);
            const hide = uid && this.api.visibility.shouldHide(uid);
            if (hide) changed = true;
            return !hide;
        });
        return changed ? next : arr;
    }
    _filterCallGridProps(props) {
        if (!props || typeof props !== "object") return;
        try {
            let anyFiltered = false;
            let newLength = null;
            for (const key of _CALL_PARTICIPANT_KEYS) {
                const arr = props[key];
                if (!Array.isArray(arr)) continue;
                const filtered = this._filterParticipantArray(arr);
                if (filtered !== arr) {
                    props[key] = filtered;
                    anyFiltered = true;
                    newLength = filtered.length;
                }
            }
            if (anyFiltered && typeof props.totalNumberOfParticipants === "number" && newLength !== null) {
                props.totalNumberOfParticipants = newLength;
            }
        } catch (error) { _recordPatchCatch("callGrid.filterProps", this, error); }
    }
    patchCallGridParticipants(attempt = 0) {
        if (!this.api.settings.voiceChannelsEnabled) return;
        if (this.callGridPatched) return;
        if (attempt === 0) {
            if (this._callGridPatchInFlight) return;
            this._callGridPatchInFlight = true;
        }
        const gridSelector = '[class*="gridLayout_"], [class*="callContainer_"], [class*="videoGrid_"], [class*="callGrid_"], [class*="videoContainer_"], [role="grid"]';
        const { component: GridClass, bestPropKeysSeen } = this._findLiveCallGridClass(gridSelector);
        if ((GridClass && this._tryPatchCallGridClass(GridClass)) || this._patchCallGridParticipantHeuristic()) {
            this.callGridPatched = true;
            this._callGridPatchInFlight = false;
            this.api.resources.timer('callGrid', () => { try { this.api.stores.ChannelStore?.emitChange?.(); } catch (error) { _recordPatchCatch("callGrid.emitChange", this, error); } }, 0);
            return;
        }

        if (attempt < 40) {
            this.api.retry.schedule(() => this.patchCallGridParticipants(attempt + 1), this.api.retry.delay(attempt, 3000));
        } else {
            this._callGridPatchInFlight = false;
            this.api.patching.logFailure("patchCallGridParticipants", new Error(`ran out of attempts - no grid-like element (matching ${gridSelector}) had a participant-shaped prop, and the per-participant source-heuristic lookup also failed. Closest array-shape candidate exposed: [${bestPropKeysSeen.join(", ") || "none"}]. Discord likely restructured the call grid further.`));
        }
    }
    _findLiveCallGridClass(gridSelector) {
        const self = this;
        const looksLikeParticipantArray = array => Array.isArray(array) && (array.length === 0 || array.some(participant => participant && typeof participant === "object" && (participant.userId || participant.user?.id || participant.id)));
        let bestPropKeysSeen = [];
        const els = document.querySelectorAll(gridSelector);
        for (const el of els) {
            const match = self.api.fiber.findComponent(el, (type, props) => {
                if (!props) return false;
                const matchedKeys = _CALL_PARTICIPANT_KEYS.filter(k => looksLikeParticipantArray(props[k]));
                if (matchedKeys.length > bestPropKeysSeen.length) bestPropKeysSeen = matchedKeys;
                if (Array.isArray(props.participants) && Array.isArray(props.filteredParticipants)) return true;
                return matchedKeys.length >= 1;
            }, 25, "patchCallGridParticipants:fiberWalk");
            if (match) return { component: match, bestPropKeysSeen };
        }
        return { component: null, bestPropKeysSeen };
    }
    _patchCallGridParticipantHeuristic() {
        const self = this;
        return self.api.patching.patchRenderBySourceHeuristic(
            props => {
                const user = props?.user;
                const uid = self.api.identity.extractUserId(user) || self.api.identity.extractUserId(props);
                return !!(uid && self.api.visibility.shouldHide(uid));
            },
            [ "isOwner", "nick", "activities", "colorString", "isMobileOnline", "isVROnline", "premiumSince" ],
            3,
            "patchCallGridParticipants:perParticipant"
        );
    }
    _tryPatchCallGridClass(GridClass) {
        const self = this;
        if (!GridClass?.prototype?.render) return false;
        if (GridClass.prototype.render.__nmbCallGridPatched) return true;
        try {
            const unpatch = self.api.patching.before(GridClass.prototype, "render", thisObj => {
                try { self._filterCallGridProps(thisObj?.props); } catch (error) { _recordPatchCatch("callGrid.renderFilter", self, error); }
            });
            if (typeof unpatch !== "function") return false;
            GridClass.prototype.render.__nmbCallGridPatched = true;
            return true;
        } catch (_) {
            return false;
        }
    }
    _watchVoiceJoinForGridPatch() {
        if (typeof this._callGridJoinUnpatch === "function") return true;
        const Dispatcher = this.api.stores.Dispatcher;
        if (!Dispatcher || typeof Dispatcher.dispatch !== "function") return false;
        const self = this;
        const unpatch = this.api.patching.before(Dispatcher, "dispatch", function(context, args) {
            try {
                const action = args[0];
                if (!action || typeof action !== "object") return;
                if (action.type !== self.api.constants.ACTIONS.VOICE_STATE_UPDATES || !Array.isArray(action.voiceStates)) return;
                if (self.callGridPatched || !self.api.settings.voiceChannelsEnabled) return;
                const selfId = self.api.identity.getSelfUserId();
                const selfJoined = action.voiceStates.some(vs => vs && (vs.userId || self.api.identity.extractUserId(vs)) === selfId && vs.channelId);
                if (!selfJoined) return;
                self.api.resources.timer('callGrid', () => {
                    if (self.api.lifecycle.isRunning && !self.callGridPatched) self.patchCallGridParticipants();
                }, 500);
            } catch (error) { _recordPatchCatch("callGrid.voiceJoinWatcher", self, error); }
        });
        if (typeof unpatch !== "function") return false;
        this._callGridJoinUnpatch = unpatch;
        return true;
    }
    hideBlockedRingingOverlay() {
        if (!this.api.settings.blockRingingFromBlocked) return;
        const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
        if (!channelId) return;
        const CallStore = this.api.stores.CallStore;
        const call = CallStore?.getCall?.(channelId);
        const hasRingingSignal = this.hasBlockedRinging(channelId);
        const { hasBlockedParticipant, blockedUserId } = this._readBlockedRingingParticipants(channelId);
        if (!this._shouldHideRingingOverlay(call, hasRingingSignal, hasBlockedParticipant)) {
            this._restoreBlockedRingingElements();
            return;
        }
        this._hideBlockedRingingCandidates(blockedUserId);
        this._collapseBlockedRingingWrappers();
    }
    _readBlockedRingingParticipants(channelId) {
        let hasBlockedParticipant = false;
        let blockedUserId = null;
        try {
            const states = this.api.voice.getRawVoiceStatesForChannel(channelId) || [];
            if (states.length) {
                const selfId = this.api.identity.getSelfUserId();
                const iAmIn = states.some(s => this.api.identity.extractUserId(s) === selfId);
                if (!iAmIn) {
                    const blocked = states.find(s => this.api.visibility.shouldHide(this.api.identity.extractUserId(s)));
                    if (blocked) {
                        hasBlockedParticipant = true;
                        blockedUserId = this.api.identity.extractUserId(blocked);
                    }
                }
            }
        } catch (error) { _recordPatchCatch("call.ringingVoiceStates", this, error); }
        return { hasBlockedParticipant, blockedUserId };
    }
    _shouldHideRingingOverlay(call, hasRingingSignal, hasBlockedParticipant) {
        return !!(hasRingingSignal || (call && hasBlockedParticipant));
    }
    _hideBlockedRingingCandidates(blockedUserId) {
        const candidates = document.querySelectorAll(
            '[class*="callContainer_"]:not([data-hidden-blocked="true"]),' +
            '[class*="ringingSection"]:not([data-hidden-blocked="true"]),' +
            '[class*="ringingBar_"]:not([data-hidden-blocked="true"]),' +
            '[class*="callSection_"]:not([data-hidden-blocked="true"]),' +
            '[class*="incomingCall"]:not([data-hidden-blocked="true"]),' +
            '[class*="noChannel"]:not([data-hidden-blocked="true"]),' +
            '[class*="emptyStatePreview"]:not([data-hidden-blocked="true"])'
        );
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (el.dataset?.hiddenBlocked === "true") continue;
            const hasAvatars = !!el.querySelector('img[class*="avatar" i], [class*="avatar_"]');
            const hasVoiceButtons = !!el.querySelector(
                'button[aria-label*="chamada" i], button[aria-label*="call" i],' +
                'button[aria-label*="vídeo" i], button[aria-label*="video" i]'
            ) || el.querySelectorAll('button:has(svg), [role="button"]:has(svg)').length >= 2;
            if (!hasAvatars || !hasVoiceButtons) continue;
            this.api.dom.hideElement(el, "blocked-ringing-overlay", blockedUserId);
        }
    }
    _collapseBlockedRingingWrappers() {
        const hiddenCalls = document.querySelectorAll(
            '[class*="callContainer_"][data-hidden-blocked="true"][data-nmb-reason="blocked-ringing-overlay"]'
        );
        for (const callEl of hiddenCalls) {
            const wrapper = callEl.closest('[class*="wrapper_"]');
            if (!wrapper || wrapper.dataset?.nmbRingingCollapsed === "true") continue;
            wrapper.dataset.nmbRingingCollapsed = "true";
            if (!wrapper.hasAttribute(_ATTR.prevRingingStyle)) {
                wrapper.setAttribute(_ATTR.prevRingingStyle, wrapper.getAttribute("style") || "");
            }
            const minClasses = Array.from(wrapper.classList).filter(c => c.includes('minimum'));
            if (minClasses.length > 0) {
                wrapper.dataset.nmbPrevMinClasses = minClasses.join(' ');
                wrapper.classList.remove(...minClasses);
            }
            wrapper.style.setProperty("min-height", "0", "important");
            wrapper.style.setProperty("background", "none", "important");
        }
    }
    restoreCollapsedRingingWrapper(wrapper, options = {}) {
        if (!wrapper) return;
        delete wrapper.dataset.nmbRingingCollapsed;
        const previousStyle = wrapper.getAttribute(_ATTR.prevRingingStyle);
        if (previousStyle != null && (options.preserveEmptyStyle || previousStyle)) wrapper.setAttribute("style", previousStyle);
        else wrapper.removeAttribute("style");
        wrapper.removeAttribute(_ATTR.prevRingingStyle);
        const previousMinClasses = wrapper.dataset?.nmbPrevMinClasses;
        if (previousMinClasses) {
            const classes = previousMinClasses.split(' ');
            wrapper.classList.add(...(options.filterEmptyClasses ? classes.filter(Boolean) : classes));
            delete wrapper.dataset.nmbPrevMinClasses;
        }
        if (options.clearMinClassAttribute) wrapper.removeAttribute("data-nmb-prev-min-classes");
    }
    _restoreBlockedRingingElements() {
        const hidden = document.querySelectorAll('[data-hidden-blocked="true"][data-nmb-reason="blocked-ringing-overlay"]');
        for (const el of hidden) {
            this.api.dom.restoreElement(el);
            this.restoreCollapsedRingingWrapper(el.closest('[class*="wrapper_"]'));
        }
    }
    hideCallGridTiles() {
        _hideBlockedRows(
            this,
            '[class*="tileSizer"], [class*="tile_"], [class*="videoWrapper_"], [class*="voiceUserTile"], [class*="participants_"] > *, [class*="gridLayout_"] [class*="participant"], [class*="callContainer_"] [class*="wrapper_"], [class*="participantWrapper_"], [aria-label*="grid" i] [class*="participant"], [role="grid"] [class*="participant"]',
            "call-grid-tile",
            el => el.closest('[class*="tileSizer"]') || el.closest('[class*="tile_"]') || el.closest('[class*="participantWrapper_"]') || el.closest('[class*="videoWrapper_"]') || el
        );
    }
    patchBlockedCallRinging(attempt = 0) {
        this.api.patching.patchMethod({
            label: "patchBlockedCallRinging",
            attempt,
            maxAttempts: 15,
            delayMs: 2000,
            isPatched() { return this._callRingingPatched; },
            resolve() {
                const Dispatcher = this.api.stores.Dispatcher;
                return (Dispatcher && typeof Dispatcher.dispatch === "function") ? Dispatcher : null;
            },
            onExhausted(reason) {
                this.api.patching.warn("patchBlockedCallRinging", new Error(reason === "installing patch" ? "Blocked-call ringing target was found, but the patch could not be installed after several attempts" : "Dispatcher unavailable after several attempts"));
            },
            apply(Dispatcher) {
                this.blockedRingingChannels = this.blockedRingingChannels || new Map;
                const self = this;
                const unpatch = this.api.patching.instead(Dispatcher, "dispatch", function(ctx, args, orig) {
                    let action = args[0];
                    if (!self.api.settings.blockRingingFromBlocked || !action || typeof action !== "object") {
                        return orig.apply(ctx, args);
                    }
                    try {
                        if ((action.type === self.api.constants.ACTIONS.CALL_CREATE || action.type === self.api.constants.ACTIONS.CALL_UPDATE)
                            && action.ongoingRings && typeof action.ongoingRings === "object") {
                            const selfId = self.api.identity.getSelfUserId();
                            const starterId = selfId ? action.ongoingRings[selfId] : null;
                            if (selfId && starterId && self.api.visibility.shouldHide(starterId)) {
                                self.blockedRingingChannels.set(action.channelId, true);
                                self.blockedAutoJoinGuard = self.blockedAutoJoinGuard || new Map;
                                for (const [gid, ts] of self.blockedAutoJoinGuard) {
                                    if (Date.now() - ts >= 5000) self.blockedAutoJoinGuard.delete(gid);
                                }
                                self.blockedAutoJoinGuard.set(action.channelId, Date.now());
                                const nextRings = { ...action.ongoingRings };
                                delete nextRings[selfId];
                                action = { ...action, ongoingRings: nextRings };
                                args = [action, ...args.slice(1)];
                            } else if (selfId && !starterId) {
                                self.blockedRingingChannels.delete(action.channelId);
                            }
                        } else if (action.type === self.api.constants.ACTIONS.CALL_DELETE) {
                            self.blockedRingingChannels.delete(action.channelId);
                            self.blockedAutoJoinGuard?.delete(action.channelId);
                        } else if (action.type === self.api.constants.ACTIONS.VOICE_CHANNEL_SELECT) {
                            const targetChannelId = action.channelId;
                            const markedAt = targetChannelId ? self.blockedAutoJoinGuard?.get(targetChannelId) : null;
                            if (markedAt && Date.now() - markedAt < 5000 && !action.currentVoiceChannelId) {
                                self.blockedAutoJoinGuard.delete(targetChannelId);
                            }
                        }
                    } catch (error) { _recordPatchCatch("call.blockedRingingDispatcher", self, error); }
                    return orig.apply(ctx, args);
                });
                if (typeof unpatch !== "function") return false;
                this._callRingingPatched = true;
                return true;
            },
            self: this
        });
    }
    _findCallButtonsClassByFiber() {
        try {
            const candidates = document.querySelectorAll('[class*="toolbar_"], [class*="titleWrapper_"], [class*="container_"], [class*="callContainer_"], [class*="voiceCallWrapper_"]');
            for (const el of candidates) {
                try {
                    let fiber = this.api.fiber.getInternalInstance(el);
                    for (let hop = 0; hop < 25 && fiber; hop++, fiber = fiber.return) {
                        const props = fiber.memoizedProps;
                        if (!props || !props.channel || typeof fiber.type !== "function" || !fiber.type.prototype?.render) continue;
                        if (typeof props.callActive === "boolean") return fiber.type;
                        if (typeof props.showCall === "boolean" || typeof props.inCall === "boolean") return fiber.type;
                        if (typeof props.hasVideo === "boolean" && ("selectedParticipant" in props || "voiceChannel" in props)) return fiber.type;
                    }
                } catch (_) {}
            }
        } catch (_) {}
        return null;
    }
    _isCallUiComponent(CallButtons, foundVia, strings, requiredHits) {
        try {
            const proto = CallButtons.prototype;
            const methodHints = ["renderCall", "shouldRenderCall", "renderVoiceCallButton", "renderVideoCallButton", "renderConnectionStatus", "renderControls", "renderChatButton"];
            if (methodHints.some(method => typeof proto[method] === "function")) return true;
            if (foundVia === "source-score") return false;
            const renderSource = typeof proto.render === "function" ? proto.render.toString() : "";
            return strings.filter(value => renderSource.includes(value)).length >= requiredHits;
        } catch (_) {
            return false;
        }
    }
    _applyCallUiComponentPatch(CallButtons, foundVia, strings, requiredHits, bestHitCount) {
        delete this.__hideBlockedCallUiLastMiss;
        this.blockedRingingChannels = this.blockedRingingChannels || new Map;
        const callbacks = this._createCallUiRenderCallbacks(CallButtons, foundVia, strings, requiredHits, bestHitCount);
        const before = this.api.patching.before(CallButtons.prototype, "render", callbacks.before);
        if (typeof before !== "function") return false;
        try {
            const after = this.api.patching.after(CallButtons.prototype, "render", callbacks.after);
            if (typeof after !== "function") { before(); return false; }
        } catch (error) {
            try { before(); } catch (cleanupError) { _recordPatchCatch("call.rollbackUiPatch", this, cleanupError); }
            throw error;
        }
        this._callUiPatched = true;
        return true;
    }
    _createCallUiRenderCallbacks(CallButtons, foundVia, strings, requiredHits, bestHitCount) {
        const plugin = this;
        let callUiGuardChecked = false, callUiGuardPassed = false;
        return {
            before: function(context) {
                try {
                    const props = context?.props;
                    if (!plugin.api.settings.blockRingingFromBlocked || !props || typeof props !== "object") return;
                    const channelId = props.channel?.id;
                    const callIsActive = props.callActive || props.showCall || props.inCall;
                    if (!channelId || !plugin.hasBlockedRinging(channelId) || !callIsActive) return;
                    if (!callUiGuardChecked) {
                        callUiGuardChecked = true;
                        callUiGuardPassed = plugin._isCallUiComponent(CallButtons, foundVia, strings, requiredHits);
                        if (!callUiGuardPassed) {
                            plugin.api.diagnostics.throttled("patchHideBlockedCallUI:guard", `component matched via ${foundVia} (best source-score ${bestHitCount}/${requiredHits} strings) but failed the structural call-UI guard on first real render - skipping prop overrides for this component to avoid corrupting unrelated UI`, "warn");
                        }
                    }
                    if (!callUiGuardPassed) return;
                    context.__byeblockedOrigProps = props;
                    const override = { callActive: false, inCall: false };
                    if (typeof props.showCall === "boolean") override.showCall = false;
                    context.props = { ...props, ...override };
                } catch (error) { _recordPatchCatch("call.hideUiBeforeRender", this, error); }
            },
            after: function(context) {
                try {
                    if (context?.__byeblockedOrigProps) {
                        context.props = context.__byeblockedOrigProps;
                        delete context.__byeblockedOrigProps;
                    }
                } catch (error) { _recordPatchCatch("call.restoreUiAfterRender", this, error); }
            },
        };
    }
    _findCallButtonsComponent() {
        let CallButtons = null;
        let foundVia = null;
        let bestHitCount = 0;
        let bestHitStrings = [];
        const STRINGS = CallSurface.CALL_BUTTONS_STRINGS;
        const REQUIRED = CallSurface.CALL_BUTTONS_REQUIRED;
        const countHits = source => {
            const hits = STRINGS.filter(value => source.includes(value));
            if (hits.length > bestHitCount) {
                bestHitCount = hits.length;
                bestHitStrings = hits;
            }
            return hits.length;
        };
        try {
            const module = this.api.moduleResolver.getBySourceAny("renderCall", "shouldRenderCall", "renderVoiceCallButton", "renderVideoCallButton");
            if (module && typeof module === "object") {
                for (const key of Object.keys(module)) {
                    const value = module[key];
                    if (value && value.prototype && typeof value.prototype.render === "function" &&
                        (typeof value.prototype.renderCall === "function" ||
                         typeof value.prototype.shouldRenderCall === "function" ||
                         typeof value.prototype.renderVoiceCallButton === "function")) {
                        CallButtons = value;
                        foundVia = "exact-name";
                        break;
                    }
                }
                if (!CallButtons && module.prototype && typeof module.prototype.render === "function") {
                    CallButtons = module;
                    foundVia = "exact-name";
                }
            }
        } catch (_) {}
        if (!CallButtons) {
            try {
                const findScoredComponent = module => {
                    for (const key of Object.keys(module)) {
                        const value = module[key];
                        const renderSource = value?.prototype?.render?.toString?.();
                        if (renderSource && countHits(renderSource) >= REQUIRED) return value;
                    }
                    return null;
                };
                const scored = this.api.moduleResolver.get(module => !!(module && typeof module === "object" && findScoredComponent(module)), { searchExports: true });
                if (scored) {
                    CallButtons = findScoredComponent(scored);
                    if (CallButtons) foundVia = "source-score";
                }
            } catch (_) {}
        }
        if (!CallButtons) {
            try {
                CallButtons = this._findCallButtonsClassByFiber();
                if (CallButtons) foundVia = "fiber-structural";
            } catch (_) {}
        }
        if (!CallButtons || !CallButtons.prototype || typeof CallButtons.prototype.render !== "function") {
            this.__hideBlockedCallUiLastMiss = { bestHitCount, bestHitStrings, REQUIRED };
            return null;
        }
        return { CallButtons, foundVia, STRINGS, REQUIRED, bestHitCount, bestHitStrings };
    }
    patchHideBlockedCallUI(attempt = 0) {
        this.api.patching.patchMethod({
            label: "patchHideBlockedCallUI",
            attempt,
            maxAttempts: 15,
            delayMs: 2000,
            isPatched() { return this._callUiPatched; },
            resolve() { return this._findCallButtonsComponent(); },
            onExhausted(reason) {
                if (reason === "installing patch") {
                    this.api.patching.warn("patchHideBlockedCallUI", new Error("Call UI component was found, but the paired render patches could not be installed after several attempts"));
                    delete this.__hideBlockedCallUiLastMiss;
                    return;
                }
                const miss = this.__hideBlockedCallUiLastMiss || { bestHitCount: 0, bestHitStrings: [], REQUIRED: CallSurface.CALL_BUTTONS_REQUIRED };
                this.api.patching.warn("patchHideBlockedCallUI", new Error(`ran out of attempts to locate the call buttons component - exact-name lookup, source-heuristic (best candidate matched ${miss.bestHitCount}/${miss.REQUIRED} required strings: ${miss.bestHitStrings.join(", ") || "none"}), and structural Fiber lookup all failed; Discord likely renamed or restructured this component`));
                delete this.__hideBlockedCallUiLastMiss;
            },
            apply({ CallButtons, foundVia, STRINGS, REQUIRED, bestHitCount }) {
                return this._applyCallUiComponentPatch(CallButtons, foundVia, STRINGS, REQUIRED, bestHitCount);
            },
            self: this
        });
    }
    watchCallCreateForHideBlockedCallUI() {
        if (typeof this._unwatchCallCreateForHideBlockedCallUI === "function") return true;
        const Dispatcher = this.api.stores.Dispatcher;
        if (!Dispatcher || typeof Dispatcher.dispatch !== "function") return false;
        const self = this;
        try {
            this._unwatchCallCreateForHideBlockedCallUI = this.api.lifecycle.watchBefore(Dispatcher, "dispatch", function(context, args) {
                try {
                    const action = args[0];
                    if (!action || typeof action !== "object") return;
                    if (action.type !== self.api.constants.ACTIONS.CALL_CREATE && action.type !== self.api.constants.ACTIONS.CALL_UPDATE) return;
                    if (self._callUiPatched || !self.api.settings.blockRingingFromBlocked) return;
                    self.api.resources.timer('callCreateHideBlockedCallUi', () => {
                        if (self.api.lifecycle.isRunning && !self._callUiPatched) self.patchHideBlockedCallUI();
                    }, 500);
                } catch (error) { _recordPatchCatch("call.createUiWatcher", self, error); }
            });
        } catch (error) {
            _recordPatchCatch("call.watchCreateForHideUi", this, error);
        }
        return typeof this._unwatchCallCreateForHideBlockedCallUI === "function";
    }
    stopWatchCallCreateForHideBlockedCallUI() {
        if (this._unwatchCallCreateForHideBlockedCallUI) {
            try { this._unwatchCallCreateForHideBlockedCallUI(); } catch (error) { _recordPatchCatch("CallSurface.stopWatchCallCreateForHideBlockedCallUI.L8528", null, error); }
            this._unwatchCallCreateForHideBlockedCallUI = null;
        }
    }
    hasBlockedRinging(channelId) {
        if (!channelId || !this.blockedRingingChannels) return false;
        return !!this.blockedRingingChannels.get(channelId);
    }
    patchRingtoneAudio() {
        if (this._ringtoneAudioPatched) return;
        const proto = typeof HTMLMediaElement !== "undefined" ? HTMLMediaElement.prototype : null;
        if (!proto || typeof proto.play !== "function") return;
        const unpatch = this.api.patching.instead(proto, "play", (element, args, original) => {
            try {
                if (this.api.settings.blockRingingFromBlocked && element?.loop) {
                    if (this._hasRecentBlockedRinging()) {
                        try { element.pause(); } catch (error) { _recordPatchCatch("call.pauseBlockedRingtone", this, error); }
                        try { element.muted = true; } catch (error) { _recordPatchCatch("call.muteBlockedRingtone", this, error); }
                        return Promise.resolve();
                    }
                    this.api.resources.timer('ringtone', () => {
                        try {
                            if (!element.paused && element.loop && this._hasRecentBlockedRinging()) {
                                element.pause();
                                element.muted = true;
                            }
                        } catch (error) { _recordPatchCatch("call.delayedRingtoneCheck", this, error); }
                    }, 120);
                }
            } catch (error) { _recordPatchCatch("patchRingtoneAudio.callback", this, error); }
            return original.apply(element, args);
        });
        if (typeof unpatch === "function") {
            this._ringtoneAudioUnpatch = unpatch;
            this._ringtoneAudioPatched = true;
        }
    }
    _hasRecentBlockedRinging() {
        if (!this.blockedRingingChannels || !this.blockedRingingChannels.size) return false;
        for (const [, marked] of this.blockedRingingChannels) {
            if (marked) return true;
        }
        return false;
    }
    unpatchRingtoneAudio() {
        try { this._ringtoneAudioUnpatch?.(); } catch (error) { _recordPatchCatch("call.unpatchRingtoneAudio", this, error); }
        this._ringtoneAudioUnpatch = null;
        this._ringtoneAudioPatched = false;
    }
}

class Logger {
    constructor(prefix = "ByeBlocked") {
        this.prefix = prefix;
    }
    info(message, extra) {
        try { console.info(`[${this.prefix}] ${message}`, extra ?? ""); } catch (_) {}
    }
    warn(message, extra) {
        try { console.warn(`[${this.prefix}] ${message}`, extra ?? ""); } catch (_) {}
    }
    error(message, extra) {
        try { console.error(`[${this.prefix}] ${message}`, extra ?? ""); } catch (_) {}
    }
}

class HealthMonitor {
    constructor(plugin, intervalMs = 15000) {
        this.p = plugin;
        this.intervalMs = intervalMs;
        this.checks = {};
        this._timer = null;
        this._degraded = {};
        this._running = false;
        this._generation = 0;
    }
    register(name, checkFn, fallbackFn, failThreshold = 2, isExpectedFn = null) {
        this.checks[name] = { checkFn, fallbackFn, failStreak: 0, failThreshold, totalFailures: 0, degradedCount: 0, lastHeartbeatAt: null, isExpectedFn,
            recoveryAttempts: 0, recoveryError: null, nextRecoveryAt: null };
        delete this._degraded[name];
    }
    heartbeat(name) {
        const entry = this.checks[name];
        if (!entry) return;
        entry.lastHeartbeatAt = Date.now();
    }
    msSinceHeartbeat(name) {
        const entry = this.checks[name];
        if (!entry || entry.lastHeartbeatAt == null) return null;
        return Date.now() - entry.lastHeartbeatAt;
    }
    start() {
        if (this._running) return;
        this._running = true;
        const generation = ++this._generation;
        this._runAll();
        if (!this._running || this._generation !== generation) return;
        this._timer = setInterval(() => {
            if (this._running && this._generation === generation) this._runAll();
        }, this.intervalMs);
    }
    stop() {
        this._running = false;
        this._generation++;
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this._degraded = {};
        for (const name in this.checks) {
            const entry = this.checks[name];
            entry.failStreak = 0;
            entry.lastError = null;
            entry.recoveryError = null;
            entry.nextRecoveryAt = null;
        }
    }
    _runAll() {
        const generation = this._generation;
        for (const name of Object.keys(this.checks)) {
            if (this._generation !== generation) break;
            this._runOne(name);
        }
    }
    _runOne(name) {
        const entry = this.checks[name];
        if (!entry) return;
        let healthy = true;
        const generation = this._generation;
        entry.lastError = null;
        try { healthy = !!entry.checkFn(); }
        catch (e) { healthy = false; entry.lastError = e; }
        if (this._generation !== generation || this.checks[name] !== entry) return;
        if (!healthy) {
            entry.failStreak++;
            entry.totalFailures++;
            if (entry.failStreak >= (entry.failThreshold ?? 2) && !this._degraded[name]) {
                this._degraded[name] = true;
                entry.degradedCount++;
                try {
                    const detail = entry.lastError ? (entry.lastError.message || entry.lastError) : null;
                    let expected = false;
                    try { expected = !!entry.isExpectedFn?.(); } catch (error) { _recordPatchCatch("health.expected:" + name, this.p, error); }
                    const level = expected ? "info" : "warn";
                    const msg = expected
                        ? `HealthMonitor: '${name}' appears to have failed, but a fallback is already active. No action needed.`
                        : `HealthMonitor: '${name}' appears to have failed, running recovery.`;
                    if (this.p?.logger) this.p.logger[level](msg, detail);
                    else console[level](`[ByeBlocked] ${msg}${detail ? " " + detail : ""}`);
                } catch (_) {}
                if (this._generation === generation && this.checks[name] === entry) this._recover(name, entry);
            } else if (entry.nextRecoveryAt != null && Date.now() >= entry.nextRecoveryAt) {
                this._recover(name, entry);
            }
        } else {
            entry.failStreak = 0;
            entry.lastError = null;
            entry.recoveryError = null;
            entry.nextRecoveryAt = null;
            if (this._degraded[name]) {
                this._degraded[name] = false;
                try {
                    if (this.p?.logger) this.p.logger.info(`HealthMonitor: '${name}' returned to normal.`);
                    else console.info(`[ByeBlocked] HealthMonitor: '${name}' returned to normal.`);
                } catch (_) {}
            }
        }
    }
    _recover(name, entry) {
        const generation = this._generation;
        entry.recoveryAttempts++;
        try {
            entry.fallbackFn?.();
            if (this._generation !== generation || this.checks[name] !== entry) return;
            entry.recoveryError = null;
            entry.nextRecoveryAt = null;
        } catch (error) {
            if (this._generation !== generation || this.checks[name] !== entry) return;
            entry.recoveryError = error;
            entry.nextRecoveryAt = Date.now() + Math.max(60000, this.intervalMs * 4);
            _recordPatchCatch("health.recovery:" + name, this.p, error);
        }
    }
    isDegraded(name) { return !!this._degraded[name]; }
    report() {
        const rows = Object.keys(this.checks).map(name => ({
            check: name,
            degraded: this.isDegraded(name),
            failStreak: this.checks[name].failStreak,
            totalFailures: this.checks[name].totalFailures,
            degradedCount: this.checks[name].degradedCount,
            lastError: this.checks[name].lastError?.message || null,
            recoveryAttempts: this.checks[name].recoveryAttempts,
            recoveryError: this.checks[name].recoveryError?.message || null,
            nextRecoveryAt: this.checks[name].nextRecoveryAt
        }));
        console.table(rows);
        return rows;
    }
}

function _locale(locale, dict) {
    if (!dict) return null;
    const safeLocale = typeof locale === 'string' ? locale : 'en';
    return dict[safeLocale] || dict[safeLocale.split('-')[0]] || dict.en || null;
}
function _getLocale() { try { return (document.documentElement?.lang || navigator.language || 'en').toLowerCase(); } catch (_) { return 'en'; } }
function _makeDict(pt, en) { return { 'pt-br': pt, pt: pt, 'en-us': en, en: en }; }

const _VOICE_CHANNEL_LABELS = [
    'canal de voz', 'Canal de voz', 'voice channel', 'Voice channel', 'salon vocal',
    'sprachkanal', 'canale vocale', 'canal de voz', 'ボイスチャンネル', '음성 채널',
    'голосовой канал', '语音频道', '語音頻道', 'kanał głosowy', 'spraakkanaal',
    'ses kanalı', 'голосовий канал', 'ช่องเสียง', 'kênh thoại', 'saluran suara',
    'hlasový kanál', 'röstkanal', 'äänikanava', 'tale kanal', 'canal vocal',
    'hangcsatorna', 'φωνητικό κανάλι', 'гласов канал', 'glasovni kanal',
    'ערוץ קולי', 'قناة صوتية'
];
const _VOICE_CHANNEL_ARIA_LABEL_SEL = _VOICE_CHANNEL_LABELS.map(l => `[aria-label*="${l}"]`).join(',');
function _findCloseButton(dialog) {
    if (!dialog) return null;
    try {
        const iconBtn = dialog.querySelector('button[class*="close"], [class*="closeButton"]');
        if (iconBtn) return iconBtn;
    } catch (_) {}
    try {
        const header = dialog.querySelector('[class*="header"]');
        const headerBtn = header?.querySelector('button[aria-label]');
        if (headerBtn) return headerBtn;
    } catch (_) {}
    return null;
}

(function byeBlockedBootGuard() {
    try {
        try { if (!BdApi?.Plugins?.isEnabled?.('ByeBlocked')) return; } catch (_) { return; }
    } catch (_) {}
    try {
        if (document.getElementById('ByeBlocked-bootguard')) return;
        let groupDmsEnabled = true;
        try {
            const stored = BdApi?.Data?.load?.('ByeBlocked', 'settings');
            if (stored && stored.places && typeof stored.places.groupDms === 'boolean') {
                groupDmsEnabled = stored.places.groupDms;
            }
        } catch (_) {}
        if (!groupDmsEnabled) return;
        const style = document.createElement('style');
        style.id = 'ByeBlocked-bootguard';
        style.textContent = `
            li[data-list-item-id*="private-channels"]:not([data-nmb-relabeled="true"]):has([class*="avatarStack"], [class*="groupAvatar"], [class*="avatarMulti"]) {
                visibility: hidden !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);

    } catch (_) {}
})();

(function byeBlockedUnreadBadgeBootGuard() {
    try {
        if (document.getElementById('ByeBlocked-unreadbadge-bootguard')) return;
        try { if (!BdApi?.Plugins?.isEnabled?.('ByeBlocked')) return; } catch (_) { return; }
        let messagesEnabled = true;
        try {
            const stored = BdApi?.Data?.load?.('ByeBlocked', 'settings');
            if (stored && stored.places && typeof stored.places.messages === 'boolean') {
                messagesEnabled = stored.places.messages;
            }
        } catch (_) {}
        if (!messagesEnabled) return;
        const style = document.createElement('style');
        style.id = 'ByeBlocked-unreadbadge-bootguard';
        style.textContent = `
            [role="tree"][data-list-id="guildsnav"] div[aria-hidden="true"] > span:first-child,
            nav[aria-label] [role="tree"][data-list-id="guildsnav"] div[aria-hidden="true"] > span:first-child {
                visibility: hidden !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
        const removeGuard = () => {
            try { document.getElementById('ByeBlocked-unreadbadge-bootguard')?.remove(); } catch (error) { _recordPatchCatch("boot.removeUnreadGuard", null, error); }
        };
        const POLL_INTERVAL_MS = 250;
        const HARD_TIMEOUT_MS = 20000;
        const startedAt = Date.now();
        const poll = () => {
            let inst = null;
            try { inst = window.__byeBlocked; } catch (_) {}
            const elapsed = Date.now() - startedAt;
            if (!inst) {
                let stillEnabled = true;
                try { stillEnabled = !!BdApi?.Plugins?.isEnabled?.('ByeBlocked'); } catch (_) {}
                if (!stillEnabled) { removeGuard(); return; }
            }
            const readState = inst?._surfaces?.readState;
            const badge = inst?._surfaces?.badge;
            if (readState && typeof readState.bootstrapBlockedUnreadSuppression === 'function' && readState.isPatched?.()) {
                try {
                    const stillPending = readState.bootstrapBlockedUnreadSuppression(0);
                    try { readState.forceReadStateRecheck?.(true); } catch (error) { _recordPatchCatch("boot.L8790", null, error); }
                    try { badge?.refreshTaskbarBadge?.(); } catch (error) { _recordPatchCatch("boot.L8791", null, error); }
                    if (!stillPending || elapsed >= HARD_TIMEOUT_MS) {
                        removeGuard();
                        return;
                    }
                } catch (_) {
                    if (elapsed >= HARD_TIMEOUT_MS) { removeGuard(); return; }
                }
            } else if (elapsed >= HARD_TIMEOUT_MS) {
                removeGuard();
                return;
            }
            setTimeout(poll, POLL_INTERVAL_MS);
        };
        setTimeout(poll, POLL_INTERVAL_MS);
    } catch (_) {}
})();

(function byeBlockedTaskbarBadgeBootRace() {
    const BOOT_RACE_PATCH_ID = 'ByeBlockedTaskbarBadgeBootRace';
    const PLUGIN_NAME = 'ByeBlocked';
    try {
        const isPluginEnabled = () => {
            try { return !!BdApi?.Plugins?.isEnabled?.(PLUGIN_NAME); } catch (_) { return false; }
        };
        if (!isPluginEnabled()) return;

        let messagesEnabled = true;
        let suppressTaskbarBadge = true;
        try {
            const stored = BdApi?.Data?.load?.('ByeBlocked', 'settings');
            if (stored?.places && typeof stored.places.messages === 'boolean') {
                messagesEnabled = stored.places.messages;
            }
            if (stored?.behavior && typeof stored.behavior.suppressTaskbarBadge === 'boolean') {
                suppressTaskbarBadge = stored.behavior.suppressTaskbarBadge;
            }
        } catch (_) {}
        if (!messagesEnabled || !suppressTaskbarBadge) return;

        let patchedNative = false;
        let patchedElectron = false;

        let nativePatchUnwritable = false;
        const tryPatchNative = () => {
            if (patchedNative || nativePatchUnwritable) return patchedNative;
            try {
                if (typeof DiscordNative !== "undefined" && typeof DiscordNative?.app?.setBadgeCount === "function") {
                    const descriptor = Object.getOwnPropertyDescriptor(DiscordNative.app, "setBadgeCount");
                    if (descriptor && descriptor.writable === false && !descriptor.set) {
                        nativePatchUnwritable = true;
                        return false;
                    }
                    BdApi.Patcher.before(BOOT_RACE_PATCH_ID, DiscordNative.app, "setBadgeCount", (_, args) => {
                        if (!isPluginEnabled()) return;
                        args[0] = 0;
                    });
                    patchedNative = true;
                }
            } catch (error) {
                nativePatchUnwritable = true;
                _recordPatchCatch("boot.L8844", null, error);
            }
            return patchedNative;
        };

        const tryPatchElectron = () => {
            if (patchedElectron) return true;
            try {
                const electron = BdApi?.Webpack?.getByKeys?.("setBadge", "setSystemTrayIcon")
                    || BdApi?.Webpack?.getByKeys?.("setBadge");
                if (electron?.setBadge) {
                    BdApi.Patcher.before(BOOT_RACE_PATCH_ID, electron, "setBadge", (_, args) => {
                        if (!isPluginEnabled()) return;
                        args[0] = 0;
                    });
                    if (typeof electron.setSystemTrayIcon === "function") {
                        BdApi.Patcher.before(BOOT_RACE_PATCH_ID, electron, "setSystemTrayIcon", (_, args) => {
                            if (!isPluginEnabled()) return;
                            if (args[0] === "UNREAD") args[0] = "DEFAULT";
                        });
                    }
                    patchedElectron = true;
                }
            } catch (error) { _recordPatchCatch("boot.L8866", null, error); }
            return patchedElectron;
        };

        const zeroOutBadgeNow = () => {
            try { if (typeof DiscordNative !== "undefined" && typeof DiscordNative?.app?.setBadgeCount === "function") DiscordNative.app.setBadgeCount(0); } catch (_) {}
            try {
                const electron = BdApi?.Webpack?.getByKeys?.("setBadge", "setSystemTrayIcon") || BdApi?.Webpack?.getByKeys?.("setBadge");
                if (electron?.setBadge) electron.setBadge(0);
                if (electron?.setSystemTrayIcon) electron.setSystemTrayIcon("DEFAULT");
            } catch (_) {}
        };
        zeroOutBadgeNow();
        tryPatchNative();
        tryPatchElectron();

        let attempts = 0;
        const maxAttempts = 20;
        const tick = () => {
            attempts++;
            if (!isPluginEnabled()) {
                try { BdApi.Patcher.unpatchAll(BOOT_RACE_PATCH_ID); } catch (error) { _recordPatchCatch("boot.L8887", null, error); }
                return;
            }
            const nativeDone = tryPatchNative() || nativePatchUnwritable;
            const electronDone = tryPatchElectron();
            if ((!nativeDone || !electronDone) && attempts < maxAttempts) {
                setTimeout(tick, 30);
            }
        };
        tick();
    } catch (_) {}
})();



class CacheManager {
    constructor() {
        this._maps = new Map();
    }
    _normalizeMaxSize(maxSize) {
        const value = Number(maxSize);
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : Infinity;
    }
    _trim(entry) {
        while (entry.map.size > entry.maxSize) {
            const oldestKey = entry.map.keys().next().value;
            if (oldestKey === undefined) break;
            entry.map.delete(oldestKey);
        }
    }
    map(name, maxSize = Infinity) {
        const limit = this._normalizeMaxSize(maxSize);
        let entry = this._maps.get(name);
        if (!entry) {
            entry = { map: new Map(), maxSize: limit };
            this._maps.set(name, entry);
        } else {
            entry.maxSize = limit;
            this._trim(entry);
        }
        return entry.map;
    }
    reset(name, maxSize = Infinity) {
        const map = this.map(name, maxSize);
        map.clear();
        return map;
    }
    set(name, key, value) {
        const entry = this._maps.get(name);
        if (!entry) throw new Error(`Cache "${name}" was not registered`);
        if (!entry.map.has(key) && entry.map.size >= entry.maxSize) {
            const oldestKey = entry.map.keys().next().value;
            if (oldestKey !== undefined) entry.map.delete(oldestKey);
        }
        entry.map.set(key, value);
        return value;
    }
    clear(name) {
        const entry = this._maps.get(name);
        if (entry) entry.map.clear();
    }
    clearAll() {
        for (const entry of this._maps.values()) entry.map.clear();
    }
}

class ScrollManager {
    constructor() {
        this._pending = new Map();
        this._flushScheduled = false;
    }
    request(scroller, nextTop) {
        if (!scroller || !scroller.isConnected) return;
        if (!Number.isFinite(nextTop)) return;
        this._pending.set(scroller, { nextTop });
        this._scheduleFlush();
    }
    _scheduleFlush() {
        if (this._flushScheduled) return;
        this._flushScheduled = true;
        const flush = () => {
            this._flushScheduled = false;
            const entries = this._pending;
            this._pending = new Map();
            for (const [scroller, { nextTop }] of entries) {
                try {
                    if (!scroller.isConnected) continue;
                    if (Math.abs(scroller.scrollTop - nextTop) > 0.5) {
                        scroller.scrollTop = nextTop;
                    }
                } catch (_) {}
            }
        };
        Promise.resolve().then(flush);
    }
    getEffectiveScrollTop(scroller) {
        const pending = this._pending.get(scroller);
        if (pending) return pending.nextTop;
        try { return scroller.scrollTop; } catch (_) { return 0; }
    }
}


function createReadStateSurfaceApi(plugin) {
    return Object.freeze({
        get pluginName() { return plugin.pluginName; },
        get messagesEnabled() { return !!plugin.settings.places?.messages; },
        get threadsEnabled() { return !!plugin.settings.places?.threads; },
        stores: Object.freeze({
            get ActiveJoinedThreadsStore() { return plugin.modules.ActiveJoinedThreadsStore; },
            get ChannelPinsStore() { return plugin.modules.ChannelPinsStore; },
            get ChannelStore() { return plugin.modules.ChannelStore; },
            get GuildChannelStore() { return plugin.modules.GuildChannelStore; },
            get GuildReadStateStore() { return plugin.modules.GuildReadStateStore; },
            get GuildStore() { return plugin.modules.GuildStore; },
            get MessageActionsModule() { return plugin.modules.MessageActionsModule; },
            get MessageStore() { return plugin.modules.MessageStore; },
            get PrivateChannelStore() { return plugin.modules.PrivateChannelStore; },
            get ReadStateStore() { return plugin.modules.ReadStateStore; },
            get SelectedChannelStore() { return plugin.modules.SelectedChannelStore; },
            get ThreadStore() { return plugin.modules.ThreadStore; },
            get UserGuildSettingsStore() { return plugin.modules.UserGuildSettingsStore; },
        }),
        diagnostics: Object.freeze({ warn: (...args) => plugin.logger?.warn?.(...args) }),
        get rawGetMessages() { return plugin._rawGetMessages; },
        get isRunning() { return plugin.isRunning; },
        visibility: Object.freeze({
            get relationshipResolverReady() { return !!plugin._relIsBlockedFn; },
            shouldHide: userId => plugin.shouldHide(userId),
            isBlockedMessage: message => plugin._isBlockedMessage(message),
            getAuthorId: message => plugin._getAuthorId(message),
            isForumParentChannel: channelId => plugin._isForumParentChannel(channelId),
        }),
        patching: Object.freeze({
            safe: (...args) => plugin._patcher.safe(...args),
            warn: (...args) => plugin._patcher?._warn(...args),
            after: (...args) => plugin.patchAfter(...args),
            instead: (...args) => plugin.patchInstead(...args),
        }),
        retry: _surfaceRetry(plugin, ["delay","schedule"]),
        resources: Object.freeze({
            timer: (...args) => plugin._resources.timer(...args),
            interval: (...args) => plugin._resources.interval(...args),
            clearTimer: (...args) => plugin._resources.clearTimer(...args),
            clearInterval: (...args) => plugin._resources.clearInterval(...args),
            debounce: (...args) => plugin._resources.debounce(...args),
            cancelDebounce: (...args) => plugin._resources.cancelDebounce(...args),
        }),
        surfaces: Object.freeze({
            get badge() { return plugin._surfaces?.badge; },
            get pins() { return plugin._surfaces?.pins; },
            get groupDms() { return plugin._surfaces?.groupDms; },
        }),
        coordination: Object.freeze({
            queueScan: (...args) => plugin.queueScan(...args),
            patchNotificationDispatcher: (...args) => plugin._patchNotificationDispatcher(...args),
            addStartupTimer: timerId => (plugin._startupTimers = plugin._startupTimers || []).push(timerId),
            removeStartupTimer: timerId => {
                const timers = plugin._startupTimers;
                const index = timers?.indexOf(timerId);
                if (index !== undefined && index !== -1) timers.splice(index, 1);
            },
        }),
    });
}

class ReadStateSurface {
    constructor(api) {
        this.api = api;
        this._fetchedUnresolvedChannels = null;
        this._blockedReadCachePruneInterval = null;
        this._blockedReadCache = null;
        this._blockedOnlyReadChannels = new Set;
        this._unresolvedDmRecipientWarned = new Set;
        this._readStateRecheckInFlight = false;
        this._readStateReloadRecheckTimers = null;
        this._hasPendingUnreadResolution = false;
        this._readStatePatched = false;
        this._readStatePatchesRegistered = false;
        this._channelPinsChangeHandler = null;
        this._threadsStoreChangeHandler = null;
        this._threadStoreChangeHandler = null;
        this._channelStoreChangeHandler = null;
        this._taskbarBadgePatched = false;
        this._taskbarBadgeRelationshipRetryTimeout = null;
        this._unresolvedBlockedUnreadRetryTimeout = null;
        this._unresolvedBlockedUnreadHighestAttempt = 0;
        this._blockedReadCache = this.loadBlockedReadCache();
        return this;
    }
    loadBlockedReadCache() {
        try {
            const stored = BdApi.Data.load(this.api.pluginName, "blockedReadCache");
            return stored && typeof stored === "object" ? stored : {};
        } catch (_) {
            return {};
        }
    }

    saveBlockedReadCache() {
        try {
            const MAX_TRACKED = 500;
            const cache = this._blockedReadCache || {};
            const keys = Object.keys(cache);
            if (keys.length > MAX_TRACKED) {
                for (const key of keys.slice(0, keys.length - MAX_TRACKED)) delete cache[key];
            }
            BdApi.Data.save(this.api.pluginName, "blockedReadCache", cache);
        } catch (error) { _recordPatchCatch("readState.saveBlockedReadCache", this, error); }
    }

    emitReadStateChanges() {
        try {
            const readState = this.api.stores.ReadStateStore;
            if (readState && typeof readState.emitChange === "function") readState.emitChange();
        } catch (error) { _recordPatchCatch("readState.emitReadStateChanges", this, error); }
        try {
            const guildReadState = this.api.stores.GuildReadStateStore;
            if (guildReadState && typeof guildReadState.emitChange === "function") guildReadState.emitChange();
        } catch (error) { _recordPatchCatch("readState.emitGuildReadStateChanges", this, error); }
        this.api.surfaces.badge.refreshTaskbarBadge();
    }

    _getGuildIds() {
        const gs = this.api.stores.GuildStore;
        if (!gs) return [];
        try {
            if (typeof gs.getGuildIds === "function") return gs.getGuildIds() || [];
            if (typeof gs.getGuilds === "function") {
                const guilds = gs.getGuilds();
                if (Array.isArray(guilds)) return guilds.map(g => g?.id).filter(Boolean);
                if (guilds && typeof guilds === "object") return Object.keys(guilds);
            }
        } catch (error) { _recordPatchCatch("readState.getGuildIds", this, error); }
        return [];
    }

    _getChannelMessages(channelId) {
        try {
            const raw = this.api.rawGetMessages;
            const ret = raw ? raw(channelId) : this.api.stores.MessageStore?.getMessages?.(channelId);
            return _messageCollectionToArray(ret) || [];
        } catch (error) { _recordPatchCatch("readState.getChannelMessages", this, error); }
        return [];
    }

    _forEachKnownChannel(callback, { guildChannels = true } = {}) {
        if (typeof callback !== "function") return;
        if (guildChannels) {
            const gcs = this.api.stores.GuildChannelStore;
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
                } catch (error) { _recordPatchCatch("readState.forEachGuildChannels", this, error); }
            }
        }
        const pcs = this.api.stores.PrivateChannelStore;
        const privateIds = new Set;
        try {
            if (typeof pcs?.getPrivateChannelIds === "function") pcs.getPrivateChannelIds().forEach(id => privateIds.add(id));
            const mutable = pcs?.getMutablePrivateChannels?.();
            if (mutable && typeof mutable === "object") Object.keys(mutable).forEach(id => privateIds.add(id));
        } catch (error) { _recordPatchCatch("readState.getPrivateChannels", this, error); }
        for (const channelId of privateIds) {
            try {
                const channel = this.api.stores.ChannelStore?.getChannel?.(channelId);
                callback(channelId, channel);
            } catch (error) { _recordPatchCatch("readState.forEachPrivateChannel", this, error); }
        }
    }

    _resolveDmRecipientId(channel) {
        if (!channel) return null;
        if (channel.recipient?.id) return channel.recipient.id;
        if (channel.recipientId) return channel.recipientId;
        if (Array.isArray(channel.recipients) && channel.recipients[0]) {
            const first = channel.recipients[0];
            return (typeof first === "string") ? first : (first?.id || null);
        }
        try {
            const rs = this.api.stores.ChannelStore?.getChannel?.(channel.id);
            if (rs && rs !== channel) return this._resolveDmRecipientId(rs);
        } catch (error) { _recordPatchCatch("ReadStateSurface._resolveDmRecipientId.fallback1", this, error); }
        if (channel.id && !this._unresolvedDmRecipientWarned.has(channel.id)) {
            const UNRESOLVED_DM_WARNED_MAX_SIZE = 300;
            if (this._unresolvedDmRecipientWarned.size >= UNRESOLVED_DM_WARNED_MAX_SIZE) {
                const oldestKey = this._unresolvedDmRecipientWarned.values().next().value;
                if (oldestKey !== undefined) this._unresolvedDmRecipientWarned.delete(oldestKey);
            }
            this._unresolvedDmRecipientWarned.add(channel.id);
            this.api.diagnostics.warn(
                `_resolveDmRecipientId: DM channel ${channel.id} has no resolvable recipient ID ` +
                `via recipient, recipientId, or recipients[]. Likely an orphaned channel (e.g. ` +
                `deleted account). Its unread badge cannot be suppressed even if the user is blocked.`
            );
        }
        return null;
    }

    channelHasVisibleUnread(channelId) {
        const rs = this.api.stores.ReadStateStore;
        if (!rs || !channelId) return false;
        if (typeof rs.hasTrackedUnread === "function" && rs.hasTrackedUnread(channelId)) return true;
        if (typeof rs.hasUnreadOrMentions === "function" && rs.hasUnreadOrMentions(channelId)) return true;
        return !!rs.hasUnread?.(channelId);
    }

    _channelAllowsUnreadBadge(channelId, channel = null) {
        const settings = this.api.stores.UserGuildSettingsStore;
        if (!settings || !channelId) return true;
        try {
            const ch = channel || this.api.stores.ChannelStore?.getChannel?.(channelId);
            const guildId = ch?.guild_id || null;
            if (guildId && typeof settings.isGuildOrCategoryOrChannelMuted === "function"
                && settings.isGuildOrCategoryOrChannelMuted(guildId, channelId)) return false;
            if (guildId && typeof settings.isMuted === "function" && settings.isMuted(guildId)) return false;
            if (typeof settings.isChannelMuted === "function" && settings.isChannelMuted(guildId, channelId)) return false;
            if (guildId && ch?.parent_id && typeof settings.isChannelMuted === "function"
                && settings.isChannelMuted(guildId, ch.parent_id)) return false;
        } catch (error) { _recordPatchCatch("readState.channelAllowsUnreadBadge", this, error); }
        return true;
    }

    _guildHasVisibleUnread(guildId) {
        if (!guildId) return false;
        const gcs = this.api.stores.GuildChannelStore;
        if (!gcs) return false;
        try {
            const groups = gcs.getChannels?.(guildId);
            if (!groups || typeof groups !== "object") return false;
            for (const list of Object.values(groups)) {
                if (!Array.isArray(list)) continue;
                for (const entry of list) {
                    const id = entry?.channel?.id;
                    if (!id || !this._channelHasRawUnread(id)) continue;
                    if (!this._channelAllowsUnreadBadge(id, entry.channel)) continue;
                    if (this.hasBlockedOnlyReadActivity(id)) continue;
                    if (this._resolveChannelVisibleUnread(id, true)) {
                        return true;
                    }
                }
            }
        } catch (error) {
            _recordPatchCatch("readState.guildHasVisibleUnread", this, error);
            return false;
        }
        return false;
    }

    _guildAllowsUnreadBadge(guildId) {
        if (!guildId) return true;
        const ugs = this.api.stores.UserGuildSettingsStore;
        if (!ugs) return true;
        try {
            const level = typeof ugs.getMessageNotifications === "function" ? ugs.getMessageNotifications(guildId) : null;
            if (level === null || level === undefined) return true;
            return level === 0;
        } catch (error) {
            _recordPatchCatch("readState.guildAllowsUnreadBadge", this, error);
            return true;
        }
    }

    filteredHasAnyUnread() {
        const grs = this.api.stores.GuildReadStateStore;
        for (const guildId of this._getGuildIds()) {
            try {
                if (!grs?.hasUnread?.(guildId)) continue;
                if (!this._guildAllowsUnreadBadge(guildId)) continue;
                if (this._guildHasVisibleUnread(guildId)) {
                    return true;
                }
            } catch (error) { _recordPatchCatch("readState.filteredHasAnyUnread.guild", this, error); }
        }
        let foundPrivate = false;
        this._forEachKnownChannel((channelId, channel) => {
            if (foundPrivate) return;
            if (!this._channelAllowsUnreadBadge(channelId, channel)) return;
            if (channel?.isDM?.() && this.api.visibility.shouldHide(this._resolveDmRecipientId(channel))) return;
            if (this.hasBlockedOnlyReadActivity(channelId)) return;
            if (this.channelHasVisibleUnread(channelId)) {
                foundPrivate = true;
            }
        }, { guildChannels: false });
        return foundPrivate;
    }

    filteredTotalMentionCount() {
        const rs = this.api.stores.ReadStateStore;
        if (!rs?.getMentionCount) return 0;
        const cs = this.api.stores.ChannelStore;
        const grs = this.api.stores.GuildReadStateStore;
        let total = 0;
        this._forEachKnownChannel((channelId, channel) => {
            try {
                const guildId = channel?.guild_id;
                if (guildId && !grs?.hasUnread?.(guildId)) return;
                let count = rs.getMentionCount(channelId) || 0;
                if (count <= 0) return;
                const ch = cs?.getChannel?.(channelId);
                if (ch?.isDM?.() && this.api.visibility.shouldHide(this._resolveDmRecipientId(ch))) return;
                if (ch?.guild_id && !this.channelHasVisibleUnread(channelId)) return;
                if (!ch?.guild_id && !ch?.isDM?.() && this.hasBlockedOnlyReadActivity(channelId)) return;
                total += count;
            } catch (error) { _recordPatchCatch("readState.filteredTotalMentionCount", this, error); }
        });
        return total;
    }

    snowflakeGreater(a, b) {
        if (!a) return false;
        if (!b) return true;
        try {
            return BigInt(a) > BigInt(b);
        } catch (_) {
            return String(a) > String(b);
        }
    }

    _channelHasRawUnread(channelId) {
        const rs = this.api.stores.ReadStateStore;
        if (!rs || !channelId) return false;
        const lastId = rs.lastMessageId?.(channelId);
        const ackId = rs.ackMessageId?.(channelId);
        return !!(lastId && ackId && this.snowflakeGreater(lastId, ackId));
    }

    _applyBlockedReadCacheOnStartup() {
        const rs = this.api.stores.ReadStateStore;
        if (!rs || !this._blockedReadCache) return;
        for (const [channelId, activityId] of Object.entries(this._blockedReadCache)) {
            const lastId = rs.lastMessageId?.(channelId);
            if (lastId && String(lastId) === String(activityId)) {
                this._blockedOnlyReadChannels.add(String(channelId));
            }
        }
    }

    checkAndSuppressBlockedMentionForChannel(channelId, helpers) {
        if (!channelId) return false;
        if (this.hasBlockedOnlyReadActivity(channelId)) return false;
        const store = this.api.stores.ReadStateStore;
        if (!store) return false;
        try {
            const mentionCount = store.getMentionCount ? store.getMentionCount(channelId) : 0;
            if (mentionCount <= 0) return false;
            const ackId = store.ackMessageId ? store.ackMessageId(channelId) : null;
            if (!ackId) return false;
            const messages = helpers.getChannelMessages(channelId);
            if (!messages.length) return false;
            const unread = messages.filter(m => m?.id && this.snowflakeGreater(m.id, ackId));
            if (!unread.length) return false;
            const hasBlockedMention = unread.some(m => Array.isArray(m?.mentions) && m.mentions.some(mm => this.api.visibility.shouldHide(typeof mm === 'string' ? mm : (mm?.id || mm?.userId))));
            const anyOtherVisibleUnread = unread.some(m => !helpers.isBlockedMessage(m));
            if (hasBlockedMention && !anyOtherVisibleUnread) {
                let parentId = null;
                try { parentId = this.api.stores.ChannelStore?.getChannel?.(channelId)?.parent_id || null; } catch (error) { _recordPatchCatch("readState.blockedMentionParent", this, error); }
                const lastMessageId = store.lastMessageId ? store.lastMessageId(channelId) : null;
                this.markBlockedOnlyReadActivity(channelId, parentId, lastMessageId);
                return true;
            }
        } catch (error) { _recordPatchCatch("readState.checkBlockedMention", this, error); }
        return false;
    }

    bootstrapBlockedUnreadSuppression(_retryAttempt = 0) {
        const helpers = this.getReadStateHelpers();
        let changed = false;
        const pendingUnresolved = [];
        this._forEachKnownChannel((channelId, channel) => {
            if (!this._channelHasRawUnread(channelId)) return;
            if (this.hasBlockedOnlyReadActivity(channelId)) return;
            if (!this.api.messagesEnabled) return;
            try {
                if (helpers.isForumParentChannel(channelId)) {
                    const forumResult = helpers.hasVisibleForumActivity(channelId);
                    if (forumResult === false) {
                        const lastId = this.api.stores.ReadStateStore?.lastMessageId?.(channelId);
                        this.markBlockedOnlyReadActivity(channelId, channel?.parent_id, lastId);
                        changed = true;
                    } else if (forumResult === null) {
                        pendingUnresolved.push(channelId);
                    }
                    return;
                }
                const store = this.api.stores.ReadStateStore;
                const lastMessageId = store?.lastMessageId?.(channelId);
                const messages = helpers.getChannelMessages(channelId);
                if (this.checkAndSuppressBlockedMentionForChannel(channelId, helpers)) {
                    changed = true;
                    return;
                }
                if (messages.length) {
                    const oldestUnreadId = store.getOldestUnreadMessageId ? store.getOldestUnreadMessageId(channelId) : null;
                    if (oldestUnreadId) {
                        const idx = messages.findIndex(m => m?.id === oldestUnreadId);
                        if (idx !== -1) {
                            const unreadSlice = messages.slice(idx);
                            const anyVisible = unreadSlice.some(m => !helpers.isBlockedMessage(m));
                            if (!anyVisible) {
                                this.markBlockedOnlyReadActivity(channelId, channel?.parent_id, lastMessageId);
                                changed = true;
                            }
                            return;
                        }
                    }
                }
                if (lastMessageId && helpers.resolveForumActivityOwnerId) {
                    const ownerId = helpers.resolveForumActivityOwnerId(channelId, lastMessageId);
                    if (ownerId && this.api.visibility.shouldHide(ownerId)) {
                        this.markBlockedOnlyReadActivity(channelId, channel?.parent_id, lastMessageId);
                        changed = true;
                        return;
                    }
                }
                const blockedOnly = this._resolveUnreadFromBlockedOnly(channelId, store, helpers);
                if (blockedOnly === false) {
                    this.markBlockedOnlyReadActivity(channelId, channel?.parent_id, lastMessageId);
                    changed = true;
                } else if (blockedOnly === null) {
                    pendingUnresolved.push(channelId);
                }
            } catch (error) { _recordPatchCatch("readState.bootstrapChannel", this, error); }
        });
        if (changed) {
            this.forceReadStateRecheck(true);
            this.api.surfaces.badge.refreshTaskbarBadge();
        }
        const wasPending = this._hasPendingUnreadResolution;
        this._hasPendingUnreadResolution = pendingUnresolved.length > 0;
        if (wasPending && !this._hasPendingUnreadResolution && !changed) {
            this.api.surfaces.badge.refreshTaskbarBadge();
        }
        if (pendingUnresolved.length) {
            this._fetchUnresolvedUnreadMessages(pendingUnresolved);
            this._scheduleUnresolvedBlockedUnreadRetry(_retryAttempt);
        }
        return this._hasPendingUnreadResolution;
    }

    _fetchUnresolvedUnreadMessages(channelIds) {
        const actions = this.api.stores.MessageActionsModule;
        if (typeof actions?.fetchMessages !== "function") {
            return;
        }
        const REFETCH_COOLDOWN_MS = 2000;
        const MAX_CONCURRENT_FETCHES = 3;
        const BATCH_SPACING_MS = 250;
        if (!this._fetchedUnresolvedChannels) this._fetchedUnresolvedChannels = new Map;
        const rs = this.api.stores.ReadStateStore;
        const now = Date.now();
        const eligible = [];
        for (const channelId of channelIds) {
            const key = String(channelId);
            const lastFetchedAt = this._fetchedUnresolvedChannels.get(key);
            if (lastFetchedAt !== undefined && (now - lastFetchedAt) < REFETCH_COOLDOWN_MS) continue;
            this._fetchedUnresolvedChannels.set(key, now);
            eligible.push(channelId);
        }
        const doFetch = channelId => {
            try {
                const lastMessageId = rs?.lastMessageId?.(channelId);
                let afterId = "0";
                if (lastMessageId) {
                    try { afterId = (BigInt(lastMessageId) - 1n).toString(); } catch (_) { afterId = "0"; }
                }
                actions.fetchMessages({ channelId, after: afterId, limit: 2 });
            } catch (error) { _recordPatchCatch("readState.fetchUnresolvedMessages", this, error); }
        };
        for (let i = 0; i < eligible.length; i += MAX_CONCURRENT_FETCHES) {
            const batch = eligible.slice(i, i + MAX_CONCURRENT_FETCHES);
            if (i === 0) {
                batch.forEach(doFetch);
            } else {
                const delay = BATCH_SPACING_MS * (i / MAX_CONCURRENT_FETCHES);
                const timerId = this.api.resources.timer('startupTimers', () => {
                    this.api.coordination.removeStartupTimer(timerId);
                    if (!this.api.isRunning) return;
                    batch.forEach(doFetch);
                }, delay);
                this.api.coordination.addStartupTimer(timerId);
            }
        }
    }

    _scheduleUnresolvedBlockedUnreadRetry(attempt = 0) {
        const effectiveAttempt = Math.max(attempt, this._unresolvedBlockedUnreadHighestAttempt || 0);
        this._unresolvedBlockedUnreadHighestAttempt = effectiveAttempt;
        const attemptForThisCall = effectiveAttempt;
        if (attemptForThisCall >= 10) {
            this._hasPendingUnreadResolution = false;
            this._releaseUnreadBadgeBootGuard?.();
            return;
        }
        if (this._unresolvedBlockedUnreadRetryTimeout) {
            return;
        }
        const delay = Math.min(500 * Math.pow(2, attemptForThisCall), 4000);
        this._unresolvedBlockedUnreadRetryTimeout = this.api.resources.timer('unresolvedBlockedUnread', () => {
            this._unresolvedBlockedUnreadRetryTimeout = null;
            try {
                const stillPending = this.bootstrapBlockedUnreadSuppression(attemptForThisCall + 1);
                if (!stillPending) this._releaseUnreadBadgeBootGuard?.();
            } catch (error) { _recordPatchCatch("readState.unresolvedUnreadRetry", this, error); }
        }, delay);
    }

    markBlockedOnlyReadActivity(channelId, parentChannelId, activityId) {
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

    channelHasGenuineUnreadOtherThanBlocked(channelId) {
        if (!channelId) return false;
        try {
            const store = this.api.stores.ReadStateStore;
            const ackId = store?.ackMessageId ? store.ackMessageId(channelId) : null;
            const lastId = store?.lastMessageId ? store.lastMessageId(channelId) : null;
            if (!ackId || !lastId) return false;
            if (!this.snowflakeGreater(lastId, ackId)) return false;
            return !this.hasBlockedOnlyReadActivity(channelId);
        } catch (_) {
            return false;
        }
    }

    clearBlockedOnlyReadActivity(channelId) {
        if (!channelId || !this._blockedOnlyReadChannels) return;
        const id = String(channelId);
        this._blockedOnlyReadChannels.delete(id);
        if (this._blockedReadCache && id in this._blockedReadCache) {
            delete this._blockedReadCache[id];
            this.saveBlockedReadCache();
        }
    }

    hasBlockedOnlyReadActivity(channelId) {
        if (!channelId) return false;
        const id = String(channelId);
        const rs = this.api.stores.ReadStateStore;
        const lastId = rs?.lastMessageId?.(channelId);
        if (this._blockedOnlyReadChannels?.has(id)) {
            const cachedForSet = this._blockedReadCache?.[id];
            if (lastId && cachedForSet) {
                if (String(lastId) === String(cachedForSet)) return true;
                this._blockedOnlyReadChannels.delete(id);
                this.clearBlockedOnlyReadActivity(id);
            } else {
                return true;
            }
        }
        const cached = this._blockedReadCache?.[id];
        if (lastId && cached && String(lastId) !== String(cached)) {
            this.clearBlockedOnlyReadActivity(id);
            return false;
        }
        return !!(lastId && cached && String(lastId) === String(cached));
    }

    _resolveUnreadFromBlockedOnly(channelId, store, helpers) {
        if (!channelId || !store || !helpers) return null;
        const lastMessageId = store.lastMessageId ? store.lastMessageId(channelId) : null;
        if (!lastMessageId) return null;
        const getMessage = this.api.stores.MessageStore?.getMessage;
        const directMsg = getMessage ? getMessage(channelId, lastMessageId) : null;
        if (directMsg) return !helpers.isBlockedMessage(directMsg);
        const ownerId = helpers.resolveForumActivityOwnerId?.(channelId, lastMessageId);
        if (ownerId && this.api.visibility.shouldHide(ownerId)) return false;
        try {
            const threadCh = this.api.stores.ChannelStore?.getChannel?.(lastMessageId);
            const threadOwner = threadCh?.ownerId || threadCh?.owner_id;
            if (threadOwner && this.api.visibility.shouldHide(threadOwner)) return false;
        } catch (error) { _recordPatchCatch("readState.resolveForumThreadOwner", this, error); }
        if (this.hasBlockedOnlyReadActivity(channelId)) return false;
        try {
            const ackId = store.ackMessageId ? store.ackMessageId(channelId) : null;
            const messages = helpers.getChannelMessages(channelId);
            const cacheHasLatest = messages.length && String(messages[messages.length - 1]?.id) === String(lastMessageId);
            if (ackId && cacheHasLatest) {
                const unread = messages.filter(m => m?.id && this.snowflakeGreater(m.id, ackId));
                if (unread.length) return unread.some(m => !helpers.isBlockedMessage(m));
                return true;
            }
            if (cacheHasLatest) {
                const newest = messages[messages.length - 1];
                return !helpers.isBlockedMessage(newest);
            }
            if (this._fetchedUnresolvedChannels?.has(String(channelId))) {
                return true;
            }
        } catch (error) { _recordPatchCatch("readState.resolveBlockedOnlyUnread", this, error); }
        return null;
    }

    _resolveChannelVisibleUnread(channelId, rawRet) {
        if (!rawRet) return rawRet;
        if (!this.api.messagesEnabled) return rawRet;
        if (!channelId) return rawRet;
        try {
            if (this.api.visibility.isForumParentChannel(channelId)) {
                const forumResult = this._hasVisibleForumActivity(channelId);
                if (forumResult !== null) return forumResult;
            }
            const store = this.api.stores.ReadStateStore;
            const oldestUnreadId = store.getOldestUnreadMessageId ? store.getOldestUnreadMessageId(channelId) : null;
            const messages = this._getChannelMessages(channelId);
            if (!messages.length) {
                const forumResult = this._hasVisibleForumActivity(channelId);
                if (forumResult !== null) return forumResult;
                const blockedOnly = this._resolveUnreadFromBlockedOnly(channelId, store, this.getReadStateHelpers());
                if (blockedOnly === false) return false;
                return rawRet;
            }
            if (oldestUnreadId) {
                const idx = messages.findIndex(m => m?.id === oldestUnreadId);
                if (idx !== -1) {
                    const unreadSlice = messages.slice(idx);
                    return unreadSlice.some(m => !this.api.visibility.isBlockedMessage(m));
                }
            }
            const lastMessageId = store.lastMessageId ? store.lastMessageId(channelId) : null;
            const lastMessage = lastMessageId ? messages.find(m => m?.id === lastMessageId) : null;
            if (lastMessage && this.api.visibility.isBlockedMessage(lastMessage)) {
                const anyVisibleUnread = messages.some(m => !this.api.visibility.isBlockedMessage(m));
                if (!anyVisibleUnread) return false;
            }
            const blockedOnly = this._resolveUnreadFromBlockedOnly(channelId, store, this.getReadStateHelpers());
            if (blockedOnly === false) return false;
            return rawRet;
        } catch (error) {
            _recordPatchCatch("readState.resolveChannelVisibleUnread", this, error);
            return rawRet;
        }
    }

    _guildHasBlockedOnlyUnread(guildId) {
        if (!guildId) return false;
        if (this._blockedOnlyReadChannels?.size) {
            const cs = this.api.stores.ChannelStore;
            for (const channelId of this._blockedOnlyReadChannels) {
                try {
                    if (cs?.getChannel?.(channelId)?.guild_id === guildId) return true;
                } catch (error) { _recordPatchCatch("readState.findBlockedOnlyGuildChannel", this, error); }
            }
        }
        if (this._blockedReadCache && this.api.stores.ReadStateStore) {
            const cs = this.api.stores.ChannelStore;
            for (const channelId of Object.keys(this._blockedReadCache)) {
                try {
                    if (cs?.getChannel?.(channelId)?.guild_id === guildId && this.hasBlockedOnlyReadActivity(channelId)) return true;
                } catch (error) { _recordPatchCatch("readState.checkCachedBlockedOnlyGuildChannel", this, error); }
            }
        }
        const gcs = this.api.stores.GuildChannelStore;
        const helpers = gcs ? this.getReadStateHelpers() : null;
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
            } catch (error) { _recordPatchCatch("readState.guildBlockedOnlyUnread", this, error); }
        }
        return false;
    }

    forceReadStateRecheck(immediate = false) {
        const run = () => {
            this._readStateRecheckInFlight = true;
            try {
                this.emitReadStateChanges();
            } catch (error) {
                _recordPatchCatch("readState.forceRecheck", this, error);
            } finally {
                this._readStateRecheckInFlight = false;
            }
        };
        if (immediate) {
            this.api.resources.cancelDebounce('readStateRecheck');
            run();
            return;
        }
        if (this._readStateRecheckInFlight) return;
        this.api.resources.debounce('readStateRecheck', run, 100);
    }

    _scheduleReadStateReloadRechecks() {
        if (this._readStateReloadRecheckTimers) {
            for (const timer of this._readStateReloadRecheckTimers) this.api.resources.clearTimer('readStateReloadRecheck', timer);
        }
        this.forceReadStateRecheck(true);
        this._readStateReloadRecheckTimers = [ 0, 300, 800, 2e3, 5e3, 1e4 ].map(delay => this.api.resources.timer('readStateReloadRecheck', () => {
            if (this.api.isRunning) {
                this.bootstrapBlockedUnreadSuppression();
                this.forceReadStateRecheck(delay === 0);
            }
        }, delay));
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
            const ch = this.api.stores.ChannelStore?.getChannel?.(threadOrId);
            return ch?.ownerId || ch?.owner_id || null;
        } catch (_) { return null; }
    }

    _collectThreadsForParent(channelId, guildId) {
        const seen = new Map;
        const add = thread => { if (!thread) return; const id = thread?.id || thread?.channel?.id; if (id && !seen.has(id)) seen.set(id, thread); };
        try { const fn = this.api.stores.ChannelStore?.getAllThreadsForParent; if (typeof fn === 'function') { const t = fn.call(this.api.stores.ChannelStore, channelId); if (Array.isArray(t)) t.forEach(add); } } catch (error) { _recordPatchCatch("ReadStateSurface._collectThreadsForParent.fallback1", this, error); }
        try { const ts = this.api.stores.ThreadStore; if (typeof ts?.getThreadsForParent === 'function') { const a = guildId ? [guildId, channelId] : [channelId]; const r = ts.getThreadsForParent(...a); if (Array.isArray(r)) r.forEach(add); else if (r && typeof r === 'object') Object.values(r).forEach(add); } } catch (error) { _recordPatchCatch("ReadStateSurface._collectThreadsForParent.fallback2", this, error); }
        try { const ajs = this.api.stores.ActiveJoinedThreadsStore; if (ajs) { const a = guildId ? [guildId, channelId] : [channelId]; this._flattenThreadEntries(ajs.getActiveJoinedThreadsForParent?.(...a)).forEach(add); this._flattenThreadEntries(ajs.getActiveUnjoinedThreadsForParent?.(...a)).forEach(add); } } catch (error) { _recordPatchCatch("ReadStateSurface._collectThreadsForParent.fallback3", this, error); }
        return Array.from(seen.values());
    }

    _resolveForumActivityOwnerId(parentChannelId, activityId) {
        if (!activityId) return null;
        let ownerId = this._getThreadOwnerId(activityId);
        if (ownerId) return ownerId;
        const parent = this.api.stores.ChannelStore?.getChannel?.(parentChannelId);
        const guildId = parent?.guild_id;
        const threads = this._collectThreadsForParent(parentChannelId, guildId);
        for (const thread of threads) {
            const tId = thread?.id || thread?.channel?.id;
            const lmId = thread?.lastMessageId || thread?.channel?.lastMessageId;
            if (tId !== activityId && lmId !== activityId) continue;
            ownerId = this._getThreadOwnerId(thread);
            if (ownerId) return ownerId;
        }
        try { const gm = this.api.stores.MessageStore?.getMessage; if (typeof gm === 'function') { for (const thread of threads) { const tId = thread?.id || thread?.channel?.id; if (!tId) continue; const msg = gm(tId, activityId); if (msg) return this.api.visibility.getAuthorId(msg); } const pm = gm(parentChannelId, activityId); if (pm) return this.api.visibility.getAuthorId(pm); } } catch (error) { _recordPatchCatch("ReadStateSurface._resolveForumActivityOwnerId.fallback1", this, error); }
        try { const msg = this._getChannelMessages(parentChannelId).find(m => m?.id === activityId); if (msg) return this.api.visibility.getAuthorId(msg); } catch (error) { _recordPatchCatch("ReadStateSurface._resolveForumActivityOwnerId.fallback2", this, error); }
        for (const thread of threads) { const tId = thread?.id || thread?.channel?.id; if (!tId) continue; try { const msg = this._getChannelMessages(tId).find(m => m?.id === activityId); if (msg) return this.api.visibility.getAuthorId(msg); } catch (error) { _recordPatchCatch("ReadStateSurface._resolveForumActivityOwnerId.fallback3", this, error); } }
        if (guildId && this.api.stores.GuildChannelStore?.getChannels) {
            try { const groups = this.api.stores.GuildChannelStore.getChannels(guildId); const entries = groups ? Object.values(groups).flat() : []; for (const entry of entries) { const ch = entry?.channel || entry; if (!ch?.id || ch.parent_id !== parentChannelId) continue; if (ch.id !== activityId && ch.lastMessageId !== activityId) continue; ownerId = ch.ownerId || ch.owner_id; if (ownerId) return ownerId; } } catch (error) { _recordPatchCatch("ReadStateSurface._resolveForumActivityOwnerId.fallback4", this, error); }
        }
        return null;
    }

    _hasVisibleUnreadThreadsFromStore(channelId, guildId) {
        const ajs = this.api.stores.ActiveJoinedThreadsStore;
        if (!ajs) return null;
        try { const a = guildId ? [guildId, channelId] : [channelId]; const vu = [...this._flattenThreadEntries(ajs.getActiveJoinedUnreadThreadsForParent?.(...a)), ...this._flattenThreadEntries(ajs.getActiveUnjoinedUnreadThreadsForParent?.(...a))]; return vu.length > 0; } catch (_) { return null; }
    }

    _hasVisibleForumActivity(channelId) {
        try {
            if (this.hasBlockedOnlyReadActivity(channelId)) return false;
            if (!this.api.visibility.isForumParentChannel(channelId)) return null;
            const rs = this.api.stores.ReadStateStore;
            const ackId = rs.ackMessageId ? rs.ackMessageId(channelId) : null;
            const lastId = rs.lastMessageId ? rs.lastMessageId(channelId) : null;
            if (!this.snowflakeGreater(lastId, ackId)) return false;
            const parent = this.api.stores.ChannelStore?.getChannel?.(channelId);
            const guildId = parent?.guild_id;
            const threads = this._collectThreadsForParent(channelId, guildId);
            if (threads.length) {
                for (const thread of threads) {
                    const ownerId = this._getThreadOwnerId(thread);
                    const actId = thread?.lastMessageId || thread?.channel?.lastMessageId || thread?.id;
                    if (!this.snowflakeGreater(actId, ackId)) continue;
                    if (!ownerId) continue;
                    if (!this.api.visibility.shouldHide(ownerId)) return true;
                }
                const aoId = this._resolveForumActivityOwnerId(channelId, lastId);
                if (aoId) return !this.api.visibility.shouldHide(aoId);
                return false;
            }
            const aoId = this._resolveForumActivityOwnerId(channelId, lastId);
            if (aoId) return !this.api.visibility.shouldHide(aoId);
            const vu = this._hasVisibleUnreadThreadsFromStore(channelId, guildId);
            if (vu === true) return true;
            if (vu === false) return false;
            try { if (rs.getUnreadCount?.(channelId) === 0) return false; } catch (error) { _recordPatchCatch("readState.forumUnreadCount", this, error); }
            return null;
        } catch (error) {
            _recordPatchCatch("readState.visibleForumActivity", this, error);
            return null;
        }
    }

    _filterReadStateThreadList(list) {
        const getOwnerId = thread => this._getThreadOwnerId(thread);
        const isBlocked = entry => !!(this.api.threadsEnabled !== false && getOwnerId(entry) && this.api.visibility.shouldHide(getOwnerId(entry)));
        if (Array.isArray(list)) return list.filter(entry => !isBlocked(entry));
        if (list && typeof list === "object") {
            const filtered = {};
            for (const [key, value] of Object.entries(list)) {
                if (Array.isArray(value)) {
                    const entries = value.filter(entry => !isBlocked(entry));
                    if (entries.length) filtered[key] = entries;
                } else if (value && typeof value === "object" && getOwnerId(value)) {
                    if (!isBlocked(value)) filtered[key] = value;
                } else {
                    filtered[key] = value;
                }
            }
            return filtered;
        }
        return list;
    }
    _hasVisibleThreadEntries(list) {
        return Array.isArray(list) ? list.length > 0 : Object.values(list || {}).some(value =>
            Array.isArray(value) ? value.length > 0 : !!(value && typeof value === "object" && (value.id || value.channel?.id || this._getThreadOwnerId(value))));
    }
    _patchThreadStoreReadMethods(threadsStore) {
        const self = this;
        if (threadsStore) {
            const filterWrapper = (_, args, ret) => {
                if (!ret || !self.api.messagesEnabled || !self.api.threadsEnabled) return ret;
                try { return self._filterReadStateThreadList(ret); } catch (_) { _recordPatchCatch("patchReadState.filterThreadList"); return ret; }
            };
            const THREAD_LIST_METHODS = ['getActiveJoinedUnreadThreadsForParent','getActiveJoinedUnreadThreadsForGuild','getActiveUnjoinedUnreadThreadsForParent','getActiveUnjoinedUnreadThreadsForGuild','getActiveJoinedThreadsForParent','getActiveJoinedThreadsForGuild','getActiveJoinedRelevantThreadsForParent','getActiveJoinedRelevantThreadsForGuild','getActiveUnjoinedThreadsForParent','getActiveUnjoinedThreadsForGuild'];
            for (const m of THREAD_LIST_METHODS) { if (typeof threadsStore[m] === 'function') this.api.patching.after(threadsStore, m, filterWrapper); }
            this.api.patching.after(threadsStore, "getActiveThreadCount", function(_, args, ret) {
                if (!ret || typeof ret !== "number" || ret <= 0) return ret;
                if (!self.api.messagesEnabled || !self.api.threadsEnabled) return ret;
                if (!args || !args.length) return ret;
                try {
                    const joined = threadsStore.getActiveJoinedThreadsForParent?.(...args);
                    const unjoined = threadsStore.getActiveUnjoinedThreadsForParent?.(...args);
                    const combined = [ ...self._flattenThreadEntries(joined), ...self._flattenThreadEntries(unjoined) ];
                    return Math.min(ret, combined.length);
                } catch (_) {
                    _recordPatchCatch("patchReadState.getActiveThreadCount");
                    return ret;
                }
            });
            this.api.patching.after(threadsStore, "hasActiveJoinedUnreadThreads", function(_, args, ret) {
                if (!ret) return ret;
                if (!self.api.messagesEnabled || !self.api.threadsEnabled) return ret;
                if (!args || !args.length) return ret;
                try {
                    const forParent = threadsStore.getActiveJoinedUnreadThreadsForParent?.(...args);
                    if (forParent !== undefined) {
                        return self._hasVisibleThreadEntries(self._filterReadStateThreadList(forParent));
                    }
                    return ret;
                } catch (_) {
                    _recordPatchCatch("patchReadState.hasActiveJoinedUnreadThreads");
                    return ret;
                }
            });
            this.api.patching.after(threadsStore, "getNewThreadCount", function(_, args, ret) {
                if (!ret || typeof ret !== "number" || ret <= 0) return ret;
                if (!self.api.messagesEnabled || !self.api.threadsEnabled) return ret;
                if (!args || !args.length) return ret;
                const readStateStore = self.api.stores.ReadStateStore;
                if (!readStateStore?.ackMessageId || !readStateStore?.lastMessageId) return ret;
                try {
                    const channelId = args[args.length - 1];
                    const ackId = readStateStore.ackMessageId(channelId);
                    if (ackId == null) return 0;
                    const joined = threadsStore.getActiveJoinedUnreadThreadsForParent?.(...args);
                    const unjoined = threadsStore.getActiveUnjoinedUnreadThreadsForParent?.(...args);
                    let count = 0;
                    for (const entry of self._flattenThreadEntries(joined)) {
                        const threadChannelId = entry?.channel?.id || entry?.id;
                        const lm = threadChannelId ? readStateStore.lastMessageId(threadChannelId) : null;
                        if (lm != null && lm > ackId) count++;
                    }
                    for (const entry of self._flattenThreadEntries(unjoined)) {
                        const threadId = entry?.id || entry?.channel?.id;
                        const lm = threadId ? readStateStore.lastMessageId(threadId) : null;
                        if (lm != null && lm > ackId) count++;
                    }
                    return count;
                } catch (_) {
                    _recordPatchCatch("patchReadState.getNewThreadCount");
                    return ret;
                }
            });
        }
    }

    _patchChannelReadStateMethods() {
        const self = this;
        this.api.patching.after(this.api.stores.ReadStateStore, "getUnreadCount", function(_, args, ret) {
            if (!self.api.messagesEnabled) return ret;
            if (!ret || typeof ret !== "number" || ret <= 0) return ret;
            const channelId = args?.[0];
            if (!channelId) return ret;
            try {
                const messages = self._getChannelMessages(channelId).slice().reverse();
                let hiddenCount = 0;
                for (let i = 0; i < ret && i < messages.length; i++) {
                    if (self.api.visibility.isBlockedMessage(messages[i])) hiddenCount++; else break;
                }
                return ret - hiddenCount;
            } catch (error) {
                _recordPatchCatch("patchReadState.getUnreadCount", self, error);
                return ret;
            }
        });
        if (typeof this.api.stores.ReadStateStore.getMentionCount === "function") {
            this.api.patching.instead(this.api.stores.ReadStateStore, "getMentionCount", function(ctx, args, orig) {
                const channelId = args?.[0];
                if (channelId && self.hasBlockedOnlyReadActivity(channelId)) return 0;
                return orig.apply(ctx, args);
            });
        }
        const filterUnread = function(ctx, args, orig) {
            const channelId = args?.[0];
            if (channelId && self.hasBlockedOnlyReadActivity(channelId)) return false;
            const ret = orig.apply(ctx, args);
            return self._resolveChannelVisibleUnread(channelId, ret);
        };
        this.api.patching.instead(this.api.stores.ReadStateStore, "hasUnread", filterUnread);
        for (const methodName of [ "hasUnreadOrMentions", "hasTrackedUnread" ]) {
            if (typeof this.api.stores.ReadStateStore[methodName] !== "function") continue;
            this.api.patching.instead(this.api.stores.ReadStateStore, methodName, filterUnread);
        }
    }

    _patchGuildReadStateMethod() {
        const self = this;
        this.api.patching.instead(this.api.stores.GuildReadStateStore, "hasUnread", function(ctx, args, orig) {
            const ret = orig.apply(ctx, args);
            if (!ret) return ret;
            if (!self.api.messagesEnabled) return ret;
            const guildId = args?.[0];
            if (!guildId) return ret;
            try {
                const channels = self.api.stores.GuildChannelStore.getChannels?.(guildId);
                const selectable = channels?.SELECTABLE;
                if (!Array.isArray(selectable)) {
                    if (self._guildHasBlockedOnlyUnread(guildId)) return false;
                    return ret;
                }
                const visible = selectable.map(entry => entry?.channel?.id).filter(Boolean).some(cid => self.channelHasVisibleUnread(cid));
                if (visible) return true;
                if (self._guildHasBlockedOnlyUnread(guildId)) return false;
                return false;
            } catch (error) {
                _recordPatchCatch("patchReadState.guildHasUnread", self, error);
                return ret;
            }
        });
    }

    _patchPinnedUnreadMethod() {
        const self = this;
        this.api.patching.after(this.api.stores.ReadStateStore, "hasUnreadPins", function(_, args, ret) {
            if (!ret) return ret;
            if (!self.api.messagesEnabled) return ret;
            const channelId = args?.[0];
            if (!channelId) return ret;
            try {
                const pinsStore = self.api.stores.ChannelPinsStore;
                const pins = pinsStore?.getPins ? pinsStore.getPins(channelId) : null;
                const items = pins?.items;
                if (!Array.isArray(items) || !items.length) return false;
                const store = self.api.stores.ReadStateStore;
                const lastPinTs = store.lastPinTimestamp ? store.lastPinTimestamp(channelId) : null;
                const newPins = _getUnreadPins(items, lastPinTs);
                if (!newPins.length) return false;
                const anyVisibleNewPin = newPins.some(item => {
                    const messageId = item?.message?.id;
                    return messageId && !self.api.surfaces.pins.shouldHidePinnedMessage(channelId, messageId, item);
                });
                return anyVisibleNewPin;
            } catch (error) {
                _recordPatchCatch("patchReadState.hasUnreadPins", self, error);
                return ret;
            }
        });
    }

    _registerReadStateChangeListeners() {
        if (this.api.stores.ChannelPinsStore?.addChangeListener && !this._channelPinsChangeHandler) {
            this._channelPinsChangeHandler = () => {
                const channelId = this.api.stores.SelectedChannelStore?.getChannelId?.();
                if (channelId) {
                    this.api.surfaces.pins.scanExistingPinsForChannel(channelId);
                    const items = this.api.stores.ChannelPinsStore?.getPins?.(channelId)?.items;
                    this.api.surfaces.pins.processPinStoreItems(channelId, items);
                }
                this.forceReadStateRecheck(true);
                this.api.coordination.queueScan();
            };
            this.api.stores.ChannelPinsStore.addChangeListener(this._channelPinsChangeHandler);
        }
        const threadsStore = this.api.stores.ActiveJoinedThreadsStore;
        this._patchThreadStoreReadMethods(threadsStore);
        const scheduleReadStateRecheck = () => this.forceReadStateRecheck();
        try {
            if (threadsStore?.addChangeListener && !this._threadsStoreChangeHandler) {
                this._threadsStoreChangeHandler = scheduleReadStateRecheck;
                threadsStore.addChangeListener(this._threadsStoreChangeHandler);
            }
        } catch (error) { _recordPatchCatch("patchReadState.activeJoinedThreadsListener", this, error); }
        try {
            if (this.api.stores.ThreadStore?.addChangeListener && !this._threadStoreChangeHandler) {
                this._threadStoreChangeHandler = scheduleReadStateRecheck;
                this.api.stores.ThreadStore.addChangeListener(this._threadStoreChangeHandler);
            }
        } catch (error) { _recordPatchCatch("patchReadState.threadStoreListener", this, error); }
        try {
            if (this.api.stores.ChannelStore?.addChangeListener && !this._channelStoreChangeHandler) {
                this._channelStoreChangeHandler = scheduleReadStateRecheck;
                this.api.stores.ChannelStore.addChangeListener(this._channelStoreChangeHandler);
            }
        } catch (error) { _recordPatchCatch("patchReadState.channelStoreListener", this, error); }
    }

    _patchReadStateTaskbarBadge() {
        if (this._taskbarBadgePatched) return;
        const grs = this.api.stores.GuildReadStateStore;
        if (grs?.hasAnyUnread) {
            this.api.patching.after(grs, "hasAnyUnread", (_, __, ret) => {
                if (!this.api.surfaces.badge.taskbarBadgeEnabled() || !ret) return ret;
                return this.filteredHasAnyUnread();
            });
        }
        if (grs?.getTotalMentionCount) {
            this.api.patching.after(grs, "getTotalMentionCount", (_, __, ret) => {
                if (!this.api.surfaces.badge.taskbarBadgeEnabled()) return ret;
                if (typeof ret !== "number" || !Number.isFinite(ret) || ret <= 0) return ret;
                return Math.min(ret, Math.max(0, this.filteredTotalMentionCount()));
            });
        }
        this._taskbarBadgePatched = true;
    }

    _finishReadStateSetup() {
        this.api.coordination.patchNotificationDispatcher();
        const relationshipStoreReady = !!this.api.visibility.relationshipResolverReady;
        if (relationshipStoreReady) {
            this._readStatePatched = true;
        }
        this._applyBlockedReadCacheOnStartup();
        this.bootstrapBlockedUnreadSuppression();
        this.api.surfaces.groupDms.scanExistingRecipientAdds();
        this.api.surfaces.groupDms.applyGroupDMUnreadSectionGhosting();
        if (relationshipStoreReady) {
            this.api.surfaces.badge.refreshTaskbarBadge();
            this._releaseUnreadBadgeBootGuard();
        } else {
            this._retryTaskbarBadgeUntilRelationshipReady();
        }
    }

    patchReadState(attempt = 0) {
        this.api.surfaces.badge.ensureTaskbarElectronPatch();
        if (!this.api.stores.ReadStateStore) return;
        if (this._readStatePatchesRegistered) {
            this._applyBlockedReadCacheOnStartup();
            this.bootstrapBlockedUnreadSuppression();
            const relationshipStoreReady = !!this.api.visibility.relationshipResolverReady;
            if (relationshipStoreReady) {
                this._readStatePatched = true;
                this.api.surfaces.badge.refreshTaskbarBadge();
            }
            return;
        }
        const essentialMethodsPresent = typeof this.api.stores.ReadStateStore.getUnreadCount === "function"
            && typeof this.api.stores.ReadStateStore.hasUnread === "function";
        if (!essentialMethodsPresent) {
            if (attempt < 15) {
                this.api.retry.schedule(() => this.patchReadState(attempt + 1), this.api.retry.delay(attempt, 2000));
            } else {
                this.api.patching.warn("patchReadState", new Error("ReadStateStore is missing getUnreadCount/hasUnread after 15 attempts - Discord likely renamed these methods; unread counts for blocked users will not be filtered until the plugin is updated."));
            }
            return;
        }
        this._readStatePatchesRegistered = true;
        this._patchChannelReadStateMethods();
        this._patchGuildReadStateMethod();
        this._patchPinnedUnreadMethod();
        this._registerReadStateChangeListeners();
        this._patchReadStateTaskbarBadge();
        this._finishReadStateSetup();
    }

    _releaseUnreadBadgeBootGuard() {
        if (this._hasPendingUnreadResolution) {
            return;
        }
        try {
            document.getElementById('ByeBlocked-unreadbadge-bootguard')?.remove();
        } catch (error) { _recordPatchCatch("ReadStateSurface._releaseUnreadBadgeBootGuard.L10147", null, error); }
        try {
            BdApi.Patcher.unpatchAll('ByeBlockedTaskbarBadgeBootRace');
        } catch (error) {
            _recordPatchCatch("ReadStateSurface._releaseUnreadBadgeBootGuard.L10150", null, error);
            return;
        }
        if (this._readStatePatched) this.api.surfaces.badge.refreshTaskbarBadge();
    }

    _retryTaskbarBadgeUntilRelationshipReady(attempt = 0) {
        if (this._readStatePatched) return;
        if (this.api.visibility.relationshipResolverReady) {
            this._readStatePatched = true;
            this.bootstrapBlockedUnreadSuppression();
            this.api.surfaces.badge.refreshTaskbarBadge();
            this.forceReadStateRecheck?.(true);
            this._releaseUnreadBadgeBootGuard();
            return;
        }
        if (attempt >= 15) {
            this.api.patching.warn("_retryTaskbarBadgeUntilRelationshipReady", new Error("RelationshipStore.isBlocked never resolved after 15 attempts - unread suppression for blocked users will not work until this is fixed."));
            try { document.getElementById('ByeBlocked-unreadbadge-bootguard')?.remove(); } catch (error) { _recordPatchCatch("ReadStateSurface._retryTaskbarBadgeUntilRelationshipReady.L10165", null, error); }
            try { BdApi.Patcher.unpatchAll('ByeBlockedTaskbarBadgeBootRace'); } catch (error) { _recordPatchCatch("ReadStateSurface._retryTaskbarBadgeUntilRelationshipReady.L10166", null, error); }
            return;
        }
        this.api.resources.clearTimer('taskbarBadge', this._taskbarBadgeRelationshipRetryTimeout);
        this._taskbarBadgeRelationshipRetryTimeout = this.api.resources.timer('taskbarBadge', () => {
            this._taskbarBadgeRelationshipRetryTimeout = null;
            this._retryTaskbarBadgeUntilRelationshipReady(attempt + 1);
        }, this.api.retry.delay ? this.api.retry.delay(attempt, 1000) : Math.min(1000 * (attempt + 1), 8000));
    }

    getReadStateHelpers() {
        return {
            getChannelMessages: cid => this._getChannelMessages(cid),
            isBlockedMessage: msg => this.api.visibility.isBlockedMessage(msg),
            isForumParentChannel: cid => this.api.visibility.isForumParentChannel(cid),
            hasVisibleForumActivity: cid => this._hasVisibleForumActivity(cid),
            resolveForumActivityOwnerId: (p, a) => this._resolveForumActivityOwnerId(p, a)
        };
    }

    startBlockedReadCachePrune() {
        this._blockedReadCachePruneInterval = this.api.resources.interval('blockedReadCachePrune', () => {
            try {
                const cache = this._blockedReadCache;
                const cs = this.api.stores.ChannelStore;
                if (!cache || !cs || typeof cs.getChannel !== "function") return;
                let changed = false;
                for (const channelId of Object.keys(cache)) {
                    try {
                        if (!cs.getChannel(channelId)) {
                            delete cache[channelId];
                            this._blockedOnlyReadChannels?.delete(channelId);
                            changed = true;
                        }
                    } catch (_) { _recordPatchCatch("patchReadState.pruneChannelCache"); }
                }
                if (changed) this.saveBlockedReadCache();
            } catch (_) { _recordPatchCatch("patchReadState.pruneCache"); }
        }, 6e5);
    }

    start() {
        this.startBlockedReadCachePrune();
    }
    patchEarly() {
        this.api.patching.safe('patchReadState', () => this.patchReadState());
        this.api.patching.safe('scheduleReadStateReloadRechecks', () => this._scheduleReadStateReloadRechecks());
    }
    stop() {
        this._fetchedUnresolvedChannels = null;
        this.api.resources.cancelDebounce('readStateRecheck');
        this._readStateRecheckInFlight = false;
        if (this._readStateReloadRecheckTimers) {
            for (const timer of this._readStateReloadRecheckTimers) this.api.resources.clearTimer('readStateReloadRecheck', timer);
            this._readStateReloadRecheckTimers = null;
        }
        this.api.resources.clearTimer('taskbarBadge', this._taskbarBadgeRelationshipRetryTimeout);
        this._taskbarBadgeRelationshipRetryTimeout = null;
        this.api.resources.clearTimer('unresolvedBlockedUnread', this._unresolvedBlockedUnreadRetryTimeout);
        this._unresolvedBlockedUnreadRetryTimeout = null;
        this._unresolvedBlockedUnreadHighestAttempt = 0;
        try { this.api.stores.ChannelPinsStore?.removeChangeListener?.(this._channelPinsChangeHandler); } catch (error) { _recordPatchCatch("ReadStateSurface.stop.L10233", null, error); }
        this._channelPinsChangeHandler = null;
        try { this.api.stores.ActiveJoinedThreadsStore?.removeChangeListener?.(this._threadsStoreChangeHandler); } catch (error) { _recordPatchCatch("ReadStateSurface.stop.L10235", null, error); }
        this._threadsStoreChangeHandler = null;
        try { this.api.stores.ThreadStore?.removeChangeListener?.(this._threadStoreChangeHandler); } catch (error) { _recordPatchCatch("ReadStateSurface.stop.L10237", null, error); }
        this._threadStoreChangeHandler = null;
        try { this.api.stores.ChannelStore?.removeChangeListener?.(this._channelStoreChangeHandler); } catch (error) { _recordPatchCatch("ReadStateSurface.stop.L10239", null, error); }
        this._channelStoreChangeHandler = null;
        this._taskbarBadgePatched = false;
        this._readStatePatchesRegistered = false;
        if (this._blockedReadCachePruneInterval) {
            this.api.resources.clearInterval('blockedReadCachePrune', this._blockedReadCachePruneInterval);
        }
        this._blockedReadCachePruneInterval = null;
    }

    clearTransientState() {
        this._blockedOnlyReadChannels.clear();
        this._unresolvedDmRecipientWarned.clear();
    }

    hasPendingUnreadResolution() {
        return this._hasPendingUnreadResolution;
    }

    isPatched() {
        return this._readStatePatched;
    }

    resetPatchedState() {
        this._readStatePatched = false;
    }
}


function createSoundSurfaceApi(plugin) {
    return Object.freeze({
        patchSound: retryCount => _patchSound.call(plugin, retryCount),
        patchSoundboardEffects: retryCount => _patchSoundboardEffects.call(plugin, retryCount),
        safe: (...args) => plugin._patcher.safe(...args),
    });
}

class SoundSurface {
    constructor(api) {
        this.api = api;
    }
    patchSound(retryCount = 0) {
        return this.api.patchSound(retryCount);
    }
    patchSoundboardEffects(retryCount = 0) {
        return this.api.patchSoundboardEffects(retryCount);
    }
    patchLate() {
        this.api.safe('patchSoundboardEffects', () => this.patchSoundboardEffects());
        this.api.safe('patchSound', () => this.patchSound());
    }
}

function createSettingsSurfaceApi(plugin) {
    return Object.freeze({
        getSettingsPanel: () => _settingsGetPanel.call(plugin),
        onSettingsChange: (...args) => _settingsOnChange.apply(plugin, args),
    });
}

class SettingsSurface {
    constructor(api) { this.api = api; }
    getSettingsPanel() { return this.api.getSettingsPanel(); }
    onSettingsChange(...args) { return this.api.onSettingsChange(...args); }
}

function _getSoundVoiceChannelId(self, RTCUtils) {
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

                if (resolved && (resolved.type === self.constructor.CHANNEL_TYPES.GUILD_VOICE || resolved.type === self.constructor.CHANNEL_TYPES.GUILD_STAGE_VOICE || resolved.type === self.constructor.CHANNEL_TYPES.DM || resolved.type === self.constructor.CHANNEL_TYPES.GROUP_DM)) {
                    channelId = candidate;
                }
            }
        } catch (_) {}
    }
    return channelId;
}

function _byeBlockedSoundInterceptor(context, args, originalMethod, self, RTCUtils) {
    if (!self.isRunning) return originalMethod.apply(context, args);
    const notifVoiceChat = self._notifEnabled("notifVoiceChat");
    const voiceSoundsEnabled = notifVoiceChat && (self.settings.behavior.muteVoiceJoinLeaveSound || self.settings.behavior.muteBlockedVoiceAudio);
    try {
        const soundType = args[0];
        if (soundType === "message1") {
            const pendingId = self._suppressGroupAddSoundMessageId;
            if (pendingId) {
                self._suppressGroupAddSoundMessageId = null;
                return;
            }
            if (Array.isArray(self._suppressMentionSoundCredits) && self._suppressMentionSoundCredits.length) {
                const now = Date.now();
                while (self._suppressMentionSoundCredits.length && self._suppressMentionSoundCredits[0] < now) {
                    self._suppressMentionSoundCredits.shift();
                }
                if (self._suppressMentionSoundCredits.length) {
                    self._suppressMentionSoundCredits.shift();
                    return;
                }
            }
            return originalMethod.apply(context, args);
        }
        if (!voiceSoundsEnabled) {
            return originalMethod.apply(context, args);
        }
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
        const channelId = _getSoundVoiceChannelId(self, RTCUtils);
        if (!channelId) return originalMethod.apply(context, args);

        if (self._lastSoundTrackedChannelId !== channelId) {
            self._lastSoundTrackedChannelId = channelId;
            let seedList = [];
            try {
                seedList = self._surfaces.voice.getRawVoiceStatesForChannel(channelId) || [];
            } catch (error) { _recordPatchCatch("sound.seedVoiceStates", self, error); }
            const seedSelfId = self._getSelfUserId?.();
            const seededIds = new Set(seedList.map(s => self.extractUserId(s)).filter(Boolean));
            seededIds.delete(seedSelfId);
            self._oldUnblockedConnectedUsers = seededIds;
        }

        const selfId = self._getSelfUserId?.();
        const nowTs = Date.now();
        const recentBuffer = self._recentVoiceStateChanges || [];
        const relevantChanges = recentBuffer.filter(e => {
            if (nowTs - e.ts > 1200) return false;
            if (e.userId === selfId) return false;
            return e.channelId === channelId || e.channelId === null || e.oldChannelId === channelId;
        });
        let changedIds;
        if (relevantChanges.length) {
            changedIds = [ ...new Set(relevantChanges.map(e => e.userId)) ];

            try {
                const liveList = self._surfaces.voice.getRawVoiceStatesForChannel(channelId) || [];
                const liveIds = new Set(liveList.map(s => self.extractUserId(s)).filter(Boolean));
                liveIds.delete(selfId);
                self._oldUnblockedConnectedUsers = liveIds;
            } catch (error) { _recordPatchCatch("sound.refreshVoiceStates", self, error); }
        } else {

            let voiceStatesList = [];
            try {
                voiceStatesList = self._surfaces.voice.getRawVoiceStatesForChannel(channelId) || [];
            } catch (error) { _recordPatchCatch("sound.readVoiceStates", self, error); }
            const currentIds = new Set(voiceStatesList.map(s => self.extractUserId(s)).filter(Boolean));
            currentIds.delete(selfId);
            const previousIds = self._oldUnblockedConnectedUsers instanceof Set ? self._oldUnblockedConnectedUsers : new Set((self._oldUnblockedConnectedUsers || []).map(s => self.extractUserId(s)).filter(Boolean));
            self._oldUnblockedConnectedUsers = currentIds;
            if (!currentIds.size && !previousIds.size) {
                return originalMethod.apply(context, args);
            }
            const joined = [ ...currentIds ].filter(id => !previousIds.has(id));
            const left = [ ...previousIds ].filter(id => !currentIds.has(id));
            changedIds = [ ...joined, ...left ];
        }
        if (!changedIds.length) {
            return originalMethod.apply(context, args);
        }
        const allChangedAreBlocked = changedIds.every(id => self.shouldHide(id));

        if (allChangedAreBlocked) return;
        return originalMethod.apply(context, args);
    } catch (error) {
        _recordPatchCatch("sound.interceptor", self, error);
        try { return originalMethod.apply(context, args); }
        catch (fallbackError) { _recordPatchCatch("sound.originalFallback", self, fallbackError); }
    }
}

function _patchSound(retryCount = 0) {

        const MAX_SOUND_PATCH_RETRIES = 10;
        const SoundUtils = this.modules.SoundUtils;
        let targetKey = null;
        if (SoundUtils) {
            const primaryKey = this._soundPlayKey || "playSound";
            const fallbackKey = this._soundFileKey || (primaryKey === "playSound" ? "playFile" : "playSound");
            targetKey = typeof SoundUtils[primaryKey] === "function" ? primaryKey : (typeof SoundUtils[fallbackKey] === "function" ? fallbackKey : null);
        }
        if (!targetKey) {
            if (retryCount < MAX_SOUND_PATCH_RETRIES) {
                const delay = Math.min(1000 * (retryCount + 1), 5000);
                this._scheduleRetry(() => this._surfaces.sound.patchSound(retryCount + 1), delay);
            } else {
                this._patcher?._warn('patchSound', new Error(SoundUtils ? 'Sound playback method not found after several attempts.' : 'SoundUtils unavailable after several attempts.'));
            }
            return;
        }
        if (this._soundPatchedFn && this._soundPatchedFn === SoundUtils[targetKey]) return;
        const RTCUtils = this.modules.RTCConnectionUtils;
        const self = this;

        const originalMethod = SoundUtils[targetKey];
        try {
            Object.defineProperty(SoundUtils, targetKey, {
                configurable: true,
                enumerable: true,
                writable: true,
                value: function(...args) {
                    return _byeBlockedSoundInterceptor(this, args, originalMethod, self, RTCUtils);
                }
            });
            this._soundPatchedFn = SoundUtils[targetKey];
            this._soundPatchState = { SoundUtils, targetKey, originalMethod };
        } catch (e) {
            this._patcher?._warn('patchSound', e);

            this.patchInstead(SoundUtils, targetKey, function(context, args, orig) {
                return _byeBlockedSoundInterceptor(context, args, orig, self, RTCUtils);
            });
        }
    }

function _patchSoundboardEffects(retryCount = 0) {

        const MAX_SOUNDBOARD_PATCH_RETRIES = 10;
        if (this._soundboardPatched) return;
        const Dispatcher = this.modules.Dispatcher;
        if (!Dispatcher || typeof Dispatcher.dispatch !== "function") {
            if (retryCount < MAX_SOUNDBOARD_PATCH_RETRIES) {
                const delay = Math.min(1000 * (retryCount + 1), 5000);
                this._scheduleRetry(() => this._surfaces.sound.patchSoundboardEffects(retryCount + 1), delay);
            } else {
                this._patcher?._warn('patchSoundboardEffects', new Error('Dispatcher unavailable after several attempts.'));
            }
            return;
        }
        const self = this;
        const installed = this.patchBefore(Dispatcher, "dispatch", function(context, args) {
            try {
                const action = args[0];
                if (!action || typeof action !== "object") return;
                if (action.type === self.constructor.ACTIONS.VOICE_STATE_UPDATES && Array.isArray(action.voiceStates)) {

                    self._recentVoiceStateChanges = self._recentVoiceStateChanges || [];
                    if (!self._soundVoiceUserChannelMap) self._soundVoiceUserChannelMap = new Map();
                    const nowTs = Date.now();
                    for (const vs of action.voiceStates) {
                        if (!vs) continue;
                        const userId = vs.userId || self.extractUserId(vs);
                        if (!userId) continue;
                        const newChannelId = vs.channelId || null;
                        const oldChannelId = self._soundVoiceUserChannelMap.has(userId)
                            ? self._soundVoiceUserChannelMap.get(userId)
                            : null;
                        self._recentVoiceStateChanges.push({ userId, channelId: newChannelId, oldChannelId, ts: nowTs });
                        if (newChannelId) self._soundVoiceUserChannelMap.set(userId, newChannelId);
                        else self._soundVoiceUserChannelMap.delete(userId);
                    }

                    self._recentVoiceStateChanges = self._recentVoiceStateChanges.filter(e => nowTs - e.ts < 3000);
                    for (const vs of action.voiceStates) {
                        if (vs && vs.selfStream === true && vs.userId) {
                            self._lastStreamerId = vs.userId;
                        } else if (vs && vs.selfStream === false && vs.userId && self._lastStreamerId === vs.userId) {
                            self._lastStreamerId = null;
                        }
                    }
                    try {
                        self._surfaces.voice.handleVoiceStateUpdatesForFakeTimer(action.voiceStates);
                    } catch (error) { _recordPatchCatch("soundboard.voiceState.fakeTimer", self, error); }
                    self._voiceStateRafId = requestAnimationFrame(function _byeBlockedVoiceRaf() {
                        self._voiceStateRafId = null;
                        if (!self.isRunning || !self.settings.places?.voiceChannels) return;
                        try { self.hideVoiceUsers(); } catch (error) { _recordPatchCatch("soundboard.voiceState.hideUsers", self, error); }
                        try { self._surfaces.voice.fixVoiceChannelIconColors(); } catch (error) { _recordPatchCatch("soundboard.voiceState.iconColors", self, error); }
                    });
                    if (!self._voiceStateTimers) self._voiceStateTimers = 0;
                    self._voiceStateTimers++;
                    const timerId = self._voiceStateTimers;
                    [200, 600].forEach(function _byeBlockedVoiceDelay(delay) {
                        self._resources.timer('voiceStateCheck', function _byeBlockedVoiceCheck() {
                            if (timerId !== self._voiceStateTimers) return;
                            if (!self.isRunning || !self.settings.places?.voiceChannels) return;
                            try { self.hideVoiceUsers(); } catch (error) { _recordPatchCatch("soundboard.voiceState.delayedHideUsers", self, error); }
                            try { self._surfaces.voice.fixVoiceChannelIconColors(); } catch (error) { _recordPatchCatch("soundboard.voiceState.delayedIconColors", self, error); }
                        }, delay);
                    });
                    return;
                }
                if (action.type === self.constructor.ACTIONS.EMBEDDED_ACTIVITY_UPDATE_V2) {
                    const participants = action.instance?.participants;
                    if (Array.isArray(participants)) {
                        self._lastActivityParticipantIds = new Set(participants.map(p => p?.user_id).filter(Boolean));
                        const hasParticipants = self._lastActivityParticipantIds.size > 0;
                        const allBlocked = hasParticipants && [ ...self._lastActivityParticipantIds ].every(id => self.shouldHide(id));
                        if (self.settings.places.voiceChannels && allBlocked) {
                            try {
                                const clonedInstance = Object.assign(Object.create(Object.getPrototypeOf(action.instance)), action.instance, { participants: [] });
                                const clonedAction = Object.assign(Object.create(Object.getPrototypeOf(action)), action, { instance: clonedInstance });
                                args[0] = clonedAction;
                            } catch (error) { _recordPatchCatch("soundboard.activity.clone", self, error); }
                        }
                    }
                    return;
                }
                if (action.type === self.constructor.ACTIONS.VOICE_CHANNEL_EFFECT_SEND) {
                    if (!self.settings.behavior.muteBlockedVoiceAudio) return;
                    const senderId = action.userId;
                    if (senderId && self.shouldHide(senderId)) {
                        try {
                            args[0] = Object.assign(Object.create(Object.getPrototypeOf(action)), action, { type: "_BYEBLOCKED_SUPPRESSED_VOICE_CHANNEL_EFFECT_SEND" });
                        } catch (error) { _recordPatchCatch("soundboard.voiceEffect.clone", self, error); }
                    }
                    return;
                }
                if (self._surfaces.channelStatus.isChannelStatusUpdateAction(action)) {
                    try {
                        self._surfaces.channelStatus.handleChannelStatusUpdateAction(action);
                    } catch (error) { _recordPatchCatch("soundboard.channelStatus.update", self, error); }
                }
            } catch (error) { _recordPatchCatch("soundboard.dispatch", self, error); }
        });
        if (installed) {
            this._soundboardPatched = true;
        } else if (retryCount < MAX_SOUNDBOARD_PATCH_RETRIES) {
            const delay = Math.min(1000 * (retryCount + 1), 5000);
            this._scheduleRetry(() => this._surfaces.sound.patchSoundboardEffects(retryCount + 1), delay);
        } else {
            this._patcher?._warn('patchSoundboardEffects', new Error('Dispatcher patch rejected after several attempts.'));
        }
    }

function createChannelStatusSurfaceApi(plugin) {
    return Object.freeze({
        isUpdateAction: (...args) => _channelStatusIsUpdateAction.apply(plugin, args),
        handleUpdateAction: (...args) => _channelStatusHandleUpdateAction.apply(plugin, args),
        belongsToBlocked: (...args) => _channelStatusBelongsToBlocked.apply(plugin, args),
        hasBlockedMember: (...args) => _channelStatusHasBlockedMember.apply(plugin, args),
        isPlaceholder: (...args) => _channelStatusIsPlaceholder.apply(plugin, args),
        suppressText: (...args) => _channelStatusSuppressText.apply(plugin, args),
        restoreText: (...args) => _channelStatusRestoreText.apply(plugin, args),
        findElement: (...args) => _channelStatusFindElement.apply(plugin, args),
        resync: (...args) => _channelStatusResync.apply(plugin, args),
        seed: (...args) => _channelStatusSeed.apply(plugin, args),
        reevaluate: (...args) => _channelStatusReevaluate.apply(plugin, args),
        findRow: (...args) => _channelStatusFindRow.apply(plugin, args),
        fastHideMutations: (...args) => _channelStatusFastHideMutations.apply(plugin, args),
    });
}
class ChannelStatusSurface {
    constructor(api) { this.api = api; }
    isChannelStatusUpdateAction(...args) { return this.api.isUpdateAction(...args); }
    handleChannelStatusUpdateAction(...args) { return this.api.handleUpdateAction(...args); }
    channelStatusBelongsToBlocked(...args) { return this.api.belongsToBlocked(...args); }
    channelHasBlockedMember(...args) { return this.api.hasBlockedMember(...args); }
    isChannelStatusPlaceholder(...args) { return this.api.isPlaceholder(...args); }
    suppressChannelStatusText(...args) { return this.api.suppressText(...args); }
    restoreChannelStatusText(...args) { return this.api.restoreText(...args); }
    findChannelStatusElement(...args) { return this.api.findElement(...args); }
    resyncBlockedChannelStatuses(...args) { return this.api.resync(...args); }
    seedBlockedChannelStatuses(...args) { return this.api.seed(...args); }
    reevaluateChannelStatusVisibility(...args) { return this.api.reevaluate(...args); }
    findChannelRowById(...args) { return this.api.findRow(...args); }
    fastHideFromMutations(...args) { return this.api.fastHideMutations(...args); }
}

function _channelStatusIsUpdateAction(action) {
    if (!action || typeof action !== "object") return false;
    const type = String(action.type || "");
    if (!this.constructor.ACTIONS.CHANNEL_STATUS_REGEX.test(type)) return false;
    const channelId = action.channelId || action.channel_id || action.id;
    return Boolean(channelId) && ("status" in action || "channelStatus" in action);
}
function _channelStatusHandleUpdateAction(action) {
    const channelId = action.channelId || action.channel_id || action.id;
    const status = action.status !== undefined ? action.status : action.channelStatus;
    if (!channelId) return;
    if (!this._blockedChannelStatuses) this._blockedChannelStatuses = new Map;
    if (!this._channelStatusAuthors) this._channelStatusAuthors = new Map;
    if (!status) {
        this._blockedChannelStatuses.delete(channelId);
        this._channelStatusAuthors.delete(channelId);
        _channelStatusRestoreText.call(this, channelId);
        return;
    }

    const authorId = _channelStatusResolveAuthorId.call(this, action);
    const hasBlockedNow = authorId
        ? this.shouldHide(authorId)
        : _channelStatusHasBlockedMember.call(this, channelId);
    if (hasBlockedNow) {
        this._channelStatusAuthors.set(channelId, true);
        this._blockedChannelStatuses.set(channelId, status);
        _channelStatusSuppressText.call(this, channelId);
    } else {
        this._channelStatusAuthors.delete(channelId);
        this._blockedChannelStatuses.delete(channelId);
        _channelStatusRestoreText.call(this, channelId);
    }
}
function _channelStatusResolveAuthorId(action) {
    if (!action || typeof action !== "object") return null;
    const candidate = action.authorId || action.author_id
        || action.setBy || action.set_by
        || action.userId || action.user_id
        || (action.author && (action.author.id || action.author))
        || null;
    return candidate ? String(candidate) : null;
}

function _channelStatusBelongsToBlocked(channelId) {
    try {
        if (this._channelStatusAuthors?.has(channelId)) {
            return this._channelStatusAuthors.get(channelId) === true;
        }

        return _channelStatusHasBlockedMember.call(this, channelId);
    } catch (error) {
        _recordPatchCatch("channelStatus.belongsToBlocked", this, error);
        return false;
    }
}
function _channelStatusHasBlockedMember(channelId) {
    try {
        const states = this._surfaces.voice.getRawVoiceStatesForChannel(channelId) || [];
        return states.some(state => this.shouldHide(this.extractUserId(state)));
    } catch (error) {
        _recordPatchCatch("channelStatus.hasBlockedMember", this, error);
        return false;
    }
}
function _channelStatusIsPlaceholder(statusEl) {
    if (!statusEl) return true;

    if (statusEl.matches?.('[class*="activityStatusText" i]') || statusEl.closest?.('[class*="accountProfile" i], [class*="panels" i]')) return true;
    if (statusEl.dataset?.nmbStatusOverridden === "true") return false;
    try {

        const text = (statusEl.textContent || "").trim().toLowerCase();
        if (!text) return true;
        const placeholderTexts = [ "definir um status do canal", "set a channel status" ];
        if (placeholderTexts.some(p => text.includes(p))) return true;
        if (statusEl.querySelector('svg, [class*="pencil" i], [class*="edit" i]')) return true;
        if (statusEl.closest('[role="button"]') && statusEl.querySelector('button, [role="button"]')) return true;
    } catch (error) { _recordPatchCatch("channelStatus.checkPlaceholder", this, error); }
    return false;
}
function _channelStatusSuppressText(channelId) {
    if (!this.settings.places.voiceChannels) return;
    const row = _channelStatusFindRow.call(this, channelId);
    if (!row) return;
    const statusEl = _channelStatusFindElement.call(this, row);
    if (_channelStatusIsPlaceholder.call(this, statusEl)) return;
    if (!statusEl) return;

    statusEl.dataset.nmbStatusOverridden = "true";
    delete statusEl.dataset.nmbStatusSafe;
}
function _channelStatusRestoreText(channelId) {
    const row = _channelStatusFindRow.call(this, channelId);
    if (!row) return;
    row.querySelectorAll('[data-nmb-status-overridden="true"]').forEach(el => {
        delete el.dataset.nmbStatusOverridden;
        el.dataset.nmbStatusSafe = "true";
    });
    row.querySelectorAll('[data-hidden-blocked="true"][data-nmb-reason="channel-status"]').forEach(el => this.restoreElement(el));
}
function _channelStatusFindElement(row) {
    if (!row) return null;
    return row.querySelector('[class*="channelStatus" i], [class*="voiceChannelStatus" i], [class*="statusText" i], [class*="subtitle" i][role="button"], [data-list-item-id*="channels"] [class*="subtitle" i]')
        || row.querySelector('[role="button"]:has([class*="status" i])');
}
function _channelStatusResync() {

    if (this._blockedChannelStatuses && this._blockedChannelStatuses.size) {
        for (const channelId of this._blockedChannelStatuses.keys()) {
            _channelStatusSuppressText.call(this, channelId);
        }
    }

    try { _channelStatusSeed.call(this); } catch (error) { _recordPatchCatch("channelStatus.resync", null, error); }
}
function _channelStatusSeed() {
    try {
        if (!this._channelStatusAuthors) this._channelStatusAuthors = new Map;
        document.querySelectorAll(_SEL.channelRow).forEach(row => {
            const channelId = this.findChannelId(row);
            if (!channelId) return;
            const statusEl = _channelStatusFindElement.call(this, row);
            if (!statusEl || !statusEl.textContent?.trim()) return;
            if (_channelStatusIsPlaceholder.call(this, statusEl)) {
                statusEl.dataset.nmbStatusSafe = "true";
                return;
            }

            if (!this._channelStatusAuthors.has(channelId)) {
                this._channelStatusAuthors.set(channelId, _channelStatusHasBlockedMember.call(this, channelId));
            }
            if (_channelStatusBelongsToBlocked.call(this, channelId)) {
                if (!this._blockedChannelStatuses) this._blockedChannelStatuses = new Map;
                this._blockedChannelStatuses.set(channelId, statusEl.textContent.trim());
                _channelStatusSuppressText.call(this, channelId);
            } else {
                statusEl.dataset.nmbStatusSafe = "true";
                delete statusEl.dataset.nmbStatusOverridden;
            }
        });
    } catch (error) { _recordPatchCatch("channelStatus.seed", null, error); }
}
function _channelStatusReevaluate(channelId) {
    if (!channelId || !this.settings.places.voiceChannels) return;
    const row = _channelStatusFindRow.call(this, channelId);
    if (!row) return;
    if (!this._blockedChannelStatuses) this._blockedChannelStatuses = new Map;
    if (!this._channelStatusAuthors) this._channelStatusAuthors = new Map;
    const statusEl = row.querySelector('[class*="channelStatus" i], [class*="voiceChannelStatus" i], [class*="statusText" i]');
    if (_channelStatusIsPlaceholder.call(this, statusEl)) {
        this._blockedChannelStatuses.delete(channelId);
        this._channelStatusAuthors.delete(channelId);
        if (statusEl) statusEl.dataset.nmbStatusSafe = "true";
        return;
    }

    const belongsToBlocked = _channelStatusBelongsToBlocked.call(this, channelId);
    if (belongsToBlocked) {
        this._channelStatusAuthors.set(channelId, true);
        const currentText = statusEl?.dataset?.nmbStatusOverridden === "true"
            ? this._blockedChannelStatuses.get(channelId)
            : statusEl?.textContent?.trim();
        if (currentText) {
            this._blockedChannelStatuses.set(channelId, currentText);
            _channelStatusSuppressText.call(this, channelId);
        }
    } else {
        this._channelStatusAuthors.set(channelId, false);
        this._blockedChannelStatuses.delete(channelId);
        _channelStatusRestoreText.call(this, channelId);
        if (statusEl) statusEl.dataset.nmbStatusSafe = "true";
    }
}
function _channelStatusFindRow(channelId) {
    if (!channelId) return null;
    return document.querySelector(`[data-list-item-id*="channels___${channelId}"]`) || document.querySelector(`[data-list-item-id*="${channelId}"]`);
}
function _channelStatusFastHideMutations(mutations) {
    const sel = '[class*="channelStatus" i], [class*="voiceChannelStatus" i], [data-list-item-id*="channels"] [class*="statusText" i], [data-list-item-id*="channels"] [class*="subtitle" i], [data-list-item-id*="channels"] [role="button"]:has([class*="status" i])';
    const exclude = '[class*="activityStatusText" i], [class*="accountProfile" i] *, [class*="panels" i] *';
    const isEligible = el => {
        if (!el || el.matches?.(exclude)) return false;
        if (el.closest?.(exclude)) return false;
        if (!el.closest?.(_SEL.channelRow)) return false;
        return true;
    };
    for (let m = 0; m < mutations.length; m++) {
        const added = mutations[m].addedNodes;
        for (let n = 0; n < added.length; n++) {
            const node = added[n];
            if (node.nodeType !== 1) continue;
            if (node.matches?.(sel)) {
                if (isEligible(node) && !node.dataset?.nmbStatusSafe && !node.dataset?.nmbStatusOverridden) node.dataset.nmbStatusOverridden = "true";
                continue;
            }
            if (typeof node.querySelectorAll === "function") {
                const els = node.querySelectorAll(sel);
                for (let e = 0; e < els.length; e++) {
                    const el = els[e];
                    if (isEligible(el) && !el.dataset?.nmbStatusSafe && !el.dataset?.nmbStatusOverridden) el.dataset.nmbStatusOverridden = "true";
                }
            }
        }
    }
}

function _settingsGetPanel() {
        if (typeof BdApi?.UI?.buildSettingsPanel !== "function") {
            const fallback = document.createElement("div");
            fallback.style.cssText = "padding:16px;color:var(--text-normal);";
            fallback.textContent = "This BetterDiscord version has no native settings panel API. Please update BetterDiscord.";
            return fallback;
        }
        const labels = this.constructor.SETTINGS_LABELS;
        const notes = this.constructor.SETTINGS_NOTES;
        const category = (id, name) => ({
            type: "category",
            id,
            name,
            collapsible: true,
            shown: true,
            settings: Object.keys(this.settings[id]).map(key => ({
                type: "switch",
                id: key,
                name: labels[key] || key,
                note: notes[key] || "",
                value: !!this.settings[id][key]
            }))
        });
        return BdApi.UI.buildSettingsPanel({
            settings: [
                category("types", "Who to hide"),
                category("places", "Where to hide"),
                category("notifications", "Notifications"),
                category("behavior", "Behavior")
            ],
            onChange: (section, key, value) => this._onSettingsChange(section, key, value)
        });
    }

function _applyBehaviorSettingChange(key, next) {
        if (key === "muteVoiceJoinLeaveSound") {
            if (next) {
                this._resources.timer('settingsToggleVoice', () => {
                    this._surfaces.sound.patchSound();
                    this._surfaces.sound.patchSoundboardEffects();
                    this.toast("Voice sound suppression activated.", "info");
                }, 1e3);
            } else {
                this.toast("Voice sound suppression disabled.", "info");
            }
        }
        if (key === "muteBlockedVoiceAudio") {
            if (next) {
                this._resources.timer('settingsToggleVoice', () => {
                    this._surfaces.voice.patchVoiceMute();
                    this._surfaces.sound.patchSound();
                    this._surfaces.sound.patchSoundboardEffects();
                    this.toast("Blocked users' voice audio will now be muted.", "info");
                }, 200);
            } else {
                this._surfaces.voice.releaseAllVoiceMutes();
                this.toast("Blocked users' voice audio is no longer muted.", "info");
            }
        }
        if (key === "blockRingingFromBlocked") {
            if (next) {
                this._surfaces.call.patchBlockedCallRinging();
                this._surfaces.call.patchRingtoneAudio();
                this._surfaces.call.patchHideBlockedCallUI();
                this._surfaces.call.watchCallCreateForHideBlockedCallUI();
                this.toast("Calls started by blocked users in group DMs will be ignored.", "info");
            } else {
                this._surfaces.call.unpatchRingtoneAudio();
                this._surfaces.call.stopWatchCallCreateForHideBlockedCallUI();
                this._surfaces.call.blockedRingingChannels?.clear();
                this._surfaces.call.blockedAutoJoinGuard?.clear();
                this.toast("Ringing suppression disabled.", "info");
            }
        }
        if (key === "suppressTaskbarBadge") {
            this._surfaces.badge.refreshTaskbarBadge();
        }
        if (key === "autoCheckUpdates") {
            if (next) this._surfaces.update.start(1e3); else this._surfaces.update.stop();
        }
}

function _settingsOnChange(section, key, value) {
        if (!this.settings[section] || !(key in this.settings[section])) return;
        const next = !!value;
        this.settings[section][key] = next;
        this.saveSettings();
        if (section === "places" && !next) _restoreTemporaryTexts(key);
        if (section === "places") this._resetShouldHideCache();
        if (section === "types") {
            _restoreTemporaryTexts();
            this._resetShouldHideCache();
            this._surfaces.badge.invalidateTaskbarBadgeCache();
        }
        if (section === "notifications") {
            this._surfaces.badge.invalidateTaskbarBadgeCache();
            this._surfaces.badge.refreshTaskbarBadge();
        }
        if (section === "places" && (key === "recentDms" || key === "pins" || key === "threads" || key === "channelList" || key === "mentions" || key === "inbox")) {
            this._surfaces.badge.invalidateTaskbarBadgeCache();
        }
        if (section === "places" && !next && (key === "replies" || key === "repliesToBlocked" || key === "inbox")) {
            try {
                const reasons = key === "replies" ? ["reply-preview"] : key === "inbox" ? ["inbox-blocked"] : ["fast-reply-to-blocked"];
                document.querySelectorAll('[data-hidden-blocked="true"]').forEach(el => {
                    if (reasons.includes(el.dataset?.nmbReason)) this.restoreElement(el);
                });
            } catch (error) { _recordPatchCatch("settings.restoreReplySurface", null, error); }
        }
        if (section === "places" && !next && (key === "memberList" || key === "voiceChannels")) {
            try { this._restoreOverwrittenTextForPlace(key); }
            catch (error) { _recordPatchCatch("settings.restorePlaceText", null, error); }
        }
        if (section === "behavior") _applyBehaviorSettingChange.call(this, key, next);
        this.queueRefresh();
    }


function createUpdateSurfaceApi(plugin) {
    return Object.freeze({
        constants: Object.freeze({
            get RELEASES_API_URL() { return plugin.constructor.RELEASES_API_URL; },
            get ASSET_FILENAME() { return plugin.constructor.ASSET_FILENAME; },
            get RELEASE_URL() { return plugin.constructor.RELEASE_URL; },
            get VERSION() { return plugin.constructor.VERSION; },
            get UPDATE_CHECK_INTERVAL_MS() { return plugin.constructor.UPDATE_CHECK_INTERVAL_MS; },
            get UPDATE_ALLOWED_HOSTS() { return plugin.constructor.UPDATE_ALLOWED_HOSTS; },
        }),
        settings: Object.freeze({
            get autoCheckUpdates() { return !!plugin.settings?.behavior?.autoCheckUpdates; },
        }),
        lifecycle: _runningLifecycle(plugin),
        state: Object.freeze({
            get instanceEpoch() { return plugin._instanceEpoch; },
            bumpInstanceEpoch: () => { plugin._instanceEpoch = (plugin._instanceEpoch || 0) + 1; },
        }),
        resources: Object.freeze({
            timer: (...args) => plugin._resources.timer(...args),
            clearTimer: (...args) => plugin._resources.clearTimer(...args),
            interval: (...args) => plugin._resources.interval(...args),
            clearInterval: (...args) => plugin._resources.clearInterval(...args),
        }),
        plugin: Object.freeze({
            get pluginName() { return plugin.pluginName; },
            isEnabled: name => BdApi.Plugins.isEnabled(name),
            disable: name => BdApi.Plugins.disable(name),
            enable: name => BdApi.Plugins.enable(name),
            get folder() { return BdApi.Plugins.folder; },
        }),
        toast: (message, type) => plugin.toast(message, type),
    });
}

class UpdateSurface {
    static RETRY_DELAYS_MS = Object.freeze([5000, 15000, 30000]);
    constructor(api) {
        this.api = api;
        this._updateChecking = false;
        this._updateCheckKickoff = null;
        this._periodicCheckInterval = null;
        this._retryTimer = null;
        this._retryAttempt = 0;
        this._updateNotice = null;
        this._lastNotifiedVersion = null;
    }
    start(firstDelay) {
        if (this.api.settings.autoCheckUpdates) this._startAutoUpdateCheck(firstDelay);
    }
    stop() {
        this._stopAutoUpdateCheck();
    }
    async _fetchLatestReleaseMeta() {
        const releaseJsonText = await this._httpsGet(this.api.constants.RELEASES_API_URL);
        let release;
        try { release = JSON.parse(releaseJsonText); }
        catch (e) {
            throw new Error("Invalid response from Releases API");
        }
        const tagName = release?.tag_name || "";
        const versionMatch = tagName.match(/(\d+\.\d+\.\d+)/);
        if (!versionMatch) {
            throw new Error("Release tag has no recognizable version");
        }
        const remoteVersion = versionMatch[1];
        const asset = Array.isArray(release?.assets)
            ? release.assets.find(a => a?.name === this.api.constants.ASSET_FILENAME)
            : null;
        if (!asset?.browser_download_url) {
            throw new Error("Release asset not found");
        }
        return {
            version: remoteVersion,
            downloadUrl: asset.browser_download_url,
            htmlUrl: release?.html_url || this.api.constants.RELEASE_URL
        };
    }
    async _downloadReleaseAsset(meta) {
        const text = await this._httpsGet(meta.downloadUrl);
        const inFileVersionMatch = text.match(/@version\s+([\d.]+)/);
        if (!inFileVersionMatch || inFileVersionMatch[1] !== meta.version) {
            throw new Error("Downloaded file version doesn't match the release tag");
        }
        return { version: meta.version, text, htmlUrl: meta.htmlUrl };
    }
    _startAutoUpdateCheck(firstDelay = 5e3) {
        this._stopAutoUpdateCheck();
        this._updateCheckKickoff = this.api.resources.timer('updateCheck', () => {
            this._updateCheckKickoff = null;
            if (this.api.lifecycle.isRunning) this.checkForUpdatesAuto();
        }, firstDelay);
        this._periodicCheckInterval = this.api.resources.interval('updateCheck', () => {
            if (this.api.lifecycle.isRunning) this.checkForUpdatesAuto();
        }, this.api.constants.UPDATE_CHECK_INTERVAL_MS);
    }
    _stopAutoUpdateCheck() {
        if (this._updateCheckKickoff) {
            this.api.resources.clearTimer('updateCheck', this._updateCheckKickoff);
            this._updateCheckKickoff = null;
        }
        if (this._periodicCheckInterval) {
            this.api.resources.clearInterval('updateCheck', this._periodicCheckInterval);
            this._periodicCheckInterval = null;
        }
        if (this._retryTimer) {
            this.api.resources.clearTimer('updateCheck', this._retryTimer);
            this._retryTimer = null;
        }
        this._retryAttempt = 0;
    }
    static _isTransientNetworkError(error) {
        const code = error?.code || error?.cause?.code;
        if (code && ["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"].includes(code)) return true;
        const message = String(error?.message || "");
        return /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|NetworkError|Failed to fetch/i.test(message);
    }
    async checkForUpdatesAuto() {
        if (this._updateChecking || !this.api.lifecycle.isRunning || !this.api.settings.autoCheckUpdates) return;
        const epoch = this.api.state.instanceEpoch;
        this._updateChecking = true;
        try {
            const meta = await this._fetchLatestReleaseMeta();
            if (!this.api.lifecycle.isRunning || this.api.state.instanceEpoch !== epoch || !this.api.settings.autoCheckUpdates) return;
            this._retryAttempt = 0;
            if (this._compareVersions(meta.version, this.api.constants.VERSION) > 0) {
                await this._notifyUpdateAvailable(meta.version, meta.htmlUrl, meta);
            }
        } catch (error) {
            _recordPatchCatch("UpdateSurface.checkForUpdatesAuto.L11011", this, error);
            this._scheduleRetry(epoch, error);
        } finally {
            this._updateChecking = false;
        }
    }
    _scheduleRetry(epoch, error) {
        if (!UpdateSurface._isTransientNetworkError(error)) { this._retryAttempt = 0; return; }
        if (this._retryAttempt >= UpdateSurface.RETRY_DELAYS_MS.length) { this._retryAttempt = 0; return; }
        const delay = UpdateSurface.RETRY_DELAYS_MS[this._retryAttempt];
        this._retryAttempt += 1;
        if (this._retryTimer) this.api.resources.clearTimer('updateCheck', this._retryTimer);
        this._retryTimer = this.api.resources.timer('updateCheck', () => {
            this._retryTimer = null;
            if (!this.api.lifecycle.isRunning || this.api.state.instanceEpoch !== epoch || !this.api.settings.autoCheckUpdates) { this._retryAttempt = 0; return; }
            this.checkForUpdatesAuto();
        }, delay);
    }
    async _notifyUpdateAvailable(remote, htmlUrl, meta) {
        if (remote === this._lastNotifiedVersion) return;
        this._lastNotifiedVersion = remote;
        this._removeNotice();
        try {
            this._updateNotice = BdApi.UI.showNotice(`ByeBlocked v${remote} is now available!`, {
                timeout: 0,
                buttons: [ {
                    label: "Update now",
                    onClick: () => {
                        if (this._updateNotice) {
                            try {
                                this._updateNotice.close();
                            } catch (error) { _recordPatchCatch("UpdateSurface._notifyUpdateAvailable.L11029", this, error); }
                            this._updateNotice = null;
                        }
                        this._downloadAndInstall(meta);
                    }
                }, {
                    label: "What's new",
                    onClick: () => {
                        this._safeOpenExternal(htmlUrl);
                    }
                } ]
            });
        } catch (_) {
            this.api.toast(`ByeBlocked v${remote} is now available! Download it from GitHub.`, "info");
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
        } catch (error) { _recordPatchCatch("UpdateSurface._removeNotice.L11057", this, error); }
    }
    async _safeOpenExternal(url) {
        const providers = [
            () => ({ owner: BdApi?.Utils, method: "openExternal" }),
            () => {
                const load = typeof window !== "undefined" && typeof window.require === "function" ? window.require : null;
                return { owner: load ? load("electron")?.shell : null, method: "openExternal" };
            },
            () => ({ owner: typeof window !== "undefined" ? window.DiscordNative?.remote?.shell : null, method: "openExternal" }),
            () => ({ owner: typeof __non_webpack_require__ === "function" ? __non_webpack_require__("electron")?.shell : null, method: "openExternal" }),
        ];
        for (const resolve of providers) {
            try {
                const { owner, method } = resolve();
                if (typeof owner?.[method] !== "function") continue;
                await owner[method](url);
                return;
            } catch (_) {}
        }
        try { await window.open(url, "_blank"); }
        catch (error) {
            _recordPatchCatch("updates.openExternal", null, error);
            throw error;
        }
    }
    _isAllowedUpdateHost(url) {
        try {
            const host = new URL(url).hostname.toLowerCase();
            return this.api.constants.UPDATE_ALLOWED_HOSTS.some(allowed => host === allowed);
        } catch (_) {
            return false;
        }
    }
    _fetchRedirectLocation(res, url) {
        if (!(res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400))) return null;
        const location = res.headers?.get?.("location");
        if (!location) throw new Error("Redirect response had no Location header");
        return this._resolveRedirectUrl(location, url);
    }
    _resolveRedirectUrl(location, url) {
        let nextUrl;
        try {
            nextUrl = new URL(location, url).toString();
        } catch (_) {
            throw new Error(`Invalid redirect location: ${location}`);
        }
        if (!this._isAllowedUpdateHost(nextUrl)) {
            throw new Error(`Refusing to follow redirect to untrusted host: ${nextUrl}`);
        }
        return nextUrl;
    }
    async _handleFetchResponse(res, url, _redirectCount) {
        const nextUrl = this._fetchRedirectLocation(res, url);
        if (nextUrl) return this._httpsGet(nextUrl, _redirectCount + 1);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return res.text();
    }
    async _httpsGet(url, _redirectCount = 0) {
        if (_redirectCount > 5) throw new Error("Too many redirects");
        if (!this._isAllowedUpdateHost(url)) {
            throw new Error(`Refusing to fetch from untrusted host: ${url}`);
        }
        const commonHeaders = {
            "User-Agent": "ByeBlocked-UpdateChecker/1.0",
            "Accept": "application/vnd.github+json",
            "Cache-Control": "no-cache"
        };
        if (typeof BdApi?.Net?.fetch === "function") {
            const res = await BdApi.Net.fetch(url, { headers: commonHeaders, redirect: "manual" });
            return this._handleFetchResponse(res, url, _redirectCount);
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
                        headers: commonHeaders
                    };
                    const req = https.request(options, res => {
                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            let nextUrl;
                            try {
                                nextUrl = this._resolveRedirectUrl(res.headers.location, url);
                            } catch (error) {
                                reject(error);
                                return;
                            }
                            this._httpsGet(nextUrl, _redirectCount + 1).then(resolve).catch(reject);
                            return;
                        }
                        if (res.statusCode !== 200) {
                            reject(new Error(`HTTP ${res.statusCode}`));
                            return;
                        }
                        const chunks = [];
                        res.on("data", c => chunks.push(c));
                        res.on("end", () => {
                            try {
                                const parts = chunks.map(c => c instanceof Uint8Array ? c : new Uint8Array(c));
                                const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
                                const merged = new Uint8Array(totalLen);
                                let offset = 0;
                                for (const p of parts) { merged.set(p, offset); offset += p.length; }
                                resolve(new TextDecoder("utf-8").decode(merged));
                            } catch (err) {
                                reject(err);
                            }
                        });
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
        const res = await fetch(url, { headers: commonHeaders, redirect: "manual" });
        return this._handleFetchResponse(res, url, _redirectCount);
    }
    _compareVersions(a, b) {
        const normalize = (v) => {
            const match = String(v).match(/(\d+)\.(\d+)\.(\d+)/);
            if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
            return String(v).split(".").map(Number);
        };
        const pa = normalize(a);
        const pb = normalize(b);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    }
    async _downloadAndInstall(meta) {
        try {
            const { text } = await this._downloadReleaseAsset(meta);
            await this._autoInstall(meta.version, text, meta.htmlUrl);
        } catch (err) {
            this.api.toast("Update failed: " + err.message + " - download manually from GitHub.", "error");
            this._safeOpenExternal(meta.htmlUrl);
        }
    }
    async _autoInstall(remoteVersion, remoteText, htmlUrl = this.api.constants.RELEASE_URL) {
        try {
            this._removeNotice();
            const inFileVersionMatch = remoteText.match(/@version\s+([\d.]+)/);
            if (!inFileVersionMatch || inFileVersionMatch[1] !== remoteVersion) {
                throw new Error("Downloaded content version doesn't match the expected version - installation cancelled for safety.");
            }
            const fs = require("fs");
            const path = require("path");
            const pluginsDir = this.api.plugin.folder;
            const dest = path.join(pluginsDir, "ByeBlocked.plugin.js");
            fs.writeFileSync(dest, remoteText, "utf8");
            this._lastNotifiedVersion = remoteVersion;
            this.api.toast(`ByeBlocked updated to v${remoteVersion}!`, "success");
            this.api.state.bumpInstanceEpoch();
            this.api.resources.timer('autoInstallRestart', () => {
                if (!this.api.lifecycle.isRunning) return;
                try {
                    if (this.api.plugin.isEnabled(this.api.plugin.pluginName)) this.api.plugin.disable(this.api.plugin.pluginName);
                    this.api.plugin.enable(this.api.plugin.pluginName);
                } catch (_) {
                    this.api.toast("Plugin updated, but couldn't auto-reactivate. Disable and re-enable manually.", "warn");
                }
            }, 2500);
        } catch (err) {
            this.api.toast("Auto-install failed: " + err.message + " - download manually from GitHub.", "error");
            this._safeOpenExternal(htmlUrl);
        }
    }
}

class NavigationMethods {
    _getChannelMessagesList(channelId) {
        if (!channelId) return [];
        try {
            const store = this.modules.MessageStore;
            const rawGet = this._rawGetMessages || store?.getMessages || store?.getMessagesForChannel || store?.getMessagesForChannelId;
            const ret = typeof rawGet === "function" ? rawGet.call(store, channelId) : null;
            const list = _messageCollectionToArray(ret);
            if (list) {
                try {
                    for (let i = 0; i < list.length; i++) {
                        const m = list[i];
                        const mid = m?.id;
                        const aid = m?.author?.id;
                        if (mid && aid) this._recordMessageAuthor(mid, aid);
                    }
                } catch (_) { _recordPatchCatch("patchMessageStore.recordMessageAuthor"); }
                return list;
            }
        } catch (error) { _recordPatchCatch("navigation.getChannelMessagesList", this, error); }
        return [];
    }
    _emitVoiceStateChanges() {
        try {
            const voiceStore = this.modules.SortedVoiceStateStore;
            if (voiceStore && typeof voiceStore.emitChange === "function") voiceStore.emitChange();
        } catch (error) { _recordPatchCatch("navigation.emitVoiceStateChanges", this, error); }
        try {
            const stageStore = this.modules.StageChannelParticipantStore;
            if (stageStore && typeof stageStore.emitChange === "function") stageStore.emitChange();
        } catch (error) { _recordPatchCatch("navigation.emitStageStateChanges", this, error); }
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
            this._resources.clearTimer('queueScan', this.scanTimeout);
            this.scanTimeout = null;
        }
        if (this.scanFrame) {
            this._resources.clearFrame('queueScan', this.scanFrame);
            this.scanFrame = null;
        }
        if (this._guildSwitchWaitTimeout) {
            this._resources.clearTimer('guildSwitchWait', this._guildSwitchWaitTimeout);
            this._guildSwitchWaitTimeout = null;
        }
    }
    _handleNavigation() {
        if (!this.isRunning) return;
        this._cancelAllNavTimers();
        this._cancelObserverFrames();
        if (Array.isArray(this._navigationRetryHooks)) {
            for (const hook of this._navigationRetryHooks) {
                try { hook(); } catch (error) { _recordPatchCatch("navigation.retryHook", this, error); }
            }
        }
        this._isNavigating = true;
        this._navStartedAt = Date.now();
        this._userScrolledSinceNav = false;
        const navToken = ++this._navToken;
        this._injectGuildSwitchGuard();
        if (this.settings.places.events) {
            try { this._surfaces.events.hideBlockedEvents(); } catch (error) { _recordPatchCatch("navigation.eventsScan", this, error); }
        }
        try {
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            if (channelId) this._surfaces.pins.scanExistingPinsForChannel(channelId);
        } catch (error) { _recordPatchCatch("navigation.scanExistingPins", this, error); }
        this._waitForChatReady(0, navToken);
    }
    _waitForChatReady(attempts, navToken = this._navToken) {
        const MAX_ATTEMPTS = 60;
        const INTERVAL = 50;
        if (navToken !== this._navToken) return;
        if (!this.isRunning) {
            this._removeGuildSwitchGuard();
            this._restartObserver();
            return;
        }
        const chatReady = this._resolveDomElByPattern(
            () => document.querySelector(_SEL.chatContent),
            () => document.querySelector('[data-list-id*="chat-messages"]'),
            () => document.querySelector('[class*="privateChannels"]'),
            () => document.querySelector('[class*="friendsContainer"]'),
            () => document.querySelector('[class*="noFriendsText"]'),
            () => document.querySelector(_SEL.memberRow),
            () => document.querySelector('[class*="membersHeader"]'),
            () => document.querySelector('[class*="chat"]'),
            () => document.querySelector('[data-list-id]')
        );
        if (chatReady || attempts >= MAX_ATTEMPTS) {
            if (!this._isNavigating) {
                this.hiddenElements.clear();
                this.hiddenParents.clear();
            }
            this._restartObserver();
            this.scanDom();
            if (this.settings.places?.messages) {
                try {
                    const channelIdNow = this.modules.SelectedChannelStore?.getChannelId?.();
                    if (channelIdNow && this._surfaces.readState.checkAndSuppressBlockedMentionForChannel(channelIdNow, this._surfaces.readState.getReadStateHelpers())) {
                        this._surfaces.readState.emitReadStateChanges();
                    }
                } catch (error) { _recordPatchCatch("navigation.readStateRecheck", this, error); }
                try { this._watchForUserScrollInteraction(); }
                catch (error) { _recordPatchCatch("navigation.watchUserScroll", this, error); }
            }
            this.patchMessageStore();
            try {
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                if (channelId) this._surfaces.pins.scanExistingPinsForChannel(channelId);
            } catch (error) { _recordPatchCatch("navigation.retryScanPins", this, error); }
            if (this.settings.places?.messages) {
                this._startScrollCorrectionLoop(navToken);
            }
            this._guildSwitchWaitTimeout = this._resources.timer('guildSwitchWait', () => {
                if (navToken !== this._navToken) return;
                if (!this.isRunning) return;
                this.scanDom();
                try {
                    const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                    if (channelId) this._surfaces.pins.scanExistingPinsForChannel(channelId);
                } catch (error) { _recordPatchCatch("navigation.delayedScanPins", this, error); }
                this._guildSwitchWaitTimeout = null;
                this._waitForEventsDataThenRemoveGuard(0);
            }, 400);
            this._finishNavigation(navToken);
        } else {
            if (this.settings.places.events) {
                try { this._surfaces.events.hideBlockedEvents(); } catch (error) { _recordPatchCatch("navigation.eventsRetry", this, error); }
            }
            this._guildSwitchWaitTimeout = this._resources.timer('guildSwitchWait', () => {
                if (navToken !== this._navToken) return;
                this._waitForChatReady(attempts + 1, navToken);
            }, INTERVAL);
        }
    }
    _finishNavigation(navToken) {
        if (navToken !== undefined && navToken !== this._navToken) return;
        this._isNavigating = false;
        try {
            this._pruneHiddenElements();
        } catch (error) { _recordPatchCatch("NavigationMethods._finishNavigation.L11407", this, error); }
    }
    _watchForUserScrollInteractionWithRetry(attempt = 0) {
        if (!this.isRunning) return;
        const scroller = this._findMessagesScroller();
        if (!scroller) {
            if (attempt < 20) this._scheduleRetry(() => this._watchForUserScrollInteractionWithRetry(attempt + 1), this._retryDelay(attempt, 500));
            return;
        }
        try { this._watchForUserScrollInteraction(); }
        catch (error) { _recordPatchCatch("navigation.retryWatchUserScroll", this, error); }
    }
    _watchForUserScrollInteraction() {
        try {
            const scroller = this._findMessagesScroller();
            if (!scroller) return;
            if (this._scrollWatchListeners) {
                this._scrollWatchListeners = this._scrollWatchListeners.filter(entry => {
                    if (document.contains(entry.scroller)) return true;
                    try {
                        for (const [type, handler] of entry.bindings) entry.scroller.removeEventListener(type, handler, entry.opts);
                    } catch (error) { _recordPatchCatch("NavigationMethods._watchForUserScrollInteraction.L11428", this, error); }
                    return false;
                });
            }
            if (scroller.dataset.nmbScrollWatchBound === "true") return;
            scroller.dataset.nmbScrollWatchBound = "true";
            const opts = { passive: true };
            const mark = () => { if (!this.isRunning) return; this._userScrolledSinceNav = true; };
            const markManual = () => { if (!this.isRunning) return; this._lastManualScrollAt = Date.now(); };
            const bindings = [
                ["wheel", mark], ["touchstart", mark], ["pointerdown", mark], ["keydown", mark], ["scroll", mark],
                ["wheel", markManual], ["touchstart", markManual], ["touchmove", markManual], ["pointerdown", markManual], ["keydown", markManual]
            ];
            for (const [type, handler] of bindings) scroller.addEventListener(type, handler, opts);
            if (!this._scrollWatchListeners) this._scrollWatchListeners = [];
            this._scrollWatchListeners.push({ scroller, opts, bindings });
        } catch (error) { _recordPatchCatch("navigation.watchUserScrollInteraction", this, error); }
    }
    _stopWatchForUserScrollInteraction() {
        if (!this._scrollWatchListeners) return;
        for (const { scroller, opts, bindings } of this._scrollWatchListeners) {
            try {
                for (const [type, handler] of bindings) scroller.removeEventListener(type, handler, opts);
                if (scroller?.dataset?.nmbScrollWatchBound) delete scroller.dataset.nmbScrollWatchBound;
            } catch (error) { _recordPatchCatch("NavigationMethods._stopWatchForUserScrollInteraction.L11452", this, error); }
        }
        this._scrollWatchListeners = [];
    }
    _findMessagesScroller() {
        const isScrollable = el => {
            if (!el) return false;
            try {
                const style = getComputedStyle(el);
                const overflowY = style.overflowY;
                return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight;
            } catch (_) {
                return false;
            }
        };
        const climbToScrollable = start => {
            let el = start;
            for (let i = 0; i < 12 && el; i++, el = el.parentElement) {
                if (isScrollable(el)) return el;
            }
            return null;
        };
        try {
            const listRoot = document.querySelector('[data-list-id*="chat-messages"]');
            if (listRoot) {
                const byClass = listRoot.closest(_SEL.scroller);
                if (isScrollable(byClass)) return byClass;
                const climbed = climbToScrollable(listRoot);
                if (climbed) return climbed;
            }
        } catch (_) {}
        try {
            const chatContent = document.querySelector(_SEL.chatContent);
            const scroller = chatContent?.querySelector(_SEL.scroller);
            if (isScrollable(scroller)) return scroller;
            const climbedFromChatContent = climbToScrollable(chatContent);
            if (climbedFromChatContent) return climbedFromChatContent;
        } catch (_) {}
        return null;
    }
    _getCurrentChannelIdRobust() {
        try {
            const fromStore = this.modules.SelectedChannelStore?.getChannelId?.();
            if (fromStore) return fromStore;
        } catch (_) {}
        try {
            const match = location.pathname.match(/\/channels\/(?:@me|\d+)\/(\d{15,25})(?:\/threads\/(\d{15,25}))?/);
            if (match) return match[2] || match[1] || null;
        } catch (_) {}
        return null;
    }
    _resolveLastMessageBlockedState(channelId) {
        let collection = null;
        try {
            const raw = this._rawGetMessages;
            const store = this.modules.MessageStore;
            collection = raw ? raw(channelId) : store?.getMessages?.(channelId);
        } catch (error) { _recordPatchCatch("navigation.resolveLastMessageBlockedState", this, error); }
        if (!collection) {
            return this._domConfirmsChannelEmpty() ? false : undefined;
        }
        const list = Array.isArray(collection) ? collection
            : Array.isArray(collection._array) ? collection._array
            : null;
        if (!list) return undefined;
        const isReady = typeof collection.ready === "boolean"
            ? collection.ready
            : Array.isArray(collection);
        if (list.length === 0) {
            if (isReady) return false;
            return this._domConfirmsChannelEmpty() ? false : undefined;
        }
        const lastMessage = list[list.length - 1];
        return this._messageWouldBeHidden(lastMessage);
    }
    _messageWouldBeHidden(message) {
        if (!message) return false;
        if (!this._placeEnabled("messages")) return false;
        const authorId = message.author?.id || null;
        if (authorId && this.shouldHide(authorId)) return true;
        try {
            if (this._placeEnabled("repliesToBlocked") && message.messageReference) {
                const ref = this.getReferencedMessage(message);
                const refAuthorId = ref?.author?.id || null;
                if (refAuthorId && this.shouldHide(refAuthorId)) return true;
            }
        } catch (error) { _recordPatchCatch("navigation.messageReplyVisibility", this, error); }
        try {
            if (this._placeEnabled("mentions")) {
                const mentions = message.mentions;
                if (mentions) {
                    const list = Array.isArray(mentions) ? mentions : Array.from(mentions);
                    for (const u of list) {
                        const id = typeof u === "string" ? u : u?.id;
                        if (id && this.shouldHide(id)) return true;
                    }
                }
            }
        } catch (error) { _recordPatchCatch("navigation.messageMentionVisibility", this, error); }
        return false;
    }
    _domConfirmsChannelEmpty() {
        try {
            const listRoot = document.querySelector('[data-list-id*="chat-messages"]');
            if (listRoot) {
                const hasRealMessage = !!listRoot.querySelector(`${_SEL.messageItemLi}, [class*="groupStart_"], [data-list-item-id*="chat-messages"]`);
                if (!hasRealMessage) return true;
            }
        } catch (error) { _recordPatchCatch("navigation.domConfirmsChannelEmpty", this, error); }
        return false;
    }
    _applyPostNavScrollMask(state, scroller) {
        try {
            if (!scroller) return;
            if (state.maskedEl && state.maskedEl !== scroller && state.maskedEl.dataset.nmbScrollMasked) {
                try {
                    state.maskedEl.style.visibility = state.maskedEl.dataset.nmbPrevVisibility || "";
                    delete state.maskedEl.dataset.nmbScrollMasked;
                    delete state.maskedEl.dataset.nmbPrevVisibility;
                } catch (error) { _recordPatchCatch("navigation.restorePreviousScrollMask", this, error); }
            }
            if (!scroller.dataset.nmbScrollMasked) {
                scroller.dataset.nmbScrollMasked = "true";
                scroller.dataset.nmbPrevVisibility = scroller.style.visibility || "";
                scroller.style.visibility = "hidden";
            }
            state.masked = true;
            state.maskedEl = scroller;
        } catch (error) { _recordPatchCatch("navigation.applyPostNavScrollMask", this, error); }
    }
    _removePostNavScrollMask(state) {
        try {
            const el = state.maskedEl;
            if (el && el.dataset.nmbScrollMasked) {
                el.style.visibility = el.dataset.nmbPrevVisibility || "";
                delete el.dataset.nmbScrollMasked;
                delete el.dataset.nmbPrevVisibility;
            }
            state.masked = false;
            state.maskedEl = null;
        } catch (error) { _recordPatchCatch("navigation.removePostNavScrollMask", this, error); }
    }
    _startScrollCorrectionLoop(navToken) {
        if (this._scrollLoopActive && this._scrollLoopNavToken === navToken) return;
        if (this._scrollLoopActive) {
            this._scrollLoopActive = false;
        }
        this._scrollLoopActive = true;
        this._scrollLoopNavToken = navToken;
        try { this._watchForUserScrollInteraction(); }
        catch (error) { _recordPatchCatch("navigation.startScrollCorrection", this, error); }
        const startedAt = Date.now();
        const MAX_MS = 2000;
        const STABLE_FRAMES_NEEDED = 6;
        let stableStreak = 0;
        let frame = 0;
        const maskState = { masked: false, maskedEl: null };
        const stop = () => {
            if (maskState.masked) this._removePostNavScrollMask(maskState);
            this._scrollLoopActive = false;
        };
        const tick = () => {
            if (!this.isRunning) return stop();
            if (navToken !== this._navToken) return stop();
            if (Date.now() - startedAt > MAX_MS) return stop();
            if (this._userScrolledSinceNav) return stop();
            frame++;
            const channelId = this._getCurrentChannelIdRobust();
            if (!channelId) {
                requestAnimationFrame(tick);
                return;
            }
            const blocked = this._resolveLastMessageBlockedState(channelId);
            if (blocked === undefined) {
                if (frame > 1) {
                    const maybeScroller = this._findMessagesScroller();
                    if (maybeScroller) this._applyPostNavScrollMask(maskState, maybeScroller);
                }
                requestAnimationFrame(tick);
                return;
            }
            if (!blocked) {
                return stop();
            }
            const scroller = this._findMessagesScroller();
            if (!scroller) {
                requestAnimationFrame(tick);
                return;
            }
            if (this._userScrolledSinceNav) return stop();
            const effectiveTop = this._scrollManager.getEffectiveScrollTop(scroller);
            const distanceFromBottom = scroller.scrollHeight - effectiveTop - scroller.clientHeight;
            if (distanceFromBottom > 24) {
                this._applyPostNavScrollMask(maskState, scroller);
            this._scrollManager.request(scroller, scroller.scrollHeight);
                stableStreak = 0;
            } else {
                stableStreak++;
                if (stableStreak >= STABLE_FRAMES_NEEDED) {
                    return stop();
                }
            }
            requestAnimationFrame(tick);
        };
        this._resources.timer('postNavScrollGuard', () => { if (maskState.masked) this._removePostNavScrollMask(maskState); }, MAX_MS + 500);
        requestAnimationFrame(tick);
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
                const fromStore = this._surfaces.events.getGuildEventsFromStore();
                storeReady = fromStore !== null;
            }
        } catch (error) {
            _recordPatchCatch("navigation.waitForEventsStore", this, error);
            storeReady = true;
        }
        if (storeReady || attempts >= MAX_ATTEMPTS) {
            try {
                this._surfaces.events.hideBlockedEvents();
            } catch (error) { _recordPatchCatch("navigation.hideEventsAfterGuildSwitch", this, error); }
            this._removeGuildSwitchGuard();
            this._guildSwitchWaitTimeout = null;
        } else {
            try {
                this._surfaces.events.hideBlockedEvents();
            } catch (error) { _recordPatchCatch("navigation.hideEventsDuringGuildWait", this, error); }
            this._guildSwitchWaitTimeout = this._resources.timer('guildSwitchWait', () => {
                this._waitForEventsDataThenRemoveGuard(attempts + 1);
            }, INTERVAL);
        }
    }

}

class LifecycleMethods {
    _runSurfacePhase(phase, ...names) {
        for (const name of names) {
            const surface = this._surfaces?.[name];
            const label = `${name}.${phase}`;
            if (!surface) {
                try { this._patcher?._warn(label, new Error(`Surface "${name}" not registered`)); } catch (_) {}
                continue;
            }
            const hook = surface[phase];
            if (typeof hook !== 'function') continue;
            try { hook.call(surface); }
            catch (e) { try { this._patcher?._warn(label, e); } catch (_) {} }
        }
    }
    _runEarlyPatches() {
        const p = this._patcher;
        this._runSurfacePhase('patchEarly', 'readState');
        p.safe('addStyles', () => this.addStyles());
        p.safe('patchStores', () => this.patchStores());
        this._runSurfacePhase('patchEarly', 'pins', 'groupDms', 'members', 'autocomplete', 'events', 'reactions');
        p.safe('patchRelationshipUpdates', () => this.patchRelationshipUpdates());
        p.safe('patchBlockedMessageGroup', () => this.patchBlockedMessageGroup());
        p.safe('patchMessagesWrapComponent', () => this.patchMessagesWrapComponent());
        this._runSurfacePhase('patchEarly', 'forums', 'call');
        p.safe('patchMessageStore', () => this.patchMessageStore());
        p.safe('patchMessageLoadDispatch', () => this.patchMessageLoadDispatch());
    }
    start(_retryAttempt = 0) {
        if (this.isRunning) return;
        try {
            this._startSession(_retryAttempt);
        } catch (error) {
            try { this.stop(); }
            catch (cleanupError) {
                try { this._patcher?._warn('start:cleanup', cleanupError); } catch (_) {}
            }
            throw error;
        }
    }
    _scheduleStartupTask(fn, delay) {
        this._startupTimers = this._startupTimers || [];
        const id = this._resources.timer('startupTimers', () => {
            const index = this._startupTimers.indexOf(id);
            if (index !== -1) this._startupTimers.splice(index, 1);
            if (!this.isRunning) return;
            fn();
        }, delay);
        this._startupTimers.push(id);
        return id;
    }
    _startSession(_retryAttempt = 0) {
        this._prepareStartupSession();
        if (!this._relIsBlockedFn) {
            this._scheduleRelationshipStoreRetry(_retryAttempt);
            return;
        }
        this._relStoreRetryToastShown = false;
        this._cancelRetry(this._moduleRetryTimeout);
        this._startRuntimeServices();
        this._scheduleStartupWork();
        this._scheduleDeferredSurfacePatches();
    }
    _prepareStartupSession() {
        this.isRunning = true;
        this._instanceEpoch = (this._instanceEpoch || 0) + 1;
        this._resources.reset();
        window.__byeBlocked = this;
        this._patcher.safe('restoreLegacyDomGuard', () => this._restoreLegacyDomGuard());
        this.restoreAllElements();
        this._removeGuildSwitchGuard();
        this.removeStyles();
        this._injectGuildSwitchGuard();
        this._patcher.safe('resolveModules', () => this.resolveModules());
        if (this._relationshipStoreJustAppeared) {
            this._relationshipStoreJustAppeared = false;
            try { this._onRelationshipChanged(); } catch (error) { _recordPatchCatch("startup.relationshipRefresh", this, error); }
        }
        if (this.settings.places?.groupDms) {
            this._patcher.safe('hidePrivateChannelsSync', () => this._surfaces.groupDms.hidePrivateChannels());
        }
    }
    _scheduleRelationshipStoreRetry(_retryAttempt) {
        const maxAttempts = 20;
        if (_retryAttempt < maxAttempts) {
            this.isRunning = false;
            const delay = Math.min(1000 * Math.pow(1.5, _retryAttempt), 20000);
            this._cancelRetry(this._moduleRetryTimeout);
            this._moduleRetryTimeout = this._scheduleRetry(() => this.start(_retryAttempt + 1), delay, { ignoreAlive: true });
            return;
        }
        this.isRunning = false;
        if (!this._relStoreRetryToastShown) {
            this._relStoreRetryToastShown = true;
            this.toast('ByeBlocked: RelationshipStore not found yet. Will keep retrying in the background - if Discord changed something, check for a plugin update.', 'warn');
        }
        this._cancelRetry(this._moduleRetryTimeout);
        this._moduleRetryTimeout = this._scheduleRetry(() => this.start(0), 60000, { ignoreAlive: true });
        return;
    }
    _startRuntimeServices() {
        const p = this._patcher;
        this._runEarlyPatches();
        p.safe('restartObserver', () => this._restartObserver());
        p.safe('watchForUserScrollInteractionBoot', () => this._watchForUserScrollInteractionWithRetry());
        this._runSurfacePhase('start', 'reactions', 'voice');
        p.safe('startChannelSwitchWatcher', () => this._startChannelSwitchWatcher());
        p.safe('seedVoiceChannelMembers', () => this._surfaces.voice.seedVoiceChannelMembers());
        p.safe('registerHealthChecks', () => this._registerHealthChecks());
        this.scanInterval = this._resources.interval('scanLoop', () => this._periodicScanTick(), 4e3);
        this._voiceMuteRecheckInterval = this._resources.interval('voiceMute', () => {
            if (!this.settings.behavior.muteBlockedVoiceAudio) return;
            try {
                const channelId = this._surfaces.voice.getMediaEngineContext()?.channelId || this._surfaces.voice.getSelfVoiceChannelId();
                if (channelId) this._surfaces.voice.applyVoiceMuteForChannel(channelId);
            } catch (error) { _recordPatchCatch("startup.voiceMuteRecheck", this, error); }
        }, 5000);
        p.safe('installVisibilityPause', () => this._installVisibilityPause());
        this.queueRefresh();
    }
    _scheduleStartupWork() {
        if (this.settings.places?.groupDms) {
            for (const delay of [300, 800, 1500, 2500, 4000, 6000, 8000]) {
                this._scheduleStartupTask(() => {
                    try { this._surfaces.groupDms.hidePrivateChannels(); }
                    catch (error) { _recordPatchCatch("startup.groupDmsHide", this, error); }
                }, delay);
            }
        }
        this._waitForChatReady(0);
        this._scheduleStartupTask(() => {
            try {
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                if (channelId) this._surfaces.pins.scanExistingPinsForChannel(channelId);
            } catch (error) { _recordPatchCatch("startup.pinsScan", this, error); }
        }, 1500);
        this._registerModuleRefresh();
        this._surfaces.update.start();
        this._scheduleStartupTask(() => { this._runBootCanaryCheck(); this._checkResolutionDrift(); }, 8000);
        this._hiddenElementsPruneInterval = this._resources.interval('hiddenElementsPrune', () => {
            try {
                this._pruneHiddenElements();
            } catch (error) { _recordPatchCatch("lifecycle.pruneHiddenElements", this, error); }
        }, 60000);
    }
    _scheduleDeferredSurfacePatches() {
        const p = this._patcher;
        this._runSurfacePhase('start', 'readState');
        this._scheduleStartupTask(() => {
            p.safe('patchInviteSuggestions', () => this.patchInviteSuggestions());
            this._runSurfacePhase('patchLate', 'members', 'autocomplete', 'sound', 'voice', 'call');
        }, 2e3);
        this._scheduleStartupTask(() => {
            this._runSurfacePhase('patchDeferred', 'stage');
            p.safe('patchActivityPanelComponent', () => this.patchActivityPanelComponent());
            this._runSurfacePhase('patchDeferred', 'voice');
        }, 3e3);
        this._patchHistoryApi();
    }
    _stopStartupTracking(cleanup) {
        if (this._startupTimers && this._startupTimers.length) {
            for (const id of this._startupTimers) this._resources.clearTimer('startupTimers', id);
        }
        this._startupTimers = [];
        this._bootCanaryRan = false;
        this._resolutionDriftChecked = false;
        this._missingCoreToastShown = false;
        cleanup('_visibilityRetryListenerDispose', () => this._visibilityRetryListenerDispose?.());
        this._visibilityRetryListenerDispose = null;
        this._visibilityRetryListener = null;
        if (this._navigationRetryHooks) {
            this._navigationRetryHooks = [];
            this._navigationRetryHookMap = {};
        }
        this._filteredGroupDmChannelCache = null;
        this._shouldHideCache = null;
        cleanup('removeBootGuard', () => document.getElementById('ByeBlocked-bootguard')?.remove());
        cleanup('removeUnreadBadgeBootGuard', () => document.getElementById('ByeBlocked-unreadbadge-bootguard')?.remove());
    }
    _restoreSoundPatch() {
        if (this._soundPatchState) {
            try {
                const { SoundUtils, targetKey, originalMethod } = this._soundPatchState;
                if (SoundUtils && SoundUtils[targetKey] === this._soundPatchedFn) {
                    Object.defineProperty(SoundUtils, targetKey, {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: originalMethod
                    });
                }
            } catch (error) { _recordPatchCatch("lifecycle.restoreSoundPatch", this, error); }
            this._soundPatchState = null;
            this._soundPatchedFn = null;
        }
    }
    _restoreGuildListGhostStyles() {
        try {
            document.querySelectorAll('#guild-list-unread-dms [data-nmb-ghost="true"]').forEach(element => {
                _restoreGhostStyle(element);
            });
        } catch (error) { _recordPatchCatch("lifecycle.restoreGuildListGhostStyles", this, error); }
    }
    _clearStopIntervalsAndFrames() {
        this._resources.clearInterval('scanLoop', this.scanInterval);
        this._resources.clearInterval('voiceMute', this._voiceMuteRecheckInterval);
        this._resources.clearTimer('queueScan', this.scanTimeout);
        this._resources.clearFrame('queueScan', this.scanFrame);
        this._resources.clearTimer('refresh', this.refreshTimeout);
        cancelAnimationFrame(this._voiceStateRafId);
        this._voiceStateRafId = null;
        this.scanInterval = null;
        this._voiceMuteRecheckInterval = null;
        this.scanTimeout = null;
        this.scanFrame = null;
        this.refreshTimeout = null;
    }
    _stopNavigationAndObservers() {
        this._scrollLoopActive = false;
        this._isNavigating = false;
        try { this._stopWatchForUserScrollInteraction(); } catch (error) { _recordPatchCatch("lifecycle.stopScrollInteractionWatch", this, error); }
        this._userScrolledSinceNav = false;
        this._cancelObserverFrames();
        this._resources.releaseObserver('coreDomObserver', this.observer);
        this.observer = null;
        this._resources.releaseObserver('stageDomObserver', this._stageObserver);
        this._stageObserver = null;
        this._stopStageRootWatch();
        this._stopShortLivedMessageObserver();
        this._menuPortalActive = false;
        try { this._stopInviteClickListener(); } catch (error) { try { this.logger?.error('stop:stopInviteClickListener threw', error); } catch (_) {} }
    }
    stop() {
        this.isRunning = false;
        this._instanceEpoch = (this._instanceEpoch || 0) + 1;
        const cleanup = (label, run) => {
            try { run(); }
            catch (error) { _recordPatchCatch(`stop.${label}`, this, error); }
        };
        cleanup('saveSettings', () => this.saveSettings(true));
        cleanup('startupTracking', () => this._stopStartupTracking(cleanup));
        cleanup('restoreSoundPatch', () => this._restoreSoundPatch());
        cleanup("messageState", () => this._resetPendingMessageState());
        cleanup("scheduledWork", () => this._stopScheduledWork(cleanup));
        cleanup("sessionObservers", () => this._stopSessionObservers(cleanup));
        cleanup("sessionPatches", () => this._removeSessionPatches(cleanup));
        cleanup("interface", () => this._restoreStoppedInterface(cleanup));
        cleanup("sessionData", () => this._resetStoppedSessionData(cleanup));
        cleanup('resources.disposeAll', () => this._resources.disposeAll());
        if (window.__byeBlocked === this) delete window.__byeBlocked;
    }
    _resetPendingMessageState() {
        this._suppressGroupAddSoundMessageId = null;
        this._suppressMentionSoundCredits = [];
        this._messageStoreUnpatchFns = null;
        this._messageStorePatchTarget = null;
        this._messageStorePatchedMethods = null;
        this._messageStorePatchedMethodRefs = null;
        this._messagesWrapUnpatchFns = null;
        this._activityPanelUnpatchFns = null;
    }
    _stopScheduledWork(cleanup) {
        cleanup('retry.cancelAll', () => this._retry?.cancelAll());
        this._cancelRetry(this._moduleRetryTimeout);
        this._moduleRetryTimeout = null;
        this._storePatchRetryNeeded = false;
        this._runSurfacePhase('stop', 'readState');
        this._resources.clearTimer('blockedGroupObserver', this._blockedGroupObserverRenewTimeout);
        this._blockedGroupObserverRenewTimeout = null;
        cleanup('_stopAutoUpdateCheck', () => this._surfaces.update.stop());
        if (this._hiddenElementsPruneInterval) {
            this._resources.clearInterval('hiddenElementsPrune', this._hiddenElementsPruneInterval);
            this._hiddenElementsPruneInterval = null;
        }
        if (this._guildSwitchWaitTimeout) {
            this._resources.clearTimer('guildSwitchWait', this._guildSwitchWaitTimeout);
            this._guildSwitchWaitTimeout = null;
        }
    }
    _stopSessionObservers(cleanup) {
        cleanup('navigationAndObservers', () => this._stopNavigationAndObservers());
        cleanup('restoreGuildListGhostStyles', () => this._restoreGuildListGhostStyles());
        cleanup('intervalsAndFrames', () => this._clearStopIntervalsAndFrames());
        cleanup('_visibilityHandlerDispose', () => this._visibilityHandlerDispose?.());
        this._visibilityHandlerDispose = null;
        this._visibilityHandler = null;
        this._observersPausedForVisibility = false;
        cleanup('health.stop', () => this._health?.stop());
        this._blockedChannelStatuses?.clear();
        this._channelStatusAuthors?.clear();
        try {
            this._surfaces.voice.releaseAllVoiceMutes();
        } catch (error) { _recordPatchCatch("lifecycle.releaseVoiceMutes", this, error); }
    }
    _removeSessionPatches(cleanup) {
        this._soundboardPatched = false;
        this._soundPatchedFn = null;
        this._notificationDispatcherPatched = false;
        this._notificationDispatcherPatchTarget = null;
        this._notificationDispatcherPatchedMethod = null;
        cleanup('readState.resetPatchedState', () => this._surfaces.readState.resetPatchedState());
        this._messageLoadDispatchPatched = false;
        this._relationshipUpdatesPatched = false;
        this._inviteSuggestionsPatched = false;
        this._runSurfacePhase('stop', 'call');
        cleanup('coreStoreListeners', () => this._resources.disposeScope('coreStoreListeners'));
        this.relationshipChangeHandler = null;
        this._channelSwitchChangeHandler = null;
        this._lastWatchedChannelId = null;
        cleanup('patcher.cleanup', () => this._patcher?.cleanup());
        try { BdApi.Patcher.unpatchAll('ByeBlockedTaskbarBadgeBootRace'); } catch (error) { _recordPatchCatch("lifecycle.unpatchTaskbarBootRace", this, error); }
        this._patchedStoreMethods = new WeakMap();
        this._patchedStoreRefs = new WeakMap();
    }
    _restoreStoppedInterface(cleanup) {
        cleanup('restoreAllElements', () => this.restoreAllElements());
        cleanup('removeStyles', () => this.removeStyles());
        cleanup('_removeNotice', () => this._surfaces.update._removeNotice());
        cleanup('_removeGuildSwitchGuard', () => this._removeGuildSwitchGuard());
        this._navStartedAt = null;
        cleanup('historyApi', () => this._unpatchHistoryApi());
        if (this._routerUnsubscribe) {
            try { this._routerUnsubscribe(); } catch (error) { _recordPatchCatch("lifecycle.unsubscribeRouter", this, error); }
            this._routerUnsubscribe = null;
        }
    }
    _resetStoppedSessionData(cleanup) {
        for (const flag of ['store','notificationDispatcher','messagesWrap',
            'inviteSuggestions','soundboard','activityPanelComponent','blockedMsgGroup']) {
            this['_' + flag + 'Patched'] = false;
        }
        cleanup('readState.clearTransientState', () => this._surfaces.readState.clearTransientState());
        this._rawGetMessages = null;
        this.modules.ElectronModule = null;
        this._recentVoiceStateChanges = [];
        this._soundVoiceUserChannelMap = null;
        this._soundPlayKey = null;
        this._soundFileKey = null;
        this._lastStreamerId = null;
        this._lastActivityParticipantIds = new Set;
        this._runSurfacePhase('stop', 'members', 'autocomplete', 'events', 'groupDms', 'forums', 'pins', 'reactions', 'voice', 'stage', 'badge');
        cleanup('caches', () => this._cacheManager.clearAll());
    }
}

class ModuleResolutionMethods {
    resolveModules() {
        const getStore = (...names) => this._r.getStore(...names);
        const getModule = (filter, opts, label) => this._r.get(filter, opts, label);
        const hadRelationshipStore = !!this._relIsBlockedFn;
        this.modules.RelationshipStore = getStore(...this.constructor.STORE_NAMES.RELATIONSHIP);
        this._resolveRelationshipMethods();
        const relationshipStoreJustAppeared = !hadRelationshipStore && !!this._relIsBlockedFn;
        this._resolveSimpleStores();
        this.modules.MessageStore = getStore("MessageStore", "MessagesStore", "ChannelMessagesStore");
        this._resolveMessagesGet();
        this.modules.MessageActionsModule = this.modules.MessageActionsModule
            || getModule(m => m && typeof m.fetchMessages === "function" && typeof m.jumpToMessage === "function", undefined, "MessageActionsModule:strict")
            || getModule(m => m && typeof m.fetchMessages === "function", undefined, "MessageActionsModule:loose");
        this.modules.RelationshipUtils = getModule(m => m?.addRelationship && m?.removeRelationship, undefined, "RelationshipUtils");
        this.modules.PrivateChannelStore = getStore("PrivateChannelStore", "PrivateChannelsStore")
            || (["getPrivateChannels", "getPrivateChannelIds", "getMutablePrivateChannels"].some(k => typeof this.modules.ChannelStore?.[k] === "function")
                ? this.modules.ChannelStore
                : null);
        this._resolveDispatcher();
        this._resolveRtcModules();
        this._resolveMediaEngineActions();
        try {
            this.resolveInviteQueryModule();
        } catch (err) {
            this.modules.InviteQueryModule = null;
            this.modules.InviteQueryComposeKey = null;
            this._patcher._warn('resolveModules:resolveInviteQueryModule', err);
        }
        this._resolveSoundUtils();
        this._relationshipStoreJustAppeared = relationshipStoreJustAppeared;
        this._reportMissingModules();
    }
    _resolveRelationshipMethods() {
        const store = this.modules.RelationshipStore;
        const previousIsBlockedFn = this._relIsBlockedFn;
        const previousIsIgnoredFn = this._relIsIgnoredFn;
        this._relIsBlockedFn = null;
        this._relIsIgnoredFn = null;
        if (!store) { return; }
        const names = this.constructor.RELATIONSHIP_METHOD_NAMES;
        const bind = (methodNames) => {
            for (const n of methodNames) {
                if (typeof store[n] === "function") return store[n].bind(store);
            }
            return null;
        };
        this._relIsBlockedFn = bind(names.isBlocked);
        this._relIsIgnoredFn = bind(names.isIgnored);
        if (!this._relIsBlockedFn || !this._relIsIgnoredFn) {
            try {
                const relMap = this._getRelationshipTypeMap(store);
                const BLOCKED_TYPE = 2;

                const candidateKeys = new Set(Object.keys(store));
                let proto = Object.getPrototypeOf(store);
                let depth = 0;
                while (proto && proto !== Object.prototype && depth < 5) {
                    for (const k of Object.getOwnPropertyNames(proto)) candidateKeys.add(k);
                    proto = Object.getPrototypeOf(proto);
                    depth++;
                }

                const blockedCandidates = [];
                const ignoredCandidates = [];
                for (const key of candidateKeys) {
                    if (key === "constructor" || typeof store[key] !== "function" || store[key].length !== 1) continue;
                    const lower = key.toLowerCase();
                    if (/^is[A-Z_]?.*block(ed)?$/i.test(key) || (lower.startsWith("is") && lower.includes("block"))) {
                        blockedCandidates.push(key);
                    } else if (lower.startsWith("is") && (lower.includes("ignor") || lower.includes("mute"))) {
                        ignoredCandidates.push(key);
                    }
                }

                if (!this._relIsBlockedFn) {
                    this._relIsBlockedFn = this._pickValidatedCandidate(store, blockedCandidates, relMap, id => relMap.get(id) === BLOCKED_TYPE);
                }
                if (!this._relIsIgnoredFn) {
                    const key = ignoredCandidates[0];
                    if (key) this._relIsIgnoredFn = store[key].bind(store);
                }
            } catch (error) { _recordPatchCatch("ModuleResolutionMethods._resolveRelationshipMethods.fallback1", this, error); }
        }
        if (!this._relIsBlockedFn && !this._relationshipMethodsWarned) {
            this._relationshipMethodsWarned = true;
            this._patcher?._warn("_resolveRelationshipMethods", new Error("Could not resolve RelationshipStore.isBlocked (or an alternate) - ByeBlocked cannot detect blocked users until this is fixed. Discord may have renamed this method; update the plugin."));
            this.toast?.("ByeBlocked couldn't find Discord's block-list method - the plugin may not hide blocked users until it's updated.", "error");
        }
        if (this._relIsBlockedFn !== previousIsBlockedFn || this._relIsIgnoredFn !== previousIsIgnoredFn) {
            this._resetShouldHideCache();
        }
    }
    _getRelationshipTypeMap(store) {
        try {
            const raw = typeof store.getRelationships === "function" ? store.getRelationships() : null;
            if (!raw || typeof raw !== "object") return new Map();
            return new Map(Object.entries(raw).map(([id, type]) => [id, Number(type)]));
        } catch (_) {
            return new Map();
        }
    }
    _pickValidatedCandidate(store, candidateKeys, relMap, expectedFn) {
        if (!candidateKeys.length) return null;
        if (relMap.size > 0) {
            const sampleIds = [...relMap.keys()].slice(0, 50);
            for (const key of candidateKeys) {
                try {
                    const fn = store[key].bind(store);
                    let agree = 0, total = 0;
                    for (const id of sampleIds) {
                        total++;
                        if (!!fn(id) === expectedFn(id)) agree++;
                    }
                    if (total > 0 && agree === total) return fn;
                } catch (error) { _recordPatchCatch("ModuleResolutionMethods._pickValidatedCandidate.fallback1", this, error); }
            }
            this._patcher?._warn("_pickValidatedCandidate", new Error("Found block-method candidates but none matched RelationshipStore.getRelationships() - refusing to guess to avoid hiding non-blocked users' content."));
            return null;
        }
        try { return store[candidateKeys[0]].bind(store); } catch (_) { return null; }
    }
    _resolveSoundUtils() {
        const getModuleRaw = (filter, label) => this._r.get(filter, { defaultExport: false }, label);
        this.modules.SoundUtils = getModuleRaw(m => {
            if (!m || typeof m !== "object") return false;
            try {
                return Object.values(m).some(v => {
                    if (typeof v !== "function") return false;
                    const src = v.toString();
                    return src.includes("disableSounds") && src.includes("getSoundpack");
                });
            } catch (_) { return false; }
        }, "SoundUtils function");
        if (this.modules.SoundUtils) {
            this._soundPlayKey = null;
            this._soundFileKey = null;
            try {
                for (const [key, val] of Object.entries(this.modules.SoundUtils)) {
                    if (typeof val !== "function") continue;
                    const src = val.toString();
                    if (src.includes("disableSounds") && src.includes("getSoundpack")) {
                        this._soundPlayKey = key;
                    } else if (src.includes("playFile")) {
                        this._soundFileKey = key;
                    }
                }
            } catch (error) { _recordPatchCatch("ModuleResolutionMethods._resolveSoundUtils.fallback1", this, error); }
            if (!this._soundPlayKey) {
                this._soundPlayKey = this._wpFindFnKeyFuzzy(this.modules.SoundUtils, "playSound", "playFile");
                if (!this._soundPlayKey) this.modules.SoundUtils = null;
            }
        } else {
            this.modules.SoundUtils = getModuleRaw(m => typeof m?.playSound === "function" && typeof m?.playFile === "function");
            if (this.modules.SoundUtils) {
                this._soundPlayKey = "playSound";
                this._soundFileKey = "playFile";
            }
        }
        if (!this.modules.SoundUtils || !this._soundPlayKey) {
            const shapeMod = getModuleRaw(m => typeof m?.playSound === "function");
            if (shapeMod) {
                this.modules.SoundUtils = shapeMod;
                this._soundPlayKey = "playSound";
            } else {
                const altMod = this._r.get(m => {
                    if (typeof m !== "object" || !m) return false;
                    return Object.values(m).some(v => typeof v === "function" && v.toString().includes("playSound"));
                });
                if (altMod) {
                    const k = this._wpFindFnKeyFuzzy(altMod, "playSound", "play");
                    if (k) { this.modules.SoundUtils = altMod; this._soundPlayKey = k; }
                }
            }
        }
    }
    _resolveRtcModules(attempt = 0) {
        const getModule = (filter, opts, label) => this._r.get(filter, opts, label);
        if (!this.modules.RTCConnectionUtils) {
            this.modules.RTCConnectionUtils = getModule(m => typeof m?.getChannelId === "function" && typeof m?.getGuildId === "function", undefined, "RTCConnectionUtils");
        }
        if (!this.modules.RTCParticipantsModule) {
            this.modules.RTCParticipantsModule = getModule(
                m => m && (typeof m.getParticipants === "function" || typeof m.getVoiceParticipants === "function")
                    && typeof m.getChannelId !== "function"
                    && m !== this.modules.StageChannelParticipantStore,
                { searchExports: true },
                "RTCParticipantsModule"
            );
        }
        const stillMissing = !this.modules.RTCConnectionUtils || !this.modules.RTCParticipantsModule;
        if (stillMissing && attempt < 8) {
            const delays = this.constructor.MODULE_RESOLUTION_RETRY_DELAYS_MS;
            this._scheduleRetry(() => this._resolveRtcModules(attempt + 1), delays[attempt] || 5000);
        } else if (attempt >= 8 && stillMissing) {
            this._patcher._logFail("resolveRtcModules", new Error("ran out of attempts to locate RTCConnectionUtils/RTCParticipantsModule - proceeding with gateway data only; some call-participant filtering may be degraded until the plugin is updated"));
        }
    }
    _resolveLocalMuteReadStore(label) {
        if (!this._localMuteIsToggle || this._localMuteReadStore) return;
        try {
            this._localMuteReadStore = this._r.get(
                m => m && typeof m.getState === "function" && typeof m.isLocalMute === "function",
                { searchExports: true }
            );
        } catch (error) { _recordPatchCatch(label, this, error); }
    }
    _resolveMediaEngineActions(attempt = 0) {
        if (this.modules.MediaEngineActions && (this._localVolumeKey || this._localMuteKey)) return;
        try {
            const mod = this._r.get(m => {
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
                if (!this._localMuteKey) {
                    const toggleKey = this._wpFindFnKeyFuzzy(mod, "toggleLocalMute") || this._wpFindFnKey(mod, "toggleLocalMute");
                    if (toggleKey) { this._localMuteKey = toggleKey; this._localMuteIsToggle = true; }
                }
                this._resolveLocalMuteReadStore("modules.resolveLocalMuteReadStore.primary");
                this._surfaces.voice.reapplyVoiceMuteIfNeeded();
            }
        } catch (error) { _recordPatchCatch("ModuleResolutionMethods._resolveMediaEngineActions.L12252", this, error); }
        if (!this.modules.MediaEngineActions || (!this._localVolumeKey && !this._localMuteKey)) {
            try {
                const alt = this._r.get(m => typeof m?.setLocalVolume === "function" || typeof m?.setLocalMute === "function" || typeof m?.toggleLocalMute === "function");
                if (alt) {
                    this.modules.MediaEngineActions = alt;
                    this._localVolumeKey = typeof alt.setLocalVolume === "function" ? "setLocalVolume" : this._localVolumeKey;
                    if (typeof alt.setLocalMute === "function") {
                        this._localMuteKey = "setLocalMute";
                    } else if (typeof alt.toggleLocalMute === "function") {
                        this._localMuteKey = "toggleLocalMute";
                        this._localMuteIsToggle = true;
                        this._resolveLocalMuteReadStore("modules.resolveLocalMuteReadStore.fallback");
                    }
                    this._surfaces.voice.reapplyVoiceMuteIfNeeded();
                }
            } catch (error) { _recordPatchCatch("ModuleResolutionMethods._resolveMediaEngineActions.L12275", this, error); }
        }
        if ((!this.modules.MediaEngineActions || (!this._localVolumeKey && !this._localMuteKey)) && attempt < 8) {
            const delays = this.constructor.MODULE_RESOLUTION_RETRY_DELAYS_MS;
            this._scheduleRetry(() => this._resolveMediaEngineActions(attempt + 1), delays[attempt] || 5000);
        } else if (attempt >= 8 && (!this.modules.MediaEngineActions || (!this._localVolumeKey && !this._localMuteKey))) {
            this._patcher._logFail("resolveMediaEngineActions", new Error("ran out of attempts to locate setLocalVolume/setLocalMute/toggleLocalMute - Discord likely renamed these methods; local-mute/volume suppression for blocked users' voice audio will not work until the plugin is updated"));
        }
    }
    _resolveMessagesGet() {
        const store = this.modules.MessageStore;
        if (store && this._rawGetMessagesSourceStore && this._rawGetMessagesSourceStore !== store) {
            this._rawGetMessages = null;
        }
        if (store && !this._rawGetMessages) {
            for (const method of ["getMessages", "getMessagesForChannel", "getMessagesForChannelId", "getChannelMessages"]) {
                if (typeof store[method] === "function") {
                    this._rawGetMessages = store[method].bind(store);
                    this._rawGetMessagesSourceStore = store;
                    break;
                }
            }
        }
    }
    _resolveDispatcher() {
        let firstLookupError = null;
        try {
            this.modules.Dispatcher = this.modules.SelectedChannelStore?._dispatcher || null;
            if (this.modules.Dispatcher && typeof this.modules.Dispatcher.dispatch === "function") return;
        } catch (error) { firstLookupError ??= error; }
        try {
            const d = this._r.get(m => m && typeof m === "object" && typeof m.dispatch === "function" && typeof m.subscribe === "function");
            if (d) { this.modules.Dispatcher = d; return; }
        } catch (error) { firstLookupError ??= error; }
        try {
            const d2 = this._r.getBySource("dispatch", { defaultExport: false }, "Flux Dispatcher");
            if (d2 && typeof d2.dispatch === "function") { this.modules.Dispatcher = d2; return; }
        } catch (error) { firstLookupError ??= error; }
        try {
            const entries = Object.entries(window);
            for (const [key, val] of entries) {
                if (key.startsWith("__FLUX_DISPATCHER") && val && typeof val.dispatch === "function") {
                    this.modules.Dispatcher = val;
                    return;
                }
            }
        } catch (error) { firstLookupError ??= error; }
        this.modules.Dispatcher = null;
        if (firstLookupError) _recordPatchCatch("modules.resolveDispatcher.allStrategiesFailed", this, firstLookupError);
        if (!this._dispatcherResolveWarned) {
            this._dispatcherResolveWarned = true;
            this.logger.warn("Could not resolve Discord's Flux Dispatcher through any of the 4 known lookup strategies. Features that rely on it (pin/message-load filtering, notification suppression, call/voice tracking) will be degraded until the plugin is updated.");
        }
    }
    _registerModuleRefresh() {
        try {
            this._patcher.after(this, "resolveModules", () => {
                const events = this._surfaces.events;
                if (!events.guildScheduledEventStorePatched) {
                    this._patcher.safe("patchGuildScheduledEventStore", () => events.patchGuildScheduledEventStore());
                }
                if (!events.eventsSidebarUnreadPatched) {
                    this._patcher.safe("patchEventsSidebarUnread", () => events.patchEventsSidebarUnread());
                }
            });
        } catch (error) { _recordPatchCatch("modules.registerRefresh", this, error); }
    }
    _coreModuleSpecs() {
        return [
            ["RelationshipStore", "isBlocked"],
            ["ChannelStore", "getChannel"],
            ["UserStore", "getCurrentUser"],
            ["SelectedChannelStore", "getChannelId"],
            ["MessageStore", "getMessages"],
            ["GuildMemberStore", "getMember"]
        ];
    }
    _runBootCanaryCheck() {
        if (this._bootCanaryRan) return;
        this._bootCanaryRan = true;
        try {
            const signals = [
                { name: "coreModules", ok: !this._missingCoreModules || this._missingCoreModules.length === 0 },
                { name: "relationshipMethods", ok: !!this._relIsBlockedFn && !!this._relIsIgnoredFn },
                { name: "guildListDom", ok: !!document.querySelector('[role="tree"], [class*="guilds"], [class*="channels"]') },
                { name: "messageListDom", ok: !!document.querySelector('[class*="message_"], [class*="messagesWrapper"], [class*="chatContent"]') }
            ];
            const failed = signals.filter(s => !s.ok).map(s => s.name);
            if (failed.length === signals.length) {
                const msg = "ByeBlocked couldn't verify any of its core hooks after startup - Discord may have changed something. Some features might not work until the plugin is updated.";
                this._patcher?._warn("bootCanaryCheck", new Error(`all signals failed: ${failed.join(", ")}`));
                this.toast(msg, "warn");
            } else if (failed.length) {
                this.logger?.info(`Boot canary: ${failed.length}/${signals.length} signal(s) not confirmed yet (${failed.join(", ")}) - not necessarily a problem, may just mean that part of the UI isn't open.`);
            }
            const missingCore = this._missingCoreModules;
            if (failed.length !== signals.length && Array.isArray(missingCore) && missingCore.length && !this._missingCoreToastShown) {
                this._missingCoreToastShown = true;
                this.toast(`ByeBlocked couldn't find essential Discord modules (${missingCore.join(", ")}). Some features might not work until the plugin is updated.`, "warn");
            }
        } catch (e) {
            this._patcher?._warn("bootCanaryCheck", e);
        }
    }
    _checkResolutionDrift() {
        if (this._resolutionDriftChecked) return;
        this._resolutionDriftChecked = true;
        try {
            const current = this._r?.resolutionReport?.();
            if (!current || !Object.keys(current).length) return;
            const KEY = "resolutionBaseline";
            let build = null;
            try { build = window.GLOBAL_ENV?.SENTRY_TAGS?.buildId || null; } catch (error) { _recordPatchCatch("ModuleResolutionMethods._checkResolutionDrift.fallback1", this, error); }
            let prev = null;
            try { prev = BdApi.Data.load(this.pluginName, KEY); } catch (error) { _recordPatchCatch("ModuleResolutionMethods._checkResolutionDrift.fallback2", this, error); }
            const prevReport = prev && typeof prev === "object" && prev.report && typeof prev.report === "object" ? prev.report : null;
            const lost = [];
            const downgraded = [];
            const changed = [];
            if (prevReport) {
                for (const [label, now] of Object.entries(current)) {
                    const before = prevReport[label];
                    if (!before || before === now) continue;
                    if (now === "missing") lost.push(label);
                    else if (before === "exact" && now === "heuristic") downgraded.push(label);
                    else if (before !== "missing") changed.push(`${label}: ${before} -> ${now}`);
                }
            }
            const buildInfo = build ? ` (Discord build ${build}${prev?.build && prev.build !== build ? `, previously ${prev.build}` : ""})` : "";
            if (lost.length || downgraded.length) {
                const parts = [];
                if (lost.length) parts.push(`no longer found: ${lost.join(", ")}`);
                if (downgraded.length) parts.push(`now resolved by heuristic: ${downgraded.join(", ")}`);
                this.logger.warn(`Module resolution changed since last run${buildInfo} - ${parts.join("; ")}. Discord may have changed something internally.`);
            } else if (changed.length) {
                this.logger.info(`Module resolution strategy changed since last run${buildInfo}: ${changed.join("; ")}`);
            }
            BdApi.Data.save(this.pluginName, KEY, {
                v: this.constructor.VERSION,
                build,
                at: Date.now(),
                report: { ...(prevReport || {}), ...current }
            });
        } catch (e) {
            this._patcher?._warn("resolutionDrift", e);
        }
    }
    _reportMissingModules() {
        const missing = [];
        for (const [name, method] of this._coreModuleSpecs()) {
            const mod = this.modules[name];
            if (!mod || typeof mod[method] !== "function") {
                const resolved = this._r.byHeuristic(name);
                if (resolved && typeof resolved[method] === "function") {
                    this.modules[name] = resolved;
                } else {
                    missing.push(name);
                }
            }
        }
        this._missingCoreModules = missing;
        if (missing.length) {
            this.logger.warn(`Essential modules not found: ${missing.join(", ")}. Discord likely changed something internally - related features may not work until the plugin is updated.`);
        }
        return missing;
    }
    _filterStageParticipants(result) {
        if (!result) return result;
        if (Array.isArray(result)) {
            return _filterArrayPreservingIdentity(result, participant => !this.shouldHide(this.extractUserId(participant)));
        }
        if (typeof result === "object") {
            let changed = false;
            const filtered = {};
            for (const [key, participant] of Object.entries(result)) {
                if (!this.shouldHide(this.extractUserId(participant))) {
                    filtered[key] = participant;
                } else {
                    changed = true;
                }
            }
            return changed ? filtered : result;
        }
        return result;
    }
    _filterActivityParticipants(result) {
        if (!Array.isArray(result)) return result;
        return _filterArrayPreservingIdentity(result, participant => !this.shouldHide(this.extractUserId(participant)));
    }
    _filterThreadsForParent(result) {
        if (!result || typeof result !== "object") return result;
        const isArray = Array.isArray(result);
        const entries = isArray ? result.entries() : Object.entries(result);
        const filtered = isArray ? [] : {};
        for (const [key, thread] of entries) {
            let ownerId = thread?.ownerId || thread?.owner_id || thread?.message?.author?.id;
            if (!ownerId && this.modules.ChannelStore?.getChannel) {
                const threadId = thread?.id || key;
                const channel = threadId ? this.modules.ChannelStore.getChannel(threadId) : null;
                ownerId = channel?.ownerId || channel?.owner_id;
            }
            if (ownerId && this.shouldHide(ownerId)) continue;
            if (isArray) filtered.push(thread); else filtered[key] = thread;
        }
        return filtered;
    }
    _filterThreadsForChannel(result) {
        if (!Array.isArray(result)) return result;
        return result.filter(thread => {
            const ownerId = thread.ownerId || thread.owner_id || thread.message?.author?.id;
            return !(ownerId && this.shouldHide(ownerId));
        });
    }
    _filterGroupDMChannelFromStore(channel, cache) {
        if (!channel) return channel;
        if (!this.settings.places.groupDms || !channel.isGroupDM?.()) return channel;
        if (!this._surfaces.groupDms.groupDMPrototypePatched) return channel;
        const cached = cache.get(channel);
        if (cached) return cached;
        const clone = Object.assign(Object.create(Object.getPrototypeOf(channel)), channel);
        const rawRecipients = clone.rawRecipients;
        const recipients = clone.recipients;
        if (rawRecipients?.__nmbIncomplete || recipients?.__nmbIncomplete) return channel;
        const rawRecipientArray = Array.isArray(rawRecipients) ? rawRecipients : null;
        const recipientArray = Array.isArray(recipients) ? recipients : null;
        const rawWasEmpty = (rawRecipients === undefined || (rawRecipientArray && rawRecipientArray.length === 0))
            && (recipients === undefined || (recipientArray && recipientArray.length === 0));
        if (rawWasEmpty) return channel;
        const filteredRawRecipients = rawRecipientArray ? rawRecipientArray.filter(user => !this.shouldHide(user?.id)) : rawRecipients;
        const filteredRecipients = recipientArray ? recipientArray.filter(id => !this.shouldHide(id)) : recipients;
        const isNowEmpty = (!filteredRawRecipients || filteredRawRecipients.length === 0)
            && (!filteredRecipients || filteredRecipients.length === 0);
        if (isNowEmpty) return channel;
        if (rawRecipientArray) clone.rawRecipients = filteredRawRecipients;
        if (recipientArray) clone.recipients = filteredRecipients;
        try { cache.set(channel, clone); } catch (error) { _recordPatchCatch("ModuleResolutionMethods._filterGroupDMChannelFromStore.fallback1", this, error); }
        return clone;
    }
    _filterVoiceStoreResult(result) {
        if (!this.settings.places.voiceChannels) return result;
        try { return this._surfaces.voice.filterVoiceStates(result); } catch (error) { _recordPatchCatch("stores.filterVoiceResult", this, error); return result; }
    }
    _filterVoiceStoreAltResult(result) {
        if (Array.isArray(result)) this._lastVoiceStatesAltRawSample = result;
        return this._filterVoiceStoreResult(result);
    }
    _patchParticipantStoreMethod(store, method, filterResult) {
        if (typeof store?.[method] !== "function") return;
        this._patchStoreMethodOnce(store, method, (_, __, result) => {
            if (!this.settings.places.voiceChannels) return result;
            try { return filterResult.call(this, result); } catch (_) { return result; }
        });
    }
    patchStores() {
        this._storePatchRetryNeeded = false;
        const voiceStore = this.modules.SortedVoiceStateStore;
        if (!this._voiceStoresWithCapturedOriginal) this._voiceStoresWithCapturedOriginal = new WeakSet();
        const capturedOriginals = this._voiceStoresWithCapturedOriginal;
        if (voiceStore?.getVoiceStatesForChannel) {
            if (!capturedOriginals.has(voiceStore)) {
                this.originalVoiceMethods.getVoiceStatesForChannel = voiceStore.getVoiceStatesForChannel.bind(voiceStore);
                capturedOriginals.add(voiceStore);
            }
            this._patchStoreMethodOnce(voiceStore, "getVoiceStatesForChannel", (_, __, ret) => this._filterVoiceStoreResult(ret));
        }
        if (voiceStore?.getVoiceStates) {
            if (!capturedOriginals.has(voiceStore) || !this.originalVoiceMethods.getVoiceStates) {
                this.originalVoiceMethods.getVoiceStates = voiceStore.getVoiceStates.bind(voiceStore);
            }
            this._patchStoreMethodOnce(voiceStore, "getVoiceStates", (_, __, ret) => this._filterVoiceStoreResult(ret));
        }
        const altMethodName = voiceStore?.getVoiceStatesForChannelAlt
            ? "getVoiceStatesForChannelAlt"
            : this._surfaces.voice.findVoiceStatesAltMethodName(voiceStore);
        if (altMethodName) {
            if (!capturedOriginals.has(voiceStore) || !this.originalVoiceMethods.getVoiceStatesForChannelAlt) {
                this.originalVoiceMethods.getVoiceStatesForChannelAlt = voiceStore[altMethodName].bind(voiceStore);
            }
            this._patchStoreMethodOnce(voiceStore, altMethodName, (_, __, ret) => this._filterVoiceStoreAltResult(ret));
            this._surfaces.voice.registerVoiceStatesAltHealthCheck(voiceStore, altMethodName);
        } else {
            this.logger.warn("Could not locate the voice states method used by the profile popout (getVoiceStatesForChannelAlt or equivalent). The avatar of blocked users may reappear in this specific card until the plugin is updated.");
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
        for (const key of ["getMutableParticipants", "getParticipants", "getSpeakers", "getListeners", "getAudience", "getStageSpeakers", "getStageListeners"]) {
            this._patchParticipantStoreMethod(stageStore, key, this._filterStageParticipants);
        }
        const activityStore = this.modules.ActivityStore;
        for (const key of ["getParticipants", "getActivityParticipants", "getEmbeddedActivityParticipants"]) {
            this._patchParticipantStoreMethod(activityStore, key, this._filterActivityParticipants);
        }
        const channelStore = this.modules.ChannelStore;
        if (channelStore?.getChannel) {
            if (!this._filteredGroupDmChannelCache) this._filteredGroupDmChannelCache = new WeakMap();
            this._patchStoreMethodOnce(channelStore, "getChannel", (_, __, channel) => this._filterGroupDMChannelFromStore(channel, this._filteredGroupDmChannelCache));
        }
        const threadStore = this.modules.ThreadStore;
        const threadMethod = typeof threadStore?.getThreadsForParent === "function" ? "getThreadsForParent"
            : typeof threadStore?.getThreadsForChannel === "function" ? "getThreadsForChannel" : null;
        if (threadMethod) {
            const filterMethod = threadMethod === "getThreadsForParent" ? "_filterThreadsForParent" : "_filterThreadsForChannel";
            this._patchStoreMethodOnce(threadStore, threadMethod, (_, args, ret) => {
                if (!this.settings.places.messages) return ret;
                return this[filterMethod](ret);
            });
        }
    }
    patchActivityPanelComponent(attempt = 0) {
        this._patcher.patchComponent({
            label: "patchActivityPanelComponent",
            attempt,
            maxAttempts: 20,
            delayMs: 3000,
            terms: ["embeddedApplication", "otherClientSessionType", "isWatching", "voicePlatform", "serverMute", "serverDeaf"],
            requiredMatches: 3,
            unpatchFnsKey: "_activityPanelUnpatchFns",
            isPatched() { return this._activityPanelComponentPatched; },
            applyPatch(resolved, unpatchFns) {
                const self = this;
                const unpatch = this.patchInstead(resolved.target, resolved.key, function(ctx, args, orig) {
                    try {
                        const props = args?.[0] || ctx?.props;
                        if (!props) return orig.apply(ctx, args);
                        const uid = props.user?.id || self.extractUserId(props.user);
                        if (uid && self.settings.places.voiceChannels && self.shouldHide(uid)) return null;
                    } catch (_) { _recordPatchCatch("patchActivityPanelComponent.callback"); }
                    return orig.apply(ctx, args);
                });
                if (typeof unpatch !== "function") return false;
                unpatchFns.push(unpatch);
                this._activityPanelComponentPatched = true;
                return true;
            }
        });
    }
    _onRelationshipChanged() {
        this.queueRefresh();
        this._resetShouldHideCache();
        this._surfaces.badge.invalidateTaskbarBadgeCache();
        this._surfaces.badge.refreshTaskbarBadge();
        if (this.settings.places.groupDms) {
            this._resources.timer('relationship', () => {
                try { this.modules.PrivateChannelStore?.emitChange?.(); }
                catch (error) { _recordPatchCatch("relationship.emitPrivateChannels", this, error); }
                try { this.modules.ChannelStore?.emitChange?.(); }
                catch (error) { _recordPatchCatch("relationship.emitChannels", this, error); }
            }, 0);
        }
        if (this.settings.places.voiceChannels) {
            this._emitVoiceStateChanges();
            try { this.hideVoiceUsers(); } catch (error) { _recordPatchCatch("relationship.hideVoiceUsers", this, error); }
        }
        if (this.settings.behavior.muteBlockedVoiceAudio) {
            const applyMuteNow = () => {
                try {
                    const ctx = this._surfaces.voice.getMediaEngineContext();
                    const channelId = ctx?.channelId || this._surfaces.voice.getSelfVoiceChannelId();
                    if (channelId) this._surfaces.voice.applyVoiceMuteForChannel(channelId);
                } catch (error) { _recordPatchCatch("relationship.applyVoiceMute", this, error); }
            };
            applyMuteNow();
            [100, 300, 600, 1000].forEach(delay => this._scheduleRetry(applyMuteNow, delay));
        }
        if (this.settings.places.memberList) {
            try { this._surfaces.members.hideMemberRows(); }
            catch (error) { _recordPatchCatch("relationship.hideMemberRows", this, error); }
            const retry = () => {
                this._resetShouldHideCache();
                try { this._surfaces.members.hideMemberRows(); }
                catch (error) { _recordPatchCatch("relationship.retryHideMemberRows", this, error); }
            };
            this._resources.frame('relationship', retry);
            this._resources.timer('relationship', retry, 60);
            this._resources.timer('relationship', retry, 200);
        }
    }
    patchRelationshipUpdates(attempt = 0) {
        if (this._relationshipUpdatesPatched) return;
        if (!this._retryGuardEnter("patchRelationshipUpdates", attempt)) return;
        if (!this.relationshipChangeHandler) {
            this.relationshipChangeHandler = () => {
                this._surfaces.readState.forceReadStateRecheck();
                this._onRelationshipChanged();
            };
        }
        let listenerAttached = false;
        try {
            const rs = this.modules.RelationshipStore;
            if (rs?.addChangeListener) {
                rs.addChangeListener(this.relationshipChangeHandler);
                this._resources.onDispose('coreStoreListeners', () => {
                    try { rs.removeChangeListener?.(this.relationshipChangeHandler); } catch (error) { _recordPatchCatch("ModuleResolutionMethods.patchRelationshipUpdates.L12682", this, error); }
                });
                listenerAttached = true;
            }
        } catch (err) { this._patcher?._warn("patchRelationshipUpdates:addChangeListener", err); }
        const utils = this.modules.RelationshipUtils;
        if (utils?.addRelationship) this.patchAfter(utils, "addRelationship", () => this._onRelationshipChanged());
        if (utils?.removeRelationship) this.patchAfter(utils, "removeRelationship", () => this._onRelationshipChanged());
        if (listenerAttached) {
            this._relationshipUpdatesPatched = true;
            this._retryGuardExit("patchRelationshipUpdates");
            return;
        }
        if (attempt < 20) {
            this._scheduleRetry(() => this.patchRelationshipUpdates(attempt + 1), this._retryDelay(attempt, 2000));
            return;
        }
        this._patcher?._warn("patchRelationshipUpdates", new Error("RelationshipStore.addChangeListener unavailable after several attempts"));
        this._retryGuardExit("patchRelationshipUpdates");
    }
}

class MessageFilteringMethods {
    _isOnDmListScreen() {
        try {
            return /^\/channels\/@me(\/|$)/.test(location.pathname);
        } catch (_) {
            return false;
        }
    }
    _isCurrentChannelForum() {
        try {
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            if (!channelId) return false;
            return this._isForumParentChannel(channelId);
        } catch (_) {
            return false;
        }
    }
    _isOnChatlessScreen() {
        try {
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            if (channelId) return false;
            if (this._findMessageListAnchorEl()) return false;
            try {
                if (/^\/channels\/@me\/?$/.test(location.pathname)) return true;
            } catch (_) {}
            const onFriendsOrEmptyDm = document.querySelector('[class*="friendsContainer"]') || document.querySelector('[class*="noFriendsText"]');
            if (onFriendsOrEmptyDm) return true;
            try {
                const hasChannelInUrl = /\/channels\/(?:@me|\d+)\/\d{15,25}/.test(location.pathname);
                if (!hasChannelInUrl) return true;
            } catch (_) {}
            return false;
        } catch (_) {
            return false;
        }
    }
    _ensureMessageListRetryListener() {
        if (this._messageListRetryListener) return;
        const store = this.modules.MessageStore;
        if (!store?.addChangeListener) return;
        let pending = null;
        const handler = () => {
            if (!this.isRunning || !this.settings.places.messages) return;
            if (this._blockedMsgGroupPatched && this._messagesWrapPatched) return;
            this._resources.clearTimer('messageListRetry', pending);
            pending = this._resources.timer('messageListRetry', () => {
                if (!this.isRunning || document.visibilityState !== "visible") return;
                if (!this._findMessageListAnchorEl()) return;
                if (!this._blockedMsgGroupPatched) this.patchBlockedMessageGroup(1);
                if (!this._messagesWrapPatched) this.patchMessagesWrapComponent(1);
            }, 150);
        };
        store.addChangeListener(handler);
        this._messageListRetryListener = handler;
        this._resources.onDispose('coreStoreListeners', () => {
            store.removeChangeListener?.(handler);
            if (this._messageListRetryListener === handler) this._messageListRetryListener = null;
        });
    }
    _ensureVisibilityRetryListener() {
        if (this._visibilityRetryListener) return;
        this._visibilityRetryListener = () => {
            if (document.visibilityState !== "visible") return;
            if (!this.isRunning) return;
            if (!this._blockedMsgGroupPatched && this._blockedGroupWaitCycles >= 750) {
                this._blockedGroupWaitCycles = 0;
                this.patchBlockedMessageGroup(1);
            }
            if (!this._messagesWrapPatched && this._messagesWrapWaitCycles >= 750) {
                this._messagesWrapWaitCycles = 0;
                this.patchMessagesWrapComponent(1);
            }
        };
        this._visibilityRetryListenerDispose = this._resources.listener('messagePatchRetryVisibility', document, "visibilitychange", this._visibilityRetryListener);
    }
    _registerNavigationRetryHook(key, fn) {
        if (!this._navigationRetryHookMap) this._navigationRetryHookMap = {};
        if (this._navigationRetryHookMap[key]) return;
        this._navigationRetryHookMap[key] = fn;
        if (!Array.isArray(this._navigationRetryHooks)) this._navigationRetryHooks = [];
        this._navigationRetryHooks.push(fn);
    }
    _ensureRouteChangeRetryListener() {
        const self = this;
        this._registerNavigationRetryHook("messagesAndBlockedGroup", () => {
            if (!self.isRunning) return;
            if (!self._blockedMsgGroupPatched) {
                self._blockedGroupWaitCycles = 0;
                self.patchBlockedMessageGroup(1);
            }
            if (!self._messagesWrapPatched) {
                self._messagesWrapWaitCycles = 0;
                self.patchMessagesWrapComponent(1);
            }
        });
    }
    _extractBlockedGroupMessages(props) {
        const messages = [];
        try {
            const collection = props?.messages;
            let list = null;
            if (Array.isArray(collection)) {
                list = collection;
            } else if (collection && typeof collection.toArray === "function") {
                list = collection.toArray();
            } else if (collection && Array.isArray(collection.content)) {
                list = collection.content.map(item => (item && typeof item === "object" && "content" in item && "author" in (item.content || {})) ? item.content : item);
            }
            if (Array.isArray(list)) {
                for (const message of list) {
                    if (message && typeof message === "object" && ("author" in message)) messages.push(message);
                }
            }
        } catch (_) { _recordPatchCatch("patchBlockedMessageGroup.extractMessages"); }
        return messages;
    }
    _shouldSuppressBlockedGroup(props) {
        const messages = this._extractBlockedGroupMessages(props);
        return messages.length > 0 && messages.every(message => this.isBlockedMessageData(message));
    }
    _tryPatchBlockedMessageGroupOnce(blockedStrings, requiredHits) {
        if (!this._blockedGroupUnpatchableComponents) this._blockedGroupUnpatchableComponents = new WeakSet;
        try {
            const messageElement = this._findMessageListAnchorEl();
            if (!messageElement) return { success: false, reason: "no-element" };
            const component = this.findComponentViaFiber(messageElement, (_, props) => {
                if (!props || typeof props !== "object") return false;
                if (!("messages" in props) || !("showingQuarantineBanner" in props)) return false;
                try {
                    const hits = blockedStrings.filter(key => key in props).length;
                    return hits >= requiredHits;
                } catch (_) { _recordPatchCatch("patchBlockedMessageGroup.propsMatch"); return false; }
            }, 30, "patchBlockedMessageGroup:fiberWalk");
            if (!component) return { success: false, reason: "no-match:not-found" };
            if (this._blockedGroupUnpatchableComponents.has(component)) return { success: false, reason: "unpatchable-component" };
            if (component.__byeblockedGroupPatched) {
                this._blockedMsgGroupPatched = true;
                return { success: true, reason: "already-patched" };
            }
            const surface = this;
            let didPatch = false;
            try {
                const found = this._r.getWithKey(module => module === component || this._patcher.unwrapComponent(module) === component, "BlockedMessageGroup render");
                if (found?.[0] && found[1] != null) {
                    const resolved = this._patcher.resolvePatchTarget(found[0], found[1]);
                    if (resolved) didPatch = this.patchInstead(resolved.target, resolved.key, function(context, args, original) {
                        try {
                            const props = args?.[0] || context?.props;
                            if (surface._shouldSuppressBlockedGroup(props)) return null;
                        } catch (_) { _recordPatchCatch("patchBlockedMessageGroup.callback"); }
                        return original.apply(context, args);
                    });
                }
            } catch (_) { _recordPatchCatch("patchBlockedMessageGroup.resolvePatchTarget"); }
            if (didPatch) {
                component.__byeblockedGroupPatched = true;
                try { component.__byeblockedWrapPatched = true; } catch (_) {}
                this._blockedMsgGroupPatched = true;
                return { success: true, reason: "patched" };
            }
            this._blockedGroupUnpatchableComponents.add(component);
            return { success: false, reason: "unpatchable-component" };
        } catch (_) {
            _recordPatchCatch("patchBlockedMessageGroup.tryPatchOnce");
            return { success: false, reason: "error" };
        }
    }
    patchBlockedMessageGroup(attempt = 0) {
        if (!this.settings.places.messages) return;
        if (this._blockedMsgGroupPatched) return;
        if (!this._retryGuardEnter("patchBlockedMessageGroup", attempt)) return;
        if (attempt === 0) this._blockedGroupWaitCycles = 0;
        this._ensureVisibilityRetryListener();
        this._ensureRouteChangeRetryListener();
        const BLOCKED_STRINGS = ["filterAfterTimestamp", "messageGroupSpacing", "showNewMessagesBar", "messageDisplayCompact", "channelStream", "permissionVersion", "editingMessageId", "keyboardModeEnabled", "showingQuarantineBanner", "hideSummaries", "typingGradient", "isGameInvitesPost"];
        const BLOCKED_REQUIRED = 3;
        let lastTryReason = "no-match";
        const tryPatchOnce = () => {
            const result = this._tryPatchBlockedMessageGroupOnce(BLOCKED_STRINGS, BLOCKED_REQUIRED);
            lastTryReason = result.reason;
            return result.success;
        };
        if (tryPatchOnce()) {
            this.logger?.info(`patchBlockedMessageGroup: patched successfully on attempt ${attempt} (${lastTryReason}).`);
            this._retryGuardExit("patchBlockedMessageGroup");
            this._stopShortLivedMessageObserver();
            return;
        }
        if (attempt === 0 || lastTryReason === "unpatchable-component") {
            this._startPersistentBlockedGroupObserver(tryPatchOnce, () => {
                this._blockedMsgGroupPatched = true;
                this.logger?.info("patchBlockedMessageGroup: patched successfully via background observer (after the initial attempt had failed).");
                this._retryGuardExit("patchBlockedMessageGroup");
            });
        }
        if (lastTryReason === "no-element") {
            if (this._isOnChatlessScreen()) {
                this._stopShortLivedMessageObserver();
                this._retryGuardExit("patchBlockedMessageGroup");
                return;
            }
            this._blockedGroupWaitCycles = 750;
            this._ensureMessageListRetryListener();
            this._stopShortLivedMessageObserver();
            this._retryGuardExit("patchBlockedMessageGroup");
            return;
        }
        if (lastTryReason === "unpatchable-component") {
            this._retryGuardExit("patchBlockedMessageGroup");
            return;
        }
        this._blockedGroupWaitCycles = 0;
        if (attempt < 45) {
            this._scheduleRetry(() => this.patchBlockedMessageGroup(attempt + 1), this._retryDelay(attempt, 2000));
            return;
        }
        this._stopShortLivedMessageObserver();
        this._patcher?._warn("patchBlockedMessageGroup", new Error("ran out of attempts to locate the blocked-message-group component and patch its resolved render export - Discord may have changed this component's structure (will retry automatically on tab visibility change or channel navigation)"));
        this._retryGuardExit("patchBlockedMessageGroup");
    }
    _startPersistentBlockedGroupObserver(tryFn, onSuccess, _cyclesLeft = 3) {
        this._startShortLivedMessageObserver(tryFn, onSuccess);
        this._resources.clearTimer('blockedGroupObserver', this._blockedGroupObserverRenewTimeout);
        if (_cyclesLeft <= 0) return;
        this._blockedGroupObserverRenewTimeout = this._resources.timer('blockedGroupObserver', () => {
            if (!this.isRunning) return;
            if (this._blockedMsgGroupPatched) return;
            if (!this._shortLivedMsgObserver) return;
            this._startPersistentBlockedGroupObserver(tryFn, onSuccess, _cyclesLeft - 1);
        }, 30000);
    }
    isBlockedMessageData(message, referencedMessage = null) {
        if (!message || typeof message !== "object") return false;
        try {
            if (!this._placeEnabled("messages")) return false;
            if (message.blocked === true) return true;
            const authorId = message.author?.id || null;
            if (authorId && this.shouldHide(authorId)) return true;
            if (this._placeEnabled("repliesToBlocked") && this._hasBlockedReplyAuthor(message, referencedMessage)) return true;
            if (this._placeEnabled("mentions")) {
                const mentions = message.mentions;
                if (Array.isArray(mentions) && mentions.length) {
                    for (let i = 0; i < mentions.length; i++) {
                        const m = mentions[i];
                        const mid = typeof m === "string" ? m : m?.id;
                        if (mid && this.shouldHide(mid)) return true;
                    }
                } else if (mentions && typeof mentions.forEach === "function") {
                    let hit = false;
                    mentions.forEach(m => {
                        if (hit) return;
                        const mid = typeof m === "string" ? m : m?.id;
                        if (mid && this.shouldHide(mid)) hit = true;
                    });
                    if (hit) return true;
                }
            }
        } catch (_) { _recordPatchCatch("isBlockedMessageData", this); }
        return false;
    }
    filterMessagesCollection(value) {
        return _memoizeByRef(this, "_messageFilterCache", value, v => this._filterMessagesCollectionUncached(v));
    }
    _filterMessagesCollectionUncached(value) {
        if (!value) return value;
        if (Array.isArray(value)) return this._filterActionMessageArray(value);
        if (value && typeof value.filter === "function" && typeof value.toArray === "function") {
            try {
                const asArray = value.toArray();
                const filtered = asArray.filter(msg => !this.isBlockedMessageData(msg));
                if (filtered.length === asArray.length) return value;
                try {
                    const internalArrayKey = Array.isArray(value._array) ? "_array" : null;
                    if (internalArrayKey) {
                        const clone = Object.create(Object.getPrototypeOf(value));
                        Object.assign(clone, value, { [internalArrayKey]: filtered });
                        return clone;
                    }
                } catch (_) {}
                if (typeof value.constructor === "function") {
                    try {
                        return new value.constructor(filtered);
                    } catch (_) {}
                }
                this._logThrottled("filterMessagesCollection", "could not clone the filtered collection; keeping original", "warn");
                return value;
            } catch (_) {
                _recordPatchCatch("filterMessagesCollection.toArray", this);
                return value;
            }
        }
        return value;
    }
    _applyMessageFilterToProps(props) {
        this._health?.heartbeat("messages");
        if (!props || typeof props !== "object") return;
        try {
            const msgs = props.messages;
            if (!msgs) return;
            if (Array.isArray(msgs)) {
                props.messages = this.filterMessagesCollection(msgs);
                return;
            }
            if (typeof msgs.toArray === "function" && typeof msgs.removeMany === "function") {
                let list;
                try { list = msgs.toArray(); } catch (_) { _recordPatchCatch("patchMessagesWrapComponent.toArray"); return; }
                if (!Array.isArray(list) || !list.length) return;
                const blockedIds = [];
                for (const msg of list) {
                    if (msg && this.isBlockedMessageData(msg)) blockedIds.push(msg.id);
                }
                if (blockedIds.length && blockedIds.length < list.length) {
                    try { props.messages = msgs.removeMany(blockedIds); } catch (_) { _recordPatchCatch("patchMessagesWrapComponent.removeMany"); }
                }
                return;
            }
            if (msgs._array && Array.isArray(msgs._array)) {
                const filtered = this.filterMessagesCollection(msgs._array);
                if (filtered !== msgs._array) {
                    try {
                        const clone = Object.create(Object.getPrototypeOf(msgs));
                        Object.assign(clone, msgs, { _array: filtered });
                        props.messages = clone;
                    } catch (_) { _recordPatchCatch("patchMessagesWrapComponent.cloneCollection"); }
                }
            }
        } catch (_) { _recordPatchCatch("patchMessagesWrapComponent.applyFilterToProps"); }
    }
    _findMessagesWrapComponentFromEl(element, propKeys, requiredHits, bestKeyHits) {
        const looksLikeWrapProps = props => {
            if (!props || typeof props !== "object" || !("messages" in props)) return false;
            const hits = propKeys.filter(key => key in props);
            if (hits.length > bestKeyHits.length) {
                bestKeyHits.length = 0;
                bestKeyHits.push(...hits);
            }
            return hits.length >= requiredHits;
        };
        return this.findComponentViaFiber(element, (_, props) => looksLikeWrapProps(props), 25, "patchMessagesWrapComponent:fiberWalk");
    }
    _findModuleHoldingWrappedComponent(target) {
        try {
            const matches = value => value === target || this._patcher.unwrapComponent(value) === target;
            const module = this._r.get(m => m && typeof m === "object" && Object.values(m).some(matches), { searchExports: true }, "findModuleHolding");
            if (!module) return null;
            const key = Object.keys(module).find(name => matches(module[name]));
            return key ? [module, key] : null;
        } catch (_) {
            return null;
        }
    }
    _patchMessagesWrapCandidate(component) {
        if (component.__byeblockedWrapPatched) {
            this._messagesWrapPatched = true;
            return "already-patched";
        }
        const surface = this;
        let patched = false;
        if (component.__byeblockedGroupPatched) {
            try {
                const found = this._r.getWithKey(m => m === component || this._patcher.unwrapComponent(m) === component, "patchMessagesWrapComponent render");
                const resolved = found?.[0] && found[1] != null
                    ? this._patcher.resolvePatchTarget(found[0], found[1])
                    : null;
                if (resolved) {
                    patched = this.patchInstead(resolved.target, resolved.key, function(context, args, original) {
                        try { surface._applyMessageFilterToProps(args?.[0] || context?.props); } catch (_) { _recordPatchCatch("patchMessagesWrapComponent.callback"); }
                        return original.apply(context, args);
                    });
                }
            } catch (_) { _recordPatchCatch("patchMessagesWrapComponent.resolvePatchTarget"); }
        } else if (component.prototype && typeof component.prototype.render === "function") {
            patched = this.patchBefore(component.prototype, "render", context => this._applyMessageFilterToProps(context?.props));
        } else {
            const found = this._findModuleHoldingWrappedComponent(component);
            if (found) {
                const [moduleObj, key] = found;
                patched = this.patchBefore(moduleObj, key, (_, args) => this._applyMessageFilterToProps(args?.[0]));
            } else {
                const inner = component.type || component.render;
                if (typeof inner === "function") {
                    const innerFound = this._findModuleHoldingWrappedComponent(inner);
                    if (innerFound) {
                        const [moduleObj, key] = innerFound;
                        patched = this.patchBefore(moduleObj, key, (_, args) => this._applyMessageFilterToProps(args?.[0]));
                    }
                }
            }
        }
        if (!patched) return false;
        try { component.__byeblockedWrapPatched = true; } catch (_) {}
        this._messagesWrapPatched = true;
        return true;
    }
    patchMessagesWrapComponent(attempt = 0) {
        if (!this.settings.places.messages) return;
        if (this._messagesWrapPatched) return;
        if (!this._retryGuardEnter("patchMessagesWrapComponent", attempt)) return;
        if (this._storePatched || this._messageLoadDispatchPatched) {
            this._retryGuardExit("patchMessagesWrapComponent");
            return;
        }
        if (attempt === 0) this._messagesWrapWaitCycles = 0;
        this._ensureVisibilityRetryListener();
        this._ensureRouteChangeRetryListener();
        if (attempt === 0 && Array.isArray(this._messagesWrapUnpatchFns) && this._messagesWrapUnpatchFns.length) {
            for (const unpatch of this._messagesWrapUnpatchFns) {
                try { unpatch?.(); } catch (error) { _recordPatchCatch("MessageFilteringMethods.patchMessagesWrapComponent.L13109", this, error); }
            }
            this._messagesWrapUnpatchFns = [];
        }
        if (!Array.isArray(this._messagesWrapUnpatchFns)) this._messagesWrapUnpatchFns = [];
        const WRAP_PROP_KEYS = ["messageGroupSpacing", "scrollerClassName", "showNewMessagesBar", "messageDisplayCompact", "channelStream", "filterAfterTimestamp", "showingQuarantineBanner", "keyboardModeEnabled"];
        const WRAP_REQUIRED = 4;
        let bestKeyHits = [];
        let msgElPresent = false;
        let unpatchableCandidate = null;
        if (!this._messagesWrapCandidateFailures) this._messagesWrapCandidateFailures = new WeakMap();
        if (!this._messagesWrapUnpatchableCandidates) this._messagesWrapUnpatchableCandidates = new WeakSet();
        try {
            const msgEl = this._findMessageListAnchorEl();
            if (msgEl) {
                msgElPresent = true;
                const Comp = this._findMessagesWrapComponentFromEl(msgEl, WRAP_PROP_KEYS, WRAP_REQUIRED, bestKeyHits);
                if (Comp) {
                    if (this._messagesWrapUnpatchableCandidates.has(Comp)) {
                        this._retryGuardExit("patchMessagesWrapComponent");
                        return;
                    }
                    const patchResult = this._patchMessagesWrapCandidate(Comp);
                    if (patchResult === "already-patched") {
                        this._retryGuardExit("patchMessagesWrapComponent");
                        return;
                    }
                    if (patchResult) {
                        this._retryGuardExit("patchMessagesWrapComponent");
                        return;
                    }
                    unpatchableCandidate = Comp;
                }
            }
        } catch (_) { _recordPatchCatch("patchMessagesWrapComponent.tryPatchOnce"); }
        if (unpatchableCandidate) {
            const failures = (this._messagesWrapCandidateFailures.get(unpatchableCandidate) || 0) + 1;
            this._messagesWrapCandidateFailures.set(unpatchableCandidate, failures);
            if (failures >= 3) {
                this._messagesWrapUnpatchableCandidates.add(unpatchableCandidate);
                this._retryGuardExit("patchMessagesWrapComponent");
                return;
            }
        }
        if (!msgElPresent) {
            if (this._isOnChatlessScreen()) {
                this._retryGuardExit("patchMessagesWrapComponent");
                return;
            }
            this._messagesWrapWaitCycles = 750;
            this._ensureMessageListRetryListener();
            this._retryGuardExit("patchMessagesWrapComponent");
            return;
        }
        this._messagesWrapWaitCycles = 0;
        if (attempt < 20) {
            this._scheduleRetry(() => this.patchMessagesWrapComponent(attempt + 1), this._retryDelay(attempt, 3000));
            return;
        }
        this._patcher?._warn("patchMessagesWrapComponent", new Error(`ran out of attempts to locate the MessagesWrap module via fiber walk - best candidate matched ${bestKeyHits.length}/${WRAP_REQUIRED} required prop keys (${bestKeyHits.join(", ") || "none"}). This patch requires a message list to be visible on screen during at least one attempt.`));
        this._retryGuardExit("patchMessagesWrapComponent");
    }
    _hasMessageStoreMethodDrift() {
        const store = this.modules.MessageStore;
        if (!store || this._messageStorePatchTarget !== store) return true;
        const refs = this._messageStorePatchedMethodRefs;
        if (!refs?.size) return true;
        return [...refs].some(([method, patchedFn]) => store[method] !== patchedFn);
    }
    patchMessageStore(attempt = 0) {
        if (!this.settings.places.messages) return;
        const store = this.modules.MessageStore;
        const methodDrifted = !!store && this._messageStorePatchTarget === store && this._hasMessageStoreMethodDrift();
        if (this._storePatched && this._messageStorePatchTarget === store && !methodDrifted) {
            this._registerMessageFilterEffectivenessHealthCheck();
            return;
        }
        if (this._messageStorePatchTarget !== store || methodDrifted) this._storePatched = false;
        if (!this._retryGuardEnter("patchMessageStore", attempt)) return;
        if (!store) {
            this._retryMessageStore(attempt, 40, "MessageStore not resolved after several attempts");
            return;
        }
        this._resolveMessagesGet();
        const methods = ["getMessages", "getMessagesForChannel", "getMessagesForChannelId"];
        const availableMethods = methods.filter(method => typeof store[method] === "function");
        this._prepareMessageStorePatches(store, availableMethods, methodDrifted);
        if (this._installMessageStoreFilters(store, availableMethods)) {
            this._storePatched = true;
            this._registerMessageFilterEffectivenessHealthCheck();
            this._retryGuardExit("patchMessageStore");
            return;
        }
        this._retryMessageStore(attempt, 10, "no expected method found on MessageStore after several attempts");
    }
    _retryMessageStore(attempt, maxAttempts, failureMessage) {
        if (attempt < maxAttempts) {
            this._scheduleRetry(() => this.patchMessageStore(attempt + 1), this._retryDelay(attempt, 3000));
            return;
        }
        this._patcher?._warn("patchMessageStore", new Error(failureMessage));
        this._retryGuardExit("patchMessageStore");
    }
    _clearMessageStorePatches() {
        for (const unpatch of this._messageStoreUnpatchFns || []) {
            try { unpatch?.(); } catch (error) { _recordPatchCatch("MessageFilteringMethods.patchMessageStore.unpatch", this, error); }
        }
        this._messageStoreUnpatchFns = [];
        this._messageStorePatchedMethods = new Set();
        this._messageStorePatchedMethodRefs = new Map();
    }
    _prepareMessageStorePatches(store, availableMethods, methodDrifted) {
        if (this._messageStorePatchTarget !== store) {
            this._clearMessageStorePatches();
            this._messageStorePatchTarget = store;
        } else if (methodDrifted) {
            _forgetReplacedPatches(store, this._messageStorePatchedMethods, this._messageStorePatchedMethodRefs);
            this._rawGetMessages = null;
            this._rawGetMessagesSourceStore = null;
            this._resolveMessagesGet();
        } else if (!this._storePatched && this._messageStorePatchedMethods?.size
            && availableMethods.every(method => this._messageStorePatchedMethods.has(method))) {
            this._clearMessageStorePatches();
        }
    }
    _installMessageStoreFilters(store, availableMethods) {
        const installedMethods = this._messageStorePatchedMethods || (this._messageStorePatchedMethods = new Set());
        const refs = this._messageStorePatchedMethodRefs || (this._messageStorePatchedMethodRefs = new Map());
        const filters = availableMethods.map(method => ({ method, callback: (_, __, result) => this._filterMessageStoreResult(result) }));
        return _installAfterPatchBatch(store, filters, installedMethods, refs, (target, method, callback) => {
            const unpatch = this.patchAfter(target, method, callback);
            if (typeof unpatch === "function") this._messageStoreUnpatchFns.push(unpatch);
            return unpatch;
        });
    }
    _filterMessageStoreResult(result) {
        this._surfaces.pins.scanForBlockedPinSystemMessages(result);
        if (!this.settings.places.messages) return result;
        try {
            return this.filterMessagesCollection(result);
        } catch (_) {
            _recordPatchCatch("patchMessageStore.filterMessagesCollection");
            return result;
        }
    }
    _filterActionMessageArray(arr) {
        if (!Array.isArray(arr) || !arr.length) return arr;
        return _filterArrayPreservingIdentity(arr, msg => !this.isBlockedMessageData(msg));
    }
    patchMessageLoadDispatch(attempt = 0) {
        this._patcher.patchMethod({
            label: "patchMessageLoadDispatch",
            attempt,
            maxAttempts: 15,
            delayMs: 2000,
            isPatched() { return this._messageLoadDispatchPatched; },
            resolve() {
                if (!this.modules.Dispatcher) this._resolveDispatcher();
                const Dispatcher = this.modules.Dispatcher;
                return (Dispatcher && typeof Dispatcher.dispatch === "function") ? Dispatcher : null;
            },
            onExhausted(reason) {
                this._patcher?._warn("patchMessageLoadDispatch", new Error(reason === "installing patch" ? "Message-load dispatcher target was found, but the patch could not be installed after several attempts" : "Dispatcher unavailable after several attempts"));
            },
            apply(Dispatcher) {
                const self = this;
                const unpatch = this.patchBefore(Dispatcher, "dispatch", function(_, args) {
                    try {
                        if (!self.settings.places.messages) return;
                        const action = args[0];
                        if (!action || typeof action !== "object") return;
                        if (action.type === self.constructor.ACTIONS.LOAD_MESSAGES_SUCCESS) {
                            const rawArr = Array.isArray(action.messages) ? action.messages
                                : (Array.isArray(action.messages?.messages) ? action.messages.messages : null);
                            if (rawArr && rawArr.length) {
                                self._reconcileBlockedOnlyFromRawBatch(action.channelId || action.channel_id || action.messages?.channelId, rawArr);
                            }
                            if (Array.isArray(action.messages)) {
                                action.messages = self._filterActionMessageArray(action.messages);
                            } else if (Array.isArray(action.messages?.messages)) {
                                action.messages.messages = self._filterActionMessageArray(action.messages.messages);
                            }
                        }
                    } catch (_) { _recordPatchCatch("patchMessageLoadDispatch.callback", self); }
                });
                this._messageLoadDispatchPatched = typeof unpatch === "function";
                return this._messageLoadDispatchPatched;
            }
        });
    }
    _reconcileBlockedOnlyFromRawBatch(channelId, rawMessages) {
        try {
            if (!channelId || !Array.isArray(rawMessages) || !rawMessages.length) return;
            const store = this.modules.ReadStateStore;
            const ackId = store?.ackMessageId ? store.ackMessageId(channelId) : null;
            const lastMessageId = store?.lastMessageId ? store.lastMessageId(channelId) : null;
            if (!lastMessageId) return;
            const relevant = ackId
                ? rawMessages.filter(m => m?.id && this._surfaces.readState.snowflakeGreater(m.id, ackId))
                : rawMessages;
            if (!relevant.length) return;
            const hasNonBlockedUnread = relevant.some(m => !this.isBlockedMessageData(m));
            let parentId = null;
            try { parentId = this.modules.ChannelStore?.getChannel?.(channelId)?.parent_id || null; } catch (error) { _recordPatchCatch("messages.reconcileParentChannel", this, error); }
            if (hasNonBlockedUnread) {
                this._surfaces.readState.clearBlockedOnlyReadActivity(channelId);
                if (parentId) this._surfaces.readState.clearBlockedOnlyReadActivity(parentId);
            } else if (relevant.some(m => m?.id === lastMessageId)) {
                this._surfaces.readState.markBlockedOnlyReadActivity(channelId, parentId, lastMessageId);
            }
            queueMicrotask(() => {
                this._surfaces.readState.forceReadStateRecheck(true);
                this._surfaces.badge.refreshTaskbarBadge();
            });
        } catch (_) { _recordPatchCatch("reconcileBlockedOnlyFromRawBatch", this); }
    }
    _getAuthorId(msg) { return msg?.author?.id || msg?.authorId || msg?.user?.id; }
    _looksLikeMessageOfType(msg, typeKey) {
        if (!msg || typeof msg !== "object") return false;
        const hasTextContent = typeof msg.content === "string" && msg.content.trim().length > 0;
        if (typeKey === "CHANNEL_PINNED_MESSAGE") {
            const hasMessageRef = !!(msg.messageReference?.message_id || msg.message_reference?.message_id);
            return hasMessageRef && !hasTextContent;
        }
        if (typeKey === "RECIPIENT_ADD") {
            const hasMentions = Array.isArray(msg.mentions) && msg.mentions.length > 0;
            const channelId = msg.channel_id || msg.channelId;
            return hasMentions && !hasTextContent && !!channelId;
        }
        return false;
    }
    _isMessageOfType(msg, typeKey) {
        if (!msg) return false;
        const expected = this.constructor.MESSAGE_TYPES[typeKey];
        if (msg.type === expected) return true;
        return this._looksLikeMessageOfType(msg, typeKey);
    }
    _recordMessageAuthor(messageId, authorId) {
        if (!messageId || !authorId) return;
        if (!this._msgAuthorCache) this._msgAuthorCache = new Map();
        const MAX_SIZE = 3000;
        if (this._msgAuthorCache.size >= MAX_SIZE && !this._msgAuthorCache.has(String(messageId))) {
            const oldestKey = this._msgAuthorCache.keys().next().value;
            if (oldestKey !== undefined) this._msgAuthorCache.delete(oldestKey);
        }
        this._msgAuthorCache.set(String(messageId), String(authorId));
    }
    _lookupMessageAuthor(messageId) {
        if (!messageId || !this._msgAuthorCache) return null;
        return this._msgAuthorCache.get(String(messageId)) || null;
    }
    _hasBlockedReplyAuthor(message, referencedMessage = null) {
        const refId = (message?.messageReference || message?.message_reference)?.message_id
            || (message?.messageReference || message?.message_reference)?.messageId
            || null;
        const cachedAuthorId = refId ? this._lookupMessageAuthor(refId) : null;
        if (cachedAuthorId) return !!this.shouldHide(cachedAuthorId);
        const ref = referencedMessage || this.getReferencedMessage(message);
        const authorId = ref?.author?.id || null;
        return !!(authorId && this.shouldHide(authorId));
    }
    _isBlockedMessage(msg) {
        if (!msg) return false;
        if (msg.blocked === true) return true;
        const authorId = this._getAuthorId(msg);
        if (authorId && this.shouldHide(authorId)) return true;
        try {
            if (this._hasBlockedReplyAuthor(msg)) return true;
        } catch (error) { _recordPatchCatch("messages.resolveBlockedReplyAuthor", this, error); }
        if (Array.isArray(msg.mentions)) {
            for (const mention of msg.mentions) {
                const mid = typeof mention === 'string' ? mention : (mention?.id || mention?.userId);
                if (mid && this.shouldHide(mid)) return true;
            }
        }
        return false;
    }
    _isForumParentChannel(channelId) {
        try { return this.modules.ChannelStore?.getChannel?.(channelId)?.type === this.constructor.CHANNEL_TYPES.GUILD_FORUM; } catch (_) { return false; }
    }
}

class InviteMethods {
    _handleGroupRecipientAdd(msg) {
        try {
            if (!msg || !this._isMessageOfType(msg, "RECIPIENT_ADD")) return;
            const channelId = msg.channel_id || msg.channelId;
            const messageId = msg.id;
            if (!channelId || !messageId) return;
            const adderId = this._getAuthorId(msg);
            if (!adderId) return;
            if (this.shouldHide(adderId)) return;
            this._surfaces.readState.markBlockedOnlyReadActivity(channelId, null, messageId);
            this._suppressGroupAddSoundMessageId = String(messageId);
            this._surfaces.badge.refreshTaskbarBadge();
        } catch (error) { _recordPatchCatch("invites.handleGroupRecipientAdd", this, error); }
    }
    resolveInviteQueryModule() {
        const PRIMARY_SOURCES = ["queryFriends", "queryDMUsers", "friendSuggestions"];
        const LABEL = "InviteQueryModule (queryFriends/queryDMUsers)";
        const matchesSource = value => {
            if (typeof value !== "function") return false;
            const source = value.toString();
            return PRIMARY_SOURCES.filter(term => source.includes(term)).length >= 2;
        };
        let inviteQueryMod = null;
        for (const src of PRIMARY_SOURCES) {
            inviteQueryMod = this._r.getBySource(src, { defaultExport: false });
            if (inviteQueryMod) break;
        }
        if (!inviteQueryMod) {
            inviteQueryMod = this._r.get(m => {
                if (!m || typeof m !== "object") return false;
                try {
                    return Object.values(m).some(matchesSource);
                } catch (_) { return false; }
            }, { defaultExport: false }, LABEL);
        }
        this.modules.InviteQueryModule = inviteQueryMod || null;
        this.modules.InviteQueryComposeKey = null;
        if (inviteQueryMod) {
            for (const name of PRIMARY_SOURCES) {
                if (typeof inviteQueryMod[name] === "function") {
                    this.modules.InviteQueryComposeKey = name;
                    break;
                }
            }
            if (!this.modules.InviteQueryComposeKey) {
                for (const key of Object.keys(inviteQueryMod)) {
                    const val = inviteQueryMod[key];
                    if (typeof val !== "function") continue;
                    try {
                        if (matchesSource(val)) {
                            this.modules.InviteQueryComposeKey = key;
                            break;
                        }
                    } catch (_) {}
                }
            }
            if (!this.modules.InviteQueryComposeKey) {
                for (const outerKey of Object.keys(inviteQueryMod)) {
                    const outerVal = inviteQueryMod[outerKey];
                    if (!outerVal || typeof outerVal !== "object") continue;
                    for (const name of PRIMARY_SOURCES) {
                        if (typeof outerVal[name] === "function") {
                            this.modules.InviteQueryModule = outerVal;
                            this.modules.InviteQueryComposeKey = name;
                            break;
                        }
                    }
                    if (this.modules.InviteQueryComposeKey) break;
                }
            }
        }
        if (this.modules.InviteQueryComposeKey) return true;
        return false;
    }
    _shouldHideInviteSuggestionRow(row, fallbackUserId = null) {
        if (row?.type === "FRIEND" || row?.type === "DM") {
            const userId = row.item?.id || fallbackUserId;
            return !!(userId && this.shouldHide(userId));
        }
        if (row?.type === "GROUP_DM") {
            const recipients = row.item?.recipients;
            return !!(Array.isArray(recipients) && recipients.length
                && recipients.map(recipient => recipient?.id || recipient).some(id => this.shouldHide(id)));
        }
        return !!(fallbackUserId && this.shouldHide(fallbackUserId));
    }
    patchInviteSuggestions(attempt = 0) {
        if (this._inviteSuggestionsPatched) return;
        if (!this._retryGuardEnter("patchInviteSuggestions", attempt)) return;
        const self = this;
        try {
            let mod = this.modules.InviteQueryModule;
            let key = this.modules.InviteQueryComposeKey;
            if (!mod || !key || typeof mod[key] !== "function") {
                this.resolveInviteQueryModule();
                mod = this.modules.InviteQueryModule;
                key = this.modules.InviteQueryComposeKey;
            }
            if (!this._inviteSuggestionsPatched && mod && key && typeof mod[key] === "function") {
                const installed = this.patchAfter(mod, key, function(context, args, result) {
                    self._health?.heartbeat("inviteQueryModule");
                    if (!self.settings.places.autocomplete) return result;
                    if (!result || !Array.isArray(result.rows)) return result;
                    result.rows = result.rows.filter(row => !self._shouldHideInviteSuggestionRow(row));
                    return result;
                });
                if (installed) {
                    this._inviteSuggestionsPatched = true;
                    this._stopInviteClickListener();
                    this._retryGuardExit("patchInviteSuggestions");
                    return;
                }
            }
        } catch (error) { _recordPatchCatch("invites.resolveQueryModule", this, error); }
        const { patched: found } = this._patcher.patchBySourceTermsScored({
            terms: ["inviteKey", "ringingEnabled", "inviteChannel"],
            requiredMatches: 2,
            label: "patchInviteSuggestions",
            apply: (mod, key) => {
                const resolved = this._patcher.resolvePatchTarget(mod, key);
                if (!resolved) return false;
                const installed = self.patchInstead(resolved.target, resolved.key, function(ctx, args, orig) {
                    self._health?.heartbeat("inviteQueryModule");
                    try {
                        const props = args?.[0] || ctx?.props;
                        if (!props || !self.settings.places.autocomplete) return orig.apply(ctx, args);
                        const row = props.row;
                        if (self._shouldHideInviteSuggestionRow(row, props.user?.id)) return null;
                    } catch (error) { _recordPatchCatch("invites.queryCallback", self, error); }
                    return orig.apply(ctx, args);
                });
                return !!installed;
            }
        });
        if (found) {
            this._inviteSuggestionsPatched = true;
            this._stopInviteClickListener();
            this._retryGuardExit("patchInviteSuggestions");
            return;
        }
        if (!this._inviteSuggestionsPatched && attempt < 30) {
            this._scheduleRetry(() => this.patchInviteSuggestions(attempt + 1), this._retryDelay(attempt, 5e3));
            this._startInviteClickListener();
        } else if (!this._inviteSuggestionsPatched) {
            this._patcher._logFail("patchInviteSuggestions", new Error("ran out of attempts - weak indicators did not find the module; see maintenance notes"));
            this._stopInviteClickListener();
            this._retryGuardExit("patchInviteSuggestions");
        }
    }
    _startInviteClickListener() {
        if (this._inviteClickHandler || this._inviteSuggestionsPatched) return;
        const self = this;
        const INVITE_LABEL_RE = /convidar|invite|invitar|inviter|invita al|sprachkanal|uitnodigen/i;
        this._inviteClickHandler = event => {
            if (self._inviteSuggestionsPatched) return;
            try {
                const el = event.target.closest?.('[aria-label], [aria-labelledby], button, a, [role="menuitem"], [role="button"]');
                if (!el) return;
                const label = el.getAttribute?.('aria-label') || el.textContent || '';
                if (!INVITE_LABEL_RE.test(label)) return;
                for (const delay of [500, 1500]) {
                    self._resources.timer('inviteClickRetry', () => { if (!self._inviteSuggestionsPatched) self.patchInviteSuggestions(0); }, delay);
                }
            } catch (error) { _recordPatchCatch("InviteMethods._startInviteClickListener.L13526", this, error); }
        };
        this._inviteClickListenerDispose = this._resources.listener('inviteClickRetry', document, "click", this._inviteClickHandler, true);
    }
    _stopInviteClickListener() {
        if (this._inviteClickHandler) {
            this._inviteClickListenerDispose?.();
            this._inviteClickListenerDispose = null;
            this._inviteClickHandler = null;
        }
    }
}

class ObserverMethods {
    _classifyMutationAreas(mutations) {
        const areas = { memberList: false, messages: false, voiceChannels: false, reactions: false, hasRelevantNode: false };
        const memberSel = '[class*="memberRow"], [data-list-id^="members-"], [class*="membersGroup"]';
        const messageSel = `${_SEL.messageRow}, [class*="mention"], [data-list-item-id^="pins__"]`;
        const voiceSel = '[class*="voiceUser"], [class*="stageUser_"], [class*="stageSection_"], [class*="activityPanel"], [class*="streamPreview_"], [class*="callContainer_"], [class*="channelStatus" i], [class*="voiceChannelStatus" i]';
        const reactionSel = '[id^="message-reactions-"], [class*="reactionInner"], [class*="reactorsContainer_"], [class*="reactors_"], [class*="reactionSelected_"], [class*="reactionDefault_"]';
        const chromeContainerSel = '[role="menu"]';
        const overlayContainerSel = '[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="popout"], [class*="popover"]';
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                const tag = node.tagName;
                if (tag === 'LINK' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'META' || tag === 'TITLE') continue;
                if (node.childElementCount === 0 && !node.hasAttributes() && !(node.textContent && node.textContent.trim())) continue;
                areas.hasRelevantNode = true;
                if (!areas.memberList && (node.matches?.(memberSel) || node.querySelector?.(memberSel))) areas.memberList = true;
                if (!areas.messages && (node.matches?.(messageSel) || node.querySelector?.(messageSel))) areas.messages = true;
                if (!areas.voiceChannels && (node.matches?.(voiceSel) || node.querySelector?.(voiceSel))) areas.voiceChannels = true;
                if (!areas.reactions && (node.matches?.(reactionSel) || node.querySelector?.(reactionSel))) areas.reactions = true;
                if (!areas.memberList && !areas.messages && !areas.voiceChannels && !areas.reactions
                    && node.childElementCount >= 8
                    && !(node.matches?.(chromeContainerSel) || node.closest?.(chromeContainerSel)
                        || node.matches?.(overlayContainerSel) || node.closest?.(overlayContainerSel))) {
                    areas.memberList = areas.messages = areas.voiceChannels = areas.reactions = true;
                }
                if (areas.memberList && areas.messages && areas.voiceChannels && areas.reactions) return areas;
            }
        }
        return areas;
    }

    _installVisibilityPause() {
        if (this._visibilityHandler) return;
        this._observersPausedForVisibility = false;
        this._visibilityHandler = () => {
            if (document.hidden) {
                if (this._observersPausedForVisibility) return;
                this._observersPausedForVisibility = true;
                if (this.scanInterval) {
                    this._resources.clearInterval('scanLoop', this.scanInterval);
                    this.scanInterval = null;
                }
                try { this.observer?.disconnect(); } catch (error) { _recordPatchCatch("ObserverMethods._installVisibilityPause.L13598", this, error); }
                try { this._stageObserver?.disconnect(); } catch (error) { _recordPatchCatch("ObserverMethods._installVisibilityPause.L13599", this, error); }
                this._stopStageRootWatch();
            } else {
                if (!this._observersPausedForVisibility) return;
                this._observersPausedForVisibility = false;
                if (!this.isRunning) return;
                try { this._patcher.safe('restartObserver', () => this._restartObserver()); } catch (error) { _recordPatchCatch("ObserverMethods._installVisibilityPause.L13608", this, error); }
                if (!this.scanInterval) this.scanInterval = this._resources.interval('scanLoop', () => this._periodicScanTick(), 4e3);
                try { this.queueScan(); } catch (error) { _recordPatchCatch("visibilityResume.queueScan", this, error); }
            }
        };
        this._visibilityHandlerDispose = this._resources.listener('coreVisibilityPause', document, 'visibilitychange', this._visibilityHandler);
    }
    _stopStageRootWatch() {
        if (this._stageRootWatchInterval) {
            this._resources.clearInterval('stageRootWatch', this._stageRootWatchInterval);
            this._stageRootWatchInterval = null;
        }
    }
    _restartObserver() {
        this._resources.releaseObserver('coreDomObserver', this.observer);
        this._resources.releaseObserver('stageDomObserver', this._stageObserver);
        this._stopStageRootWatch();
        this._cancelObserverFrames();
        this.observer = this._resources.observer('coreDomObserver', new MutationObserver(mutations => this._handleObservedMutations(mutations)));
        if (document.body) this.observer.observe(document.body, { childList: true, subtree: true });
        this._attachStageObserver();
    }
    _cancelObserverFrames() {
        this._resources.disposeScope('coreObserverFrames');
        this._resources.disposeScope('stageObserverFrames');
        this._observerScanFrame = null;
        this._stageScanFrame = null;
    }
    _handleObservedMutations(mutations) {
        if (this._menuPortalActive) {
            try { this._handleMenuPortalMutationBatch(mutations); } catch (error) { _recordPatchCatch("observer.menuPortalMutationBatch", this, error); }
        }
        try { this._surfaces.voice.handleStatusModalMutationBatch(mutations); } catch (error) { _recordPatchCatch("observer.voiceStatusModalMutationBatch", this, error); }
        let areas;
        try {
            areas = this._classifyMutationAreas(mutations);
        } catch (error) {
            _recordPatchCatch("observer.classifyMutationAreas", this, error);
            areas = { memberList: true, messages: true, voiceChannels: true, reactions: true, hasRelevantNode: true };
        }
        if (!areas.hasRelevantNode) return;
        this._lastRelevantMutationAt = Date.now();
        if (this.isRunning && this.settings?.places?.voiceChannels) {
            try { this._surfaces.channelStatus.fastHideFromMutations(mutations); } catch (error) { _recordPatchCatch("observer.fastHideChannelStatus", this, error); }
        }
        if (this.isRunning && this.settings.places?.reactions) {
            try { this._surfaces.reactions.fastHideReactionsFromMutations(mutations); } catch (error) { _recordPatchCatch("observer.fastHideReactions", this, error); }
        }
        if (this.isRunning && (this.settings.places?.messages || this.settings.places?.memberList)) {
            try { this._fastHideFromMutations(mutations, areas); } catch (error) { _recordPatchCatch("observer.fastHide", this, error); }
        }
        if (!this._pendingScanAreas) {
            this._pendingScanAreas = areas;
        } else {
            this._pendingScanAreas.memberList = this._pendingScanAreas.memberList || areas.memberList;
            this._pendingScanAreas.messages = this._pendingScanAreas.messages || areas.messages;
            this._pendingScanAreas.voiceChannels = this._pendingScanAreas.voiceChannels || areas.voiceChannels;
            this._pendingScanAreas.reactions = this._pendingScanAreas.reactions || areas.reactions;
        }
        if (this._observerScanFrame != null) return;
        this._observerScanFrame = this._resources.frame('coreObserverFrames', () => {
            this._observerScanFrame = null;
            if (this.isRunning) this.queueScan(true);
        });
    }
    _attachStageObserver() {
        this._stageObserver = this._resources.observer('stageDomObserver', new MutationObserver(() => {
            if (this._stageScanFrame != null) return;
            this._stageScanFrame = this._resources.frame('stageObserverFrames', () => {
                this._stageScanFrame = null;
                if (!this.isRunning || !this.settings.places?.voiceChannels) return;
                try { this._surfaces.stage.hideStageSpeakerRequests(); }
                catch (error) { _recordPatchCatch("observer.stageSpeakerRequests", this, error); }
            });
        }));
        const _watchStageRoot = () => {
            this._stageObserver?.disconnect();
            const root = document.querySelector('[class*="stageSection_"], [class*="chat_"]');
            if (root) this._stageObserver?.observe(root, { childList: true, subtree: true });
        };
        _watchStageRoot();
        this._stageRootWatchInterval = this._resources.interval('stageRootWatch', _watchStageRoot, 3000);
    }
    _injectGuildSwitchGuard() {
        if (document.getElementById("nmb-guild-switch-guard")) return;
        const style = document.createElement("style");
        style.id = "nmb-guild-switch-guard";
        const voiceTimerRule = this.settings.places.voiceChannels ? `
            [data-list-item-id*="channels"] [class*="timer"],
            [data-list-item-id*="channels"] [class*="voiceTimer"],
            [data-list-item-id*="channels"] [role="timer"],
            [data-list-item-id*="channels"] [class*="tabularNumbers"],
            [class*="voiceChannel"] [class*="timer"],
            [class*="voiceChannel"] [class*="voiceTimer"],
            [class*="voiceChannel"] [role="timer"],
            [class*="voiceChannel"] [class*="tabularNumbers"] {
                visibility: hidden !important;
            }
        ` : "";
        const stageIconGuardRule = this.settings.places.voiceChannels ? `
            [data-list-item-id*="channels"] [class*="iconLive"],
            [class*="voiceChannel"] [class*="iconLive"] {
                color: var(--channels-default) !important;
            }
        ` : "";
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
            ${voiceTimerRule}
            ${stageIconGuardRule}
            
            
        `;
        document.head.appendChild(style);
    }
    _removeGuildSwitchGuard() {
        document.getElementById("nmb-guild-switch-guard")?.remove();
    }
    _patchHistoryApi() {
        try {
            if (this._historyPatchState?.active) return;
            const self = this;
            const state = {
                active: true,
                origPush: history.pushState,
                origReplace: history.replaceState,
                wrappedPush: null,
                wrappedReplace: null
            };
            const notify = () => {
                if (!state.active) return;
                try {
                    self._handleNavigation();
                } catch (e) {
                    self._logThrottled("history:handleNavigation", e);
                }
            };
            const wrap = key => function(...args) {
                const result = state[key].apply(this, args);
                notify();
                return result;
            };
            state.wrappedPush = wrap("origPush");
            state.wrappedReplace = wrap("origReplace");
            history.pushState = state.wrappedPush;
            history.replaceState = state.wrappedReplace;
            this._historyPatchState = state;
        } catch (error) { _recordPatchCatch("navigation.patchHistoryApi", this, error); }
    }
    _unpatchHistoryApi() {
        const state = this._historyPatchState;
        this._historyPatchState = null;
        if (!state) return;
        state.active = false;
        try { if (history.pushState === state.wrappedPush) history.pushState = state.origPush; } catch (error) { _recordPatchCatch("ObserverMethods._unpatchHistoryApi.L13747", this, error); }
        try { if (history.replaceState === state.wrappedReplace) history.replaceState = state.origReplace; } catch (error) { _recordPatchCatch("ObserverMethods._unpatchHistoryApi.L13748", this, error); }
    }
    _restoreLegacyDomGuard() {
        if (typeof Node === "undefined") return;
        const previous = Node.prototype.removeChild;
        if (!previous?.__nmbGuardInstalled) return;
        if (typeof previous.__nmbRestore !== "function" || !previous.__nmbRestore()) {
            throw new Error("An older ByeBlocked DOM guard could not be restored; restart Discord.");
        }
    }
}

class VisibilityMethods {
    _resetShouldHideCache() {
        this._shouldHideCache = this._cacheManager.reset("shouldHide", 5000);
        this._messageFilterCache = new WeakMap();
        this._filteredGroupDmChannelCache = new WeakMap();
        if (this._surfaces?.voice) this._surfaces.voice._voiceStateFilterCache = new WeakMap();
    }

    _placeEnabled(place) {
        return this.settings.places?.[place] !== false;
    }
    _notifEnabled(key) {
        return this.settings.notifications?.[key] !== false;
    }
    shouldHide(userId, isSpammer = false) {
        if (!userId) return false;
        if (isSpammer) return true;
        if (!this._relIsBlockedFn) return false;
        if (this._shouldHideCache?.has(userId)) return this._shouldHideCache.get(userId);
        try {
            let result = false;
            if (this.settings.types.blocked && this._relIsBlockedFn(userId)) result = true;
            else if (this.settings.types.ignored && this._relIsIgnoredFn?.(userId)) result = true;
            if (this._shouldHideCache) this._cacheManager.set("shouldHide", userId, result);
            return result;
        } catch (_) {
            _recordPatchCatch("shouldHide.relationship", this);
            return false;
        }
    }
    _startShortLivedMessageObserver(tryFn, onSuccess) {
        this._stopShortLivedMessageObserver();
        if (typeof tryFn !== "function") return;
        const DEBOUNCE_MS = 150;
        const MAX_LIFETIME_MS = 30000;
        const attempt = () => {
            try {
                if (tryFn()) {
                    this._stopShortLivedMessageObserver();
                    onSuccess?.();
                }
            } catch (error) { _recordPatchCatch("messageObserver.attempt", this, error); }
        };
        try {
            this._shortLivedMsgObserver = this._resources.observer('shortLivedMsgObserver', new MutationObserver(() => {
                this._resources.clearTimer('shortLivedMsgObserver', this._shortLivedMsgObserverDebounce);
                this._shortLivedMsgObserverDebounce = this._resources.timer('shortLivedMsgObserver', attempt, DEBOUNCE_MS);
            }));
            this._shortLivedMsgObserver.observe(document.body, { childList: true, subtree: true });
            this._shortLivedMsgObserverTimeout = this._resources.timer('shortLivedMsgObserver', () => {
                this._stopShortLivedMessageObserver();
            }, MAX_LIFETIME_MS);
        } catch (error) {
            _recordPatchCatch("messageObserver.start", this, error);
            this._stopShortLivedMessageObserver();
        }
    }
    _stopShortLivedMessageObserver() {
        try {
            if (this._shortLivedMsgObserver) {
                this._resources.releaseObserver('shortLivedMsgObserver', this._shortLivedMsgObserver);
                this._shortLivedMsgObserver = null;
            }
            this._resources.clearTimer('shortLivedMsgObserver', this._shortLivedMsgObserverTimeout);
            this._shortLivedMsgObserverTimeout = null;
            this._resources.clearTimer('shortLivedMsgObserver', this._shortLivedMsgObserverDebounce);
            this._shortLivedMsgObserverDebounce = null;
            this._resources.clearTimer('blockedGroupObserver', this._blockedGroupObserverRenewTimeout);
            this._blockedGroupObserverRenewTimeout = null;
        } catch (error) { _recordPatchCatch("VisibilityMethods._stopShortLivedMessageObserver.L13959", this, error); }
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
                this._resources.timer('channelSwitchWatcher', () => {
                    if (!this.isRunning) return;
                    try {
                        if (this.settings.places.messages) {
                            this._surfaces.forums.hideForumPosts();
                            if (!this._blockedMsgGroupPatched) this.patchBlockedMessageGroup(0);
                            if (!this._messagesWrapPatched) this.patchMessagesWrapComponent(0);
                        }
                        if (this.settings.places.memberList) this._surfaces.members.hideMemberRows();
                        if (this.settings.places.groupDms || this.settings.places.messages) this._surfaces.groupDms.hidePrivateChannels();
                        if (this.settings.places.reactions) {
                            this._surfaces.reactions.scan();
                        }
                    } catch (error) { _recordPatchCatch("channelSwitch.scan", this, error); }
                }, delays[d]);
            }
            this._resources.timer('channelSwitchWatcher', () => {
                if (!this.isRunning) return;
                if (this._isNavigating) return;
                if (this._navStartedAt && (Date.now() - this._navStartedAt < 1200)) return;
                try { this.restoreUnhiddenElements(); } catch (error) { _recordPatchCatch("channelSwitch.restoreElements", this, error); }
            }, 900);
        };
        store.addChangeListener(this._channelSwitchChangeHandler);
        this._resources.onDispose('coreStoreListeners', () => {
            try { store.removeChangeListener?.(this._channelSwitchChangeHandler); } catch (error) { _recordPatchCatch("VisibilityMethods._startChannelSwitchWatcher.L13997", this, error); }
        });
    }
    queueRefresh() {
        this._resources.clearTimer('refresh', this.refreshTimeout);
        this.refreshTimeout = this._resources.timer('refresh', () => {
            this._surfaces.pins.revalidateActiveChannelPins();
            if (!this._isNavigating && !(this._navStartedAt && (Date.now() - this._navStartedAt < 1200))) this.restoreUnhiddenElements();
            this.queueScan();
        }, 10);
    }
    _hasBlockedUserInSample(selector, maxSample = 40) {
        try {
            const elements = document.querySelectorAll(selector);
            let sample = 0;
            for (let i = 0; i < elements.length && sample < maxSample; i++) {
                const element = elements[i];
                if (element.dataset?.hiddenBlocked === "true") continue;
                sample++;
                const userId = this.findUserId(element);
                if (userId && this.shouldHide(userId)) return true;
            }
        } catch (error) { _recordPatchCatch("health.sampleBlockedUser", this, error); }
        return false;
    }
    _registerHealthChecks() {
        if (!this._health) return;
        this._runSurfacePhase('registerHealthChecks', 'members', 'messages', 'forums', 'stage', 'call', 'reactions', 'voice', 'groupDms', 'autocomplete', 'events', 'pins');



        this._health.start();
    }
    _sweepOrphanedScrollMasks() {
        try {
            const now = Date.now();
            if (this._lastOrphanMaskSweep && now - this._lastOrphanMaskSweep < 3000) return;
            this._lastOrphanMaskSweep = now;
            const orphans = document.querySelectorAll('[data-nmb-scroll-masked="true"]');
            orphans.forEach(el => {
                try {
                    el.style.visibility = el.dataset.nmbPrevVisibility || "";
                    delete el.dataset.nmbScrollMasked;
                    delete el.dataset.nmbPrevVisibility;
                } catch (error) { _recordPatchCatch("scrollMask.restoreOrphan", this, error); }
            });
        } catch (error) { _recordPatchCatch("scrollMask.sweepOrphans", this, error); }
    }
    get scanInFlight() { return !!(this.scanTimeout || this.scanFrame); }
    _periodicScanTick() {
        try {
            const OBSERVER_RECENT_WINDOW_MS = 6000;
            const observerAlive = !!this.observer;
            const observerRecentlyFired = observerAlive
                && !!this._lastRelevantMutationAt
                && (Date.now() - this._lastRelevantMutationAt) < OBSERVER_RECENT_WINDOW_MS;
            if (observerRecentlyFired) {
                this._watchdogCheck();
                return;
            }
        } catch (error) { _recordPatchCatch("coordination.periodicScanTick", this, error); }
        this.queueScan();
    }
    queueScan(fromMutation = false) {
        if (!this.isRunning || this.scanInFlight) return;
        this._watchdogCheck();
        this._sweepOrphanedScrollMasks();
        const now = Date.now();
        if (this._lastScanDomTime && now - this._lastScanDomTime < 80) {
            this.scanTimeout = this._resources.timer('queueScan', () => {
                this.scanTimeout = null;
                this._lastScanDomTime = Date.now();
                const areas = this._pendingScanAreas;
                this._pendingScanAreas = null;
                this.scanDom(fromMutation, areas);
            }, 80);
            return;
        }
        this.scanFrame = this._resources.frame('queueScan', () => {
            this.scanFrame = null;
            this._lastScanDomTime = Date.now();
            const areas = this._pendingScanAreas;
            this._pendingScanAreas = null;
            this.scanDom(fromMutation, areas);
        });
    }
    _watchdogCheck() {
        try {
            if (!this.isRunning) return;
            const now = Date.now();
            if (this._lastWatchdog && now - this._lastWatchdog < 3e4) return;
            this._lastWatchdog = now;
            if (this._storePatchRetryNeeded) {
                this._patcher.safe("watchdog:retryStorePatches", () => this.patchStores());
            }
            const relStore = this.modules.RelationshipStore;
            const storeBroken = !relStore || typeof relStore.isBlocked !== "function";
            const observerBroken = !this.observer;
            const dispatcherBroken = !this.modules.Dispatcher || typeof this.modules.Dispatcher.dispatch !== "function";
            const notificationPatchMissing = !dispatcherBroken && (!this._notificationDispatcherPatched
                || this._notificationDispatcherPatchTarget !== this.modules.Dispatcher
                || this._notificationDispatcherPatchedMethod !== this.modules.Dispatcher.dispatch);
            const notificationHealthMissing = !!this._notificationDispatcherPatched && !!this._health && !this._health.checks?.dispatcherPatch;
            const messageHealthMissing = !!this._storePatched && !!this._health && !this._health.checks?.messageFilterEffectiveness;
            const memberStoreInstanceDrifted = !!this.settings.places?.memberList
                && !this._surfaces.members.isGuildMemberStorePatchCurrent();
            const msgStoreMethodDrifted = !!this.settings.places?.messages && !!this._storePatched
                && this._messageStorePatchTarget === this.modules.MessageStore && this._hasMessageStoreMethodDrift();
            const msgStoreBroken = !this._rawGetMessages && (!this.modules.MessageStore || typeof this.modules.MessageStore.getMessages !== "function");
            const msgStoreInstanceDrifted = !!this.modules.MessageStore
                && !!this._rawGetMessagesSourceStore
                && this._rawGetMessagesSourceStore !== this.modules.MessageStore;
            const relationshipListenerMissing = !storeBroken && !this._relationshipUpdatesPatched;
            const voiceStoreBroken = !this.modules.SortedVoiceStateStore || typeof this.modules.SortedVoiceStateStore.getVoiceStatesForChannel !== "function";
            const mediaEngineBroken = !this.modules.MediaEngineActions || (!this._localVolumeKey && !this._localMuteKey);
            const rtcModulesBroken = !this.modules.RTCConnectionUtils || !this.modules.RTCParticipantsModule;
            if (storeBroken || observerBroken || dispatcherBroken || msgStoreBroken || msgStoreInstanceDrifted || msgStoreMethodDrifted || voiceStoreBroken || mediaEngineBroken || rtcModulesBroken || notificationPatchMissing || notificationHealthMissing || messageHealthMissing || memberStoreInstanceDrifted || relationshipListenerMissing) {
                if (notificationPatchMissing) { this._patcher.safe("watchdog:patchNotificationDispatcher", () => this._patchNotificationDispatcher()); }
                if (storeBroken) { this._patcher.safe("watchdog:resolveModules", () => this.resolveModules()); }
                if (dispatcherBroken) { this._patcher.safe("watchdog:resolveDispatcher", () => this._resolveDispatcher()); }
                if (this.modules.Dispatcher && typeof this.modules.Dispatcher.dispatch === "function"
                    && (!this._notificationDispatcherPatched || this._notificationDispatcherPatchTarget !== this.modules.Dispatcher
                        || this._notificationDispatcherPatchedMethod !== this.modules.Dispatcher.dispatch)) {
                    this._patcher.safe("watchdog:patchResolvedDispatcher", () => this._patchNotificationDispatcher());
                }
                if (notificationHealthMissing) { this._patcher.safe("watchdog:dispatcherHealth", () => this._registerDispatcherPatchHealthCheck()); }
                if (messageHealthMissing) { this._patcher.safe("watchdog:messageHealth", () => this._registerMessageFilterEffectivenessHealthCheck()); }
                if (memberStoreInstanceDrifted) { this._patcher.safe("watchdog:memberStoreDrift", () => this._surfaces.members.patchGuildMemberStore()); }
                if (msgStoreBroken) { this._patcher.safe("watchdog:resolveMessagesGet", () => this._resolveMessagesGet()); }
                if (msgStoreInstanceDrifted || msgStoreMethodDrifted) {
                    this._patcher.safe("watchdog:msgStoreDrift", () => {
                        this._storePatched = false;
                        this._rawGetMessages = null;
                        this._rawGetMessagesSourceStore = null;
                        this._resolveMessagesGet();
                        this.patchMessageStore();
                    });
                }
                if (observerBroken || storeBroken) { this._patcher.safe("watchdog:restartObserver", () => this._restartObserver()); }
                if (voiceStoreBroken) { this._patcher.safe("watchdog:resolveVoiceStores", () => { this.resolveModules(); this.patchStores(); }); }
                if (mediaEngineBroken) { this._patcher.safe("watchdog:resolveMediaEngine", () => this._resolveMediaEngineActions()); }
                if (rtcModulesBroken && !storeBroken && !voiceStoreBroken) { this._patcher.safe("watchdog:resolveRtcModules", () => this._resolveRtcModules()); }
                if (relationshipListenerMissing) {
                    const lastAttempt = this._relationshipListenerRevivalAttemptAt || 0;
                    if (now - lastAttempt >= 5 * 60 * 1000) {
                        this._relationshipListenerRevivalAttemptAt = now;
                        this._patcher.safe("watchdog:patchRelationshipUpdates", () => this.patchRelationshipUpdates());
                    }
                }
            }
            this._trackCriticalDegradation({ storeBroken, msgStoreBroken });
        } catch (e) {
            this._logThrottled("watchdog", e);
        }
    }
    _trackCriticalDegradation({ storeBroken, msgStoreBroken }) {
        if (!this._criticalDegradation) {
            this._criticalDegradation = {
                storeBroken: { streak: 0, notified: false, lastNoticeAt: 0 },
                msgStoreBroken: { streak: 0, notified: false, lastNoticeAt: 0 }
            };
        }
        const state = this._criticalDegradation;
        const CONSECUTIVE_FAILS_BEFORE_NOTICE = 3;
        const NOTICE_COOLDOWN_MS = 10 * 60 * 1000;

        const evaluate = (key, isBroken, label) => {
            const entry = state[key];
            if (isBroken) {
                entry.streak++;
                if (entry.streak >= CONSECUTIVE_FAILS_BEFORE_NOTICE) {
                    const now = Date.now();
                    if (!entry.notified || (now - entry.lastNoticeAt) >= NOTICE_COOLDOWN_MS) {
                        entry.notified = true;
                        entry.lastNoticeAt = now;
                        try {
                            this.toast(`ByeBlocked: ${label} stopped responding. Protection may be incomplete until Discord reloads or the plugin is updated.`, "error");
                        } catch (error) { _recordPatchCatch("health.showDegradationNotice", null, error); }
                        try { this.logger?.error(`Sustained critical degradation: ${label} (streak=${entry.streak})`); } catch (_) {}
                    }
                }
            } else {
                if (entry.notified) {
                    try { this.toast(`ByeBlocked: ${label} is back to normal.`, "success"); } catch (error) { _recordPatchCatch("health.showRecoveryNotice", null, error); }
                }
                entry.streak = 0;
                entry.notified = false;
            }
        };

        evaluate("storeBroken", storeBroken, "blocked user detection (RelationshipStore)");
        evaluate("msgStoreBroken", msgStoreBroken, "message filtering (MessageStore)");
    }
}

class DomScanMethods {
    _handleMenuPortalMutationBatch(mutations) {
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                const reactionMenuSelector = "#message-actions-reactions, #message-remove-emoji-reactions, #message-remove-reactions, #message-reactions";
                const menuItem = node.matches?.(reactionMenuSelector) ? node : node.querySelector?.(reactionMenuSelector);
                if (menuItem) {
                    try {
                        if (this.settings.places.reactions) this._surfaces.reactions.hideViewReactionsMenuItem();
                    } catch (error) { _recordPatchCatch("menuPortal.hideReactionsItem", this, error); }
                }
                if (this.settings.places.messages) {
                    try {
                        const popoverRoot = this._surfaces.forums.findActivePostsPopoverRoot(node);
                        const looksLikeActivePosts = !!popoverRoot && (
                            popoverRoot.querySelector(_SEL.rowEl)
                            || [ "Mais postagens ativas", "More active posts", "Postagens ativas" ]
                                .some(s => (popoverRoot.textContent || "").includes(s))
                        );
                        if (popoverRoot && looksLikeActivePosts) {
                            this._surfaces.forums.hideActivePostsPopover(popoverRoot);
                            this._surfaces.forums.watchActivePostsPopoverContent(popoverRoot);
                            for (const delay of [ 0, 50, 150, 300 ]) {
                                this._resources.timer('menuPortal', () => {
                                    if (document.contains(popoverRoot)) this._surfaces.forums.hideActivePostsPopover(popoverRoot);
                                }, delay);
                            }
                        }
                    } catch (error) { _recordPatchCatch("menuPortal.activePostsPopover", this, error); }
                }
                const isReactorsModal = node.matches?.('[role="dialog"], [class*="reactorsContainer_"], [class*="reactors_"]') || node.querySelector?.(_SEL.reactorsContainers);
                if (isReactorsModal && this.settings.places.reactions) {
                    const modalRoot = node.matches?.('[role="dialog"]') ? node : node.closest?.('[role="dialog"]') || node;
                    this._surfaces.reactions.watchReactorsModalContent(modalRoot);
                    this._surfaces.reactions.scheduleReactorModalPass();
                }
                if (this.settings.places?.reactions) {
                    try {
                        const menuRoot = node.matches?.('[role="menu"]') ? node : node.querySelector?.('[role="menu"]');
                        if (menuRoot) this._surfaces.reactions.watchContextMenuContent(menuRoot);
                    } catch (error) { _recordPatchCatch("menuPortal.reactionContextMenu", this, error); }
                }
            }
        }
    }
    _startMenuPortalObserver() {
        this._menuPortalActive = true;
    }
    _trackTransientObserver(observer) {
        this._resources.observer('transient', observer);
        return () => this._resources.releaseObserver('transient', observer);
    }
    _fastHideFromMutations(mutations, affectedAreas = null) {
        const previousScrollState = this._messageScrollBatchState || null;
        const scrollState = this.settings.places?.messages && affectedAreas?.messages
            ? this._captureMessageScrollState()
            : null;
        if (scrollState) this._messageScrollBatchState = scrollState;
        try {
            return this._fastHideFromMutationsRaw(mutations);
        } finally {
            this._messageScrollBatchState = previousScrollState;
            if (scrollState) this._restoreMessageScrollState(scrollState);
        }
    }
    _fastHideMutationCandidates(node, selector) {
        let messagesHidden = false;
        if (node.matches?.(selector)) {
            const wasHidden = this.hiddenElements.size;
            this._fastHideNode(node);
            if (this.hiddenElements.size > wasHidden) messagesHidden = true;
        }
        const qsa = node.querySelectorAll;
        if (qsa) {
            const descendants = qsa.call(node, selector);
            for (let d = 0; d < descendants.length; d++) {
                const before = this.hiddenElements.size;
                this._fastHideNode(descendants[d]);
                if (this.hiddenElements.size > before) messagesHidden = true;
            }
        }
        return messagesHidden;
    }

    _fastHideMutationSurfaceChecks(node, places) {
        let voiceScanNeeded = false;
        if (node.matches?.('[data-list-id="pins"], [data-list-id*="pins"]') || node.querySelector?.('[data-list-id="pins"], [data-list-id*="pins"]')) {
            try {
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                if (channelId) this._surfaces.pins.scanExistingPinsForChannel(channelId);
                this._surfaces.pins.hidePinnedMessages();
                this._surfaces.pins.fixPinNotificationBadge();
            } catch (error) { _recordPatchCatch("fastHide.mutations.pins", this, error); }
        }
        if (node.matches?.('[class*="mainCard_"]') || node.querySelector?.('[class*="card_"]') || node.matches?.('[data-list-id^="forum-channel-list-"]')) {
            this._surfaces.forums.hideForumPosts();
            this._surfaces.forums.scheduleForumRetry();
        }
        if (node.matches?.('[class*="container_"]') && this._surfaces.forums.isCurrentChannelForumOrThread()) this._surfaces.forums.hideTopicPanelItems();
        if (node.matches?.(_SEL.privateChannelRow) || node.closest?.(_SEL.privateChannelRow)) this._surfaces.groupDms.hidePrivateChannels();
        if (places.memberList && (node.matches?.(_SEL.memberRow) || node.querySelector?.(_SEL.memberRow))) {
            this._surfaces.members.hideMemberRows();
        }
        if (places.memberList && (node.matches?.(_SEL.memberListContainer) || node.querySelector?.(_SEL.memberListContainer))) {
            const _container = node.matches?.(_SEL.memberListContainer) ? node : node.querySelector(_SEL.memberListContainer);
            if (_container) {
                try {
                    const _items = _container.querySelectorAll('[data-list-item-id]');
                    for (const _item of _items) {
                        if (_item.dataset?.hiddenBlocked !== "true") this._fastHideNode(_item);
                    }
                } catch (error) { _recordPatchCatch("fastHide.mutations.memberRows", this, error); }
            }
        }
        if (places.events) {
            const eventsSidebarItem = node.matches?.('[data-list-item-id^="channels___upcoming-events-"]') ? node : node.querySelector?.('[data-list-item-id^="channels___upcoming-events-"]');
            if (eventsSidebarItem) {
                try { this._surfaces.events.fixEventsSidebarCounterFor(eventsSidebarItem); } catch (error) { _recordPatchCatch("fastHide.mutations.eventsCounter", this, error); }
            }
            if (node.matches?.('[data-list-item-id^="channels___guild_scheduled_event-"]') || node.querySelector?.('[data-list-item-id^="channels___guild_scheduled_event-"]')) {
                try { this._surfaces.events.hideSidebarEventItems(); } catch (error) { _recordPatchCatch("fastHide.mutations.events", this, error); }
            }
            if (node.matches?.(_SEL.channelNotice) || node.querySelector?.(_SEL.channelNotice)) {
                try { this._surfaces.stage.hideBlockedStageChannelNotice(); } catch (error) { _recordPatchCatch("fastHide.mutations.stageNotice", this, error); }
            }
            if ((node.matches?.('[class*="upperBadge_"]') && node.closest?.('[data-list-item-id^="guildsnav___"]'))
                || node.querySelector?.('[data-list-item-id^="guildsnav___"] [class*="upperBadge_"]')) {
                try { this._surfaces.stage.hideBlockedGuildStageBadge(); } catch (error) { _recordPatchCatch("fastHide.mutations.stageBadge", this, error); }
            }
        }
        if (places.voiceChannels) {
            const voiceSel = '[class*="voiceUser"],[class*="stageUser_"],[class*="stageSection_"],[class*="activityPanel_"],[class*="activityPanel"],[class*="streamPreview_"],[class*="streamTile_"],[class*="tile_"],[class*="tileSizer_"],[class*="videoWrapper_"],[class*="participantWrapper_"],[class*="gridLayout_"],[class*="callContainer_"],[class*="audienceContainer__"],[class*="raisedHandCount__"],[class*="toolbar__"],[class*="details_"],[class*="speakerCount__"],[class*="blockedNotice__"],[class*="channelNotice__"],[class*="subtitle__"]';
            const voiceAriaSel = _VOICE_CHANNEL_ARIA_LABEL_SEL;
            if (node.matches?.(voiceSel) || node.querySelector?.(voiceSel) || node.matches?.(voiceAriaSel) || node.querySelector?.(voiceAriaSel)) {
                voiceScanNeeded = true;
            }
        }
        return voiceScanNeeded;
    }

    _fastHideFromMutationsRaw(mutations) {
        const places = this.settings.places;
        const fastHideCandidateSelector = `${_SEL.messageRow}, [data-list-item-id^="pins__"], [class*="memberRow"], [role="listitem"][data-list-item-id], [data-list-id^="members-"] [data-list-item-id], [class*="voiceUser"], [class*="mention"], ${_SEL.blockedMessage}, [class*="groupStart"]`;
        let messagesHidden = false;
        let voiceScanNeeded = false;
        for (let m = 0; m < mutations.length; m++) {
            const added = mutations[m].addedNodes;
            for (let n = 0; n < added.length; n++) {
                const node = added[n];
                if (node.nodeType !== 1) continue;
                const tag = node.tagName;
                if (tag === 'LINK' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'META' || tag === 'TITLE') continue;
                if (node.matches?.('[role="menu"]')) continue;
                if (this._fastHideMutationCandidates(node, fastHideCandidateSelector)) messagesHidden = true;
                if (node.children?.length === 0 && !node.classList?.length) continue;
                const tagLC = tag === 'DIV' || tag === 'LI';
                if (!tagLC && !node.children?.length) continue;
                voiceScanNeeded = this._fastHideMutationSurfaceChecks(node, places) || voiceScanNeeded;
            }
        }
        if (voiceScanNeeded) {
            try { this.hideVoiceUsers(); } catch (error) { _recordPatchCatch("fastHide.mutations.voiceScan", this, error); }
        }
        if (messagesHidden && places.messages) {
            try { this._surfaces.messages.hideOrphanedDividers(); } catch (error) { _recordPatchCatch("fastHide.mutations.orphanedDividers", this, error); }
        }
    }
    _fastHideMemberOrVoiceRow(el) {
        if (this.settings.places.memberList && el.matches?.(_SEL.memberRow)) {
            const userId = this.findUserId(el);
            if (userId && this.shouldHide(userId)) {
                this.hideElement(el, "fast-guild-member-row", userId);
                try {
                    this._surfaces.members.fixGuildMembersPageCount();
                } catch (error) { _recordPatchCatch("fastHide.member.guildCount", this, error); }
                return true;
            }
        }
        if (
            this.settings.places.memberList &&
            (el.matches?.('[role="listitem"][data-list-item-id]') ||
                (el.matches?.('[data-list-item-id]') && !el.matches?.('[role="listitem"]') && el.closest?.(_SEL.memberListContainer)))
        ) {
            const listId = el.dataset?.listItemId || "";
            const looksLikeMemberItem = /^\d{17,20}$/.test(listId.split(/[_-]+/).pop() || "") || /^members?[_-]/.test(listId);
            if (looksLikeMemberItem) {
                const userId = this.findUserId(el);
                if (userId && this.shouldHide(userId)) {
                    this.hideElement(el, "fast-sidebar-member-row", userId);
                    try {
                        this._surfaces.members.fixMemberGroupCounts();
                    } catch (error) { _recordPatchCatch("fastHide.member.groupCount", this, error); }
                    return true;
                }
            }
        }
        if (this.settings.places.voiceChannels && el.matches?.(_SEL.voiceUser)) {
            const userId = this.findUserId(el);
            if (userId && this.shouldHide(userId)) {
                const row = el.closest('[class*="draggable__"]') || el.closest("li") || el;
                if (!this._surfaces.voice.isVoiceChannelShell(row)) this.hideElement(row, "fast-voice-user", userId); else this.hideElement(el, "fast-voice-user", userId);
                try {
                    this._surfaces.voice.fixVoiceCounters();
                    this._surfaces.members.fixMemberGroupCounts();
                } catch (error) { _recordPatchCatch("fastHide.voice.counters", this, error); }
                return true;
            }
        }
        return false;
    }

    _fastHidePinCard(el) {
        if (el.matches?.(_SEL.pinCard) || el.querySelector?.(_SEL.pinCard)) {
            const pinCard = el.matches?.(_SEL.pinCard) ? el : el.querySelector(_SEL.pinCard);
            if (pinCard && pinCard.dataset?.hiddenBlocked !== "true") {
                const userId = this.findUserId(pinCard);
                const listId = pinCard.dataset?.listItemId || "";
                const pinMatch = listId.match(/^pins_+(\d{17,20})$/);
                const messageId = pinMatch ? pinMatch[1] : null;
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                const pinsItems = channelId ? this.modules.ChannelPinsStore?.getPins?.(channelId)?.items || [] : [];
                const shouldHideByAuthor = userId && this.shouldHide(userId);
                const pinItem = messageId && pinsItems.length ? pinsItems.find(item => item?.message?.id === messageId) || null : null;
                const shouldHideByPinner = messageId && this._surfaces.pins.shouldHidePinnedMessage(channelId, messageId, pinItem);
                if (shouldHideByAuthor || shouldHideByPinner) {
                    this.hideElement(pinCard, shouldHideByAuthor ? "fast-pin-author" : "fast-pin-by-blocked", shouldHideByAuthor ? userId : false);
                    const wrapper = pinCard.closest(_SEL.messageGroupWrapper);
                    if (wrapper && wrapper.dataset?.hiddenBlocked !== "true") {
                        const siblingCards = Array.from(wrapper.querySelectorAll(_SEL.pinCard));
                        if (siblingCards.every(card => card.dataset?.hiddenBlocked === "true")) {
                            this.hideElement(wrapper, "pinned-panel-residue", false);
                        }
                    }
                }
                if (channelId && !this._pinsCleanupThrottled) {
                    this._pinsCleanupThrottled = true;
                    requestAnimationFrame(() => {
                        this._pinsCleanupThrottled = false;
                        try { this._surfaces.pins.hidePinnedMessages(); } catch (error) { _recordPatchCatch("fastHide.pins.cleanup", this, error); }
                    });
                }
            }
        }
    }

    _fastHideBlockedMessageGroup(el) {
        const hasBlockedClass = this._placeEnabled("messages") && this._shouldFastHideMessagesInDom() && (el.matches?.(_SEL.blockedMessage) || el.querySelector?.(_SEL.blockedMessage));
        if (hasBlockedClass) {
            const items = new Set;
            const collectTargets = node => {
                const blocked = node.matches?.(_SEL.blockedMessage) ? [node] : Array.from(node.querySelectorAll?.(_SEL.blockedMessage) || []);
                for (const b of blocked) {
                    let t = b.closest?.(_SEL.messageItem) || b.closest?.('[role="article"]') || b.closest?.('[class*="wrapper_"]') || b;
                    const gs = t.closest?.('[class*="groupStart"]');
                    if (gs) t = gs;
                    items.add(t);
                }
            };
            collectTargets(el);
            for (const item of items) {
                if (item.dataset?.hiddenBlocked !== "true") this.hideElement(item, "blocked-group-fast");
            }
            return true;
        }
        return false;
    }

    _getFastReplyBlockInfo(messageRow, replyBar) {
        const replyMention = replyBar.querySelector("[data-user-id]");
        const replyUserId = replyMention?.dataset?.userId || this.findUserId(replyBar);
        let referencedAuthorId = null;
        try {
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            const listId = messageRow.dataset?.listItemId || "";
            const msgId = listId.match(/(\d{17,20})$/)?.[1];
            if (msgId && channelId) {
                const msg = this.modules.MessageStore?.getMessage?.(channelId, msgId);
                if (msg?.messageReference) {
                    const ref = this.getReferencedMessage(msg);
                    if (ref?.author?.id) referencedAuthorId = ref.author.id;
                }
            }
        } catch (error) { _recordPatchCatch("fastHide.message.referencedAuthor", this, error); }
        if (!referencedAuthorId) {
            this._identity.walkFiberShallow(messageRow, props => {
                if (referencedAuthorId) return;
                if (props.referencedMessage?.message?.author?.id) referencedAuthorId = props.referencedMessage.message.author.id;
                else if (props.referencedMessage?.author?.id) referencedAuthorId = props.referencedMessage.author.id;
                else if (props.message?.messageReference && !referencedAuthorId) {
                    const ref = this.getReferencedMessage(props.message);
                    if (ref?.author?.id) referencedAuthorId = ref.author.id;
                }
            });
        }
        const isBlocked = (replyUserId && this.shouldHide(replyUserId))
            || (referencedAuthorId && this.shouldHide(referencedAuthorId))
            || replyBar.matches(_SEL.blockedMessage)
            || (!referencedAuthorId && this.isBlockedMessageBannerText(replyBar.textContent || ""));
        return isBlocked ? { userId: referencedAuthorId || replyUserId || null } : null;
    }
    _findFastMentionedBlockedUserId(messageRow, mentionWithId, mentionElem) {
        let mentionedId = mentionWithId?.dataset?.userId || (mentionWithId ? this.findUserId(mentionWithId) : null);
        if (!mentionedId && mentionElem?.dataset?.nmbMentionUserId) mentionedId = mentionElem.dataset.nmbMentionUserId;
        if (!mentionedId && mentionElem) {
            try {
                const listId = messageRow.dataset?.listItemId || messageRow.id || "";
                const idMatch = listId.match(/(\d{17,20})$/) || messageRow.id?.match(/chat-messages-(?:\d+-)?(\d{17,20})$/);
                const messageId = idMatch ? idMatch[1] : null;
                const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
                const getMessage = this.modules.MessageStore?.getMessage;
                const msg = channelId && messageId && typeof getMessage === "function" ? getMessage(channelId, messageId) : null;
                const mentions = msg?.mentions;
                if (mentions) {
                    const list = Array.isArray(mentions) ? mentions : Array.from(mentions);
                    for (const user of list) {
                        const id = typeof user === "string" ? user : user?.id;
                        if (id && this.shouldHide(id)) { mentionedId = id; break; }
                    }
                }
            } catch (error) { _recordPatchCatch("fastHide.message.mentionAuthor", this, error); }
        }
        return mentionedId;
    }
    _fastHideMessageRow(el) {
        if (this.settings.places.messages && this._shouldFastHideMessagesInDom() && (el.matches?.(_SEL.messageRow))) {
            const messageRow = el;
            if (messageRow.dataset?.hiddenBlocked === "true") return true;
            const userId = this.findUserId(messageRow);
            if (userId && this.shouldHide(userId)) {
                this.hideElement(messageRow, "fast-message", userId);
                return true;
            }
            const replyBar = messageRow.querySelector('[class*="repliedMessage"], [class*="replyBar"], [class*="messageReference"]');
            if (replyBar && (this._placeEnabled("repliesToBlocked") || this._placeEnabled("replies"))) {
                const blockedReply = this._getFastReplyBlockInfo(messageRow, replyBar);
                if (blockedReply) {
                    if (this._placeEnabled("repliesToBlocked")) {
                        this.hideElement(messageRow, "fast-reply-to-blocked", blockedReply.userId);
                        return true;
                    }
                    if (this._placeEnabled("replies")) {
                        try {
                            this.hideElement(replyBar, "reply-preview", blockedReply.userId);
                        } catch (error) { _recordPatchCatch("fastHide.message.replyPreview", this, error); }
                    }
                }
            }
            const mentionWithId = messageRow.querySelector?.('[class*="mention"][data-user-id]');
            const mentionElem = mentionWithId || messageRow.querySelector?.('[class*="mention"]');
            const mentionedId = this._findFastMentionedBlockedUserId(messageRow, mentionWithId, mentionElem);
            if (mentionedId && this._placeEnabled("mentions") && this.shouldHide(mentionedId)) {
                this.hideElement(messageRow, "fast-mention", mentionedId);
                return true;
            }
            const text = messageRow.textContent;
            if (text && this.isBlockedMessageBannerText(text)) {
                this.hideElement(messageRow, "blocked-group-fast");
                return true;
            }
        }
        return false;
    }

    _fastHideNode(el) {
        if (!el || el.nodeType !== 1) return;
        if (el.dataset?.hiddenBlocked === "true") return;
        if (el.dataset?.nmbGhost === "true") return;
        if (this._fastHideMemberOrVoiceRow(el)) return;
        this._fastHidePinCard(el);
        if (this._fastHideBlockedMessageGroup(el)) return;
        if (this._fastHideMessageRow(el)) return;
        if (el.matches?.('[class*="mention"]')) {
            this._surfaces.messages.hideSingleMention(el);
        }
    }
    _scanDomMutationPath(affectedAreas) {
        const areas = affectedAreas || { memberList: true, messages: true, voiceChannels: true, reactions: true };
        if (this.settings.places?.messages && areas.messages) this._surfaces.messages.hideMentionsEverywhere();
        if (this._placeEnabled("inbox") && areas.messages) this._surfaces.messages.hideInboxBlockedItems();
        if (this.settings.places?.memberList && areas.memberList) this._surfaces.members.scanCounts();
        if (this.settings.places?.voiceChannels && areas.voiceChannels) {
            this._surfaces.voice.fixVoiceChannelIconColors();
            this._surfaces.channelStatus.resyncBlockedChannelStatuses();
        }
        if (this.settings.places?.messages && areas.messages) {
            this._surfaces.messages.hideOrphanedDividers();
            this._surfaces.messages.promoteOrphanedMessages();
        }
        if (this.settings.places?.reactions && areas.reactions) {
            this._surfaces.reactions.scan();
        }
        if ((this.settings.places?.groupDms || this.settings.places?.messages || this._placeEnabled("channelList")) && (areas.messages || areas.memberList)) {
            this._surfaces.groupDms.hidePrivateChannels();
        }
    }

    _scanDomFullPath() {
        const p = this.settings.places;
        if (p.voiceChannels) this.hideVoiceUsers();
        if (p.voiceChannels && !this._surfaces.call.callGridPatched) {
            try { this._surfaces.call.patchCallGridParticipants(); }
            catch (error) { _recordPatchCatch("scanFull.callGridPatch", this, error); }
        }
        if (p.memberList) this._surfaces.members.scan();
        if (p.messages) {
            this._surfaces.pins.hidePinnedMessages();
            if (this._surfaces.forums.enabled()) this._surfaces.forums.scan();
            this._surfaces.pins.fixPinNotificationBadge();
        }
        if (this._surfaces.groupDms.enabled()) this._surfaces.groupDms.scan();
        if (p.autocomplete) this._surfaces.autocomplete.scan();
        if (p.reactions) this._surfaces.reactions.scan();
        if (p.events) {
            this._surfaces.events.scan();
            this._surfaces.stage.hideBlockedStageChannelNotice();
            this._surfaces.stage.hideBlockedGuildStageBadge();
        }
        if (p.messages) {
            this._surfaces.messages.hideMentionsEverywhere();
            this._surfaces.messages.hideOrphanedDividers();
            this._surfaces.messages.promoteOrphanedMessages();
        }
        if (this._placeEnabled("inbox")) this._surfaces.messages.hideInboxBlockedItems();
        if (p.memberList) this._surfaces.members.scanCounts();
        if (p.voiceChannels) {
            this._surfaces.voice.fixVoiceChannelIconColors();
            this._surfaces.channelStatus.resyncBlockedChannelStatuses();
        }
    }

    scanDom(fromMutation = false, affectedAreas = null) {
        return this._scanDomMeasuredBody(fromMutation, affectedAreas);
    }
    _scanDomMeasuredBody(fromMutation = false, affectedAreas = null) {
        const willTouchMessages = fromMutation
            ? !!this.settings.places?.messages && (!affectedAreas || affectedAreas.messages !== false)
            : !!this.settings.places?.messages;
        const scrollState = willTouchMessages ? this._captureMessageScrollState() : null;
        const previousScrollState = this._messageScrollBatchState || null;
        if (scrollState) this._messageScrollBatchState = scrollState;
        try {
            const navCooldown = this._navStartedAt && (Date.now() - this._navStartedAt < 1200);
            if (!this._isNavigating && !navCooldown) this.restoreUnhiddenElements();
            if (fromMutation) this._scanDomMutationPath(affectedAreas);
            else this._scanDomFullPath();
        } catch (e) {
            this._logThrottled("scanDom", e);
        }
        finally {
            this._messageScrollBatchState = previousScrollState;
            if (scrollState) this._restoreMessageScrollState(scrollState);
        }
    }

    restoreParent(el) {
        if (!el) return;
        const previous = el.getAttribute(_ATTR.prevStyle);
        if (previous) el.setAttribute("style", previous); else el.removeAttribute("style");
        delete el.dataset.hiddenBlocked;
        delete el.dataset.nmbReason;
        delete el.dataset.nmbParentHidden;
        el.removeAttribute(_ATTR.prevStyle);
        this.hiddenParents.delete(el);
    }
    _restoreSpecialHiddenElement(el) {
        if (el.dataset?.nmbMentionHidden === "true") {
            const uid = el.dataset?.nmbMentionUserId;
            if (uid && !this.shouldHide(uid)) this._surfaces.messages.restoreHiddenMention(el);
            return true;
        }
        const reason = el.dataset?.nmbReason;
        if (reason === "blocked-ringing-overlay") {
            this.restoreElement(el);
            const wrapper = el.closest('[class*="wrapper_"]');
            if (wrapper) {
                delete wrapper.dataset.nmbRingingCollapsed;
                const prev = wrapper.getAttribute(_ATTR.prevRingingStyle);
                if (prev) wrapper.setAttribute("style", prev); else wrapper.removeAttribute("style");
                wrapper.removeAttribute(_ATTR.prevRingingStyle);
                const prevMin = wrapper.dataset?.nmbPrevMinClasses;
                if (prevMin) {
                    wrapper.classList.add(...prevMin.split(' '));
                    delete wrapper.dataset.nmbPrevMinClasses;
                }
            }
            return true;
        }
        if (reason === "pin-by-blocked" || reason === "fast-pin-by-blocked") {
            const listId = el.dataset?.listItemId || "";
            const pinMatch = listId.match(/^pins_+(\d{17,20})$/);
            const messageId = pinMatch ? pinMatch[1] : null;
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            if (messageId && !this._surfaces.pins.shouldHidePinnedMessage(channelId, messageId, null)) {
                this.restoreElement(el);
            }
            return true;
        }
        if (reason === "pinned-panel-residue") {
            const pinCards = Array.from(el.querySelectorAll(_SEL.pinCard));
            const stillAllHidden = pinCards.length > 0 && pinCards.every(card => card.dataset?.hiddenBlocked === "true");
            if (!stillAllHidden) this.restoreElement(el);
            return true;
        }
        return false;
    }
    restoreUnhiddenElements() {
        for (const el of Array.from(this.hiddenElements)) {
            if (!document.contains(el)) {
                this.hiddenElements.delete(el);
                continue;
            }
            if (this._restoreSpecialHiddenElement(el)) continue;
            const userId = el.dataset?.nmbUserId;
            if (userId && !this.shouldHide(userId)) this.restoreElement(el);
        }
        for (const parent of Array.from(this.hiddenParents)) {
            if (!document.contains(parent)) {
                this.hiddenParents.delete(parent);
                continue;
            }
            const visibleChildren = Array.from(parent.children).filter(child => child.dataset?.hiddenBlocked !== "true");
            if (visibleChildren.length > 0) {
                this.restoreParent(parent);
            }
        }
        for (const slot of Array.from(this._ghostedElements)) {
            if (!document.contains(slot)) {
                this._ghostedElements.delete(slot);
                continue;
            }
            _restoreGhostStyle(slot);
            this._ghostedElements.delete(slot);
        }
        for (const el of Array.from(this._surfaces.reactions.hiddenReactorRows)) {
            if (!document.contains(el)) {
                this._surfaces.reactions.hiddenReactorRows.delete(el);
                continue;
            }
            const clickable = el.matches?.(_SEL.reactorClickable) ? el : el.querySelector(_SEL.reactorClickable);
            const userId = this.findUserId(clickable || el) || this._surfaces.reactions.resolveReactorIdByName(clickable || el);
            if (!userId || !this.shouldHide(userId)) {
                delete el.dataset.nmbReactorHidden;
                this._surfaces.reactions.hiddenReactorRows.delete(el);
            }
        }
        for (const btn of Array.from(this._surfaces.reactions.hiddenReactorRemoveBtns)) {
            if (!document.contains(btn)) {
                this._surfaces.reactions.hiddenReactorRemoveBtns.delete(btn);
                continue;
            }
            const userId = this._surfaces.reactions.resolveReactorIdFromRemoveButton(btn);
            if (!userId || !this.shouldHide(userId)) {
                delete btn.dataset.nmbReactorRemoveHidden;
                this._surfaces.reactions.hiddenReactorRemoveBtns.delete(btn);
            }
        }
    }
    _restoreTemporaryVoiceTimers() {
        document.querySelectorAll('[data-nmb-fake-timer="true"]').forEach(el => el.remove());
        document.querySelectorAll('[data-hidden-blocked="true"][data-nmb-reason="voice-timer-faked"]').forEach(el => {
            try { this.restoreElement(el); } catch (error) { _recordPatchCatch("cleanup.restoreVoiceTimer", this, error); }
        });
    }

    _restoreMarkedElements() {
        document.querySelectorAll(`[data-nmb-relabeled], [${_ATTR.relabelPending}], [data-nmb-relabel-retry-scheduled], [data-nmb-relabel-retry-count]`).forEach(el => {
            delete el.dataset.nmbRelabeled;
            delete el.dataset.nmbRelabelPending;
            delete el.dataset.nmbRelabelRetryScheduled;
            delete el.dataset.nmbRelabelRetryCount;
        });
        document.querySelectorAll('[data-nmb-promoted="true"]').forEach(el => {
            try {
                this._surfaces.messages.demoteMessage(el);
            } catch (error) {
                _recordPatchCatch("cleanup.demotePromotedMessage", this, error);
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
        document.querySelectorAll("[data-nmb-muted-voice]").forEach(row => this._surfaces.voice.restoreVoiceChannelIcon(row));
        document.querySelectorAll("[data-nmb-prev-icon-style]").forEach(icon => {
            const previous = icon.getAttribute(_ATTR.prevIconStyle);
            if (previous) icon.setAttribute("style", previous); else icon.removeAttribute("style");
            icon.removeAttribute(_ATTR.prevIconStyle);
        });
    }

    _restoreSurfaceOverlays() {
        document.querySelectorAll('[data-nmb-ghost="true"]').forEach(slot => {
            _restoreGhostStyle(slot);
        });
        document.querySelectorAll('[data-nmb-ringing-collapsed="true"]').forEach(wrapper => {
            this._surfaces.call.restoreCollapsedRingingWrapper(wrapper);
        });
        document.querySelectorAll('[data-nmb-sidebar-hidden="true"]').forEach(el => this._surfaces.events.clearEventsSidebarOverlay(el));
        document.querySelectorAll(`[${_ATTR.origText}]`).forEach(el => el.removeAttribute(_ATTR.origText));
        this._surfaces.events.restoreAllHeaderOverlays();
        this._surfaces.groupDms.restoreAllGroupDmAvatars();
        document.querySelectorAll("[data-nmb-prev-ringing-style]").forEach(el => {
            const prev = el.getAttribute(_ATTR.prevRingingStyle);
            if (prev != null) el.setAttribute("style", prev); else el.removeAttribute("style");
            el.removeAttribute(_ATTR.prevRingingStyle);
            el.removeAttribute("data-nmb-ringing-collapsed");
            el.removeAttribute("data-nmb-prev-min-classes");
        });
        document.querySelectorAll("[data-nmb-prev-residue-style]").forEach(el => {
            const prev = el.getAttribute("data-nmb-prev-residue-style");
            if (prev) el.setAttribute("style", prev); else el.removeAttribute("style");
            el.removeAttribute("data-nmb-prev-residue-style");
        });
    }

    _restoreRingingCollapsesAndClearTracking() {
        document.querySelectorAll('[data-nmb-ringing-collapsed="true"]').forEach(wrapper => {
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            if (!channelId) return;
            const CallStore = this.modules.CallStore;
            const call = CallStore?.getCall?.(channelId);
            const hasRingingSignal = this._surfaces.call.hasBlockedRinging(channelId);
            let hasBlockedParticipant = false;
            try {
                const states = this._surfaces.voice.getRawVoiceStatesForChannel(channelId) || [];
                if (states.length) {
                    const selfId = this._getSelfUserId();
                    const iAmIn = states.some(s => this.extractUserId(s) === selfId);
                    if (!iAmIn) {
                        hasBlockedParticipant = states.some(s => this.shouldHide(this.extractUserId(s)));
                    }
                }
            } catch (error) { _recordPatchCatch("cleanup.restoreRingingState", this, error); }
            if (!hasRingingSignal && !(call && hasBlockedParticipant)) {
                this._surfaces.call.restoreCollapsedRingingWrapper(wrapper, {
                    preserveEmptyStyle: true,
                    clearMinClassAttribute: true,
                    filterEmptyClasses: true
                });
            }
        });
        this.hiddenElements.clear();
        this.hiddenParents.clear();
        this._ghostedElements.clear();
        this._surfaces.reactions.hiddenReactorRows.clear();
        this._surfaces.reactions.hiddenReactorRemoveBtns.clear();
    }

    restoreAllElements() {
        _restoreTemporaryTexts();

        this._restoreTemporaryVoiceTimers();
        this._restoreMarkedElements();
        this._restoreSurfaceOverlays();
        this._restoreRingingCollapsesAndClearTracking();
    }
}

class SettingsMethods {
    getDefaultSettings() {
        return {
            types: {
                blocked: true,
                ignored: true
            },
            places: {
                messages: true,
                pins: true,
                inbox: true,
                replies: true,
                repliesToBlocked: true,
                mentions: true,
                memberList: true,
                voiceChannels: true,
                groupDms: true,
                autocomplete: true,
                reactions: true,
                threads: true,
                channelList: true,
                recentDms: true,
                events: true
            },
            notifications: {
                notifMessages: true,
                notifVoiceChat: true
            },
            behavior: {
                autoCheckUpdates: true,
                muteVoiceJoinLeaveSound: true,
                muteBlockedVoiceAudio: true,
                blockRingingFromBlocked: true,
                suppressTaskbarBadge: true
            }
        };
    }
    loadSettings() {
        const defaults = this.getDefaultSettings();
        try {
            const stored = BdApi.Data.load(this.pluginName, "settings") || {};
            return this.mergeSettings(defaults, stored);
        } catch (error) {
            _recordPatchCatch("settings.load", this, error);
            return defaults;
        }
    }
    saveSettings(immediate = false) {
        this._resources.clearTimer('settingsSave', this.saveTimeout);
        this.saveTimeout = null;
        const persist = () => {
            try {
                BdApi.Data.save(this.pluginName, "settings", this.settings);
            } catch (error) { _recordPatchCatch("settings.save", this, error); }
        };
        if (immediate) return persist();
        this.saveTimeout = this._resources.timer('settingsSave', persist, 250);
    }
    mergeSettings(defaults, stored) {
        const merged = {};
        for (const section of Object.keys(defaults)) {
            merged[section] = {
                ...defaults[section]
            };
            const saved = stored?.[section];
            if (!saved || typeof saved !== "object") continue;
            for (const key of Object.keys(defaults[section])) {
                if (typeof saved[key] === "boolean") merged[section][key] = saved[key];
            }
        }
        return merged;
    }
}

class ElementMethods {
    _pruneHiddenElements() {
        for (const el of Array.from(this.hiddenElements)) {
            if (!document.contains(el)) this.hiddenElements.delete(el);
        }
        for (const parent of Array.from(this.hiddenParents)) {
            if (!document.contains(parent)) this.hiddenParents.delete(parent);
        }
    }
    hideVoiceUsers() {
        this._surfaces.voice.scan();
        this._surfaces.stage.scan();
        this._surfaces.voice.hideActivityUsers();
        this._surfaces.call.hideCallGridTiles();
        this._surfaces.call.hideBlockedRingingOverlay();
    }

    isBlockedMessageBannerText(text) {
        return this.constructor.BLOCKED_BANNER_PATTERNS.some(re => re.test(String(text || "").trim()));
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
    _readMessageInfoFromProps(info, props) {
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
        if (this._placeEnabled("mentions") && !info.mentionedUserId && Array.isArray(message?.mentions) && message.mentions.length) {
            const hiddenMention = message.mentions.find(user => {
                const id = typeof user === "string" ? user : user?.id;
                return id && this.shouldHide(id);
            });
            if (hiddenMention) info.mentionedUserId = typeof hiddenMention === "string" ? hiddenMention : hiddenMention.id;
        }
    }
    _getMessageIdFromElement(el) {
        const listId = el.dataset?.listItemId || el.closest?.("[data-list-item-id]")?.dataset?.listItemId || "";
        const pinMatch = listId.match(/^pins_+(\d{17,20})$/);
        if (pinMatch) return pinMatch[1];
        const chatMatch = listId.match(/^chat-messages___chat-messages-\d+-(\d{17,20})$/);
        if (chatMatch) return chatMatch[1];
        return el.id?.match(/chat-messages-(?:\d+-)?(\d{17,20})$/)?.[1] || null;
    }
    _getBlockedMentionedUserIdForMessage(messageId) {
        try {
            const channelId = this.modules.SelectedChannelStore?.getChannelId?.();
            const getMessage = this.modules.MessageStore?.getMessage;
            const msg = channelId && typeof getMessage === "function" ? getMessage(channelId, messageId) : null;
            const mentions = msg?.mentions;
            if (Array.isArray(mentions) && mentions.length) {
                const hit = mentions.find(user => {
                    const id = typeof user === "string" ? user : user?.id;
                    return id && this.shouldHide(id);
                });
                if (hit) return typeof hit === "string" ? hit : hit.id;
            } else if (mentions && typeof mentions.forEach === "function") {
                let mentionedUserId = null;
                mentions.forEach(user => {
                    if (mentionedUserId) return;
                    const id = typeof user === "string" ? user : user?.id;
                    if (id && this.shouldHide(id)) mentionedUserId = id;
                });
                return mentionedUserId;
            }
        } catch (error) { _recordPatchCatch("messages.findBlockedMention", this, error); }
        return null;
    }
    getMessageInfo(el) {
        const info = {
            authorId: null,
            referencedAuthorId: null,
            mentionedUserId: null,
            isBlockedGroup: false,
            isSpammer: false,
            messageId: null
        };
        try {
            const found = this.findUserId(el);
            if (found) info.authorId = found;
        } catch (error) { _recordPatchCatch("messages.getAuthorFromElement", this, error); }
        try {
            const mention = el.querySelector?.('[class*="mention"][data-user-id]');
            if (mention) {
                info.mentionedUserId = mention.dataset.userId || this.findUserId(mention);
            }
        } catch (error) { _recordPatchCatch("messages.getMentionFromElement", this, error); }
        if (!info.messageId) info.messageId = this._getMessageIdFromElement(el);
        if (!info.mentionedUserId && info.messageId) {
            info.mentionedUserId = this._getBlockedMentionedUserIdForMessage(info.messageId);
        }
        if (!info.messageId || !info.authorId || !info.referencedAuthorId || !info.mentionedUserId) {
            this._identity.walkFiberShallow(el, props => this._readMessageInfoFromProps(info, props));
        }
        return info;
    }
    getReferencedMessage(message) {
        try {
            const ref = message?.messageReference || message?.message_reference;
            if (!ref) return null;
            const refChannelId = ref.channel_id || ref.channelId || message?.channel_id;
            const refMessageId = ref.message_id || ref.messageId;
            if (!refMessageId) return null;
            const fromStore = this.modules.MessageStore?.getMessage?.(refChannelId, refMessageId);
            if (fromStore) return fromStore;
            const inlineRef = message?.referenced_message || message?.referencedMessage;
            if (inlineRef && (inlineRef.id === refMessageId || !inlineRef.id)) return inlineRef;
            return null;
        } catch (_) {
            return null;
        }
    }
    findUserId(el) { return this._identity.fromElement(el); }
    findAllUserIds(el) { return this._identity.fromElementAll(el); }
    extractUserId(value, depth = 0) { return this._identity.fromProps(value, depth); }
    walkFiberProps(el, visitor, maxDepth = 12) { return this._identity.walkFiber(el, visitor, maxDepth); }
    findComponentViaFiber(el, predicate, maxHops = 20, label = "findComponentViaFiber") { return this._identity.fromFiber(el, predicate, maxHops, label); }
    findChannelId(el) { return this._identity.fromChannel(el); }
    hideElement(el, reason = "blocked", userId = null) {
        if (!el || el.dataset?.hiddenBlocked === "true") return;
        if (el.tagName === "MAIN" || el.id === "app-mount") return;
        if (!el.hasAttribute(_ATTR.prevStyle)) el.setAttribute(_ATTR.prevStyle, el.getAttribute("style") || "");
        const resolvedUserId = userId === false ? null : userId || this.findUserId(el);
        if (resolvedUserId) {
            el.dataset.nmbUserId = resolvedUserId;
            const identityKey = el.dataset?.listItemId || el.id || "";
            if (identityKey) el.dataset.nmbUserIdKey = identityKey;
        }
        this._compensateScrollForHide(el);
        el.dataset.hiddenBlocked = "true";
        el.dataset.nmbReason = reason;
        this.hiddenElements.add(el);
    }
    _compensateScrollForHide(el) {
        try {
            if (!el.isConnected) return;
            const scroller = el.closest(_SEL.scroller);
            if (!scroller) return;
            if (this._messageScrollBatchState?.scroller === scroller) return;
            const style = getComputedStyle(scroller);
            if (style.overflowY !== "auto" && style.overflowY !== "scroll") return;
            if (scroller.scrollHeight <= scroller.clientHeight) return;
            const scrollerRect = scroller.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const effectiveTop = this._scrollManager.getEffectiveScrollTop(scroller);
            if (elRect.bottom <= scrollerRect.top) {
                const collapsedHeight = elRect.height;
                if (collapsedHeight > 0.5) {
                    this._scrollManager.request(scroller, effectiveTop - collapsedHeight);
                }
                return;
            }
            if (elRect.top < scrollerRect.top) {
                const visiblePortionAbove = scrollerRect.top - elRect.top;
                if (visiblePortionAbove > 0.5) {
                    this._scrollManager.request(scroller, effectiveTop - visiblePortionAbove);
                }
            }
        } catch (error) { _recordPatchCatch("navigation.compensateHiddenScroll", this, error); }
    }
    restoreElement(el) {
        if (!el) return;
        const previous = el.getAttribute(_ATTR.prevStyle);
        if (previous) el.setAttribute("style", previous); else el.removeAttribute("style");
        delete el.dataset.hiddenBlocked;
        delete el.dataset.nmbReason;
        delete el.dataset.nmbUserId;
        delete el.dataset.nmbUserIdKey;
        el.removeAttribute(_ATTR.prevStyle);
        this.hiddenElements.delete(el);
    }
    _captureMessageScrollState() {
        try {
            const scroller = this._findMessagesScroller();
            if (!scroller) return null;
            let anchorEl = null;
            let anchorOffset = 0;
            try {
                const scrollerRect = scroller.getBoundingClientRect();
                const candidates = scroller.querySelectorAll(_SEL.messageRow);
                for (const candidate of candidates) {
                    const rect = candidate.getBoundingClientRect();
                    if (rect.bottom > scrollerRect.top) {
                        anchorEl = candidate;
                        anchorOffset = rect.top - scrollerRect.top;
                        break;
                    }
                }
            } catch (_) {}
            return {
                scroller,
                top: scroller.scrollTop,
                height: scroller.scrollHeight,
                clientHeight: scroller.clientHeight,
                anchorEl,
                anchorOffset
            };
        } catch (error) {
            _recordPatchCatch("navigation.captureMessageScrollState", this, error);
            return null;
        }
    }
    _computeScrollCorrection(state) {
        const scroller = state?.scroller;
        if (!scroller || !scroller.isConnected) return null;
        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const effectiveTop = this._scrollManager.getEffectiveScrollTop(scroller);
        let nextTop = null;
        if (state.anchorEl && state.anchorEl.isConnected) {
            try {
                const rect = state.anchorEl.getBoundingClientRect();
                const currentOffset = rect.top - scroller.getBoundingClientRect().top;
                nextTop = effectiveTop + (currentOffset - (state.anchorOffset || 0));
            } catch (_) { nextTop = null; }
        }
        if (nextTop === null || !Number.isFinite(nextTop)) {
            const delta = scroller.scrollHeight - (state.height || 0);
            nextTop = (state.top || 0) + delta;
        }
        if (!Number.isFinite(nextTop)) return null;
        if (nextTop < 0) nextTop = 0;
        if (nextTop > maxTop) nextTop = maxTop;
        return { scroller, nextTop };
    }
    _restoreMessageScrollState(state) {
        try {
            const MANUAL_SCROLL_GUARD_MS = 150;
            const lastManual = this._lastManualScrollAt || 0;
            const sinceManual = lastManual ? (Date.now() - lastManual) : null;
            if (lastManual && sinceManual < MANUAL_SCROLL_GUARD_MS) {
                return;
            }
            const correction = this._computeScrollCorrection(state);
            if (correction) {
                const effectiveTop = this._scrollManager.getEffectiveScrollTop(correction.scroller);
                if (Math.abs(effectiveTop - correction.nextTop) > 0.5) {
                    this._scrollManager.request(correction.scroller, correction.nextTop);
                }
            }
        } catch (error) { _recordPatchCatch("navigation.restoreMessageScrollState", this, error); }
    }
    _shouldFastHideMessagesInDom() {
        try {
            const result = (!this._storePatched || !this._messagesWrapPatched);
            if (result) return true;
        } catch (_) {
            return true;
        }
        return false;
    }
    restoreTemporaryText(el) {
        const previous = el.getAttribute(_ATTR.prevText);
        if (!_restoreTemporaryText(el) && previous !== null) {
            _setTemporaryText(el, previous);
            for (const [node, record] of _temporaryTextEdits.get(el) || []) {
                if (_temporaryTextNodeEdits.get(node) === record) _temporaryTextNodeEdits.delete(node);
            }
            _temporaryTextEdits.delete(el);
            el.removeAttribute("data-nmb-text-edit");
            el.removeAttribute("data-nmb-text-place");
        }
        el.removeAttribute(_ATTR.prevText);
    }
    _restoreOverwrittenTextForPlace(placeKey) {
        if (placeKey === "memberList") {
            document.querySelectorAll("[data-nmb-prev-text]").forEach(el => this.restoreTemporaryText(el));
        } else if (placeKey === "voiceChannels") {
            document.querySelectorAll("[data-nmb-muted-voice]").forEach(row => this._surfaces.voice.restoreVoiceChannelIcon(row));
        }
    }
}


function _buildByeBlockedStyles(hideStyles, places) {
    const collapsedRowStyles = `                display: none !important;
                height: 0 !important;
                min-height: 0 !important;
                max-height: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: hidden !important;
                contain: size style !important;`;
    const hideBlockedBanner = places.messages ? `
            [class*="messageGroupBlocked"],
            [class*="blockedSystemMessage"],
            [class*="groupStart"]:has([class*="blocked"]),
            li[class*="messageListItem"]:has([class*="messageGroupBlocked"]),
            li[class*="messageListItem"]:has([class*="blockedSystemMessage"]),
            li[class*="messageListItem"]:has([class*="blocked"][class*="message"]),
            [class*="messageListItem"]:has([class*="messageGroupBlocked"]) {
${collapsedRowStyles}
            }
        ` : "";
    const hideReactorLoadingFlash = places.reactions ? `
            [class*="reactorsContainer_"] [class*="spinner_"],
            [class*="reactorsContainer_"] [class*="wandering"] {
                display: none !important;
            }
        ` : "";
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
    return `
            [data-hidden-blocked="true"],
            [data-hidden-blocked="true"] * { ${hideStyles} }
            [data-nmb-mention-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                pointer-events: none !important;
                width: 0 !important;
                height: 0 !important;
                min-width: 0 !important;
                min-height: 0 !important;
                max-width: 0 !important;
                max-height: 0 !important;
                font-size: 0 !important;
                line-height: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
                border: 0 !important;
                overflow: hidden !important;
                position: absolute !important;
                transform: scale(0) !important;
            }
            h1[data-nmb-header-hidden="true"] {
                font-size: 0 !important;
                line-height: 0 !important;
            }
            h1[data-nmb-header-hidden="true"] [data-nmb-header-overlay="true"] {
                font-size: var(--nmb-header-restore-size, 20px) !important;
                line-height: var(--nmb-header-restore-line-height, normal) !important;
            }
            [data-nmb-ringing-collapsed="true"] {
                min-height: 0 !important;
                background: none !important;
                background-color: transparent !important;
                border: none !important;
                box-shadow: none !important;
            }
            [data-nmb-zero-reaction="true"] { display: none !important; pointer-events: none !important; }
            [data-nmb-hide-view-reactions="true"] { display: none !important; pointer-events: none !important; }
            [class*="reactorClickable_"][data-nmb-reactor-hidden="true"],
            [data-nmb-reactor-hidden="true"]:not([class*="reactorsContainer_"]):not([class*="reactors_"]) {
                display: none !important;
                pointer-events: none !important;
                height: 0 !important;
                min-height: 0 !important;
                max-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
            }
            [data-nmb-reactor-remove-hidden="true"] {
                display: none !important;
                pointer-events: none !important;
            }
            [data-nmb-pin-badge-hidden="true"] {
                display: none !important;
                pointer-events: none !important;
            }
            [data-nmb-loading-hidden="true"] { display: none !important; pointer-events: none !important; }
            [data-nmb-tab-hidden="true"] { display: none !important; pointer-events: none !important; }
            [data-nmb-count-fixed="true"] {
                font-size: 0 !important;
                position: relative !important;
            }
            [data-nmb-count-fixed="true"]::after {
                content: attr(data-nmb-real-count);
                font-size: 14px;
            }
            [data-nmb-status-overridden="true"] {
                display: none !important;
            }
            [data-list-id*="chat-messages"]:has([data-hidden-blocked="true"]),
            [data-list-id*="chat-messages"]:has([data-hidden-blocked="true"]) *,
            [class*="chatContent"] [class*="scroller"]:has([data-hidden-blocked="true"]),
            [class*="chatContent"] [class*="scroller"]:has([data-hidden-blocked="true"]) * {
                overflow-anchor: none !important;
            }
            [class*="messageGroupStart"]:empty,
            [class*="messageGroupBlocked"]:empty { display: none !important; }
            [data-nmb-ghost="true"] {
${collapsedRowStyles}
            }
            ${hideBlockedBanner}
            [data-nmb-promoted="true"] [class*="compact"],
            [data-nmb-promoted="true"] [class*="cozy"] { margin-top: 17px !important; }
            [data-nmb-promoted="true"] [class*="avatar"],
            [data-nmb-promoted="true"] img[class*="avatar"] { display: block !important; }
            [data-nmb-promoted="true"] [class*="username"],
            [data-nmb-promoted="true"] [class*="header_"],
            [data-nmb-promoted="true"] [class*="cozyHeader"] { display: flex !important; }
            [class*="channelInfo"] { display: flex !important; align-items: center !important; gap: 4px !important; }
            [data-nmb-muted-voice="true"] svg,
            [data-nmb-muted-voice="true"] [class*="icon"],
            [data-nmb-muted-voice="true"] [class*="iconLive"] {
                color: var(--channels-default) !important;
                fill: currentColor !important;
            }
            [data-nmb-avatar-extra="true"] {
                display: none !important;
            }
            [data-nmb-relabel-pending="true"] {
                visibility: hidden !important;
            }
            li[data-list-item-id*="private-channels"]:not([data-nmb-relabeled="true"]):has([class*="avatarStack"], [class*="groupAvatar"], [class*="avatarMulti"]) {
                visibility: hidden !important;
            }

            ${hideReactorLoadingFlash}
            ${noticeButtonStyles}
        `;
}

class PresentationMethods {
    addStyles() {
        this.removeStyles();
        if (this._relIsBlockedFn) {
            document.getElementById('ByeBlocked-bootguard')?.remove();
        }
        BdApi.DOM.addStyle(this.pluginName, _buildByeBlockedStyles(this.hideStyles, this.settings.places));
    }
    removeStyles() {
        try {
            BdApi.DOM.removeStyle(this.pluginName);
        } catch (error) { _recordPatchCatch("PresentationMethods.removeStyles.L15409", this, error); }
        document.getElementById(`${this.pluginName}-CSS`)?.remove();
    }
    toast(message, type = "info") {
        try {
            BdApi.UI.showToast(message, {
                type: type
            });
        } catch (error) { _recordPatchCatch("ui.showToast", null, error); }
    }
    _logThrottled(key, err, level = "warn") {
        const now = Date.now();
        if (this._throttledLogs && this._throttledLogs.get(key) > now - 60000) return;
        this._throttledLogs = this._throttledLogs || new Map;
        this._throttledLogs.set(key, now);
        try {
            const errInfo = err && err.message ? err.message : err;
            if (this.logger) {
                if (level === "error") this.logger.error(key, errInfo);
                else this.logger.warn(key, errInfo);
            } else {
                const msg = `[ByeBlocked] ${key}: ${errInfo}`;
                if (level === "error") console.error(msg, err || "");
                else console.warn(msg, err || "");
            }
        } catch (_) {}
    }
    getSettingsPanel() { return this._surfaces.settingsPanel.getSettingsPanel(); }
    _onSettingsChange(...args) { return this._surfaces.settingsPanel.onSettingsChange(...args); }
}


class ByeBlocked {
    static MODULE_RESOLUTION_RETRY_DELAYS_MS = Object.freeze([1000, 2000, 3000, 5000, 8000, 12000, 18000, 25000]);
    static VERSION="2.11.0";
    static RELEASE_URL="https://github.com/8ug8ird/ByeBlocked";
    static UPDATE_CHECK_INTERVAL_MS = 18e5;
    static RELEASES_API_URL="https://api.github.com/repos/8ug8ird/ByeBlocked/releases/latest";
    static ASSET_FILENAME="ByeBlocked.plugin.js";
    static TAB_COUNTS_PENDING_SENTINEL = Symbol("nmbTabCountsPending");
    static STAGE_USER_SELECTOR = '[class*="stageUser_"], [class*="stageListener_"], [class*="stageSpeaker_"], [class*="participantRow_"], [class*="stageSection_"] [class*="user_"], [class*="stageSection_"] [data-list-item-id], [class*="voiceUser__"]';
    static UPDATE_ALLOWED_HOSTS = [
        "api.github.com",
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "codeload.github.com"
    ];
    static CHANNEL_TYPES = {
        DM: 1,
        GUILD_VOICE: 2,
        GROUP_DM: 3,
        PUBLIC_THREAD: 11,
        PRIVATE_THREAD: 12,
        GUILD_STAGE_VOICE: 13,
        GUILD_FORUM: 15,
        GUILD_MEDIA: 16
    };
    static BLOCKED_BANNER_PATTERNS = [
        /(?:^|\s)(?:\d+\s+)?blocked\s+messages?(?:\s|$)/i,
        /(?:^|\s)messages?\s+blocked(?:\s|$)/i,
        /(?:^|\s)(?:\d+\s+)?mensage(?:m|ns)\s+bloquead[ao]s?(?:\s|$)/i,
        /(?:^|\s)(?:\d+\s+)?mensajes?\s+bloqueados?(?:\s|$)/i,
        /(?:^|\s)(?:\d+\s+)?messages?\s+bloqu[ée]e?s?(?:\s|$)/i,
        /(?:^|\s)(?:\d+\s+)?blockierte\s+nachricht(?:en)?(?:\s|$)/i,
        /(?:^|\s)(?:\d+\s+)?messagg(?:io|i)\s+bloccat[oi](?:\s|$)/i,
        /(?:^|\s)(?:\d+\s+)?geblokkeerde\s+bericht(?:en)?(?:\s|$)/i,
        /(?:^|\s)(?:\d+\s+)?zablokowan(?:e|ych)\s+wiadomo[śs]ci(?:\s|$)/i,
        /(?:^|\s)(?:\d+\s+)?заблокирован(?:ное|ных|ные)?\s+сообщени[ея]/i,
        /(?:^|\s)(?:\d+\s+)?engellenmi[sş]\s+mesaj(?:lar)?(?:\s|$)/i,
        /(?:^|\s)(?:(?:\d+\s*)?個の)?ブロックされたメッセージ/,
        /(?:^|\s)(?:\d+\s*条)?已屏蔽的?消息/,
        /(?:^|\s)(?:\d+\s*則)?已封鎖的?訊息/,
        /(?:^|\s)(?:\d+\s*개의?\s*)?차단된\s*메시지/,
    ];
    static REACTION_READ_CACHE_TTL_MS = 60000;
    static REACTION_READ_CACHE_MAX_SIZE = 600;
    static REACTION_ZERO_CONFIRM_MS = 350;
    static REACTION_FIX_MIN_INTERVAL_MS = 250;
    static REACTION_NETWORK_MIN_GAP_MS = 600;
    static REACTION_NETWORK_BATCH_BUDGET = 4;
    static REACTION_RATE_LIMIT_COOLDOWN_MS = 20000;
    static REACTION_STORE_CHANGE_DEBOUNCE_MS = 800;
    static REACTION_VIEWPORT_MARGIN_PX = 400;
    static DURATION_LOCALE = _makeDict(
        'dura\u00e7\u00e3o da chamada',
        'call duration'
    );
    static TOPIC_HEADER_LOCALE = _makeDict(
        't\u00f3pic',
        'topic'
    );
    static get ACTIONS() {
        return {
            VOICE_STATE_UPDATES: "VOICE_STATE_UPDATES",
            MESSAGE_CREATE: "MESSAGE_CREATE",
            MESSAGE_UPDATE: "MESSAGE_UPDATE",
            LOAD_MESSAGES_SUCCESS: "LOAD_MESSAGES_SUCCESS",
            MESSAGE_PIN_ADD: "MESSAGE_PIN_ADD",
            MESSAGE_PIN_REMOVE: "MESSAGE_PIN_REMOVE",
            CHANNEL_PINS_UPDATE: "CHANNEL_PINS_UPDATE",
            LOAD_PINNED_MESSAGES_SUCCESS: "LOAD_PINNED_MESSAGES_SUCCESS",
            FETCH_PINNED_MESSAGES_SUCCESS: "FETCH_PINNED_MESSAGES_SUCCESS",
            THREAD_CREATE: "THREAD_CREATE",
            CHANNEL_ACK: "CHANNEL_ACK",
            ACK_MESSAGES: "ACK_MESSAGES",
            THREAD_ACK: "THREAD_ACK",
            EMBEDDED_ACTIVITY_UPDATE_V2: "EMBEDDED_ACTIVITY_UPDATE_V2",
            VOICE_CHANNEL_EFFECT_SEND: "VOICE_CHANNEL_EFFECT_SEND",
            CALL_CREATE: "CALL_CREATE",
            CALL_UPDATE: "CALL_UPDATE",
            CALL_DELETE: "CALL_DELETE",
            VOICE_CHANNEL_SELECT: "VOICE_CHANNEL_SELECT",
            CHANNEL_STATUS_REGEX: /CHANNEL_STATUS|VOICE_STATUS|VOICE_CHANNEL_STATUS/i,
        };
    }
    static get MESSAGE_TYPES() {
        return {
            RECIPIENT_ADD: 1,
            CHANNEL_PINNED_MESSAGE: 6,
        };
    }
    static get STORE_NAMES() {
        return {
            RELATIONSHIP: ["RelationshipStore", "RelationshipManagerStore", "RelationshipStoreManager"],
            GUILD_MEMBER: ["GuildMemberStore", "MemberStore", "GuildMembersStore"],
            REACTIONS: ["ReactionsStore", "MessageReactionsStore", "ReactionStore"],
            VOICE_STATE: ["SortedVoiceStateStore", "VoiceStateStore", "SortedVoiceStatesStore"],
            STAGE_PARTICIPANT: ["StageChannelParticipantStore", "StageParticipantStore"],
            STAGE_INSTANCE: ["StageInstanceStore", "StageInstancesStore"],
            ACTIVITY: ["ChannelRTCStore", "ActivityStore", "EmbeddedActivityStore", "ActivityParticipantsStore", "ActivityManagerStore"],
        };
    }
    static get SIMPLE_STORE_SPECS() {
        return {
            GuildMemberStore: this.STORE_NAMES.GUILD_MEMBER,
            ReactionsStore: this.STORE_NAMES.REACTIONS,
            SortedVoiceStateStore: this.STORE_NAMES.VOICE_STATE,
            StageChannelParticipantStore: this.STORE_NAMES.STAGE_PARTICIPANT,
            StageInstanceStore: this.STORE_NAMES.STAGE_INSTANCE,
            ActivityStore: this.STORE_NAMES.ACTIVITY,
            ChannelStore: ["ChannelStore", "ChannelsStore"],
            UserStore: ["UserStore", "UsersStore", "CurrentUserStore"],
            SelectedGuildStore: ["SelectedGuildStore", "SelectedGuildIdStore"],
            SelectedChannelStore: ["SelectedChannelStore", "ChannelSelectedStore"],
            CallStore: ["CallStore", "VoiceCallStore"],
            VoiceStateStore: ["VoiceStateStore", "VoiceStatesStore"],
            MediaEngineStore: ["MediaEngineStore", "MediaEngineManagerStore"],
            ReadStateStore: ["ReadStateStore", "ChannelReadStateStore", "ReadStatesStore"],
            GuildReadStateStore: ["GuildReadStateStore", "GuildUnreadStore", "GuildReadStatesStore"],
            GuildChannelStore: ["GuildChannelStore", "GuildChannelsStore"],
            GuildStore: ["GuildStore", "GuildsStore"],
            NotificationSettingsStore: ["NotificationSettingsStore", "NotificationStore"],
            UserGuildSettingsStore: ["UserGuildSettingsStore", "GuildSettingsStore"],
            ChannelPinsStore: ["ChannelPinsStore", "PinnedMessagesStore"],
            ActiveJoinedThreadsStore: ["ActiveJoinedThreadsStore", "JoinedThreadsStore"],
            ThreadStore: ["ActiveThreadsStore", "ThreadStore", "ForumChannelStore", "GuildThreadStore", "ThreadsStore"],
            GuildScheduledEventStore: ["GuildScheduledEventStore", "ScheduledEventStore", "GuildEventsStore"],
            ChannelStatusStore: ["ChannelStatusStore", "VoiceChannelStatusStore", "ChannelStatusesStore"],
        };
    }
    static _createModulesProxy(resolver) {
        const modules = {};
        for (const key of Object.keys(this.SIMPLE_STORE_SPECS)) {
            Object.defineProperty(modules, key, {
                get() { return resolver.simple(key); },
                set(value) { resolver.setSimple(key, value); },
                enumerable: true,
                configurable: true,
            });
        }
        return modules;
    }
    static get RELATIONSHIP_METHOD_NAMES() {
        return {
            isBlocked: ["isBlocked", "isBlockedUser", "getIsBlocked"],
            isIgnored: ["isIgnored", "isIgnoredUser", "isMuted", "getIsIgnored"],
        };
    }
    static SETTINGS_LABELS = {
        blocked: 'Blocked users',
        ignored: 'Ignored users',
        messages: 'Messages',
        pins: 'Pinned messages',
        inbox: 'Inbox messages',
        replies: 'Message preview in replies',
        repliesToBlocked: 'Replies to blocked messages',
        mentions: 'Mentions',
        memberList: 'Member list',
        voiceChannels: 'Voice & Stage channels',
        groupDms: 'Group DMs',
        autocomplete: 'Autocomplete',
        reactions: 'Message reactions',
        threads: 'Threads',
        channelList: 'Channel / group list',
        recentDms: 'Group notifications',
        events: 'Scheduled events',
        notifMessages: 'Message notifications',
        notifVoiceChat: 'Voice chat notifications',
        autoCheckUpdates: 'Check for updates automatically',
        muteVoiceJoinLeaveSound: 'Mute join/leave sounds',
        muteBlockedVoiceAudio: 'Mute blocked users\' voice audio',
        blockRingingFromBlocked: 'Ignore calls from blocked users',
        suppressTaskbarBadge: 'Hide unread badge for blocked users'
    };
    static SETTINGS_NOTES = {
        pins: 'Pinned messages panel and pin badges.',
        inbox: 'Inbox / mentions inbox style surfaces when available.',
        replies: 'Hide reply previews authored by filtered users.',
        repliesToBlocked: 'Hide messages that reply to a filtered user\'s message.',
        mentions: 'Hide messages that mention filtered users (and mention chips).',
        memberList: 'Also covers the Members page.',
        voiceChannels: 'Includes the activity panel and streams.',
        autocomplete: 'Mentions and the invite picker.',
        threads: 'Thread lists and thread entries owned by filtered users.',
        channelList: 'Private channel / group list rows for filtered users.',
        recentDms: 'Taskbar unread badge for DMs from filtered users (also needs "Hide unread badge for blocked users" in Behavior).',
        events: 'Hides events created by blocked users.',
        notifMessages: 'Taskbar unread badge counting for filtered users (also needs "Hide unread badge for blocked users" in Behavior). Does not mute message sounds.',
        notifVoiceChat: 'Suppress voice join/leave/stream notification sounds for filtered users. Does not change Stage or voice participant visibility.',
        autoCheckUpdates: 'Checks every 30 minutes and notifies you when a new version is out.',
        muteVoiceJoinLeaveSound: 'For blocked users.',
        muteBlockedVoiceAudio: 'In calls.',
        blockRingingFromBlocked: 'Group DM calls they start won\'t ring or auto-join.',
        suppressTaskbarBadge: 'Taskbar and tray badge stay clear when the only activity is from blocked users. Requires Messages to be on.'
    };
    constructor() {
        this.pluginName = 'ByeBlocked';
        this.isRunning = false;
        this.logger = new Logger(this.pluginName);

        this._r = new ModuleResolver();
        this.modules = this.constructor._createModulesProxy(this._r);
        this.hiddenElements = new Set;
        this.hiddenParents = new Set;
        this._ghostedElements = new Set;
        this.observer = null;
        this._patchedStoreMethods = new WeakMap();
        this._patchedStoreRefs = new WeakMap();
        this._scrollManager = new ScrollManager();
        
        this.settings = this.loadSettings();
        
        this._updateChecking = false;
        this._updateNotice = null;
        this._lastNotifiedVersion = null;
        this._periodicCheckInterval = null;
        this._updateCheckKickoff = null;
        this._hiddenElementsPruneInterval = null;
        
        this.scanInterval = null;
        this.scanTimeout = null;
        this.scanFrame = null;
        this.refreshTimeout = null;
        this.saveTimeout = null;
        this._moduleRetryTimeout = null;
        this._guildSwitchWaitTimeout = null;
        this._isNavigating = false;
        this._navStartedAt = null;
        this._scrollLoopActive = false;
        this._scrollLoopNavToken = null;
        this._navToken = 0;
        
        for (const flag of ['store','notificationDispatcher','messagesWrap',
            'inviteSuggestions','soundboard','activityPanelComponent','blockedMsgGroup']) {
            this['_' + flag + 'Patched'] = false;
        }
        
        this._blockedChannelStatuses = new Map;
        this._channelStatusAuthors = new Map;
        this._lastStreamerId = null;
        this._lastActivityParticipantIds = new Set;

        this.originalVoiceMethods = {};
        this._soundPlayKey = null;
        this._soundFileKey = null;
        this._localMuteKey = null;
        this._localVolumeKey = null;
        this._localMuteIsToggle = false;
        this._localMuteReadStore = null;
        
        const readStateSurface = new ReadStateSurface(createReadStateSurfaceApi(this));

        this._suppressGroupAddSoundMessageId = null;
        this._suppressMentionSoundCredits = [];
        this._rawGetMessages = null;
        
        this._historyPatchState = null;
        
        this.relationshipChangeHandler = null;
        this._channelSwitchChangeHandler = null;
        this._routerUnsubscribe = null;
        this._visibilityHandlerDispose = null;
        this._visibilityRetryListenerDispose = null;
        this._inviteClickListenerDispose = null;
        this._menuPortalActive = false;
        
        this._lastWatchedChannelId = null;
        this._lastScanDomTime = 0;
        this._startupTimers = [];
        
        this._patcher = new PatchManager(this);
        this._retry = new RetryManager({
            isAlive: () => this.isRunning,
            getEpoch: () => this._instanceEpoch,
            onWarn: (label, err) => this._patcher?._warn(label, err),
            ownerInstance: this
        });
        this._resources = new ResourceManager({
            isAlive: () => this.isRunning,
            getEpoch: () => this._instanceEpoch,
            onWarn: (label, err) => this._patcher?._warn(label, err)
        });
        this._cacheManager = new CacheManager();
        this._identity = new IdentityResolver(this);
        this._surfaces = {
            members: new MemberSurface(createMemberSurfaceApi(this)),
            autocomplete: new AutocompleteSurface(createAutocompleteSurfaceApi(this)),
            events: new EventSurface(createEventSurfaceApi(this)),
            groupDms: new GroupDmSurface(createGroupDmSurfaceApi(this)),
            forums: new ForumSurface(createForumSurfaceApi(this)),
            messages: new MessageSurface(createMessageSurfaceApi(this)),
            pins: new PinSurface(createPinSurfaceApi(this)),
            reactions: new ReactionSurface(createReactionSurfaceApi(this)),
            voice: new VoiceSurface(createVoiceSurfaceApi(this)),
            stage: new StageSurface(createStageSurfaceApi(this)),
            channelStatus: new ChannelStatusSurface(createChannelStatusSurfaceApi(this)),
            sound: new SoundSurface(createSoundSurfaceApi(this)),
            settingsPanel: new SettingsSurface(createSettingsSurfaceApi(this)),
            badge: new BadgeSurface(createBadgeSurfaceApi(this)),
            call: new CallSurface(createCallSurfaceApi(this)),
            readState: readStateSurface,
            update: new UpdateSurface(createUpdateSurfaceApi(this))
        };
        this._health = new HealthMonitor(this, 15000);
    }
    get hideStyles() { return 'display: none !important;width: 0 !important;height: 0 !important;min-width: 0 !important;min-height: 0 !important;max-width: 0 !important;max-height: 0 !important;flex: 0 0 0 !important;padding: 0 !important;margin: 0 !important;border: 0 !important;overflow: hidden !important;position: absolute !important;opacity: 0 !important;pointer-events: none !important;transform: scale(0) !important;visibility: hidden !important;line-height: 0 !important;font-size: 0 !important;contain: size style !important;'; }
    _resolveSimpleStores() {
        this._moduleResolutionLog = {};
        for (const [key, names] of Object.entries(this.constructor.SIMPLE_STORE_SPECS)) {
            const resolved = this._r.resolveSimple(key, ...names);
            const label = 'store:' + names[0];
            const matchedName = this._r.matchedNameFor(label);
            this._moduleResolutionLog[key] = !resolved
                ? { strategy: "missing", matchedName: null }
                : matchedName
                    ? { strategy: "exact", matchedName }
                    : { strategy: "heuristic", matchedName: null };
        }
        const fellBackToHeuristic = Object.entries(this._moduleResolutionLog)
            .filter(([, v]) => v.strategy === "heuristic").map(([k]) => k);
        if (fellBackToHeuristic.length) {
            this.logger.warn(`resolved via shape heuristic, not exact name (Discord likely renamed): ${fellBackToHeuristic.join(", ")}`);
        }
    }
    _wpFindFnKey(mod, ...needles) { return this._r.findFnKey(mod, ...needles); }
    _wpFindFnKeyFuzzy(mod, ...needles) { return this._r.findFnKeyFuzzy(mod, ...needles); }
    _wpPatchRenderBySourceHeuristic(shouldSuppress, matchingStrings, requiredMatches = 1, label = null) {
        const { patched, bestHitCount, bestHitStrings } = this._patcher.patchBySourceTermsScored({
            terms: matchingStrings,
            requiredMatches,
            label,
            apply: (mod, key) => {
                const resolved = this._patcher.resolvePatchTarget(mod, key);
                if (!resolved) return false;
                const isClassComponent = resolved.fn?.prototype && typeof resolved.fn.prototype.render === "function";
                const target = isClassComponent ? resolved.fn.prototype : resolved.target;
                const targetKey = isClassComponent ? "render" : resolved.key;
                return this.patchInstead(target, targetKey, function(ctx, args, orig) {
                    try {
                        const props = args?.[0] || ctx?.props;
                        if (shouldSuppress(props, ctx, args)) return null;
                    } catch (_) { _recordPatchCatch("patchBySourceTerms.callback"); }
                    return orig.apply(ctx, args);
                });
            }
        });
        if (patched) return true;
        if (label) {
            this._heuristicWarned = this._heuristicWarned || new Set();
            if (!this._heuristicWarned.has(label)) {
                this._heuristicWarned.add(label);
                this.logger.warn(`${label}: source-heuristic lookup failed. Best candidate matched ${bestHitCount}/${requiredMatches} required strings (${bestHitStrings.join(", ") || "none"}) out of [${matchingStrings.join(", ")}]. Discord likely renamed something in this component - this diagnostic is meant to help pin down which term to update.`);
            }
        }
        return false;
    }

    _findMessageListAnchorEl() {
        try {
            const listRoot = document.querySelector('[data-list-id*="chat-messages"]');
            if (listRoot) {
                const item = listRoot.querySelector('li[data-list-item-id*="chat-messages"]') || listRoot.querySelector(_SEL.messageItemLi);
                if (item) return item;
            }
        } catch (_) {}
        try {
            return document.querySelector(_SEL.messageItemLi) || document.querySelector('[class*="message_"]');
        } catch (_) {
            return null;
        }
    }
    patchBefore(target, method, callback) { return this._patcher?.before(target, method, callback); }
    patchInstead(target, method, callback) { return this._patcher?.instead(target, method, callback); }
    patchAfter(target, method, callback) { return this._patcher?.after(target, method, callback); }
    _retryGuardEnter(name, attempt) { return this._retry.guardEnter(name, attempt); }
    _retryGuardExit(name) { this._retry.guardExit(name); }
    _retryDelay(attempt, steadyDelayMs = 2000) { return this._retry.delay(attempt, steadyDelayMs); }
    _scheduleRetry(fn, delay, opts) { return this._retry.schedule(fn, delay, opts); }
    _cancelRetry(id) { this._retry?.cancel(id); }
    _isThreadStoreOwnerFilterActive() {
        try {
            const store = this.modules.ThreadStore;
            if (!store) return false;
            const methodSet = this._patchedStoreMethods?.get(store);
            if (!methodSet) return false;
            const refs = this._patchedStoreRefs?.get(store);
            return ["getThreadsForParent", "getThreadsForChannel"].some(method =>
                methodSet.has(method) && typeof store[method] === "function" && refs?.get(method) === store[method]);
        } catch (_) { return false; }
    }
    _isThreadOwnerFilteringCovered() {
        return !!(this._surfaces.forums.forumPostComponentPatched || this._isThreadStoreOwnerFilterActive());
    }
    _patchStoreMethodOnce(store, method, callback, kind = "after") {
        if (!store || typeof store[method] !== "function") return;
        let methodSet = this._patchedStoreMethods.get(store);
        if (!methodSet) {
            methodSet = new Set();
            this._patchedStoreMethods.set(store, methodSet);
        }
        if (!this._patchedStoreRefs) this._patchedStoreRefs = new WeakMap();
        let refs = this._patchedStoreRefs.get(store);
        if (!refs) { refs = new Map(); this._patchedStoreRefs.set(store, refs); }
        if (methodSet.has(method) && refs.get(method) === store[method]) return true;
        methodSet.delete(method);
        refs.delete(method);
        const installed = kind === "before" ? this.patchBefore(store, method, callback)
            : kind === "instead" ? this.patchInstead(store, method, callback)
            : this.patchAfter(store, method, callback);
        if (!installed) {
            this._storePatchRetryNeeded = true;
            this._patcher?._recordSilently(`storePatch:${method}`);
            this._logThrottled(`storePatch:${method}`, `Failed to install ${kind} patch; will retry on the next patchStores call.`);
            return false;
        }
        methodSet.add(method);
        refs.set(method, store[method]);
        return true;
    }
    _patchNotificationDispatcher() {
        const self = this;
        if (!self.modules.Dispatcher) {
            try {
                self.modules.Dispatcher = self.modules.SelectedChannelStore?._dispatcher || null;
            } catch (error) { _recordPatchCatch("notifications.resolveDispatcher", null, error); }
        }
        const Dispatcher = self.modules.Dispatcher;
        if (!Dispatcher || typeof Dispatcher.dispatch !== "function") return false;
        if (self._notificationDispatcherPatched && self._notificationDispatcherPatchTarget === Dispatcher
            && self._notificationDispatcherPatchedMethod === Dispatcher.dispatch) {
            self._registerDispatcherPatchHealthCheck();
            return true;
        }
        self._notificationDispatcherPatched = false;
        const installed = self.patchBefore(Dispatcher, "dispatch", (_, args) => {
            self._health?.heartbeat("dispatcherPatch");
            try {
                if (!self.settings.places?.messages) return;
                const action = args?.[0];
                if (!action || typeof action !== "object") return;
                const scheduleRefresh = () => {
                    queueMicrotask(() => {
                        self._surfaces.readState.forceReadStateRecheck(true);
                        self._surfaces.badge.refreshTaskbarBadge();
                    });
                };
                if (action.type === self.constructor.ACTIONS.MESSAGE_CREATE) {
                    const msg = action.message;
                    const authorId = msg?.author?.id;
                    const channelId = msg?.channel_id;
                    if (!authorId || !channelId) return;
                    if (msg?.id) self._recordMessageAuthor(msg.id, authorId);
                    let parentId = null;
                    try {
                        parentId = self.modules.ChannelStore?.getChannel?.(channelId)?.parent_id || null;
                    } catch (error) { _recordPatchCatch("dispatcher.resolveMessageParent", self, error); }
                    if (self.shouldHide(authorId) || self._isBlockedMessage(msg)) {
                        if (!self._surfaces.readState.channelHasGenuineUnreadOtherThanBlocked(channelId)) {
                            self._surfaces.readState.markBlockedOnlyReadActivity(channelId, parentId, msg?.id);
                        }
                        if (!Array.isArray(self._suppressMentionSoundCredits)) self._suppressMentionSoundCredits = [];
                        self._suppressMentionSoundCredits.push(Date.now() + 3000);
                        scheduleRefresh();
                    } else {
                        self._surfaces.readState.clearBlockedOnlyReadActivity(channelId);
                        if (parentId) self._surfaces.readState.clearBlockedOnlyReadActivity(parentId);
                        scheduleRefresh();
                    }
                    return;
                }
                if (action.type === self.constructor.ACTIONS.THREAD_CREATE) {
                    const thread = action.channel || action;
                    const ownerId = thread?.ownerId || thread?.owner_id;
                    const parentId = thread?.parent_id;
                    if (ownerId && parentId && self.shouldHide(ownerId)) {
                        const lastId = self.modules.ReadStateStore?.lastMessageId?.(parentId);
                        self._surfaces.readState.markBlockedOnlyReadActivity(parentId, null, lastId || thread?.id);
                        scheduleRefresh();
                    }
                    return;
                }
                const ackChannelId = action.channelId || action.channel_id;
                if (ackChannelId && (action.type === self.constructor.ACTIONS.CHANNEL_ACK || action.type === self.constructor.ACTIONS.ACK_MESSAGES || action.type === self.constructor.ACTIONS.THREAD_ACK)) {
                    self._surfaces.readState.clearBlockedOnlyReadActivity(ackChannelId);
                }
            } catch (error) { _recordPatchCatch("dispatcher.messageAction", self, error); }
        });
        if (!installed) return false;
        self._notificationDispatcherPatched = true;
        self._notificationDispatcherPatchTarget = Dispatcher;
        self._notificationDispatcherPatchedMethod = Dispatcher.dispatch;
        self._registerDispatcherPatchHealthCheck();
        return true;
    }
    _registerDispatcherPatchHealthCheck() {
        if (!this._health || this._health.checks?.dispatcherPatch) return;
        try {
            this._health.register(
                "dispatcherPatch",
                () => {
                    try {
                        return !!(this._notificationDispatcherPatched && this._notificationDispatcherPatchTarget
                            && this.modules.Dispatcher === this._notificationDispatcherPatchTarget
                            && typeof this.modules.Dispatcher.dispatch === "function"
                            && this.modules.Dispatcher.dispatch === this._notificationDispatcherPatchedMethod);
                    } catch (_) {
                        return false;
                    }
                },
                () => {
                    this.logger.warn("The message dispatcher patch (blocked-user badge/notification suppression) appears to be inactive - Discord may have changed something internally. Consider updating the plugin.");
                },
                2
            );
        } catch (error) {
            _recordPatchCatch("health.registerDispatcherPatch", this, error);
        }
    }
    _registerMessageFilterEffectivenessHealthCheck() {
        if (!this._health || this._health.checks?.messageFilterEffectiveness) return;
        try {
            this._health.register(
                "messageFilterEffectiveness",
                () => {
                    try {
                        if (!this.settings.places.messages) return true;
                        if (!this._storePatched || this._messageStorePatchTarget !== this.modules.MessageStore
                            || this._hasMessageStoreMethodDrift()) return false;
                        if (!this._relIsBlockedFn) return true;
                        const channelId = this._getCurrentChannelIdRobust();
                        if (!channelId) return true;
                        const raw = this._getChannelMessagesList(channelId);
                        if (!raw.length) return true;
                        const rawBlockedCount = raw.filter(msg => this.isBlockedMessageData(msg)).length;
                        if (rawBlockedCount === 0) return true;
                        const filtered = this._filterMessagesCollectionUncached(raw);
                        const filteredArray = Array.isArray(filtered) ? filtered
                            : (typeof filtered?.toArray === "function" ? filtered.toArray() : filtered);
                        if (!Array.isArray(filteredArray)) return false;
                        const stillBlockedAfterFilter = filteredArray.some(msg => this.isBlockedMessageData(msg));
                        return !stillBlockedAfterFilter;
                    } catch (_) {
                        return false;
                    }
                },
                () => {
                    this.logger.warn("The message filter is not removing messages from blocked users despite finding them - the MessageStore data format may have changed. Consider updating the plugin.");
                    try { this._storePatched = false; this.patchMessageStore(); } catch (error) { _recordPatchCatch("health.repairMessageStorePatch", this, error); }
                },
                2
            );
        } catch (error) {
            _recordPatchCatch("health.registerMessageFilterEffectiveness", this, error);
        }
    }


}


for (const source of [
    NavigationMethods,
    LifecycleMethods,
    ModuleResolutionMethods,
    MessageFilteringMethods,
    InviteMethods,
    ObserverMethods,
    VisibilityMethods,
    DomScanMethods,
    SettingsMethods,
    ElementMethods,
    PresentationMethods
]) {
    const descriptors = Object.getOwnPropertyDescriptors(source.prototype);
    delete descriptors.constructor;
    for (const key of Object.keys(descriptors)) {
        if (Object.prototype.hasOwnProperty.call(ByeBlocked.prototype, key)) {
            throw new Error("Duplicate ByeBlocked method: " + key);
        }
    }
    Object.defineProperties(ByeBlocked.prototype, descriptors);
}
module.exports = ByeBlocked;