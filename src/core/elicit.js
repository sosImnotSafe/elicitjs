// @ts-check
import { clipRect, clipProblem, DEFAULT_MARGINS } from './scene.js';
import { resolveScales } from './resolve.js';
import { collectEdits } from '../edit/route.js';
import { clipVisible } from '../edit/pick.js';
import { autoEditGuides } from '../edit/guide.js';
import { D3Renderer } from '../renderers/d3-renderer/index.js';
import { resolveEffects } from './effects.js';
import { hasNeighbours } from './neighbours.js';
import { resolveTheme } from './theme.js';
import { nestingOf } from './hierarchy.js';
import { warn } from './dev.js';
import { createDataset } from './dataset.js';
import { createChartState } from './engine/state.js';
import { createStages } from './engine/stages.js';
import { createNodes } from './engine/nodes.js';
import { createCompute } from './engine/compute.js';
import { createDispatch } from './engine/dispatch.js';
import { createRender } from './engine/render.js';
import { resolveMotion } from './motion.js';
import { createChartApi } from './engine/api.js';
import {
    assembleFeatures, bindFeatureTables, desugarPorts, desugarContainers, tipGuidesOf, viewerChannelsOf,
} from './engine/features.js';
import { warnUnknownSpecKeys } from './guards.js';

/**
 * A dataset and one chart over it, from one spec: `Elicit.dataset(spec).chart(spec)`.
 * Both halves read the same object, each its own keys.
 * @param {import('../types').ElicitSpec} spec
 * @returns {import('../types').Chart}
 */
export function Elicit(spec) {
    warnUnknownSpecKeys(spec, 'Elicit');
    return createChart(createDataset(spec, chartOf), spec);
}

/**
 * A dataset that any number of charts read and write (`ds.chart(spec)`).
 * @param {import('../types').DatasetSpec} spec
 * @returns {import('../types').Dataset}
 */
Elicit.dataset = (spec) => {
    warnUnknownSpecKeys(spec, 'Elicit.dataset');
    return createDataset(spec, chartOf).api;
};

/**
 * `ds.chart(spec)`: a chart spec alone, so a dataset key here is a mistake.
 * @param {import('./dataset.js').Dataset} dataset
 * @param {import('../types').ChartSpec} spec
 */
function chartOf(dataset, spec) {
    warnUnknownSpecKeys(spec, 'chart');
    return createChart(dataset, spec);
}

/**
 * Builds one chart over a dataset (core/dataset.js) and attaches it.
 * @param {import('./dataset.js').Dataset} dataset
 * @param {import('../types').ChartSpec} spec
 * @returns {import('../types').Chart}
 */
function createChart(dataset, spec) {
    const {
        width = 600,
        height = 400,
        margins = DEFAULT_MARGINS,
        // `schema` and `scales` are read off the spec by resolveScales; `marks`,
        // `elements`, `axes` and `legends` become the feature list (engine/features.js).
        guides = [],
        // Interaction effects (core/effects.js).
        effects: effectsSpec,
        // Sizing: 'fixed' (default) renders at width/height; 'scale' draws once in a
        // viewBox the browser scales; 'reflow' re-renders at the parent's width on
        // resize. `responsive: true` means 'reflow'.
        responsive,
        // SVG overflow. 'visible' shows content in the margin band (radial/gauge
        // axis labels).
        overflow = 'hidden',
        // Browser focus ring on editable marks; off by default (keyboard still works).
        focusOutline = false,
        renderer = new D3Renderer()
    } = spec;

    const mode = responsive === true ? 'reflow'
        : (responsive === 'scale' || responsive === 'reflow') ? responsive
            : 'fixed';

    // Theme: DEFAULT_THEME < setTheme() base < spec.theme. It also supplies the
    // effects defaults that the chart's own `effects` overrides.
    const theme = resolveTheme(spec.theme);
    const effects = resolveEffects(effectsSpec, theme.effects);
    for (const state of Object.keys(effects)) {
        if (effects[state].neighbours && !hasNeighbours(dataset.schemaSpec)) {
            warn(`effects:neighbours:${state}`, `effects.${state}.neighbours: this dataset links no rows (no "ref" column), so there are no neighbours to show. It applies to network and hierarchy datasets.`);
        }
    }
    // Is this chart's hover the dataset's? `true` sends and shows it, 'receive'
    // only shows it. Unset, it links once a second chart draws the dataset.
    /** @returns {true | false | 'receive'} */
    const hoverLink = () => {
        const h = effects.hovered;
        if (!h || h.enabled === false) return false;
        return h.link != null ? h.link : port.linked();
    };
    // Does a hover light its row in every mark over the table, inert ones too?
    // Yes when linked, or when the spec mutes the other rows or asks for neighbours.
    const hoverWide = () => {
        const h = effects.hovered;
        if (!h || h.enabled === false) return false;
        return hoverLink() !== false || !!h.others || !!h.neighbours;
    };

    // The flattened feature list: auto axes, elements, marks, implicit legends —
    // each with an id (engine/features.js).
    const features = assembleFeatures(spec, theme);
    // Static, so the legend reservation step is skipped for a chart with no legend.
    const hasLegends = features.some((f) => f && f.isLegend);
    // Does an axis carry a title that may need room past the author's margin?
    const hasAxisTitles = features.some((f) => f && f.isAxis && typeof f.measureTitle === 'function');

    // The data side: schema, rows, context, lock, constraints, undo, selection
    // (core/dataset.js).
    const { schemaSpec, seedSchemaSpec } = dataset;

    // The bindings a commit or a resize reassigns live on one shared object, so the
    // engine modules wired below read the live value (see engine/state.js).
    // `chart.tables` / `chart.contextRows` read and write the dataset.
    const chart = createChartState(dataset);
    // Transient interaction state, never part of the dataset:
    //   session    per-feature driver session (proximity selection, sweep/draw locks)
    //   preview    per-feature uncommitted proposal a driver parked (probe hover/drag),
    //              drawn as an inert ghost of the rows it would change. Never reaches
    //              onChange or getData; cleared on commit, hoverout and stage change.
    //   selection  selected rows, qualified by table: the dataset's set (engine/selection.js)
    //   hover      the feature+row under the pointer, from the renderer's hover events
    //   grab       the feature+row a drag is on, so the state pass decides `grabbed`
    //   pointer, hit, hits  the pointer in scene coordinates and the rows under it,
    //              recorded only when a guide `tracksPointer`; never dispatched
    /** @type {{ session: Record<string, any>, preview: Record<string, { table: string, rows: any[], pointer?: { x: number, y: number }, dropInto?: number | null }> | null, selection: Set<string>, hover: { featureId: string, index: number, node?: any } | null, grab: { featureId: string, index: number } | null, pointer: { x: number, y: number } | null, hit: { featureId: string, index: number, node: any } | null, hits: { featureId: string, index: number, node: any }[] }} */
    const ui = { session: {}, preview: null, selection: dataset.selection, hover: null, grab: null, pointer: null, hit: null, hits: [] };

    // This chart's way into the dataset (attached below, once the chart is built).
    // Commits made through it are this chart's.
    const recordHistory = () => port.recordHistory();
    const notifyChange = () => port.notifyChange();
    /** @param {any} sel @param {string} [table] */
    const commitSelectionEdit = (sel, table) => port.commitSelectionEdit(sel, table);
    const txn = {
        recordHistory,
        gestureTxn: (/** @type {string} */ type) => port.gestureTxn(type),
        endTxn: () => port.endTxn(),
    };

    // Working dims. 'reflow' tracks the container's width; marks and scales read
    // the inner dims, so a resize only recomputes those.
    const designW = typeof width === 'number' ? width : 600;
    const designH = typeof height === 'number' ? height : 400;
    chart.curW = designW;
    chart.curH = designH;
    // Effective margins = author margins + legend bands (core/legends.js),
    // recomputed every render.
    const authorMargins = margins;
    chart.effectiveMargins = { ...authorMargins };
    chart.innerWidth = chart.curW - chart.effectiveMargins.left - chart.effectiveMargins.right;
    chart.innerHeight = chart.curH - chart.effectiveMargins.top - chart.effectiveMargins.bottom;

    // The primary table's field map, by identity, so in-place domain writes keep
    // schemaSpec consistent.
    /** @type {Record<string, import('../types').FieldSchema>} */
    const schema = schemaSpec.tables[schemaSpec.primary].fields;

    // Dataset accessors (engine/tables.js).
    const {
        tableOf, targetTableOf, primaryRows,
        rowIndexOf, isLockedIn, constraintsIn, checkRows,
    } = dataset;

    // Which table each feature is a view over, by name or by role (engine/features.js).
    bindFeatureTables(features, schemaSpec);

    // `ports` on a node mark desugars into a sibling port feature (engine/features.js).
    const nodesTableName = schemaSpec.byRole.nodes || null;
    desugarPorts(features, nodesTableName);

    // `contains` / `dodge` / `fit` under a hierarchy (engine/features.js).
    const hierarchyNodes = nestingOf(schemaSpec) ? nodesTableName : null;
    desugarContainers(features, hierarchyNodes);
    // The feature list is fixed from here; on a shared id the first feature wins.
    /** @type {Map<string, any>} */
    const featureById = new Map();
    for (const f of features) if (!featureById.has(f.id)) featureById.set(f.id, f);

    // The node table's rules (box, ports, contains, dodge) and the hierarchy's
    // settling, read once from the marks that draw the nodes (engine/nodes.js).
    const {
        boxHosts, nodeBoxRule, nodePortsRule, containsRule,
        settleNodes, settleOwn, settledNodes, inFlight, heldStill,
    } = createNodes(chart, {
        features, schemaSpec, ui, nodesTableName, hierarchyNodes, isLockedIn,
        settleTurn: (stroking) => port.settleTurn(stroking),
    });
    // The channel map of the mark that draws a table (engine/features.js).
    const channelsDrawing = viewerChannelsOf(features);

    // The resolver sees the resolved theme, for its colour-range fallbacks.
    const liveSpec = { ...spec, schema, schemaSpec, theme };

    // The primary table's invariants, for the guide layer.
    const datasetConstraints = constraintsIn(schemaSpec.primary);

    // Guides: an edit with `guide: true` self-draws (edit/guide.js); a mark's `tip`
    // shorthand desugars into a tip guide (engine/features.js).
    const tipGuides = tipGuidesOf(features);
    const allGuides = [...autoEditGuides(features), ...guides, ...tipGuides];
    // Does any guide read the pointer? Then the renderers report pointer movement
    // and the engine re-renders on it; otherwise a chart never pays for that.
    const tracksPointer = allGuides.some((g) => g && g.tracksPointer);

    // Was the plane raised on the last render? Only then does a hover arrive as
    // a plane gesture over a mark (see handleEvent's hover routing).
    chart.planeRaised = false;
    // Clip marks to the plot rect? `spec.clip` decides; unset, clip when any edit
    // in any stage declares `viewport`, so a stage change never flips it.
    // `clipRect` is the one place the rect is computed.
    const clipAuto = features.some((f) => collectEdits(f).some((e) => e.viewport));
    { const problem = clipProblem(spec.clip); if (problem) warn('spec:clip', problem); }
    const clipNow = () => clipRect(spec.clip, clipAuto, chart.innerWidth, chart.innerHeight);
    // Past the clip rect only `unclipped` nodes are hit-testable, matching what is drawn.
    /** @param {any[]} nodes @param {number} x @param {number} y */
    const visibleAt = (nodes, x, y) => clipVisible(nodes, x, y, clipNow());

    // Does the last built scene carry any `onHover` node (a port)? Then a hover
    // change must re-render even when the `hovered` effect paints nothing.
    chart.sceneHasOnHover = false;
    /**
     * Which handle of a row a node is, by the tags marks use to tell their handles
     * apart — stable across rebuilds, which object identity is not.
     * @param {any} node
     */
    const handleKey = (node) => (node
        ? `${node.index}\0${node.channel ?? ''}\0${node.side ?? ''}\0${node.vertexIndex ?? ''}`
        : '');

    // Caller-facing observers: `change` per committed edit, `stage` on setStage,
    // `select` on a selection change (no data moved, so not a `change`). `change`
    // and `select` are the dataset's; `stage` is the chart's.
    /** @type {{ change: Set<Function>, stage: Set<Function>, select: Set<Function> }} */
    const listeners = { change: dataset.listeners.change, stage: new Set(), select: dataset.listeners.select };
    // The hover this chart handed to the dataset, if it is linked.
    /** @param {{ table: string, index: number } | null} row */
    const commitHover = (row) => port.commitHover(row);

    // Multi-stage elicitation (engine/stages.js): `activeEdits` is the single gate
    // the dispatch/editable/plane-on-top paths run their edits through.
    const stages = createStages({
        spec, ui, listeners, update: () => update(),
        // A stage change drops the hover with the other transients.
        clearSelection: () => { commitSelectionEdit({ clear: true }); commitHover(null); },
    });
    const { getStage, activeEdits, applyStage } = stages;

    // Selection (engine/selection.js): which rows the reader has picked, stored
    // qualified BY table, and the commit path both edit.select and the select* API use.
    const { selectionIn, selectionPrimary, selectionList } = dataset;

    // The most recently built scene nodes per feature, so plane-pick edits can
    // hit-test against exact mark geometry and guides can look marks up by index.
    /** @type {Record<string, any[]>} */
    const featureNodes = {};

    // How an edit runs, from gesture to commit (engine/compute.js): the context its
    // apply() sees, the invariants that judge it, the commit, the preview, and the
    // trial commits that decide which drop targets show.
    const {
        frameScalesFor, arbitrates, runEdit,
        previewEdit, reachableKeys, portAvailable,
    } = createCompute(chart, {
        schemaSpec, seedSchemaSpec, ui, featureNodes, hierarchyNodes, boxHosts,
        tableOf, targetTableOf, isLockedIn, checkRows,
        nodeBoxRule, nodePortsRule, containsRule, channelsDrawing,
        settleNodes, settledNodes, heldStill, activeEdits,
        selectionPrimary, commitSelectionEdit, recordHistory, notifyChange,
        noteEdit: (edit) => port.noteEdit(edit),
        applyResize: (size) => applyResize(size),
    });

    // 2. Scales: one global scale per channel, from every feature's channels and
    //    the schema. Recomputed each render so inferred domains track edits.
    const dims = { width: chart.innerWidth, height: chart.innerHeight };
    chart.scales = resolveScales(features, chart.tables, liveSpec, dims);

    // Rendering (engine/render.js): the container and its size, and `update()`,
    // which rebuilds the scene from current state and hands it to the renderer.
    const { container, measure, applyResize, update, stopMotion, followsPointer } = createRender(chart, {
        features, featureById, ui, spec, theme, effects, renderer, mode, overflow, focusOutline, designW, authorMargins, dims, liveSpec, schema, schemaSpec, allGuides, datasetConstraints, tracksPointer, hasLegends, hasAxisTitles, featureNodes, hierarchyNodes, boxHosts, tableOf, targetTableOf, primaryRows, isLockedIn, constraintsIn, nodeBoxRule, nodePortsRule, settleOwn, settledNodes, heldStill, inFlight, activeEdits, getStage, selectionIn, selectionList, selectionPrimary, hoverRow: dataset.hoverRow, hoverLink, hoverWide, portAvailable, handleKey, clipNow, visibleAt,
        layoutMoved: () => port.layoutMoved(),
        motionDuration: resolveMotion(spec.motion),
        handleEvent: (/** @type {any} */ event) => handleEvent(event),
    });

    // Event routing (engine/dispatch.js): the one path from a renderer's event to
    // the edits — direct to the touched mark, plane gestures through the drivers.
    const { handleEvent, rowTargeted, dropStroke } = createDispatch(chart, {
        features, featureById, ui, effects, tracksPointer, featureNodes, hierarchyNodes, boxHosts,
        history: txn, tableOf, activeEdits, getStage, applyStage, arbitrates, frameScalesFor,
        runEdit, previewEdit, reachableKeys, settledNodes, heldStill, notifyChange,
        ownsLayout: () => port.ownsLayout(),
        handleKey, visibleAt, hoverLink, hoverWide, commitHover,
        followsPointer: () => followsPointer(),
        update: () => update(),
    });

    // Attach to the dataset. It redraws this chart after another chart's commit,
    // an undo, `set` or a selection change; an undo step also restores the chart's
    // size (an axis grow). Commits made through the port are this chart's, so the
    // dataset redraws only the others (this one renders itself).
    const port = dataset.attach({
        update: () => update(),
        settles: () => !!hierarchyNodes && boxHosts.length > 0,
        showsHover: () => hoverLink() !== false,
        snapshot: () => ({ width: chart.curW, height: chart.curH }),
        restore: (size) => {
            if (size && (size.width !== chart.curW || size.height !== chart.curH)) applyResize(size);
            ui.preview = null;
        },
        drop: (what) => {
            ui.preview = null;
            if (what === 'preview') return;
            // Another chart's commit or new data: the row indices these hold may be stale.
            ui.hover = null;
            ui.grab = null;
            dropStroke();
            chart.stroking = false;
            chart.strokeNodes = null;
            chart.strokeRow = null;
            if (what === 'reseed') chart.snapNext = true;
        },
    });

    // Settle a seeded hierarchy now, against the declared size, so `getData()` is
    // already exact before the first (deferred) render. Only the first chart to
    // settle a dataset does; a later one draws the rows as they are.
    if (settleOwn()) port.layoutMoved();

    // The public Chart (engine/api.js). Observation only: edits stay the one
    // path that mutates data.
    const api = createChartApi(chart, {
        dataset: dataset.api, detach: port.detach, features, listeners, featureNodes, schemaSpec, mode,
        container: /** @type {HTMLDivElement} */ (container),
        stages, tableOf, rowIndexOf, frameScalesFor, rowTargeted, measure, stopMotion,
        handleEvent: (/** @type {any} */ event) => handleEvent(event),
        update: () => update(),
    });

    // Initial render. Deferred so the container can be attached to the DOM first
    // if the renderer needs measured dimensions.
    setTimeout(update, 0);

    return api;
}
