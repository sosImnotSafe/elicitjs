// @ts-check
/**
 * Undo history as snapshots, one per gesture (dragstart to dragend; a click or
 * typed commit is its own). The first commit in a gesture records the state
 * before it. Snapshots also carry the schema, which axis edits change, each
 * attached chart's own state (its size, which an axis grow changes), and which
 * chart's pixels a hierarchy was settled in (so a restore is not re-settled).
 *
 * The open transaction has an owner: the chart whose gesture opened it, or none
 * for a dataset method. A chart closes only its own, and a commit by another
 * owner records a new step, so events in one chart never merge into or split
 * another chart's gesture.
 */

const MAX_HISTORY = 100;

/**
 * @param {import('../dataset.js').DataState} state
 * @param {{
 *   schemaSpec: import('../../types').SchemaSpec,
 *   charts: import('../dataset.js').ChartHook[],
 *   layout: { owner: import('../dataset.js').ChartHook | null },
 *   isContextRow: (name: string, d: any) => boolean,
 *   notifyChange: () => void,
 *   update: () => void,
 *   onGesture?: (done: { before: any, edits: any[] }) => void,
 *   afterTxn?: () => void,
 * }} deps
 */
export function createHistory(state, deps) {
    const { schemaSpec, charts } = deps;
    /** @type {any[]} */
    let past = [];
    /** @type {any[]} */
    let future = [];
    // A transaction is one gesture. Besides its owner and whether it has snapshotted,
    // it keeps the snapshot it started from and the edits that fired in it, so its
    // end can be reported as one 'gesture' event rather than as every commit on the way.
    /** @type {{ owner: any, recorded: boolean, before: any, edits: any[] } | null} */
    let txn = null;
    /** @type {any} */
    let wheelTimer = null;

    // Snapshot every table's schema, plus context membership as row indices
    // (the clone has new row objects, and the context set is keyed by identity).
    const snapshot = () => {
        /** @type {Record<string, any>} */
        const schemas = {};
        for (const name of Object.keys(schemaSpec.tables)) schemas[name] = structuredClone(schemaSpec.tables[name].fields);
        /** @type {Record<string, number[]>} */
        const context = {};
        for (const name of Object.keys(state.contextRows)) {
            context[name] = [];
            (state.tables[name] || []).forEach((d, i) => { if (deps.isContextRow(name, d)) context[name].push(i); });
        }
        return {
            tables: structuredClone(state.tables), schemas, context,
            charts: new WeakMap(charts.map((c) => [c, c.snapshot()])), owner: deps.layout.owner,
        };
    };

    /** @param {any} snap */
    const restoreSnapshot = (snap) => {
        state.tables = structuredClone(snap.tables);
        for (const [name, idx] of Object.entries(snap.context)) {
            /** @type {WeakSet<object>} */
            const set = new WeakSet();
            for (const i of /** @type {number[]} */ (idx)) if (state.tables[name] && state.tables[name][i]) set.add(state.tables[name][i]);
            state.contextRows[name] = set;
        }
        // Replace each schema's contents in place; closures hold the field maps.
        for (const [name, fields] of Object.entries(snap.schemas)) {
            const live = schemaSpec.tables[name] && schemaSpec.tables[name].fields;
            if (!live) continue;
            for (const k of Object.keys(live)) delete live[k];
            Object.assign(live, structuredClone(fields));
        }
        // A chart attached after the snapshot has no entry; it restores nothing.
        for (const c of charts) c.restore(snap.charts.get(c));
        deps.layout.owner = snap.owner;
    };

    // Open a transaction for `owner`. The snapshot is taken lazily by
    // recordHistory, so a gesture that never commits clones nothing.
    /** @param {any} owner */
    const beginTxn = (owner) => { txn = { owner, recorded: false, before: null, edits: [] }; };
    // Close `owner`'s transaction; with no owner (a dataset method), whichever is open.
    // `notify` only where a gesture really ends (a chart's dispatch, a wheel burst going
    // quiet): setData, undo and the dataset methods close one too, but no gesture happened.
    /** @param {any} [owner] @param {{ notify?: boolean }} [options] */
    const endTxn = (owner, options) => {
        if (!(owner === undefined || (txn && txn.owner === owner))) return;
        const done = txn;
        txn = null;
        if (options && options.notify && done && done.recorded && deps.onGesture) deps.onGesture(done);
        if (deps.afterTxn) deps.afterTxn();
    };

    // Called by every commit path before it mutates state. The first commit in
    // `owner`'s transaction snapshots the state and drops the redo stack.
    /** @param {any} [owner] */
    const recordHistory = (owner) => {
        if (txn && txn.owner === owner && txn.recorded) return;
        const snap = snapshot();
        past.push(snap);
        if (past.length > MAX_HISTORY) past.shift();
        future = [];
        // `before` is the very snapshot the undo stack holds, so a write rebased into
        // history (patch, 'keep') is rebased into the gesture's "before" too.
        const edits = txn && txn.owner === owner ? txn.edits : [];
        txn = { owner, recorded: true, before: snap, edits };
    };

    // Which edits the open gesture fired, for its 'gesture' event.
    /** @param {any} owner @param {{ type: string, name?: string, table: string }} edit */
    const noteEdit = (owner, edit) => { if (txn && txn.owner === owner) txn.edits.push(edit); };
    // Is a chart's gesture open (a stroke in flight, a wheel burst)?
    const inGesture = () => !!(txn && txn.owner != null);
    // A step of its own for a write from outside, without closing a chart's gesture.
    const push = () => {
        past.push(snapshot());
        if (past.length > MAX_HISTORY) past.shift();
        future = [];
    };
    // Run `fn` over every snapshot, undo and redo alike (patch, 'keep').
    /** @param {(snap: any) => void} fn */
    const rebase = (fn) => { for (const snap of [...past, ...future]) fn(snap); };

    // Decide which transaction an incoming event belongs to. A dragstart always
    // opens a fresh one, so a lost dragend can't leak into the next gesture.
    /** @param {string} type the event's type @param {any} owner the chart it reached */
    const gestureTxn = (type, owner) => {
        // A wheel burst is one transaction, closed by a timer once the wheel goes quiet.
        if (type === 'wheel') {
            if (!txn || txn.owner !== owner || wheelTimer == null) beginTxn(owner);
            if (wheelTimer != null) clearTimeout(wheelTimer);
            wheelTimer = setTimeout(() => { wheelTimer = null; endTxn(owner, { notify: true }); }, 350);
        } else if (type === 'dragstart') beginTxn(owner);
        else if (!txn) beginTxn(owner);
    };

    // Clear history on a reseed (setData).
    const reset = () => {
        past = [];
        future = [];
        endTxn();
    };

    // Undo / redo one gesture. Both return whether they moved and fire `change`.
    const canUndo = () => past.length > 0;
    const canRedo = () => future.length > 0;
    const undo = () => {
        if (!past.length) return false;
        future.push(snapshot());
        restoreSnapshot(/** @type {any} */(past.pop()));
        endTxn();
        deps.notifyChange();
        deps.update();
        return true;
    };
    const redo = () => {
        if (!future.length) return false;
        past.push(snapshot());
        restoreSnapshot(/** @type {any} */(future.pop()));
        endTxn();
        deps.notifyChange();
        deps.update();
        return true;
    };

    return { endTxn, recordHistory, gestureTxn, reset, canUndo, canRedo, undo, redo, noteEdit, inGesture, push, rebase };
}
