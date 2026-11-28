// @ts-check
import { isBareForm } from '../schema.js';

/**
 * Selection: which rows the reader has picked, and the API that drives it.
 *
 * Keys are qualified by table (node 3 is not link 3). The public API is
 * index-based and means the primary table. Selection is not belief data: it
 * fires `select`, never `change`, and bypasses undo.
 *
 * @param {import('../dataset.js').DataState} state
 * @param {{
 *   schemaSpec: import('../../types').SchemaSpec,
 *   selected: Set<string>,
 *   listeners: { select: Set<Function> },
 *   primaryRows: () => any[],
 *   reportedRows: (name: string) => any[],
 *   rowIndexOf: (name: string, i: number) => number,
 *   reportedIndexOf: (name: string, j: number) => number | null,
 *   update: () => void,
 * }} deps
 */
export function createSelection(state, deps) {
    const { schemaSpec, selected, listeners, primaryRows, reportedRows, rowIndexOf, reportedIndexOf } = deps;

    /** @param {string} table @param {number} index @returns {string} */
    const selKey = (table, index) => `${table}\u0000${index}`;
    /** @param {string} key @returns {{ table: string, index: number }} */
    const selParse = (key) => {
        const at = key.indexOf('\u0000');
        return { table: key.slice(0, at), index: Number(key.slice(at + 1)) };
    };
    /** The selected row indices in one table. @param {string} table @returns {Set<number>} */
    const selectionIn = (table) => {
        /** @type {Set<number>} */
        const out = new Set();
        for (const key of selected) {
            const s = selParse(key);
            if (s.table === table) out.add(s.index);
        }
        return out;
    };

    // The first live selected index in the primary table, or null. A stale index
    // (row since removed) is skipped.
    const selectionPrimary = () => {
        for (const i of selectionIn(schemaSpec.primary)) {
            if (i >= 0 && i < primaryRows().length) return i;
        }
        return null;
    };

    // Every live selected index in one table, ascending.
    /** @param {string} [table] @returns {number[]} */
    const selectionList = (table = schemaSpec.primary) => {
        const n = (state.tables[table] || []).length;
        return [...selectionIn(table)].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
    };

    // The selection in reported indices (matching `getData()`); context rows are left out.
    /** @param {string} [table] @returns {number[]} */
    const reportedSelection = (table = schemaSpec.primary) => /** @type {number[]} */ (
        selectionList(table).map((i) => reportedIndexOf(table, i)).filter((i) => i != null)
    );
    // Notify a selection change.
    const notifySelect = () => {
        const list = reportedSelection();
        const primary = list.length ? list[0] : null;
        // Single-table charts report bare indices; multi-table ones report {table, index}.
        const all = isBareForm(schemaSpec)
            ? [...selectionIn(schemaSpec.primary)].map((i) => reportedIndexOf(schemaSpec.primary, i)).filter((i) => i != null)
            : [...selected].map(selParse)
                .map((sel) => ({ ...sel, index: reportedIndexOf(sel.table, sel.index) }))
                .filter((sel) => sel.index != null);
        for (const cb of listeners.select) cb(primary, /** @type {any} */ (all));
    };

    // Commit a selection edit to `selected`, skipping constraints and undo.
    // Returns whether the selection moved; it does not render (the caller does).
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const commitSelectionEdit = (sel, table = schemaSpec.primary) => {
        const before = [...selected].join(',');
        applySelection(sel, table);
        const after = [...selected].join(',');
        if (before === after) return false;
        notifySelect();
        return true;
    };

    // Apply a selection descriptor. `clear` empties; `exclusive` replaces the set;
    // otherwise the write is additive. `toggle` deselects only the sole selection
    // when exclusive, but any member when additive.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const applySelection = (sel, table = schemaSpec.primary) => {
        if (sel.clear || sel.index == null) { selected.clear(); return; }
        const key = selKey(table, sel.index);
        const has = selected.has(key);
        if (sel.exclusive !== false) {
            const sole = has && selected.size === 1;
            selected.clear();
            if (sel.toggle && sole) return; // toggled the sole selection off — leave empty
        } else if (sel.toggle && has) {
            selected.delete(key);
            return;
        }
        selected.add(key);
    };

    // ── The public selection API ──────────────────────────────────────────────
    // Each goes through applySelection, like the edit.select gesture.

    // The first selected index, or null.
    const getSelection = () => { const list = reportedSelection(); return list.length ? list[0] : null; };

    // Every selected index, ascending.
    const getSelectionAll = () => reportedSelection();

    // Change the selection from outside a dispatch and render. Returns whether it moved.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const driveSelection = (sel) => {
        const moved = commitSelectionEdit(sel);
        if (moved) deps.update();
        return moved;
    };

    // Select exactly the given row (or array of rows), replacing the selection.
    // `null`, an out-of-range index or an empty array clears it.
    /** @param {number | number[] | null} index */
    const select = (index) => {
        // Reported indices in, table indices from here on (see reportedRows).
        const rows = reportedRows(schemaSpec.primary);
        const ok = (/** @type {any} */ i) => typeof i === 'number' && i >= 0 && i < rows.length;
        const row = (/** @type {number} */ i) => rowIndexOf(schemaSpec.primary, i);
        if (Array.isArray(index)) {
            const list = index.filter(ok).map(row);
            if (!list.length) return driveSelection({ index: null, clear: true });
            // One commit: `select` fires and the chart renders once.
            const before = [...selected].join(',');
            applySelection({ index: list[0], exclusive: true, toggle: false });
            for (const i of list.slice(1)) applySelection({ index: i, exclusive: false, toggle: false });
            if ([...selected].join(',') === before) return false;
            notifySelect();
            deps.update();
            return true;
        }
        const i = ok(index) ? row(/** @type {number} */ (index)) : null;
        return driveSelection({ index: i, exclusive: true, toggle: false, clear: i == null });
    };

    // Add or remove one row, leaving the rest selected.
    /** @param {number} index */
    const toggleSelection = (index) => {
        const i = typeof index === 'number' ? rowIndexOf(schemaSpec.primary, index) : -1;
        return i < 0 ? false : driveSelection({ index: i, exclusive: false, toggle: true });
    };

    // Select every row of the primary table.
    const selectAll = () => select(reportedRows(schemaSpec.primary).map((_, i) => i));

    // Select rows where `field === value` (or a predicate matches). The first match
    // only, unless `{ all: true }`. No match clears the selection.
    /** @param {any} where @param {any} [value] @param {any} [options] */
    const selectWhere = (where, value, options) => {
        const match = typeof where === 'function'
            ? /** @type {(d: any, i: number) => boolean} */ (where)
            : (/** @type {any} */ d) => d && d[where] === value;
        const rows = reportedRows(schemaSpec.primary);
        if (options && options.all) {
            const hits = rows.map((d, i) => (match(d, i) ? i : -1)).filter((i) => i >= 0);
            return select(hits.length ? hits : null);
        }
        const i = rows.findIndex(match);
        return select(i < 0 ? null : i);
    };

    // Clear the selection entirely.
    const clearSelection = () => driveSelection({ index: null, clear: true });

    return {
        selectionIn, selectionPrimary, selectionList, commitSelectionEdit,
        // `select` for a selection a write from outside (patch) carried through a renumbering.
        notifySelect,
        api: { getSelection, getSelectionAll, select, toggleSelection, selectAll, selectWhere, clearSelection },
    };
}
