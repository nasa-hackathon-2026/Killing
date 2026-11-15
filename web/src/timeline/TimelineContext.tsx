/* eslint-disable react-refresh/only-export-components -- the provider and its
   hook are one unit; other panels import both names from this path. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { prefersReducedMotion } from "../forms/reducedMotion";
import {
  chartIdOf,
  closeUpIdOf,
  initialLeftView,
  withChart,
  withCloseUp,
  type LeftView,
} from "../leftPanel/leftView";
import {
  requestedChart,
  requestedCloseUp,
  requestedMonth,
  requestedPlay,
} from "../urlParams";
import {
  clampIndex,
  DEFAULT_SPEED,
  nextPlayIndex,
  playStartIndex,
  parseMonthParam,
  playIntervalMs,
  resolveMonth,
} from "./timelineMath";

// The single source of "which month is shown". Read it with useTimeline();
// do not keep another month state next to it.
export type Timeline = {
  // Every month of the current place, sorted, as "YYYY-MM-01".
  months: string[];
  // Index of the shown month in `months`; -1 while there are no months.
  monthIndex: number;
  // The shown month, or null while there are no months.
  month: string | null;
  setMonthIndex: (index: number) => void;
  setMonth: (month: string) => void;
  // Moves by a number of months (negative = back), clamped to the range.
  step: (delta: number) => void;
  // The month "Latest" returns to: the latest month most layers have.
  defaultMonth: string | null;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  // Months per second while playing.
  speed: number;
  setSpeed: (speed: number) => void;
  // What the left side shows (leftPanel/leftView.ts): nothing, a layer's
  // chart, or a layer's close-up, never two of them.
  leftView: LeftView;
  setLeftView: (view: LeftView) => void;
  // The variable the time series chart shows; null = chart closed. Setting it
  // replaces a close-up; setting null closes the chart only.
  selectedVariableId: string | null;
  setSelectedVariableId: (id: string | null) => void;
  // The layer whose close-up is open; null = none. Same rules.
  closeUpId: string | null;
  setCloseUpId: (id: string | null) => void;
  // The place whose series the months come from.
  locationId: string;
};

const TimelineContext = createContext<Timeline | null>(null);

type TimelineProviderProps = {
  months: string[];
  // Shown until the user picks a month (and what "Latest" returns to).
  defaultMonth: string | null;
  locationId: string;
  children: ReactNode;
};

const askedMonth = parseMonthParam(requestedMonth());
// ?play=1 starts playing, unless the system asks for reduced motion.
const askedPlay = requestedPlay();

export function TimelineProvider({
  months,
  defaultMonth,
  locationId,
  children,
}: TimelineProviderProps) {
  const [chosen, setChosen] = useState<string | null>(askedMonth);
  const [playing, setPlayingState] = useState(
    () => askedPlay && !prefersReducedMotion(),
  );
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [leftView, setLeftView] = useState<LeftView>(() =>
    initialLeftView(requestedChart(), requestedCloseUp()),
  );
  const selectedVariableId = chartIdOf(leftView);
  const closeUpId = closeUpIdOf(leftView);
  const setSelectedVariableId = useCallback(
    (id: string | null) => setLeftView((view) => withChart(view, id)),
    [],
  );
  const setCloseUpId = useCallback(
    (id: string | null) => setLeftView((view) => withCloseUp(view, id)),
    [],
  );
  // ?play=1 without ?month starts from the first month, so there is
  // something to play through.
  const [fromStart] = useState(
    () => askedPlay && askedMonth === null && !prefersReducedMotion(),
  );
  const month = resolveMonth(
    months,
    chosen,
    fromStart ? (months[0] ?? null) : defaultMonth,
  );
  const monthIndex = month ? months.indexOf(month) : -1;

  useEffect(() => {
    if (!playing || months.length === 0) return;
    const handle = window.setTimeout(() => {
      const next = nextPlayIndex(monthIndex, months.length);
      if (next === null) setPlayingState(false);
      else setChosen(months[next] ?? null);
    }, playIntervalMs(speed));
    return () => window.clearTimeout(handle);
  }, [playing, speed, monthIndex, months]);

  const setMonthIndex = useCallback(
    (index: number) => {
      const next = months[clampIndex(index, months.length)];
      if (next) setChosen(next);
    },
    [months],
  );
  const setMonth = useCallback((next: string) => setChosen(next), []);
  const step = useCallback(
    (delta: number) => setMonthIndex(monthIndex + delta),
    [monthIndex, setMonthIndex],
  );
  // Pressing play in the last PLAY_FROM_START_WITHIN months starts again
  // from the first (playStartIndex).
  const setPlaying = useCallback(
    (next: boolean) => {
      const start = playStartIndex(monthIndex, months.length);
      if (next && start !== monthIndex && months[start]) {
        setChosen(months[start]);
      }
      setPlayingState(next);
    },
    [monthIndex, months],
  );

  const value = useMemo<Timeline>(
    () => ({
      months,
      monthIndex,
      month,
      setMonthIndex,
      setMonth,
      step,
      defaultMonth,
      playing,
      setPlaying,
      speed,
      setSpeed,
      leftView,
      setLeftView,
      selectedVariableId,
      setSelectedVariableId,
      closeUpId,
      setCloseUpId,
      locationId,
    }),
    [
      months,
      monthIndex,
      month,
      setMonthIndex,
      setMonth,
      step,
      defaultMonth,
      playing,
      setPlaying,
      speed,
      leftView,
      selectedVariableId,
      setSelectedVariableId,
      closeUpId,
      setCloseUpId,
      locationId,
    ],
  );

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
}

export function useTimeline(): Timeline {
  const value = useContext(TimelineContext);
  if (!value) {
    throw new Error("useTimeline must be used inside <TimelineProvider>");
  }
  return value;
}
