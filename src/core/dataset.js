// @ts-check
import { validateTables, normalizeSchema, normalizeData, denormalizeSchema, enforceRefs, coerceToType } from './schema.js';
import { nestingOf, enforceTree } from './hierarchy.js';
import { warn } from './dev.js';
import { createTables } from './engine/tables.js';
import { createHistory } from './engine/history.js';
import { createSelection } from './engine/selection.js';
import { createHover } from './engine/hover.js';

/**
 * The data side of the engine: schema, rows, context, lock, constraints, undo
 * history, selection, hover and the `change` / `select` / `hover` listeners. Charts read and
 * write it; it knows them only through the hooks they attach. `api` is the
 * public `Dataset`.
 */

/**
 * The keys of a spec the dataset reads. Read live, so a later `spec.onChange`
 * is the one called.
 * @typedef {import('../types').DatasetSpec} DatasetSpec
 */

/**
 * The rows and context membership. Engine modules read these at call time.
 * @typedef {object} DataState
 * @property {Record<string, any[]>} tables  one array per table NAME
 * @property {Record<string, WeakSet<object>>} contextRows  context membership, by row identity (see core/lock.js)
 */

/**
 * What a chart drawing the dataset gives it.
 * @typedef {object} ChartHook
 * @property {() => void} update  re-render from the current data
 * @property {() => boolean} settles  can this chart settle a hierarchy (it draws node boxes)?
 * @property {() => any} snapshot  the chart's own state an undo step keeps (its size)
 * @property {(snap: any) => void} restore  put that state back on undo / redo
 * @property {() => boolean} showsHover  does this chart paint the dataset's hover?
 * @property {(what: 'preview' | 'rows' | 'reseed') => void} drop  drop state that no
 *   longer matches the data. 'preview': the uncommitted preview (a domain change).
 *   'rows': also what indexes rows (hover, grab, driver sessions, a stroke), after
 *   another chart's commit. 'reseed': also draw a hierarchy's next layout at
 *   once, for data from outside (`setData`, `set`). Does not render.
 */

/**
 * What `attach` hands back: the chart's own way into the dataset. Commits made
 * through it are this chart's, so the dataset can tell it from the others.
 * @typedef {object} ChartPort
 * @property {() => void} detach
 * @property {() => void} notifyChange  after a commit: redraw the other charts, fire `change`
 * @property {(sel: any, table?: string) => boolean} commitSelectionEdit  a selection edit;
 *   redraws the other charts when it moved
 * @property {(row: { table: string, index: number } | null) => boolean} commitHover  the row
 *   this chart's pointer is over, or null when it left; redraws the other charts when it moved
 * @property {() => boolean} linked  do two or more charts draw this dataset?
 * @property {() => void} recordHistory  before a commit (engine/history.js)
 * @property {(type: string) => void} gestureTxn
 * @property {() => void} endTxn  where a gesture ends: closes it and fires `gesture`
 * @property {(edit: { type: string, name?: string, table: string }) => void} noteEdit  an edit
 *   this chart's open gesture fired (for `gesture`)
 * @property {(stroking: boolean) => { space: boolean } | null} settleTurn  may this chart
 *   settle the hierarchy at render time, and push rows apart? (see `layout`)
 * @property {() => boolean} ownsLayout  were the node rows last settled by this chart?
 * @property {() => void} layoutMoved  this chart's render-time settle changed the rows:
 *   redraw the other charts
 */

/**
 * @param {DatasetSpec} spec
 * @param {(dataset: any, spec: import('../types').ChartSpec) => import('../types').Chart} makeChart
 *   builds a chart over this dataset (core/elicit.js's createChart)
 */
export function createDataset(spec, makeChart) {
    // The dataset owns a clone of the schema: a domain edit (edit.axis.*) writes it,
    // never the caller's spec. `normalizeSchema` applies the author-side sugars
    // once; `getSchema()` denormalizes on the way out.
    /** @type {import('../types').SchemaSpec} */
    const schemaSpec = normalizeSchema(structuredClone(spec.schema || {}));
    // The schema as declared: the ceiling a zoom widens back to, and what
    // `setDomain(field, null)` restores.
    const seedSchemaSpec = structuredClone(schemaSpec);

    // structuredClone keeps seed `Date` values; `normalizeData` splits rows per table.
    /** @type {DataState} */
    const state = {
        tables: normalizeData(structuredClone(spec.data ?? null), schemaSpec),
        contextRows: {},
    };

    const accessors = createTables(state, { spec, schemaSpec });
    const {
        seedContext, isContextRow, recountSeed, shapeData, primaryRows, reportedRows,
        rowIndexOf, reportedIndexOf, isLockedIn, checkRows, seedCountOf, setSeedCount,
    } = accessors;

    // Context rows (spec.context) are decided once, over the seed.
    seedContext();
    // Seed row counts for `lock: 'seed'`.
    recountSeed();
    // Check the seed rows against the schema once. An edit cannot add an
    // undeclared column, so the seed is the only source of a mismatch.
    validateTables(schemaSpec, state.tables);
    // A hierarchy must be a tree: drop the rows validateTables flagged.
    enforceTree(schemaSpec, state.tables);

    /** @type {ChartHook[]} */
    const charts = [];
    // A hierarchy's node rows are settled in one chart's pixels (core/fit.js).
    // `owner` is the chart whose pixels they were last settled in: it committed
    // them, or took data from outside. Only the owner re-settles at render time;
    // every other chart draws the stored boxes. `pending`: data from outside
    // (the seed, `setData`, `set`) waits to be spaced by the first chart that
    // settles it.
    /** @type {{ owner: ChartHook | null, pending: boolean }} */
    const layout = { owner: null, pending: true };
    const refresh = () => { for (const c of [...charts]) c.update(); };
    // Redraw every chart but `from` (the one that committed and renders itself),
    // first dropping what `what` names (see ChartHook.drop).
    /** @param {ChartHook | null} from @param {'preview' | 'rows' | 'reseed'} what */
    const refreshOthers = (from, what) => {
        for (const c of [...charts]) {
            if (c === from) continue;
            c.drop(what);
            c.update();
        }
    };

    // `change` per committed edit; `select` and `hover` on a selection or hover
    // change (no data moved); `gesture` once when a gesture that changed data ends.
    /** @type {{ change: Set<Function>, select: Set<Function>, hover: Set<Function>, gesture: Set<Function> }} */
    const listeners = { change: new Set(), select: new Set(), hover: new Set(), gesture: new Set() };

    // Notify a committed change; undo/redo notify through it too.
    const notifyChange = () => {
        if (spec.onChange) spec.onChange(shapeData());
        for (const cb of listeners.change) cb(structuredClone(shapeData()));
    };

    // The selected rows, as table-qualified keys (engine/selection.js).
    /** @type {Set<string>} */
    const selected = new Set();
    const { api: selectionApi, ...selectionFns } = createSelection(state, {
        schemaSpec, selected, listeners, primaryRows, reportedRows, rowIndexOf, reportedIndexOf,
        update: refresh,
    });

    // The hovered row, shared by the charts whose hover is linked (engine/hover.js).
    const { api: hoverApi, ...hoverFns } = createHover(state, {
        schemaSpec, listeners, reportedRows, rowIndexOf, reportedIndexOf, update: refresh,
    });
    // The chart whose pointer set the hover. Only it clears the hover by leaving.
    /** @type {ChartHook | null} */
    let hoverOwner = null;
    // Row indices moved under the hover: drop it. The caller redraws.
    const clearHover = () => { hoverOwner = null; hoverFns.commitHover(null); };

    // One snapshot per gesture (engine/history.js).
    // One event per gesture that changed data: what it started from, what it left,
    // and which edits did it (deduplicated: a drag fires its edit on every move).
    /** @param {{ before: any, edits: any[] }} done */
    const notifyGesture = (done) => {
        if (!listeners.gesture.size) return;
        const seen = new Set();
        const edits = done.edits.filter((e) => {
            const k = `${e.type}\u0000${e.name ?? ''}\u0000${e.table}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        const event = { edits, before: structuredClone(shapeTables(done.before.tables)), after: structuredClone(shapeData()) };
        for (const cb of listeners.gesture) cb(event);
    };
    // The dataset's shape (getData's) for any set of tables: a bare array for a one-table schema.
    /** @param {Record<string, any[]>} tables */
    const shapeTables = (tables) => {
        const live = state.tables;
        state.tables = tables;
        try { return shapeData(); } finally { state.tables = live; }
    };

    // Writes from outside (patch) that would renumber rows wait here while a stroke is in flight.
    /** @type {{ plan: any[], history: 'keep' | 'record' }[]} */
    let pending = [];
    // One snapshot per gesture (engine/history.js).
    const history = createHistory(state, {
        schemaSpec, charts, layout, isContextRow, update: refresh,
        notifyChange: () => { clearHover(); notifyChange(); },
        onGesture: notifyGesture,
        afterTxn: () => { if (pending.length && !history.inGesture()) flushPending(); },
    });

    // Hover links once a second chart draws the dataset, so redraw the others
    // when the count crosses that line. Deferred: a chart may not have rendered yet.
    /** @param {ChartHook | null} but */
    const relink = (but) => setTimeout(() => { for (const c of [...charts]) if (c !== but) c.update(); }, 0);

    // Attach a chart; returns its port. Rendering the other charts never commits,
    // so a fan-out cannot loop back.
    /** @param {ChartHook} hook @returns {ChartPort} */
    const attach = (hook) => {
        charts.push(hook);
        if (charts.length === 2) relink(hook);
        return {
            detach: () => {
                const i = charts.indexOf(hook);
                if (i >= 0) charts.splice(i, 1);
                if (hoverOwner === hook) clearHover();
                if (i >= 0 && charts.length === 1) relink(null);
                // The rows keep its layout; no chart re-settles them until a commit.
                if (layout.owner === hook) layout.owner = null;
            },
            notifyChange: () => {
                // A commit settles in the committing chart's pixels (compute.js).
                if (hook.settles()) layout.owner = hook;
                // Another chart's hover names rows this commit may have moved.
                if (hoverOwner !== hook) clearHover();
                refreshOthers(hook, 'rows');
                notifyChange();
            },
            commitSelectionEdit: (sel, table) => {
                const moved = selectionFns.commitSelectionEdit(sel, table);
                if (moved) for (const c of [...charts]) if (c !== hook) c.update();
                return moved;
            },
            commitHover: (row) => {
                // A chart that leaves a row clears only the hover it set.
                if (!row && hoverOwner !== hook) return false;
                const moved = hoverFns.commitHover(row);
                hoverOwner = row ? hook : null;
                if (moved) for (const c of [...charts]) if (c !== hook && c.showsHover()) c.update();
                return moved;
            },
            linked: () => charts.length > 1,
            recordHistory: () => history.recordHistory(hook),
            gestureTxn: (type) => history.gestureTxn(type, hook),
            endTxn: () => history.endTxn(hook, { notify: true }),
            noteEdit: (edit) => history.noteEdit(hook, edit),
            settleTurn: (stroking) => {
                // Nothing is spaced mid-stroke; outside data waits for the release.
                if (layout.pending && !stroking) {
                    layout.pending = false;
                    layout.owner = hook;
                    return { space: true };
                }
                return layout.owner === hook ? { space: false } : null;
            },
            ownsLayout: () => layout.owner === hook,
            layoutMoved: () => refreshOthers(hook, 'rows'),
        };
    };

    // ── The public Dataset (types.d.ts) ────────────────────────────────────────

    // Replaces the rows and re-seeds. Skips constraints (they gate gestures);
    // under `lock: 'seed'` the new rows become the read-only seed.
    /** @param {any[] | Record<string, any[]>} data */
    const setData = (data) => {
        // A bare array is the primary table; an object names its tables.
        const next = normalizeData(structuredClone(data ?? null), schemaSpec);
        // Keep the context rows (same objects, so membership survives) ahead of
        // the new rows.
        for (const name of Object.keys(state.contextRows)) {
            const keep = (state.tables[name] || []).filter((d) => isContextRow(name, d));
            if (keep.length) next[name] = [...keep, ...(next[name] || [])];
        }
        state.tables = next;
        // A reseed is new seed data, so it gets the same contract check as spec.data.
        validateTables(schemaSpec, state.tables, 'setData()');
        // A hierarchy gets the same ref and tree repairs a commit gets.
        if (nestingOf(schemaSpec)) {
            enforceRefs(schemaSpec, state.tables);
            enforceTree(schemaSpec, state.tables);
        }
        recountSeed();
        layout.pending = true;
        for (const c of charts) c.drop('reseed');
        selected.clear(); // a reseed's row indices are new; drop the old selection
        clearHover();
        // Writes queued against the old rows may name rows the new ones lack.
        pending = [];
        // A reseed is a new starting point, so undo history is cleared.
        history.reset();
        refresh();
    };

    // Sets a field's domain as one undoable step. `null` restores the declared domain.
    /** @param {string} field @param {any[] | null} domain @param {{ table?: string }} [options] */
    const setDomain = (field, domain, options = {}) => {
        const table = options && options.table != null ? options.table : schemaSpec.primary;
        const t = schemaSpec.tables[table];
        if (!t || !t.fields[field]) {
            warn(
                `setDomain:field:${table}.${field}`,
                `setDomain("${field}"): table "${table}" declares no field "${field}". ` +
                `Declared fields: ${t ? Object.keys(t.fields).map((f) => `"${f}"`).join(', ') : 'none'}.`
            );
            return false;
        }
        const seed = seedSchemaSpec.tables[table] && seedSchemaSpec.tables[table].fields[field];
        const next = domain == null ? (seed && seed.domain) : domain;
        if (!Array.isArray(next)) {
            warn(`setDomain:domain:${field}`, `setDomain("${field}"): no domain to set (none declared to restore).`);
            return false;
        }
        history.endTxn();
        history.recordHistory();
        t.fields[field] = { ...t.fields[field], domain: structuredClone(next) };
        for (const c of charts) c.drop('preview');
        notifyChange();
        history.endTxn();
        refresh();
        return true;
    };

    // Writes one cell from outside any chart, as one undoable step. The proposal
    // runs the table's invariants (constraints, then the lock) like an edit's; a
    // rejection changes nothing. `index` counts reported rows, like `select`.
    /** @param {string} field @param {any} value @param {{ index?: number, table?: string }} [options] */
    const set = (field, value, options = {}) => {
        const table = options && options.table != null ? options.table : schemaSpec.primary;
        const index = options && options.index != null ? options.index : 0;
        const t = schemaSpec.tables[table];
        if (!t || !t.fields[field]) {
            warn(
                `set:field:${table}.${field}`,
                `set("${field}"): table "${table}" declares no field "${field}". ` +
                `Declared fields: ${t ? Object.keys(t.fields).map((f) => `"${f}"`).join(', ') : 'none'}.`
            );
            return false;
        }
        const rows = state.tables[table] || [];
        const i = Number.isInteger(index) && index >= 0 ? rowIndexOf(table, index) : -1;
        if (i < 0 || i >= rows.length) {
            warn(
                `set:index:${table}`,
                `set("${field}", …, { index: ${index} }): table "${table}" has ` +
                `${reportedRows(table).length} rows; index counts them from 0, context rows left out.`
            );
            return false;
        }
        // The value in the form the field stores (a typed "250" is the number 250).
        const stored = coerceToType(value, t.fields[field]);
        if (stored === undefined) {
            warn(
                `set:value:${table}.${field}`,
                `set("${field}", ${JSON.stringify(value)}): a ${t.fields[field].type} field cannot hold this value.`
            );
            return false;
        }
        if (Object.is(rows[i][field], stored)) return false;
        const locked = isLockedIn(table);
        if (locked && locked(rows[i], i)) return false;
        const proposed = rows.map((d, j) => (j === i ? { ...d, [field]: stored } : d));
        const checked = checkRows(table, proposed, { activeIndex: i, field });
        if (!checked) return false;
        // A repair may rebuild rows with the values they already had: nothing to commit.
        const same = (/** @type {any} */ a, /** @type {any} */ b) => a === b || (!!a && !!b
            && Object.keys(a).length === Object.keys(b).length
            && Object.keys(a).every((k) => Object.is(a[k], b[k])));
        if (checked.length === rows.length && checked.every((d, j) => same(d, rows[j]))) return false;
        history.endTxn();
        history.recordHistory();
        state.tables[table] = checked;
        // Drop rows whose `ref` no longer resolves, as a commit does.
        enforceRefs(schemaSpec, state.tables);
        history.endTxn();
        // Data from outside: every chart redraws; the first to render settles a hierarchy.
        layout.pending = true;
        clearHover();
        refreshOthers(null, 'reseed');
        notifyChange();
        return true;
    };

    // ── External writes: patch ─────────────────────────────────────────────────
    // setData is a reseed, and says so: history, selection and any stroke in flight
    // all go. That is right for "load a different dataset" and wrong for a second
    // writer on the same one: an agent marking a step done while a person drags
    // another. patch is that writer's door: rows addressed by KEY, not index, merged
    // into the live dataset without disturbing the person.
    //
    // A row's key is its table's `key: true` field. A links table usually declares
    // none, and there a link IS its pair of `ref` ends.

    /** @param {string} name @returns {string[]} */
    const keyFieldsOf = (name) => {
        const table = schemaSpec.tables[name];
        if (!table) throw new Error(`patch(): there is no table named "${name}".`);
        const fields = Object.entries(table.fields);
        const keys = fields.filter(([, f]) => f && /** @type {any} */ (f).key).map(([k]) => k);
        if (keys.length) return keys;
        const refs = fields.filter(([, f]) => f && f.type === 'ref').map(([k]) => k);
        if (refs.length) return refs;
        throw new Error(`patch(): table "${name}" has no key field (\`key: true\`) and no \`ref\` fields, so its rows cannot be addressed.`);
    };
    /** @param {string} name */
    const safeKeyFields = (name) => { try { return keyFieldsOf(name); } catch { return null; } };
    /** @param {string[]} fields @param {any} row */
    const keyOfRow = (fields, row) => JSON.stringify(fields.map((f) => (row ? row[f] : undefined)));
    // A `remove` entry: the bare key value for a one-field key, else a row-shaped object or an array.
    /** @param {string[]} fields @param {any} k */
    const keyOfRemoval = (fields, k) => {
        if (Array.isArray(k)) return JSON.stringify(k);
        if (k != null && typeof k === 'object') return keyOfRow(fields, k);
        return JSON.stringify([k]);
    };
    /** @param {any} changes */
    const compilePatch = (changes) => Object.entries(changes || {}).map(([name, ops]) => {
        const fields = keyFieldsOf(name);
        return {
            name, fields,
            insert: (ops && ops.insert) || [],
            update: (ops && ops.update) || [],
            remove: new Set(((ops && ops.remove) || []).map((/** @type {any} */ k) => keyOfRemoval(fields, k))),
        };
    });

    // Apply a compiled patch to one set of tables: the live ones, or a snapshot's.
    // `report` is passed for the live tables only: a snapshot that lacks a row the
    // live data has is ordinary history, not a conflict. `keep(name, old, next)`
    // carries what is held by row identity (context membership) to a replaced row.
    /** @param {Record<string, any[]>} target @param {any[]} plan @param {any} [report] @param {(name: string, old: any, next: any) => void} [keep] */
    const applyPatchTo = (target, plan, report, keep) => {
        for (const op of plan) {
            let rows = target[op.name] || [];
            if (op.remove.size) rows = rows.filter((r) => !op.remove.has(keyOfRow(op.fields, r)));
            else rows = rows.slice();
            const at = new Map(rows.map((r, i) => [keyOfRow(op.fields, r), i]));
            for (const row of op.update) {
                const k = keyOfRow(op.fields, row);
                const i = at.get(k);
                if (i === undefined) { if (report) report.missing.push({ table: op.name, key: JSON.parse(k) }); continue; }
                const next = { ...rows[i], ...structuredClone(row) };
                if (keep) keep(op.name, rows[i], next);
                rows[i] = next;
                if (report) report.updated++;
            }
            for (const row of op.insert) {
                const k = keyOfRow(op.fields, row);
                if (at.has(k)) { if (report) report.conflicts.push({ table: op.name, key: JSON.parse(k) }); continue; }
                at.set(k, rows.length);
                rows.push(structuredClone(row));
                if (report) report.inserted++;
            }
            target[op.name] = rows;
        }
        // A removed node takes its links with it, exactly as in a gesture.
        enforceRefs(schemaSpec, target);
        if (nestingOf(schemaSpec)) enforceTree(schemaSpec, target);
    };

    // A snapshot holds context membership as row indices; a removal renumbers them.
    /** @param {any} snap @param {any[]} plan */
    const rebaseSnapshot = (snap, plan) => {
        /** @type {Record<string, string[] | null>} */
        const contextKeys = {};
        for (const [name, idx] of Object.entries(snap.context || {})) {
            const fields = safeKeyFields(name);
            contextKeys[name] = fields ? /** @type {number[]} */ (idx).map((i) => keyOfRow(fields, (snap.tables[name] || [])[i])) : null;
        }
        applyPatchTo(snap.tables, plan);
        for (const [name, keys] of Object.entries(contextKeys)) {
            const fields = safeKeyFields(name);
            if (!keys || !fields) continue;
            const want = new Set(keys);
            snap.context[name] = (snap.tables[name] || []).map((/** @type {any} */ r, /** @type {number} */ i) => (want.has(keyOfRow(fields, r)) ? i : -1)).filter((/** @type {number} */ i) => i >= 0);
        }
    };

    /** @param {any[]} plan @param {'keep' | 'record'} mode */
    const applyPatchLive = (plan, mode) => {
        const mid = history.inGesture();
        // The selection names rows by index, and a removal renumbers rows: remember
        // the selected rows by key, find them again afterwards.
        const remembered = [...selected].map((key) => {
            const at = key.indexOf('\u0000');
            const table = key.slice(0, at), index = Number(key.slice(at + 1));
            const fields = schemaSpec.tables[table] ? safeKeyFields(table) : null;
            return { table, fields, key: fields ? keyOfRow(fields, (state.tables[table] || [])[index]) : null };
        });
        // A 'seed' lock reads "the first N rows". Removals keep order and inserts
        // append, so the seeded rows stay at the head; only N has to shrink.
        /** @type {Record<string, Set<string>>} */
        const seededKeys = {};
        for (const op of plan) {
            seededKeys[op.name] = new Set((state.tables[op.name] || []).slice(0, seedCountOf(op.name)).map((r) => keyOfRow(op.fields, r)));
        }
        const sizes = Object.fromEntries(Object.entries(state.tables).map(([n, r]) => [n, r.length]));

        if (mode === 'record') history.push();
        const report = { inserted: 0, updated: 0, removed: 0, missing: /** @type {any[]} */ ([]), conflicts: /** @type {any[]} */ ([]) };
        const tables = { ...state.tables };
        applyPatchTo(tables, plan, report, (name, old, next) => {
            const set = state.contextRows[name];
            if (set && set.has(old)) set.add(next);
        });
        state.tables = tables;
        validateTables(schemaSpec, state.tables, 'patch()');
        // 'keep': the write is a fact about the data, not a step of the person's.
        // Rebase it into every snapshot, so undoing their last drag cannot revert it.
        if (mode === 'keep') history.rebase((snap) => rebaseSnapshot(snap, plan));

        // Removed = rows gone, net of the rows inserted (cascaded links included).
        let net = 0;
        for (const name of new Set([...Object.keys(sizes), ...Object.keys(state.tables)])) {
            net += (sizes[name] || 0) - (state.tables[name] || []).length;
        }
        report.removed = net + report.inserted;
        for (const op of plan) {
            if (seedCountOf(op.name)) setSeedCount(op.name, (state.tables[op.name] || []).filter((r) => seededKeys[op.name].has(keyOfRow(op.fields, r))).length);
        }

        const before = [...selected].join('|');
        selected.clear();
        for (const { table, fields, key } of remembered) {
            if (key == null || !fields) continue;
            const i = (state.tables[table] || []).findIndex((r) => keyOfRow(fields, r) === key);
            if (i >= 0) selected.add(`${table}\u0000${i}`);
        }
        // Mid-stroke only field writes and appends land (nothing renumbers), so the
        // stroke keeps its grab; otherwise what indexes rows is stale.
        for (const c of charts) c.drop(mid ? 'preview' : 'rows');
        layout.pending = true;
        clearHover();
        notifyChange();
        if ([...selected].join('|') !== before) selectionFns.notifySelect();
        refresh();
        return report;
    };
    const flushPending = () => {
        const queue = pending;
        pending = [];
        for (const p of queue) applyPatchLive(p.plan, p.history);
    };

    /** @param {any} changes @param {{ history?: 'keep' | 'record' }} [options] */
    const patch = (changes, options = {}) => {
        const mode = (options && options.history) ?? 'keep';
        if (mode !== 'keep' && mode !== 'record') {
            throw new Error(`patch(): history is "keep" or "record", not "${mode}".`);
        }
        const plan = compilePatch(changes);
        // Mid-stroke, a chart holds the grabbed row by the INDEX it had at dragstart.
        // Field writes and appends renumber nothing, so they land now; a removal would
        // make the stroke write the wrong row, so it waits for the stroke to end, and
        // so does anything queued behind it, so writes land in the order they were made.
        if (history.inGesture() && (pending.length || plan.some((op) => op.remove.size))) {
            pending.push({ plan, history: mode });
            return { deferred: /** @type {const} */ (true) };
        }
        return applyPatchLive(plan, mode);
    };

    // Subscribe to `change`, `select`, `hover` or `gesture`; returns an unsubscribe function.
    /** @param {string} type @param {Function} cb */
    const on = (type, cb) => {
        if (type !== 'change' && type !== 'select' && type !== 'hover' && type !== 'gesture') {
            warn(`on:${type}`, `on("${type}"): no such event. A dataset fires "change", "select", "hover" and "gesture"; a chart also fires "stage", "render" and "destroy".`);
            return () => false;
        }
        const set = listeners[/** @type {'change' | 'select' | 'hover' | 'gesture'} */ (type)];
        set.add(cb);
        return () => set.delete(cb);
    };

    /** @type {import('../types').Dataset} */
    const api = {
        chart: (chartSpec) => makeChart(dataset, chartSpec),
        // A deep copy; structuredClone keeps Date values.
        getData: () => structuredClone(shapeData()),
        // A deep copy of the live schema, in the spelling the author gave.
        getSchema: () => structuredClone(denormalizeSchema(schemaSpec)),
        setData,
        setDomain,
        set,
        patch,
        undo: history.undo,
        redo: history.redo,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        transaction: history.transaction,
        on,
        ...selectionApi,
        ...hoverApi,
    };

    const dataset = {
        api,
        get tables() { return state.tables; },
        set tables(v) { state.tables = v; },
        get contextRows() { return state.contextRows; },
        set contextRows(v) { state.contextRows = v; },
        schemaSpec, seedSchemaSpec,
        ...accessors,
        selection: selected,
        selectionIn: selectionFns.selectionIn,
        selectionPrimary: selectionFns.selectionPrimary,
        selectionList: selectionFns.selectionList,
        selectionApi,
        hoverRow: hoverFns.hoverRow,
        listeners,
        // Commits, history and selection edits go through a chart's port.
        attach,
    };
    return dataset;
}

/** @typedef {ReturnType<typeof createDataset>} Dataset */
