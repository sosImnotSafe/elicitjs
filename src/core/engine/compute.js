// @ts-check
import { resolveChannels } from '../../edit/route.js';
import { enforceRefs, inferMeasureOfDomain, fieldsOf } from '../schema.js';
import { axisOf } from '../encoding.js';
import { treeOf } from '../hierarchy.js';
import { fitChannelsOf } from '../fit.js';
import { warn } from '../dev.js';

/**
 * Runs an edit from gesture to commit. `editContext` builds apply()'s ctx,
 * `computeEdit` runs apply and the data invariants, `runEdit` / `commitDomainEdit`
 * commit, `previewEdit` parks the proposal as a ghost, and `reachableKeys` /
 * `portAvailable` are trial commits.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{
 *   schemaSpec: import('../../types').SchemaSpec,
 *   seedSchemaSpec: import('../../types').SchemaSpec,
 *   ui: any,
 *   featureNodes: Record<string, any[]>,
 *   hierarchyNodes: string | null,
 *   boxHosts: any[],
 *   tableOf: (feature: any) => any[],
 *   targetTableOf: (feature: any, edit: import('../../types').Edit) => string,
 *   isLockedIn: (name: string) => ((d: any, i: number) => boolean) | null,
 *   checkRows: (table: string, rows: any[], context?: any, extra?: import('../../types').Constraint[]) => any[] | null,
 *   nodeBoxRule: () => import('../../types').NodeBoxRule | null,
 *   nodePortsRule: ((row: any, i: number, rows: any[]) => Record<string, string> | null) | null,
 *   containsRule: ((row: any, i: number, rows: any[]) => boolean) | null,
 *   channelsDrawing: (name: string) => Record<string, any> | null,
 *   settleNodes: (before?: any[] | null, frozen?: Set<number> | null, dodge?: any) => void,
 *   settledNodes: (from: Record<string, any[]>, before: any[] | null, frozen: Set<number> | null, dodge?: any) => any[],
 *   heldStill: () => Set<number> | null,
 *   activeEdits: (feature: any) => import('../../types').Edit[],
 *   selectionPrimary: () => number | null,
 *   commitSelectionEdit: (sel: any, table?: string) => boolean,
 *   recordHistory: () => void,
 *   notifyChange: () => void,
 *   noteEdit?: (edit: { type: string, name?: string, table: string }) => void,
 *   applyResize: (size: { width?: number, height?: number }) => void,
 * }} deps
 */
export function createCompute(chart, deps) {
    const {
        schemaSpec, seedSchemaSpec, ui, featureNodes, hierarchyNodes, boxHosts,
        tableOf, targetTableOf, isLockedIn, checkRows,
        nodeBoxRule, nodePortsRule, containsRule, channelsDrawing,
        settleNodes, settledNodes, heldStill, activeEdits,
        selectionPrimary, commitSelectionEdit, recordHistory, notifyChange, noteEdit,
    } = deps;
    const applyResize = deps.applyResize;

    // The scales an edit on this node inverts through: the global map overlaid with
    // the node's composite frame scales, or null when there is no frame.
    /**
     * @param {any} feature
     * @param {any} node the node a direct-pick gesture landed on, if any
     * @param {number | null} [index] the datum, for a gesture that carries no node
     * @returns {import('../../types').ScaleMap | null}
     */
    const frameScalesFor = (feature, node, index) => {
        let framed = node && node.frame ? node : null;
        if (!framed && index != null && feature) {
            framed = (featureNodes[feature.id] || []).find(
                (/** @type {any} */ n) => n && n.index === index && n.frame
            ) || null;
        }
        return framed ? { ...chart.scales, ...framed.frame } : null;
    };

    // Builds the ctx an edit's apply() sees. `index` is the touched datum (null
    // for create).
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @param {boolean} [preview] true for a ghost; an edit may propose a half-made
     *   row (a link with no target) that it must never commit.
     * @param {any} [sessionOverride] a session to use instead of the feature's own,
     *   for a trial commit.
     * @returns {{ ctx: any, targetTable: string, currentData: any[], resolved: any[], derivedOnly: boolean }}
     */
    const editContext = (feature, edit, event, index, preview = false, sessionOverride = undefined) => {
        // The touched table and the written table differ for a cross-table edit
        // (`connect` sits on a node mark but writes a link row).
        const sourceRows = tableOf(feature);
        const targetTable = targetTableOf(feature, edit);
        const currentData = chart.tables[targetTable] || [];
        const markChannels = feature.channels || {};
        // Invert through the scales that drew the grabbed node (composite frames).
        const editScales = frameScalesFor(feature, event.node, index) || chart.scales;
        let resolved = resolveChannels(edit.channels, markChannels, editScales, feature);
        let derivedOnly = false;
        // A container's fitted size is derived from its contents, so drop those
        // channels on a row with children. Its position stays editable.
        if (hierarchyNodes && feature.table === hierarchyNodes && index != null && resolved.length
            && treeOf(schemaSpec, chart.tables).hasChildren(index)) {
            const derived = fitChannelsOf(markChannels).filter((ch) => axisOf(ch) !== 'x' && axisOf(ch) !== 'y');
            const free = resolved.filter((ch) => !derived.includes(ch.name));
            derivedOnly = !free.length;
            resolved = free;
        }
        const ctx = {
            // The rows of the written table.
            data: currentData,
            // The touched row, from the mark's own table.
            datum: index != null ? sourceRows[index] : undefined,
            index,
            // Every table, read-only, for cross-table edits.
            tables: chart.tables,
            table: targetTable,
            pointer: { x: event.x, y: event.y },
            node: event.node || null,
            event: event.rawEvent,
            // Wheel travel in pixels.
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            // A non-pixel payload (the text mark's typed string).
            value: event.value,
            channels: resolved,
            scales: editScales,
            markChannels,
            // Null on cartesian charts.
            projection: /** @type {import('../../types').ProjectionContext | null} */ (
                /** @type {any} */ (chart.scales).projection || null
            ),
            // Plot size in px.
            width: chart.innerWidth,
            height: chart.innerHeight,
            // Effective margins (author + legend bands), for grow-mode axis edits.
            margins: chart.effectiveMargins,
            // The written table's schema (mint defaults, field domains).
            schema: fieldsOf(schemaSpec, targetTable),
            // The written table's schema as declared, before any domain edit.
            seedSchema: fieldsOf(seedSchemaSpec, targetTable),
            schemaSpec,
            // Read-only rows of the written table (spec.lock).
            locked: isLockedIn(targetTable),
            xKey: feature.xKey || 'x',
            yKey: feature.yKey || 'y',
            // Series field and scene nodes, to resolve which line a plane gesture means.
            seriesKey: feature.seriesKey || null,
            marks: featureNodes[feature.id] || [],
            // The line's ordering knob and the per-feature driver session.
            connect: feature.connect || null,
            session: sessionOverride !== undefined
                ? sessionOverride
                : (ui.session && ui.session[feature.id]) || null,
            nodeBox: nodeBoxRule(),
            nodePorts: nodePortsRule,
            // Which node rows may hold others.
            contains: containsRule,
            // Channels of the mark drawing the written table, when it is another table.
            targetChannels: targetTable !== feature.table ? channelsDrawing(targetTable) : null,
            // The primary selected index.
            selection: selectionPrimary(),
            // The edit itself, so `when` can read its options.
            edit,
            preview,
        };
        return { ctx, targetTable, currentData, resolved, derivedOnly };
    };

    // Does this edit's `when` accept the gesture? Asked before a plane gesture
    // reaches the drivers, so a declined edit never consumes it.
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @returns {boolean}
     */
    const arbitrates = (feature, edit, event) =>
        !edit.when || !!edit.when(editContext(feature, edit, event, null).ctx);

    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @param {boolean} [preview]
     * @param {any} [sessionOverride]
     * @returns {import('../../types').EditResult | null}
     */
    const computeEdit = (feature, edit, event, index, preview = false, sessionOverride = undefined) => {
        const { ctx, targetTable, currentData, resolved, derivedOnly } = editContext(feature, edit, event, index, preview, sessionOverride);
        // Every column this edit writes is derived from the row's contents.
        if (derivedOnly) return null;
        const markChannels = ctx.markChannels;
        if (edit.when && !edit.when(ctx)) return null; // arbitration

        const result = edit.apply(ctx);
        if (result === undefined) return null;

        // The touched datum in the proposed rows, read from the declared cardinality.
        /** @param {any[]} rows @returns {number | null} */
        const activeIndexOf = (rows) => (edit.cardinality === 'append' ? rows.length - 1
            : edit.cardinality === 'delete' ? null
                : /** @type {number | null} */ (index));

        // Runs a table's invariants (engine/tables.js `checkRows`), with
        // `edit.constrain` on the written table only.
        /**
         * @param {any[]} rows
         * @param {string} [forTable] the table these rows belong to (default: the
         *   written table)
         * @returns {any[] | null} the repaired rows, or null if rejected
         */
        const runInvariants = (rows, forTable = targetTable) => {
            const own = forTable === targetTable;
            return checkRows(forTable, rows, {
                activeIndex: own ? activeIndexOf(rows) : null,
                field: own && resolved[0] ? resolved[0].field : undefined,
                scales: chart.scales, markChannels,
            }, own ? edit.constrain : []);
        };

        // A domain edit returns { domains, data?, tables?, resize? }. The domains
        // skip the invariants; any coupled row data still runs them.
        if (edit.target === 'domain') {
            if (!(result && typeof result === 'object' && result.domains)) return null;
            /** @type {any} */
            const out = { ...result };
            if (Array.isArray(result.data)) {
                const checked = runInvariants(result.data);
                if (!checked) return null;
                out.data = checked;
            }
            // Rows in other tables run their own table's invariants. One rejection
            // rejects the whole edit, so a rename never half-applies.
            if (result.tables) {
                /** @type {any} */
                const others = {};
                for (const [name, w] of Object.entries(/** @type {any} */ (result.tables))) {
                    const t = /** @type {any} */ (w);
                    if (!Array.isArray(t.data)) { others[name] = t; continue; }
                    const checked = runInvariants(t.data, name);
                    if (!checked) return null;
                    others[name] = { ...t, data: checked };
                }
                out.tables = others;
            }
            return { kind: 'domain', result: out };
        }

        // A selection edit returns a selection descriptor; it skips the invariants and undo.
        if (edit.target === 'selection') {
            return (result && typeof result === 'object' && 'index' in result)
                ? { kind: 'selection', selection: result }
                : null;
        }

        // A whole-dataset edit (create appends, remove filters) returns an array; a
        // mark edit returns the new datum, spliced in at `index`.
        const newData = Array.isArray(result)
            ? result
            : currentData.map((d, i) => (i === index ? result : d));

        const rows = runInvariants(newData);
        if (!rows) return null;
        return { kind: 'rows', rows };
    };

    // Commits an edit's proposal and notifies. Returns whether data changed.
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {boolean}
     */
    const runEdit = (feature, edit, event, index) => {
        const proposed = computeEdit(feature, edit, event, index);
        if (!proposed) return false;
        // Which edits a gesture fired, for its 'gesture' event. A selection writes no
        // data, so it is not part of what the gesture changed.
        if (proposed.kind !== 'selection' && noteEdit) noteEdit({ type: edit.type, name: edit.name ?? undefined, table: targetTableOf(feature, edit) });
        // A domain edit reshapes the schema (and maybe the dataset / chart size).
        if (proposed.kind === 'domain') {
            return commitDomainEdit(proposed.result, targetTableOf(feature, edit));
        }
        // A selection edit writes ui.selection, not the belief data.
        if (proposed.kind === 'selection') {
            return commitSelectionEdit(proposed.selection, targetTableOf(feature, edit));
        }
        recordHistory();
        // Replace the table the edit writes, which may not be the one its mark draws.
        const nodesBefore = hierarchyNodes ? chart.tables[hierarchyNodes] : null;
        chart.tables[targetTableOf(feature, edit)] = proposed.rows;
        // Drop rows whose `ref` no longer resolves.
        enforceRefs(schemaSpec, chart.tables);
        // Move subtrees with their container and re-fit fitted containers.
        settleNodes(nodesBefore, heldStill(), {
            since: chart.strokeNodes || nodesBefore,
            yields: index != null && feature.table === hierarchyNodes ? new Set([index]) : null,
        });
        ui.preview = null;
        notifyChange();
        return true;
    };

    // Commits a domain edit: writes each field's schema domain (inferring a type for
    // an undeclared field), replaces any coupled rows, resizes, and notifies.
    /**
     * @param {import('../../types').DomainEditResult} result
     * @param {string} [table] the table the edit writes; its schema owns the domains,
     *   and its rows are what a coupled data change replaces.
     * @returns {boolean}
     */
    const commitDomainEdit = (result, table = schemaSpec.primary) => {
        recordHistory();
        // One write per table: the flat `domains`/`data` are the edit's own table,
        // `result.tables` holds the others a shared scale spans.
        /** @type {Record<string, { domains?: any, data?: any }>} */
        const writes = { [table]: { domains: result.domains, data: result.data } };
        for (const [name, w] of Object.entries(result.tables || {})) {
            if (!schemaSpec.tables[name]) {
                warn(
                    `domain:table:${name}`,
                    `a domain edit names table "${name}", which the schema does not declare. ` +
                    `Declared tables: ${Object.keys(schemaSpec.tables).map((n) => `"${n}"`).join(', ')}.`
                );
                continue;
            }
            const prior = writes[name];
            writes[name] = prior
                ? { domains: { ...prior.domains, ...w.domains }, data: w.data ?? prior.data }
                : w;
        }

        let touchedRows = false;
        for (const [name, w] of Object.entries(writes)) {
            const fields = fieldsOf(schemaSpec, name);
            for (const [field, domain] of Object.entries(w.domains || {})) {
                const prev = fields[field];
                fields[field] = { ...(prev || { type: inferMeasureOfDomain(domain) }), domain };
            }
            if (Array.isArray(w.data)) { chart.tables[name] = w.data; touchedRows = true; }
        }
        // A category removal deletes rows, which can strand references to them.
        if (touchedRows) enforceRefs(schemaSpec, chart.tables);
        if (result.resize) applyResize(result.resize);
        ui.preview = null;
        notifyChange();
        return true;
    };

    // Computes the same proposal as runEdit but parks it in ui.preview as a ghost.
    // getData/onChange never see it.
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {boolean}
     */
    const previewEdit = (feature, edit, event, index) => {
        const proposed = computeEdit(feature, edit, event, index, true);
        // Only row proposals preview; domain edits commit directly.
        if (!proposed || proposed.kind !== 'rows') return false;
        const newData = proposed.rows;
        // Keyed by feature id, but carries its table: the ghost is drawn by every
        // mark over that table (a connect from a node mark is drawn by the link mark).
        // The pointer locates a free end, such as a link with no target yet.
        if (!ui.preview) ui.preview = {};
        const pointer = typeof event.x === 'number' && typeof event.y === 'number'
            ? { x: event.x, y: event.y }
            : undefined;
        const table = targetTableOf(feature, edit);
        // A nesting proposal has no shape of its own, so park the settled node rows
        // it implies instead. It is `live`: drawn in place of the committed rows, not
        // as a ghost, so a container is seen growing to take the node. `dropInto` is
        // the receiving container, for the `target` effect.
        if (hierarchyNodes && table === schemaSpec.byRole.nesting && boxHosts.length) {
            const overlay = { ...chart.tables, [table]: newData };
            const tree = treeOf(schemaSpec, overlay);
            ui.preview[feature.id] = {
                table: hierarchyNodes,
                rows: settledNodes(overlay, null, null, {
                    anchors: index != null ? [index] : null, preview: true,
                    yields: index != null ? new Set([index]) : null,
                }),
                pointer,
                dropInto: index != null ? tree.parentOf(index) : null,
                live: true,
            };
            return true;
        }
        ui.preview[feature.id] = { table, rows: newData, pointer };
        return true;
    };

    // Tries each place in `Edit.targets` as a commit (apply + invariants) without
    // committing, and returns the keys that pass.
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {number | null} index the row the drag started on
     * @param {any} node the node it started on
     * @param {any} [session] run against this session instead of the feature's
     * @returns {string[] | null} the keys a release could land on; null when the
     *   edit declares no targets
     */
    const reachableKeys = (feature, edit, index, node, session) => {
        if (typeof edit.targets !== 'function') return null;
        const table = targetTableOf(feature, edit);
        const probeCtx = /** @type {any} */ ({
            scales: chart.scales, schemaSpec, tables: chart.tables, table, data: chart.tables[table] || [],
            nodeBox: nodeBoxRule(), nodePorts: nodePortsRule, contains: containsRule,
            width: chart.innerWidth, height: chart.innerHeight,
            node: node || null, edit, pointer: { x: 0, y: 0 },
            // The start row and channels, so a rewire knows its other end.
            index, datum: index != null ? tableOf(feature)[index] : undefined,
            markChannels: feature.channels || {},
        });
        /** @type {string[]} */
        const keys = [];
        const places = edit.targets(probeCtx);
        // No places to try (no ports).
        if (!places) return null;
        for (const t of places) {
            const trial = computeEdit(feature, edit, { x: t.x, y: t.y, node }, index, false, session);
            if (trial !== null) keys.push(t.key);
        }
        return keys;
    };

    // Can a link start from this port? Cached until any table array is replaced.
    /** @type {Map<string, boolean>} */
    const availCache = new Map();
    /** @type {any[]} */
    let availSig = [];
    /** @param {any} feature @param {any} node @returns {boolean} */
    const portAvailable = (feature, node) => {
        const sig = Object.keys(chart.tables).map((k) => chart.tables[k]);
        if (sig.length !== availSig.length || sig.some((t, i) => t !== availSig[i])) {
            availCache.clear();
            availSig = sig;
        }
        const key = `${feature.id}\u0000${node.index}\u0000${node.side}`;
        const hit = availCache.get(key);
        if (hit !== undefined) return hit;
        let ok = false;
        const session = {
            ...((ui.session && ui.session[feature.id]) || {}),
            fromIndex: node.index,
            fromSide: node.side,
            fromPoint: null,
        };
        for (const edit of activeEdits(feature)) {
            const keys = reachableKeys(feature, edit, node.index, node, session);
            if (keys && keys.length) { ok = true; break; }
        }
        availCache.set(key, ok);
        return ok;
    };

    return {
        frameScalesFor, arbitrates, runEdit,
        commitDomainEdit, previewEdit, reachableKeys, portAvailable,
    };
}
