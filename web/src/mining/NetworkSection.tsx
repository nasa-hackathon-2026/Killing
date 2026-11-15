import { useMemo, useState } from "react";
import {
  edgePath,
  edgeWidth,
  formatR,
  formatSmall,
  lagLabel,
  networkLayout,
  significantEdges,
  type GraphEdge,
  type VariableGraphFile,
} from "../analysis/miningPlus";
import { MethodDetails } from "./parts";
import { useI18n } from "../i18n";

const WIDTH = 1000;
const ROW_HEIGHT = 108;
const LABEL_WIDTH = 190;
const NODE_RADIUS = 9;

const KIND_LABELS: Record<string, string> = {
  model: "model",
  satellite_retrieval: "satellite",
  in_situ: "station",
  unknown: "unknown",
};

function shortName(name: string): string {
  // "Soil moisture 0–10 cm (GLDAS Noah)" → "Soil moisture 0–10 cm"
  return name.replace(/ \([^)]*\)$/, "");
}

// "MODIS Terra 250 m 16-day, via Planetary Computer" → "MODIS Terra, PC"
function product(name: string): string {
  return (/\(([^)]*)\)$/.exec(name)?.[1] ?? "")
    .replace(" 250 m 16-day", "")
    .replace("via Planetary Computer", "PC")
    .replace("NASA POWER, MERRA-2", "POWER");
}

export function NetworkSection({ file }: { file: VariableGraphFile }) {
  const { t } = useI18n();
  const [tableId, setTableId] = useState("region");
  const [lag, setLag] = useState<"all" | 0 | 1>("all");
  const [activeEdge, setActiveEdge] = useState<number | null>(null);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const table = file.tables[tableId];
  const names = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(file.variables).map(([id, item]) => [id, item.name_en]),
      ),
    [file],
  );
  const layout = useMemo(
    () =>
      networkLayout(
        (table?.nodes ?? []).map((node) => ({
          id: node.variable_id,
          categoryPath: file.variables[node.variable_id]?.category_path ?? "",
        })),
        WIDTH,
        ROW_HEIGHT,
        LABEL_WIDTH,
      ),
    [table, file],
  );
  if (!table) return null;
  const edges = significantEdges(table, lag);
  const position = new Map(layout.nodes.map((node) => [node.variableId, node]));
  // Several edges can join the same two variables (same month, and one month
  // apart in either direction): give each its own bend.
  const seen = new Map<string, number>();
  const drawn = edges.map((edge) => {
    const key = [edge.source, edge.target].sort().join("|");
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    const a = position.get(edge.source);
    const b = position.get(edge.target);
    const sameRow = a && b && a.stratum === b.stratum;
    const base = sameRow ? 26 : 10;
    const bend = (base + count * 14) * (edge.source < edge.target ? 1 : -1);
    return { edge, path: a && b ? edgePath(a, b, bend) : "" };
  });
  const highlighted = (edge: GraphEdge) =>
    activeEdge === edge.edge_id ||
    (activeNode !== null &&
      (edge.source === activeNode || edge.target === activeNode));
  const dimmed = activeEdge !== null || activeNode !== null;
  const shownEdge = edges.find((edge) => edge.edge_id === activeEdge);
  const nodeEdges = activeNode
    ? edges.filter(
        (edge) => edge.source === activeNode || edge.target === activeNode,
      )
    : [];
  const routing = file.pgrouting?.[tableId];
  const world = file.world_cities;

  return (
    <section id="network" aria-labelledby="network-title">
      <h2 id="network-title">{t("mining.sections.network")}</h2>
      <p className="asks">
        <strong>{t("mining.label.asks")}</strong> {t("mining.network.asks")}
      </p>
      <p className="note">
        <strong>{t("mining.label.method")}</strong>{" "}
        {t("mining.network.method", {
          note: file.note,
          alpha: file.parameters.alpha,
        })}
      </p>
      <div className="controls">
        <label>
          {t("mining.control.table")}{" "}
          <select
            value={tableId}
            onChange={(event) => {
              setTableId(event.target.value);
              setActiveEdge(null);
              setActiveNode(null);
            }}
          >
            {Object.keys(file.tables).map((id) => (
              <option key={id} value={id}>
                {id === "point"
                  ? t("mining.control.taiwanPoints")
                  : t("mining.control.taiwanRegions")}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("mining.control.timing")}{" "}
          <select
            value={String(lag)}
            onChange={(event) => {
              const value = event.target.value;
              setLag(value === "all" ? "all" : value === "0" ? 0 : 1);
              setActiveEdge(null);
            }}
          >
            <option value="all">{t("mining.control.bothTimings")}</option>
            <option value="0">{t("mining.control.sameMonthOnly")}</option>
            <option value="1">{t("mining.control.oneMonthApartOnly")}</option>
          </select>
        </label>
      </div>
      <p className="note">
        Locations: {table.locations.join(", ")} · {table.nodes.length} variables
        · {table.n_tests} pairs tested · {table.n_significant} below the limit (
        {table.n_significant_by_lag["0"] ?? 0} same month,{" "}
        {table.n_significant_by_lag["1"] ?? 0} one month apart) ·{" "}
        {table.n_components} connected{" "}
        {table.n_components === 1 ? "group" : "groups"} · showing {edges.length}{" "}
        lines
      </p>
      <div className="scroll">
        <svg
          className="network"
          viewBox={`0 0 ${WIDTH} ${layout.height}`}
          role="img"
          aria-label={`Network of ${table.nodes.length} variables with ${edges.length} correlation lines, arranged by layer of the Earth system from the stratosphere at the top to the soil at the bottom. The table below lists the same lines.`}
        >
          {layout.rows.map((row) => (
            <g key={row.stratum}>
              <rect
                className="network-row"
                x={0}
                y={row.y - ROW_HEIGHT / 2 + 2}
                width={WIDTH}
                height={ROW_HEIGHT - 4}
                style={{ fill: row.color }}
              />
              <text className="network-row-label" x={10} y={row.y + 4}>
                {row.nameEn.replace("Troposphere: ", "")}
              </text>
            </g>
          ))}
          {drawn.map(({ edge, path }) => (
            <g key={edge.edge_id}>
              <path
                d={path}
                className={[
                  "network-edge",
                  edge.r > 0 ? "edge-positive" : "edge-negative",
                  edge.lag ? "edge-lagged" : "",
                  dimmed && !highlighted(edge) ? "edge-dim" : "",
                ].join(" ")}
                strokeWidth={edgeWidth(edge.r)}
              />
              <path
                d={path}
                className="network-edge-hit"
                onMouseEnter={() => setActiveEdge(edge.edge_id)}
                onMouseLeave={() => setActiveEdge(null)}
              />
            </g>
          ))}
          {layout.nodes.map((node) => {
            const info = table.nodes.find(
              (item) => item.variable_id === node.variableId,
            );
            const name = names[node.variableId] ?? node.variableId;
            return (
              <g
                key={node.variableId}
                className={
                  activeNode === node.variableId
                    ? "network-node node-active"
                    : "network-node"
                }
                tabIndex={0}
                role="button"
                aria-label={`${name}: ${info?.degree ?? 0} linked variables. Show its lines.`}
                aria-pressed={activeNode === node.variableId}
                onClick={() =>
                  setActiveNode((current) =>
                    current === node.variableId ? null : node.variableId,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveNode((current) =>
                      current === node.variableId ? null : node.variableId,
                    );
                  }
                }}
                onMouseEnter={() => setActiveNode(node.variableId)}
                onMouseLeave={() => setActiveNode(null)}
              >
                <circle cx={node.x} cy={node.y} r={NODE_RADIUS} />
                {/* Upper nodes of a row carry their label above, lower ones
                    below, so neighbours do not write over each other. */}
                <text
                  x={node.x}
                  y={node.above ? node.y - 27 : node.y + NODE_RADIUS + 13}
                >
                  {shortName(name)}
                </text>
                <text
                  className="node-product"
                  x={node.x}
                  y={node.above ? node.y - 15 : node.y + NODE_RADIUS + 25}
                >
                  {product(name)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="network-key note">
        <span className="key key-positive" /> rise and fall together (r &gt; 0){" "}
        <span className="key key-negative" /> move in opposite directions (r
        &lt; 0) <span className="key key-lagged" /> one month apart · thicker
        line = larger |r| · PC = via Planetary Computer · rows are the layers of
        the layer view, not to scale
      </p>
      <div className="network-info" aria-live="polite">
        {shownEdge ? (
          <p>
            <strong>
              {names[shownEdge.source] ?? shownEdge.source} and{" "}
              {names[shownEdge.target] ?? shownEdge.target}
            </strong>{" "}
            ({lagLabel(shownEdge.lag)}): r = {formatR(shownEdge.r)}, q ={" "}
            {formatSmall(shownEdge.q)}, effective sample size{" "}
            {Math.round(shownEdge.n_eff)} of {shownEdge.n_months_median} months,
            r by location {formatR(shownEdge.r_min)} to{" "}
            {formatR(shownEdge.r_max)}
            {shownEdge.known_issues
              ? "; one of the two has a documented data issue"
              : ""}
            .
          </p>
        ) : activeNode ? (
          <p>
            <strong>{names[activeNode] ?? activeNode}</strong>:{" "}
            {nodeEdges.length
              ? nodeEdges
                  .map((edge) => {
                    const other =
                      edge.source === activeNode ? edge.target : edge.source;
                    return `${names[other] ?? other} ${formatR(edge.r)}${edge.lag ? (edge.source === activeNode ? " (this one a month earlier)" : " (this one a month later)") : ""}`;
                  })
                  .join(" · ")
              : "no line below the limit"}
          </p>
        ) : (
          <p className="note">
            Point at a line or a variable, or move to a variable with the Tab
            key and press Enter, to read its numbers here.
          </p>
        )}
      </div>

      <h3>{t("mining.network.tableTitle")}</h3>
      <div className="scroll tall">
        <table>
          <thead>
            <tr>
              <th>{t("mining.network.column.first")}</th>
              <th>{t("mining.network.column.second")}</th>
              <th>{t("mining.network.column.timing")}</th>
              <th className="number">{t("mining.network.column.r")}</th>
              <th className="number">
                {t("mining.network.column.rByLocation")}
              </th>
              <th className="number">{t("mining.network.column.q")}</th>
              <th className="number">
                {t("mining.network.column.nEffective")}
              </th>
              <th>{t("mining.network.column.issue")}</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((edge) => (
              <tr key={edge.edge_id}>
                <td>{names[edge.source] ?? edge.source}</td>
                <td>{names[edge.target] ?? edge.target}</td>
                <td>{lagLabel(edge.lag)}</td>
                <td className="number">{formatR(edge.r)}</td>
                <td className="number">
                  {formatR(edge.r_min)} to {formatR(edge.r_max)}
                </td>
                <td className="number">{formatSmall(edge.q)}</td>
                <td className="number">{Math.round(edge.n_eff)}</td>
                <td>{edge.known_issues ? "yes" : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edges.length === 0 ? (
        <p className="note">
          {t("mining.extra.no_pair_is_below_the_limit_with_this_setting")}
        </p>
      ) : null}

      <h3>{t("mining.network.variablesTitle")}</h3>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>{t("mining.network.column.variable")}</th>
              <th>{t("mining.network.column.kind")}</th>
              <th className="number">{t("mining.network.column.linked")}</th>
              <th className="number">{t("mining.network.column.group")}</th>
              <th>{t("mining.network.column.issues")}</th>
            </tr>
          </thead>
          <tbody>
            {table.nodes.map((node) => {
              const item = file.variables[node.variable_id];
              return (
                <tr key={node.variable_id}>
                  <td>{item?.name_en ?? node.variable_id}</td>
                  <td>
                    {KIND_LABELS[item?.data_kind ?? ""] ?? item?.data_kind}
                  </td>
                  <td className="number">{node.degree}</td>
                  <td className="number">{node.component}</td>
                  <td>
                    {item?.known_issues.length
                      ? item.known_issues.join(", ")
                      : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        Group: variables joined by lines, directly or through others, share a
        number.{" "}
        {routing
          ? `Groups and link counts were computed twice, in Python (union-find) and in the database (pgRouting): ${routing.n_nodes_component_differs_from_union_find} of ${routing.n_nodes} variables differ in group, ${routing.n_nodes_degree_differs} in link count.`
          : ""}
      </p>

      {world ? (
        <>
          <h3>The same pairs in {world.cities.length} world cities</h3>
          <p className="note">
            Each city is tested on its own ({world.n_tests} tests,{" "}
            {world.n_significant} below the limit after one correction over all
            of them). A pair that is below the limit in many cities with the
            same sign depends less on one place. Pairs below the limit in at
            least half of their cities:
          </p>
          <div className="scroll tall">
            <table>
              <thead>
                <tr>
                  <th>{t("mining.network.column.first")}</th>
                  <th>{t("mining.network.column.second")}</th>
                  <th>{t("mining.network.column.timing")}</th>
                  <th className="number">
                    {t("mining.network.column.citiesBelow")}
                  </th>
                  <th className="number">{t("mining.network.column.signs")}</th>
                  <th>{t("mining.network.column.sameSign")}</th>
                  <th className="number">
                    {t("mining.network.column.medianR")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {world.pairs
                  .filter((pair) => pair.n_significant * 2 >= pair.n_cities)
                  .sort((a, b) => b.n_significant - a.n_significant)
                  .map((pair) => (
                    <tr key={`${pair.source} ${pair.target} ${pair.lag}`}>
                      <td>{names[pair.source] ?? pair.source}</td>
                      <td>{names[pair.target] ?? pair.target}</td>
                      <td>{lagLabel(pair.lag)}</td>
                      <td className="number">
                        {pair.n_significant} of {pair.n_cities}
                      </td>
                      <td className="number">
                        {pair.n_significant_positive} /{" "}
                        {pair.n_significant_negative}
                      </td>
                      <td>{pair.sign_consistent ? "yes" : "no"}</td>
                      <td className="number">
                        {formatR(pair.r_median)} ({formatR(pair.r_min)} to{" "}
                        {formatR(pair.r_max)})
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <MethodDetails>
        <p>{file.significance_note}</p>
        <dl>
          {Object.entries(file.methods).map(([name, text]) => (
            <div key={name} style={{ display: "contents" }}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
          <dt>{t("mining.extra.pairs_not_compared")}</dt>
          <dd>
            {table.excluded_pairs
              .map(
                (pair) =>
                  `${names[pair.source] ?? pair.source} and ${names[pair.target] ?? pair.target}`,
              )
              .join("; ") || "none"}{" "}
            (same quantity)
          </dd>
        </dl>
      </MethodDetails>
    </section>
  );
}
