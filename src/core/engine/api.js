// @ts-check
import { collectEdits, resolveChannels } from '../../edit/route.js';
import { markCenter } from '../../edit/shared.js';
import { encodeChannel } from '../../plot/mark.js';
import { fieldsOf } from '../schema.js';
import { axisOf, pointerForChannel } from '../encoding.js';
import { warn } from '../dev.js';

/**
 * @typedef {object} ApiDeps
 * @property {import('../../types').Dataset} dataset  the public dataset this chart draws
 * @property {() => void} detach  detach the chart from its dataset
 * @property {any[]} features
 * @property {{ stage: Set<Function> }} listeners
 * @property {Record<string, any[]>} featureNodes
 * @property {import('../../types').SchemaSpec} schemaSpec
 * @property {'fixed' | 'scale' | 'reflow'} mode
 * @property {HTMLDivElement} container
 * @property {ReturnType<typeof import('./stages.js').createStages>} stages
 * @property {(feature: any) => any[]} tableOf
 * @property {(name: string, i: number) => number} rowIndexOf
 * @property {(feature: any, node: any, index?: number | null) => import('../../types').ScaleMap | null} frameScalesFor
 * @property {(edit: import('../../types').Edit) => boolean} rowTargeted
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
        dataset, detach, features, listeners, featureNodes, schemaSpec, mode, container, stages, tableOf, rowIndexOf, frameScalesFor, rowTargeted, measure, stopMotion,
    } = deps;
    const handleEvent = (/** @type {any} */ event) => deps.handleEvent(event);
    const update = () => deps.update();

    // External control synthesizes renderer-shaped events and feeds them to the
    // one `handleEvent`, so constraints, undo and listeners all run as usual.

    // Injects a renderer-shaped event: { type, node?, x?, y?, value?, nudge?, rawEvent? },
    // with `x`/`y` in inner (margin-subtracted) pixels.
    const emit = (/** @type {any} */ event) => handleEvent(event);

    // Finds the (feature, edit) with this `name`. Scanned each call to track stages.
    const findNamedEdit = (/** @type {string} */ name) => {
        /** @type {{ feature: any, edit: any } | null} */
        let hit = null;
        // Count distinct edits by `apply`, which survives collectEdits' copy. One
        // edit on several glyph parts (a face's two eyes) is not a collision.
        /** @type {Set<any>} */
        const distinct = new Set();
        for (const feature of features) {
            for (const edit of collectEdits(feature)) {
                if (edit.name !== name) continue;
                distinct.add(edit.apply);
                if (!hit) hit = { feature, edit };
            }
        }
        if (distinct.size === 0) warn(`control:none:${name}`, `chart.control("${name}"): no edit is named "${name}".`);
        if (distinct.size > 1) warn(`control:many:${name}`, `chart.control("${name}"): ${distinct.size} different edits share the name "${name}"; driving the first.`);
        return hit;
    };

    // The current scene node for a datum (not cached; nodes rebuild each update).
    const nodeAt = (/** @type {any} */ feature, /** @type {number} */ index) =>
        (featureNodes[feature.id] || []).find((/** @type {any} */ n) => n && n.index === index) || null;

    // A handle bound to a named edit and datum. It routes by the edit's `gesture`;
    // the engine dispatch never knows a controller exists.
    const control = (/** @type {string} */ name, /** @type {number} */ index = 0) => {
        // `index` is row i of getData(); translate it to the mark's table.
        const rowOf = (/** @type {any} */ feature) => rowIndexOf(feature ? feature.table : schemaSpec.primary, index);
        // Encodes a value to the pointer that would set it, through the scales the
        // edit inverts. Untouched axes keep the datum's current pixel.
        const dragPointer = (/** @type {any} */ feature, /** @type {any} */ edit, /** @type {any} */ value) => {
            const node = nodeAt(feature, rowOf(feature));
            const center = markCenter(node);
            const datum = tableOf(feature)[rowOf(feature)];
            const channels = feature.channels || {};
            const editScales = frameScalesFor(feature, node, rowOf(feature)) || chart.scales;
            let x = datum ? encodeChannel(editScales, channels, 'x', datum, center ? center.cx : 0) : (center ? center.cx : 0);
            let y = datum ? encodeChannel(editScales, channels, 'y', datum, center ? center.cy : 0) : (center ? center.cy : 0);
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
            }
            return { node, x, y };
        };

        // True between begin() and end(), so `.set` emits a plain `drag` into the
        // open txn instead of a self-closing `nudge`.
        let live = false;

        // Warns when the edit needs a pointer, not a row, to drive it.
        /**
         * @param {{ feature: any, edit: any } | null} found @param {string} method
         * @returns {found is { feature: any, edit: any }}
         */
        const drivable = (found, method) => {
            if (!found) return false;
            if (rowTargeted(found.edit)) return true;
            warn(`control:plane:${name}`, `chart.control("${name}").${method}(): this edit has pick: "${found.edit.pick}", which finds its target from the pointer, so a row index cannot drive it. Send the gesture with chart.emit({ type, x, y }) in inner pixels instead.`);
            return false;
        };

        const handle = {
            // Writes a value. A commit-gesture edit gets it as `ctx.value`; a drag edit
            // gets it encoded to a pointer.
            set(/** @type {any} */ value) {
                const found = findNamedEdit(name);
                if (!drivable(found, 'set')) return;
                const { feature, edit } = found;
                const node = nodeAt(feature, rowOf(feature));
                // editName keeps a sibling edit on the same gesture from also firing.
                if (edit.gesture === 'commit') {
                    emit({ type: 'commit', node, value, editName: name, x: node ? node.cx : 0, y: node ? node.cy : 0 });
                    return;
                }
                const { node: n, x, y } = dragPointer(feature, edit, value);
                emit(live
                    ? { type: 'drag', node: n, x, y, editName: name }
                    : { type: 'drag', node: n, x, y, nudge: true, editName: name });
            },
            // begin()/end() bracket one txn, so many .set() ticks are one undo entry.
            begin() {
                const found = findNamedEdit(name);
                if (!drivable(found, 'begin')) return;
                live = true;
                // Press at the datum's own pixel, so a relative edit anchors there.
                const { node, x, y } = dragPointer(found.feature, found.edit, undefined);
                emit({ type: 'dragstart', node, x, y, editName: name });
            },
            end() {
                const found = findNamedEdit(name);
                live = false;
                if (!found) return;
                emit({ type: 'dragend', node: nodeAt(found.feature, rowOf(found.feature)), editName: name });
            },
            // Fires a value-less edit (cycle, remove, toggle) with its own gesture on
            // the datum's node, or with `gesture` if given.
            fire(/** @type {string} */ gesture) {
                const found = findNamedEdit(name);
                if (!drivable(found, 'fire')) return;
                const g = gesture || found.edit.gesture || 'click';
                emit({ type: g, node: nodeAt(found.feature, rowOf(found.feature)), editName: name });
            },
            // Raw passthrough, auto-scoped to this feature's node for the datum.
            emit(/** @type {any} */ event) {
                const found = findNamedEdit(name);
                emit({ node: found ? nodeAt(found.feature, rowOf(found.feature)) : undefined, ...event });
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
        // `stage` is this chart's; `change`, `select`, `hover` and `gesture` are the dataset's.
        on(type, cb) {
            if (type !== 'stage') return dataset.on(/** @type {any} */ (type), cb);
            listeners.stage.add(cb);
            return () => listeners.stage.delete(cb);
        },
        // Multi-stage controls (see engine/stages.js).
        getStage: stages.api.getStage,
        getStageLabel: stages.api.getStageLabel,
        setStage: stages.api.setStage,
        nextStage: stages.api.nextStage,
        emit,
        control,
        // Detaches from the dataset and disconnects the reflow observer.
        destroy() {
            detach();
            if (ro) { ro.disconnect(); ro = null; }
            stopMotion();
        },
    };
}
