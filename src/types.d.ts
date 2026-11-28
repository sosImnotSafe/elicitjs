import { ScaleLinear, ScaleBand, ScaleOrdinal } from 'd3';

export type Datum = Record<string, any>;

// How a channel DRAWS a field. Never written as `type` on a channel — that slot
// holds the data type. A scale type is named by `scale` (a string, or the `type`
// of a ScaleSpec). See scaleTypeFor in core/encoding.js for the routing.
// 'frame' is the one CHANNEL-SIDE-ONLY member: it marks a channel as belonging to
// an enclosing composite()'s local coordinate box rather than a global axis (see
// plot/composite.js). The composite builds a real per-datum linear scale for it
// (createFrameScale), so no RESOLVED scale ever carries type 'frame' and nothing
// downstream branches on it. `ChannelSpec.frame` is the short spelling.
export type ScaleType =
  | 'linear' | 'log' | 'symlog' | 'pow' | 'sqrt' | 'time'
  | 'band' | 'point' | 'ordinal' | 'sequential' | 'diverging'
  | 'frame';

// A field's MEASUREMENT type in the dataset schema (what the data means), as
// opposed to a ScaleType (how a channel draws it). scaleTypeFor translates one to
// the other per channel. `quantitative`/`temporal` are continuous;
// `categorical`/`ordinal` are discrete (ordinal's domain order is significant).
// `ref` is a REFERENCE: the value names a row of another table by its key. It is a
// statement about what the data means (this column identifies something elsewhere),
// which is why it lives here beside the other measures rather than in a join block.
// It behaves as a category everywhere a scale is concerned — a key IS a category —
// but its DOMAIN is derived from the column it points at, so the two can't drift.
export type MeasureType = 'quantitative' | 'categorical' | 'ordinal' | 'temporal' | 'ref';

// A scale's own configuration — everything about HOW a field is drawn that isn't
// the data's business. The domain is deliberately absent: it belongs to the data,
// and is declared once on the schema (see FieldSchema.domain).
export interface ScaleSpec {
  type?: ScaleType;
  range?: any[];
  // A named colour scheme (colour channels only), resolved to a `range` when the
  // channel names none: a categorical palette ('tableau10', 'category10', 'set2',
  // …) for a discrete field, or a diverging/sequential ramp ('RdBu', 'blues',
  // 'viridis', …). An explicit `range` still wins. See schemeRange in core/encoding.js.
  scheme?: string;
  // Flip the resolved range (after `range` / `scheme`). Useful for diverging
  // ordinal colour when the domain order is the opposite of the scheme's native
  // direction — e.g. D→R wants blue→red, which is `scheme: "RdBu", reverse: true`.
  reverse?: boolean;
  padding?: number;    // band / point
  nice?: boolean;      // continuous
  clamp?: boolean;     // continuous
  base?: number;       // log
  constant?: number;   // symlog — the width of the linear region around zero
  exponent?: number;   // pow
  // diverging — the DATA value the ramp's midpoint sits on (the neutral colour).
  // Defaults to 0 when the domain straddles it, else the domain's midpoint. Each
  // side is scaled independently, so the pivot keeps its colour on a lopsided
  // domain rather than drifting to the middle of the range.
  pivot?: number;
}

// One field of the elicited-dataset schema. Declares the field's measurement
// type and (optionally) its domain — [min,max] for quantitative/temporal, the
// ordered value list for categorical/ordinal — and a `default` used to populate
// the field when a datum is created (absent -> null, i.e. present but unset).
export interface FieldSchema {
  type: MeasureType;
  domain?: any[];
  default?: any;
  // Is the domain a CEILING or a STARTING SET? Closed (the default) means the
  // declared categories are the whole vocabulary: an edit that mints one — see
  // edit.stack.cut — assigns the next unused value and refuses once they run out,
  // and validateDataset reports a seed value outside the domain. `open: true`
  // means the domain grows: the cut appends a new category to the schema, and the
  // out-of-domain check is skipped because an unseen value is expected.
  //
  // Only meaningful for a discrete field. A field with no `domain` at all is open
  // by nature — resolveScales infers its domain from the data values.
  open?: boolean;
  // This field is the table's IDENTITY: the column a `ref` in another table points
  // at, and the one a gesture mints a new value into when it creates a row. At most
  // one per table. Pair with `open: true` so a gesture can mint an identity without
  // demanding the keyboard (see nextCategory in edit/shared.js).
  key?: boolean;
  // For a `ref` field: which column it points at.
  //   omitted        the NODES-role table's `key: true` field — the case essentially
  //                  every time, and why a link's source/target need no `to` at all
  //   'id'           that column of the nodes table, named explicitly
  //   'links.id'     a column of another table (table.column), for a cross-reference
  // A ref's domain is DERIVED from the target column, so it is never declared here.
  to?: string;
}

// Which rows of the dataset are READ-ONLY (see DatasetSpec.lock, core/lock.js).
// 'seed' (or true) fixes the rows the dataset was seeded with — they are given, not
// elicited — and leaves every row an edit adds free. A predicate locks rows by
// what they are (`d => d.year <= 1990`).
// `table` is the name of the table the row belongs to — so one predicate can lock
// a network's seeded nodes while leaving its links free.
export type LockSpec =
  | 'seed'
  | boolean
  | ((datum: Datum, index: number, table?: string) => boolean);

// Which rows are CONTEXT (see DatasetSpec.context, core/lock.js): reference rows of
// the elicited table — observed history behind a forecast — that are drawn, read-
// only, and left out of everything the dataset reports. `true` makes every seeded
// row context; a predicate picks seeded rows. Asked ONCE, of the seed: a row an
// edit adds or moves never becomes context.
export type ContextSpec =
  | boolean
  | ((datum: Datum, index: number, table?: string) => boolean);

// One TABLE's schema: what data is being elicited, keyed by field name. It is the
// source of truth for a field's scale (ranked above data inference), so a chart
// resolves its scales — and can mint new data — with zero starter data.
export type Schema = Record<string, FieldSchema>;

// ── Structure: which tables the dataset has ─────────────────────────────────
// A dataset's STRUCTURE says what shape it is —
// a set of named tables, each filling a ROLE the structure defines.
//
//   'table'   (the default)  one table, role `data`
//   'network'                roles `nodes` and `links`
//   'hierarchy'              roles `nodes` and `nesting` (one row = "child is inside
//                            parent", two `ref` columns), plus an optional `links`
//
// The NAME is the data key; the ROLE is what the structure means by it. Marks and
// edits resolve a table by ROLE, which is what lets an argument map call its tables
// `claims` / `supports` with no `table:` written anywhere. See core/schema.js for
// the role table (STRUCTURES) — adding a structure is a row there and nowhere else.
export type Structure = 'table' | 'network' | 'hierarchy';

// A table in the author's LONG form. `role` is only needed when the table's NAME
// differs from the role it fills; a bare `Schema` in its place is the short form.
export interface TableSpec {
  role?: string;
  fields: Schema;
  // Links only: does an ordered pair of this table's `ref` columns mean a
  // DIRECTION? See TableSchema.directed — the flag is tri-state on purpose.
  directed?: boolean;
  // Links only: may one pair be joined by more than one link? See TableSchema.multi.
  multi?: boolean;
  // Links only: may a link join a node to itself? See TableSchema.selfLoops.
  selfLoops?: boolean;
}

// `DatasetSpec.schema` as an author may write it. A bare field map is a single-table
// schema (the form every pre-structure spec uses, valid forever); the long form
// names its tables. normalizeSchema brings both to SchemaSpec.
export type SchemaInput =
  | Schema
  | { structure: Structure; tables: Record<string, Schema | TableSpec> };

// How a link is drawn between its two endpoints. A STYLE choice resolved per row,
// not a manipulable geometry: there are no anchor points to drag.
//   line                            straight
//   step | stepBefore | stepAfter   elbow off the chord between two POINTS
//   orthogonal                      elbow docked to each node's BOX (the box the
//                                   mark drawing the nodes declares, `Mark.nodeBox`),
//                                   leaving it perpendicular to an edge and detouring
//                                   around other nodes
//   arc                             quadratic bow, signed by `curvature`
//   bezier | smooth                 cubic with axis-aligned tangents
//   loop                            implicit when source === target
export type LinkCurve =
  | 'line' | 'step' | 'stepBefore' | 'stepAfter' | 'orthogonal'
  | 'arc' | 'bezier' | 'smooth' | 'loop';

// Which edge of a node a link end meets. `auto` (or null) SLIDES: the end docks where
// the line toward the other node leaves the box. A side PINS it at that edge's
// midpoint. Stated on the mark, derived with `{ fn }`, or a column when the link's
// `sourceSide` / `targetSide` channel names a field — the column a connect or
// rewire gesture then writes.
export type LinkSide = 'auto' | 'top' | 'right' | 'bottom' | 'left';

// The sides of a node a link may use, as a `ports` channel value. `true` is all
// four, both ways; a side or a list of sides is those sides, both ways; `{ out,
// in }` splits them on a directed links table — the sides a link may LEAVE from
// and ENTER by. `false` (or an empty list) is no ports on that row.
export type PortSides =
  | boolean
  | 'top' | 'right' | 'bottom' | 'left'
  | Array<'top' | 'right' | 'bottom' | 'left'>
  | { out?: Array<'top' | 'right' | 'bottom' | 'left'>; in?: Array<'top' | 'right' | 'bottom' | 'left'> };

// A node's rectangle in scene pixels: its centre and half-extents.
export interface NodeBox {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  // An ellipse of radii `hw`/`hh` (a dot, an ellipse, a glyph's head) rather than a
  // rectangle: a straight or curved link with an unpinned end meets it on the curve.
  // Sides and ports still sit at the four edge midpoints, which an ellipse shares
  // with its bounding box.
  round?: boolean;
  // Turned about its centre, in math degrees (counter-clockwise, like a node's
  // `angle`). `hw`/`hh` are the half-extents before turning, and a side names the
  // node's own edge, so ports and links turn with it. Layout and orthogonal routes
  // use the upright box around it.
  angle?: number;
}

// The node table's box rule, as the engine hands it to `link` and the network edits:
// the box of one node ROW, from the mark that draws the nodes (`Mark.nodeBox`).
export type NodeBoxRule = (row: Datum, index: number, rows: Datum[]) => NodeBox | null;

// Which ends of a link carry an arrowhead. `auto` means "the target end iff the
// links table declares `directed: true`", which is how a schema-level statement
// about the DATA reaches the drawing without the mark hard-coding a default.
export type LinkArrow = 'none' | 'target' | 'source' | 'both' | 'auto';

// One table, canonical: what every internal reader sees after normalizeSchema.
export interface TableSchema {
  // The table's name — its key in `data`, in `getData()`, and in a mark's `table`.
  name: string;
  role: string;
  fields: Schema;
  // The `key: true` field, or null. What a `ref` points at by default.
  key: string | null;
  // Links only. Does an ordered pair of this table's `ref` columns mean a
  // DIRECTION? TRI-STATE, and callers must keep all three apart:
  //   true       source→target is a direction — arrows by default, reciprocal
  //              pairs bow apart, `edit.network.reverse` is meaningful.
  //   false      the pair is unordered — `connect` refuses B→A once A→B exists.
  //   undefined  the schema has no opinion; every chart written before this flag
  //              existed, and the reason `arrow: 'auto'` resolves to none.
  // Read it through `isDirected(spec)` rather than reaching for the table.
  directed?: boolean;
  // Links only. May a GESTURE join one pair with a second link (a multigraph)?
  // Unstated means no: `connect` and `rewire` refuse a pair that already has a link
  // (and, with `directed: false`, its mirror). Rows that already hold a parallel
  // pair still draw, fanned apart; only an explicit `false` reports them.
  multi?: boolean;
  // Links only. May a GESTURE join a node to itself? Unstated means no, since a
  // drop back on the node you dragged from is usually a slip. A loop already in the
  // data still draws; only an explicit `false` reports it. Read both through
  // `linkRulesOf(spec)`.
  selfLoops?: boolean;
}

// The canonical schema. `core/schema.js` is the only module that builds one, and
// every other reader takes it — so nothing re-sniffs how the author spelled it.
export interface SchemaSpec {
  structure: Structure;
  tables: Record<string, TableSchema>;
  // role -> table NAME. The indirection that makes table names renameable.
  byRole: Record<string, string>;
  // The primary table's NAME: `data` for a table, the `nodes` table for a network.
  // A bare-array `data` seeds this one, and a mark with no `table` draws it.
  primary: string;
}

// What a scale can DO, sniffed from the scale object itself and stamped once at
// creation/adoption. Marks, edits and axes branch on `kind` — never on `type`,
// which is only a label (an adopted d3 scale has no type at all, and a `log`
// scale behaves exactly like a `linear` one everywhere it matters).
//   band       -> occupies an interval per category (bandwidth)
//   point      -> a tick per category (no width)
//   continuous -> has invert(): linear, log, pow, sqrt, time, symlog
//   discrete   -> maps a value to a discrete output (ordinal, sequential ramp)
export type ScaleKind = 'band' | 'point' | 'continuous' | 'discrete';

export interface CustomScaleProperties {
  // A label, for axis tick formatting and debugging. NOT control flow.
  type?: ScaleType;
  kind: ScaleKind;
  // The domain holds Dates, so encode() coerces values before positioning.
  temporal: boolean;
  domainConfig?: any[];
  invertible: boolean;
  // A colour RAMP: a continuous domain interpolated to a paint (sequential /
  // diverging). Not invertible — a colour can't be driven backwards — but its domain
  // is an interval, which is what a legend reads to draw a gradient with ticks.
  ramp?: boolean;
  encode: (value: any, fallback?: any) => any;
  invertValue: (pixel: number) => any;
  domain?: () => any[];
  // The schema fields unioned onto this axis, in first-seen order (stamped by
  // resolveScales). Metadata for an editable axis: a domain edit writes each of
  // these fields' schema domains. Not a domain/range on the channel.
  fields?: string[];
  // The same list QUALIFIED BY TABLE. A field name is not unique across tables —
  // one `fill` scale can span `nodes.kind` and `links.kind` — so a domain edit
  // needs the pair to know whose schema and whose rows to write.
  fieldRefs?: { table: string; field: string }[];
}

export type Scale = (
  | ScaleLinear<any, any>
  | ScaleBand<any>
  | ScaleOrdinal<any, any>
  | ((v: any) => any)
) & CustomScaleProperties;

export interface ScaleMap {
  [channelName: string]: Scale;
}

/** Chart geographic projection (see core/projection.js createProjection). */
export interface ProjectionContext {
  apply(p: [number, number]): [number, number] | null;
  invert(p: [number, number]): [number, number] | null;
  path(object?: any): string | null;
  invertible: boolean;
  raw: any;
}

export interface ProjectionSpec {
  type?: string | ((...args: any[]) => any);
  domain?: any;
  rotate?: [number, number] | [number, number, number];
  parallels?: [number, number];
  precision?: number;
  clipAngle?: number;
  inset?: number;
  insetTop?: number;
  insetRight?: number;
  insetBottom?: number;
  insetLeft?: number;
  [key: string]: any;
}

export interface EditContext {
  data: Datum[];
  datum?: Datum;
  index?: number | null;
  pointer: { x: number; y: number };
  node: any | null;
  event: any;
  // A wheel gesture's travel in pixels, normalized by the renderer (edit.axis.zoom reads deltaY).
  deltaX?: number;
  deltaY?: number;
  // A gesture-supplied payload value, for edits whose input isn't a pixel: the
  // text mark's content-edit `commit` carries the typed string here. Undefined
  // for pointer-only gestures.
  value?: any;
  // The edit's own target channels, resolved to { name, field, scale }.
  channels: ResolvedChannel[];
  scales: ScaleMap;
  // The whole mark's channel map (name -> ChannelSpec), for edits that need to
  // look up a sibling channel's field. Distinct from `channels` above.
  markChannels: Record<string, any>;
  // Plot pixel dimensions, for a gesture measured against the whole plane (e.g.
  // rotate about the plot centre by default; rotate({ pivot: 'mark' }) uses the
  // mark centre instead — the angular sibling of resize's mark-centre radius).
  width?: number;
  height?: number;
  // The chart's margins, so a grow-mode axis edit can turn an inner axis length
  // back into the chart's outer width/height. Rarely needed by other edits.
  margins?: { top: number; right: number; bottom: number; left: number };
  // The dataset schema, so a `create` edit can mint a datum carrying every
  // declared field (its default or null), not only the positional ones.
  schema?: Schema;
  xKey: string;
  yKey: string;
  // The feature's series (grouping) field and current scene nodes, for
  // proximity-aware edits (anchor / newSeries) and when.near|far.
  seriesKey?: string | null;
  marks?: FeatureNode[];
  // The line's connection MODE, so a create-as-you-drag (draw) edit can pick its
  // behaviour: 'sequence' -> freehand append; otherwise -> you-draw-it column
  // upsert. (WHICH column sorts the points is the `order` CHANNEL, not this.)
  connect?: 'domain' | 'sequence' | null;
  // The feature's transient per-gesture driver session: the zone/handle lock a
  // lifecycle driver classified at dragstart (brush/brushRect), a draw's mode +
  // locked series, an axis drag's handle snapshot. Read (and, for pointer
  // tracking, mutated) across a single press-drag. Set by the edit's driver.
  session?: Session | null;
  // Chart geographic projection when `ChartSpec.projection` is set. Geo edits
  // invert the pointer through the same object geo marks use for apply/path.
  projection?: ProjectionContext | null;
  // The primary selected datum index (transient pipeline state — ui.selection),
  // or null. So an edit's apply/when can read or target the selection: edit.select
  // reads whether the touched row is already selected to decide toggle-off.
  selection?: number | null;
  // The edit being dispatched, so a `when` predicate can arbitrate against the
  // edit's own knobs (when.near reads its `threshold`). Purely informational.
  edit?: Edit;
  // Is this a PREVIEW (the ghost drawn each drag tick) rather than a commit? An
  // edit may return a half-made row for a preview that it must never commit —
  // `edit.network.connect` proposes a link toward the pointer before a target is
  // under it, and returns undefined for the same gesture on dragend.
  preview?: boolean;
  // The node table's box rule (see `Mark.nodeBox`), for an edit that tests the
  // pointer against a node's edges (connect, rewire). Null when no mark declares one.
  nodeBox?: NodeBoxRule | null;
  // Which rows of a hierarchy's node table may HOLD others — the node marks'
  // `contains` channel, read per row. Null when no mark states one.
  contains?: ((row: Datum, index: number, rows: Datum[]) => boolean) | null;
  // For an edit that writes a table its own mark doesn't draw (`connect` writes a
  // link row from a node's ports): the channel map of the mark that DRAWS that
  // table. Its channels name the columns the edit writes, so a column is named in
  // exactly one place — the link's channel map.
  targetChannels?: Record<string, any> | null;
  // The table this edit WRITES (its name), the whole dataset keyed by table name,
  // and the canonical schema — for an edit that looks across tables (a rewire
  // resolves a node id while writing a link row). Read-only by convention.
  table?: string;
  tables?: Record<string, Datum[]>;
  // The field schema of the table this edit writes AS DECLARED at Elicit(), before
  // any domain edit reshaped it — the ceiling a zoom may widen back out to.
  seedSchema?: Schema;
  schemaSpec?: SchemaSpec;
  // Which rows of the table this edit writes are read-only under `spec.lock`
  // (null when none are), so an edit choosing a row to extend can skip one the
  // lock would revert.
  locked?: ((row: Datum, i: number) => boolean) | null;
}

export interface ResolvedChannel {
  name: string;
  field: string;
  scale?: Scale | null;
}

// The pure-data context a constraint reducer receives (defineConstraint). By the
// time it runs, gestures are already inverted to data space, so it sees only data.
export interface ConstraintContext {
  data: Datum[];
  oldData: Datum[];
  activeIndex: number | null;
  active?: Datum;
  // The column the rule is about: the constraint's own `field`, else the one the
  // dispatching edit writes. Undefined only when neither exists.
  field: string | undefined;
  // The same, as a list — a rule about several columns (ordering, unique) reads this.
  fields: string[];
  value?: any;
  domain?: number[];
  // The declared data range of EVERY field in `fields`, keyed by field — `domain`
  // is the entry for `field`. A rule over several columns (clamp over a pushed
  // neighbour) reads the bound of the column it is repairing.
  domains?: Record<string, number[] | undefined>;
  // Which table these rows are, and the rest of the dataset, for a rule that spans
  // tables. Pure data, like everything else here.
  table?: string;
  tables?: Record<string, Datum[]>;
  // The table's field schema (type, domain, open, …), so a rule can honour a
  // column's measure: snap keeps a temporal value a Date, a coercing rule knows
  // a quantitative column takes a number.
  schema?: Record<string, FieldSchema>;
  // The canonical dataset schema (structure, roles, tables), for cross-table rules like `contain`.
  schemaSpec?: SchemaSpec;
  // Which rows are read-only under `spec.lock` (null when none are). A rule that
  // pushes neighbours pivots around a locked row rather than writing it only to
  // have the lock revert it.
  locked?: ((row: Datum, i: number) => boolean) | null;
}

// What a constraint's `apply` may return: a value for the active datum's field, a
// partial datum to merge, a whole replacement dataset, a rejection, or "unchanged".
export type ConstraintResult = number | Record<string, any> | Datum[] | boolean | undefined;

// A constraint DESCRIPTOR — the parallel of `Edit`, built by `makeConstraint` /
// `defineConstraint` (`constraints.custom`). See constraints/define.js.
export interface ConstraintSpec {
  // Which keyword built it ('clamp', 'maintainSum', 'custom', …): the one identity
  // key every feature kind carries. edit/guide.js draws a rule's bounds by it.
  type: string;
  // The column(s) the rule is ABOUT. Omitted: the column the dispatching edit writes.
  field?: string | string[];
  // The rule's own configuration, kept so a guide can read it.
  options?: Record<string, any>;
  // The table the rule is about, by role or name. Default: the primary table.
  table?: string;
  // A constraint's own boundary DRAWER (distinct from an Edit's boolean `guide`):
  // returns the scene nodes visualizing where it limits interaction.
  guide?: (ctx: any) => any[];
  apply: (ctx: ConstraintContext) => ConstraintResult;
}

// The low-level form: a bare function over the proposal. Still accepted in
// `spec.constraints`; `applyConstraint` runs either shape.
export type ConstraintFn = (newData: Datum[], oldData: Datum[], context: any) => Datum[] | boolean | undefined;

export type Constraint = ConstraintSpec | ConstraintFn;

export interface Edit {
  type: string;
  // Stable handle an external controller addresses this edit by, via
  // `chart.control(name)`. null (default) = not externally addressable; the edit
  // stays purely pointer/keyboard-driven. Naming an edit adds no dispatch path —
  // `chart.control` synthesizes the same events the pointer does (see Chart).
  name: string | null;
  gesture: string;
  channels: string[] | null;
  when: ((ctx: EditContext) => boolean) | null;
  pick: 'direct' | 'nearest' | 'plane' | 'sweep' | 'draw' | 'brush' | 'brushRect' | 'geoBrush'
    | 'probe' | 'axisDrag' | 'slide' | 'pan' | (string & {});
  // null = universal (any mark). Otherwise the mark FAMILY this edit needs, which
  // is also where it lives in the API (the scope shows in the name: edit.line.*,
  // edit.arc.*, edit.waffle.*, edit.geo.*, edit.axis.*). Each scope names a mark
  // capability flag — supportsSeries / supportsWaffle / supportsGeo /
  // isAxis — and the engine dev-warns when the mark it's attached to lacks it,
  // instead of leaving you a silently dead gesture. See SCOPE_CAPABILITY in
  // core/elicit.js.
  // Typed off the engine's capability table, so the union cannot drift from it.
  scope: keyof typeof import('./core/guards.js').SCOPE_CAPABILITY | null;
  // Which TABLE this edit's proposal replaces, named by ROLE. Omitted (all but the
  // graph edits), it writes the table its own mark draws — which is what every edit
  // did before structures, and still is on a single-table chart. `edit.network.connect`
  // sets `'links'`: it is placed on a NODE mark, so its gesture lands on a node row
  // while its proposal is a link row.
  table?: string;
  threshold: number;
  // anchor()/draw(): which line a new point joins.
  into?: 'nearest' | 'new';
  // The author's CSS cursor; null lets the engine read one from the edit (edit/cursor.js).
  cursor?: string | null;
  // Which of the mark's nodes this edit acts on (a boundary handle, a vertex). The
  // cursor heuristic counts the edit only there. Absent = every node.
  grabs?: (node: FeatureNode) => boolean;
  // Edit-scoped constraint SUGAR (runs only on this edit's commit). The canonical
  // home for invariants is the dataset's `constraints` (plural), which hold for
  // every edit; `constrain` (singular) is a guard you want on just this one.
  constrain: Constraint[];
  // An edit self-draws its guide (constraint rules + proximity catchment + travel
  // track). Not to be confused with a Constraint's `guide`, which is a drawer
  // function. See GuideSpec / edit/guide.js.
  //   true                         → bounds + catchment at part defaults
  //   false / null                 → nothing
  //   { bounds, catchment, track, color } → per-part on/off + style
  guide: boolean | GuideSpec | null;
  // Multi-stage gate: active only when it equals the engine's current stage;
  // null = always active. A uniform filter applied to every edit, like `gesture`
  // matching — not a mode branch. Set via a factory option: move({ stage: 1 }).
  stage: number | null;
  // probe-pick only: does a click that settles this edit advance the stage?
  // Default true; `advance: false` commits repeatedly within one stage.
  advance: boolean;
  // What this edit WRITES. Absent (the default) -> the dataset: apply returns a
  // datum (spliced at `index`) or a whole array. 'domain' -> the schema: apply
  // returns { domains: { [field]: any[] }, data?, resize? } and the engine writes
  // each field's schema domain (and optionally replaces the dataset / resizes the
  // chart). 'selection' -> the transient selection (ui.selection): apply returns
  // { __select: { index, exclusive?, toggle? } } and the engine updates which row
  // is selected — no dataset write, no undo entry, no `change` (edit.select). A
  // capability flag, read like the array-vs-datum classification — not an
  // interaction-mode branch. Used by edit.axis.* ('domain') and edit.select.
  target?: 'domain' | 'selection';
  // How this edit changes the dataset's SHAPE. The engine reads it to resolve
  // `activeIndex` — the datum a constraint repairs around — WITHOUT knowing which
  // edit is running, the same way `target` classifies the write destination:
  //   'append' -> a row was minted; the active one is the last.
  //   'delete' -> a row was dropped; no datum is active.
  //   null/absent -> the row at `index` is the active one (the common case).
  // Declare 'append' on a custom minting edit to get create()'s treatment. An edit
  // that both mints and drops (toggle), or appends many rows at once (newSeries,
  // draw), leaves this null: "the touched datum" has no single answer there.
  cardinality?: 'append' | 'appendMany' | 'toggle' | 'delete' | null;
  // Does this edit run a POINTER POSITION back through a channel's scale? Then it
  // needs that scale to invert, and the engine's dead-drag guard reports a channel
  // whose scale cannot. Declared by move/slide/resize/rotate/… and by any custom
  // edit that inverts; a capability, never a list of type names.
  inverts?: boolean | 'domain';
  // Does this edit move a positional domain as a WINDOW over the data (zoom,
  // pan)? Then rows legitimately fall outside the plot rect, and the engine clips
  // the marks to it unless the spec says `clip: false`. A capability, so a
  // custom view edit gets the same treatment.
  viewport?: boolean;
  // Does this edit read a positional SPAN PAIR (x1/x2 or y1/y2)? Then, placed at
  // mark level with no `channels`, collectEdits supplies the mark's own pair.
  spans?: boolean;
  // This edit is completed by TYPING, so a node its feature draws should open the
  // renderer's inline editor on double-click. A declared CAPABILITY, read by the
  // engine's tagging pass into `FeatureNode.editText` — which is why the engine
  // never has to ask whether an edit is an editText, and why a mark never has to
  // sniff its own edit list to decide whether its nodes are typable.
  inline?: boolean;
  // With `inline`: the editor is a textarea and Enter inserts a newline rather
  // than committing. Declared, never inferred from how tall the shape is drawn.
  multiline?: boolean;
  // A creator (create/toggle) stamps its `defaults` here so the dev-only create
  // guards can see which fields the author seeds (e.g. a rect's span endpoints) —
  // introspection only; the value the datum gets is applied inside `apply` via the
  // shared `mintDatum` core. Absent on non-creating edits.
  defaults?: Record<string, any>;
  apply: (ctx: EditContext) => any;
  // The places a drop could land, for an edit whose drag ends ON something (a
  // connect or rewire ends on a port). The engine probes each with a trial commit,
  // constraints included, and shows only the `onHover` handles whose `key` a release
  // would actually accept — so a port nobody can use is never drawn.
  // Null means there is nothing to probe (no ports declared): no drop is ruled out.
  targets?: (ctx: EditContext) => Array<{ x: number; y: number; key: string }> | null;
  // Driver-specific knobs (edgeInset, resize, move, …) PASS THROUGH makeEdit onto
  // the descriptor, where the edit's driver reads them (see edgeInsetOf in
  // edit/pick.js). That passthrough is the one sanctioned way a driver — built-in
  // or registered via registerDriver — carries per-edit options; there is no
  // side-channel or post-hoc attachment. They are typed on the factory options
  // (BrushSpanOptions etc.), not here, to keep the canonical fields strict.
}

// ---------------------------------------------------------------------------
// Edit factory options — what a caller passes to elicit.edit.* factories. Every
// factory takes EditOptions; the ones with extra knobs extend it below. Any
// canonical Edit field may be overridden here (gesture, pick, when, stage, …);
// keys the descriptor doesn't know pass through onto it for a driver to read
// (see the note on Edit.apply).
export interface EditOptions {
  // Stable handle for `chart.control(name)` (see Edit.name).
  name?: string;
  // The raw gesture this edit claims: 'drag' | 'click' | 'dblclick' | 'commit'.
  gesture?: string;
  // Single-channel spelling of `channels` — every factory accepts either; the
  // singular wins when both are given (it also overrides a factory's default
  // `channels`, e.g. toggle's ['x']).
  channel?: string;
  channels?: string[];
  when?: (ctx: EditContext) => boolean;
  pick?: Edit['pick'];
  // Proximity radius in px for nearest-style target resolution — also what
  // when.near/when.far arbitrate with, so the two always agree.
  threshold?: number;
  // Edit-scoped constraint sugar (see Edit.constrain).
  constrain?: Constraint | Constraint[];
  guide?: boolean | GuideSpec;
  stage?: number;
  advance?: boolean;
  cardinality?: 'append' | 'appendMany' | 'toggle' | 'delete' | null;
  inverts?: boolean | 'domain';
  viewport?: boolean;
  // The rest of the descriptor an author may override (see Edit).
  table?: string;
  scope?: Edit['scope'];
  into?: 'nearest' | 'new';
  target?: 'domain' | 'selection';
  inline?: boolean;
  multiline?: boolean;
  // CSS cursor over this edit's marks (or the plot, for a plane pick). Defaults to
  // one read from the edit: a drag along x → 'ew-resize', along y → 'ns-resize',
  // both → 'move'; a click → 'pointer'; a typed edit → 'text'.
  cursor?: string;
  // CLOSED: a factory's own knobs are typed on its options interface (SlideOptions,
  // BrushRectOptions, …), and `edit.custom` alone takes an open bag for a custom
  // driver's knobs. An unknown key here is a typo, which `makeEdit` also reports.
}

export interface CreateOptions extends EditOptions {
  // Seed values for the minted datum's NON-positional fields (group, mag, …), applied
  // over the schema defaults and under the inverted pointer by the shared `mintDatum`
  // core. Also where an EXTENT mark (a rect drawn from x1/x2 or y1/y2 spans) supplies
  // its size, so a new row isn't minted zero-size (warnCreateEmptyExtent flags a miss).
  defaults?: Record<string, any>;
}

export interface ToggleOptions extends CreateOptions {}

export interface RotateOptions extends EditOptions {
  // 'plot' (default) rotates about the plot centre; 'mark' about the hit node.
  pivot?: 'plot' | 'mark';
  // Fold into (-90, 90] for direction-agnostic lines (default); false for dials.
  fold?: boolean;
  // Another angular channel to measure the absolute angular distance from.
  relativeTo?: string;
}

// Options for the TREND-scoped edits (edit.trend.*). Each one inverts the pointer
// through x/y and solves for the line parameter it owns, so the only extra knobs
// are the two x positions that define the frame — the same pair the mark takes,
// and normally inherited from it.
export interface TrendEditOptions extends EditOptions {
  // The pivot: the x whose value is held while the line rotates, and where an
  // intercept drag places the line. Defaults to 0 when 0 is in the x domain.
  anchor?: number;
  // The x a PINNED handle drag measures at (a handle drawn under `grip: 'probe'`).
  // Ignored by an end-mounted grip and when the gesture carries no node at all (a
  // plane/probe pick) — both use the pointer's own x, so the line follows the
  // cursor. Defaults to the x domain's other end.
  probe?: number;
}

export interface MoveOptions extends EditOptions {
  // 'absolute' (default): the pointer's POSITION is the value — stateless, and what
  // a plane/nearest pick requires. 'relative': the value moves by the drag DELTA
  // from where you grabbed, preserving the grab offset, which is what a mark with
  // real AREA needs (pressing a sticker near its corner must not teleport its
  // centre to the pointer). Relative is direct-pick and uses the `move` driver's
  // dragstart snapshot.
  mode?: 'absolute' | 'relative';
}

export interface SlideOptions extends EditOptions {
  // Which pointer coordinate drives the value (default 'x').
  axis?: 'x' | 'y';
  // The direction that RAISES the value: 'left'|'right' for axis:'x',
  // 'up'|'down' for axis:'y' (default 'left'/'up').
  increase?: 'left' | 'right' | 'up' | 'down';
  // Pixel span that traverses the full domain. Defaults to the glyph radius for a
  // channel resolved in a composite's local frame, else 120.
  extent?: number;
  // 'relative' (default): the value moves by the drag DELTA from where you
  // grabbed, so there is no jump. 'absolute': the value is read off the pointer's
  // POSITION on a fixed track centred on the mark — stateless, but correct only
  // when the handle already sits at its value's place on that track (a dot on a
  // rail); otherwise pressing the mark teleports the value. Both are direct-pick.
  mode?: 'absolute' | 'relative';
}

export interface BrushSpanOptions extends EditOptions {
  // Edge-zone radius in px: a grab within this of an endpoint resizes that edge;
  // beyond it, the body translates. Read by the brush/brushRect driver.
  edgeInset?: number;
}

export interface BrushRectOptions extends BrushSpanOptions {
  // Which axes' edges/corners are live for resizing.
  resize?: 'both' | 'x' | 'y' | 'none';
  // Whether a body drag translates the whole rect.
  move?: boolean;
}

export interface AnchorOptions extends EditOptions {
  // Which line a new point joins: the closest within threshold, or a fresh one.
  into?: 'nearest' | 'new';
  // The series (grouping) field; defaults to the mark's own.
  series?: string;
}

export interface NewSeriesOptions extends EditOptions {
  // The independent axis the line runs ALONG, and the axis it carries a value on.
  along?: 'x' | 'y';
  value?: 'x' | 'y';
  // Domain positions to seed anchors at (see core/samples.js resolveSamples):
  // a count, explicit positions, or a time interval; default = the scale's ticks.
  samples?: any;
  series?: string;
}

export interface DrawOptions extends NewSeriesOptions {
  // Freehand pointer-sampling distance in px.
  minDist?: number;
  into?: 'nearest' | 'new';
}

// edit.legend (a category picker) reads the clicked swatch's `node.category`; it
// carries no layout of its own — the `plot.legend()` mark owns geometry.
// Neither picker names a column: a legend is a key for one ENCODING, so the column
// is the one that encoding uses. Kept as a named type for the knobs it inherits.
export interface LegendEditOptions extends EditOptions {}

// edit.select (a selection edit). Selection is transient pipeline state, so these
// knobs govern set semantics, not a data write.
export interface SelectEditOptions extends EditOptions {
  // Selecting a row clears the rest (default true). false makes every click
  // additive. For the usual "hold a modifier to add" behaviour use `multi`.
  exclusive?: boolean;
  // Clicking the already-selected row deselects it (default true). Under an
  // additive click this removes that row from the set; under an exclusive one it
  // only fires when the row is the sole selection. false never deselects.
  toggle?: boolean;
  // Shift- or meta-click adds to the selection, a plain click replaces it
  // (default false). The modifier idiom rather than a mode, so switching it on
  // never changes what an existing gesture does.
  multi?: boolean;
}

// The result an edit with `target: 'domain'` returns from apply(): the schema
// domains to write, plus (for a coupled schema+data edit like category-remove) a
// replacement dataset, and (for grow-the-chart numeric drag) a chart resize hint.
export interface DomainEditResult {
  // field -> new domain, in the table the edit writes (Edit.table, else its own
  // mark's). The common single-table case, and the only shape most edits need.
  domains: Record<string, any[]>;
  // Rows the domain change couples to, for that same table — renaming a category
  // has to relabel the rows carrying it, removing one has to delete them.
  data?: Datum[];
  // The same two, for OTHER tables. One scale can span several: a network chart
  // can put `fill` over `nodes.kind` and `links.kind`, and renaming that category
  // has to write both schemas and both row sets or they drift apart. Keyed by
  // table NAME. Omitted by every single-table edit.
  tables?: Record<string, { domains?: Record<string, any[]>; data?: Datum[] }>;
  resize?: { width?: number; height?: number };
}

// A derived-channel accessor: computed per datum in VISUAL space (its result is
// used as-is, never scaled). `i`/`data` are supplied by per-datum marks and may
// be undefined at constant-resolving call sites.
// What `computeEdit` (core/elicit.js) resolves a gesture to, after `apply` and
// the invariants: replacement rows for the edit's table, a DOMAIN write (the
// schema, plus rows it couples to), or a SELECTION change. One discriminated
// shape, so commit and preview branch on `kind` and never sniff a sentinel key.
export type EditResult =
  | { kind: 'rows'; rows: Datum[] }
  | { kind: 'domain'; result: DomainEditResult }
  | { kind: 'selection'; selection: { index: number | null; exclusive?: boolean; toggle?: boolean; clear?: boolean } };

export type ChannelFn = (d: Datum, i?: number, data?: Datum[]) => any;

// A single channel binding on a mark (Observable Plot's model, declarative).
// One of:
//   { field }              a data field, through the channel's global scale
//   { value }              a VISUAL-space constant — skips the scale entirely
//                          (`fill: 'red'` desugars to this)
//   { datum }              a DATA-space constant — goes THROUGH the scale, so
//                          `y: { datum: 25 }` lands at the pixel where y=25 is
//   { field, scale: null } a raw field, read unscaled (the datum already holds a
//                          literal colour / pixel)
//   { fn }                 a DERIVED channel — fn(d, i, data) computed per datum
//                          in VISUAL space (result used as-is, never scaled), e.g.
//                          `fill: d => d.x > 50 ? 'red' : 'blue'`
// The first four stay serializable/introspectable. `{ fn }` is the one deliberate
// exception: opaque to the edit layer, so a derived channel is READ-ONLY — it
// can't carry an `edit` (dev-warned + ignored). Put edits on the source field's
// channel; the fn re-derives from the committed rows on every render. A function
// shorthand (`fill: d => …`) desugars to `{ fn }`; an explicit `{ value: someFn }`
// stays an opaque constant, never invoked.
export interface ChannelSpec {
  field?: string;
  // On a picture channel (`image`, `src`): how the picture is sized in its box,
  // as CSS object-fit / background-size.
  fit?: ImageFit;
  // On a picture channel: where the picture sits in its box, as CSS
  // object-position / background-position — keywords and percentages
  // ('center', 'bottom', 'left top', '25% 75%'). Default 'center'.
  position?: string;
  // On the `image` channel: whether the picture repeats, as CSS
  // background-repeat. Default 'no-repeat'.
  repeat?: ImageRepeat;
  value?: any;
  datum?: any;
  // Derived channel: computed per datum in VISUAL space (result used as-is, never
  // scaled — on `y` it is a pixel). READ-ONLY: an `edit` here is ignored (put it on
  // the source field's channel — the fn re-derives after every commit). On a
  // line-family mark a paint fn (fill/stroke) runs once per SERIES, against the
  // series' first row. i/data are supplied by per-datum marks, undefined elsewhere.
  fn?: ChannelFn;
  /**
   * The declarative twin of `fn`, for a JSON spec: `{ expr: "datum.x > 50" }`.
   * `compile()` lowers it to `fn`, so a spec passed straight to `Elicit()` must
   * use `fn`; an `expr` there warns and the channel falls back.
   */
  expr?: string;
  // The field's DATA type. Overrides the schema's declaration for this channel;
  // useful for a field the schema doesn't cover. Below an explicit `scale`.
  type?: MeasureType;
  // The scale, by name (`'log'`), by spec (`{ type: 'sqrt', range: [4, 20] }`),
  // as a live d3 scale (adopted as-is; see adoptScale in core/scales.js), or
  // `null` to read the field unscaled. `'frame'` / `{ type: 'frame', range }` is
  // the long spelling of `frame` below.
  scale?: ScaleType | ScaleSpec | Function | null;
  // LOCAL to the enclosing composite's box, and what switches that composite into
  // box mode (plot/composite.js). Three forms:
  //   frame: -0.4          a pinned local position — x/y in [-1, 1] from the
  //                        glyph's centre with y UP, magnitudes (size/rx/ry/
  //                        strokeWidth) as a fraction of its half-size
  //   frame: [lo, hi]      map `field`'s SCHEMA domain onto that slice of the box
  //   frame: true          map `field` onto the channel's default local range
  // A categorical or ordinal field spreads its categories evenly from `lo` to `hi`
  // (a point scale, so an edit snaps to the nearest). With `fn` instead of a field,
  // `{ fn, frame: true }` is DERIVED in local units — how one part sits where
  // another part's value puts it (a forearm at the end of an upper arm).
  // Desugars to `scale` (normalizeFrameKey in core/encoding.js), which stays the
  // single reader. An explicit `scale` wins. `{ value }` still means PIXELS here
  // as everywhere — inside a glyph you almost never want one, which is why the
  // local spelling is the short one.
  frame?: number | number[] | boolean;
  // Makes the channel writable: a gesture inverts back to `field` through this
  // same scale. Collected by edit/route.js's collectEdits.
  edit?: Edit;
  // Draw a KEY for this encoding. A legend is a key for one (channel, field) pair,
  // so declaring it here is what makes it unambiguous — the field and table come
  // from the channel and its mark, and nothing has to be restated or inferred.
  //
  //   fill: { field: 'group', legend: true }
  //   fill: { field: 'group', legend: { anchor: 'bottom', edit: … } }
  //   fill: { field: 'group', legend: false }   // suppress under `legends: true`
  //
  // Two marks stating the SAME encoding share one legend. Non-positional channels
  // only — an axis is the key for x/y. See core/legends.js.
  legend?: boolean | LegendOptions | null;
}

/**
 * How a legend for one encoding looks. The presentation half of `ChannelSpec.legend`
 * and of a composed `elements.legend*` — `channel`, `field` and `table` are absent
 * because the encoding already supplies them.
 */
export interface LegendOptions {
  /** Which side it reserves space on. */
  anchor?: 'top' | 'right' | 'bottom' | 'left';
  orient?: 'horizontal' | 'vertical';
  /** Caption. Defaults to the encoded field's name; `false` removes it. */
  title?: string | false | null;
  /** Which row(s) a picker writes. Defaults to the chart's selection. */
  row?: number | number[] | ((data: Datum[], ctx: { selection: number | null }) => number | number[] | null);
  /** Interactivity: a picker (`edit.legend.*`) or a domain edit (`edit.scale.*`). */
  edit?: Edit | Edit[] | Edit[][];
  edits?: Edit[];
  /** Discrete swatch geometry. */
  swatchSize?: number;
  gap?: number;
  labelWidth?: number;
  /** Continuous ramp geometry. */
  rampLength?: number;
  rampThickness?: number;
  ticks?: number;
  tickFormat?: string | ((v: any) => string);
  /** Chrome, defaulting to the theme's legend tokens. */
  stroke?: string;
  fill?: string;
  fontSize?: number;
  handleSize?: number;
  handleColor?: string;
  id?: string;
}

// The standard style channels every mark understands. A field drives them
// through a scale (colour palette for fill/stroke, opacity ramp for the opacity
// family); a `{ value }` (or top-level shorthand) sets a constant.
export interface StyleChannels {
  fill?: ChannelSpec;
  stroke?: ChannelSpec;
  strokeWidth?: ChannelSpec;
  opacity?: ChannelSpec;
  fillOpacity?: ChannelSpec;
  strokeOpacity?: ChannelSpec;
  /** Dash pattern: a constant SVG dash array, or a field through an ordinal scale onto the dash vocabulary. */
  strokeDash?: ChannelSpec;
}

export interface Channels extends StyleChannels {
  x?: ChannelSpec;
  y?: ChannelSpec;
  // Explicit span endpoints (bar's x1/x2 or y1/y2): alternative to x/y for a
  // value that doesn't start at the baseline. Share x/y's resolved scale (see
  // core/encoding.js's axisOf / core/resolve.js's axis-bucketed aliasing).
  x1?: ChannelSpec;
  x2?: ChannelSpec;
  y1?: ChannelSpec;
  y2?: ChannelSpec;
  // Circle radius in px. Constant form is the `size` shorthand, not resolveStyle.
  size?: ChannelSpec;
  // Categorical glyph channel: a category -> an emoji / unicode shape through an
  // ordinal scale, exactly like `fill` maps a category -> a colour. A shape mark
  // (point / dotStack / waffle) renders the glyph as text in place of its
  // circle/rect. Supply the glyphs with `scale: { range: ['😢','😐','😊'] }` or a
  // named `scale: { scheme: 'faces' }`; edit it with cycle()/legend() (the field
  // holds the category — the glyph is its encoding). Non-positional, non-invertible.
  symbol?: ChannelSpec;
  // Text mark channels: the label string, its size/anchors/offsets (read RAW,
  // not scaled — constant forms are shorthands). `format` is a mark-level option
  // (string | fn), not a channel — see MarkOptions.
  text?: ChannelSpec;
  fontSize?: ChannelSpec;
  textAnchor?: ChannelSpec;   // horizontal: 'start' | 'middle' | 'end'
  lineAnchor?: ChannelSpec;   // vertical: 'top' | 'middle' | 'bottom'
  dx?: ChannelSpec;           // horizontal pixel offset
  dy?: ChannelSpec;           // vertical pixel offset
  // Where links may meet this node (`PortSides`), on a mark drawing a network's
  // node table. Read raw. Carries `edit.network.connect()` as its edit; the engine
  // draws the ports on the mark's own box (`Mark.nodeBox`).
  ports?: ChannelSpec;
  // A mark's ROTATION IN PLACE, in math degrees (0° = +x, CCW, y-up). Scaled when
  // a scale is declared so rotate() is an exact inverse; else raw. Marks that emit
  // geometry (point/rect/tick/text/curve/ellipse) stamp it on FeatureNode.angle;
  // the renderer applies SVG rotate(-deg) about the mark centre.
  //
  // NOT a position: it has no axis and no legend. A rotation is a property of the
  // glyph, not a place on a scale — cf. `theta`.
  angle?: ChannelSpec;
  // A shape's background image, as in CSS: a URL read raw — a column of URLs
  // (`{ field }`), one URL (`{ value }`, or the `image` shorthand), or `{ fn }`.
  // Painted inside the shape in place of the fill. Takes `fit`, `position` and
  // `repeat` as params (default fit 'cover'). A mark that draws it lists it in
  // `rawChannels`.
  image?: ChannelSpec;
  // `plot.image`'s picture, as an <img src>: a URL read raw. Takes `fit` and
  // `position` as params (default fit 'contain').
  src?: ChannelSpec;
  // The POLAR ANGULAR POSITION, in math degrees (default range [180, 0] =
  // left→right through the top). Positional (see AXIS_OF): `axisRadial` is its
  // axis and a legend draws it as a fan of spokes at their bearings. It carries a
  // needle's direction and an arc's stacked magnitude — Vega-Lite's split, where
  // `theta` is polar position and `angle` is mark rotation.
  //
  // `theta` and `angle` were ONE channel until the second consistency pass, so
  // `axisRadial` drew a polar axis for a scale six marks were using as a rotation.
  //
  // Whether it is SCALED depends on the mark, and both marks say so: a needle reads
  // it through the scale (a bearing), while an arc declares it in `rawChannels` and
  // normalizes the magnitudes itself, so a pie neither implies a radial axis nor
  // mints a fan key for shares that are not bearings.
  theta?: ChannelSpec;
  /** The polar RADIAL position: how far from the centre a slice's rim sits (a rose plot). Its range is the mark's inner/outer radius. */
  radius?: ChannelSpec;
  // Span partner for `theta`, on the same axis (as x2 is to x).
  theta2?: ChannelSpec;
  // A COUNT — a quantity measured in the MARK's own units: a waffle's cell (worth
  // `unit` of the field), a dotStack's token (one row). Positional, on a count axis
  // of its own, so it never unions with a y domain: "how many cells" and "how far
  // up the y axis" are different questions about different quantities.
  //
  // The axis is OPT-IN (`axes: { count: true }`), like a legend rather than like
  // x/y, because it reserves layout space for something these marks already make
  // countable by eye. It reports DATA units, so it agrees with the column.
  //
  // A mark either ENCODES its count (waffle binds this channel) or DERIVES it
  // (dotStack: one row is one token, no column, so it declares `countPitch` and
  // the resolver synthesises the scale).
  count?: ChannelSpec;
  // A second category NESTED inside each x (y) category: each category's slot is
  // split into one sub-band per value of this field, so `x: country` +
  // `xOffset: year` draws a grouped (dodged) bar chart. Vega-Lite's channels.
  //
  // Not an axis: it never unions with x, draws no axis of its own, and needs a
  // DISCRETE parent (a band or point x) — a number line has no slot to divide. Its
  // range is one parent slot in pixels; sub-bands abut by default
  // (`scale: { padding }` opens a gap), and `yOffset` lists `domain[0]` at the
  // bottom of its slot, as a band y axis does. Every mark that places by category
  // honours it — bar, rect, tick, rule and waffle draw in the sub-band; point,
  // text and line sit at its centre; dotStack stacks per (category, sub-category).
  //
  // An edit inverts it with the rest of the position: `create` and `toggle` name
  // it by default, and `move({ channels: ['x', 'xOffset'] })` re-files a row in
  // another category and group. A stacked bar with an offset stacks per sub-band.
  xOffset?: ChannelSpec;
  /** `xOffset`'s twin, nested inside each y category (a grouped horizontal bar). */
  yOffset?: ChannelSpec;
  // The field that names each part of a whole: a stacked bar's segments, a pie's
  // slices. `xOffset`'s counterpart along the value axis: rows that share a band
  // stack end to end, in the order of the field's categories (its schema domain,
  // else first appearance). Binding it is what stacks a `bar`; an `arc` always
  // stacks, and there it only orders the slices. `edit.stack.cut` writes the new
  // segment's category into it. Raw (never scaled); categorical or ordinal.
  stack?: ChannelSpec;
  [channel: string]: ChannelSpec | undefined;
}

/** The object form of `ChartSpec.clip`: clip, to the plot rect grown by `pad`. */
export interface ClipSpec {
  /** Pixels past the plot rect the marks may still draw: one number for every
   *  side, or per side. Default 0. */
  pad?: number | { top?: number; right?: number; bottom?: number; left?: number };
}

/** A clip rect in plot-local pixels: the plot's top-left corner is (0, 0). */
export interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The shared option surface for every mark factory (bar, point, and new marks).
// `channels` carries the bindings; the shorthands are sugar that desugar into
// constant channels via normalizeMarkOptions (an explicit `channels` entry wins).
//
// A mark NEVER owns data: the dataset does (DatasetSpec), and a mark is a view
// over it that encodes some columns and may edit them. There is no `data` or
// `onChange` here — both live on DatasetSpec. Nor does it own a domain: that is
// the data's, declared once on the schema.
export interface MarkOptions {
  channels?: Channels;
  /**
   * A tooltip for this mark's rows: `true` (every column), the columns to show,
   * or a function of the row. Desugars to `guides.tip({ mark })` — a guide, so it
   * never makes the mark pointer-active and cannot block a gesture.
   */
  tip?: boolean | string[] | ((row: Datum, ctx: any) => string | string[]) | Omit<TipGuideOptions, 'mark'>;
  // Constant shorthands — e.g. `fill: 'steelblue'`, `strokeWidth: 2`, `size: 9`.
  // A FUNCTION shorthand (`fill: d => d.x > 50 ? 'red' : 'blue'`) desugars to a
  // derived channel (`{ fn }`), computed per datum in visual space (read-only).
  fill?: any;
  stroke?: any;
  strokeWidth?: number | ChannelFn;
  opacity?: number | ChannelFn;
  fillOpacity?: number | ChannelFn;
  strokeOpacity?: number | ChannelFn;
  strokeDash?: string | ChannelFn;
  size?: number | ChannelFn;
  // Text-mark shorthands (desugar into raw channels via normalizeMarkOptions).
  text?: any;
  fontSize?: number | ChannelFn;
  fontWeight?: string | number | ChannelFn;
  fontStyle?: 'normal' | 'italic' | string | ChannelFn;
  fontFamily?: string | ChannelFn;
  textAnchor?: 'start' | 'middle' | 'end' | string | ChannelFn;
  lineAnchor?: 'top' | 'middle' | 'bottom' | string | ChannelFn;
  dx?: number | ChannelFn;
  dy?: number | ChannelFn;
  // Rotation shorthand (math degrees) — desugars to channels.angle. There is no
  // `theta` shorthand: theta is POSITIONAL, and positional channels (x, y) are not
  // shorthands either.
  angle?: number | ChannelFn;
  // A shape's background image URL (desugars to channels.image).
  image?: string | ChannelFn;
  // plot.image's picture URL (desugars to channels.src).
  src?: string | ChannelFn;
  id?: string;
  edits?: Edit[];
  // Which TABLE this mark is a view over, by NAME (see Mark.table).
  table?: string;
  /**
   * `false` draws this mark past the chart's clip (`ChartSpec.clip`): an
   * annotation or a label meant to sit in the margin. Its nodes stay grabbable
   * and tippable there too. Unset, the mark follows the chart.
   */
  clip?: boolean;
  /**
   * `true` eases this mark's drawing: when its rows change, the nodes travel to
   * their new places over `ChartSpec.motion`'s duration. A grabbed row is never
   * eased; along an edited channel whose scale has slots (band, point) it is drawn
   * at the pointer and eases into its slot on release. Only the drawing is eased,
   * never the data. Off when `ChartSpec.motion` is `false` or the reader asks for
   * reduced motion. A mark that draws a path per row cannot be eased and warns.
   */
  motion?: boolean;
  /**
   * Sugar on a mark drawing a hierarchy's nodes: marks rows boxed by this mark as
   * containers (`true`, a predicate `(d, i, rows) => boolean`, or `{ where?, padding?, fit? }`).
   * Desugars at chart assembly into container eligibility + `layout.contain(...)`.
   */
  contains?: MarkContainsOption;
  // No `constraints` here on purpose: a constraint is a DATASET invariant and gates
  // every edit from every mark, so one written inside a mark reads as scoped to that
  // mark and is not. `DatasetSpec.constraints` is the only home.
  //
  // CLOSED: a mark's own options are typed on its interface (BarOptions, …), and
  // `src/vocabulary.js` is the runtime twin `check:exports` holds them to.
}

export interface MarkContainsOptions {
  where?: (d: Datum, i: number, data: Datum[]) => boolean;
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  fit?: boolean | 'x' | 'y';
}
export type MarkContainsOption = boolean | ((d: Datum, i: number, data: Datum[]) => boolean) | MarkContainsOptions;

/** The handle contract: drawn+grabbable / neither / invisible-but-grabbable. */
export type Handles = boolean | 'hit';

/** Which axis a directional mark's value runs along ('vertical' = y). The `…Y`/`…X`
 *  factory variants pin it: `barY(o) === bar({ ...o, orientation: 'vertical' })`. */
export type Orientation = 'horizontal' | 'vertical';

/** Shared by every mark that draws a grip (see resolveHandles in plot/mark.js). */
export interface HandleOptions {
  handles?: Handles;
  handleSize?: number;
  handleColor?: string;
}

/** Text-mark display formatter: a d3-format string or `(value) => string`.
 *  Display-only — the underlying field stays the raw value. See `elicit.format`. */
export type Format = string | ((v: any) => string);

// A face's parameter names. Each is a CHANNEL that the face preset forwards to a
// concrete channel on one of its parts (mouthCurve -> the mouth curve's
// `curvature`, eyeSquint -> the eyes' `ry`, browTilt -> the brows' `angle`, …).
// Bind a field with `{ field }` and attach the edit you want; pin a fixed
// expression with `{ value: 0..1 }` (a fraction of that parameter's travel);
// leave it out for neutral (0.5).
export type FaceParam =
  | 'mouthCurve' | 'mouthAsym'
  | 'eyeScale' | 'eyeSquint'
  | 'browHeight' | 'browTilt';

// A face's channel map: the ordinary positional/style channels plus the face
// params.
export type FaceChannels = Channels & Partial<Record<FaceParam, ChannelSpec>>;

// Options for the FACE preset (an emotion glyph). `face()` is not a mark: it
// returns a `composite` of ordinary marks in box mode — a head `point`, two
// `ellipse` eyes, two `tickY` brows and a `curveY` mouth — each placed in the
// glyph's local box. So every part is its own feature with its own direct-pick
// edit, and a parameter is edited with the universal edits (`slide` on a
// curvature or a radius, `rotate` on a brow's angle, `move`/`resize` on the
// composite's own x/y/size) rather than a face-specific namespace.
//
// Bind NO param for the emotion preset (mouthCurve ← valence, eyeScale ←
// arousal); binding any one replaces it. The centre is placed by the x/y channels
// when present, else the plot centre; `size` is the face's radius and also the
// frame's half-size, so every feature scales with it. See plot/face.js.
export interface FaceOptions extends MarkOptions {
  // The channel map, including the face params as `{ field }` / `{ value }`.
  channels?: FaceChannels;
  // Face radius in px (or a field, for a per-row size). Default: half a category
  // slot when the face sits in one, else min(width, height) * 0.35.
  size?: number;
  // The colour of the drawn FEATURES (eyes, brows, mouth). The head's own paint is
  // the ordinary `fill` / `stroke`.
  ink?: string;
}

// `link` — one row of the links table drawn between the two nodes it references.
// Nearly everything is a schema read, so a bare `link()` works; these are the
// drawing choices the schema can't state. `curve` and `arrow` are also readable
// PER ROW as channels (`channels: { curve: { field: 'kind' } }`), which is how one
// link mark draws several kinds of connector.
export interface LinkOptions extends MarkOptions, HandleOptions {
  // Connector shape. Default 'line'; promoted to 'arc' when separation bows it.
  curve?: LinkCurve;
  // Apex offset as a fraction of the chord. 'auto' (the default) asks the TABLE:
  // links sharing a pair of nodes fan apart, a lone link stays straight.
  curvature?: number | 'auto';
  // The step between adjacent links of one pair under `curvature: 'auto'`.
  spread?: number;
  // Which ends carry an arrowhead. Default 'auto' — the target end iff the links
  // table declares `directed: true`.
  arrow?: LinkArrow | boolean;
  arrowSize?: number;
  // Pull the ends in, so a link stops short of a node instead of running under it.
  inset?: number;
  sourceInset?: number;
  targetInset?: number;
  // How far a self-loop reaches from its node, in px.
  loopRadius?: number;
  // Corner rounding for the routed connector, in px. Default 8; 0 is square.
  // The corner is sampled into the same polyline, so a rounded link stays
  // grabbable and canvas-drawable.
  cornerRadius?: number;
  // Which edge each end meets. Default 'auto': the end slides along the box. A
  // channel naming a field (`channels: { sourceSide: { field: 'fromSide' } }`)
  // reads it per row, and is the column a connect or rewire gesture writes.
  sourceSide?: LinkSide;
  targetSide?: LinkSide;
  // Where along that edge the connector meets it, as a signed fraction of the
  // edge from its midpoint (-0.4..0.4). Positive runs clockwise around the box:
  // rightward along the top, downward along the right, leftward along the
  // bottom, upward along the left. Default 0, the midpoint — links sharing a
  // side share their first leg. Read per row like a side, and never written.
  sourceOffset?: number;
  targetOffset?: number;
  // A plate behind `channels.text`, so a label sitting on its own connector stays
  // readable. Off by default. `true` takes the theme's backdrop (white when the
  // theme leaves it transparent); a colour string sets it outright.
  labelBackground?: boolean | string;
  // Space between the label and the plate's edge, in px (default 3).
  labelPadding?: number;
  // The plate's corner radius, in px (default 3).
  labelRadius?: number;
  // The plate's fill opacity (default 0.9) — lower it to let the connector show
  // through the mask.
  labelOpacity?: number;
  format?: Format;
}

// `sticker` — a rounded box with text in it, sized by the text. A preset over
// `composite`: a `rect` that owns every edit, and an inert `text` drawn on top.
export interface StickerOptions extends MarkOptions {
  // Space between the text and the box's edge, in px.
  padding?: number;
  // Corner radius, in px.
  radius?: number;
  // The box stops growing here and the text wraps instead.
  maxWidth?: number;
  minWidth?: number;
  minHeight?: number;
  // Baseline step between wrapped lines, in px. Defaults to 1.35 × the font size.
  lineHeight?: number;
  // Used for MEASUREMENT as well as drawing, so the box matches what is painted;
  // a shorthand, like on every mark.
  fontSize?: number;
  fontFamily?: string;
  format?: Format;
}

// `edit.network.connect` — drag from a port to another node to create a link. Put
// it on a node mark's `ports` channel. The columns it writes are the ones the
// `link` mark's `source` / `target` / `sourceSide` / `targetSide` channels name.
// The descriptor-level `target` (a write destination) is omitted: the link table
// is always the destination.
// `edit.hierarchy.nest` — drop a node into the container under the pointer, or out
// of one. Put it on the mark you drag, beside a `move`. `defaults` seeds any further
// columns of the nesting row it writes.
export interface HierarchyNestOptions extends Omit<CreateOptions, 'target'> {}

export interface NetworkConnectOptions extends Omit<CreateOptions, 'target'> {
  // How near the pointer must come to a node for the drag to land on it. Whether a
  // second link between one pair, or a link from a node to itself, may be made is
  // the links table's statement (`multi`, `selfLoops`), not an option here.
  threshold?: number;
}

// `edit.network.rewire` / `edit.network.reverse`. Both go on a `link` mark and write
// the columns its channels name. `rewire` takes `channels: ['source']` or
// `['target']` to move one end only.
export interface NetworkEndpointOptions extends Omit<EditOptions, 'target'> {
  threshold?: number;
}

// A parametric line's channel map: the ordinary positional/style channels plus the
// PARAMETERS of the line. `intercept`/`slope` are the line itself; the uncertainty
// is named either symmetrically (`interceptSpread`/`slopeSpread`, a half-width in
// the field's own units) or as an explicit asymmetric range (`intercept1`/
// `intercept2`, `slope1`/`slope2` — the same 1/2 span spelling `area` and `rect`
// use). The range form wins when both are declared.
//
// All of them are UNSCALED: parameters read in their own units and projected
// through x/y, not encoded themselves. Bind a field to make one editable, or pin it
// with `{ datum }` — `intercept: { datum: 0 }` is what makes a trend a correlation.
export type TrendParam =
  | 'intercept' | 'slope'
  | 'interceptSpread' | 'slopeSpread'
  | 'intercept1' | 'intercept2' | 'slope1' | 'slope2';

export type TrendChannels = Channels & Partial<Record<TrendParam, ChannelSpec>>;

// The two x positions a parametric line is edited at. Shared by `trend`,
// `trendBand` and the trend-scoped edits so a handle pivots exactly where it sits.
export interface TrendAnchorOptions extends MarkOptions {
  channels?: TrendChannels;
  // The pivot: where the intercept handle sits, and the point a slope drag holds
  // fixed. Defaults to 0 when 0 lies in the x domain, else the domain's first end.
  anchor?: number;
  // Where the slope grip sits. 'end' (default) mounts a PAIR on the ends of the
  // drawn line (the band's upper edge, on trendBand) and a drag passes the line
  // through the pointer, so it swings through the full circle; 'probe' pins ONE at
  // x = `probe`, sliding vertically at that column — the pre-grip behaviour, whose
  // reachable slope is capped at `ySpan / (probe - anchor)`.
  grip?: 'end' | 'probe';
  // The column a pinned slope grip sits at, under `grip: 'probe'` only. Defaults to
  // the x domain's other end. Setting it under the default grip dev-warns.
  probe?: number;
  // true | false | 'hit' — the shared handle contract (plot/mark.js).
  handles?: Handles;
  handleSize?: number;
  handleColor?: string;
}

// Options for a TREND mark: the line y = intercept + slope*x, clipped to the plot,
// with a handle at `anchor` (translate) and a pair on the line's own ends (rotate
// about the anchor — see `grip`). Its positional channels name the plot's AXES; the
// belief lives in the parameter channels. Stage via the edits
// (`edit.trend.slope({ stage: 1 })`), not mark options. See plot/trend.js.
export interface TrendOptions extends TrendAnchorOptions {}

// Options for a TREND BAND mark: the uncertainty around a parametric line, drawn
// as the envelope of every line the belief allows. Declares no edits of its own —
// it is a view of the same rows the line's handles write. See plot/trendBand.js.
export interface TrendBandOptions extends TrendAnchorOptions {
  // How the family is drawn: one exact envelope polygon (default), `levels` nested
  // envelopes stacked so the ink darkens toward the line, or `samples` individual
  // lines drawn from it.
  render?: 'region' | 'gradient' | 'samples';
  // 'gradient' only: how many nested envelopes. Default 5.
  levels?: number;
  // 'samples' only: how many lines, and the seed that keeps the fan stable across
  // re-renders. Defaults 60 and 7.
  samples?: number;
  seed?: number;
  // 'samples' only: 'normal' (default) treats the bounds as a `sigma`-wide envelope
  // so ~95% of draws land inside it; 'uniform' spreads flat across them.
  distribution?: 'normal' | 'uniform';
  // The envelope half-width, in standard deviations, when sampling normally.
  // Default 1.96.
  sigma?: number;
}

// Options for a COMPOSITE mark (a glyph): a named group of ordinary marks over
// the shared dataset. Each part encodes some columns; a part carrying an `edit`
// on a channel is a handle. `composite` returns the parts as an array of features
// (Elicit flattens it) — it is a desugaring, not a new kind of feature.
//
// It has TWO MODES, one rule apart, and a part switches between them:
//
// PLAIN — every part stands on the chart's own axes (an error bar's caps are
// positions on y). Composite-level `channels` (and style/angle shorthands) merge
// into every part at desugar time; a part's own channel for the same name wins.
// Inherited `edit`s attach to the last part only (visuals first, handles last) so
// one dataset does not get the same edit applied twice.
//
// BOX — a part states a channel in LOCAL units (`ChannelSpec.frame`), and the
// composite becomes a per-datum box. Its own `x`/`y`/`size` then place and size
// that box instead of trickling down: local +1 on x is `origin + size`, local +1
// on y is `origin - size` (local y is UP), a magnitude of 1 is `size`. Each local
// channel becomes a real, invertible per-datum scale (createFrameScale), so marks
// encode and edits invert through the same object with no bespoke geometry on
// either side. A local part that states no x/y sits at the box's ORIGIN — parts
// do not repeat the composite's placement. A part with no local channel at all
// keeps its ordinary build over the global scales.
//
// In box mode the returned array is led by the BOX: a feature carrying the
// composite's x/y/size (so the global resolver builds the axes the origin is
// measured against) that draws one transparent hit circle per row beneath every
// part — which is what makes a `move()` on the composite's `x` pick the whole
// glyph up while a drag on one part still edits only that part.
export interface CompositeOptions {
  // The sub-marks, in z-order: visual parts first, handles last.
  parts?: any[];
  id?: string;
  // Shared channel map. In plain mode every part inherits it (part keys win). In
  // box mode `x`/`y`/`size` are withheld — they define the box — and everything
  // else (fill, opacity, angle, …) still trickles.
  channels?: Channels;
  // Constant shorthands desugared into composite channels (same list as MarkOptions).
  fill?: any;
  stroke?: any;
  strokeWidth?: number;
  opacity?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  size?: number;
  angle?: number;
  // Stamped onto any part that doesn't declare its own (a glyph usually sits in a
  // band slot). See plot/composite.js.
  discreteScale?: 'band' | 'point';
  // Mark-level edits. Ride the last part in plain mode; in box mode they ride the
  // box, whose channel map holds the glyph's placement columns.
  edits?: Edit[];
  // The table the glyph is a view over; stamped onto its box and every part.
  table?: string;
  // `false` draws the whole glyph past the chart's clip (see MarkOptions.clip);
  // stamped onto its box and every part that doesn't state its own.
  clip?: boolean;
  // `true` eases the whole glyph (see MarkOptions.motion); stamped onto its box
  // and every part that doesn't state its own.
  motion?: boolean;
  // Sugar for hierarchy containers on the glyph's box/host (see MarkOptions.contains).
  contains?: MarkContainsOption;
}

/**
 * A GUIDE — a feature that views chart STATE (`views: 'state'`).
 *
 * ── The three things a feature can view ─────────────────────────────────────
 *   views      public name   one node per          channels name        writes
 *   'data'     mark          a row                 columns of a table   rows
 *   'scale'    element       a tick / swatch       (singular `channel`) the domain
 *   'state'    guide         a derived statement   expressions          nothing
 *
 * A mark draws the DATA. An element draws a SCALE. A guide draws the RULE and the
 * STATE — what the interaction is doing, what it is allowed to do, and what is
 * left to do: a target line, a proximity catchment, the budget still unallocated,
 * where a running sum would reach.
 *
 * ── Why this isn't just "a derived mark" ────────────────────────────────────
 * Being derived is NOT the discriminator — a mark channel can already be derived
 * (`{ fn }`). The discriminators are ARITY and WRITABILITY:
 *
 *   · a `{ fn }` channel is per-ROW, and its mark may still carry an `edit`;
 *   · a guide's expressions are per-CHART, and it can never carry one.
 *
 * So a guide has no `table`, no `channels` map, no `edits` and no row — by
 * construction, not by convention. That is what makes "read-only" a property of
 * the KIND rather than a discipline the author has to maintain.
 *
 * Guides reach the scene from three places, all of which produce this shape:
 * `spec.guides` (the author declares one), `Constraint.guide` (a rule draws its
 * own bound), and `Edit.guide` (an edit draws its own catchment / track).
 */
export interface Guide {
  /** Always 'state' — that is what makes it a guide rather than a mark. */
  views: 'state';
  /**
   * Reads the pointer (`ui.pointer` / `ui.hit`). The engine then records pointer
   * movement and re-renders on it; a chart with no such guide never does.
   */
  tracksPointer?: boolean;
  /**
   * Emit the nodes. Same five arguments every feature's `build` takes, so the
   * three kinds are one contract: the primary table's rows, the resolved scales,
   * the inner dimensions, and the live chart context (`ui`, `effects`, `stage`,
   * `theme`, `constraints`, `features`, `featureNodes`).
   *
   * Every node it returns is tagged `guide: true` and made pointer-transparent on
   * the way out, so a guide can never capture a gesture.
   */
  build(
    currentData: Datum[],
    scales: ScaleMap,
    width: number,
    height: number,
    context?: any
  ): FeatureNode[];
  id?: string;
  /** Which guide keyword built it (`'rule'`, `'region'`, `'prompt'`, …). The one
   *  identity key every feature kind carries — see `Mark.type`. */
  type?: string;
}

/**
 * A guide option may be a literal or a FUNCTION of the chart context, which is
 * what lets a reference line be derived from the elicited rows:
 *
 *   guides.rule({ y: 25 })                                  // literal
 *   guides.rule({ y: ({ data }) => d3.mean(data, d => d.y) }) // derived
 *
 * `expr` is the reserved declarative twin of the function form — see `ChannelSpec`.
 */
export type GuideOption<T> = T | ((ctx: any) => T);

/**
 * What a mark factory returns — the feature object the engine consumes.
 *
 * This contract used to live ONLY as prose at the top of plot/mark.js, with every
 * factory annotated `@returns {any}`. That is how `rule` silently dropped `edits`
 * and `constraints` for a long time: a mark could accept an option and never pass
 * it on, and nothing caught it. Typing the return makes that a typecheck failure.
 *
 * A mark NEVER owns data: the dataset owns the rows, and the chart hands them
 * to `build`. There is deliberately no `data` and no `onChange` here.
 */
/**
 * A CHART ELEMENT — `axis`, `grid`, `legend`, `axisRadial`. Public as
 * `elicit.elements.*`, and only there. Structurally a feature like any
 * other (the engine builds and draws it the same way), but it answers a different
 * question, and the differences are the contract:
 *
 *   · It views a SCALE, not the dataset. `views: 'scale'`, always. It picks the
 *     scale by a singular `channel` ('x', 'fill', 'angle'), so it has no data-mark
 *     `channels` MAP, no fields of its own, and no `discreteScale`/`xKey`/`yKey`.
 *   · Its style options are CHROME, not channels. `stroke`/`fill`/`fontSize` paint
 *     a spine and its labels; there is no datum to resolve them against, so they
 *     stay plain options rather than desugaring into channels.
 *   · An edit on it targets the DOMAIN, not rows (`edit.axis.*`, `target: 'domain'`)
 *     — so it can't be a create target, and `edit/route.js` recovers its field from
 *     `scale.fields[0]` instead of from a channel map.
 *   · It may RESERVE layout space. A legend shrinks the plot so it never overlaps
 *     the marks (core/legends.js) — nothing else in the library does this.
 *
 * Exception: `axisRadial` may carry optional placement `channels` (x/y/fill) to
 * draw one ring per row around small-multiple needles — placement chrome, not a
 * data-mark encoding surface.
 *
 * The type is documentation and a checkable shape; the engine still branches on
 * `views === 'scale'` rather than on this interface. Both `axes` and `legends` on
 * the spec desugar into these; authors may also pass them via `ChartSpec.elements`.
 */

/**
 * What you PASS to a chart-element factory — the counterpart of `MarkOptions` for
 * a `views: 'scale'` feature, one interface PER element. The runtime twin is
 * `ELEMENT_OPTIONS` (src/vocabulary.js), checked by `warnUnknownElementOptions`
 * and held to these declarations by `check:exports`. There is no `channels` map
 * and no style-shorthand desugaring: an element's `stroke`/`fill`/`fontSize`
 * paint chrome, because it has no datum to resolve them against.
 */
export interface ElementOptionsBase {
  /** The single scale this element draws, by channel name (`'x'`, `'fill'`, …). */
  channel?: string;
  /**
   * Edit(s) on this element — `edit.axis.*`, `edit.scale.*`, `edit.legend.*`. Both
   * spellings are read (see `elementEdits` in plot/mark.js).
   */
  edit?: Edit | Edit[] | Edit[][];
  edits?: Edit[];
  id?: string;
  /**
   * The COLUMN an edit on this element writes. An element has no channel map, so
   * unpinned the field falls back to `scale.fields[0]`. Pin it whenever more than
   * one mark binds the channel.
   */
  field?: string;
  /** The TABLE that column is in, by NAME. Unset, the structure's primary table. */
  table?: string;
}

/** Width/height/scales-aware override of an axis's base translate — e.g. cross at
 *  the origin: `({ scales }) => ({ y: scales.y(0) })`. */
export type AxisTransform = (ctx: {
  width: number;
  height: number;
  scales: ScaleMap;
  anchor: string;
  base: { x: number; y: number };
}) => { x?: number; y?: number };

/** `elements.axis` / `axisX` / `axisY` — and one positional entry of `spec.axes`. */
export interface AxisOptions extends ElementOptionsBase {
  channel?: 'x' | 'y';
  /** Base side; default x->'bottom', y->'left'. Drives tick side + label placement. */
  anchor?: 'bottom' | 'top' | 'left' | 'right';
  transform?: AxisTransform;
  /** Tick count hint (linear); ignored for band/point. */
  ticks?: number | any[];
  tickValues?: any[];
  /** A label per tick. A `\n` in the formatted label breaks it onto a second
   *  line (a year under its January). */
  tickFormat?: Format;
  /** Tick length in px (0 draws none), or per tick `(value, index) => px`.
   *  Default: the theme's `axis.tickSize` (6). */
  tickSize?: number | AxisTickFn<number>;
  /** Gap from a tick's end to its label, px. Default: theme (3). */
  tickPadding?: number;
  title?: string;
  /** The title's rotation in math degrees. A y title defaults to running along
   *  its axis (90 on the left, -90 on the right); 0 lays it flat. An x title
   *  defaults to 0. */
  titleAngle?: number;
  /** The spine + ticks' colour, or per tick `(value, index) => colour` (the spine
   *  then takes the theme's). */
  stroke?: string | AxisTickFn<string>;
  /** Spine and tick width. */
  strokeWidth?: number;
  /** Draw the spine (domain line). Default: theme (`true`). */
  line?: boolean;
  /** Label colour (the title's too, unless `titleFill`), or per tick. */
  fill?: string | AxisTickFn<string>;
  fontSize?: number;
  fontFamily?: string;
  /** Label weight, or per tick (bold on January). */
  fontWeight?: string | number | AxisTickFn<string | number>;
  /** Tick-label rotation in math degrees (counter-clockwise, like a mark's
   *  `angle`); the axis reserves the room the turned labels need. */
  labelAngle?: number;
  titleFill?: string;
  titleFontSize?: number;
  titleFontWeight?: string | number;
  /** Extra px between the tick labels and the title. */
  titlePadding?: number;
  /** The title's place along the axis: 'start', 'middle' (default) or 'end' — the
   *  right of an x axis, the top of a y axis. A flat (`titleAngle: 0`) y title at
   *  an end sits past it, over the plot; leave room in that margin. */
  titleAnchor?: 'start' | 'middle' | 'end';
  /** Tick-label text-anchor. Default: centred under an x tick, flush against a y
   *  axis. With a negative `tickPadding`, `'start'` on a left axis puts the labels
   *  inside the plot. */
  labelAlign?: 'start' | 'middle' | 'end';
  /** Px every label moves along the axis (x: right, y: down). */
  labelOffset?: number;
  /** Move the axis this many px away from the plot. */
  offset?: number;
  /** Also emit a paired gridline element; an object styles it. */
  grid?: boolean | GridOptions;
  handleSize?: number;
  handleColor?: string;
}

/** A per-tick axis option: called with the tick's value and index. */
export type AxisTickFn<T> = (value: any, index: number) => T | undefined;

/** `elements.grid` / `gridX` / `gridY`. Paint defaults to the theme's `grid` tokens. */
export interface GridOptions extends ElementOptionsBase {
  channel?: 'x' | 'y';
  ticks?: number | any[];
  tickValues?: any[];
  /** Line colour, or per line `(value, index) => colour`. */
  stroke?: string | AxisTickFn<string>;
  strokeWidth?: number | AxisTickFn<number>;
  /** Dash pattern ('4 4', '1 3'), or per line — a dashed grid with solid Januaries. */
  strokeDash?: string | AxisTickFn<string | null>;
  opacity?: number;
  /** An emphasised line at 0 on a continuous scale: `true` for the theme's
   *  `grid.zero` style, an object for its own, `false` for none. */
  zero?: boolean | { stroke?: string; strokeWidth?: number; strokeDash?: string };
  /** On a band axis, where in each band a line sits: 0 its start edge (lines
   *  between the categories), 0.5 its centre (default), 1 its end. */
  bandPosition?: number;
}

/** `elements.legend` / `legendColor` / `legendSize` / `legendSymbol` — the
 *  presentation half is `LegendOptions`, the same object a channel's `legend:` takes. */
export interface LegendElementOptions extends ElementOptionsBase, LegendOptions {
  channel?: string;
}

/** `elements.axisRadial`. */
export interface AxisRadialOptions extends ElementOptionsBase {
  /** Optional per-row PLACEMENT channels (x/y/fill) for one ring per row — the one
   *  documented exception to "an element has no channel map". */
  channels?: Channels;
  radius?: number;
  innerRadius?: number;
  bandWidth?: number;
  ticks?: number | any[];
  tickValues?: any[];
  tickFormat?: Format;
  tickSize?: number;
  labelOffset?: number;
  /** Coloured categorical bands around the ring. */
  bands?: any[];
  title?: string;
  /** The sweep: a named arc, or its side, or explicit start/end degrees. */
  arc?: string;
  orient?: 'top' | 'right' | 'bottom' | 'left';
  start?: number;
  end?: number;
  labelFill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
}

/** Any element's options — for a caller holding an element of unknown kind. */
export type ChartElementOptions = AxisOptions | GridOptions | LegendElementOptions | AxisRadialOptions;

export interface ChartElement {
  build(
    currentData: Datum[],
    scales: ScaleMap,
    width: number,
    height: number
  ): FeatureNode[];

  /** Always 'scale' — that is what makes it an element rather than a data mark. */
  views: 'scale';
  /** The single scale it draws, by channel name. */
  channel: string;
  /**
   * Placement-only channel map (`axisRadial` small-multiple rings). Not a
   * data-mark encoding surface — see the exception note above.
   */
  channels?: Channels;
  /** Which kind, for the checks that genuinely need to tell them apart. */
  isAxis?: boolean;
  isGrid?: boolean;
  isLegend?: boolean;

  id?: string;
  /** Which element keyword built it (`'axis'`, `'grid'`, `'legend'`, `'axisRadial'`). */
  type?: string;
  /** The element's edits (edit.axis.*, edit.legend.*), already flattened to a list. */
  edits?: Edit[];
  /**
   * The COLUMN an edit on this element writes, when the element pins one. Read by
   * `resolveChannels` ahead of the emergent `scale.fields[0]`.
   */
  field?: string;
  /**
   * The TABLE that column is in, by NAME. Unset, the engine's binding pass gives
   * the element the structure's primary table (it declares no `tableRole`).
   */
  table?: string;
  /** Paint order ('background' puts it under the data marks). */
  layer?: string;
  /** Space-reserving elements only: measure, and the band the engine stamped. */
  measure?(scales: ScaleMap): { width: number; height: number } | null;
  anchor?: 'top' | 'right' | 'bottom' | 'left';
  orient?: 'horizontal' | 'vertical';

  [key: string]: any;
}

/**
 * One entry of `Mark.requires`: a scale capability some channel(s) must have for
 * the mark's geometry to mean anything.
 */
export interface MarkRequirement {
  /** The channels this applies to, e.g. ['x', 'y']. */
  channels: string[];
  /** The capability needed. Matched against `scale.kind`, never `scale.type`. */
  kind: 'discrete' | 'band' | 'point' | 'continuous';
  /** 'all' (default) — every channel must satisfy it; 'any' — at least one.
   *  Named `match`, not `mode`: `mode` already meant five other things across the
   *  public surface, none of them compatible with this one. */
  match?: 'all' | 'any';
  /** Why the mark needs it; appended to the dev warning. */
  why?: string;
}

// What a joining mark gets as build()'s fifth argument. Read-only.
export interface MarkBuildContext {
  // Every table's committed rows, keyed by table NAME.
  tables: Record<string, Datum[]>;
  // The canonical schema, so a mark can find another table by ROLE (`byRole.nodes`)
  // and read its key column — never by hard-coding a name the author may have changed.
  schema: SchemaSpec;
  // Which table THIS mark is drawing, already resolved (an explicit `table`, else
  // the one filling the mark's `tableRole`).
  table: string;
  // Present only in a GHOST build of a proposal: where the pointer is, so a mark
  // can draw a proposal's free end there — a link being drawn with no target yet.
  // Absent in every committed build, which is how a mark knows a row whose
  // reference resolves to nothing is a half-made proposal and not bad data.
  ghost?: { pointer?: { x: number; y: number } };
  // The node table's box rule (see `Mark.nodeBox`), or null when no mark drawing
  // the nodes declares one. What `link` docks to and routes around.
  nodeBox?: NodeBoxRule | null;
  // The node table's ports rule: which edges of one node row a link may leave or
  // enter by (from a node mark's `ports` channel), or null when no node has ports.
  // An end on a node with ports meets it at a port.
  nodePorts?: ((row: Datum, index: number, rows: Datum[]) => Record<string, 'out' | 'in' | 'both'> | null) | null;
}

export interface Mark {
  /**
   * The one required method: emit this mark's scene nodes for the current rows.
   * Resolve every position/style through encodeChannel / resolveStyle.
   */
  build(
    currentData: Datum[],
    scales: ScaleMap,
    width: number,
    height: number,
    // The rest of the dataset, for a mark whose geometry JOINS to another table —
    // `link` resolves an edge's endpoints in the node table. Optional and additive:
    // every other mark takes four parameters and ignores this one.
    context?: MarkBuildContext
  ): FeatureNode[];

  /**
   * Which TABLE of the dataset this mark is a view over, by NAME. Omitted, the mark
   * takes the table filling its `tableRole` — which is how a spec that renamed its
   * tables needs no `table:` written anywhere. Ignored on a single-table chart.
   */
  table?: string;
  /** `false`: this mark's nodes escape the chart's clip (MarkOptions.clip). */
  clip?: boolean;
  /** `true`: this mark's nodes ease to where they belong (MarkOptions.motion). */
  motion?: boolean;
  /**
   * The ROLE whose table this mark draws when it states no `table`. Set by the mark
   * factory, not the author: `link` declares `'links'`, everything else leaves it
   * unset and gets the structure's primary table.
   */
  tableRole?: string;

  /** The channel map — also the source resolveScales reads to build scales. */
  channels?: Channels;
  /** Author-supplied id. Optional, so dev messages fall back to `type`. */
  id?: string;
  /** Mark-level (joint / arbitrary) edits; channel-level ones live on the channel. */
  edits?: Edit[];

  /**
   * What this mark needs from a DISCRETE axis: 'band' (bar/tick — an interval) or
   * 'point' (dot/line — a tick). A mark that merely spans leaves it undefined so a
   * composite can stamp its own.
   */
  discreteScale?: 'band' | 'point';
  /**
   * Channels the mark resolves ITSELF, with no scale — `resolveScales` skips them.
   * For a channel naming a column of a table this pass cannot see, or a literal
   * the mark interprets itself (`link`'s `sourceSide`, a node's `ports`),
   * resolution would otherwise build a scale nothing reads.
   */
  rawChannels?: string[];
  /**
   * The rectangle this mark draws for one ROW, in scene pixels — a pure function of
   * the row, never of built nodes. Declared by a mark that can draw a NODE (`point`
   * its radius, `rect` its extent, and so a `sticker`'s body). The engine hands the
   * rule of the mark drawing a network's nodes to `link`, to the `ports` a node
   * mark carries, and to the network edits, so a link end, a port and a drop target
   * cannot disagree about where an edge is.
   */
  /**
   * This mark's box is a LABEL's (`text`): it can be a node on its own (an emoji),
   * but beside a shape over the same rows — a `node()`'s dot, a glyph's body — the
   * shape is the node. The engine and `composite` pick a box from a mark without
   * this flag first.
   */
  labelBox?: boolean;
  /**
   * Optional sugar option forwarded from `MarkOptions.contains`, consumed once at
   * chart assembly (`desugarContains`) and deleted from the feature.
   */
  contains?: MarkContainsOption;
  nodeBox?(
    row: Datum,
    index: number,
    rows: Datum[],
    scales: ScaleMap,
    width: number,
    height: number
  ): NodeBox | null;
  /** Value field names the edit/constraint layer reads back, derived from channels. */
  xKey?: string;
  yKey?: string;

  /**
   * Which mark keyword built this feature (`'bar'`, `'point'`, …) — stamped by the
   * factory, read by dev messages (`bar()` beats `mark "feature-3"`) and, later, by
   * the JSON layer to round-trip a spec. The ONE identity key: an edit's `type` is
   * its keyword too, and so is a constraint's and a guide's. It is a different
   * question from a channel's or a field's `type` (a MEASURE), which a feature
   * descriptor is never adjacent to.
   */
  type?: string;

  /**
   * The GLYPH this feature is a part of, stamped by `composite` on every feature it
   * desugars into (one key per composite call). Paint order only: a glyph is one
   * OBJECT, so `paintOrder` (core/scene.js) orders its group's nodes by ROW rather
   * than by part, and a later glyph covers an earlier one whole instead of one
   * sticker's label landing on the next sticker's paper. Nothing else reads it —
   * dispatch, picking and data are still per FEATURE.
   */
  glyph?: string;

  /**
   * What this mark needs from the resolved SCALES, checked once per render by the
   * engine (`warnScaleRequirements`).
   *
   * A mark declares a CAPABILITY (`kind`), never a scale type — the same rule the
   * rest of the engine follows. `match: 'all'` (the default) requires every listed
   * channel to satisfy it; `match: 'any'` requires at least one, which is how a mark
   * whose category axis is chosen at build time (waffle's orientation) states its
   * need. `why` is prose appended to the warning.
   *
   * This exists because the alternative is silent degradation: without a band scale
   * a waffle's blocks quietly become 20px wide, and without both continuous axes a
   * trend emits no nodes at all. Both still "render", which is the worst outcome for
   * a library whose output is someone's stated belief.
   */
  requires?: MarkRequirement[];

  /** Which screen direction this mark's COUNT axis runs along. Declared because
   *  `axisOf` is a static channel->axis map and cannot know a mark's orientation:
   *  the resolver accumulates this onto the count bucket (like `discreteScale`) and
   *  `channelRange` reads it. Set by `waffle`/`dotStack`.
   *
   *  It is resolved at FACTORY time, from the CHANNEL MAP — a counting mark binds
   *  exactly one positional channel, so the axis that channel sits on is the band
   *  and the count runs along the other. It cannot come from the scales in
   *  `build()`: this value is what gives the count scale its range, so it is read
   *  before any build runs, and a declaration that disagreed with what the mark
   *  then drew put every cell off the side of the frame. */
  countAxis?: 'x' | 'y';
  /** The px extent of a `radius` channel's scale — this polar mark's inner and
   *  outer radius (null outer = fit to the plot). Accumulated per bucket like
   *  `countAxis`, resolved by `radiusExtent` (core/encoding.js). */
  radiusRange?: { inner?: number | null; outer?: number | null };
  /** Pixels per token, for a mark whose count is DERIVED rather than encoded
   *  (`dotStack`: one row is one token, so there is no column). The resolver
   *  synthesises a linear count scale from it, which is exact because the pitch is
   *  uniform. A mark that encodes its count (`waffle`) leaves this unset — its
   *  scale comes from the `count` channel like any other. */
  countPitch?: number;
  /** Line-family series grouping: the FIELD name, resolved from the `series`
   *  channel (falling back to fill's / stroke's field) by `seriesFieldOf`. */
  seriesKey?: string | null;
  /** How points connect when no `order` channel is given: sort by the domain axis,
   *  or keep array order. WHICH column sorts them is the `order` CHANNEL — an
   *  option may never name one. */
  connect?: 'domain' | 'sequence';
  supportsSeries?: boolean;

  /** Capability flags the engine's scope guard reads (see SCOPE_CAPABILITY). */
  supportsGeo?: boolean;
  supportsWaffle?: boolean;
  // Does this mark partition a total among a group of rows — so a boundary between
  // two of them exists to cut, drag or merge? Set by arc/donut always, and by
  // `bar` only when it is actually stacking (an unstacked bar is a set of
  // independent lengths, with no boundary at all). Gates edit.stack.* via
  // SCOPE_CAPABILITY.
  supportsStack?: boolean;
  supportsTrend?: boolean;

  /**
   * What this feature is a view OF.
   *
   *   'data'  (default) — a data mark: its channels name COLUMNS of the dataset.
   *   'scale' — a GUIDE (axis, grid, legend): it draws a scale, not rows. It has
   *             no channel map and no fields of its own, so an edit attached to it
   *             recovers its target field from the scale instead.
   *
   * The distinction already existed, spelled as three separate booleans tested in
   * disjunctions across the engine (`isAxis || isGrid || isLegend`). Naming it lets
   * edit/route.js ask the question directly rather than inferring guide-ness from
   * an absent channel map.
   */
  // `'state'` on a mark is chrome that draws no dataset row (`geoBasemap`,
  // `geoTile`): no hover, selection, effect or ghost reaches it.
  views?: 'data' | 'scale' | 'state';

  /** Which guide, for the engine's more specific checks. Implies `views: 'scale'`. */
  isAxis?: boolean;
  isGrid?: boolean;
  isLegend?: boolean;

  /** Paint order hint ('background' puts a guide under the data marks). */
  layer?: string;

  /**
   * Open by design: a mark may carry extra fields a driver or the engine reads
   * (a legend's `measure`, a geo mark's projection hooks).
   */
  [key: string]: any;
}

export interface FeatureNode {
  type: 'circle' | 'ellipse' | 'rect' | 'line' | 'path' | 'text' | 'image';
  // Connecting-path geometry (line mark): the ordered pixel points and the curve
  // interpolation name (see the renderer's resolveCurve).
  points?: [number, number][];
  curve?: string;
  // Authored SVG path `d` (arcs, needles, pie slices). When set, the renderer
  // uses it instead of building a line from `points`.
  d?: string;
  cx?: number;
  cy?: number;
  r?: number;
  // Ellipse radii, in px. A circle is the rx === ry case, but is kept its own node
  // type: `r` is one number a `size` channel drives, and most marks want that.
  // On a RECT the same pair is the corner radius (`ry` defaults to `rx`) — both
  // readings are "a radius on x", and both are GEOMETRY: the renderer sets them in
  // its rect/ellipse geometry pass, never in the style sweep.
  rx?: number;
  ry?: number;
  x?: number;
  y?: number;
  x1?: number;
  x2?: number;
  y1?: number;
  y2?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeDasharray?: string;
  strokeLinecap?: "butt" | "round" | "square";
  strokeWidth?: number;
  opacity?: number;
  pointerEvents?: string;
  guide?: boolean;
  // Marks the node for the topmost paint layer (interaction overlays: proximity
  // ring, select outline). Drawn above marks and guides. See core/effects.js.
  effect?: boolean;
  // Marks the node for the background render layer (axes/gridlines), drawn behind
  // interactive marks by the renderer.
  background?: boolean;
  // Raster tile (geoTile): the image source, and the {z}/{x}/{y} identity the
  // renderer keys its data join on so an on-screen tile survives a re-render
  // without re-fetching.
  href?: string;
  key?: string;
  // The node's string content. On a WRAPPED label this stays the WHOLE string
  // while `lines` holds what is painted — which is what keeps the inline editor
  // (seeded from `text`, or from `editValue` on a typable node that paints none)
  // and an editText write working unchanged.
  text?: string;
  fontSize?: number;
  fontWeight?: string | number;
  textAnchor?: string;
  // Text mark: vertical anchor ('top'|'middle'|'bottom') and the SVG
  // dominant-baseline the mark derived from it; `editText` opts the node into
  // the renderer's inline content editor on dblclick.
  lineAnchor?: string;
  dominantBaseline?: string;
  // A WRAPPED label's painted lines, and the baseline step between them in px.
  // Deliberately one node carrying many lines rather than one node per line: a
  // second node sharing an `index` would mean a second tab stop, a second hit
  // area, and an effect outline around the first line only.
  lines?: string[];
  lineHeight?: number;
  // Orientation in math degrees (0° = +x, CCW). Any geometry node may carry it;
  // the renderer applies SVG rotate(-deg) about markCenter. Marks that bake
  // orientation into path geometry (needle) omit this to avoid double-rotating.
  // Anything drawn ABOUT a rotated node has to carry it too, or it lands at the
  // mark's unrotated position — that is why an effect outline copies it.
  angle?: number;
  // The interaction-EFFECT restyle for this node, written by the engine's state pass
  // (core/effects.js) from the states the node's datum is in: the merged
  // filter/opacity/fill/stroke/strokeWidth/cursor of `hovered`/`selected`/`grabbed`.
  // A renderer APPLIES it and decides nothing — as a CSS style property in SVG (so it
  // beats the presentation attributes the mark's own style channels write, and
  // removing it restores them), as a paint override on canvas. Absent on a node in no
  // state, which is what takes the effect off. Never a data channel: nothing in a
  // mark's build() writes this.
  effectStyle?: Record<string, any>;
  // The shape an effect OUTLINES for this node's datum, when the node is not it. A
  // waffle draws one row as a GRID of cells, so an outline derived from a node rings
  // one cell (the engine takes the first node with the datum's index — cell 0, at the
  // baseline) while the restyle half correctly lights the whole block. The mark is the
  // one that knows the block's geometry, so it states it: a plain geometry node
  // (`{ type: 'rect', x, y, width, height }` and the rest of outlineNodes' cases),
  // stamped on every node of the datum, padded and traced like any other. Not a data
  // channel and never a second paint — the effect vocabulary is unchanged.
  effectShape?: Record<string, any>;
  // Opts the node into the renderer's inline content editor on double-click. Set
  // by the engine's tagging pass for any node whose feature carries an `inline`
  // edit — one place decides, so a mark never has to sniff its own edit list.
  editText?: boolean;
  // What that editor OPENS WITH when the node paints no text of its own — the
  // engine's read of the column the inline edit writes, stamped by the same pass.
  // A sticker's typable surface is its BOX, whose string is drawn by a sibling
  // mark, so seeding from `text` alone opened the editor empty and turned every
  // double-click into a retype-from-scratch. `text` still wins where both exist.
  editValue?: string;
  // Where the inline editor should sit, in the node's own pixel space. A plain
  // data descriptor (the node.frame / node.stack / node.sector family), so a
  // sticker's editor fills its box instead of the renderer's 140px default.
  editBox?: { x: number; y: number; width: number; height: number };
  // The editor takes a <textarea> and Enter inserts a newline rather than
  // committing. A declared capability — never inferred from editBox's height.
  multiline?: boolean;
  data?: Datum;
  index?: number;
  featureId?: string;
  // Set by the engine when the node's feature has a direct-pick edit, so the
  // renderer shows an interactive cursor on it.
  editable?: boolean;
  // Answers the pointer for HOVER only (a node mark whose edit lives on its
  // ports, or any row's node when the chart's hover is row-wide): no cursor, no
  // drag, never a hit-test target. A press on it is routed as a plane gesture.
  hoverable?: boolean;
  // Set by the engine when the node's row is READ-ONLY (DatasetSpec.lock): the node
  // is never `editable`, is pointer-transparent, and proximity picking skips it. A
  // line's connector path is locked when every row of its series is.
  locked?: boolean;
  // Set by the engine's ghost pass on a probe PREVIEW node: an inert, dimmed copy of
  // the rows a proposal would change, layered over the committed marks. Never written
  // to featureNodes (picking/guides ignore it), never editable, pointer-transparent.
  // The D3 renderer stamps a `data-ghost` attribute so a test can find it.
  ghost?: boolean;
  // HIT-ONLY: the node paints nothing and exists to be grabbed — a composite's box
  // draws one over the whole glyph so an edit on the composite's own x/y/size has
  // something to take hold of. Tagged `data-hit` by the D3 renderer, so a selector
  // can tell it from a part it sits under.
  hit?: boolean;
  // A ROW HANDLE: a node the mark draws only so its row can be grabbed (a line's
  // vertex dot, a band's edge dot, a trend's grips), never the data's own ink. The
  // engine drops it from the scene wherever no ACTIVE edit can reach the row — a
  // locked or context row, or a stage whose edits are not yet live — so a dot is
  // never drawn that a drag cannot move. The mark's own shapes (a point's circle,
  // a bar's rect) are not row handles: they ARE the data and always draw.
  rowHandle?: boolean;
  // Runtime tags set by marks for the pick/driver layer: `series` groups a line's
  // nodes; `sweepAxis`/`bandAxis` name the axis proximity measures along; `cursor`
  // sets a handle's cursor over the one the edits imply (e.g. a needle's grab); `channel` tags one
  // of a mark's several handles, so that handle's edit `when` claims only this node.
  // Needed only when one FEATURE emits multiple handles over one datum — see
  // plot/trend.js (intercept vs slope). Marks split across features don't need it:
  // direct-pick dispatch already routes a gesture to the touched node's feature.
  series?: any;
  sweepAxis?: 'x' | 'y';
  bandAxis?: 'x' | 'y';
  channel?: string;
  cursor?: string;
  // A port's edge (`plot/port.js`), read by `edit.network.connect` as the side the
  // drag started on, and which way a link may use it: 'out', 'in' or 'both'.
  side?: string;
  portRole?: 'out' | 'in' | 'both';
  // Paint above every other node, and take pointer events only while lit. A
  // link's end handle sits on a node's edge, so it must draw over the node — and,
  // hidden, must not swallow a press meant for the port beneath it.
  raise?: boolean;
  // Painted only while its row is LIT — hovered, grabbed or selected in any feature
  // over the same table, or named by the feature's own session. The engine's state
  // pass hides an unlit node with `effectStyle.opacity = 0`; it stays in the scene
  // with its pointer events, so it can be hovered into view.
  onHover?: boolean;
  // The per-datum LOCAL scales this node was encoded through, stamped by
  // plot/composite.js on every node a framed part emits. The engine overlays them on
  // the global map when resolving an edit's channels, so a gesture inverts through
  // the same mapping that drew the node (see frameScalesFor in core/elicit.js).
  frame?: ScaleMap;
  // The STACK this node belongs to, stamped by any mark that partitions a total
  // among its rows (a `bar` with `stack`, arc/donut — see plot/stack.js). Same
  // idea as `frame`: the mark that encoded the layout carries the means to invert
  // it, so edit.stack.* works on both marks without knowing which it is on.
  //   members  the group's rows, as global dataset indices in stack order
  //   local    this node's position within members
  //   field    the magnitude column
  //   geometry how a pointer becomes a position along the stack — pure data,
  //            { kind: 'linear', axis } or { kind: 'angular', cx, cy, spanStart,
  //            spanEnd, pad }. Never a closure: a commit re-renders, so an edit
  //            re-derives the shares from the live dataset every tick.
  stack?: {
    members: number[];
    local?: number;
    field?: string;
    geometry?: any;
  };
  // True on a node a boundary drag grabs (edit.stack.edge / .merge), as opposed to
  // a segment body (which edit.stack.cut divides). Paired with `loIndex`/`hiIndex`,
  // the two rows the boundary separates.
  edge?: boolean;
  loIndex?: number;
  hiIndex?: number;
  // Filled-region hit geometry for an annular sector, stamped by `arc`. The pick
  // layer measures distance to a path's polyline, which a bare `d` string has none
  // of — so without this a slice BODY is unclickable under the canvas renderer
  // (SVG hit-tests the filled shape in the DOM and never needed it).
  sector?: { cx: number; cy: number; r0: number; r1: number; a0: number; a1: number };
  // A geo region's shape in lon/lat (geoPolygon), for pointer reads through the projection.
  geoShape?: any;
  // The geo region's projected rings, parsed from `d` on first pointer read.
  geoRings?: [number, number][][];
  // The row behind each vertex of a path (line, area), so a pointer read names the nearest row.
  pointRows?: number[];
  // A filled path whose `points` is its outline polygon (a shape mark): the pick
  // layer tests containment, and `cx`/`cy` is its centre.
  polygon?: boolean;
  // How a `shape`'s path was made from its centre: the unit outline, the radius
  // and the angle. With it the engine can draw the shape somewhere else, which is
  // what lets a mark with `motion: true` ease a path.
  placed?: { unit: { segments: any[] }; r: number; angle: number };
  // A guide rect that sits ABOVE the marks (a tip's box) rather than behind them.
  front?: boolean;
  // Escapes the mark clip (`ChartSpec.clip`): stamped by the engine on every node
  // a chart element draws (an axis handle on the plot edge, a legend swatch).
  unclipped?: boolean;
  // Drawn by `looks.rough()` in place of a shape: inert, and never redrawn again.
  rough?: boolean;
  // A gradient fill (a mark's `gradient` option), painted by the renderers as a
  // <linearGradient> / createLinearGradient over the node's own box.
  fillGradient?: GradientSpec;
  // A picture painted inside the node's shape in place of its fill (the `image`
  // channel, `guides.image`). An effect's fill still wins.
  fillImage?: FillImage;
  [key: string]: any;
}

// Per-feature transient interaction state a driver keeps in ui.session[featureId]
// (proximity selection, sweep/draw locks). Read by guides to draw the snap ring +
// highlight and by an edit via ctx.session. All fields optional/driver-set.
export interface Session {
  px?: number;
  py?: number;
  threshold?: number;
  hoverIndex?: number | null;
  activeIndex?: number | null;
  series?: any;
  // draw driver: the locked mode + series and the pointer/domain trail.
  mode?: 'edit' | 'draw';
  drawSeries?: any;
  // draw driver: a fresh freehand stroke CONTINUES the last unlocked line rather
  // than starting one; the edit resolves the key on its first tick.
  drawContinue?: boolean | null;
  // geo draw: index of the row whose coordinates list is being authored this stroke.
  drawIndex?: number | null;
  lastDomain?: any;
  lastX?: number | null;
  lastY?: number | null;
  // sweep driver: the EDGE (a handle's `channel`, y1/y2) a band sweep locked
  // onto at dragstart, so each tick paints that edge alone. Set on hover too (the
  // edge a press there WOULD lock), so the engine's hover effect outlines that
  // edge's handle rather than the row's first node.
  channel?: string | null;
  // brush driver: the dragstart-locked grab zone (+ which field an edge zone
  // targets), forced to 'canonicalize' for the one-time dragend cleanup tick.
  zone?: 'edgeA' | 'edgeB' | 'body' | 'canonicalize' | 'corner' | 'edgeX' | 'edgeY' | 'edge' | null;
  field?: string | null;
  // brushRect driver: the field(s) an edge/corner grab locked (1 for an edge,
  // 2 for a corner). The 2-D sibling of `field`.
  fields?: string[] | null;
  // geoBrush driver: which geographic edge(s) the grab locked, plus the anchor it
  // latched at dragstart — the pointer's lon/lat and the box as it stood then, so
  // a body move translates by the geographic delta instead of recentering.
  edges?: string[] | null;
  grab?: { lon: number; lat: number } | null;
  box0?: { west: number; south: number; east: number; north: number } | null;
  // axisDrag driver: the dragstart-locked handle for an editable numeric axis —
  // which end is grabbed, the axis it runs along, the opposite (anchored) end's
  // pixel + value, the grabbed end's starting pixel + value, and (grow mode) the
  // pixels-per-data-unit held constant while the chart resizes.
  grabEnd?: 'min' | 'max';
  axis?: 'x' | 'y';
  anchorPixel?: number;
  anchorValue?: any;
  grabPixel?: number;
  grabValue?: any;
  pxPerUnit?: number;
  cursor?: string;
  // pan driver: the pointer at the previous tick; each tick pans by the travel
  // since, so a wheel zoom mid-drag composes.
  panFrom?: { x: number; y: number } | null;
  // slide driver (relative mode): the dragstart-locked target datum, plus one
  // frozen anchor per edit — the grab pixel on that edit's axis and the datum's
  // value when the grab began, which is what the value moves relative to (no jump
  // on grab). Keyed by `${axis}:${field}` (edit/basic.js: slideAnchorKey) so two
  // relative slides on one feature (an eye's rx and ry) keep separate anchors.
  index?: number | null;
  slide?: Record<string, { startPx: number, startValue: number }>;
  // move driver (relative mode): the same snapshot, under ONE key so dragend can
  // null it without wiping a co-resident driver's state (a sticker carries both a
  // relative move and edit.network.connect). Anchors are keyed by FIELD — one move
  // edit owns both axes of one datum, and a field sits on exactly one of them —
  // and `startPx` is the grab pixel on that field's own axis (axisOf the channel).
  move?: { index: number, anchors: Record<string, { startPx: number, startValue: any }> } | null;
  // connect driver (edit.network.connect / rewire): the row the drag began on, the
  // port side it began at (null on a body), the press point — a release back on the
  // starting node is a loop only once the pointer has left it — and the drop keys
  // the engine's trial commits found reachable.
  fromIndex?: number | null;
  fromSide?: string | null;
  fromPoint?: { x: number, y: number } | null;
  targets?: string[] | null;
}


// Interaction-effects layer: transient visual feedback for interaction STATE,
// kept separate from mark style channels and customizable per chart. Three states —
// `hovered`, `selected`, `grabbed` — each taking the same paint vocabulary. See
// EffectsSpec below and core/effects.js.
// Recursively-optional version of a type: what a caller MAY pass. `spec.theme`,
// `setTheme()`, and the built-in `themes` are DeepPartial<Theme> — they name only
// the tokens they change; resolveTheme deep-merges them over DEFAULT_THEME to a full
// Theme. (Arrays are values, replaced wholesale, so they are not descended into.)
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * The built-in themes, by name (`themes[name]`, or `theme: name` on a spec).
 * `default`, `survey` and `dark` are ElicitJS's own; the other fourteen are the
 * named house styles of Flint (https://github.com/microsoft/flint-chart),
 * transcribed from its presets.
 */
export type ThemeName =
  | 'default' | 'survey' | 'surveyBlocks' | 'surveyLines' | 'dark' | 'dd'
  | 'nyt' | 'economist' | 'swiss' | 'nature' | 'mckinsey' | 'datawrapper'
  | 'powerbi' | 'powerbiLight' | 'pop' | 'cartoon' | 'apple' | 'deStijl' | 'bbc' | 'material';

/**
 * What a chart (or `setTheme`) may pass as its theme: a built-in theme's NAME, or
 * a partial that deep-merges over the default — and may start from a named theme
 * with `extends` (Flint's word for the same idea).
 */
export type ThemeSpec = ThemeName | (DeepPartial<Theme> & { extends?: ThemeName });

/**
 * How the survey widgets are drawn: the value of `theme.widget.design`. The four
 * built-in designs, or the name of one registered with `authoring.registerDesign`.
 */
export type WidgetDesignName = 'ring' | 'box' | 'block' | 'line' | (string & {});

/** The widget tokens (`theme.widget`): the design, then the colours and sizes it reads. */
export interface WidgetTokens {
  /** How the widgets are drawn. Default `'ring'`. */
  design: WidgetDesignName;
  /** A committed answer. */
  accent: string;
  /** Text and ticks drawn on the accent. */
  onAccent: string;
  /** A chosen option's wash. */
  tint: string;
  /** An option box, a card. */
  surface: string;
  /** A filled block, a bar's track. */
  soft: string;
  /** The edge of a box or a card. */
  stroke: string;
  /** An empty option. */
  ring: string;
  track: string;
  cellFill: string;
  cellStroke: string;
  label: string;
  question: string;
  /** A card's drag handle. */
  grip: string;
  /** Under a lifted card. */
  shadow: string;
  labelSize: number;
  questionSize: number;
  questionWeight: number | string;
  /** A list row's or a card's text size. */
  itemSize: number;
  /** A ring's or a radio's radius. */
  radius: number;
  /** A box's, block's or card's corner radius. */
  corner: number;
  /** The space between options and between cards. */
  gap: number;
  /** The height of an option in a row of boxes. */
  optionHeight: number;
  /** The height of a list row or a card. */
  rowHeight: number;
}

/** The box a design draws one part in, in plot pixels. */
export interface DesignBox {
  x: number; y: number; width: number; height: number;
  /** The box's centre. */
  cx: number; cy: number;
}

/** One option handed to `WidgetDesign.option`. */
export interface DesignOption extends DesignBox {
  label: string;
  selected: boolean;
  /** One answer (`'radio'`) or several (`'check'`). */
  control: 'radio' | 'check';
  /** A row of options, a stacked list, or a matrix cell (no label). */
  layout: 'row' | 'list' | 'cell';
  /** The option's place among its siblings. */
  index: number;
  count: number;
  /** The next option's centre in a row, or null for the last. */
  next: { cx: number; cy: number } | null;
  /** How far under a ring its label sits (`guides.options({ labelOffset })`). */
  labelOffset: number;
}

/** Where a design puts the answer's ink inside an option. */
export interface DesignAnswer {
  /** A dot or a square on the control, or a block that fills the option. */
  shape: 'dot' | 'square' | 'block';
  /** A dot's radius, or half a square's side. */
  size?: number;
  /** The ink's distance from the option's left edge; unset, its centre. */
  left?: number;
  /** The ink's distance from the option's top edge; unset, its centre. */
  top?: number;
  /** A square's or a block's corner radius. */
  corner?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/** One part of a ranking card (`WidgetDesign.card`), placed from the card's left or right edge. */
export interface DesignCardPart {
  /** `body` is the card and takes the drag; the others are drawn on it. */
  part: 'body' | 'badge' | 'rank' | 'label' | 'grip';
  /** Distance of the part's anchor from the card's left edge. */
  left?: number;
  /** Distance from the card's right edge, in place of `left`. */
  right?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** `body`: the corner radius. `badge`, `grip`: the radius. */
  size?: number;
  fontSize?: number;
  fontWeight?: number | string;
  textAnchor?: 'start' | 'middle' | 'end';
  /** `grip`: `'dots'` (the default), `'bars'`, an SVG path or a shape name. */
  path?: string;
  /** `body`: its look while the pointer is over it, and while it is dragged. */
  hovered?: Record<string, any>;
  grabbed?: Record<string, any>;
}

/**
 * A widget design: how each part of the survey widgets is drawn. Every member is
 * optional; a design that `extends` another takes the rest from it. Drawers
 * return scene nodes (`rect`, `circle`, `line`, `text`, `path`) in plot pixels.
 * Register one with `authoring.registerDesign(name, design)` and name it in
 * `theme.widget.design`.
 */
export interface WidgetDesign {
  /** The design this one starts from. Default `'ring'`. */
  extends?: WidgetDesignName;
  /** Does multiple choice stack its options as a list (`true`) or run them in a row? */
  list?: boolean;
  /**
   * Does each option fill its cell (`true`), so the widget sizes the plot to the
   * options from `optionHeight`, `rowHeight` and `gap`? Or do options sit on the
   * plot's centre line (`false`, the `ring` look)?
   */
  tiles?: boolean;
  /** The chrome of one option: its box, its control, its label. */
  option?: (option: DesignOption, tokens: WidgetTokens) => FeatureNode[];
  /** The answer's ink inside an option. */
  answer?: (option: Pick<DesignOption, 'control' | 'layout' | 'width' | 'height'>, tokens: WidgetTokens) => DesignAnswer;
  /** Chrome around a whole matrix: a frame, the lines between its rows. */
  grid?: (grid: DesignBox & { rows: number[]; columns: number[] }, tokens: WidgetTokens) => FeatureNode[];
  /** A slider's track. `at` is the value's pixel, or null with no value. */
  track?: (track: { x1: number; x2: number; y: number; at: number | null }, tokens: WidgetTokens) => FeatureNode[];
  /** A slider's handle. */
  thumb?: (tokens: WidgetTokens) => { size: number; fill: string; stroke?: string; strokeWidth?: number };
  /** A ranking card's parts, back to front. */
  card?: (card: { width: number; height: number }, tokens: WidgetTokens) => DesignCardPart[];
  /** Chrome behind a ranking list: the lines between its slots. */
  slots?: (list: DesignBox & { rows: number[] }, tokens: WidgetTokens) => FeatureNode[];
  /** How a bar is drawn in the widgets that sit on chart axes. */
  bar?: (tokens: WidgetTokens) => { corner?: number; fillOpacity?: number; track?: boolean };
  /** A named theme to register with the design, so `theme: name` selects it. */
  theme?: DeepPartial<Theme> & { extends?: ThemeName };
}

/** A design with its `extends` chain folded in: every part is there. */
export type ResolvedWidgetDesign = Required<Omit<WidgetDesign, 'extends' | 'theme'>>;

/** A title part's typography (`theme.title` / `subtitle` / `caption`). */
export interface TitleTokens {
  fill: string | null;
  fontSize: number;
  fontWeight: string | number;
  /** null inherits `font.family`. */
  fontFamily: string | null;
  fontStyle: string | null;
}

/** The axis tokens — each also an `axis()` option of the same name. */
export interface AxisTokens {
  stroke: string;
  labelFill: string;
  fontSize: number;
  handle: string;
  /** Spine (and tick) width. */
  strokeWidth: number;
  /** Draw the spine. */
  line: boolean;
  /** Tick length in px; 0 draws none. */
  tickSize: number;
  /** Gap from a tick's end to its label, in px. */
  tickPadding: number;
  /** Tick-label rotation, math degrees (counter-clockwise). */
  labelAngle: number;
  fontFamily: string | null;
  fontWeight: string | number | null;
  /** null takes `labelFill`. */
  titleFill: string | null;
  /** null is `fontSize + 1`. */
  titleFontSize: number | null;
  titleFontWeight: string | number | null;
  /** Extra px between the tick labels and the title. */
  titlePadding: number;
  /** The title's place along the axis; 'end' is the right of x, the top of y. */
  titleAnchor: 'start' | 'middle' | 'end';
  /** A tick label's text-anchor; null is the side's own. */
  labelAlign: 'start' | 'middle' | 'end' | null;
  /** Px every label moves along the axis. */
  labelOffset: number;
}

// The STYLE layer: default colours, fonts, and affordance tokens the library draws
// with. This is the RESOLVED shape (every container present, as DEFAULT_THEME
// provides), read by marks (default ink), chrome (axis/grid/guides), the renderers
// (font family, base fallbacks), and the survey-widget affordances. A per-mark
// channel/option still wins over any theme token. Callers pass a DeepPartial<Theme>.
export interface Theme {
  // The primary mark colour (marks that historically defaulted to 'steelblue').
  ink: string;
  // Interactive emphasis: draggable handles, a committed answer, an axis handle.
  accent: string;
  /** Draggable-handle ink and its legibility halo, shared by every mark that draws one. */
  handle: string;
  handleStroke: string;
  // Secondary chrome / de-emphasised marks.
  muted: string;
  // The chart backdrop, applied as the svg/canvas CSS background (covers the margin
  // band too). null = transparent (the default — the host page shows through); a
  // dark theme sets it so a dark-mode chart is self-contained.
  background: string | null;
  // Colour-scale defaults fed to resolveScales when a channel names no range/scheme.
  palette: string[];
  ramp: string[];
  diverging: string[];
  // Typography. `family` null => inherit the host page's font (the default look);
  // a non-null family is emitted on the root svg / used by the canvas renderer.
  font: { family: string | null; size: number; labelSize: number; titleSize: number };
  // Chart chrome.
  // Chart titles (spec.title / subtitle / caption). A null fill takes the axis label ink.
  title: TitleTokens;
  subtitle: TitleTokens;
  caption: TitleTokens;
  /** Axis chrome, with per-kind overrides read off the scale's `kind`. */
  axis: AxisTokens & { discrete: Partial<AxisTokens>; continuous: Partial<AxisTokens> };
  /**
   * Gridlines. `show` says which IMPLICIT axes get a grid the spec did not ask
   * for: 'none' (the default); 'value', the axis the value runs along (the
   * continuous one, y when both are); 'continuous', every continuous axis; 'all'.
   * `zero` draws an emphasised line at 0 on a continuous grid.
   */
  grid: {
    stroke: string;
    strokeWidth: number;
    strokeDash: string | null;
    opacity: number | null;
    show: 'none' | 'value' | 'continuous' | 'all';
    zero: { stroke?: string; strokeWidth?: number; strokeDash?: string | null } | null;
    /** A band axis's gridlines at this fraction of each band; null is the centre. */
    bandPosition: number | null;
  };
  /** The plot area's own surface (`background` covers the margins too) and frame. */
  panel: { fill: string | null; stroke: string | null; strokeWidth: number };
  /** Inner padding of a band scale, as a fraction of its step (default 0.1). */
  bandPadding: number;
  // Annotation guides (guides/*) plus edit-guide part tokens (edit/guide.js).
  guide: {
    rule: { stroke: string; strokeDash: string; strokeWidth: number; opacity: number };
    region: { fill: string; opacity: number };
    legend: {
      stroke: string;
      labelFill: string;
      fontSize: number;
      /** Rings the swatch(es) the target row(s) currently hold — also the unarmed-state signal. */
      currentStroke?: string;
      currentWidth?: number;
      /** Discrete swatch size and the gap between items, px. */
      swatchSize?: number;
      gap?: number;
      /** Corner radius of a colour chip; `swatchSize / 2` is round. */
      swatchRadius?: number;
      titleFontWeight?: string | number | null;
    };
    /** Edit-guide parts — merged under GUIDE_PARTS, under per-edit overrides. */
    bounds?: GuidePartStyle;
    catchment?: GuidePartStyle;
    track?: GuidePartStyle;
  };
  // The constraint-guide colour (a per-edit `guide: { color }` still wins).
  constraint: { color: string };
  // Interaction-effects defaults, merged UNDER spec.effects.
  effects: EffectsSpec;
  // Ghost-preview styling (probe driver): a ghost multiplies its opacity by
  // `opacity`; a non-null fill/stroke/strokeDash overrides the committed paint.
  ghost: { opacity: number; fill: string | null; stroke: string | null; strokeDash: string | null };
  // Survey-instrument tokens: the design the widgets are drawn in, and the
  // colours and sizes it reads (widgets/designs.js).
  widget: WidgetTokens;
  // The `ui` layer's chrome: menus, icon buttons and handles laid over the chart.
  ui: UiTheme;
  // Sparse per-mark default overrides, keyed by mark name (e.g. { bar: { fill } }).
  marks: Record<string, Record<string, any>>;
}

/**
 * Per-part paint for an edit's self-drawn guide (`edit.guide`). A GUIDE shows a
 * RULE (what you may do); an EFFECT shows interaction STATE. See edit/guide.js.
 */
export interface GuidePartStyle {
  color?: string;
  dash?: string;
  width?: number;
  opacity?: number;
  bandOpacity?: number;
  fontSize?: number;
  labelOpacity?: number;
  tickLength?: number;
  tickOpacity?: number;
}

/**
 * Object form of `edit.guide`. `true` on a part (or omitting a part under
 * `guide: true`) uses the library defaults for that part.
 */
export interface GuideSpec {
  /** Constraint boundaries on the edit's value channel (clamp/snap/maintainSum). */
  bounds?: boolean | GuidePartStyle;
  /** Proximity snap ring — only drawn by drivers that select a target. */
  catchment?: boolean | GuidePartStyle;
  /** Where a handle can travel (`node.dm`); opt-in even under `guide: true`. */
  track?: boolean | GuidePartStyle;
  /** Base colour for every part (part-level color still wins). */
  color?: string;
}

/**
 * Interaction-feedback states. Every state takes the SAME vocabulary (EffectStyle),
 * and every property of it works in both renderers, whichever way the state arose —
 * a pointer over a mark and a proximity driver resolving that same row both paint
 * `hovered` identically.
 *
 * Two mechanisms, decided in the engine's state pass, never by a renderer:
 *   · `outline` draws an OVERLAY node (`effect: true`) — the one part that needs
 *     geometry the mark hasn't got (padding outside the shape). It copies the mark's
 *     `angle`, so it tracks a rotated mark.
 *   · everything else RESTYLES the mark's own node, arriving as `FeatureNode
 *     .effectStyle` and applied as a CSS style PROPERTY (never a presentation
 *     attribute, which would wipe the mark's own stroke). It is the mark's node, so
 *     it is aligned with the mark by construction.
 * A copy-on-top was the alternative for the second half and cannot express it: you
 * cannot dim a mark by drawing over it.
 *
 */
// Eased drawing (`spec.motion`).
export interface MotionSpec {
  // Time a change takes to settle, in ms. Default 220. 0 draws every change at once.
  duration?: number;
}

export interface EffectsSpec {
  /** Pointer is over / proximity has selected this mark. */
  hovered?: false | string | HoveredEffectStyle;
  /** Row is in `ui.selection`. */
  selected?: false | string | EffectStyle;
  /** Where the thing being dragged would LAND if released now — a container of a
   *  hierarchy about to take the node in flight. */
  target?: false | string | EffectStyle;
  /** An active drag is holding this mark. */
  grabbed?: false | string | EffectStyle;
}

// The `hovered` state also says whether this chart's hover is the dataset's.
export interface HoveredEffectStyle extends EffectStyle {
  /** `true`: the row hovered here is hovered in every linked chart of the dataset,
   *  and theirs here. `'receive'`: this chart shows the others' hover and sends
   *  none. `false`: hover stays in this chart. Default: `true` when two or more
   *  charts draw the dataset, else `false`. A linked hover lights the row in every
   *  mark over its table, on view-only marks too, and fades the other rows unless
   *  `others` says otherwise. */
  link?: boolean | 'receive';
}

/**
 * Paint vocabulary for one effect state. The first six RESTYLE the mark's own node;
 * `outline` adds a padded overlay around it. Both halves work for every state.
 * Together they are the state's HIGHLIGHT: how rows in the state look. `others` is
 * the MUTE: how the remaining rows look meanwhile.
 * `filter` and `cursor` are SVG-only (a canvas has no element to hover and no
 * per-shape filter); everything else paints in both renderers.
 */
export interface EffectStyle {
  filter?: string | null;
  opacity?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cursor?: string;
  outline?: {
    /** `'auto'` (default): the mark's own fill — or its stroke when the fill is
     *  missing or near-white — darkened by `darken`. `'fill'` / `'stroke'` pick that
     *  paint. A CSS colour is used as is. A function `(color, node) => string`
     *  receives the darkened mark colour and returns the one to paint. */
    color?: 'auto' | 'fill' | 'stroke' | (string & {}) | ((color: string, node: any) => string);
    /** How much darker than the mark a derived colour is (d3 `color.darker(k)`);
     *  negative lightens. Ignored for a fixed colour. Default 0.6 hovered, 1.5 selected. */
    darken?: number;
    /** The colour when no paint can be read off the mark (a gradient, none). */
    fallback?: string;
    width?: number;
    /** Gap between the mark's edge and the outline, px. 0 (default) traces the edge. */
    pad?: number;
    // A text label is outlined only when the spec sets `outline`, as a box around it.
    dash?: string | null;
    opacity?: number;
  };
  /** The mute: a restyle for rows in NO state, while this state has at least one
   *  row in their table. `false` turns it off. Unset: nothing, except a linked
   *  hover, which fades the other rows (`{ opacity: 0.3 }`). */
  others?: false | {
    filter?: string | null;
    opacity?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  };
  /** NETWORK AND HIERARCHY DATASETS ONLY. The highlight also covers the rows linked
   *  to the row in this state: a node's links, a link's two nodes, and everything
   *  nested inside a hierarchy node. A dataset with no `ref` column has no
   *  neighbours; setting this there warns and does nothing. Setting it on
   *  `hovered` makes hover light the row in every mark over its table. */
  neighbours?: boolean;
}

// What `Elicit.dataset(spec)` reads: the rows, their schema and the invariants
// over them. Every chart made from the dataset reads and writes these rows.
export interface DatasetSpec {
  // The seed rows. A chart draws exactly one dataset — even a slider elicits a
  // one-row dataset — and several charts may share one. Every mark is a view over
  // these rows, encoding some columns and (where it carries an edit) writing them
  // back. Marks and charts never own data. May be omitted: with a `schema`, scales resolve and `create`
  // mints rows from nothing.
  //
  // A bare array is the PRIMARY table's rows — which is every single-table chart.
  // A multi-table structure keys its rows by table NAME (`{ nodes, links }`, or
  // whatever the schema called them); a table left out seeds `[]`, so a diagram
  // built entirely by gesture needs no `data` at all.
  data?: Datum[] | Record<string, Datum[]>;
  // The elicited-dataset schema (field -> measurement type/domain/default), and
  // the contract of every chart over it. REQUIRED: it owns every field's data type and
  // DOMAIN, so a mark never declares one. A field encoded but left out of the
  // schema is inferred from `data` with a dev-warning; a field with neither a
  // schema entry nor data throws (there is nothing to build a scale from).
  //
  // A bare field map is a single-table schema (the form every pre-structure spec
  // uses, and it stays valid); declare a `structure` to elicit a network. See
  // SchemaInput / SchemaSpec above.
  schema: SchemaInput;
  // Read-only rows. `'seed'` (or `true`) fixes the rows in `data` — they are given,
  // not elicited — while every row an edit ADDS stays free; a predicate locks rows
  // by what they are. A locked row can't be changed or deleted by any gesture (a
  // dataset invariant, run last, so it outranks every other repair), its marks are
  // not grabbable, and proximity picking (nearest / sweep / draw) skips them. Note
  // `setData` re-seeds the dataset, so it also re-takes a `'seed'` lock.
  lock?: LockSpec;
  // Reference rows. `true` makes every row in `data` context; a predicate picks
  // which seeded rows are (`d => d.year <= 2020`). Context rows share the table's
  // columns — nothing is declared twice — are drawn by every mark over the table,
  // are locked (as `lock` makes them), and are left out of `getData()`, `onChange`
  // and the index-addressed selection/control API, whose indices count reported
  // rows only. Decided once, over the seed: an answer dragged into the predicate's
  // region stays an answer. `setData(rows)` replaces the elicited rows and keeps
  // the context. Constraints see context rows (they are rows of the table), with
  // `locked` telling them apart.
  context?: ContextSpec;
  // The dataset's invariants. They gate and REPAIR every edit, whichever mark fired
  // it: a rejected proposal is dropped; a returned array replaces it, and the marks
  // re-derive from the repaired rows on the next render. Declared in exactly one
  // place: `DatasetSpec.constraints`.
  constraints?: Constraint[];
  // Called with the committed dataset once per commit, from whichever chart made
  // it (or `set`, `setDomain`, undo), shaped like `data` itself (a bare array for a
  // single-table dataset). Hover previews never fire it.
  // Declared as a METHOD, not a function-valued property, so it stays bivariant: a
  // single-table consumer (every widget) may hand in a plain (rows: Datum[]) => void.
  onChange?(data: Datum[] | Record<string, Datum[]>): void;
  // NO index signature: the key set is CLOSED (see ChartSpec).
}

// What `dataset.chart(spec)` reads: how one chart draws and edits the dataset.
export interface ChartSpec {
  width?: number;
  height?: number;
  margins?: { top: number; right: number; bottom: number; left: number };
  marks?: (Mark | Mark[])[];
  // Chart elements (`elicit.elements.*` — axis / grid / legend / axisRadial).
  // Concatenated with `marks` into the feature list; same factories also work
  // inside `marks`. Prefer this key when the
  // intent is scale chrome rather than a data view.
  elements?: ChartElement[];
  // Global axis convenience: `false` = no axes; `{ x, y }` = per-channel config or
  // `false` to suppress that channel; omitted = default axes on both positional
  // channels. Desugars into composable axis/grid marks.
  //   origin  states the FRAME explicitly rather than leaving it inferred: `true`
  //           crosses both axes at zero (trend's natural frame, and usable on any
  //           chart whose domains span it); `false` forces the ordinary left/bottom
  //           frame even alongside a `trend`/`trendBand` mark. Omitted, the frame
  //           still follows the marks present, exactly as before this existed.
  //   count   opt-in axis for a COUNTABLE mark (waffle, dotStack) — reserves layout
  //           space for a scale the mark already makes countable by eye, so it
  //           defaults off like a legend rather than on like x/y.
  axes?: false | { x?: AxisOptions | false; y?: AxisOptions | false; origin?: boolean; count?: boolean | AxisOptions };
  // The legend counterpart to `axes` — the IMPLICIT layer for the NON-positional
  // scales, desugared into legend marks by core/legends.js's autoLegends.
  //   true              one legend per non-positional channel bound to a field
  //   { fill: {...}, size: false }   per-channel config; false suppresses one
  // Defaults to none, unlike `axes`: a legend RESERVES layout space, so injecting
  // one by default would silently shrink the plot the moment a `fill` field appears.
  // An explicit legend mark in `marks` always wins for its channel.
  legends?: boolean | Record<string, LegendOptions | boolean>;
  // Customizable interaction-effects layer (grab / proximity-select).
  effects?: EffectsSpec;
  // The chart's theme (style layer): default colours, fonts, and affordance tokens.
  // A partial, deep-merged over the built-in DEFAULT_THEME (and any setTheme() base).
  // See Theme (the resolved shape) and DeepPartial. A built-in theme's NAME works
  // too (`theme: 'nyt'`), and a partial may `extends` one.
  theme?: ThemeSpec;
  guides?: Guide[];
  // Sizing mode. 'fixed' (default) draws at the pixel width/height. 'scale' wraps
  // the SVG in a viewBox so the browser scales it to fill the parent (one draw,
  // aspect ratio preserved). 'reflow' (or `true`) measures the parent and redraws
  // at native pixels on resize — crisp text, width tracks the container, height
  // stays the given value. Reflow charts expose `destroy()` to detach the observer.
  responsive?: 'fixed' | 'scale' | 'reflow' | boolean;
  // 'hidden' (default) clips marks to the viewport; 'visible' lets content in the
  // margin band show — needed for radial/gauge axis labels that sit just outside
  // the plot area. Needs a renderer that supports `overflow` (SVG does).
  overflow?: 'hidden' | 'visible';
  // Eased drawing: what the chart draws glides to where it belongs instead of
  // jumping. Today a hierarchy's layout eases (nodes making room, containers
  // resizing, a dropped node settling). Only the drawing is eased; the data changes
  // once, when the gesture commits. `false` draws every change at once. Always off
  // when the reader's system asks for reduced motion.
  motion?: false | MotionSpec;
  // Experimental. How the finished chart is drawn: a hand-drawn redraw, a shader
  // (`looks.*`), applied in order. A shader look needs a renderer that supports
  // `shaders` (canvas). Off unless set.
  looks?: Look[];
  // Spatial layout settling processes (`layout.*`): contain, dodge, row, column,
  // grid, pack, custom. Read rendered boxes (`nodeBox`) and write settled positions
  // and sizes back through the channels' scales on commit / release (with live drag
  // previews and `motion` easing).
  layout?: LayoutSpec[];
  // Browser focus ring on editable marks (the blue box after a click / Tab).
  // Off by default — keyboard nudge still works (`tabindex` stays); only the
  // native outline is suppressed. Set `true` to show the browser's focus ring
  // (useful when teaching Tab / arrow-key editing). Needs a renderer that supports
  // `keyboard` (SVG does).
  focusOutline?: boolean;
  // The drawing backend. Defaults to a new `D3Renderer` (SVG). Any object satisfying
  // the `Renderer` contract works — `CanvasRenderer` is a second, canvas-2D
  // implementation of the same contract, which is what proves the seam is real.
  renderer?: Renderer;
  // Chart-level scale overrides, keyed by channel ('x', 'y', 'fill', 'size', …).
  // Scales are GLOBAL per channel, so this is their honest home; a channel's own
  // `scale` is the shorthand for the single-mark case. This wins over it. No
  // `domain` here either — that is the schema's.
  scales?: Record<string, ScaleSpec>;
  // Geographic projection for geo* marks (Plot model). Replaces x/y placement for
  // map elicitation: `"mercator"`, `{ type, domain, rotate, … }`, or a live
  // d3.geo* instance. When set, auto axes default off; use geoBasemap / geoPoint /
  // geoLine / geoPolygon / geoRect with edit.geo.*.
  projection?: string | ProjectionSpec | ProjectionContext | ((...args: any[]) => any) | any;
  // Initial stage index for multi-stage elicitation. Edits carrying a `stage`
  // are active only when it equals the current stage (see Edit.stage).
  stage?: number;
  // Optional labels for stages (index -> name). Surfaced via getStageLabel() and
  // the second argument of on('stage', (index, label) => …).
  stageLabels?: (string | null)[];
  /** Chart chrome above the plot (and below it, for the caption). Each reserves
   *  its band of layout space, like a legend, so the chart keeps its declared size. */
  title?: string;
  subtitle?: string;
  caption?: string;
  /** Confine the marks to the plot rect, axis to axis, so nothing draws on or
   *  past an axis (a zoomed-in line otherwise runs into the margins). A mark
   *  outside the rect is not grabbed or tipped either. Axes, legends, guides and
   *  any mark with `clip: false` are not clipped. `{ pad }` clips to the plot
   *  rect grown by `pad` pixels — on every side, or per side — so a point on a
   *  domain edge draws whole. Default: on when an edit moves a domain as a
   *  window (`edit.axis.zoom`, `edit.axis.pan`), off otherwise. */
  clip?: boolean | ClipSpec;
  // NO index signature. The spec's key set is CLOSED: an unknown key is a typo
  // that would otherwise draw a wrong chart in silence, and core/guards.js reports
  // it at run time. Closing it here is the compile-time half — and it is what lets
  // the planned JSON grammar be generated from a key set that is actually known.
}

// What `Elicit(spec)` reads: a dataset and one chart over it, in one object.
export type ElicitSpec = DatasetSpec & ChartSpec;

// The shared option surface every survey widget (src/widgets/*) accepts, so the
// family reads consistently. A widget adds its own instrument-specific options
// (e.g. `options`, `domain`, `categories`) on top. `theme` is the style hook: the
// widget resolves it once, draws its parts in the design `theme.widget.design`
// names, and pins the resolved tokens on `spec.theme` (see widgets/shared.js).
export interface WidgetOptions {
  // The question prompt, drawn into the top margin.
  question?: string;
  // Called with the committed dataset after each answer.
  onChange?: (data: Datum[]) => void;
  width?: number;
  height?: number;
  // Active-stage gate for the widget's edit(s) — set to place the instrument in a
  // multi-stage form (the edit is live only when the chart's stage matches).
  stage?: number;
  // The widget's theme (style layer), a partial deep-merged over DEFAULT_THEME.
  theme?: ThemeSpec;
}

// patch: per table NAME, rows to insert, rows to update (merged into the row with
// the same key), and keys to remove (a bare value for a one-field key, otherwise a
// row-shaped object or an array of the key fields' values).
export type PatchSpec = Record<string, { insert?: Datum[]; update?: Datum[]; remove?: unknown[] }>;
export interface PatchOptions {
  history?: 'keep' | 'record';
}
export interface PatchResult {
  inserted: number;
  updated: number;
  // Rows gone, including links a removed node took with it.
  removed: number;
  // Updates whose key named no row (a person deleted it first, say).
  missing: { table: string; key: unknown[] }[];
  // Inserts whose key already named a row.
  conflicts: { table: string; key: unknown[] }[];
}
// What one finished gesture did: the payload of `on('gesture')`. Not to be
// confused with GestureEvent, which is one renderer-shaped INPUT event.
export interface GestureRecord {
  // Deduplicated: a drag fires its edit on every move.
  edits: { type: string; name?: string; table: string }[];
  before: Datum[] | Record<string, Datum[]>;
  after: Datum[] | Record<string, Datum[]>;
}

// The dataset `Elicit.dataset(spec)` returns: the rows, their schema, undo history
// and selection, shared by every chart made from it with `chart(spec)`. Its
// methods read and replace the data from outside; they add no interaction path —
// edits + constraints remain the only way a gesture mutates data.
export interface Dataset {
  // Make a chart over this dataset. Append `chart.dom()` to the page.
  chart(spec: ChartSpec): Chart;
  // A deep copy of the committed dataset. Shaped like `spec.data`: a bare array for
  // a single-table dataset, one array per table NAME for a multi-table structure.
  getData(): Datum[] | Record<string, Datum[]>;
  // A deep copy of the dataset's schema, including any DOMAIN an editable axis
  // (edit.axis.*) reshaped. The caller's original spec.schema is never mutated.
  // Returned in the spelling it was GIVEN in — a single-table dataset gets its bare
  // field map back, so the engine's canonical form never leaks.
  getSchema(): SchemaInput;
  // Replace the rows and re-render. Bypasses constraints (trusted seed/reset).
  // Also clears the undo history: a reseed is a new starting point, not an edit.
  setData(data: Datum[] | Record<string, Datum[]>): void;
  /**
   * Set a field's DOMAIN from outside — the external twin of `edit.axis.zoom` /
   * `edit.axis.scale`: a zoom button, a "reset view" control. Undoable, and
   * notifies `change`. `null` restores the declared domain. Returns false (and
   * warns) when the field is not declared.
   */
  setDomain(field: string, domain: any[] | null, options?: { table?: string }): boolean;
  /**
   * Write one cell from outside any chart: a slider, an input, a script. The
   * proposal runs the table's constraints and then the lock, as an edit's does
   * (an edit's own `constrain` does not run); a repair commits the repaired rows.
   * One undoable step; fires `change` and redraws every chart. `index` counts the
   * rows `getData()` reports (context rows left out) and defaults to 0; `table`
   * defaults to the primary table. Writes existing rows only. Returns whether it
   * committed: false when a constraint rejects it, the row is locked, or the value
   * is unchanged; false with a warning for an undeclared field, an index out of
   * range, or a value the field's type cannot hold.
   */
  set(field: string, value: any, options?: { index?: number; table?: string }): boolean;
  // Merge rows into the live dataset by KEY, for a second writer (an agent, a
  // server) working on the data while a person edits it. Unlike setData it keeps
  // the selection, any stroke in flight and, by default, the undo history: with
  // `history: 'keep'` the write is rebased into every snapshot, so undo never
  // reverts it; `'record'` makes it an undo step of its own. A row's key is its
  // table's `key: true` field, or, for a links table without one, its `ref` ends.
  // Trusted like setData (constraints gate gestures); refs still cascade. A patch
  // that removes rows waits for a stroke in flight to end and returns
  // `{ deferred: true }`; otherwise it returns what it did. Fires 'change'.
  patch(changes: PatchSpec, options?: PatchOptions): PatchResult | { deferred: true };
  // Step back / forward one GESTURE. A drag is one entry however many commits it
  // made along the way; a click or a typed commit is its own. Both restore the
  // dataset AND the schema (an axis edit reshapes a domain) and fire 'change'.
  // Return whether they moved, so a caller can drive a button's disabled state.
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  // Hold ONE undo entry open: everything committed until the returned function is
  // called (by `set`, a control, a gesture, in any chart) undoes as one step. For
  // an action made of several writes — a new row and then its category, a resize
  // that moves a width and a centre. `change` still fires per commit. Undo, redo
  // and `setData` close it; calling the closer twice is harmless.
  transaction(): () => void;
  // Subscribe to committed changes ('change': (data)), selection changes
  // ('select': (primaryIndex | null, indices[])) or hover changes ('hover': (row |
  // null), the dataset's hovered row as getHover reports it). Selection is not the belief data,
  // so it has its OWN event — a 'select' listener hears it, 'change'/getData never
  // do. Returns an unsubscribe function.
  //
  // 'select' second argument: bare row indices for a single-table dataset (a bare
  // index names a row unambiguously there), `{ table, index }` for a multi-table
  // one — where a number alone would name a row in no particular table.
  on(type: 'change' | 'select' | 'hover', cb: (...args: any[]) => void): () => void;
  // 'gesture': one event per gesture that changed data, when the gesture ENDS: a
  // drag is one event however many 'change's it fired on the way. Carries the
  // dataset before and after (shaped like getData) and the edits that fired, so a
  // caller can turn what a person did into one operation without diffing every
  // pointermove. Not fired by setData, set, patch, undo or redo.
  on(type: 'gesture', cb: (record: GestureRecord) => void): () => void;
  // ── Hover: the one row under the pointer in a chart whose hover is linked
  // (effects.hovered.link), shown by every linked chart. Interface state like the
  // selection: no 'change', no undo step.
  //
  // The hovered row: its index in a single-table dataset, `{ table, index }` in a
  // multi-table one, or null.
  getHover(): number | { table: string; index: number } | null;
  // Hover a row of the primary table from outside a chart (a table row beside the
  // charts, say). null / out-of-range clears. Returns whether the hover moved.
  hover(index: number | null): boolean;
  // ── Selection: transient pipeline state, NOT the belief data. Its own tiny API
  // beside getData/setData because a `selected` data column is exactly what this
  // replaces (see edit.select). All routes go through one applySelection, so an
  // external <select>, the keyboard, and a mark click leave selection in one shape.
  //
  // The FIRST selected datum index, or null. A stale index (the row was removed)
  // reads as null. Stays scalar when several rows are selected, so a caller written
  // against a single selection keeps working — read getSelectionAll for the rest.
  getSelection(): number | null;
  // Every selected datum index, ascending. Empty when nothing is selected.
  getSelectionAll(): number[];
  // Select a SPECIFIC ITEM by dataset index (external counterpart of clicking a
  // mark). null / out-of-range / an empty array clears. Exclusive: the selection
  // becomes exactly what is named. Returns whether the selection moved.
  select(index: number | number[] | null): boolean;
  // Add or remove ONE row, leaving the rest of the selection alone — the external
  // counterpart of a shift-click under edit.select({ multi: true }).
  toggleSelection(index: number): boolean;
  // Select every row of the primary table.
  selectAll(): boolean;
  // Select by CATEGORY / predicate: select rows matching { field: value } (or a
  // predicate function). The "select a category" entry point. No match clears.
  // `{ all: true }` takes every match; the default is the first only.
  selectWhere(
    field: string | ((d: Datum, i: number) => boolean),
    value?: any,
    options?: { all?: boolean }
  ): boolean;
  // Clear the selection entirely.
  clearSelection(): boolean;
}

// A chart: what `dataset.chart(spec)` and `Elicit(spec)` return. A plain object,
// not a DOM node — append `dom()`. It carries its dataset's methods too, delegating
// to `chart.dataset`, so `Elicit(spec).getData()` works.
export interface Chart extends Omit<Dataset, 'chart' | 'on'> {
  // The chart's container element. Append it to the page.
  dom(): HTMLDivElement;
  // The dataset this chart reads and writes.
  dataset: Dataset;
  // 'change', 'select' and 'hover' are the dataset's (see Dataset.on); 'stage' is
  // this chart's: (stageIndex, stageLabel?) on a stage change.
  // 'render' fires after every frame the chart draws (a commit, a resize, each
  // step of an eased motion): the moment to re-read `scene()` and reposition UI
  // laid over the chart. 'destroy' fires once, first thing in `destroy()`. A
  // 'render' listener must not write data.
  on(type: 'change' | 'stage' | 'select' | 'hover' | 'render' | 'destroy', cb: (...args: any[]) => void): () => void;
  on(type: 'gesture', cb: (record: GestureRecord) => void): () => void;
  // ── Reading the chart: for UI built outside it (menus, handles, icons beside a
  // mark; see the `ui` namespace). Observation only — every value is a copy, and
  // writes stay on `control`, `emit` and `set`. Pixels are INNER (margin-
  // subtracted) chart pixels unless a method says otherwise.
  //
  // What is drawn: one view per drawn piece, in paint order. A row usually draws
  // several (a sticker's box and label, a node's ports, a link's line and ends).
  scene(query?: SceneQuery): SceneView[];
  // The topmost visible piece at a point, or with `reach` the nearest within that
  // many pixels. null over nothing.
  hit(point: Point, options?: { reach?: number }): SceneView | null;
  // A channel's scale, as the mark named encodes it (the chart's shared scale with
  // no mark). null when nothing binds a field there. A snapshot of this frame:
  // read it again after a 'render'.
  scale(channel: string, options?: { mark?: string; index?: number }): ChartScale | null;
  // The edits the marks declare and whether each can run now, narrowed by the
  // query to a mark, a table, a row or one of the row's handles.
  edits(query?: SceneQuery): EditInfo[];
  // The chart's size and margins in chart pixels, and how far CSS stretches them.
  metrics(): ChartMetrics;
  // Viewport pixels (a pointer event's clientX / clientY) <-> inner chart pixels.
  toInner(point: Point): Point;
  toClient(point: Point): Point;
  // The resolved theme (a copy): DEFAULT_THEME < setTheme() < spec.theme.
  readonly theme: Theme;
  // Multi-stage controls (see ChartSpec.stage). getStage reads the current index.
  getStage(): number;
  // Optional label for the current stage (from ChartSpec.stageLabels), or null.
  getStageLabel(): string | null;
  setStage(stage: number): void;
  nextStage(): void;
  // External control — drive an edit from OUTSIDE the chart (a slider, a picker,
  // a rotate icon, a plain function). A new input SOURCE, not a second interaction
  // system: `emit`/`control` synthesize the same renderer-shaped events the pointer
  // and keyboard already produce and feed them to the one dispatch, so constraints,
  // undo, guides, and 'change' all run identically.
  //
  // Low-level: inject a renderer-shaped event. x/y are INNER (margin-subtracted)
  // pixels. Prefer `control` unless you already hold pixels.
  emit(event: GestureEvent): void;
  // High-level: a handle bound to the edit named `name` (see Edit.name) acting on
  // the datum at `target` (a row index, default 0). `.set(value)` drives it by a
  // DATA value — forward-encoded through the channel's scale for positional edits,
  // or carried whole for a `set()`/`editText()` value edit. A row that draws several
  // handles takes a `SceneRef` to name one: `{ index, side: 'right' }` for a port,
  // `{ index, channel: 'target' }` for a link's end.
  //
  // A control names its edit, so the edit's `when` is not asked: `when` chooses
  // between pointer gestures. Constraints, the lock and the stage still apply.
  control(name: string, target?: number | SceneRef): EditControl;
  // Detach the chart from its dataset, stop its observers (the ResizeObserver of
  // `responsive: 'reflow'`) and release its renderer (`Renderer.destroy`). Call it
  // when unmounting a chart.
  destroy(): void;
}

// What the engine hands a renderer each frame. The renderer draws `scene.children`
// (typed FeatureNodes) into `container` and reports gestures back through `onEvent`
// as INNER (margin-subtracted) pixels. This is the entire coupling between the
// engine and its drawing backend — everything else (marks, edits, scales, guides)
// is renderer-agnostic.
export interface RenderContext {
  // The chart's host element (a div). The renderer owns what it puts inside.
  container: HTMLElement;
  // The scene to draw: `scene.children` is a flat array of FeatureNodes in
  // features/parts array order (later = on top among marks). Renderers may still
  // pin `background` / `guide` / `effect` nodes into role layers around that stack.
  scene: { children: FeatureNode[] };
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  /** The resolved scales this frame was built with, keyed as marks read them
   *  (`x`, `y`, and `scaleKey(channel, field)` for non-positional encodings). A
   *  positional scale's `encode(value)` gives a plot-local pixel, the space a
   *  gesture's `x`/`y` are reported in, so a renderer or test harness can place a
   *  synthetic gesture at a data value. Read-only: the engine rebuilds it each frame. */
  scales: ScaleMap;
  /** The spec the chart was built from, as the author passed it. Read-only. */
  spec: ChartSpec;
  // True when active edits are plane-driven (sweep/draw/nearest): the renderer must
  // route all gestures as plane events (no node) rather than hit-testing marks.
  planeOnTop?: boolean;
  planeCursor?: string;
  /** The rect the marks are confined to, in plot-local pixels (the plot rect,
   *  grown by `ClipSpec.pad`), or null when the chart does not clip. */
  clip?: ClipRect | null;
  /** An active edit listens to the wheel: the renderer reports `wheel` from its root and prevents the page scroll. */
  hasWheel?: boolean;
  /** A guide reads the pointer: the renderer reports pointermove / pointerleave from its root. */
  tracksPointer?: boolean;
  responsive?: 'fixed' | 'scale' | 'reflow';
  overflow?: 'hidden' | 'visible';
  // See ChartSpec.focusOutline. Read by a renderer that supports `keyboard`.
  focusOutline?: boolean;
  effects?: any;
  // The chart's looks. A renderer that supports `shaders` runs the 'shader' ones
  // over what it painted; 'geometry' ones are already in the scene.
  looks?: Look[];
  // The chart's resolved theme. A renderer reads it for the font family (emitted on
  // the root svg) and text-size fallback; all mark/chrome colours arrive pre-resolved
  // on the nodes, so a renderer never has to consult the theme for paint.
  theme?: Theme;
  // Report a gesture to the engine. The renderer resolves `direct`-pick targets
  // (the node under the pointer) and sets `event.node`; plane gestures leave it unset.
  onEvent: (event: GestureEvent) => void;
  [key: string]: any;
}

// What a renderer can do beyond drawing the scene and reporting pointer gestures.
// A renderer declares these; the engine warns when a spec asks for one that is
// not declared, so nothing a renderer lacks goes missing silently.
export interface RendererSupports {
  // Editable nodes take keyboard focus: arrow keys `nudge`, `focusOutline` shows the ring.
  keyboard?: boolean;
  // The inline editor a typed edit (`edit.editText`) commits from.
  textEditor?: boolean;
  // The `filter` property of an effect (`effects.grabbed.filter`).
  filter?: boolean;
  // Drawing past the chart's own edge (`overflow: 'visible'`).
  overflow?: boolean;
  // Running a shader look (`looks.sketch()`, `looks.custom()`) over the painted chart.
  shaders?: boolean;
}

// ── Looks (experimental) ─────────────────────────────────────────────────────
// A look restyles how the finished chart is drawn: `spec.looks`, built by `looks.*`.
// It changes no data, no scale and no hit geometry. Names and options may change.

// What a look covers: 'marks' is what draws data, so axes, labels, legends and
// guides stay as drawn; 'frame' is the whole chart.
export type LookScope = 'marks' | 'frame';

export interface Look {
  // The keyword that built it ('rough', 'sketch', 'custom', …).
  type: string;
  // 'geometry' redraws scene nodes before they reach the renderer, so it works in
  // any renderer. 'shader' runs over the painted pixels and needs a renderer that
  // supports `shaders`.
  kind: 'shader' | 'geometry';
  scope: LookScope;
  // A shader look: GLSL ES 1.00 that defines `vec4 look(vec2 uv)`, the numbers it
  // reads as uniforms, and the `u_seed` it is given. A null fragment is skipped.
  fragment?: string | null;
  uniforms?: Record<string, number | number[]>;
  seed?: number;
  // A geometry look: the nodes to draw in place of the scene's.
  transform?: (nodes: FeatureNode[]) => FeatureNode[];
}

export interface RoughLookOptions {
  scope?: LookScope;
  // How far the pen strays: 0 draws true lines, 1 is the default, up to 3.
  roughness?: number;
  // How a mark's fill is drawn: hatched with lines (the default) or solid.
  fill?: 'hachure' | 'solid';
  // A different number gives a different hand. The same number draws the same chart.
  seed?: number;
}

export interface SketchLookOptions {
  scope?: LookScope;
  // How far lines wobble, 0 to 2 (default 1.2). Capped so a mark is still drawn
  // where the pointer hits it.
  amount?: number;
  // The pencil grain, 0 to 1 (default 0.25).
  grain?: number;
  seed?: number;
}

export interface CartoonLookOptions {
  scope?: LookScope;
  // Steps of colour per channel, 2 to 16 (default 4).
  levels?: number;
  // The strength of the ink line, 0 to 1 (default 1).
  outline?: number;
  // The ink's colour (default near-black).
  ink?: string;
}

export interface HalftoneLookOptions {
  scope?: LookScope;
  // The distance between dots in px, 2 to 40 (default 5).
  size?: number;
  // The angle of the dot screen in degrees (default 30).
  angle?: number;
}

export interface CustomLookOptions {
  scope?: LookScope;
  // Numbers the fragment reads by name: a number is a `float`, 2 to 4 numbers a
  // `vec2` / `vec3` / `vec4`.
  uniforms?: Record<string, number | number[]>;
  // Given to the fragment as `u_seed`.
  seed?: number;
}

// The drawing-backend contract. `D3Renderer` (SVG) and `CanvasRenderer` (canvas 2D)
// both satisfy it. `render` draws the scene and wires the events for one frame.
// State an implementation keeps between frames (idempotent scaffolding, gesture
// state, image caches) is its own business.
export interface Renderer {
  render(context: RenderContext): void;
  // What it can do beyond that. Unset declares nothing.
  supports?: RendererSupports;
  // Called by `chart.destroy()`: release what outlives a frame (window listeners,
  // observers, caches). The drawing may stay in the container.
  destroy?(): void;
}

// A renderer-shaped gesture event, the one shape every input source (pointer,
// keyboard nudge, external controller) funnels into `handleEvent`. x/y are INNER
// (margin-subtracted) pixels — the space an edit's `ctx.pointer` reads.
export interface GestureEvent {
  type: 'dragstart' | 'drag' | 'dragend' | 'click' | 'dblclick' | 'commit' | 'wheel' | 'pointermove' | 'pointerleave' | (string & {});
  // The scene node the gesture landed on. Present -> direct-pick dispatch to that
  // node's feature; absent -> plane dispatch fans to every feature.
  node?: any;
  x?: number;
  y?: number;
  // A non-pixel payload (a typed string, a picked value) read as `ctx.value` — how
  // a `commit` gesture carries what `set()`/`editText()` write.
  value?: any;
  // "One press = one complete gesture": a lone `drag` self-closes its undo txn
  // instead of leaking it (the keyboard nudge's trick, reused for one-shot control).
  nudge?: boolean;
  // Addresses ONE edit by its `name` (Edit.name). Dispatch then runs only that edit
  // instead of fanning to every same-gesture edit — so several `set()`s on one
  // feature (a face's params) stay independent — and does not ask its `when`. Set
  // by `chart.control`; native pointer events leave it unset (and keep the fan-out).
  editName?: string;
  // How far from a small mark, in inner px, a finger press may land and still take
  // it. Renderers set it on a touch press and the click that follows; a mouse
  // leaves it unset.
  reach?: number;
  rawEvent?: any;
  [key: string]: any;
}

// One handle of a row, for `chart.control(name, ref)`: the row, and where a row
// draws several handles, which one — by the channel it moves (a link's 'source' or
// 'target' end, a 'port') and/or its side. A SceneView is one.
export interface SceneRef {
  index: number | null;
  channel?: string | null;
  side?: string | null;
}

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }

// Which drawn pieces `chart.scene` and `chart.edits` return. `mark` is a mark's
// `id`. A glyph's id names all its parts ('sticker' covers 'sticker/body',
// 'sticker/label' and the ports 'sticker/body/ports'); a part's id names that part
// alone. `index` counts reported rows, like `getData()`.
export interface SceneQuery {
  mark?: string;
  table?: string;
  index?: number;
  channel?: string;
  side?: string;
}

// One drawn piece of the chart, as `chart.scene` and `chart.hit` report it. A
// plain copy of this frame: it does not follow the chart, so read again on 'render'.
export interface SceneView {
  // The mark that drew it (its `id`; a glyph part is 'id/part').
  mark: string;
  // The table its row is in, and the row as `getData()` counts it. Both null for
  // a chart element (a tick, a swatch); `index` is null for a context row.
  table: string | null;
  index: number | null;
  // The shape: 'rect', 'circle', 'ellipse', 'line', 'path', 'text' or 'image'.
  type: string;
  // Which of the row's handles this is, where a row draws several: the channel it
  // moves ('port', a link's 'source' / 'target') and the side it sits on.
  channel: string | null;
  side: string | null;
  // Its unrotated box and its centre, in inner pixels. A link's centre is the
  // midpoint of its line. null where a shape states neither.
  box: Box | null;
  center: Point | null;
  // Degrees it is turned about its centre.
  angle: number;
  // The row (a copy), or null.
  readonly datum: Datum | null;
  // Interaction state: the pointer is on this piece; its row is selected; a drag
  // holds this piece.
  hovered: boolean;
  selected: boolean;
  grabbed: boolean;
  // false while the chart hides it: a port or a link's end handle at rest.
  visible: boolean;
  // A press on it starts a direct edit; its row is locked.
  editable: boolean;
  locked: boolean;
}

// A declared edit, as `chart.edits` reports it. `name` is what `chart.control`
// takes; an edit with none can't be driven from outside.
export interface EditInfo {
  name: string | null;
  // The keyword that built it ('move', 'remove', 'network.connect', …).
  type: string;
  gesture: string;
  pick: string;
  // The channels it writes, and the columns behind them.
  channels: string[];
  fields: string[];
  // The mark that carries it, and that mark's table (what `control`'s index counts).
  mark: string;
  table: string | null;
  // 'append' | 'appendMany' | 'toggle' | 'delete' for an edit that adds or removes rows.
  cardinality: string | null;
  // Can it run now: its stage is current, the row is unlocked and, on a port, a
  // link could land somewhere.
  available: boolean;
}

// A channel's scale, from `chart.scale`. Capability flags, never a scale type.
export interface ChartScale {
  channel: string;
  // The column the channel reads, and its table.
  field: string | null;
  table: string | null;
  // Data value -> visual value (a pixel, a colour). null for a raw channel.
  encode: ((value: any) => any) | null;
  // Pixel -> data value. null unless `invertible`.
  invert: ((pixel: number) => any) | null;
  // The value set (discrete) or [min, max] (continuous), and what it maps onto.
  domain: any[] | null;
  range: any[] | null;
  kind: ScaleKind | null;
  temporal: boolean;
  invertible: boolean;
}

// The chart's size, from `chart.metrics`. `scale` is CSS pixels per chart pixel:
// 1 unless `responsive: 'scale'` stretches the drawing.
export interface ChartMetrics {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  innerWidth: number;
  innerHeight: number;
  scale: number;
}

// A handle bound to a named edit + datum (from `chart.control`). It reads the edit's
// own `gesture` to route value-space vs pointer-space — the handle branches; the
// engine dispatch never learns a controller exists.
export interface EditControl {
  // One-shot write. A value edit (set/editText) carries `value` whole; a positional
  // edit (drag/resize/rotate/rank) forward-encodes it to a pointer and self-closes
  // its undo txn (one entry). Pass a scalar for a single-channel edit, or a
  // { channelName: value } / { field: value } map for a multi-channel one (2-D drag).
  // Works on a direct edit and on a plane edit whose pick only chooses the row
  // (`nearest`, `sweep`): the row is the one this control names. A plane edit that
  // needs a pointer path or position (a draw, a brush, a create) warns and does
  // nothing; drive it with `chart.emit({ type, x, y })`.
  set(value: any): void;
  // Bracket a LIVE drag so many `.set()` ticks collapse into ONE undo entry, exactly
  // like a pointer drag's dragstart..dragend. `end()` releases where the stroke's
  // pointer last was (the last `set` or `emit` with x/y), so an edit that commits
  // on release — a connect, a rewire — lands there. `begin(at)` presses at a
  // point in inner pixels instead of on the datum: for a stroke that follows a
  // pointer pressed somewhere else (an icon beside the mark), so a relative edit
  // travels as far as the pointer does.
  begin(at?: Point): void;
  end(): void;
  // Abandon the stroke `begin()` opened: no release, so an edit that commits on
  // release writes nothing. What earlier ticks already wrote stays, as one entry.
  cancel(): void;
  // Fire a TRIGGER edit that takes no value (cycle advances a category, remove drops
  // the row, toggle flips it): dispatches the edit's own gesture (a click/dblclick)
  // on the datum's node. `.set` covers commit/drag edits; `.fire` covers these. Pass
  // a gesture to override the edit's own.
  fire(gesture?: string): void;
  // Raw event passthrough to this edit alone, auto-scoped to its node for the datum.
  // A plane edit gets no node: `control('add').emit({ type, x, y })` runs it at a point.
  emit(event: GestureEvent): void;
  // What values this channel ACCEPTS, read off its scale — so external UI (dropdown
  // options, slider min/max, colour choices) can respect the scale. null if the edit
  // isn't found. `values`/`domain` list the accepted set (discrete) or range
  // (continuous); `kind`/`type`/`temporal`/`invertible` are the scale's capabilities.
  accepts(): ChannelAccepts | null;
}

// The accepted-value description `EditControl.accepts()` returns, derived from the
// channel's scale + the field's schema. Read capability flags, never `scale.type`.
export interface ChannelAccepts {
  field: string | null;
  type: MeasureType | null;
  kind: 'band' | 'point' | 'continuous' | 'discrete' | null;
  temporal: boolean;
  invertible: boolean;
  // A discrete channel's accepted value set is its domain; a continuous channel's
  // accepted [min, max] is its domain. `values` is the discrete set only (null when
  // continuous), so a dropdown can offer exactly the valid choices.
  domain: any[] | null;
  values: any[] | null;
  range: any[] | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-factory OPTION interfaces. Each mirrors one entry of src/vocabulary.js —
// the runtime list a factory validates against — and `check:exports` holds the
// two to each other in both directions: an option typed here that the factory
// never reads fails the gate, and so does one it reads that is not typed.
// ═══════════════════════════════════════════════════════════════════════════

// ── Marks ──────────────────────────────────────────────────────────────────
export interface ArcOptions extends MarkOptions, HandleOptions {
  outerRadius?: number;
  innerRadius?: number;
  /** Gap between slices, in degrees. */
  padAngle?: number;
  /** The sweep: 'full' (default) or a named partial arc, or explicit start/end degrees. */
  arc?: string;
  start?: number;
  end?: number;
}
/**
 * How a picture is sized in its box, as CSS object-fit: 'cover' fills it and
 * crops, 'contain' shows all of it, 'fill' stretches to it, 'none' keeps its own
 * size, 'scale-down' is the smaller of 'none' and 'contain'.
 */
export type ImageFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
/** Whether a background image repeats, as CSS background-repeat. */
export type ImageRepeat = 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';
/** A picture painted in a node's box (`FeatureNode.fillImage`). */
export interface FillImage {
  href: string;
  fit: ImageFit;
  /** Where it sits: fractions of the room left over on x and y (0.5 = centred). */
  position: [number, number];
  repeat: ImageRepeat;
}
export interface AreaOptions extends MarkOptions, HandleOptions {
  orientation?: Orientation;
  /** A gradient fill: stops as [offset 0–1, colour], along the vertical (default) or horizontal. */
  gradient?: GradientSpec;
  /** d3 curve interpolation name ('linear', 'monotoneX', 'step', …). */
  curve?: string;
  /** How points connect with no `order` channel: by the domain axis, or in array order. */
  connect?: 'domain' | 'sequence';
}
export interface BarOptions extends MarkOptions, HandleOptions {
  orientation?: Orientation;
  gradient?: GradientSpec;
  /** Corner radius, px. Default: the theme's `marks.bar.rx` (none). */
  rx?: number;
}
export interface CurveOptions extends MarkOptions {
  orientation?: Orientation;
  /** Chord length in px when no x1/x2 (y1/y2) pair is declared. */
  length?: number;
}
export interface DotStackOptions extends MarkOptions {
  orientation?: Orientation;
  /** Gap between tokens, in px. */
  gap?: number;
  /** Draw ghost rings for the empty slots. */
  ghost?: boolean;
  /** Label each column with its count. */
  label?: boolean;
}
export type EllipseOptions = MarkOptions;
/** `plot.image`: one picture per row (the `src` channel), in a square of side `2 * size` centred at (x, y). */
export type ImageOptions = MarkOptions;
export interface GeoBasemapOptions extends MarkOptions {
  /** A GeoJSON Feature / FeatureCollection / Geometry to draw. */
  geojson?: any;
}
export interface GeoTileOptions extends MarkOptions {
  /** A `{z}/{x}/{y}` tile URL template (OSM by default). */
  url?: string;
  subdomains?: string[];
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
  zoomOffset?: number;
  /** Drawn by default — a licence condition of every tile service. */
  attribution?: string | false;
  attributionSize?: number;
}
export type GeoPointOptions = MarkOptions;
export type GeoPolygonOptions = MarkOptions;
export type GeoRectOptions = MarkOptions;
export interface GeoLineOptions extends MarkOptions, HandleOptions {
  curve?: string;
  connect?: 'domain' | 'sequence';
  /** Draw a handle at each vertex (default: on for per-row coordinate lists). */
  showVertices?: boolean;
}
export interface GeoTextOptions extends MarkOptions {
  format?: Format;
}
export interface LineOptions extends MarkOptions, HandleOptions {
  orientation?: Orientation;
  curve?: string;
  connect?: 'domain' | 'sequence';
}
export interface NeedleOptions extends MarkOptions, HandleOptions {
  /** Needle length in px (else the `size` channel). */
  length?: number;
  /** Width of the needle's base, in px. */
  baseWidth?: number;
  /** Width of the needle's tip, in px. 0 (the default) tapers to a point; equal to `baseWidth` draws a bar of even width. */
  tipWidth?: number;
}
export interface NodeOptions extends MarkOptions {
  /** The LABEL's vertical offset from the dot, in px. */
  dy?: number;
  shape?: 'circle' | 'square';
  format?: Format;
}
/** A gradient paint: colour stops along one direction of the mark's own box. */
export interface GradientSpec {
  stops: [number, string][];
  direction?: 'vertical' | 'horizontal';
}
export interface PointOptions extends MarkOptions {
  shape?: 'circle' | 'square';
}
/** `plot.shape`: one path per row. */
export interface ShapeOptions extends MarkOptions {
  /**
   * The shape when no `symbol` channel is declared: a name (circle, square,
   * triangle, diamond, star, cross, wye), an SVG path string, or a function of
   * the row returning one. Default 'circle'. A `symbol` channel's scale range
   * may hold the same names or paths.
   */
  path?: string | ((d: Datum, i: number, data: Datum[]) => string);
}
export interface TrackOptions extends MarkOptions {
  /**
   * The route: an SVG path, or a function of the row returning one. Each `M`
   * starts a lane, and only lanes hold value. In plot pixels, unless x, y or
   * size is bound: then in unit form, placed the way `shape` places one.
   */
  path?: string | ((d: Datum, i: number, data: Datum[]) => string);
  /** What joins one lane to the next. It holds no value. Default 'none'. */
  join?: 'round' | 'straight' | 'none';
}
export interface RectOptions extends MarkOptions {
  orientation?: Orientation;
  gradient?: GradientSpec;
  /** A fixed pixel extent centred on the x/y anchor (else band / value / span). */
  width?: number | ChannelFn;
  height?: number | ChannelFn;
  /** Corner radius, in px. */
  rx?: number;
}
export interface RuleOptions extends MarkOptions {
  orientation?: Orientation;
  /** What this rule needs from a discrete axis, when it sits inside a composite. */
  discreteScale?: 'band' | 'point';
}
export interface TextOptions extends MarkOptions {
  orientation?: Orientation;
  format?: Format;
  /** Wrap width in px (`true` = the plot width), or a function of the row. */
  wrap?: number | boolean | ((d: Datum, i: number, data: Datum[]) => number | boolean);
  /** Baseline step between wrapped lines, in px. */
  lineHeight?: number;
}
export interface TickOptions extends MarkOptions {
  orientation?: Orientation;
  /** Shrink the tick inside its band by this many px each side. */
  inset?: number;
  /** Tick length in px when it sits on a point (not band) axis. */
  length?: number;
}
export interface WaffleOptions extends MarkOptions {
  orientation?: Orientation;
  /** How much of the field one cell is worth. */
  unit?: number;
  /** Cells across the band. */
  multiple?: number;
  gap?: number;
  shape?: 'rect' | 'circle' | 'symbol';
  showEmpty?: boolean;
  emptyFill?: string;
}

// ── Edits (the ones with knobs of their own; the rest take EditOptions) ─────
export interface EditTextOptions extends EditOptions {}
export interface AxisScaleOptions extends EditOptions {
  /** The schema field whose domain the axis edits, when the channel carries more than one. */
  field?: string;
  /** 'rescale' (default) re-divides the axis in place; 'grow' resizes the chart. */
  mode?: 'rescale' | 'grow';
}
/** `edit.axis.zoom`: the wheel narrows or widens the axis's domain about the value under the pointer. */
export interface AxisZoomOptions extends EditOptions {
  /** The schema field whose domain the axis edits, when the channel carries more than one. */
  field?: string;
  /** How much one notch (100 px of wheel delta) scales the span. Default 1.2. */
  factor?: number;
  /** The widest the domain may zoom out to: the declared domain (default), an explicit [lo, hi], or false. */
  limit?: 'declared' | any[] | false;
  /** The narrowest span it may zoom in to, in data units. */
  minSpan?: number;
}
/** `edit.axis.pan`: drag the plot to slide the axis's domain along. */
export interface AxisPanOptions extends EditOptions {
  /** The schema field whose domain the axis edits, when the channel carries more than one. */
  field?: string;
  /** How far it may pan: the declared domain (default), an explicit [lo, hi], or false. */
  limit?: 'declared' | any[] | false;
}
export interface ScaleCategoriesOptions extends EditOptions {
  field?: string;
  /** 'grow' adds one band-step per category instead of re-dividing the axis. */
  mode?: 'rescale' | 'grow';
}
export interface StackCutOptions extends EditOptions {
  /** Seed values for the minted row's other fields. */
  defaults?: Record<string, any>;
  /** The minted category's label, when the domain is `open`. */
  label?: string | ((n: number) => string);
}
export interface GeoRemoveVertexOptions extends EditOptions {
  /** Refuse to drop below this many vertices. */
  min?: number;
}
export interface GeoDrawOptions extends CreateOptions {
  /** Freehand pointer-sampling distance in px. */
  minDist?: number;
}
export interface GeoBrushOptions extends EditOptions {
  /** Whether a body drag translates the whole box. */
  move?: boolean;
  edgeInset?: number;
}
export interface GeoCreateRectOptions extends CreateOptions {
  /** The minted box's size, in degrees. */
  width?: number;
  height?: number;
  edgeInset?: number;
}

// ── Constraints ────────────────────────────────────────────────────────────
/** Shared by the rules that are about one column (or, for ordering/unique, several). */
export interface FieldConstraintOptions {
  /** The column(s) the rule is about. Omitted: the column the dispatching edit writes. */
  field?: string | string[];
}
export interface ClampOptions extends FieldConstraintOptions {
  /** Bounds; an omitted one falls back to the field's declared domain. */
  min?: number;
  max?: number;
}
export interface SnapOptions extends FieldConstraintOptions {
  step?: number;
  origin?: number;
}
export interface CountOptions {
  /** Maximum number of rows. */
  max?: number;
  /** 'replace' (default) keeps the newest `max`; 'reject' refuses the edit. */
  strategy?: 'replace' | 'reject';
}
export interface UniqueOptions extends FieldConstraintOptions {
  /** Rows allowed per distinct key (default 1). */
  max?: number;
  strategy?: 'reject' | 'replace';
}
export interface MaintainSumOptions extends FieldConstraintOptions {
  /** The total the rows must sum to. */
  total?: number;
  strategy?: 'cap' | 'normalize' | 'redistribute';
}
export interface OrderingOptions {
  /** The row's columns, in the order they must stay in (>= 2). */
  field?: string[];
  /** 'push' (default) moves the neighbours aside; 'block' rejects the edit. */
  strategy?: 'push' | 'block';
}
/** `constraints.follow`: columns of a row that move WITH a lead column, by the same delta. */
export interface FollowOptions {
  /** The columns that follow (the ones the rule repairs). */
  field?: string | string[];
  /** The column they follow. */
  lead?: string;
}
/** `constraints.symmetric`: a pair of columns mirrored about a centre column when one of them moves. */
export interface SymmetricOptions {
  /** The pair, e.g. ['lo', 'hi']. */
  field?: string[];
  /** The centre they mirror about, e.g. 'mean'. */
  about?: string;
}
export interface MonotonicOptions extends FieldConstraintOptions {
  /** The axis field the run is ordered along. */
  along?: string;
  dir?: 'up' | 'down';
  /** A series column, so each line is its own run. */
  series?: string | null;
}
export interface SpacingOptions extends FieldConstraintOptions {
  /** Minimum gap between adjacent values, in the field's units. */
  min?: number;
  series?: string | null;
}
/** `constraints.contain`: pure-data hierarchy nesting rules over the `nesting` table. */
export interface ContainConstraintOptions {
  /** Predicate gating which node rows may hold children. */
  parent?: (d: Datum, i: number, data: Datum[]) => boolean;
  /** Predicate gating which node rows may be nested inside a parent. */
  child?: (d: Datum, i: number, data: Datum[]) => boolean;
  /** Maximum nesting depth allowed (root = 0). */
  maxDepth?: number;
  /** Maximum number of direct children per container. */
  maxChildren?: number;
}

// ── Spatial layouts (`spec.layout`, `layout.*`) ──────────────────────────────
export interface LayoutContext {
  rows: Datum[];
  tables: Record<string, Datum[]>;
  tree: any;
  // The row's drawn box. A turned node gives the upright box around it.
  nodeBox: (index: number) => NodeBox | null;
  extentOf: (index: number) => NodeBox | null;
  scales: ScaleMap;
  width: number;
  height: number;
  locked: ((row: Datum, i: number) => boolean) | null;
  anchors: Set<number>;
  yields: Set<number> | null;
  preview: boolean;
  shift: (index: number, dx: number, dy: number) => void;
  shiftTree: (index: number, dx: number, dy: number) => void;
  write: (index: number, patch: Record<string, any>) => void;
}
export interface LayoutSpec {
  /** The keyword that built it; a scoped layout's is its dotted path (`'network.layered'`). */
  type: string;
  options?: Record<string, any>;
  table?: string;
  /** The structure a scoped layout needs. It works on that structure's nodes table. */
  structure?: 'network' | 'hierarchy';
  apply?: (ctx: LayoutContext) => Datum[] | void;
}
export interface LayoutUniversalOptions {
  /** Target table by name or role (defaults to hierarchy `nodes` or primary table). */
  table?: string;
  /** Which rows the layout acts on (default: every row). The others stay where they are. */
  where?: (d: Datum, i: number, data: Datum[]) => boolean;
}
/** `layout.hierarchy.contain`: works on the hierarchy's nodes table. */
export interface ContainLayoutOptions {
  /** Which rows this container geometry applies to (default: all containers). */
  where?: (d: Datum, i: number, data: Datum[]) => boolean;
  /** Room in px kept between a container's edge and its contents (default 10). */
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  /** Auto-fit container size to its contents: `true` (both axes), `'x'`, `'y'`, or `false`. */
  fit?: boolean | 'x' | 'y';
}
export interface DodgeLayoutOptions extends LayoutUniversalOptions {
  /** Space in px kept between neighbouring boxes (default 8). */
  gap?: number;
  /** Which sibling groups dodge: `'all'` (default), `'roots'`, `'containers'`, or a container predicate. */
  in?: 'all' | 'roots' | 'containers' | ((d: Datum, i: number, data: Datum[]) => boolean);
}
export interface FlowLayoutOptions extends LayoutUniversalOptions {
  /** Space in px between neighbouring slots (default 8). */
  gap?: number;
  /** In a hierarchy: `'containers'` (default), `'roots'`, or a container predicate. */
  in?: 'roots' | 'containers' | ((d: Datum, i: number, data: Datum[]) => boolean);
}
export interface GridLayoutOptions extends LayoutUniversalOptions {
  /** Cells to a row (default: as many as fit a fixed width, else a square). */
  columns?: number;
  /** Space in px between cells (default 8). */
  gap?: number;
  /** In a hierarchy: `'containers'` (default), `'roots'`, or a container predicate. */
  in?: 'roots' | 'containers' | ((d: Datum, i: number, data: Datum[]) => boolean);
}
export interface PackLayoutOptions extends LayoutUniversalOptions {
  /** Space in px between packed neighbours (default 8). */
  gap?: number;
  /** How a moved item moves in to touch the group: `'distance'` (default) or `'angle'`. */
  keep?: 'distance' | 'angle';
  /** In a hierarchy: `'containers'` (default), `'roots'`, or a container predicate. */
  in?: 'roots' | 'containers' | ((d: Datum, i: number, data: Datum[]) => boolean);
}
export interface CustomLayoutOptions extends LayoutUniversalOptions {}
/** `layout.tidy`: line a hand layout up without redrawing it. */
export interface TidyLayoutOptions extends LayoutUniversalOptions {
  /** Centres this close, in px, share a row or a column (default 16). */
  snap?: number;
  /** Space in px a node needs clear of its neighbours to keep its cell (default 8). */
  gap?: number;
  /** Which sibling groups are tidied: `'all'` (default), `'roots'`, `'containers'`, or a container predicate. */
  in?: 'all' | 'roots' | 'containers' | ((d: Datum, i: number, data: Datum[]) => boolean);
}
/** Which rows a network layout positions: `'new'` only rows with no position yet
 *  (placed, locked and just-dropped rows stay), `'all'` every row on every commit. */
export type LayoutPlace = 'new' | 'all';
/** `layout.network.layered`: works on the nodes table of a dataset with links. */
export interface LayeredLayoutOptions {
  /** Which way the links run (default `'down'`). */
  direction?: 'down' | 'right' | 'up' | 'left';
  /** Space in px between neighbours in a rank (default 24). */
  gap?: number;
  /** Space in px between ranks (default 48). */
  rankGap?: number;
  /** Which rows the layout positions (default `'new'`). */
  place?: LayoutPlace;
  /** Which nodes the layout places (default: every node). The others stay where they are. */
  where?: (d: Datum, i: number, data: Datum[]) => boolean;
}
/** `layout.network.tree`: works on the nodes table of a dataset with links. */
export interface TreeLayoutOptions {
  /** Which way the tree grows from its root, or `'radial'` for rings round it (default `'down'`). */
  direction?: 'down' | 'right' | 'up' | 'left' | 'radial';
  /** Space in px between neighbours at one depth (default 12). */
  gap?: number;
  /** Space in px between depths (default 40). */
  rankGap?: number;
  /** Which rows the layout positions (default `'new'`). */
  place?: LayoutPlace;
  /** Which nodes the layout places (default: every node). The others stay where they are. */
  where?: (d: Datum, i: number, data: Datum[]) => boolean;
}
/** `layout.network.force`: works on the nodes table of a dataset with links. */
export interface ForceLayoutOptions {
  /** How far apart, in px, two linked nodes' centres sit (default 100). */
  length?: number;
  /** Space in px kept between boxes (default 8). */
  gap?: number;
  /** Which rows the layout positions (default `'new'`). */
  place?: LayoutPlace;
  /** Which nodes the layout places (default: every node). The others stay where they are. */
  where?: (d: Datum, i: number, data: Datum[]) => boolean;
}

// ── Guides (every option may be a literal or a function of the chart context) ─
export interface RuleGuideOptions {
  id?: string;
  x?: GuideOption<any>;
  y?: GuideOption<any>;
  stroke?: GuideOption<string>;
  strokeDash?: GuideOption<string>;
  strokeWidth?: GuideOption<number>;
  opacity?: GuideOption<number>;
  label?: GuideOption<string>;
}
export interface RegionGuideOptions {
  id?: string;
  /** A [lo, hi] pair on either axis. */
  x?: GuideOption<[any, any]>;
  y?: GuideOption<[any, any]>;
  fill?: GuideOption<string>;
  opacity?: GuideOption<number>;
  stroke?: GuideOption<string>;
  label?: GuideOption<string>;
}
export interface ImageGuideOptions {
  id?: string;
  /** The picture's URL. */
  src?: GuideOption<string>;
  /** A [lo, hi] pair in data units on either axis. Unset, the image spans the plot. */
  x?: GuideOption<[any, any]>;
  y?: GuideOption<[any, any]>;
  /** As CSS object-fit. Default 'fill', so data positions line up with the picture. */
  fit?: ImageFit;
  /** As CSS background-position. Default 'center'. */
  position?: string;
  /** As CSS background-repeat. Default 'no-repeat'. */
  repeat?: ImageRepeat;
  opacity?: GuideOption<number>;
}
export interface RemainingGuideOptions {
  id?: string;
  /** The column summed. Defaults to the chart's maintainSum field. */
  field?: GuideOption<string>;
  /** The target. Defaults to the chart's maintainSum total. */
  total?: GuideOption<number>;
  /** A noun ('token'), or a [singular, plural] pair. */
  unit?: GuideOption<string | [string, string]>;
  /** Formats the number. Takes the value, not the chart context. */
  format?: Format;
  anchor?: GuideOption<'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'>;
  /** Overrides the whole string. Takes the numbers, not the chart context. */
  label?: (remaining: number, used: number, total: number) => string;
  fill?: GuideOption<string>;
  fontSize?: GuideOption<number>;
}
export interface ProximityGuideOptions {
  id?: string;
  /** The feature id whose proximity session the guide draws. */
  target?: string;
  stroke?: string;
  strokeDash?: string;
  strokeWidth?: number;
  opacity?: number;
}
export interface PromptGuideOptions { id?: string; y?: number }
export interface OptionsGuideOptions {
  id?: string;
  /** How far under a ring its label sits (the `ring` design). */
  labelOffset?: number;
  radius?: number;
  /** One answer (`'radio'`, the default) or several (`'check'`): which control a box design draws. */
  control?: 'radio' | 'check';
}
export interface CellGridGuideOptions { id?: string; pad?: number }
export interface SliderTrackGuideOptions { id?: string; format?: Format }
export interface QuadrantsGuideOptions { id?: string; x?: string; y?: string }
/** `guides.tip`: the row under the pointer, drawn as a box of its values. */
export interface TipGuideOptions {
  id?: string;
  /** Only rows of this mark (its `id`); default: whichever mark is under the pointer. */
  mark?: string;
  /** The columns to show, or a function of the row returning a string or lines. Default: every column. */
  text?: string[] | ((row: Datum, ctx: any) => string | string[]);
  /** Beside the pointer (default) or at the mark's centre. */
  anchor?: 'pointer' | 'mark';
  dx?: number;
  dy?: number;
  fill?: string;
  stroke?: string;
  fontSize?: number;
  /** How a number prints: a d3 format specifier or a function. */
  format?: string | ((v: any) => string);
  /** Show for a finger, while it is on the chart (default `true`). */
  touch?: boolean;
}
/** `guides.crosshair`: rules that follow the pointer, with the axis value read out at the plot edge. */
export interface CrosshairGuideOptions {
  id?: string;
  x?: boolean;
  y?: boolean;
  readout?: boolean;
  stroke?: string;
  strokeDash?: string;
  fontSize?: number;
  format?: string | ((v: any) => string);
  /** Show for a finger, while it is on the chart (default `true`). */
  touch?: boolean;
}

// ── Widgets ────────────────────────────────────────────────────────────────
export interface LikertOptions extends WidgetOptions { options?: string[]; value?: any }
export interface MultipleChoiceOptions extends WidgetOptions { options?: string[]; max?: number; value?: any[] }
export interface SliderOptions extends WidgetOptions { domain?: [number, number]; step?: number; value?: number; format?: (v: any) => string }
export interface MatrixOptions extends WidgetOptions { questions?: string[]; options?: string[]; value?: any[] }
export interface LineConeOptions extends Omit<WidgetOptions, 'stage'> {
  /** The two axis field names. */
  x?: string;
  y?: string;
  /** Seed correlation and spread. */
  r?: number;
  spread?: number;
  samples?: number;
  seed?: number;
  render?: 'region' | 'gradient' | 'samples';
}
export interface RankingOptions extends WidgetOptions { items?: string[] }
export interface AllocationOptions extends WidgetOptions { categories?: string[]; total?: number; values?: number[] }
export interface ProbabilityTokensOptions extends WidgetOptions { bins?: string[]; maxTokens?: number }
export interface IntervalOptions extends WidgetOptions { category?: string; mean?: number; lo?: number; hi?: number; domain?: [number, number]; /** Dragging one end mirrors the other about the mean. */ symmetric?: boolean }
export interface HistogramOptions extends WidgetOptions { bins?: string[]; max?: number; values?: number[] }
export interface RegionWidgetOptions extends WidgetOptions {
  xDomain?: [number, number];
  yDomain?: [number, number];
  x1?: number; x2?: number; y1?: number; y2?: number;
}
export interface ThermometerOptions extends WidgetOptions { domain?: [number, number]; step?: number; value?: number }
export interface LabeledValueOptions extends WidgetOptions { input?: 'number' | 'text'; value?: any; domain?: [number, number]; label?: string }

// ── The `ui` layer: menus, icons and handles laid over a chart after it is made
// (`ui.attach(chart, parts)`). Not part of a spec and with no JSON form. It reads
// the chart through `scene` / `hit` / `scale` / `edits` and writes through
// `control`, `emit` and `set`, so anyone can build the same on those.

/** The `ui` layer's tokens (`theme.ui`), handed to the layer as CSS variables. */
export interface UiTheme {
  /** A menu's and a button's background. */
  surface: string;
  /** Labels and icons. */
  ink: string;
  /** A heading, an unavailable item. */
  muted: string;
  border: string;
  /** Hover, focus, the active icon. */
  accent: string;
  /** An action that removes. */
  danger: string;
  shadow: string;
  /** A menu's corner radius, px. */
  radius: number;
  /** An icon button's side, px. */
  size: number;
  /** The space between a mark and what sits beside it, px. */
  gap: number;
  fontSize: number;
}

/** One piece of UI over a chart. `mount` builds it in the layer and may return its teardown. */
export interface UiPart {
  /** The keyword that built it ('contextMenu', 'network', 'custom', …). */
  type: string;
  mount(ctx: UiContext): void | (() => void);
}

/** Where an element sits around its anchor: on a side or corner of a view's box, `offset` px out. */
export interface Placement {
  at?: 'center' | 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** How far out from that side, in CSS px. */
  offset?: number;
  dx?: number;
  dy?: number;
}

/** A built-in or registered icon name, SVG markup, or an element. */
export type UiIcon = string | Element;

export interface ButtonOptions {
  icon?: UiIcon;
  /** The accessible name and tooltip. */
  label?: string;
  tone?: 'danger';
  onClick?: (event: Event) => void;
}

/** A row of an open menu. */
export interface MenuItem {
  label?: string;
  icon?: UiIcon;
  /** A colour chip in place of an icon. */
  swatch?: string;
  /** Present on a row that is one of a set of choices; true on the current one. */
  checked?: boolean;
  disabled?: boolean;
  tone?: 'danger';
  onSelect?: () => void;
  separator?: boolean;
  /** A caption above the rows that follow. */
  heading?: string;
}

/** The pointer over the chart, as a part hears it. `point` is in inner chart pixels. */
export interface UiPointerEvent {
  /** 'move' once per frame; 'leave'; 'menu' for a right-click (`event.preventDefault()` takes it). */
  type: 'move' | 'leave' | 'menu';
  point: Point | null;
  event: Event;
}

/** One step of a drag started on a layer element. `dx`/`dy` are CSS px since the press. */
export interface UiDragStep {
  point: Point;
  dx: number;
  dy: number;
  event: Event;
}

export interface UiDragHandlers {
  /** On the first movement, with the point where the press went down. */
  start?: (step: UiDragStep) => void;
  move?: (step: UiDragStep) => void;
  end?: (step: UiDragStep) => void;
  /** Escape, or the pointer was lost. */
  cancel?: () => void;
  /** A press that never moved. */
  click?: (step: UiDragStep) => void;
}

/** What a part's `mount(ctx)` gets. Everything it registers is released when the layer detaches. */
export interface UiContext {
  chart: Chart;
  /** The layer: one element over the chart's drawing, the parent of everything a part adds. */
  layer: HTMLElement;
  /**
   * Keep `el` at an anchor (a point in inner pixels, a view, or a function read
   * each frame), re-placed on every render. A view follows its row. Returns its removal.
   */
  place(
    el: HTMLElement,
    anchor: SceneView | Point | null | (() => SceneView | Point | null),
    placement?: Placement | (() => Placement),
  ): () => void;
  /** Re-run every placement now, after a part changes what it is anchored to. */
  refresh(): void;
  /** An icon button, not yet in the layer: `place` it or append it to an element you placed. */
  button(options: ButtonOptions): HTMLButtonElement;
  icon(icon: UiIcon): Element;
  /** Open a menu at a point in inner pixels. One menu is open at a time. */
  menu(items: MenuItem[], at: Point): { element: HTMLElement; close(): void };
  onRender(cb: () => void): () => void;
  onPointer(cb: (event: UiPointerEvent) => void): () => void;
  /** Make a layer element a drag source. */
  drag(el: HTMLElement, handlers: UiDragHandlers): () => void;
  /**
   * Take the chart's next press for the layer: until the returned function is
   * called, the chart's own gestures see nothing. For a two-step action.
   */
  capture(handlers: { move?: (point: Point) => void; press?: (point: Point) => void; cancel?: () => void }): () => void;
}

/** The value behind a mark's channel, as a part reads and writes it. */
export interface UiValue {
  channel: string;
  field: string;
  table: string | null;
  scale: ChartScale;
  /** The declared value edit that writes it, or null when `chart.set` does. */
  edit: string | null;
  /** The choices, for a discrete channel. */
  values: any[] | null;
  swatch(value: any): string | null;
  read(index: number): any;
  write(index: number, value: any): void;
}

/** What a right-click landed on. `view` is null over empty space. */
export interface MenuTarget {
  view: SceneView | null;
  point: Point;
}

/**
 * One entry of `ui.contextMenu`. An edit to fire on the row, or at the point for
 * one that creates (`edit`); a channel whose value to choose (`channel`); both
 * (add a row with the chosen value); or a row of your own (`label` + `onSelect`).
 */
export interface MenuEntry {
  /** The name of a declared edit. */
  edit?: string;
  /** A channel of the mark: one row per value, the current one checked. */
  channel?: string;
  /** The mark that channel is on. Default: the mark under the pointer. */
  mark?: string;
  /** The choices, for a channel whose scale lists none. */
  values?: any[];
  /** The row's text, or the heading over a channel's values (`false` for none). */
  label?: string | false;
  icon?: UiIcon;
  tone?: 'danger';
  disabled?: boolean;
  /** Where the entry shows: 'plane' for empty space, or a mark's id. Default: wherever it applies. */
  on?: string;
  onSelect?: (target: MenuTarget) => void;
  separator?: boolean;
  heading?: string;
}

export interface ContextMenuOptions {
  /** The entries, or a function of what was right-clicked. Default: what the spec's named edits allow. */
  items?: MenuEntry[] | ((target: MenuTarget) => MenuEntry[]);
}

/** One icon of `ui.actions`: an edit to drive, or a button of your own. */
export interface ActionItem {
  icon: UiIcon;
  label: string;
  tone?: 'danger';
  /** The name of a declared edit. A drag edit is dragged from the button. */
  edit?: string;
  onClick?: (view: SceneView) => void;
  /** Leave the icon out for some pieces. */
  show?: (view: SceneView) => boolean;
}

export interface ActionsOptions {
  /** Which drawn pieces get the icons. Default: every row's. */
  on?: SceneQuery;
  items?: ActionItem[];
  /** How near the pointer must come, px. Default 24. */
  reach?: number;
  /** Where the icons sit on the piece. Default 'top-right'. */
  placement?: Placement['at'];
}

export interface HandlesOptions {
  /** The mark to put handles on. Default: the first that sizes from data. */
  on?: { mark?: string };
  /** Grips that resize along the sides the mark sizes from data (`width`, `height`). Default true. */
  resize?: boolean;
  /** A grip above the box that turns it, writing the mark's `angle` field. Shift snaps to 15°. Default false. */
  rotate?: boolean;
  /** A grip below the box that moves it, writing the mark's `x` and `y` fields. Default false. */
  move?: boolean;
}

export interface NetworkOptions {
  /**
   * Icons beside a port: "+" adds a node on that side, linked from this one; a
   * link icon connects to a node already there; detach shows where a link is
   * docked. Default true.
   */
  ports?: boolean;
  /** Icons on a link: reverse, "+" to put a new node on it where the pointer met it, remove. Default true. */
  links?: boolean;
  /** The right-click menu. `{ channel }` names the node channel its categories come from (default: a discrete `fill`). */
  menu?: boolean | { channel?: string };
  /** Grips on a node that sizes from data. Default true. */
  resize?: boolean;
  /** The edit behind each action, by name. Default: found by what the edit does. */
  edits?: {
    connect?: string;
    rewire?: string;
    reverse?: string;
    /** Removes a link. */
    unlink?: string;
    /** Removes a node. */
    remove?: string;
    /** Adds a node. */
    create?: string;
  };
}
