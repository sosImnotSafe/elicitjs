// @ts-check
import { resolveLock, resolveContext, lockConstraint } from '../lock.js';
import { isBareForm, fieldsOf } from '../schema.js';
import { treeProblems } from '../hierarchy.js';
import { applyConstraint } from '../../constraints/define.js';
import { constraintLabel, describe } from '../guards.js';
import { warn } from '../dev.js';

/**
 * The dataset's accessors: which table a feature draws and an edit writes,
 * which rows are context or locked, what the chart reports, each table's
 * constraints, and `checkRows`, the invariants every write runs. Rows are read
 * from `state.tables` at call time.
 *
 * @param {import('../dataset.js').DataState} state
 * @param {{ spec: import('../dataset.js').DatasetSpec, schemaSpec: import('../../types').SchemaSpec }} deps
 */
export function createTables(state, deps) {
    const { spec, schemaSpec } = deps;

    // The one table a feature draws.
    /** @param {any} feature @returns {any[]} */
    const tableOf = (feature) => state.tables[feature.table] || [];
    // The table an edit writes: its `table` role, else its mark's table. The one
    // resolver, so computeEdit and runEdit can't disagree.
    /** @param {any} feature @param {import('../../types').Edit} edit @returns {string} */
    const targetTableOf = (feature, edit) =>
        (edit && edit.table && schemaSpec.byRole[edit.table]) || feature.table;
    // The primary table's rows.
    const primaryRows = () => state.tables[schemaSpec.primary];

    // Context rows (spec.context): drawn and locked, left out of what the chart
    // reports. Decided once over the seed and held by row identity, so an answer
    // dragged into the context region is never swallowed.
    const seedContext = () => {
        state.contextRows = {};
        let seen = 0;
        let matched = 0;
        for (const name of Object.keys(state.tables)) {
            const pred = resolveContext(spec.context, name);
            if (!pred) continue;
            /** @type {WeakSet<object>} */
            const set = new WeakSet();
            state.tables[name].forEach((d, i) => {
                seen++;
                if (d && typeof d === 'object' && pred(d, i)) { set.add(d); matched++; }
            });
            state.contextRows[name] = set;
        }
        if (seen && !matched) {
            warn(
                'spec:context:none',
                `spec.context matched none of the ${seen} seeded rows, so nothing is drawn as ` +
                `context. It is asked once, of the rows in \`data\` (and kept by setData).`
            );
        }
    };
    /** @param {string} name @param {any} d @returns {boolean} */
    const isContextRow = (name, d) =>
        !!(state.contextRows[name] && d && typeof d === 'object' && state.contextRows[name].has(d));
    // A table's rows minus context rows. The index-addressed API uses these
    // indices, so `getData()[i]` and `select(i)` name the same row.
    /** @param {string} name @returns {any[]} */
    const reportedRows = (name) => {
        const rows = state.tables[name] || [];
        return state.contextRows[name] ? rows.filter((d) => !isContextRow(name, d)) : rows;
    };
    // A reported index -> the row's index in the table, or -1.
    /** @param {string} name @param {number} i @returns {number} */
    const rowIndexOf = (name, i) => {
        if (!state.contextRows[name]) return i;
        const rows = state.tables[name] || [];
        let k = -1;
        for (let j = 0; j < rows.length; j++) {
            if (isContextRow(name, rows[j])) continue;
            if (++k === i) return j;
        }
        return -1;
    };
    // A table index -> its reported index, or null for a context row.
    /** @param {string} name @param {number} j @returns {number | null} */
    const reportedIndexOf = (name, j) => {
        if (!state.contextRows[name]) return j;
        const rows = state.tables[name] || [];
        if (isContextRow(name, rows[j])) return null;
        let k = 0;
        for (let m = 0; m < j && m < rows.length; m++) if (!isContextRow(name, rows[m])) k++;
        return k;
    };
    // The reported dataset for getData/onChange: a bare array for a single-table
    // chart, else keyed by table.
    const shapeData = () => {
        if (isBareForm(schemaSpec)) return reportedRows(schemaSpec.primary);
        /** @type {Record<string, any[]>} */
        const out = {};
        for (const name of Object.keys(state.tables)) out[name] = reportedRows(name);
        return out;
    };

    // Locked rows (spec.lock, see core/lock.js), resolved per table and memoized.
    // Seed counts are read live because setData re-seeds.
    /** @type {Record<string, number>} */
    let seedCounts = {};
    // Count the rows each table was seeded with (at Elicit() and on setData).
    const recountSeed = () => {
        seedCounts = {};
        for (const name of Object.keys(state.tables)) seedCounts[name] = state.tables[name].length;
    };
    /** @type {Record<string, ((d: any, i: number) => boolean) | null>} */
    const lockPredicates = {};
    /** @type {Record<string, import('../../types').Constraint | null>} */
    const lockConstraints = {};
    /** @param {string} name @returns {((d: any, i: number) => boolean) | null} */
    const isLockedIn = (name) => {
        if (!(name in lockPredicates)) {
            // Context rows are locked too. `contextRows` is read live; setData and undo rebuild it.
            const lock = resolveLock(spec.lock, () => seedCounts[name] || 0, name);
            lockPredicates[name] = !(name in state.contextRows) ? lock
                : lock ? (d, i) => isContextRow(name, d) || lock(d, i)
                : (d) => isContextRow(name, d);
        }
        return lockPredicates[name];
    };
    /** @param {string} name @returns {import('../../types').Constraint | null} */
    const lockRowsIn = (name) => {
        if (!(name in lockConstraints)) {
            const pred = isLockedIn(name);
            lockConstraints[name] = pred ? lockConstraint(pred) : null;
        }
        return lockConstraints[name];
    };

    // `spec.constraints`, bucketed by table (deduped by identity). A constraint
    // applies to the primary table unless `constraint.table` names a role or table.
    /** @type {Record<string, import('../../types').Constraint[]>} */
    const constraintsByTable = {};
    /** @param {import('../../types').Constraint} c @param {string} table */
    const promoteConstraint = (c, table) => {
        const list = constraintsByTable[table] || (constraintsByTable[table] = []);
        if (!list.includes(c)) list.push(c);
    };
    for (const c of spec.constraints || []) {
        const named = /** @type {any} */ (c).table;
        promoteConstraint(c, (named && (schemaSpec.byRole[named] || (schemaSpec.tables[named] && named)))
            || schemaSpec.primary);
    }
    /** @param {string} table @returns {import('../../types').Constraint[]} */
    const constraintsIn = (table) => constraintsByTable[table] || [];

    // A table's invariants over proposed rows: its constraints, then `extra` (an
    // edit's `constrain`), then the lock, last, so no repair can write a read-only
    // row. A nesting proposal must also keep the tree; refused here, not repaired
    // after commit, so trial commits never offer such a drop. Edits and
    // `Dataset.set` both go through it.
    /**
     * @param {string} table
     * @param {any[]} rows the proposed rows
     * @param {{ activeIndex?: number | null, field?: string, scales?: any, markChannels?: any }} [context]
     *   the touched row and column; an edit also passes its scales and channels,
     *   which give a constraint's `domain` (else the schema's)
     * @param {import('../../types').Constraint[]} [extra]
     * @returns {any[] | null} the repaired rows, or null if rejected
     */
    const checkRows = (table, rows, context = {}, extra = []) => {
        const lockRows = lockRowsIn(table);
        const invariants = [...constraintsIn(table), ...extra, ...(lockRows ? [lockRows] : [])];
        const cctx = {
            activeIndex: context.activeIndex ?? null,
            scales: context.scales, markChannels: context.markChannels,
            // The column being written, for a constraint with no `field`.
            field: context.field,
            tables: state.tables, table,
            schema: fieldsOf(schemaSpec, table),
            locked: isLockedIn(table),
        };
        let out = rows;
        const before = state.tables[table] || [];
        for (const constraint of invariants) {
            const r = applyConstraint(constraint, out, before, cctx);
            if (r === false) return null;
            if (r === true || r === undefined) continue;
            // Anything but an array would become the dataset, so warn and ignore it.
            // Only hand-written constraints can get here; defineConstraint normalizes.
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
        if (table === schemaSpec.byRole.nesting
            && treeProblems(schemaSpec, { ...state.tables, [table]: out }).length) return null;
        return out;
    };

    return {
        tableOf, targetTableOf, primaryRows,
        seedContext, isContextRow, reportedRows, rowIndexOf, reportedIndexOf, shapeData,
        recountSeed, isLockedIn, lockRowsIn, constraintsIn, checkRows,
        // A write from outside (patch) that removes seeded rows shrinks the count.
        seedCountOf: (/** @type {string} */ name) => seedCounts[name] || 0,
        setSeedCount: (/** @type {string} */ name, /** @type {number} */ n) => { seedCounts[name] = n; },
    };
}
