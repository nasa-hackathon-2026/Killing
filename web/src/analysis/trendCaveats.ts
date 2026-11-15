// Known, checked problems with the trend of a variable. Shown next to the
// trend wherever it appears (trend map legend, layer panel). Facts and
// sources only; the checks are written up in docs/data/gldas-tair-check.md and
// docs/data/gldas-water-check.md.

import { getVoice, t, type Voice } from "../i18n";

export type TrendCaveat = {
  // One sentence that is always shown; starts with "Caution:" in English.
  summary: string;
  // The same fact as a clause, said after "This trend is not reliable as a
  // climate signal:" where a significant trend is put into a sentence.
  reason?: string;
  // The numbers behind it; shown when the reader opens "Details".
  details: string;
  // Documents the statement rests on; shown with the details.
  sources: string;
};

// The wording lives in the `caveats` namespace of the message files
// (summary.general / summary.expert, reason, details per variable id); the
// sources are citations and stay as written here. Adding a caveat: add the
// id here with its sources, and its four messages in every language.
export const CAVEAT_SOURCES: Record<string, string> = {
  gldas_tair:
    "GLDAS-2 README (GES DISC, rev. 2025-08-13) §1.2.3, §1.6; NCEP EMC GFS/GDAS change log; project check #74.",
  gldas_evap:
    "GLDAS-2 README (GES DISC, rev. 2025-08-13) §1.2.3; FLDAS README (GES DISC, rev. 2022-07-12) §1.1; project check #79.",
  gldas_soilmoist:
    "GLDAS-2 README (GES DISC, rev. 2025-08-13); FLDAS README (GES DISC, rev. 2022-07-12) §1.1, §1.3; project check #79.",
};

// The caveat of a variable in the active language. The summary follows the
// active voice unless one is given.
export function trendCaveat(
  id: string,
  voice: Voice = getVoice(),
): TrendCaveat | null {
  const sources = CAVEAT_SOURCES[id];
  if (!sources) return null;
  return {
    summary: t(`caveats.${id}.summary.${voice}`),
    reason: t(`caveats.${id}.reason`),
    details: t(`caveats.${id}.details`),
    sources,
  };
}

// Every caveat, keyed by variable id.
export function allTrendCaveats(
  voice: Voice = getVoice(),
): Record<string, TrendCaveat> {
  return Object.fromEntries(
    Object.keys(CAVEAT_SOURCES).flatMap((id) => {
      const caveat = trendCaveat(id, voice);
      return caveat ? [[id, caveat]] : [];
    }),
  );
}
