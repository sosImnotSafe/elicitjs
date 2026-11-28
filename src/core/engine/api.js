// @ts-check
import { collectEdits, resolveChannels } from '../../edit/route.js';
import { markCenter } from '../../edit/shared.js';
import { encodeChannel } from '../../plot/mark.js';
import { fieldsOf } from '../schema.js';
import { axisOf, pointerForChannel } from '../encoding.js';
import { warn } from '../dev.js';
import { driverFor } from '../../edit/drivers/index.js';

/**
 * @typedef {object} ApiDeps
 * @property {import('../../types').Dataset} dataset  the public dataset this chart draws
 * @property {() => void} detach  detach the chart from its dataset
 * @property {import('../../types').Renderer} renderer
 * @property {any[]} features
 * @property {{ stage: Set<Function>, render: Set<Function>, destroy: Set<Function> }} listeners
 * @property {ReturnType<typeof import('./view.js').createView>} view  the read surface (engine/view.js)
 * @property {any} theme  the resolved theme
 * @property {Record<string, any[]>} featureNodes
 * @property {import('../../types').SchemaSpec} schemaSpec
 * @property {'fixed' | 'scale' | 'reflow'} mode
 * @property {HTMLDivElement} container
 * @property {ReturnType<typeof import('./stages.js').createStages>} stages
 * @property {(feature: any) => any[]} tableOf
 * @property {(name: string, i: number) => number} rowIndexOf
 * @property {(feature: any, node: any, index?: number | null) => import('../../types').ScaleMap | null} frameScalesFor
 * @property {(edit: import('../../types').Edit) => boolean} rowTargeted
 * @property {() => void} abortStroke  drop the gesture in flight, uncommitted
 * @property {() => void} endTxn  close this chart's undo transaction
 * @property {() => boolean} measure
 * @property {() => void} stopMotion  cancel a pending animation frame
 * @property {(event: any) => void} handleEvent
 * @property {() => void} update
 */

/**
 * Builds the public `Chart`: its node, external control, stages, listeners and
 * teardown, plus its dataset's methods, delegated.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {ApiDeps} deps
 * @returns {import('../../types').Chart}
 */
export function createChartApi(chart, deps) {
    const {
        dataset, detach, renderer, features, listeners, view, theme, featureNodes, schemaSpec, mode, container, stages, tableOf, rowIndexOf, frameScalesFor, rowTargeted, abortStroke, endTxn, measure, stopMotion,
    } = deps;
    const handleEvent = (/** @type {any} */ event) => deps.handleEvent(event);
    const update = () => deps.update();

    // External control synthesizes renderer-shaped events and feeds them to the
    // one `handleEvent`, so constraints, undo and listeners all run as usual.

    // Injects a renderer-shaped event: { type, node?, x?, y?, value?, nudge?, rawEvent? },
    // with `x`/`y` in inner (margin-subtracted) pixels.
    const emit = (/** @type {any} */ event) => handleEvent(event);

    // Finds the (feature, edit) with this `name`, preferring one active at the
    // current stage. Scanned each call to track stages.
    const findNamedEdit = (/** @type {string} */ name) => {
        /** @type {{ feature: any, edit: any, active: boolean } | null} */
        let hit = null;
        // Count distinct edits by `apply`, which survives collectEdits' copy. One
        // edit on several glyph parts (a face's two eyes) is not a collision.
        /** @type {Set<any>} */
        const distinct = new Set();
        const stage = stages.getStage();
        for (const feature of features) {
            for (const edit of collectEdits(feature)) {
                if (edit.name !== name) continue;
                distinct.add(edit.apply);
                // The same test as `activeEdits`.
                const active = edit.stage == null || edit.stage === stage;
                if (!hit || (active && !hit.active)) hit = { feature, edit, active };
            }
        }
        if (distinct.size === 0) warn(`control:none:${name}`, `chart.control("${name}"): no edit is named "${name}".`);
        if (distinct.size > 1) warn(`control:many:${name}`, `chart.control("${name}"): ${distinct.size} different edits share the name "${name}"; driving the first.`);
        return hit;
    };

    // The scene node an edit acts on for a row: of the row's nodes, the one the
    // edit `grabs` (a stack's edge handle, an area's y2 handle). `ref` narrows it
    // to one handle (a port's side, a link's end). Not cached; nodes rebuild each update.
    const nodeFor = (/** @type {any} */ feature, /** @type {any} */ edit, /** @type {number} */ row, /** @type {any} */ ref = null) => {
        const own = (featureNodes[feature.id] || []).filter((/** @type {any} */ n) => n && !n.ghost && n.index === row
            && (!ref || ref.channel == null || n.channel === ref.channel)
            && (!ref || ref.side == null || n.side === ref.side));
        if (typeof edit.grabs !== 'function') return own[0] || null;
        // A node tagged for exactly this edit beats one any edit may grab.
        return own.find((/** @type {any} */ n) => n.channel != null && edit.grabs(n))
            || own.find((/** @type {any} */ n) => edit.grabs(n)) || null;
    };

    // The open begin()…end() stroke per edit name, shared by every handle, so
    // `control(n).begin()` and a later `control(n).end()` pair up.
    // `at` is where the stroke's pointer last was, so `end()` releases there.
    /** @type {Map<string, { row: number, node: any, at: { x: number, y: number } | null }>} */
    const strokes = new Map();

    // A handle bound to a named edit and datum. It routes by the edit's `gesture`;
    // the engine dispatch never knows a controller exists. `target` is a row
    // index, or `{ index, channel?, side? }` to name one of the row's handles.
    const control = (/** @type {string} */ name, /** @type {any} */ target = 0) => {
        const ref = target && typeof target === 'object' ? target : null;
        /** @type {number} */
        // A view of a context row or a chart element has a null index: no row.
        const index = ref ? (ref.index === undefined ? 0 : ref.index === null ? -1 : ref.index) : target;
        // `index` is row i of getData(); translate it to the mark's table.
        const rowOf = (/** @type {any} */ feature) => rowIndexOf(feature ? feature.table : schemaSpec.primary, index);

        // The edit, row and node a call drives, or null after a warning that says why.
        /** @param {string} method @returns {{ feature: any, edit: any, row: number, node: any } | null} */
        const resolve = (method) => {
            const found = findNamedEdit(name);
            if (!found) return null;
            const { feature, edit } = found;
            const call = `chart.control("${name}", ${index}).${method}()`;
            if (!rowTargeted(edit)) {
                warn(`control:plane:${name}`, `${call}: this edit has pick: "${edit.pick}", which finds its target from the pointer, so a row index cannot drive it. Send the gesture with chart.emit({ type, x, y }) in inner pixels instead.`);
                return null;
            }
            if (!found.active) {
                warn(`control:stage:${name}`, `${call}: this edit runs at stage ${edit.stage} and the chart is at stage ${stages.getStage()}, so nothing was written.`);
                return null;
            }
            const row = Number.isInteger(index) && index >= 0 ? rowOf(feature) : -1;
            if (row < 0 || row >= tableOf(feature).length) {
                warn(`control:index:${name}`, `${call}: there is no row ${index}. The index counts the rows getData() reports, from 0, context rows left out.`);
                return null;
            }
            const node = nodeFor(feature, edit, row, ref);
            if (!node) {
                const which = ref && (ref.channel != null || ref.side != null)
                    ? ` with ${[ref.channel != null ? `channel "${ref.channel}"` : '', ref.side != null ? `side "${ref.side}"` : ''].filter(Boolean).join(' and ')}`
                    : '';
                warn(`control:node:${name}:${index}`, `${call}: row ${index} draws no node${which} this edit acts on${typeof edit.grabs === 'function' ? ' (it acts only on some of a row\'s nodes, such as the handle on a boundary, and this row has none)' : ''}.`);
                return null;
            }
            return { feature, edit, row, node };
        };

        // Encodes a value to the pointer that would set it, through the scales the
        // edit inverts. Untouched axes keep the datum's current pixel. `encoded` is
        // false when no channel could carry the value.
        /** @param {{ feature: any, edit: any, row: number, node: any }} t @param {any} value */
        const dragPointer = (t, value) => {
            const { feature, edit, row, node } = t;
            const center = markCenter(node);
            const datum = tableOf(feature)[row];
            const channels = feature.channels || {};
            const editScales = frameScalesFor(feature, node, row) || chart.scales;
            // A handle sits on its own pixel, not the datum's x/y (a stack's edge).
            const own = typeof edit.grabs === 'function' && center;
            let x = datum && !own ? encodeChannel(editScales, channels, 'x', datum, center ? center.cx : 0) : (center ? center.cx : 0);
            let y = datum && !own ? encodeChannel(editScales, channels, 'y', datum, center ? center.cy : 0) : (center ? center.cy : 0);
            let encoded = false;
            if (value === undefined) return { x, y, encoded };
            const resolved = resolveChannels(edit.channels, channels, editScales, feature);
            // `value` is a scalar, or a { channel | field: v } map for a multi-channel edit.
            const valueFor = (/** @type {any} */ ch) => {
                if (value != null && typeof value === 'object' && !(value instanceof Date)) {
                    if (ch.name in value) return value[ch.name];
                    if (ch.field != null && ch.field in value) return value[ch.field];
                    return undefined;
                }
                return value; // scalar applies to the sole channel
            };
            for (const ch of resolved) {
                if (!ch.scale || !ch.scale.invertible) continue;
                const v = valueFor(ch);
                if (v === undefined) continue;
                const visual = ch.scale.encode(v);
                const p = pointerForChannel(ch.name, visual, center);
                if (!p) continue;
                // A positional channel sets its own coordinate; a pivot channel
                // (radius, bearing) sets both.
                const a = axisOf(ch.name);
                if (a !== 'y') x = p.x;
                if (a !== 'x') y = p.y;
                encoded = true;
            }
            return { x, y, encoded };
        };

        const handle = {
            // Writes a value. A commit-gesture edit gets it as `ctx.value`; a drag edit
            // gets it encoded to a pointer.
            set(/** @type {any} */ value) {
                const t = resolve('set');
                if (!t) return;
                const { edit, node } = t;
                // editName keeps a sibling edit on the same gesture from also firing,
                // and tells dispatch not to ask the edit's `when`.
                if (edit.gesture === 'commit') {
                    emit({ type: 'commit', node, value, editName: name, x: node.cx || 0, y: node.cy || 0 });
                    return;
                }
                const { x, y, encoded } = dragPointer(t, value);
                // `inverts: 'domain'` (slide) maps pointer travel, not a scale's pixel.
                if (!encoded || edit.inverts === 'domain') {
                    warn(`control:encode:${name}`, `chart.control("${name}").set(): this ${edit.type} edit doesn't read its value off a channel's scale, so a value can't be turned into a pointer. Drive it with begin(), emit({ type: "drag", x, y }) in inner pixels, then end().`);
                    return;
                }
                const event = { type: 'drag', node, x, y, editName: name };
                const s = strokes.get(name);
                if (s) {
                    if (s.row !== t.row) {
                        warn(`control:stroke:${name}`, `chart.control("${name}", ${index}).set(): begin() opened a stroke on another row; end() it first.`);
                        return;
                    }
                    s.at = { x, y };
                    emit(event);
                    return;
                }
                // A driver (relative move) anchors at dragstart, so it gets a whole
                // stroke. Any other edit takes one self-closing drag.
                if (driverFor(edit)) {
                    const at = dragPointer(t, undefined);
                    emit({ type: 'dragstart', node, x: at.x, y: at.y, editName: name });
                    emit(event);
                    emit({ type: 'dragend', node, x, y, editName: name });
                } else {
                    emit({ ...event, nudge: true });
                }
            },
            // begin()/end() bracket one txn, so many .set() ticks are one undo entry.
            begin(/** @type {{ x: number, y: number }} */ at) {
                if (strokes.has(name)) return;
                const t = resolve('begin');
                if (!t) return;
                // Press at the datum's own pixel, so a relative edit anchors there;
                // or at `at`, for a stroke that follows a pointer pressed elsewhere.
                const { x, y } = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? at : dragPointer(t, undefined);
                strokes.set(name, { row: t.row, node: t.node, at: { x, y } });
                emit({ type: 'dragstart', node: t.node, x, y, editName: name });
            },
            // Release where the stroke's pointer last was.
            end() {
                const s = strokes.get(name);
                if (!s) return;
                strokes.delete(name);
                emit({ type: 'dragend', node: s.node, editName: name, ...(s.at || {}) });
            },
            // Abandon the open stroke: no release, so a drop commits nothing.
            cancel() {
                if (!strokes.delete(name)) return;
                abortStroke();
                endTxn();
                update();
            },
            // Fires a value-less edit (cycle, remove, toggle) with its own gesture on
            // the datum's node, or with `gesture` if given.
            fire(/** @type {string} */ gesture) {
                const t = resolve('fire');
                if (!t) return;
                emit({ type: gesture || t.edit.gesture || 'click', node: t.node, editName: name });
            },
            // Raw passthrough to this edit alone, auto-scoped to the node it acts on
            // for the datum. A plane edit gets no node, so its `x`/`y` route through
            // the plane.
            emit(/** @type {any} */ event) {
                const s = strokes.get(name);
                let node = s ? s.node : undefined;
                if (!s) {
                    const found = findNamedEdit(name);
                    const row = found && Number.isInteger(index) && index >= 0 ? rowOf(found.feature) : -1;
                    if (found && found.edit.pick === 'direct' && row >= 0) node = nodeFor(found.feature, found.edit, row, ref) || undefined;
                }
                if (s && event && event.x != null && event.y != null) s.at = { x: event.x, y: event.y };
                emit({ node, editName: name, ...event });
            },
            // The values this channel accepts, read off its scale, for external UI.
            accepts() {
                const found = findNamedEdit(name);
                if (!found) return null;
                const { feature, edit } = found;
                const editScales = frameScalesFor(feature, null, rowOf(feature)) || chart.scales;
                const ch = resolveChannels(edit.channels, feature.channels || {}, editScales, feature)[0];
                const scale = /** @type {any} */ (ch && ch.scale);
                const fieldSpec = (ch && ch.field && fieldsOf(schemaSpec, feature.table)[ch.field]) || null;
                const measure = (fieldSpec && fieldSpec.type) || null;
                // The scale's domain, else the schema's declared domain.
                const domain = (scale && typeof scale.domain === 'function' ? scale.domain() : null)
                    || (fieldSpec && fieldSpec.domain) || null;
                const range = scale && typeof scale.range === 'function' ? scale.range() : null;
                return {
                    field: ch ? ch.field : null,
                    type: measure,                         // MeasureType (quantitative/categorical/…)
                    kind: scale ? scale.kind : null,       // band | point | continuous | discrete
                    temporal: !!(scale && scale.temporal),
                    invertible: !!(scale && scale.invertible),
                    // The value set (discrete) or [min, max] (continuous).
                    domain,
                    values: (
                        (scale && (scale.kind === 'band' || scale.kind === 'point' || (scale.kind === 'discrete' && !scale.ramp)))
                        || measure === 'categorical' || measure === 'ordinal'
                    ) ? domain : null,
                    range,
                };
            },
        };
        return handle;
    };

    // 'reflow' mode: re-render on container resize, once per frame, and only when
    // the size changed (so a render can't loop).
    /** @type {ResizeObserver | null} */
    let ro = null;
    if (mode === 'reflow' && typeof ResizeObserver !== 'undefined') {
        let scheduled = false;
        ro = new ResizeObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                if (measure()) update();
            });
        });
        ro.observe(container);
    }

    /** @type {any} */
    let themeCopy = null;

    return {
        // The dataset's methods, delegated (the same functions).
        getData: dataset.getData,
        getSchema: dataset.getSchema,
        setData: dataset.setData,
        setDomain: dataset.setDomain,
        set: dataset.set,
        patch: dataset.patch,
        undo: dataset.undo,
        redo: dataset.redo,
        canUndo: dataset.canUndo,
        canRedo: dataset.canRedo,
        transaction: dataset.transaction,
        getSelection: dataset.getSelection,
        getSelectionAll: dataset.getSelectionAll,
        select: dataset.select,
        toggleSelection: dataset.toggleSelection,
        selectAll: dataset.selectAll,
        selectWhere: dataset.selectWhere,
        clearSelection: dataset.clearSelection,
        hover: dataset.hover,
        getHover: dataset.getHover,
        dataset,
        dom: () => container,
        // `stage`, `render` and `destroy` are this chart's; `change`, `select`,
        // `hover` and `gesture` are the dataset's.
        on(type, cb) {
            if (type !== 'stage' && type !== 'render' && type !== 'destroy') return dataset.on(/** @type {any} */ (type), cb);
            const set = listeners[type];
            set.add(cb);
            return () => set.delete(cb);
        },
        // The read surface for outside UI (engine/view.js).
        ...view,
        // A copy of the resolved theme, made on first read.
        get theme() {
            if (!themeCopy) themeCopy = structuredClone(theme);
            return themeCopy;
        },
        // Multi-stage controls (see engine/stages.js).
        getStage: stages.api.getStage,
        getStageLabel: stages.api.getStageLabel,
        setStage: stages.api.setStage,
        nextStage: stages.api.nextStage,
        emit,
        control,
        // Detaches from the dataset, disconnects the reflow observer and releases
        // the renderer.
        destroy() {
            for (const cb of [...listeners.destroy]) cb();
            listeners.render.clear();
            listeners.destroy.clear();
            detach();
            if (ro) { ro.disconnect(); ro = null; }
            stopMotion();
            if (typeof renderer.destroy === 'function') renderer.destroy();
        },
    };
}
