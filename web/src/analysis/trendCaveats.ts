// Known, checked problems with the trend of a variable. Shown next to the
// trend wherever it appears (trend map legend, layer panel). Facts and
// sources only; the check itself is written up in docs/data/gldas-tair-check.md.

export type TrendCaveat = {
  // One or two sentences shown to the reader.
  text: string;
  // Documents the statement rests on.
  sources: string;
};

export const TREND_CAVEATS: Record<string, TrendCaveat> = {
  gldas_tair: {
    text:
      "Caution: this trend contains step changes and should not be read as a climate signal. " +
      "GLDAS-2.1 air temperature comes from the NOAA GDAS operational analysis used to force the model. " +
      "Against MERRA-2 over the same land cells, its global land mean shifts by about +0.4 K in May 2011, " +
      "+0.6 K in July 2017 and −0.6 K in June 2019, the months of GDAS/GFS upgrades in the NCEP change log. " +
      "At Taichung it also steps by 1 K or more against the station record.",
    sources:
      "GLDAS-2 README (GES DISC, rev. 2025-08-13) §1.2.3, §1.6; NCEP EMC GFS/GDAS change log; project check #74.",
  },
};

export function trendCaveat(id: string): TrendCaveat | null {
  return TREND_CAVEATS[id] ?? null;
}
