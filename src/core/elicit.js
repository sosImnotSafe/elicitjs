// @ts-check
import { SceneGraph, paintOrder } from './scene.js';
import { resolveScales } from './resolve.js';
import { createProjection } from './projection.js';
import { resolveLock, lockConstraint, isNodeLocked } from './lock.js';
import { collectEdits, resolveChannels, warnMisplacedEdits } from '../edit/route.js';
import { markCenter, nudgeTarget } from '../edit/shared.js';
import { encodeChannel } from '../plot/mark.js';
import { drivers, driverFor, needsPlaneOnTop } from '../edit/drivers/index.js';
import { autoEditGuides } from '../edit/guide.js';
import { D3Renderer } from '../renderers/d3-renderer/index.js';
import { resolveEffects, stateEffectNodes, effectStyleFor, elementEffectOf } from './effects.js';
import { resolveTheme } from './theme.js';
import { autoAxes } from './axes.js';
import { reserveLegends, legendsFromChannels } from './legends.js';
import {
    validateTables, inferMeasureOfDomain,
    normalizeSchema, denormalizeSchema, normalizeData, isBareForm, enforceRefs,
} from './schema.js';
import { axisOf, pointerForChannel } from './encoding.js';
import { warn } from './dev.js';
import { applyConstraint } from '../constraints/define.js';
import {
    markLabel, constraintLabel, describe,
    warnScaleRequirements, warnScopeMismatch, warnProjectionCartesianMix,
    warnDuplicatePlaneEdits, warnUnreachableLegendRow, warnConnectConflict,
    warnCreateOnNonMark, warnCreateEmptyExtent, warnDeadEditChannels,
    warnUnknownSpecKeys, warnUnclaimedPick, warnUnknownEditOptions,
} from './guards.js';

/**
 * Dim a ghost-preview node in place. Multiplies its existing opacity by the theme's
 * ghost opacity (so an already-faint mark stays proportionally faint) and, when the
 * theme names them, overrides fill/stroke/dash so the preview reads as tentative.
 * @param {any} node @param {any} ghost the theme.ghost tokens
 */
function applyGhostStyle(node, ghost) {
    const g = ghost || {};
    const base = node.opacity != null ? node.opacity : 1;
    node.opacity = base * (g.opacity != null ? g.opacity : 0.45);
    if (g.fill != null) node.fill = g.fill;
    if (g.stroke != null) node.stroke = g.stroke;
    if (g.strokeDasharray != null) node.strokeDasharray = g.strokeDasharray;
}


/**
 * @param {import('../types').ElicitSpec} spec
 * @returns {import('../types').ElicitElement}
 */
export function Elicit(spec) {
    warnUnknownSpecKeys(spec);
    const {
        width = 600,
        height = 400,
        margins = { top: 20, right: 20, bottom: 30, left: 40 },
        // `schema` and `scales` are read straight off the spec by resolveScales:
        // the schema owns each field's data type and DOMAIN, and `scales` is the
        // chart-level per-channel scale override.
        marks: userMarks = [],
        // Chart elements (axis / grid / legend / axisRadial) — the same factories
        // as `elicit.elements.*`. Concatenated into the feature list with `marks`
        // so authors can separate scale chrome from data marks without a second
        // engine path. Elements in `marks` still work (and stay on `plot.*`).
        elements: userElements = [],
        // Global axis convenience: desugars into composable axis/grid marks (see
        // autoAxes). Explicit axis marks in `marks`/`elements` take precedence per channel.
        axes,
        // The legend counterpart to `axes`: `true` for one legend per bound
        // non-positional scale, or a per-channel config ({ fill: {...}, size: false }).
        // Defaults to none — unlike axes, because a legend RESERVES layout space and
        // silently shrinking the plot because a `fill` channel exists would surprise.
        legends,
        guides = [],
        // Interaction-effects layer (grab / proximity-select), customizable and
        // kept separate from mark style channels. See core/effects.js.
        effects: effectsSpec,
        // Sizing mode. 'fixed' (default) renders at the given pixel width/height.
        // 'scale' renders once at those dims but wraps the SVG in a viewBox so the
        // browser scales it to fill the parent (aspect ratio preserved, one draw).
        // 'reflow' measures the parent and re-renders at native pixels on resize
        // (crisp text, width tracks the container, height stays the given value).
        // `responsive: true` is an alias for 'reflow'.
        responsive,
        // SVG overflow. Default 'hidden' clips marks to the viewport. 'visible' lets
        // content in the margin band show — needed for radial/gauge axis labels that
        // sit just outside the plot area.
        overflow = 'hidden',
        // Browser focus ring on editable marks. Off by default — Tab / arrow keys
        // still work; only the native outline is suppressed. See types.ElicitSpec.
        focusOutline = false,
        renderer = new D3Renderer()
    } = spec;

    const mode = responsive === true ? 'reflow'
        : (responsive === 'scale' || responsive === 'reflow') ? responsive
            : 'fixed';

    // Resolve the chart's theme once (DEFAULT_THEME < setTheme() base < spec.theme).
    // Stamped on the scale map every render (the projection-transport pattern) so
    // build() and edit/guide ctx read it without a widened signature. The theme also
    // supplies the DEFAULTS the effects layer merges under, so a themed chart's
    // grab/select feedback follows the theme unless the chart's own `effects` wins.
    const theme = resolveTheme(spec.theme);
    const effects = resolveEffects(effectsSpec, theme.effects);

    // Prepend auto-injected axis/grid marks (drawn behind marks via the background
    // layer). Explicit axis/element the user composed into `marks` or `elements`
    // are preserved. A projection chart has no cartesian axes — skip autoAxes
    // unless the caller forced them (axes !== undefined still respected via
    // autoAxes(false)). Flattened because a composite mark desugars to
    // an ARRAY of features.
    const userFeatures = [...userElements, ...userMarks];
    const axesOpt = spec.projection != null && axes === undefined ? false : axes;
    // …and append auto-injected LEGEND marks, the same IMPLICIT layer for the
    // non-positional scales (core/legends.js). `axes` had this convenience and
    // `legends` did not, so an axis was one spec key and a legend was a mark you had
    // to compose by hand. Appended (not prepended) because a legend draws its own
    // reserved band beside the plot rather than behind the marks.
    // A legend-scoped edit declared on a MARK's channel moves to that channel's
    // legend, taking the mark's field and table with it (core/legends.js). Runs
    // before autoLegends so a minted legend counts as "explicit" for its channel
    // and the implicit layer doesn't add a second one beside it.
    const features = [
        ...autoAxes(userFeatures, axesOpt),
        ...userFeatures,
        ...legendsFromChannels(userFeatures, legends),
    ].flat(Infinity);
    // Whether any feature is a space-reserving legend (core/legends.js). Static —
    // the feature set doesn't change — so the reservation step is skipped entirely
    // for the common no-legend chart.
    const hasLegends = features.some((f) => f && f.isLegend);

    // Working dims. In 'reflow' mode `curW` tracks the container's measured width
    // (height stays the given value); 'fixed'/'scale' keep the design dims. Marks
    // and scales read the inner (margin-subtracted) dims, so recomputing them on a
    // resize is all it takes for the whole scene to reflow.
    const designW = typeof width === 'number' ? width : 600;
    const designH = typeof height === 'number' ? height : 400;
    let curW = designW;
    let curH = designH;
    // Author margins are the outer padding / axis room. Legends RESERVE extra space
    // on their side (see core/legends.js), so the engine works with EFFECTIVE
    // margins = author margins + each side's legend band. Recomputed every render;
    // equals the author margins when there are no legends.
    const authorMargins = margins;
    let effectiveMargins = { ...authorMargins };
    let innerWidth = curW - effectiveMargins.left - effectiveMargins.right;
    let innerHeight = curH - effectiveMargins.top - effectiveMargins.bottom;

    features.forEach((feature, index) => {
        // `autoId` marks the id as ENGINE-assigned, so a diagnostic can tell an id the
        // author chose (worth quoting back) from a positional placeholder (worth
        // naming the factory instead). Without it every guard reported
        // `mark "feature-3"`, since `id` is optional and most specs omit it.
        if (!feature.id) { feature.id = `feature-${index}`; feature.autoId = true; }
    });

    // The engine OWNS the schema — an editable axis (edit.axis.*) reshapes a field's
    // DOMAIN, which lives on the schema. Clone it so a domain edit never mutates the
    // caller's spec object; resolveScales reads this copy every render, so a domain
    // write reflows axis, grid, guides and marks for free.
    //
    // `normalizeSchema` (core/schema.js, the schema's owner) applies the author-side
    // sugars once, here, and returns the canonical SchemaSpec — the structure, its
    // named tables, and the role -> name binding. Nothing downstream re-sniffs how
    // the author spelled it. `el.getSchema()` denormalizes on the way back out, so a
    // single-table chart still sees the bare field map it always has.
    /** @type {import('../types').SchemaSpec} */
    const schemaSpec = normalizeSchema(structuredClone(spec.schema || {}));
    // The PRIMARY table's field map, by identity — so the in-place domain writes
    // below (and undo's restore) keep the canonical spec consistent for free.
    /** @type {Record<string, import('../types').FieldSchema>} */
    const schema = schemaSpec.tables[schemaSpec.primary].fields;

    // 1. The belief store: ONE dataset for the chart, whose STRUCTURE the schema
    //    declares. Every mark is a view over one of its tables, encoding some
    //    columns and (where it carries an edit) writing them back. structuredClone
    //    rather than a JSON round-trip so seed `Date` values survive for a
    //    time-scale edit; `normalizeData` splits them per table (a bare array is the
    //    primary table, which is every single-table chart).
    /** @type {Record<string, any[]>} */
    let tables = normalizeData(structuredClone(spec.data ?? null), schemaSpec);

    // Every mark draws exactly ONE table, so the engine hands `tableOf(feature)`
    // wherever it used to hand the single dataset — which is why no mark's build(),
    // no edit's apply() and no constraint body had to change for structures.
    /** @param {any} feature @returns {any[]} */
    const tableOf = (feature) => tables[feature.table] || [];
    // WHICH TABLE an edit writes. THE one place this is decided — computeEdit reads
    // it to build the proposal and runEdit reads it to commit, so the two can never
    // disagree and splice a link proposal over the node rows. An edit names its
    // target by ROLE (`table: 'links'`) so a renamed schema still resolves; with none
    // it writes the table its own mark draws, which is every pre-structure edit.
    /** @param {any} feature @param {import('../types').Edit} edit @returns {string} */
    const targetTableOf = (feature, edit) =>
        (edit && edit.table && schemaSpec.byRole[edit.table]) || feature.table;
    // The PRIMARY table: what a bare-array `data` seeds, what a mark with no `table`
    // draws, and what the index-addressed selection API means.
    const primaryRows = () => tables[schemaSpec.primary];
    // The dataset in the caller's own spelling, for getData/onChange: a bare array
    // when that is how it came in (every single-table chart), else keyed by table.
    const shapeData = () => (isBareForm(schemaSpec) ? primaryRows() : tables);

    // Which TABLE each feature is a view over, resolved once. A mark states a table
    // by NAME (`table: 'links'`); with none, it takes the table filling its ROLE —
    // `link` asks for `links`, every other mark for the structure's primary. Going
    // through the role is what makes renaming free: a schema that calls its tables
    // `claims`/`supports` needs no `table:` written anywhere.
    features.forEach((feature) => {
        const named = feature.table;
        if (named != null && !schemaSpec.tables[named]) {
            warn(
                `${markLabel(feature)}:table:${named}`,
                `mark ${markLabel(feature)} draws table "${named}", which the schema does not ` +
                `declare. Declared tables: ${Object.keys(schemaSpec.tables).map((n) => `"${n}"`).join(', ')}. ` +
                `Falling back to "${schemaSpec.primary}".`
            );
        }
        feature.table = (named != null && schemaSpec.tables[named])
            ? named
            : (schemaSpec.byRole[feature.tableRole] || schemaSpec.primary);
    });

    // Read-only rows (see core/lock.js). `lock: 'seed'` fixes the rows the chart was
    // seeded with — they are given, not elicited — while leaving every later row
    // free; a predicate locks rows by what they ARE. Two halves: a dataset invariant
    // (run last in computeEdit, so a lock has the final word) and a `locked` stamp on
    // those rows' scene nodes, which makes them pointer-transparent and invisible to
    // proximity picking.
    //
    // Seeding is PER TABLE — "the rows this table started with" — so the predicate
    // and its constraint are resolved per table and memoized. The counts are read
    // live because setData re-seeds.
    /** @type {Record<string, number>} */
    let seedCounts = {};
    for (const name of Object.keys(tables)) seedCounts[name] = tables[name].length;
    /** @type {Record<string, ((d: any, i: number) => boolean) | null>} */
    const lockPredicates = {};
    /** @type {Record<string, import('../types').Constraint | null>} */
    const lockConstraints = {};
    /** @param {string} name @returns {((d: any, i: number) => boolean) | null} */
    const isLockedIn = (name) => {
        if (!(name in lockPredicates)) {
            lockPredicates[name] = resolveLock(spec.lock, () => seedCounts[name] || 0, name);
        }
        return lockPredicates[name];
    };
    /** @param {string} name @returns {import('../types').Constraint | null} */
    const lockRowsIn = (name) => {
        if (!(name in lockConstraints)) {
            const pred = isLockedIn(name);
            lockConstraints[name] = pred ? lockConstraint(pred) : null;
        }
        return lockConstraints[name];
    };

    // Check the SEED rows against that contract once, here (see core/schema.js for
    // the checks and why each is a defect). Seed rows are the only place a mismatch
    // can originate: an edit mints from schemaDefaults and writes through a channel's
    // own field, so it cannot introduce an undeclared column.
    validateTables(schemaSpec, tables);
    // The resolver sees the RESOLVED theme (not the raw spec.theme partial), so its
    // colour-scale range fallback can read theme.palette/ramp/diverging.
    const liveSpec = { ...spec, schema, schemaSpec, theme };

    // The dataset's invariants, gathered once, from `spec.constraints` — the ONE
    // place they are declared. An invariant holds for EVERY edit over the rows,
    // whichever mark fired it, which is what makes a rule gate a drag on any part of
    // a glyph. Deduped by identity so the same constraint object listed twice runs
    // once.
    //
    // A mark used to accept `constraints` as sugar and the engine promoted it here.
    // That was a lie the spec could not see through: it READ as scoped to the mark
    // that declared it and never was, so a `count({ max })` written on one of two
    // marks silently capped the whole dataset. The mark option is gone; the
    // correction is in MISTAKEN_OPTIONS (plot/mark.js).
    //
    // Bucketing is scoped to a TABLE, because a constraint is an invariant over ROWS
    // and two tables' rows are different things — a rule written about nodes must not
    // run on a link edit and see columns it has never heard of. A constraint takes
    // the primary table unless it names another (`constraint.table`, a role or a
    // name). On a single-table chart every constraint lands in the one bucket.
    /** @type {Record<string, import('../types').Constraint[]>} */
    const constraintsByTable = {};
    /** @param {import('../types').Constraint} c @param {string} table */
    const promoteConstraint = (c, table) => {
        const list = constraintsByTable[table] || (constraintsByTable[table] = []);
        if (!list.includes(c)) list.push(c);
    };
    for (const c of spec.constraints || []) {
        const named = /** @type {any} */ (c).table;
        promoteConstraint(c, (named && (schemaSpec.byRole[named] || (schemaSpec.tables[named] && named)))
            || schemaSpec.primary);
    }

    /** @param {string} table @returns {import('../types').Constraint[]} */
    const constraintsIn = (table) => constraintsByTable[table] || [];
    // The primary table's invariants, for the guide layer (a guide draws a rule about
    // a mark, and resolves the mark's own table through guideCtx.tableOf).
    const datasetConstraints = constraintsIn(schemaSpec.primary);

    // Auto-guides: an edit declared `guide: true` self-draws its guide (constraint
    // bounds + nearest snap ring) without the caller repeating the feature id in a
    // top-level guides list (see edit/guide.js).
    const allGuides = [...autoEditGuides(features), ...guides];

    // Multi-stage elicitation: edits carrying a numeric `stage` are active only in
    // that stage (null = always). This is a uniform descriptor filter applied to
    // EVERY edit — the same shape as `gesture` matching — not a per-mode engine
    // branch, so the one-interaction-model invariant holds. `activeEdits` is the
    // single gate the dispatch/editable/plane-on-top paths run their edits through.
    let currentStage = spec.stage != null ? spec.stage : 0;
    /** @type {(string | null)[]} */
    const stageLabels = Array.isArray(spec.stageLabels) ? spec.stageLabels : [];
    /** @param {number} n @returns {string | null} */
    const stageLabelOf = (n) => (stageLabels[n] != null ? stageLabels[n] : null);
    /**
     * @param {any} feature
     * @returns {import('../types').Edit[]}
     */
    const activeEdits = (feature) =>
        collectEdits(feature).filter(e => e.stage == null || e.stage === currentStage);

    // Move the stage cursor WITHOUT re-rendering: drop every transient (an in-flight
    // driver lock, a hover preview) so a stage switch can't resume a half-finished
    // gesture, then notify. Callers render — `setStage` on the container does it
    // directly; a driver's `stage.next()` rides the dispatch's own re-render.
    /** @param {number} n */
    const applyStage = (n) => {
        currentStage = n;
        ui.session = {};
        ui.preview = null;
        ui.hover = null;
        ui.grab = null;
        ui.selection.clear(); // selection is per-stage transient, like the session
        for (const cb of listeners.stage) cb(currentStage, stageLabelOf(currentStage));
    };

    // Transient interaction (UI) state, separate from the belief `dataset`. The
    // interaction drivers keep a per-feature session here (proximity selection,
    // sweep/draw locks) — those locks belong to one mark's gesture, so they stay
    // keyed by feature id. `preview` holds THE UNCOMMITTED proposal a driver parked
    // (the probe driver's hover/drag), keyed by feature id: each entry is the
    // proposed dataset that feature would commit. The committed rows are still what
    // every mark draws; a proposal is rendered as an inert GHOST of only the rows it
    // would change, layered on top (see update()'s ghost pass). It never reaches the
    // belief store, `onChange`, or `getData`. Cleared on commit, hoverout, and stage
    // change. Per-feature (not one global slot) so two probe marks can't clobber
    // each other's ghost.
    // `selection` is transient PIPELINE state: which dataset rows are currently
    // selected, an interaction concept the engine owns — never a `selected` data
    // column. A Set (single-exclusive today, so at most one member; a Set so
    // multi-select is a later widening, not an API break). Written only through the
    // selection commit path (edit.select / el.select), reset on setData/stage
    // change, and stamped onto the scale map each render (scales.selection) so a
    // legend/mark can target "the selected row" without a widened build signature.
    // `hover` is the OTHER transient pointer state: which feature+row the pointer is
    // currently over, written by the renderer's hover/hoverout events on any editable
    // node. It feeds the same `hovered` effect a proximity driver's session does, so
    // "this is the mark you are about to touch" looks the same however it was
    // resolved. Cleared on hoverout, stage change and reseed, like `session`.
    // `grab` is its mid-gesture counterpart: which feature+row a drag is currently on,
    // bracketed by the same dragstart/dragend the undo transaction uses. It exists so
    // the `grabbed` effect is decided in the state pass with the other two, rather
    // than being painted by the renderer straight off d3.drag — that split is why
    // `grabbed` used to honour `filter` and silently ignore the rest of its vocabulary
    // (and never drew an outline at all).
    /** @type {{ session: Record<string, any>, preview: Record<string, { table: string, rows: any[] }> | null, selection: Set<string>, hover: { featureId: string, index: number } | null, grab: { featureId: string, index: number } | null }} */
    const ui = { session: {}, preview: null, selection: new Set(), hover: null, grab: null };

    // Selection is stored QUALIFIED BY TABLE. A bare row index is ambiguous the
    // moment a dataset has more than one table — node 3 and link 3 are different
    // rows — and the effects pass keys its highlight by index, so an unqualified set
    // would light up a link because a node with the same index was selected.
    //
    // The public surface stays index-based: every existing chart has one table, and
    // `el.select(3)` / `getSelection()` mean that table's row 3. The qualification is
    // internal, and only a multi-table chart ever sees it.
    /** @param {string} table @param {number} index @returns {string} */
    const selKey = (table, index) => `${table}\u0000${index}`;
    /** @param {string} key @returns {{ table: string, index: number }} */
    const selParse = (key) => {
        const at = key.indexOf('\u0000');
        return { table: key.slice(0, at), index: Number(key.slice(at + 1)) };
    };
    /** The selected row indices belonging to one table, as a Set. */
    /** @param {string} table @returns {Set<number>} */
    const selectionIn = (table) => {
        /** @type {Set<number>} */
        const out = new Set();
        for (const key of ui.selection) {
            const s = selParse(key);
            if (s.table === table) out.add(s.index);
        }
        return out;
    };

    // The primary selected datum index (the FIRST member — under multi-select there
    // may be several), or null. Stale indices — a selected row later removed — read
    // as null rather than pointing at a shifted row. Reads the PRIMARY table, which
    // is what a single-table chart's "the selection" has always meant.
    const selectionPrimary = () => {
        for (const i of selectionIn(schemaSpec.primary)) {
            if (i >= 0 && i < primaryRows().length) return i;
        }
        return null;
    };

    // EVERY live selected index in one table, ascending. The counterpart to
    // selectionPrimary for anything that has to reflect a multi-row selection rather
    // than narrow it to one — a legend marking which categories the selection holds,
    // or a caller reading getSelectionAll(). Same staleness rule.
    /** @param {string} [table] @returns {number[]} */
    const selectionList = (table = schemaSpec.primary) => {
        const n = (tables[table] || []).length;
        return [...selectionIn(table)].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
    };

    // Caller-facing observers. `change` fires on every committed edit; `stage` fires
    // when setStage advances; `select` fires when the selection changes (no data
    // moved, so it is NOT a `change`). Attached to the returned container as
    // `.on('change' | 'stage' | 'select', cb)`. `gesture` fires once when a gesture
    // that changed data ENDS — see notifyGesture.
    /** @type {{ change: Set<Function>, stage: Set<Function>, select: Set<Function>, gesture: Set<Function> }} */
    const listeners = { change: new Set(), stage: new Set(), select: new Set(), gesture: new Set() };

    // ---- Undo history --------------------------------------------------------
    // An elicitation is someone's belief being drafted, so "take that back" is a
    // primitive, not a nicety. A snapshot store rather than inverse operations:
    // an edit's apply() is already a pure data -> data function, so the state
    // before it IS the undo, and no edit has to describe how to reverse itself.
    //
    // The unit is a GESTURE, not a commit. A drag commits on every pointermove, so
    // per-commit history would make undo replay the drag backwards one pixel at a
    // time. Instead a transaction opens at dragstart and closes at dragend (both
    // renderers emit them for mark and plane drags alike), and the first commit
    // inside it records the pre-gesture state — once. A click or a typed commit is
    // its own transaction.
    //
    // Snapshots carry the schema and the chart size too, because edit.axis.* writes
    // the schema's domain and can grow the chart: undoing a category-add has to put
    // the domain, the rows AND the size back.
    const MAX_HISTORY = 100;
    /** @type {any[]} */
    let past = [];
    /** @type {any[]} */
    let future = [];
    // A transaction is one GESTURE. Besides whether it has snapshotted yet, it keeps
    // the state it started from and the edits that fired in it, so its end can be
    // reported as one event ('gesture') rather than as every commit along the way.
    /** @type {{ recorded: boolean, before: any, edits: any[] } | null} */
    let txn = null;
    // External writes (el.patch) that would renumber rows wait here while a stroke
    // is in flight — see el.patch.
    /** @type {{ plan: any[], history: 'keep' | 'record' }[]} */
    let pending = [];

    const snapshot = () => ({
        tables: structuredClone(tables),
        schema: structuredClone(schema),
        width: curW,
        height: curH,
    });

    /** @param {any} snap */
    const restoreSnapshot = (snap) => {
        tables = structuredClone(snap.tables);
        // Replace the schema's CONTENTS: `schema` is captured by closures (and read
        // by resolveScales each render), so rebinding the name would strand them.
        for (const k of Object.keys(schema)) delete schema[k];
        Object.assign(schema, structuredClone(snap.schema));
        if (snap.width !== curW || snap.height !== curH) {
            applyResize({ width: snap.width, height: snap.height });
        }
        ui.preview = null;
    };

    // Open a transaction if none is open. No snapshot here: a gesture that never
    // commits (a hover that only PREVIEWS, firing beginTxn on every pointermove) must
    // not clone the dataset. The snapshot is taken lazily by recordHistory, on the
    // first commit — which is safe because every commit path calls recordHistory
    // BEFORE it mutates `dataset`/`schema`, so "now" is still the pre-gesture state.
    const beginTxn = () => { if (!txn) txn = { recorded: false, before: null, edits: [] }; };
    // `notify` is true only where a gesture really ENDS (the dispatch). setData, undo
    // and redo close a transaction too, but no gesture happened there to report.
    const endTxn = (notify = false) => {
        const done = txn;
        txn = null;
        if (notify && done && done.recorded) notifyGesture(done);
        if (pending.length) flushPending();
    };

    // Called by every commit path, BEFORE it mutates state. The first commit in a
    // transaction snapshots the (still pre-gesture) state and drops the redo stack —
    // a new edit after an undo forks the history, so the old future is gone.
    const recordHistory = () => {
        if (!txn) beginTxn();
        if (!txn || txn.recorded) return;
        const snap = snapshot();
        past.push(snap);
        if (past.length > MAX_HISTORY) past.shift();
        future = [];
        // The same object the undo stack holds, so an external write rebased into
        // history (el.patch, 'keep') is rebased into the gesture's "before" too, and
        // a listener diffing before/after sees the gesture and nothing else.
        txn.before = snap.tables;
        txn.recorded = true;
    };

    // One event per gesture that changed data: what it started from, what it left,
    // and which edits did it (deduplicated — a drag fires its edit on every move).
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
        const shape = (/** @type {any} */ t) => (isBareForm(schemaSpec) ? t[schemaSpec.primary] : t);
        const event = { edits, before: structuredClone(shape(done.before)), after: structuredClone(shapeData()) };
        for (const cb of listeners.gesture) cb(event);
    };

    // Notify a committed change. One place, so undo/redo tell the caller exactly
    // what an edit does.
    const notifyChange = () => {
        if (spec.onChange) spec.onChange(shapeData());
        for (const cb of listeners.change) cb(structuredClone(shapeData()));
    };

    // Notify a selection change. Selection is not the belief data, so it is a
    // SEPARATE channel from `change` — a `select` listener hears it, `onChange`/
    // `getData` never do.
    const notifySelect = () => {
        const primary = selectionPrimary();
        // A single-table chart reports bare row indices, as it always has. A
        // multi-table one reports {table, index}, because a bare number there names
        // no particular row.
        const all = isBareForm(schemaSpec)
            ? [...selectionIn(schemaSpec.primary)]
            : [...ui.selection].map(selParse);
        for (const cb of listeners.select) cb(primary, /** @type {any} */ (all));
    };

    // Commit a SELECTION edit's proposal. Like a domain edit it writes engine state
    // that ISN'T the dataset — here `ui.selection` — so it bypasses the datum
    // splice, the data-layer constraints, AND undo history: nothing about the belief
    // data changed, so there is nothing to take back and `onChange` stays silent.
    // The descriptor is `{ index, exclusive, toggle }` (see edit.select). Returns
    // whether the selection actually moved, so the dispatch reports it as a render
    // (via shouldRender) exactly as it does for a data edit — no self-render here, so
    // the gesture path renders once. The external el.select* wrappers, which call
    // this OUTSIDE a dispatch, render themselves.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const commitSelectionEdit = (sel, table = schemaSpec.primary) => {
        const before = [...ui.selection].join(',');
        applySelection(sel, table);
        const after = [...ui.selection].join(',');
        if (before === after) return false;
        notifySelect();
        return true;
    };

    // Mutate ui.selection from a selection descriptor. `clear` empties it; an
    // `exclusive` write replaces the set; otherwise the write is ADDITIVE.
    //
    // `toggle` means "clicking what is already selected deselects it", and that
    // reads differently in the two modes — which is the whole point of having them:
    //   exclusive — deselect only when the row is the SOLE selection. Clicking one
    //     of several replaces the set with it, which is what a plain click means.
    //   additive  — deselect the row from the set, sole or not. Shift-clicking a
    //     member is the only way to take it back out.
    // Getting that second case wrong is invisible: `has && size === 1` is false for
    // a member of a multi-row selection, so the row was re-added and shift-click
    // could add but never remove.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const applySelection = (sel, table = schemaSpec.primary) => {
        if (sel.clear || sel.index == null) { ui.selection.clear(); return; }
        const key = selKey(table, sel.index);
        const has = ui.selection.has(key);
        if (sel.exclusive !== false) {
            const sole = has && ui.selection.size === 1;
            ui.selection.clear();
            if (sel.toggle && sole) return; // toggled the sole selection off — leave empty
        } else if (sel.toggle && has) {
            ui.selection.delete(key);
            return;
        }
        ui.selection.add(key);
    };

    // The most recently built scene nodes per feature, so plane-pick edits can
    // hit-test against exact mark geometry and guides can look marks up by index.
    /** @type {Record<string, any[]>} */
    const featureNodes = {};

    // The scale map an edit on this node should resolve against. A part of a
    // composite in box mode is drawn inside a per-datum local FRAME, and each of its nodes
    // carries the frame scales it was encoded through — overlaying them is how a
    // gesture inverts back through the same mapping. Returns null when no frame is
    // in play, so the caller keeps the global map unchanged.
    /**
     * @param {any} feature
     * @param {any} node the node a direct-pick gesture landed on, if any
     * @param {number | null} [index] the datum, for a gesture that carries no node
     * @returns {import('../types').ScaleMap | null}
     */
    const frameScalesFor = (feature, node, index) => {
        let framed = node && node.frame ? node : null;
        if (!framed && index != null && feature) {
            framed = (featureNodes[feature.id] || []).find(
                (/** @type {any} */ n) => n && n.index === index && n.frame
            ) || null;
        }
        return framed ? { ...scales, ...framed.frame } : null;
    };

    // 2. Calculate scales (Observable Plot model): one GLOBAL scale per channel,
    //    resolved from the union of every feature's channels, with the schema
    //    supplying each field's data type and domain. Recomputed each render so an
    //    inferred domain (a field the schema left open) tracks data as create/drag
    //    mutate it. `scales` is a channel map { x, y, fill, size, … }; unused
    //    channels are absent.
    const dims = { width: innerWidth, height: innerHeight };
    let scales = resolveScales(features, tables, liveSpec, dims);

    // Set up container. 'fixed' pins pixel dims; the responsive modes fill the
    // parent's width (the SVG scales via viewBox in 'scale', or is redrawn at the
    // measured size in 'reflow').
    const container = document.createElement('div');
    container.style.position = 'relative';
    if (mode === 'scale') {
        container.style.width = '100%';
        container.style.height = 'auto';
    } else if (mode === 'reflow') {
        container.style.width = '100%';
        container.style.height = `${curH}px`;
    } else {
        container.style.width = `${curW}px`;
        container.style.height = `${curH}px`;
    }

    // Recompute the margin-subtracted dims from the current outer dims, and (reflow
    // only) re-measure the container's width from the parent. Returns whether the
    // width actually changed, so a resize can skip a redundant re-render.
    const recomputeInner = () => {
        innerWidth = curW - effectiveMargins.left - effectiveMargins.right;
        innerHeight = curH - effectiveMargins.top - effectiveMargins.bottom;
        dims.width = innerWidth;
        dims.height = innerHeight;
    };
    const measure = () => {
        if (mode !== 'reflow') return false;
        const w = container.clientWidth || designW;
        if (w > 0 && w !== curW) {
            curW = w;
            recomputeInner();
            return true;
        }
        return false;
    };

    const scene = new SceneGraph();

    // 3. Coordinator - rebuild the scene graph from current state and render.
    const update = () => {
        measure(); // reflow: pick up the container's current width before drawing
        scene.clear();

        // Legend reservation: a legend on a side shrinks the plot to make room. A
        // legend's band depends only on its scale's DOMAIN (label count / extent),
        // not on the pixel dims — so one provisional resolve gives the domains, we
        // reserve the bands, inflate the author margins, and recompute the inner
        // rect before the real resolve below. No feedback loop, so no iteration.
        if (hasLegends) {
            effectiveMargins = { ...authorMargins };
            recomputeInner();
            const provisional = resolveScales(features, tables, liveSpec, dims);
            /** @type {any} */ (provisional).theme = theme; // measure reads legend font tokens
            const bands = reserveLegends(features, provisional, authorMargins);
            effectiveMargins = {
                top: authorMargins.top + bands.top,
                right: authorMargins.right + bands.right,
                bottom: authorMargins.bottom + bands.bottom,
                left: authorMargins.left + bands.left,
            };
            recomputeInner();
        }

        // Re-resolve global scales so inferred domains follow the live data, and
        // an edited schema domain (edit.axis.*) reshapes every axis/grid/mark.
        scales = resolveScales(features, tables, liveSpec, dims);
        // Chart-level geographic projection (Plot model): shared apply/invert/path
        // for every geo mark and edit.geo.*. Attached on the scale map so build()
        // and edit ctx see the same object without a second argument.
        const projection = createProjection(liveSpec.projection, dims);
        // Attached on the scale map as a reserved non-Scale key (cast) so build()
        // and edit ctx share one object without widening ScaleMap's channel types.
        if (projection) /** @type {any} */ (scales).projection = projection;
        // The resolved theme rides on the scale map as another reserved non-Scale
        // key, so every mark's build() and the guide/edit ctx read default colours,
        // fonts and affordance tokens from one object (see core/theme.js: themeOf).
        /** @type {any} */ (scales).theme = theme;
        // The selection rides on the scale map as reserved non-Scale keys, so a
        // legend/mark reads "the selected row" from the same object it already gets,
        // without a widened build() signature. Two views of the one Set:
        //   selection    the FIRST selected primary row, or null — the scalar every
        //                mark and `legend`'s `row` has always read. Kept scalar so
        //                multi-select is a widening, not a break.
        //   selectionAll every selected row, per table, for anything that reflects a
        //                multi-row selection rather than narrowing it (a legend
        //                marking which categories the selection currently holds).
        /** @type {any} */ (scales).selection = selectionPrimary();
        /** @type {any} */ (scales).selectionAll = selectionList;
        // The dataset schema rides along as one more reserved non-Scale key. A
        // composite's frame scales are built inside build() (one per datum), and the
        // DOMAIN of a frame channel is the field's — which only the schema knows.
        /** @type {any} */ (scales).schema = schema;
        warnProjectionCartesianMix(features, scales);

        // Plane-on-top mode: when an ACTIVE edit resolves its target from an
        // arbitrary pointer position (nearest/sweep/draw/brush), the plane must sit
        // above the marks and own the gesture. Computed per render because the
        // active edit set — and thus this flag — can change with the stage.
        const planeOnTop = features.some(feature => needsPlaneOnTop(activeEdits(feature)));
        // Plane-on-top drivers (brushRect, nearest, …) may stash a cursor hint in
        // their per-feature session so the interaction plane can show edge/body
        // affordances without a second interaction system.
        let planeCursor = 'pointer';
        if (planeOnTop && ui.session) {
            for (const fid of Object.keys(ui.session)) {
                const cur = ui.session[fid] && ui.session[fid].cursor;
                if (cur) { planeCursor = cur; break; }
            }
        }

        warnDuplicatePlaneEdits(features, activeEdits, targetTableOf);
        warnUnreachableLegendRow(features, activeEdits, tableOf);

        // Built nodes per feature, in feature order, so paint order can be decided
        // once the whole scene is known. It is the FEATURE order for everything
        // except a glyph, whose parts paint as one object per row — see
        // `paintOrder`. Collected rather than added straight to the scene because
        // that decision spans several features.
        /** @type {{ glyph?: string, nodes: any[] }[]} */
        const built = [];

        features.forEach(feature => {
            // The committed rows of the feature's OWN table are always what it draws.
            // A hover/drag preview no longer substitutes them (that made committed
            // marks jump/flicker — worst on a matrix); instead the proposal is drawn
            // as an inert ghost of only the rows it would change, by the pass below.
            const currentData = tableOf(feature);
            const isLocked = isLockedIn(feature.table);
            // A mark that joins ACROSS tables (link) needs more than its own rows: the
            // whole dataset, the canonical schema (to find another table by ROLE), and
            // which table it is itself drawing. Passed as a 5th argument, so every
            // existing mark's four-parameter build() is untouched.
            const nodes = feature.build(currentData, scales, innerWidth, innerHeight, {
                tables, schema: schemaSpec, table: feature.table,
            });
            featureNodes[feature.id] = nodes;

            const declaredEdits = collectEdits(feature);
            warnScaleRequirements(feature, scales);
            warnScopeMismatch(feature, declaredEdits);
            warnMisplacedEdits(feature, markLabel);
            warnCreateOnNonMark(feature, declaredEdits, scales);
            warnCreateEmptyExtent(feature, declaredEdits, liveSpec.schema);
            warnDeadEditChannels(feature, declaredEdits, scales);
            warnConnectConflict(feature, declaredEdits);
            warnUnclaimedPick(feature, declaredEdits);
            warnUnknownEditOptions(feature, declaredEdits);

            // A feature with an ACTIVE direct-pick edit is interactive on its marks,
            // so the renderer should show an editable cursor on them. Plane-pick
            // edits (nearest/sweep/draw) put the cursor on the plane instead, so
            // they don't mark nodes editable.
            const editable = activeEdits(feature).some(e => e.pick === 'direct');

            // An edit completed by TYPING (`inline`) makes this feature's nodes
            // typable — the renderer opens its inline editor on a double-click of a
            // node flagged `editText`. A declared CAPABILITY, read the same way
            // `editable` reads `pick`, so the engine never asks whether an edit is
            // an editText and a mark never sniffs its own edit list to find out.
            //
            // Which SHAPE gets it matters: a glyph whose typable surface is a box
            // (a sticker) puts the edit on the box, and the text it contains stays
            // inert — otherwise the label's nodes keep the pointer, and pick.js
            // gives a text node a fontSize-radius hit disc that sits dead centre of
            // the shape and swallows the drag that should move it.
            const inlineEdit = activeEdits(feature).find(e => e.inline);

            // What that editor OPENS WITH, for a typable node that paints no text.
            // A label carries its string (`node.text`) and always did; the box of a
            // sticker does not — its text is drawn by a SIBLING mark — so the editor
            // opened empty and every double-click silently became "retype the note
            // from scratch". The COLUMN is the truth in both cases, so resolve it
            // from the edit's own channel (the one place a field is named) and stamp
            // the current value where the renderer can find it.
            const inlineField = inlineEdit
                ? (resolveChannels(inlineEdit.channels, feature.channels || {}, scales, feature)[0] || {}).field
                : null;

            // Tag every node with its feature so gesture events can find the
            // feature's edits, and flag interactive marks for the cursor.
            //
            // A mark with no direct-pick edit can't consume a gesture, so it must not
            // BLOCK one: the renderer defaults nodes to pointer-events:auto and paints
            // later features/parts on top, so an inert rule listed after a handle (or
            // any overlapping inert chrome) would swallow its drag. Silence it unless
            // the mark asked for a specific value.
            //
            // A node over a LOCKED row is inert for the same reason, one level down:
            // its row is read-only, so it is not grabbable, shows no editable cursor,
            // and pick.js skips it when resolving a proximity target.
            nodes.forEach((/** @type {any} */ node) => {
                node.featureId = feature.id;
                const locked = isLocked && isNodeLocked(node, feature, currentData, isLocked);
                if (locked) node.locked = true;
                if (editable && !locked) node.editable = true;
                else if (node.pointerEvents == null) node.pointerEvents = 'none';
                if (inlineEdit && !locked) {
                    node.editText = true;
                    if (inlineEdit.multiline) node.multiline = true;
                    if (inlineField != null && node.data) {
                        const current = node.data[inlineField];
                        if (current != null) node.editValue = String(current);
                    }
                }
            });
            built.push({ glyph: feature.glyph, nodes });
        });

        paintOrder(built).forEach((/** @type {any} */ node) => scene.add(node));

        // Ghost-preview pass. For each feature carrying an uncommitted proposal, build
        // it from the PROPOSED rows and add only the nodes that DIFFER from committed —
        // a changed/added row (by identity, since computeEdit's splice preserves the
        // untouched rows' object identity), or a feature's series chrome (index == null,
        // e.g. a line path) when any of its rows changed. Ghosts are inert: not written
        // to featureNodes (so picking/guides see committed geometry only), never
        // editable, pointer-transparent, and styled with theme.ghost so they read as
        // tentative. Building every feature from the proposal keeps "the ghost is
        // exactly what a commit would draw" across sibling marks and constraint repairs.
        if (ui.preview) {
            // A proposal is about the DATASET, not about the mark that produced it:
            // every feature is a view over the same rows, so a SIBLING has to ghost
            // it too. Splitting a glyph into two marks otherwise leaves half of it
            // frozen until the click — a trendBand whose spread is being probed on
            // the trend line shows no feedback at all while the pointer moves.
            //
            // The parking spot stays keyed by feature id (two probe marks must not
            // clobber each other's ghost); this only decides who DRAWS one. With
            // exactly one proposal in flight it is THE proposal and every feature
            // renders it. With two, each proposing feature keeps its own — there is
            // no single answer for a bystander, so it stays out of it.
            //
            // A proposal names the TABLE it is about, because an edit can propose
            // rows for a table other than the one its mark draws — `edit.network.connect`
            // fires on a node mark and proposes a LINK row. Only features over that
            // table ghost it, which is both what makes the rubber band appear on the
            // link mark and what stops a node mark from ghosting rows that aren't its.
            const inFlight = Object.values(ui.preview);
            const sole = inFlight.length === 1 ? inFlight[0] : null;
            // Ghosts paint in the same order committed nodes do — a ghosted glyph
            // is one object too, so its parts group by row (`paintOrder`).
            /** @type {{ glyph?: string, nodes: any[] }[]} */
            const ghostBuilt = [];
            for (const feature of features) {
                // A chart element draws a SCALE, not rows, so it has no ghost to show.
                if (feature.views === 'scale') continue;
                const proposal = ui.preview[feature.id] || sole;
                if (!proposal || proposal.table !== feature.table) continue;
                const proposed = proposal.rows;
                const committed = tableOf(feature);

                // Which rows the proposal changes, by reference identity.
                /** @type {Set<number>} */
                const changedIdx = new Set();
                let anyChanged = proposed.length !== committed.length;
                const n = Math.max(proposed.length, committed.length);
                for (let i = 0; i < n; i++) {
                    if (proposed[i] !== committed[i]) { changedIdx.add(i); anyChanged = true; }
                }
                if (!anyChanged) continue;

                const ghostNodes = feature.build(proposed, scales, innerWidth, innerHeight, {
                    // A ghosted LINK has to resolve its endpoints against the proposed
                    // rows too — otherwise a preview that moves a node draws the ghost
                    // link to where the node used to be.
                    tables: { ...tables, [proposal.table]: proposed },
                    schema: schemaSpec,
                    table: feature.table,
                });
                const kept = ghostNodes.filter((/** @type {any} */ node) => {
                    const keep = node.index != null ? changedIdx.has(node.index) : anyChanged;
                    if (!keep) return false;
                    node.ghost = true;
                    node.featureId = feature.id;
                    node.editable = false;
                    node.pointerEvents = 'none';
                    applyGhostStyle(node, theme.ghost);
                    return true;
                });
                ghostBuilt.push({ glyph: feature.glyph, nodes: kept });
            }
            paintOrder(ghostBuilt).forEach((/** @type {any} */ node) => scene.add(node));
        }

        // Build guides last so they can read the freshly-updated data. Guides are
        // purely visual (non-interactive) annotations.
        const guideCtx = {
            scales,
            // The primary table's rows — what a chart-level guide means by "the data".
            // A guide drawn about a MARK reads that mark's own table (and that table's
            // invariants) through tableOf / constraintsIn.
            data: primaryRows(),
            tableOf,
            constraintsIn,
            constraints: datasetConstraints,
            features,
            featureNodes,
            ui,
            effects,
            theme,
            width: innerWidth,
            height: innerHeight,
            // The current stage, so an edit's auto-guide can suppress itself when
            // its edit is inactive (one guide path, gated by the same rule as edits).
            stage: currentStage
        };
        // One build signature for all three kinds of feature. A mark and an element
        // are `build(rows, scales, width, height, ctx)`; a guide is the same five,
        // so "what a feature is" differs only in what it VIEWS (`views`), never in
        // how the engine calls it. The rows are the primary table's — what a
        // chart-level guide means by "the data".
        allGuides.forEach(guide => {
            const nodes = guide.build(
                guideCtx.data, scales, innerWidth, innerHeight, guideCtx,
            ) || [];
            nodes.forEach((/** @type {any} */ node) => {
                node.guide = true;
                scene.add(node);
            });
        });

        // ── The interaction-STATE pass ───────────────────────────────────────
        // ONE place decides what every interaction state looks like, for every
        // feature, however the state arose — and for BOTH of the effects layer's
        // mechanisms (the mark's own restyle and the outline overlay). The renderer
        // used to own the restyle half off its own pointerenter/d3.drag, which is why
        // `hovered: { fill }` painted only under SVG direct pick and `selected:
        // { fill }` did nothing at all; it is a dumb applier of `node.effectStyle` now.
        //
        // That matters most for HOVER, which has two sources that must be
        // indistinguishable to a reader:
        //
        //   · a proximity driver resolved this row as the one a gesture would take
        //     (session.activeIndex ?? session.hoverIndex), and
        //   · the pointer is simply over the mark (ui.hover, from the renderer).
        //
        // Both mean "this is the mark you are about to touch", so both feed the same
        // effect rather than one being a driver's private guide and the other not
        // existing at all. Selection is the committed answer and outranks hover, so a
        // selected row is not also drawn as hovered. `grabbed` (ui.grab, bracketed by
        // dragstart/dragend) is the in-flight one, and it STACKS: a mark you are
        // dragging is still the selected one, so the two merge rather than compete
        // (effectStyleFor resolves the overlap in EFFECT_STATES order).
        //
        // Drawn per FEATURE and keyed by DATUM index, so hovering a bar lights its
        // label up too — and per TABLE, so selecting node 3 does not also light up
        // link 3 in a network.
        /** @type {Record<string, Set<number>>} */
        const selectedByTable = {};
        for (const feature of features) {
            if (feature.views === 'scale') continue;
            const selected = selectedByTable[feature.table]
                || (selectedByTable[feature.table] = selectionIn(feature.table));
            const marks = featureNodes[feature.id] || [];

            /** @type {Set<number>} */
            const hovered = new Set();
            const session = ui.session && ui.session[feature.id];
            const viaProximity = session
                ? (session.activeIndex != null ? session.activeIndex : session.hoverIndex)
                : null;
            if (viaProximity != null) hovered.add(viaProximity);
            if (ui.hover && ui.hover.featureId === feature.id && ui.hover.index != null) {
                hovered.add(ui.hover.index);
            }
            for (const i of selected) hovered.delete(i);

            /** @type {Set<number>} */
            const grabbed = new Set();
            if (ui.grab && ui.grab.featureId === feature.id && ui.grab.index != null) {
                grabbed.add(ui.grab.index);
            }

            /** @type {[Set<number>, any][]} */
            const byState = [
                [hovered, effects.hovered],
                [selected, effects.selected],
                [grabbed, effects.grabbed],
            ];

            // Restyle half: merge the element props of every state a datum is in onto
            // that datum's own nodes. Stamped on the node so it survives into both
            // renderers and, being the mark's own node, lands on the mark's actual
            // position however it is transformed.
            /** @type {Map<number, any[]>} */
            const statesByIndex = new Map();
            for (const [indices, state] of byState) {
                for (const i of indices) {
                    const list = statesByIndex.get(i) || [];
                    list.push(state);
                    statesByIndex.set(i, list);
                }
            }
            for (const node of marks) {
                if (!node || node.ghost || node.index == null) continue;
                const style = effectStyleFor(statesByIndex.get(node.index) || []);
                if (style) node.effectStyle = style;
            }

            // Overlay half: the padded outline, the one part of the vocabulary that
            // needs geometry the mark itself doesn't have.
            for (const [indices, state] of byState) {
                if (!indices.size) continue;
                stateEffectNodes(marks, indices, state)
                    .forEach((/** @type {any} */ node) => { node.guide = true; scene.add(node); });
            }
        }

        renderer.render({
            container,
            scene,
            width: curW,
            height: curH,
            margins: effectiveMargins,
            scales,
            spec,
            planeOnTop,
            planeCursor,
            responsive: mode,
            overflow,
            focusOutline,
            effects,
            theme,
            onEvent: handleEvent
        });
    };

    // Compute one edit's proposed dataset WITHOUT committing it. `index` addresses
    // the datum being edited (null for create, which appends). The gesture is
    // inverted through the scales in apply(), producing a data-space proposal; that
    // proposal is then judged by the DATA-LAYER INVARIANTS (the dataset's
    // constraints, plus any edit-scoped constrain sugar). Constraints never see
    // pixels. Returns the accepted dataset, or null when the edit is a no-op /
    // rejected.
    //
    // Split out from `runEdit` so a hover can PREVIEW the very same proposal (same
    // apply, same invariants) without writing it to the belief store — see
    // previewEdit + the probe driver.
    /**
     * @param {any} feature
     * @param {import('../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {import('../types').EditResult | null}
     */
    const computeEdit = (feature, edit, event, index) => {
        // WHERE the gesture landed and WHAT it writes are usually the same table, and
        // for every edit that existed before structures they are the same by
        // construction. They come apart for a cross-table edit — `edit.network.connect`
        // is placed on a NODE mark (so `index` addresses a node row) but proposes a
        // LINK row — so the edit may name its target by ROLE, and the two are tracked
        // separately rather than conflated.
        const sourceRows = tableOf(feature);
        const targetTable = targetTableOf(feature, edit);
        const currentData = tables[targetTable] || [];
        const markChannels = feature.channels || {};
        // A node built inside a composite's local FRAME carries the very scales it was
        // encoded through (plot/composite.js stamps `node.frame`). Overlay them so the
        // edit inverts through the same objects — "an edit is the inverse of
        // encoding" holds per datum, with no second inversion path: this is channel
        // resolution honouring which scale drew the thing you grabbed, not a new
        // dispatch branch. A plane-pick gesture carries no node, so fall back to the
        // framed node for this datum.
        const editScales = frameScalesFor(feature, event.node, index) || scales;
        const resolved = resolveChannels(edit.channels, markChannels, editScales, feature);
        const ctx = {
            // The rows the proposal is ABOUT (apply returns rows for this table)...
            data: currentData,
            // ...while `index`/`datum` address the row the gesture actually touched,
            // which belongs to the mark's own table. Identical on every same-table
            // edit, which is all of them but the graph pair.
            datum: index != null ? sourceRows[index] : undefined,
            index,
            // The whole dataset, for an edit that has to look ACROSS tables (rewire
            // resolves a node id from the node rows while writing a link row). Named
            // by table, and read-only by convention like every other ctx member.
            tables,
            table: targetTable,
            pointer: { x: event.x, y: event.y },
            node: event.node || null,
            event: event.rawEvent,
            // A non-pixel gesture payload (the text mark's `commit` typed string).
            value: event.value,
            channels: resolved,
            scales: editScales,
            markChannels,
            // Chart projection context (null on cartesian charts). Geo edits invert
            // through the same object geo marks use for apply/path.
            projection: /** @type {import('../types').ProjectionContext | null} */ (
                /** @type {any} */ (scales).projection || null
            ),
            // Plot pixel dimensions, so a gesture whose geometry is the whole plane
            // (rotate about the centre) can measure against it without a mark node —
            // the angular sibling of resize reading the mark centre.
            width: innerWidth,
            height: innerHeight,
            // The chart margins (effective: author + legend bands), so a grow-mode
            // axis edit recovers the outer size from an inner axis length (inner +
            // margins). Harmless to other edits.
            margins: effectiveMargins,
            // The engine-owned schema of the table this edit WRITES, so a mint
            // (create) populates every declared field with its default (or null) —
            // not just the positional ones — and an axis domain edit reads a field's
            // domain. Table-scoped, so a connect() mints a link row from the link
            // table's defaults rather than the node table's.
            schema: (schemaSpec.tables[targetTable] || schemaSpec.tables[schemaSpec.primary]).fields,
            // The whole canonical schema, for a cross-table edit that has to find
            // another table's key column (rewire reads the node table's key).
            schemaSpec,
            xKey: feature.xKey || 'x',
            yKey: feature.yKey || 'y',
            // The feature's series (grouping) field and its current scene nodes, so
            // proximity-aware edits (anchor / newSeries) and `when.near|far` can
            // resolve WHICH line a plane gesture means. Harmless to other edits.
            seriesKey: feature.seriesKey || null,
            marks: featureNodes[feature.id] || [],
            // The line's ordering knob and the engine's per-gesture driver session
            // (zone/handle locks, draw mode), for edits that read their driver's
            // lock (draw, brushSpan/brushRect, axis.scale). Harmless to the rest.
            connect: feature.connect || null,
            session: (ui.session && ui.session[feature.id]) || null,
            // The primary selected datum index (transient pipeline state), so an
            // edit's apply/when can target or arbitrate on the selection — e.g. a
            // `select` edit that reads whether the touched row is already selected.
            selection: selectionPrimary(),
            // The edit itself, so a `when` predicate can arbitrate against the
            // edit's own knobs (when.near reads its `threshold`). Descriptors are
            // data; self-reference adds no dispatch path.
            edit
        };
        if (edit.when && !edit.when(ctx)) return null; // arbitration

        const result = edit.apply(ctx);
        if (result === undefined) return null;

        // Which datum the gesture touched, for invariants that resolve a violation
        // relative to it. Read from the edit's DECLARED cardinality (see makeEdit),
        // never from its type — a custom append/delete edit gets the same treatment
        // as the built-in create/remove without the engine knowing either exists.
        /** @param {any[]} rows @returns {number | null} */
        const activeIndexOf = (rows) => (edit.cardinality === 'append' ? rows.length - 1
            : edit.cardinality === 'delete' ? null
                : /** @type {number | null} */ (index));

        // Data-layer invariants: the dataset's first (they hold for every edit from
        // every mark), then any edit-scoped guard sugar. Pure data context — no
        // scales-as-geometry. A constraint may reject the proposal (false) or repair
        // it (return an array); the marks re-derive from the repaired rows.
        //
        // The lock (spec.lock) runs LAST so it has the final word: a repair by any
        // other invariant still can't write a read-only row.
        /**
         * @param {any[]} rows
         * @param {string} [forTable] the table these rows ARE. Defaults to the one
         *   the edit writes; a cross-table domain edit passes each other table it
         *   touches, so those rows meet their OWN table's invariants and lock.
         *   `edit.constrain` is edit-scoped sugar about the edit's own proposal, so
         *   it runs on the edit's table only — applying a rule written for node rows
         *   to the link rows a rename swept along would be a different rule.
         * @returns {any[] | null} the repaired rows, or null if rejected
         */
        const runInvariants = (rows, forTable = targetTable) => {
            const own = forTable === targetTable;
            const lockRows = lockRowsIn(forTable);
            const invariants = [
                ...constraintsIn(forTable), ...(own ? edit.constrain : []), ...(lockRows ? [lockRows] : []),
            ];
            const cctx = {
                activeIndex: own ? activeIndexOf(rows) : null, scales, markChannels,
                // The column the dispatching edit writes — what a constraint that
                // names no `field` of its own is about (see applyConstraint).
                field: own && resolved[0] ? resolved[0].field : undefined,
                // The rest of the dataset and which table these rows are, for an
                // invariant that spans tables. Pure data, like everything else a
                // constraint sees — still no pixels.
                tables, table: forTable,
            };
            let out = rows;
            const before = own ? currentData : (tables[forTable] || []);
            for (const constraint of invariants) {
                const r = applyConstraint(constraint, out, before, cctx);
                if (r === false) return null;
                if (r === true || r === undefined) continue;
                // A constraint may GATE (false) or REPAIR (the corrected rows). Anything
                // else is a bug in the constraint, and unvalidated it becomes the dataset:
                // a number or object makes `for (const d of dataset)` throw from inside
                // resolve.js with nothing naming the culprit, and a string iterates its
                // CHARACTERS and blanks the chart. Constraints built with defineConstraint
                // are normalized, so this only catches the hand-written form — which
                // spec.constraints accepts with no type checking at all.
                if (!Array.isArray(r)) {
                    warn(
                        `constraint:return:${constraintLabel(constraint)}`,
                        `constraint ${constraintLabel(constraint)} returned ${describe(r)}; a constraint must ` +
                        `return the repaired rows (an array), false to reject the edit, or ` +
                        `true/undefined to accept it unchanged. Ignoring the return value.`
                    );
                    continue;
                }
                out = r;
            }
            return out;
        };

        // A DOMAIN edit (edit.axis.*, edit.stack.cut on an open field) writes the
        // SCHEMA: apply returns { domains, data?, resize? }. The schema half bypasses
        // the datum-splice and the data-layer constraints — a domain is not a datum,
        // the same reason setData is trusted.
        //
        // Its COUPLED `data`, though, is an ordinary datum proposal (a category rename
        // relabels rows, a remove drops them, an open-domain cut splices one in), so it
        // meets the invariants like any other. Skipping them there let a constraint the
        // author declared — `count({ max })` capping how many categories may exist — be
        // silently ignored by exactly the edits that change how many there are.
        //
        // runEdit's domain-commit path handles the write; wrap it so runEdit/previewEdit
        // can tell it apart from a dataset proposal.
        if (edit.target === 'domain') {
            if (!(result && typeof result === 'object' && result.domains)) return null;
            /** @type {any} */
            const out = { ...result };
            if (Array.isArray(result.data)) {
                const checked = runInvariants(result.data);
                if (!checked) return null;
                out.data = checked;
            }
            // Rows the edit swept along in OTHER tables (a cross-table category
            // rename) are datum proposals too, and each meets ITS table's
            // invariants. One rejection rejects the whole edit: half a rename —
            // the schema written, one table's rows left on the old value — is
            // worse than none.
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

        // A SELECTION edit (edit.select) writes transient pipeline state, not the
        // dataset: apply returns a selection descriptor. Same shape as the domain
        // path — it bypasses the datum-splice, the data constraints, and undo — but
        // its destination is ui.selection. runEdit's selection-commit path handles it.
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
        return rows ? { kind: 'rows', rows } : null;
    };

    // Commit an edit: compute its proposal, write it to the belief store, drop any
    // preview it supersedes, and notify. Returns whether data changed.
    /**
     * @param {any} feature
     * @param {import('../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {boolean}
     */
    const runEdit = (feature, edit, event, index) => {
        const proposed = computeEdit(feature, edit, event, index);
        if (!proposed) return false;
        // Which edits a gesture fired, for its 'gesture' event. A selection writes no
        // data, so it is not part of what the gesture changed.
        if (txn && proposed.kind !== 'selection') {
            txn.edits.push({ type: edit.type, name: edit.name, table: targetTableOf(feature, edit) });
        }
        // A domain edit reshapes the schema (and maybe the dataset / chart size).
        if (proposed.kind === 'domain') {
            return commitDomainEdit(proposed.result, targetTableOf(feature, edit));
        }
        // A selection edit writes ui.selection, not the belief data.
        if (proposed.kind === 'selection') {
            return commitSelectionEdit(proposed.selection, targetTableOf(feature, edit));
        }
        recordHistory();
        // A proposal replaces the table the EDIT targets, which is not always the
        // table its mark draws (see computeEdit). Getting this wrong would overwrite
        // the wrong table wholesale, so the target is resolved the one way, there.
        tables[targetTableOf(feature, edit)] = proposed.rows;
        // Deleting a row can strand REFERENCES to it in another table, which no
        // single-table constraint can see or repair. The schema already declares the
        // rule (`type: 'ref'`), so the engine enforces it — see enforceRefs.
        enforceRefs(schemaSpec, tables);
        ui.preview = null;
        notifyChange();
        return true;
    };

    // Commit a DOMAIN edit's proposal: write each field's schema domain (creating a
    // schema entry, with an inferred measure type, for a field the caller left
    // undeclared), replace the dataset when the edit coupled a data change (category
    // remove/rename deletes/relabels rows), and resize the chart for grow-mode
    // numeric drag. Then notify. The next update() re-resolves scales from the new
    // schema, so axis/grid/guides/marks all reflow.
    /**
     * @param {import('../types').DomainEditResult} result
     * @param {string} [table] the table the edit writes; its schema owns the domains,
     *   and its rows are what a coupled data change replaces.
     * @returns {boolean}
     */
    const commitDomainEdit = (result, table = schemaSpec.primary) => {
        recordHistory();
        // One scale can span several TABLES — `fill` over both `nodes.kind` and
        // `links.kind` — and renaming that category has to write every schema and
        // every row set, or the two halves of one vocabulary drift apart. The flat
        // `domains`/`data` are the edit's own table; `tables` carries the rest.
        // Normalized to one list so there is a single write path rather than a
        // special case bolted beside it.
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
            const fields = (schemaSpec.tables[name] || schemaSpec.tables[schemaSpec.primary]).fields;
            for (const [field, domain] of Object.entries(w.domains || {})) {
                const prev = fields[field];
                fields[field] = { ...(prev || { type: inferMeasureOfDomain(domain) }), domain };
            }
            if (Array.isArray(w.data)) { tables[name] = w.data; touchedRows = true; }
        }
        // A category removal deletes rows, which can strand references to them.
        if (touchedRows) enforceRefs(schemaSpec, tables);
        if (result.resize) applyResize(result.resize);
        ui.preview = null;
        notifyChange();
        return true;
    };

    // Grow-the-chart: adopt new outer pixel dims (numeric axis drag in `grow` mode),
    // mirror them onto the container the way the initial sizing does, and recompute
    // the inner rect so the next render draws at the new size.
    /** @param {{ width?: number, height?: number }} size */
    const applyResize = (size) => {
        if (typeof size.width === 'number' && size.width > 0) curW = size.width;
        if (typeof size.height === 'number' && size.height > 0) curH = size.height;
        if (mode === 'fixed') {
            container.style.width = `${curW}px`;
            container.style.height = `${curH}px`;
        } else if (mode === 'reflow') {
            container.style.height = `${curH}px`;
        }
        recomputeInner();
    };

    // Preview an edit: compute the SAME proposal (same apply, same invariants) but
    // park it in the transient preview store instead of the belief store. The next
    // render draws it in place of the committed rows, so a hover shows exactly what
    // a click would commit — and `getData`/`onChange` never see it.
    /**
     * @param {any} feature
     * @param {import('../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {boolean}
     */
    const previewEdit = (feature, edit, event, index) => {
        const proposed = computeEdit(feature, edit, event, index);
        // Only a dataset proposal can be previewed; a domain edit commits directly
        // (numeric drag commits each tick, categorical add/remove is one-shot).
        if (!proposed || proposed.kind !== 'rows') return false;
        const newData = proposed.rows;
        // Park the proposal under THIS feature's id, so a second probe mark's preview
        // can't overwrite it. update()'s ghost pass renders only the changed rows.
        //
        // It carries the TABLE it is about, because the ghost is drawn by whichever
        // marks view that table — which is not always the mark that proposed it. A
        // connect drag proposes a link row from a node mark, and it is the link mark
        // that has to draw the rubber band.
        if (!ui.preview) ui.preview = {};
        ui.preview[feature.id] = { table: targetTableOf(feature, edit), rows: newData };
        return true;
    };

    // Direct-pick edits: the gesture landed on a mark (event.node). Fan the
    // gesture out to every direct edit whose `gesture` matches; `when` arbitrates
    // between edits sharing a gesture (plain-drag move vs Shift-drag resize).
    /**
     * @param {any} feature
     * @param {any} event
     * @returns {boolean}
     */
    const dispatchDirectEdits = (feature, event) => {
        const index = event.node ? event.node.index : undefined;
        if (index == null) return false;
        let changed = false;
        // A gesture normally fans to EVERY direct edit sharing its type (arbitrated
        // by each edit's `when`). An externally-driven event may ADDRESS one edit by
        // name (event.editName), so a feature carrying several same-gesture edits —
        // three `set()`s on a face's params — drives exactly the one asked for
        // instead of all of them. Native pointer events set no editName, so their
        // fan-out is unchanged.
        const direct = activeEdits(feature).filter(e => e.pick === 'direct'
            && (!event.editName || e.name === event.editName));

        // A direct edit may still need a multi-event LIFECYCLE — a relative `slide`
        // has to remember the pixel and value it started from, or the value would
        // jump to wherever the mark was pressed. Its driver owns that state exactly
        // as it does for a plane edit; the only difference is that the target is the
        // node under the pointer, so nothing is searched for and the plane stays
        // down. This is the driver registry doing its job, not a pick branch: the
        // engine asks `driverFor` and never names a mode.
        const lifecycle = direct.filter(e => driverFor(e));
        if (lifecycle.length && runDrivers(feature, event, lifecycle, index)) changed = true;

        direct
            .filter(e => e.gesture === event.type && !driverFor(e))
            .forEach(edit => { if (runEdit(feature, edit, event, index)) changed = true; });
        return changed;
    };

    // Hand a set of edits to the interaction drivers. Each driver (edit/drivers)
    // owns one multi-event lifecycle; we give every driver the edits it `wants`
    // plus a per-feature session, and it runs them. The engine knows no specific
    // mode — adding one means adding a driver file.
    //
    // Both dispatch paths come through here. A PLANE gesture carries no node, so
    // `index` is null and the driver resolves its own target from the pointer. A
    // DIRECT gesture landed on a node, so `index` names the datum and the driver
    // skips target selection entirely — same lifecycle, no raised plane.
    /**
     * @param {any} feature
     * @param {any} event
     * @param {import('../types').Edit[]} edits
     * @param {number | null} index the datum a direct gesture landed on, else null
     * @returns {boolean}
     */
    const runDrivers = (feature, event, edits, index) => {
        if (edits.length === 0) return false;
        const fid = feature.id;

        /** @param {import('../types').Edit} edit @param {number | null} index */
        const runFeatureEdit = (edit, index) => runEdit(feature, edit, event, index);
        /** @param {import('../types').Edit} edit @param {number | null} index */
        const previewFeatureEdit = (edit, index) => previewEdit(feature, edit, event, index);

        // The feature's uncommitted proposal, and the chart's stage cursor. Handed to
        // drivers as capabilities exactly like `session` — so a multi-event lifecycle
        // (hover to preview, click to commit and advance) lives in its driver file,
        // not in engine branches.
        const preview = {
            get: () => (ui.preview && ui.preview[fid]) || null,
            clear: () => {
                if (!ui.preview || !ui.preview[fid]) return false;
                delete ui.preview[fid];
                if (Object.keys(ui.preview).length === 0) ui.preview = null;
                return true;
            }
        };
        const stage = {
            get: () => currentStage,
            /** @param {number} n */
            set: (n) => applyStage(n),
            next: () => applyStage(currentStage + 1)
        };

        // Every edit reaches exactly ONE driver — the one `driverFor` names — so an
        // edit two drivers could claim is never run (and committed) twice per tick.
        // Iteration stays in REGISTRY order, which is load-bearing: a mark can carry
        // two lifecycles at once, and connect's dragend must run after move's.
        /** @type {Map<any, import('../types').Edit[]>} */
        const groups = new Map();
        for (const e of edits) {
            const d = driverFor(e);
            if (!d) continue;
            const list = groups.get(d) || [];
            list.push(e);
            groups.set(d, list);
        }

        let changed = false;
        for (const driver of drivers) {
            const matching = groups.get(driver);
            if (!matching) continue;
            // The per-feature session this driver reads/writes. It is SHARED with
            // every other driver on the mark, so `clear` nulls only the keys this
            // driver declared (`sessionKeys`) — ownership by contract, not memory.
            const own = driver.sessionKeys || [];
            const session = {
                get: () => (ui.session && ui.session[fid]) || null,
                /** @param {any} patch */
                set: (patch) => {
                    ui.session = ui.session || {};
                    ui.session[fid] = { ...(ui.session[fid] || {}), ...patch };
                },
                clear: () => {
                    if (!ui.session || !ui.session[fid]) return;
                    /** @type {Record<string, null>} */
                    const nulls = {};
                    for (const k of own) nulls[k] = null;
                    ui.session[fid] = { ...ui.session[fid], ...nulls };
                }
            };
            const dctx = {
                feature, event, edits: matching,
                marks: featureNodes[fid] || [],
                data: tableOf(feature),
                // Read-only: lets a driver (e.g. brush) encode a channel's current
                // pixel position for hit-zone classification, without reinventing
                // scale lookup — the same global scales every edit already inverts through.
                scales,
                index: index != null ? index : null,
                session,
                preview,
                stage,
                runEdit: runFeatureEdit,
                previewEdit: previewFeatureEdit
            };
            if (driver.onEvent(dctx)) changed = true;
        }
        return changed;
    };

    // Plane-pick edits: the gesture is on the plane, so it carries no node and the
    // driver resolves its own target.
    /**
     * @param {any} feature
     * @param {any} event
     * @returns {boolean}
     */
    const dispatchPlaneEdits = (feature, event) =>
        runDrivers(feature, event, activeEdits(feature).filter(e => e.pick !== 'direct'), null);

    // 4. Event routing.
    //    - Events carrying a `node` are mark-scoped (change existing elements) and
    //      route to that mark's direct-pick edits.
    //    - Events without a `node` are plane-scoped and route to every feature's
    //      plane/nearest/sweep/draw edits.
    /**
     * @param {any} event
     */
    const handleEvent = (event) => {
        let shouldRender = false;

        // Pointer-over/out on an editable mark. Pure interaction STATE — it never
        // reaches an edit, opens no undo transaction and writes no data; it only
        // records which row the pointer is on so the state pass can draw the
        // `hovered` effect (see core/effects.js). Handled before everything else so
        // it can't be mistaken for a gesture.
        //
        // This is the counterpart to a proximity driver's session: both answer "which
        // mark would a gesture take?", and they feed the same effect, so a direct-pick
        // mark now signals that before you press it instead of only changing the
        // cursor.
        // Hover is interaction STATE, like grab below: record it and let the one
        // render decision at the end draw the `hovered` effect. (It used to call
        // update() directly and return — a second render path beside shouldRender.)
        if (event.type === 'pointerover' || event.type === 'pointerout') {
            const node = event.node;
            const next = event.type === 'pointerover' && node && node.index != null
                ? { featureId: node.featureId, index: node.index }
                : null;
            /** @param {any} a @param {any} b */
            const same = (a, b) => (!a && !b)
                || !!(a && b && a.featureId === b.featureId && a.index === b.index);
            if (!same(ui.hover, next)) {
                ui.hover = next;
                const h = effects.hovered;
                if (h && h.enabled !== false && (h.outline || elementEffectOf(h))) shouldRender = true;
            }
            if (shouldRender) update();
            return;
        }

        // A keyboard nudge is INPUT NORMALIZATION, not an interaction mode: the
        // renderer reports "one step this way" and we resolve it into the pixel a
        // pointer would have been at, so it arrives as an ordinary `drag`. Every
        // direct-pick drag edit becomes keyboard-drivable with no new edit, no new
        // driver, and nothing downstream learning that keyboards exist.
        if (event.type === 'nudge') {
            // Step from where the datum's CURRENT VALUE sits, which is not the same
            // as where the node sits: a bar's centre is halfway up the bar, so
            // nudging from it would first teleport the value to the middle of
            // itself. encodeChannel answers "where is this datum on this axis" the
            // same way the mark drew it — the node centre is only the fallback for
            // a mark with nothing positional on that axis.
            const node = event.node;
            const from = markCenter(node);
            if (!from) return;
            const feature = features.find((f) => f.id === node.featureId);
            const channels = (feature && feature.channels) || {};
            const datum = node.index != null ? (feature ? tableOf(feature) : [])[node.index] : node.data;
            // Inside a composite's frame the datum's position is a LOCAL one, so read it
            // (and step it) through the node's own frame scales — the same overlay
            // computeEdit applies when the resulting drag arrives.
            const ks = frameScalesFor(feature, node, node.index) || scales;
            const atX = datum ? encodeChannel(ks, channels, 'x', datum, from.cx) : from.cx;
            const atY = datum ? encodeChannel(ks, channels, 'y', datum, from.cy) : from.cy;
            event = {
                type: 'drag',
                node,
                x: nudgeTarget(ks.x, atX, event.dx, event.coarse),
                y: nudgeTarget(ks.y, atY, event.dy, event.coarse),
                // One press = one complete gesture (there is no dragend coming), so
                // it closes its own undo transaction below.
                nudge: true,
                rawEvent: event.rawEvent,
            };
        }

        // Undo transaction boundaries. A stroke is one unit of "take that back":
        // dragstart opens it and dragend closes it, so the many commits a drag makes
        // in between collapse into a single history entry. Any other gesture (click,
        // dblclick, a typed commit) is a transaction of its own — begin it here and
        // close it below, so it can't absorb the next one.
        // dragstart always starts a fresh one, so a stroke whose dragend never
        // arrived can't leak its stale "before" into the next gesture.
        if (event.type === 'dragstart') { endTxn(true); beginTxn(); }
        else if (!txn) beginTxn();

        // Grab state rides the SAME bracket as the transaction — one stroke, one
        // grabbed row — so the state pass can draw `grabbed` beside the other two
        // instead of the renderer painting it privately off d3.drag. Force a render
        // when it changes and the state actually paints something: a press that
        // moves no data (or none yet) still has to light the mark up, which is the
        // whole point of pre-commit feedback.
        if (event.type === 'dragstart' || event.type === 'dragend') {
            const next = event.type === 'dragstart' && event.node && event.node.index != null
                ? { featureId: event.node.featureId, index: event.node.index }
                : null;
            const changed = !!ui.grab !== !!next
                || !!(ui.grab && next && (ui.grab.featureId !== next.featureId || ui.grab.index !== next.index));
            ui.grab = next;
            const g = effects.grabbed;
            if (changed && g && g.enabled !== false && (g.outline || elementEffectOf(g))) shouldRender = true;
        }

        if (event.node) {
            // Dispatch to the touched mark's feature (direct pick).
            const feature = features.find(f => f.id === event.node.featureId);
            if (feature && dispatchDirectEdits(feature, event)) shouldRender = true;
        } else {
            // Plane gestures -> every feature's plane/nearest/sweep/draw edits.
            features.forEach(feature => {
                if (dispatchPlaneEdits(feature, event)) shouldRender = true;
            });
        }

        // Keep the transaction open only for the duration of a stroke. A nudge's
        // synthetic drag is a complete gesture on its own, so it closes too —
        // otherwise it would stay open and swallow whatever gesture came next.
        if (event.type === 'dragend' || event.nudge
            || (event.type !== 'dragstart' && event.type !== 'drag')) endTxn(true);

        if (shouldRender) {
            update();
        }
    };

    // Caller-facing data API, attached to the container the engine returns. This
    // is pure observation over the belief `dataset` — it adds no interaction path
    // (edits/constraints stay the only way a gesture mutates data).
    const el = /** @type {import('../types').ElicitElement} */ (/** @type {any} */ (container));
    // A deep copy so callers can't mutate the live store; structuredClone (not a
    // JSON round-trip) preserves Date values a time-scale edit may have written.
    el.getData = () => structuredClone(shapeData());
    // A deep copy of the engine-owned schema, so a caller can read a DOMAIN an
    // editable axis reshaped (the caller's original spec.schema is never mutated).
    // Denormalized back to the spelling it was GIVEN in: a single-table chart gets
    // its bare field map, so the engine's canonical form never leaks outward.
    el.getSchema = () => structuredClone(denormalizeSchema(schemaSpec));
    // Replace the dataset and re-render. Bypasses constraints by design:
    // constraints gate GESTURES; caller-supplied data is trusted (seeding/reset).
    // That includes the lock: setData RE-SEEDS the chart, so under `lock: 'seed'`
    // the rows it hands in become the new read-only seed.
    el.setData = (/** @type {any[] | Record<string, any[]>} */ data) => {
        // Same split as the seed: a bare array is the primary table, a keyed object
        // names its tables. So a caller's setData(rows) keeps working verbatim.
        tables = normalizeData(structuredClone(data ?? null), schemaSpec);
        // A reseed is new seed data, so it gets the same contract check as spec.data.
        validateTables(schemaSpec, tables, 'setData()');
        seedCounts = {};
        for (const name of Object.keys(tables)) seedCounts[name] = tables[name].length;
        ui.preview = null;
        ui.hover = null;   // the pointer's row index is new too
        ui.grab = null;    // and any in-flight grab points at a row that just moved
        ui.selection.clear(); // a reseed's row indices are new; drop the old selection
        // A reseed is a new starting point, not an edit: there is nothing sensible
        // to undo BACK to (and undoing past it would resurrect rows the caller
        // replaced, under a lock that no longer covers them).
        past = [];
        future = [];
        // Writes queued against the old dataset name rows that may not exist in the
        // new one; a reseed is a new starting point for them too.
        pending = [];
        endTxn();
        update();
    };

    // ── External writes: el.patch ──────────────────────────────────────────────
    // setData is a RESEED, and says so: history, selection and any stroke in flight
    // all go. That is right for "load a different dataset" and wrong for a second
    // writer working on the same one — an agent marking a step done while a person
    // drags another. el.patch is that second writer's door: rows addressed by KEY,
    // not index, merged into the live dataset without disturbing the person.
    //
    // A row's key is its table's `key: true` field. A links table usually declares
    // none, and there a link IS its pair of `ref` ends — the same identity a
    // `unique({ field: ['source', 'target'] })` constraint already treats as one.

    /** @param {string} name @returns {string[]} */
    const keyFieldsOf = (name) => {
        const table = schemaSpec.tables[name];
        if (!table) throw new Error(`patch(): there is no table named "${name}".`);
        const fields = Object.entries(table.fields);
        const keys = fields.filter(([, f]) => f && f.key).map(([k]) => k);
        if (keys.length) return keys;
        const refs = fields.filter(([, f]) => f && f.type === 'ref').map(([k]) => k);
        if (refs.length) return refs;
        throw new Error(`patch(): table "${name}" has no key field (\`key: true\`) and no \`ref\` fields, so its rows cannot be addressed.`);
    };
    /** @param {string[]} fields @param {any} row */
    const keyOfRow = (fields, row) => JSON.stringify(fields.map((f) => (row ? row[f] : undefined)));
    /** A `remove` entry: the bare key value for a one-field key, else a row-shaped object or an array. */
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
            name,
            fields,
            insert: ops.insert || [],
            update: ops.update || [],
            remove: new Set((ops.remove || []).map((/** @type {any} */ k) => keyOfRemoval(fields, k))),
        };
    });

    // Apply a compiled patch to one set of tables — the live ones, or a history
    // snapshot. `report` is passed for the live tables only: a snapshot that lacks a
    // row the live data has is ordinary history, not a conflict.
    /** @param {Record<string, any[]>} target @param {any[]} plan @param {any} [report] */
    const applyPatchTo = (target, plan, report) => {
        for (const op of plan) {
            let rows = target[op.name] || [];
            if (op.remove.size) rows = rows.filter((r) => !op.remove.has(keyOfRow(op.fields, r)));
            const at = new Map(rows.map((r, i) => [keyOfRow(op.fields, r), i]));
            for (const row of op.update) {
                const k = keyOfRow(op.fields, row);
                const i = at.get(k);
                if (i === undefined) { if (report) report.missing.push({ table: op.name, key: JSON.parse(k) }); continue; }
                rows[i] = { ...rows[i], ...structuredClone(row) };
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
        // A removed node takes its links with it here exactly as in a gesture.
        enforceRefs(schemaSpec, target);
    };

    /** @param {any[]} plan @param {'keep' | 'record'} history */
    const applyPatchLive = (plan, history) => {
        // Selection names rows by index, and a removal renumbers rows: remember the
        // selected rows by key, find them again afterwards.
        const remembered = [...ui.selection].map(selParse).map(({ table, index }) => {
            const fields = schemaSpec.tables[table] ? safeKeyFields(table) : null;
            return { table, key: fields ? keyOfRow(fields, (tables[table] || [])[index]) : null, fields };
        });
        // A 'seed' lock reads "the first N rows". Removals keep order and inserts
        // append, so the seeded rows stay at the head; only N has to shrink.
        /** @type {Record<string, Set<string>>} */
        const seededKeys = {};
        for (const op of plan) {
            seededKeys[op.name] = new Set((tables[op.name] || []).slice(0, seedCounts[op.name] || 0).map((r) => keyOfRow(op.fields, r)));
        }
        const sizes = Object.fromEntries(Object.entries(tables).map(([n, r]) => [n, r.length]));

        if (history === 'record') {
            past.push(snapshot());
            if (past.length > MAX_HISTORY) past.shift();
            future = [];
        }
        const report = { inserted: 0, updated: 0, removed: 0, missing: /** @type {any[]} */ ([]), conflicts: /** @type {any[]} */ ([]) };
        applyPatchTo(tables, plan, report);
        validateTables(schemaSpec, tables, 'patch()');
        // 'keep': the write is a fact about the data, not a step of the person's.
        // Rebase it into every snapshot, so undoing their last drag cannot revert it.
        if (history === 'keep') for (const snap of [...past, ...future]) applyPatchTo(snap.tables, plan);

        // Removed = rows gone, net of the rows inserted (cascaded links included).
        let net = 0;
        for (const name of new Set([...Object.keys(sizes), ...Object.keys(tables)])) {
            net += (sizes[name] || 0) - (tables[name] || []).length;
        }
        report.removed = net + report.inserted;
        for (const op of plan) {
            if (seedCounts[op.name]) seedCounts[op.name] = (tables[op.name] || []).filter((r) => seededKeys[op.name].has(keyOfRow(op.fields, r))).length;
        }

        const before = [...ui.selection].join('|');
        ui.selection.clear();
        for (const { table, key, fields } of remembered) {
            if (key == null || !fields) continue;
            const i = (tables[table] || []).findIndex((r) => keyOfRow(fields, r) === key);
            if (i >= 0) ui.selection.add(selKey(table, i));
        }
        ui.preview = null;
        ui.hover = null;
        notifyChange();
        if ([...ui.selection].join('|') !== before) notifySelect();
        update();
        return report;
    };
    /** @param {string} table */
    const safeKeyFields = (table) => { try { return keyFieldsOf(table); } catch { return null; } };

    const flushPending = () => {
        const queue = pending;
        pending = [];
        for (const p of queue) applyPatchLive(p.plan, p.history);
    };

    el.patch = (/** @type {any} */ changes, /** @type {{ history?: 'keep' | 'record' }} */ options = {}) => {
        const history = options.history ?? 'keep';
        if (history !== 'keep' && history !== 'record') {
            throw new Error(`patch(): history is "keep" or "record", not "${history}".`);
        }
        const plan = compilePatch(changes);
        // Mid-stroke, the renderer holds the grabbed row by the INDEX it had at
        // dragstart. Field writes and appends renumber nothing, so they land now; a
        // removal would make the stroke write the wrong row, so it waits for the
        // stroke to end — and so does anything queued behind it, so writes land in
        // the order they were made.
        if (txn && (pending.length || plan.some((op) => op.remove.size))) {
            pending.push({ plan, history });
            return { deferred: true };
        }
        return applyPatchLive(plan, history);
    };

    // ── Selection: read/drive the transient selection from outside ────────────
    // Selection is pipeline state, not data — so it has its own small API beside
    // getData/setData, and its own `select` event. Driving it externally goes
    // through the SAME applySelection the edit.select gesture does, so an external
    // <select>, a keyboard, or a click all leave the selection in one shape.

    // The primary selected index (number) or null. The counterpart of getData for
    // selection; a caller reads it to drive its own UI (which row is highlighted).
    // Stays scalar under multi-select — it reports the FIRST selected row, so a
    // caller written against a single selection keeps working.
    el.getSelection = () => selectionPrimary();

    // EVERY selected index, ascending. What to read when the chart can hold more
    // than one (edit.select({ multi: true }), el.select([…]), el.selectAll()).
    el.getSelectionAll = () => selectionList();

    // Drive the selection from outside, then render. Each wrapper renders itself (it
    // runs OUTSIDE the dispatch, which is what renders the gesture path), and returns
    // whether the selection moved.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const driveSelection = (sel) => {
        const moved = commitSelectionEdit(sel);
        if (moved) update();
        return moved;
    };

    // Select a SPECIFIC ITEM by dataset index (the external counterpart of clicking
    // a mark). `null` (or a negative / out-of-range index) clears the selection.
    // Exclusive: the named row becomes the sole selection, replacing whatever was
    // selected. An ARRAY selects exactly those rows — the whole set is replaced, so
    // the call is idempotent and there is no clear-then-add for a caller to get
    // half-right. An empty array clears, like `null`.
    el.select = (/** @type {number | number[] | null} */ index) => {
        const rows = primaryRows();
        const ok = (/** @type {any} */ i) => typeof i === 'number' && i >= 0 && i < rows.length;
        if (Array.isArray(index)) {
            const list = index.filter(ok);
            if (!list.length) return driveSelection({ index: null, clear: true });
            // One commit, so `select` fires once and the render happens once: clear
            // through the same descriptor path, then add the rest additively.
            const before = [...ui.selection].join(',');
            applySelection({ index: list[0], exclusive: true, toggle: false });
            for (const i of list.slice(1)) applySelection({ index: i, exclusive: false, toggle: false });
            if ([...ui.selection].join(',') === before) return false;
            notifySelect();
            update();
            return true;
        }
        const i = ok(index) ? /** @type {number} */ (index) : null;
        return driveSelection({ index: i, exclusive: true, toggle: false, clear: i == null });
    };

    // Add or remove ONE row, leaving the rest of the selection alone — the external
    // counterpart of a shift-click (edit.select({ multi: true })).
    el.toggleSelection = (/** @type {number} */ index) =>
        driveSelection({ index, exclusive: false, toggle: true });

    // Select every row of the primary table.
    el.selectAll = () => el.select(primaryRows().map((_, i) => i));

    // Select by CATEGORY / predicate: pick rows matching `{ field: value }` (or a
    // predicate function) and select them. This is the "select a category" entry
    // point — an external control names a value, the chart finds and selects the
    // rows carrying it. No match clears the selection.
    //
    // `{ all: true }` selects EVERY match; the default is the first one only. A
    // category is usually several rows, so `all` is what "select a category"
    // normally means — but changing the default would silently widen every existing
    // caller's selection, so it is opt-in.
    el.selectWhere = (/** @type {any} */ where, /** @type {any} */ value, /** @type {any} */ options) => {
        const match = typeof where === 'function'
            ? /** @type {(d: any, i: number) => boolean} */ (where)
            : (/** @type {any} */ d) => d && d[where] === value;
        const rows = primaryRows();
        if (options && options.all) {
            const hits = rows.map((d, i) => (match(d, i) ? i : -1)).filter((i) => i >= 0);
            return el.select(hits.length ? hits : null);
        }
        const i = rows.findIndex(match);
        return el.select(i < 0 ? null : i);
    };

    // Clear the selection entirely.
    el.clearSelection = () => driveSelection({ index: null, clear: true });

    // ── External control: drive an edit from outside the chart ────────────────
    // An external controller (a slider, a `<select>`, a rotate icon, a plain
    // function) is a new INPUT SOURCE, not a second interaction system. It
    // synthesizes the SAME renderer-shaped events the pointer and keyboard
    // produce and feeds them to the one `handleEvent` — exactly what the keyboard
    // `nudge` normalizer already does above. Constraints, undo, guides,
    // `on('change')`, and re-render all run because the event traverses the
    // identical pipeline. No new pick, no driver, no dispatch branch.

    // Low-level: inject a renderer-shaped event. `x`/`y` are INNER (margin-
    // subtracted) pixels — the space `ctx.pointer` reads. Event shape:
    // { type, node?, x?, y?, value?, nudge?, rawEvent? }. Callers usually want
    // `el.control(name)` (below), which computes pixels from a DATA value for you.
    el.emit = (/** @type {any} */ event) => handleEvent(event);

    // Find the (feature, edit) an external controller addresses by `name` (set via
    // move({ name: 'move' }) etc.). Lazy — scanned each call so it tracks re-renders
    // and stage changes.
    const findNamedEdit = (/** @type {string} */ name) => {
        /** @type {{ feature: any, edit: any } | null} */
        let hit = null;
        // Count DISTINCT edits, by their `apply` — the one part of a descriptor that
        // survives collectEdits' channel-injecting copy and is unique per factory
        // call. The name is ambiguous only when two edits that do different things
        // answer to it; ONE edit declared on several parts of a glyph (a face's two
        // eyes, its two brows) is not a collision, and "driving the first" is exactly
        // right there — they are the same edit over the same column.
        /** @type {Set<any>} */
        const distinct = new Set();
        for (const feature of features) {
            for (const edit of collectEdits(feature)) {
                if (edit.name !== name) continue;
                distinct.add(edit.apply);
                if (!hit) hit = { feature, edit };
            }
        }
        if (distinct.size === 0) warn(`control:none:${name}`, `el.control("${name}"): no edit is named "${name}".`);
        if (distinct.size > 1) warn(`control:many:${name}`, `el.control("${name}"): ${distinct.size} different edits share the name "${name}"; driving the first.`);
        return hit;
    };

    // The scene node for a datum index in a feature, resolved fresh from the CURRENT
    // render (never cached — nodes are rebuilt every update). Gives radial edits
    // (resize/rotate about the mark) their pivot via markCenter.
    const nodeAt = (/** @type {any} */ feature, /** @type {number} */ index) =>
        (featureNodes[feature.id] || []).find((/** @type {any} */ n) => n && n.index === index) || null;

    // High-level façade: a handle bound to a named edit + datum. It reads the edit's
    // own `gesture` to route value-space vs pointer-space — the FAÇADE branches; the
    // engine dispatch never learns a controller exists.
    el.control = (/** @type {string} */ name, /** @type {number} */ index = 0) => {
        // Value -> the pointer that would set it, forward-encoding through the SAME
        // scale the edit inverts (the inverse of the edit's inverse — encoding, run
        // forward). Mirrors the nudge normalizer: untouched axes keep the datum's
        // CURRENT pixel so they don't teleport.
        const dragPointer = (/** @type {any} */ feature, /** @type {any} */ edit, /** @type {any} */ value) => {
            const node = nodeAt(feature, index);
            const center = markCenter(node);
            const datum = primaryRows()[index];
            const channels = feature.channels || {};
            // Forward-encode through the SAME scales the edit will invert — which,
            // inside a composite's frame, are the node's own (see frameScalesFor).
            const editScales = frameScalesFor(feature, node, index) || scales;
            // Base: where the datum currently sits, so a single-axis set doesn't move
            // the other axis.
            let x = datum ? encodeChannel(editScales, channels, 'x', datum, center ? center.cx : 0) : (center ? center.cx : 0);
            let y = datum ? encodeChannel(editScales, channels, 'y', datum, center ? center.cy : 0) : (center ? center.cy : 0);
            const resolved = resolveChannels(edit.channels, channels, editScales, feature);
            // `value` is either a scalar (single-channel edit) or a { channelName: v }
            // / { field: v } map for a multi-channel edit (a 2-D drag).
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
                // A positional channel moves its own coordinate only; anything
                // pointerForChannel resolved about a pivot (a radius, a bearing)
                // sets both. Read off the axis map, never a channel name.
                const a = axisOf(ch.name);
                if (a !== 'y') x = p.x;
                if (a !== 'x') y = p.y;
            }
            return { node, x, y };
        };

        // True between begin() and end(): a live drag session, so `.set` ticks emit a
        // plain `drag` (they collapse into the open txn) instead of a self-closing
        // one-shot `nudge` drag (which would close the txn every tick).
        let live = false;

        const handle = {
            // One-shot write. Commit-gesture edits (set/editText) carry the value whole
            // in `ctx.value`; drag-gesture edits forward-encode it to a pointer. Outside
            // a begin()/end() session a drag self-closes its txn with `nudge:true` (one
            // undo entry); inside one, it stays a plain `drag` so the session collapses.
            set(/** @type {any} */ value) {
                const found = findNamedEdit(name);
                if (!found) return;
                const { feature, edit } = found;
                const node = nodeAt(feature, index);
                // editName addresses THIS edit, so a sibling edit sharing the gesture
                // (another set() on the same feature) doesn't also fire.
                if (edit.gesture === 'commit') {
                    el.emit({ type: 'commit', node, value, editName: name, x: node ? node.cx : 0, y: node ? node.cy : 0 });
                    return;
                }
                const { node: n, x, y } = dragPointer(feature, edit, value);
                el.emit(live
                    ? { type: 'drag', node: n, x, y, editName: name }
                    : { type: 'drag', node: n, x, y, nudge: true, editName: name });
            },
            // Live drag: begin()/end() bracket the txn so many .set() ticks collapse
            // into ONE undo entry (exactly like a pointer drag's dragstart..dragend).
            begin() {
                const found = findNamedEdit(name);
                if (!found) return;
                live = true;
                el.emit({ type: 'dragstart', node: nodeAt(found.feature, index), editName: name });
            },
            end() {
                const found = findNamedEdit(name);
                live = false;
                if (!found) return;
                el.emit({ type: 'dragend', node: nodeAt(found.feature, index), editName: name });
            },
            // Fire a TRIGGER edit — one that takes no value, it just acts on the datum
            // (cycle advances a category, remove drops the row, toggle flips it). An
            // external button drives it: `control(name).fire()` dispatches the edit's
            // own gesture (a click/dblclick) on the datum's node. Pass a gesture to
            // override. This is the counterpart of `.set` for the click/dblclick edits
            // — `.set` covers commit/drag, `.fire` covers the rest. (Plane-pick edits
            // like create need coordinates; use `.emit({ type, x, y })` for those.)
            fire(/** @type {string} */ gesture) {
                const found = findNamedEdit(name);
                if (!found) return;
                const g = gesture || found.edit.gesture || 'click';
                el.emit({ type: g, node: nodeAt(found.feature, index), editName: name });
            },
            // Raw passthrough, auto-scoped to this feature's node for the datum.
            emit(/** @type {any} */ event) {
                const found = findNamedEdit(name);
                el.emit({ node: found ? nodeAt(found.feature, index) : undefined, ...event });
            },
            // What values this channel ACCEPTS, read off its scale — so external UI
            // (dropdown options, slider min/max, colour choices) respects the scale
            // instead of fighting it. Reads capability flags, never `scale.type`.
            accepts() {
                const found = findNamedEdit(name);
                if (!found) return null;
                const { feature, edit } = found;
                const editScales = frameScalesFor(feature, null, index) || scales;
                const ch = resolveChannels(edit.channels, feature.channels || {}, editScales, feature)[0];
                const scale = /** @type {any} */ (ch && ch.scale);
                const fieldSpec = (schema && ch && ch.field && schema[ch.field]) || null;
                const measure = (fieldSpec && fieldSpec.type) || null;
                // Prefer the scale's domain; fall back to the schema's declared domain
                // so a non-positional channel (a face param) still reports its range.
                const domain = (scale && typeof scale.domain === 'function' ? scale.domain() : null)
                    || (fieldSpec && fieldSpec.domain) || null;
                const range = scale && typeof scale.range === 'function' ? scale.range() : null;
                return {
                    field: ch ? ch.field : null,
                    type: measure,                         // MeasureType (quantitative/categorical/…)
                    kind: scale ? scale.kind : null,       // band | point | continuous | discrete
                    temporal: !!(scale && scale.temporal),
                    invertible: !!(scale && scale.invertible),
                    // A discrete channel's domain IS its accepted value set; a
                    // continuous channel's domain is its accepted [min, max].
                    domain,
                    values: (
                        (scale && (scale.kind === 'band' || scale.kind === 'discrete' || scale.kind === 'point'))
                        || measure === 'categorical' || measure === 'ordinal'
                    ) ? domain : null,
                    range,
                };
            },
        };
        return handle;
    };

    // Undo / redo one GESTURE (see the history store above). Both return whether
    // they moved, so a caller can drive a button's disabled state; both fire the
    // ordinary `change` notification, because as far as anything downstream is
    // concerned the data just changed.
    el.canUndo = () => past.length > 0;
    el.canRedo = () => future.length > 0;
    el.undo = () => {
        if (!past.length) return false;
        future.push(snapshot());
        restoreSnapshot(/** @type {any} */(past.pop()));
        endTxn();
        notifyChange();
        update();
        return true;
    };
    el.redo = () => {
        if (!future.length) return false;
        past.push(snapshot());
        restoreSnapshot(/** @type {any} */(future.pop()));
        endTxn();
        notifyChange();
        update();
        return true;
    };
    // Subscribe to committed changes; returns an unsubscribe function.
    el.on = (/** @type {'change' | 'stage' | 'select' | 'gesture'} */ type, /** @type {Function} */ cb) => {
        listeners[type].add(cb);
        return () => listeners[type].delete(cb);
    };

    // Multi-stage controls. Advancing the stage re-renders (the active edit set,
    // plane-on-top, and cursors all follow currentStage) and drops every transient.
    el.getStage = () => currentStage;
    el.getStageLabel = () => stageLabelOf(currentStage);
    el.setStage = (/** @type {number} */ stage) => {
        applyStage(stage);
        update();
    };
    el.nextStage = () => el.setStage(currentStage + 1);

    // 'reflow' mode: watch the container and re-render when the parent resizes.
    // rAF-coalesced (a resize can fire many times per frame) and guarded so a
    // render that doesn't change the width can't feed back into a loop.
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
    // Detach the observer (and its hold on the container). Call when unmounting a
    // reflow chart; no-op otherwise.
    el.destroy = () => {
        if (ro) { ro.disconnect(); ro = null; }
    };

    // Initial render. Deferred so the container can be attached to the DOM first
    // if the renderer needs measured dimensions.
    setTimeout(update, 0);

    return el;
}
