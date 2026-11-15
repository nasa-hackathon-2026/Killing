import { useCallback, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  searchMenu,
  type MenuSearchItem,
  type MenuSearchKind,
} from "./menuSearch";
import { useDismissOnOutside } from "./useDismissOnOutside";

type Named = { id: string; label: string };

type HudSearchProps = {
  places: Named[];
  layers: Named[];
  onPlace: (id: string) => void;
  onLayer: (id: string) => void;
};

const LIST_ID = "hud-search-list";

function optionId(item: MenuSearchItem): string {
  return `hud-search-${item.kind}-${item.id}`;
}

function kindKey(kind: MenuSearchKind): "hud.searchPlace" | "hud.searchLayer" {
  return kind === "place" ? "hud.searchPlace" : "hud.searchLayer";
}

// The search field on the top bar. An empty field shows no list. Choosing a
// place or a layer is the caller's job; this only reports the id.
export function HudSearch({
  places,
  layers,
  onPlace,
  onLayer,
}: HudSearchProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLLabelElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const items: MenuSearchItem[] = [
    ...places.map((place) => ({ kind: "place" as const, ...place })),
    ...layers.map((layer) => ({ kind: "layer" as const, ...layer })),
  ];
  const hits = searchMenu(query, items);
  const shown = open && query.trim().length > 0;
  const safeActive = hits.length === 0 ? 0 : Math.min(active, hits.length - 1);
  const current = hits[safeActive];
  const closeResults = useCallback(() => setOpen(false), []);
  useDismissOnOutside(rootRef, shown, closeResults);

  const choose = (hit: MenuSearchItem) => {
    setQuery("");
    setOpen(false);
    setActive(0);
    if (hit.kind === "place") onPlace(hit.id);
    else onLayer(hit.id);
  };

  return (
    <label className="hud-search" ref={rootRef}>
      <span>{t("hud.search")}</span>
      <input
        type="search"
        role="combobox"
        aria-label={t("hud.searchAria")}
        aria-expanded={shown}
        aria-controls={shown ? LIST_ID : undefined}
        aria-autocomplete="list"
        aria-activedescendant={shown && current ? optionId(current) : undefined}
        placeholder={t("hud.search")}
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(event.target.value.trim().length > 0);
          setActive(0);
        }}
        onFocus={() => {
          if (query.trim()) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            // Only the open result list consumes Escape. Otherwise it can
            // still close the More menu.
            if (shown) {
              event.stopPropagation();
              setOpen(false);
            }
            return;
          }
          if (!shown || hits.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive(Math.min(safeActive + 1, hits.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(safeActive - 1, 0));
          } else if (event.key === "Enter" && current) {
            event.preventDefault();
            choose(current);
          }
        }}
      />
      {shown ? (
        hits.length === 0 ? (
          <p className="hud-search-results hud-search-empty" role="status">
            {t("hud.searchEmpty")}
          </p>
        ) : (
          <ul className="hud-search-results" id={LIST_ID} role="listbox">
            {hits.map((hit, index) => (
              <li key={`${hit.kind}:${hit.id}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={optionId(hit)}
                  aria-selected={index === safeActive}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(hit);
                  }}
                >
                  <span>{hit.label}</span>
                  <span className="hud-search-kind">
                    {t(kindKey(hit.kind))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </label>
  );
}
