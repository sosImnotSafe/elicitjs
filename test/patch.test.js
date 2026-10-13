// @vitest-environment jsdom
// A second writer: el.patch merges rows by key into a chart someone is editing, and
// the 'gesture' event reports each gesture once. The person's side is driven through
// `el.control`, the same dispatch a pointer takes, so these pin the interaction of
// the two writers: undo never reverts a 'keep' write, a removal never lands mid-stroke,
// and the selection follows its rows through a renumbering.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const steps = () => [
    { id: 'a', status: 'todo', x: 10, y: 10 },
    { id: 'b', status: 'todo', x: 40, y: 10 },
    { id: 'c', status: 'todo', x: 70, y: 10 },
];
const depends = () => [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
];

function chart(extra = {}) {
    const changes = [];
    const gestures = [];
    const el = Elicit({
        width: 300, height: 200,
        axes: false,
        schema: {
            structure: 'network',
            tables: {
                steps: {
                    role: 'nodes',
                    fields: {
                        id: { type: 'categorical', key: true, open: true },
                        status: { type: 'categorical', open: true, default: 'todo' },
                        x: { type: 'quantitative', domain: [0, 100] },
                        y: { type: 'quantitative', domain: [0, 100] },
                    },
                },
                depends: { role: 'links', directed: true, fields: { source: { type: 'ref' }, target: { type: 'ref' } } },
            },
        },
        data: { steps: steps(), depends: depends() },
        onChange: (d) => changes.push(d),
        marks: [
            plot.link({ channels: { source: { field: 'source' }, target: { field: 'target' } } }),
            plot.point({ channels: { x: { field: 'x', edit: edit.move({ name: 'pos', channels: ['x', 'y'] }) }, y: { field: 'y' } } }),
        ],
        ...extra,
    });
    el.on('gesture', (e) => gestures.push(e));
    document.body.appendChild(el);
    return { el, changes, gestures };
}

const step = (el, id) => el.getData().steps.find((s) => s.id === id);

describe('el.patch', () => {
    it('updates rows by key and leaves the undo history alone', async () => {
        const { el, changes } = chart();
        await tick();
        el.control('pos', 1).set({ x: 50, y: 50 });
        expect(step(el, 'b').x).toBeCloseTo(50, 6);
        expect(el.canUndo()).toBe(true);

        const r = el.patch({ steps: { update: [{ id: 'b', status: 'done' }, { id: 'a', status: 'doing' }] } });
        expect(r).toMatchObject({ updated: 2, inserted: 0, removed: 0, missing: [], conflicts: [] });
        expect(step(el, 'b')).toMatchObject({ status: 'done', x: expect.closeTo(50, 6) });
        expect(changes.length).toBe(2); // the gesture's commit, then the patch
        expect(el.canUndo()).toBe(true);
    });

    it("'keep': undoing the person's gesture does not revert the write", async () => {
        const { el } = chart();
        await tick();
        el.control('pos', 1).set({ x: 50, y: 50 });
        el.patch({ steps: { update: [{ id: 'b', status: 'done' }] } });
        el.undo();
        expect(step(el, 'b')).toMatchObject({ x: 40, status: 'done' });
        el.redo();
        expect(step(el, 'b')).toMatchObject({ x: expect.closeTo(50, 6), status: 'done' });
    });

    it("'record': the write is an undo step of its own", async () => {
        const { el } = chart();
        await tick();
        el.patch({ steps: { update: [{ id: 'b', status: 'done' }] } }, { history: 'record' });
        expect(el.canUndo()).toBe(true);
        el.undo();
        expect(step(el, 'b').status).toBe('todo');
    });

    it('inserts, reports a conflicting insert and a missing update', async () => {
        const { el } = chart();
        await tick();
        const r = el.patch({
            steps: { insert: [{ id: 'd', status: 'todo', x: 90, y: 90 }, { id: 'a', status: 'x', x: 0, y: 0 }], update: [{ id: 'zz', status: 'done' }] },
            depends: { insert: [{ source: 'c', target: 'd' }] },
        });
        expect(r).toMatchObject({ inserted: 2, updated: 0, removed: 0 });
        expect(r.conflicts).toEqual([{ table: 'steps', key: ['a'] }]);
        expect(r.missing).toEqual([{ table: 'steps', key: ['zz'] }]);
        expect(el.getData().steps.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(el.getData().depends).toContainEqual({ source: 'c', target: 'd' });
    });

    it('removing a node takes its links with it; a link is addressed by its ends', async () => {
        const { el } = chart();
        await tick();
        const r = el.patch({ steps: { remove: ['b'] } });
        expect(r.removed).toBe(3); // b, a→b and b→c
        expect(el.getData().depends).toEqual([]);

        const { el: el2 } = chart();
        await tick();
        el2.patch({ depends: { remove: [{ source: 'a', target: 'b' }] } });
        expect(el2.getData().depends).toEqual([{ source: 'b', target: 'c' }]);
    });

    it('the selection follows its row through a renumbering', async () => {
        const { el } = chart();
        await tick();
        el.select(2); // c
        el.patch({ steps: { remove: ['a'] } });
        expect(el.getSelection()).toBe(1);
        expect(el.getData().steps[1].id).toBe('c');
    });

    it('a removal waits for the stroke in flight; a field write does not', async () => {
        const { el, gestures } = chart();
        await tick();
        const h = el.control('pos', 2);
        h.begin();
        h.set({ x: 80, y: 30 });
        // A field write lands at once, and the stroke keeps it.
        el.patch({ steps: { update: [{ id: 'c', status: 'doing' }] } });
        expect(step(el, 'c').status).toBe('doing');
        // A removal would renumber the row the stroke holds: deferred.
        expect(el.patch({ steps: { remove: ['a'] } })).toEqual({ deferred: true });
        expect(el.getData().steps.length).toBe(3);
        h.set({ x: 85, y: 35 });
        h.end();
        // The stroke wrote the row it held (c), then the removal landed.
        expect(el.getData().steps.map((s) => s.id)).toEqual(['b', 'c']);
        expect(step(el, 'c')).toMatchObject({ status: 'doing', x: expect.closeTo(85, 6), y: expect.closeTo(35, 6) });
        expect(gestures.length).toBe(1);
    });

    it('a lock binds gestures, not the second writer', async () => {
        const { el } = chart({ lock: (d) => d.status === 'done' });
        await tick();
        el.patch({ steps: { update: [{ id: 'b', status: 'done' }] } });
        el.control('pos', 1).set({ x: 90, y: 90 });
        expect(step(el, 'b').x).toBe(40); // frozen for the person
        el.patch({ steps: { update: [{ id: 'b', x: 45 }] } });
        expect(step(el, 'b').x).toBe(45); // not for the writer
    });

    it('names a table it does not know, and a history it does not take', async () => {
        const { el } = chart();
        await tick();
        expect(() => el.patch({ nope: { update: [] } })).toThrow(/no table named "nope"/);
        expect(() => el.patch({}, { history: 'never' })).toThrow(/"keep" or "record"/);
    });
});

describe("the 'gesture' event", () => {
    it('fires once per drag, with the edit and the dataset before and after', async () => {
        const { el, changes, gestures } = chart();
        await tick();
        const h = el.control('pos', 0);
        h.begin();
        h.set({ x: 20, y: 20 });
        h.set({ x: 30, y: 25 });
        h.set({ x: 35, y: 30 });
        h.end();
        expect(changes.length).toBe(3);
        expect(gestures.length).toBe(1);
        const [g] = gestures;
        expect(g.edits).toEqual([{ type: 'move', name: 'pos', table: 'steps' }]);
        expect(g.before.steps[0]).toMatchObject({ x: 10, y: 10 });
        expect(g.after.steps[0]).toMatchObject({ x: expect.closeTo(35, 6), y: expect.closeTo(30, 6) });
    });

    it("a write that lands mid-stroke is in 'before', so the diff is the person's alone", async () => {
        const { el, gestures } = chart();
        await tick();
        const h = el.control('pos', 0);
        h.begin();
        h.set({ x: 20, y: 20 });
        el.patch({ steps: { update: [{ id: 'b', status: 'done' }] } });
        h.end();
        const [g] = gestures;
        expect(g.before.steps[1].status).toBe('done');
        expect(g.after.steps[1].status).toBe('done');
    });

    it('does not fire for undo, redo, setData or a patch', async () => {
        const { el, gestures } = chart();
        await tick();
        el.control('pos', 0).set({ x: 20, y: 20 });
        expect(gestures.length).toBe(1);
        el.undo();
        el.redo();
        el.patch({ steps: { update: [{ id: 'a', status: 'done' }] } });
        el.setData({ steps: steps(), depends: depends() });
        expect(gestures.length).toBe(1);
    });
});
