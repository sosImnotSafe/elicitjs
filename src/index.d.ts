/**
 * Public API typings for `elicitjs`.
 * Shape interfaces live in `./types`; this file declares the callable surface.
 *
 * Every factory's options are typed on a per-factory interface whose runtime twin
 * is `src/vocabulary.js`; `npm run check:exports` holds the two to each other.
 */
import type {
  AllocationOptions,
  AnchorOptions,
  ArcOptions,
  AreaOptions,
  AxisOptions,
  AxisRadialOptions,
  AxisScaleOptions,
  AxisZoomOptions,
  AxisPanOptions,
  BarOptions,
  BrushRectOptions,
  BrushSpanOptions,
  CellGridGuideOptions,
  ChartElement,
  ClampOptions,
  CompositeOptions,
  Constraint,
  ConstraintContext,
  ConstraintResult,
  CountOptions,
  CreateOptions,
  CrosshairGuideOptions,
  QuadrantsGuideOptions,
  TipGuideOptions,
  CurveOptions,
  DeepPartial,
  DotStackOptions,
  DrawOptions,
  Edit,
  EditOptions,
  EditTextOptions,
  Chart,
  Dataset,
  DatasetSpec,
  GestureRecord,
  PatchOptions,
  PatchResult,
  PatchSpec,
  ElicitSpec,
  EllipseOptions,
  FaceOptions,
  GeoBasemapOptions,
  GeoBrushOptions,
  GeoCreateRectOptions,
  GeoDrawOptions,
  GeoLineOptions,
  GeoPointOptions,
  GeoPolygonOptions,
  GeoRectOptions,
  GeoRemoveVertexOptions,
  GeoTextOptions,
  GeoTileOptions,
  GridOptions,
  Guide,
  HistogramOptions,
  IntervalOptions,
  LabeledValueOptions,
  LegendEditOptions,
  LegendElementOptions,
  LikertOptions,
  LineConeOptions,
  LineOptions,
  LinkOptions,
  MaintainSumOptions,
  Mark,
  HierarchyNestOptions,
  MatrixOptions,
  MonotonicOptions,
  MoveOptions,
  MultipleChoiceOptions,
  NeedleOptions,
  NetworkConnectOptions,
  NetworkEndpointOptions,
  NewSeriesOptions,
  NodeOptions,
  OptionsGuideOptions,
  OrderingOptions,
  FollowOptions,
  SymmetricOptions,
  PointOptions,
  ShapeOptions,
  ProbabilityTokensOptions,
  PromptGuideOptions,
  ProximityGuideOptions,
  RankingOptions,
  RectOptions,
  RegionGuideOptions,
  RegionWidgetOptions,
  RemainingGuideOptions,
  Renderer,
  RotateOptions,
  RuleGuideOptions,
  RuleOptions,
  ScaleCategoriesOptions,
  SelectEditOptions,
  SliderOptions,
  SliderTrackGuideOptions,
  SlideOptions,
  SnapOptions,
  SpacingOptions,
  StackCutOptions,
  StickerOptions,
  TextOptions,
  Theme,
  ThemeName,
  ThemeSpec,
  ThermometerOptions,
  TickOptions,
  ToggleOptions,
  TrendBandOptions,
  TrendEditOptions,
  TrendOptions,
  UniqueOptions,
  WaffleOptions,
} from './types.js';

export type * from './types.js';

/** A dataset and one chart over it: `Elicit.dataset(spec).chart(spec)` in one call. */
export function Elicit(spec: ElicitSpec): Chart;
export namespace Elicit {
  /** A dataset that any number of charts read and write: `ds.chart(spec)`. */
  function dataset(spec: DatasetSpec): Dataset;
}

/**
 * MARKS — features that view DATA (`views: 'data'`): one node per row, channels
 * name columns, and a channel carrying an `edit` writes that column back.
 *
 * Closed on purpose (no index signature): these names are the grammar's mark
 * vocabulary, so an unknown one should be an error, not `any`.
 *
 * Every name here is a KEYWORD. The `…X` / `…Y` pairs are the bare mark with its
 * `orientation` pinned — `barY(o) === bar({ ...o, orientation: 'vertical' })` —
 * and a JSON spec may name either. `path` is `line({ connect: 'sequence' })`;
 * `donut` is `arc` with an inner radius; `face`, `node` and `sticker` are
 * `composite`s of ordinary marks. There is no `pie`: a full pie IS `arc()`.
 */
export const plot: {
  // Rectangular / interval
  bar(options?: BarOptions): Mark;
  barX(options?: BarOptions): Mark;
  barY(options?: BarOptions): Mark;
  rect(options?: RectOptions): Mark;
  rectX(options?: RectOptions): Mark;
  rectY(options?: RectOptions): Mark;
  tick(options?: TickOptions): Mark;
  tickX(options?: TickOptions): Mark;
  tickY(options?: TickOptions): Mark;
  rule(options?: RuleOptions): Mark;
  ruleX(options?: RuleOptions): Mark;
  ruleY(options?: RuleOptions): Mark;
  waffle(options?: WaffleOptions): Mark;
  waffleX(options?: WaffleOptions): Mark;
  waffleY(options?: WaffleOptions): Mark;
  // Point / token
  point(options?: PointOptions): Mark;
  ellipse(options?: EllipseOptions): Mark;
  /** One path per row: a pictogram, a d3 symbol, any SVG path, with every x/y mark's behaviour. */
  shape(options?: ShapeOptions): Mark;
  dotStack(options?: DotStackOptions): Mark;
  dotStackX(options?: DotStackOptions): Mark;
  dotStackY(options?: DotStackOptions): Mark;
  // Connected sequences. `line` reads a value against a domain axis; `path`
  // connects points in creation order with both axes free.
  line(options?: LineOptions): Mark;
  lineX(options?: LineOptions): Mark;
  lineY(options?: LineOptions): Mark;
  path(options?: LineOptions): Mark;
  area(options?: AreaOptions): Mark;
  areaX(options?: AreaOptions): Mark;
  areaY(options?: AreaOptions): Mark;
  curve(options?: CurveOptions): Mark;
  curveX(options?: CurveOptions): Mark;
  curveY(options?: CurveOptions): Mark;
  // Angular
  arc(options?: ArcOptions): Mark;
  donut(options?: ArcOptions): Mark;
  needle(options?: NeedleOptions): Mark;
  // Text
  text(options?: TextOptions): Mark;
  textX(options?: TextOptions): Mark;
  textY(options?: TextOptions): Mark;
  // Parametric — channels are PARAMETERS of a curve, not columns of free rows.
  trend(options?: TrendOptions): Mark;
  trendBand(options?: TrendBandOptions): Mark;
  // Glyphs — a composite desugars into its parts, so these return the PARTS.
  composite(options?: CompositeOptions): Mark[];
  face(options?: FaceOptions): Mark[];
  node(options?: NodeOptions): Mark[];
  sticker(options?: StickerOptions): Mark[];
  // Network — the one mark whose geometry comes from a JOIN.
  link(options?: LinkOptions): Mark;
  // Geographic — placed through the chart's `projection`.
  geoBasemap(options?: GeoBasemapOptions): Mark;
  geoTile(options?: GeoTileOptions): Mark;
  geoPoint(options?: GeoPointOptions): Mark;
  geoPolygon(options?: GeoPolygonOptions): Mark;
  geoLine(options?: GeoLineOptions): Mark;
  geoText(options?: GeoTextOptions): Mark;
  geoRect(options?: GeoRectOptions): Mark;
};

/**
 * CHART ELEMENTS — features that view a SCALE (`views: 'scale'`): they draw
 * chrome for a scale rather than rows, take a singular `channel` instead of a
 * `channels` map, and their edits reshape the schema's DOMAIN.
 */
export const elements: {
  axis(options?: AxisOptions): ChartElement;
  axisX(options?: AxisOptions): ChartElement;
  axisY(options?: AxisOptions): ChartElement;
  axisRadial(options?: AxisRadialOptions): ChartElement;
  grid(options?: GridOptions): ChartElement;
  gridX(options?: GridOptions): ChartElement;
  gridY(options?: GridOptions): ChartElement;
  legend(options?: LegendElementOptions): ChartElement;
  legendColor(options?: LegendElementOptions): ChartElement;
  legendSize(options?: LegendElementOptions): ChartElement;
  legendSymbol(options?: LegendElementOptions): ChartElement;
};

/**
 * EDITS — a gesture -> data, through the same scale the channel encodes with.
 *
 * Universal edits work on any mark carrying the channels they govern. The scoped
 * namespaces name what their edits are ABOUT; the JS path is also the JSON
 * keyword and the descriptor's `type` (`edit.line.draw()` <-> `{ "type": "line.draw" }`).
 *
 * NAMESPACE and `scope` are separate: the namespace is the subject, `scope` names
 * a mark capability the engine checks. `edit.network.connect` is in the `network`
 * namespace but carries no scope, because it goes on an ordinary node mark.
 */
export const edit: {
  // ── position ──────────────────────────────────────────────────────────────
  move(options?: MoveOptions): Edit;
  moveSpan(options?: EditOptions): Edit;
  brushSpan(options?: BrushSpanOptions): Edit;
  brushRect(options?: BrushRectOptions): Edit;
  // ── magnitude / angle / discrete step ────────────────────────────────────
  slide(options?: SlideOptions): Edit;
  resize(options?: EditOptions): Edit;
  rotate(options?: RotateOptions): Edit;
  cycle(options?: EditOptions): Edit;
  // ── existence ─────────────────────────────────────────────────────────────
  create(options?: CreateOptions): Edit;
  toggle(options?: ToggleOptions): Edit;
  remove(options?: EditOptions): Edit;
  // ── value ─────────────────────────────────────────────────────────────────
  set(options?: EditOptions): Edit;
  editText(options?: EditTextOptions): Edit;
  rank(options?: EditOptions): Edit;
  // ── chart state (writes no data row) ─────────────────────────────────────
  select(options?: SelectEditOptions): Edit;
  // ── escape hatch: the one factory whose options are an open bag, for the
  //    knobs a custom driver (registerDriver) reads off the descriptor ───────
  custom(fn: Edit['apply'], options?: EditOptions & Record<string, unknown>): Edit;

  /** Arbitration predicates for an edit's `when`. */
  when: {
    shift(ctx: import('./types.js').EditContext): boolean;
    noShift(ctx: import('./types.js').EditContext): boolean;
    alt(ctx: import('./types.js').EditContext): boolean;
    noAlt(ctx: import('./types.js').EditContext): boolean;
    modifier(key: string): (ctx: import('./types.js').EditContext) => boolean;
    noModifier(key: string): (ctx: import('./types.js').EditContext) => boolean;
    near(ctx: import('./types.js').EditContext): boolean;
    far(ctx: import('./types.js').EditContext): boolean;
    nearWithin(threshold: number): (ctx: import('./types.js').EditContext) => boolean;
  };

  /** Needs SERIES grouping (`scope: 'line'`). */
  line: {
    anchor(options?: AnchorOptions): Edit;
    newSeries(options?: NewSeriesOptions): Edit;
    draw(options?: DrawOptions): Edit;
    sweep(options?: MoveOptions): Edit;
    removeSeries(options?: AnchorOptions): Edit;
  };
  /**
   * Reshapes the DOMAIN of the scale a chart element draws (the schema), not the
   * dataset. Works on any element that draws one — an axis or a legend.
   */
  scale: {
    /** Returns THREE edits — one authoring act, three descriptors. Spread it. */
    categories(options?: ScaleCategoriesOptions): Edit[];
  };
  /** Axis-only: drags a positional RANGE, which only an axis has. */
  axis: {
    scale(options?: AxisScaleOptions): Edit;
    /** The wheel narrows or widens the axis's domain about the value under the pointer. */
    zoom(options?: AxisZoomOptions): Edit;
    /** Drag the plot to slide the axis's domain along. Composes with zoom. */
    pan(options?: AxisPanOptions): Edit;
  };
  /** Turns a legend into an input; reads geometry only a legend stamps. */
  legend: {
    category(options?: LegendEditOptions): Edit;
    value(options?: EditOptions): Edit;
  };
  /** A whole divided among rows: `cut` splits, `edge` moves value across a
   *  boundary, `merge` fuses — each preserving the total by construction. */
  stack: {
    cut(options?: StackCutOptions): Edit;
    edge(options?: EditOptions): Edit;
    merge(options?: EditOptions): Edit;
  };
  /** A parametric line is edited by its PARAMETERS. */
  trend: {
    intercept(options?: TrendEditOptions): Edit;
    slope(options?: TrendEditOptions): Edit;
    interceptSpread(options?: TrendEditOptions): Edit;
    slopeSpread(options?: TrendEditOptions): Edit;
  };
  waffle: {
    fill(options?: EditOptions): Edit;
  };
  /** The gestures that build a network's TOPOLOGY. Creating and deleting a node
   *  are plain `create`/`remove`. */
  network: {
    connect(options?: NetworkConnectOptions): Edit;
    rewire(options?: EditOptions): Edit;
    reverse(options?: NetworkEndpointOptions): Edit;
  };
  /** The gestures that build a hierarchy's CONTAINMENT. Moving a container is the
   *  plain `move` (its contents are carried), and a node is made and deleted by
   *  plain `create`/`remove`. */
  hierarchy: {
    nest(options?: HierarchyNestOptions): Edit;
  };
  /** Placed through the chart's `projection`. */
  geo: {
    move(options?: EditOptions): Edit;
    create(options?: CreateOptions): Edit;
    draw(options?: GeoDrawOptions): Edit;
    dragVertex(options?: EditOptions): Edit;
    removeVertex(options?: GeoRemoveVertexOptions): Edit;
    brush(options?: GeoBrushOptions): Edit;
    createRect(options?: GeoCreateRectOptions): Edit;
  };
};

/**
 * CONSTRAINTS — pure data invariants over the elicited dataset. They gate and
 * REPAIR every edit, whichever mark fired it. Each returns a descriptor
 * `{ type, field?, options, apply }` (see `ConstraintSpec`); a `field` left out
 * means "the column the dispatching edit writes".
 */
export const constraints: {
  /** The extension point: author a rule against a data-only context. One word for
   *  "author your own X" in every grammar namespace — cf. `edit.custom`,
   *  `guides.custom`. (`authoring.defineConstraint` is the same function.) */
  custom(
    fn: (ctx: ConstraintContext) => ConstraintResult,
    meta?: { type?: string; field?: string | string[]; options?: Record<string, unknown>; table?: string; guide?: (ctx: any) => any[] },
  ): Constraint;
  clamp(options?: ClampOptions): Constraint;
  maintainSum(options?: MaintainSumOptions): Constraint;
  count(options?: CountOptions): Constraint;
  unique(options?: UniqueOptions): Constraint;
  snap(options?: SnapOptions): Constraint;
  ordering(options?: OrderingOptions): Constraint;
  /** Columns that move with a lead column by the same delta (a range with its mean). */
  follow(options?: FollowOptions): Constraint;
  /** A pair mirrored about a centre column when one end moves. */
  symmetric(options?: SymmetricOptions): Constraint;
  monotonic(options?: MonotonicOptions): Constraint;
  spacing(options?: SpacingOptions): Constraint;
};

/**
 * GUIDES — features that view chart STATE (`views: 'state'`). They draw the rule
 * and the state (a target line, a catchment, what is left to allocate), are
 * derived from the live chart rather than from a row, and write nothing.
 */
export const guides: {
  /** A reference line at a value, positioned through the scales. */
  rule(options?: RuleGuideOptions): Guide;
  /** A shaded band between two values — an acceptable range, a target zone. */
  region(options?: RegionGuideOptions): Guide;
  /** What is left to allocate under a rule. Reads its target from a
   *  `maintainSum` constraint when you don't pass one, so the number the reader
   *  is held to and the number they are shown cannot drift. */
  remaining(options?: RemainingGuideOptions): Guide;
  /** The catchment of a proximity pick — how far it reaches to find a mark. */
  proximity(options?: ProximityGuideOptions): Guide;
  /** The escape hatch: arbitrary read-only nodes from the live context. Named to
   *  match `edit.custom` / `constraints.custom`. */
  custom(fn: (ctx: any) => import('./types.js').FeatureNode[], options?: { tracksPointer?: boolean }): Guide;
  /** A question prompt above an instrument. */
  prompt(text: string, options?: PromptGuideOptions): Guide;
  /** A choice's options, one per category, drawn in the theme's design (rings by default). */
  options(options?: OptionsGuideOptions): Guide;
  /** A matrix instrument's cell grid. */
  cellGrid(options?: CellGridGuideOptions): Guide;
  /** A slider's track. */
  sliderTrack(options?: SliderTrackGuideOptions): Guide;
  /** The quadrant frame of a correlation plot (axes through the centre, high/low labels). */
  quadrants(labels?: QuadrantsGuideOptions): Guide;
  /** The row under the pointer, drawn as a box of its values. */
  tip(options?: TipGuideOptions): Guide;
  /** Rules that follow the pointer, with the axis value read out at the plot edge. */
  crosshair(options?: CrosshairGuideOptions): Guide;
};

/**
 * WIDGETS — named survey instruments. Each is a pure recipe over the core API and
 * returns a whole `ElicitSpec`; in JSON it sits under `widget`. How they are drawn
 * is the design `theme.widget.design` names: `'ring'` (the default), `'box'`
 * (`theme: 'survey'`), `'block'` (`'surveyBlocks'`), `'line'` (`'surveyLines'`),
 * or one registered with `authoring.registerDesign`.
 */
export const widgets: {
  likert(options?: LikertOptions): ElicitSpec;
  multipleChoice(options?: MultipleChoiceOptions): ElicitSpec;
  slider(options?: SliderOptions): ElicitSpec;
  matrix(options?: MatrixOptions): ElicitSpec;
  lineCone(options?: LineConeOptions): ElicitSpec;
  ranking(options?: RankingOptions): ElicitSpec;
  allocation(options?: AllocationOptions): ElicitSpec;
  probabilityTokens(options?: ProbabilityTokensOptions): ElicitSpec;
  interval(options?: IntervalOptions): ElicitSpec;
  histogram(options?: HistogramOptions): ElicitSpec;
  region(options?: RegionWidgetOptions): ElicitSpec;
  thermometer(options?: ThermometerOptions): ElicitSpec;
  labeledValue(options?: LabeledValueOptions): ElicitSpec;
};

/**
 * The AUTHORING KIT — what you build new vocabulary FROM. Deliberately outside the
 * grammar namespaces: none of these can appear in a spec.
 *
 * Also importable directly: `import { encodeChannel } from 'elicitjs/authoring'`.
 */
export const authoring: typeof import('./authoring/index.js');

/**
 * FORMATTERS — each returns a `(value) => string`. Every one is sugar over a d3
 * format specifier, which is why a `format` option also accepts the specifier
 * STRING directly: that keeps the option declarative (and expressible in JSON)
 * while the named helpers stay the readable spelling in JS.
 */
export const format: {
  /** A d3 number specifier, e.g. `'.1f'`. */
  number(specifier?: string): (v: any) => string;
  /** Default `'.0%'`. */
  percent(specifier?: string): (v: any) => string;
  /** SI prefix, default `'.2s'`. */
  si(specifier?: string): (v: any) => string;
  /** A d3 time specifier, default `'%Y-%m-%d'`. */
  time(specifier?: string): (v: any) => string;
  /** Wrap another format with a leading / trailing string. */
  prefix(prefix: string, inner?: string): (v: any) => string;
  suffix(suffix: string, inner?: string): (v: any) => string;
  /** Resolve a specifier string (or a function) to a formatter. */
  resolveFormat(format?: string | ((v: any) => any)): (v: any) => string;
};

export class D3Renderer implements Renderer {
  render(context: import('./types.js').RenderContext): void;
}

export class CanvasRenderer implements Renderer {
  render(context: import('./types.js').RenderContext): void;
}

/** The built-in named themes. `default`, `survey` and `dark` are ElicitJS's own;
 *  the other fourteen are Flint's house styles (https://github.com/microsoft/flint-chart). */
export const themes: Record<ThemeName, DeepPartial<Theme> & { extends?: ThemeName }>;
export function setTheme(theme: ThemeSpec | null): void;
export function resolveTheme(partial?: ThemeSpec): Theme;
export const DEFAULT_THEME: Theme;

/**
 * Developer diagnostics are ON by default and print with an `[elicit]` prefix.
 * A consumer's production build goes quiet on its own (`NODE_ENV`); call this to
 * silence them explicitly.
 */
export function setWarnings(enabled: boolean): void;

// ── The JSON spec layer ─────────────────────────────────────────────────────
/** A function in a JSON spec: the name it was registered under, or an expression. */
export type JsonFunction = { fn: string } | { expr: string };
/** What `compile` takes. A JSON spec is the JavaScript spec with every factory
 *  call written `{ "type": "<keyword>", ...options }` and every function written
 *  as a `JsonFunction`. */
export type JsonSpec = Record<string, unknown>;
export interface CompileOptions {
  /** Functions the spec names with `{ "fn": "<name>" }`. Wins over `registerFunction`. */
  functions?: Record<string, Function>;
}
/**
 * Compile a JSON spec into the spec `Elicit()`, `Elicit.dataset()` or
 * `dataset.chart()` takes: `Elicit(compile(json))`. A compiled spec builds one
 * chart, so compile again for another.
 */
export function compile(json: JsonSpec, options?: CompileOptions): ElicitSpec;
/** Register a function under the name a JSON spec refers to it by. */
export function registerFunction(name: string, fn: Function): void;

/** What `recorder()` returns: the library's namespaces, recording. */
export interface Recorder {
  plot: typeof plot;
  elements: typeof elements;
  edit: typeof edit;
  constraints: typeof constraints;
  guides: typeof guides;
  widgets: typeof widgets;
  format: typeof format;
  /** The JSON for a spec built from these namespaces, and the functions it names.
   *  Throws, with the path, for a value that has no JSON form. */
  toJSON(spec: object): { json: JsonSpec; functions: Record<string, Function> };
  /** Run `fn` with the namespaces building for real, as a function the spec keeps may need. */
  live<T>(fn: () => T): T;
  /** From now on the namespaces build for real. */
  stop(): void;
}
/**
 * Record a spec written in JavaScript as its JSON spec. Build the spec from the
 * recorder's namespaces, then call `toJSON(spec)`. An arrow function that reads as
 * an expression becomes an `expr`; any other function is named, from `functions`
 * or after its option, and returned alongside.
 */
export function recorder(options?: CompileOptions): Recorder;
