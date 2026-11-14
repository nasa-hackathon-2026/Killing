// Known, checked problems with the trend of a variable. Shown next to the
// trend wherever it appears (trend map legend, layer panel). Facts and
// sources only; the checks are written up in docs/data/gldas-tair-check.md and
// docs/data/gldas-water-check.md.

export type TrendCaveat = {
  // One sentence that is always shown; starts with "Caution:".
  summary: string;
  // The numbers behind it; shown when the reader opens "Details".
  details: string;
  // Documents the statement rests on; shown with the details.
  sources: string;
};

export const TREND_CAVEATS: Record<string, TrendCaveat> = {
  gldas_tair: {
    summary:
      "Caution: this trend contains step changes and should not be read as a climate signal.",
    details:
      "GLDAS-2.1 air temperature comes from the NOAA GDAS operational analysis used to force the model. " +
      "Against MERRA-2 over the same land cells, its global land mean shifts by about +0.4 K in May 2011, " +
      "+0.6 K in July 2017 and −0.6 K in June 2019, the months of GDAS/GFS upgrades in the NCEP change log. " +
      "At Taichung it also steps by 1 K or more against the station record.",
    sources:
      "GLDAS-2 README (GES DISC, rev. 2025-08-13) §1.2.3, §1.6; NCEP EMC GFS/GDAS change log; project check #74.",
  },
  gldas_evap: {
    summary:
      "Caution: this series contains a step that an independent product does not show.",
    details:
      "From July 2024 to May 2025 the GLDAS-2.1 downward shortwave forcing runs 15–32 W m⁻² above that of FLDAS " +
      "(same Noah model family, MERRA-2 forcing) over the same land cells, and GLDAS global land evapotranspiration " +
      "runs about 0.1–0.2 mm/day (1–2 × 10⁻⁶ kg m⁻² s⁻¹) above FLDAS; both differences are gone by July 2025. " +
      "The GLDAS-2 README records that the cloud analysis behind its radiation input was decommissioned in summer 2024 " +
      "and that radiation switched to GALWEM on 9 June 2025. " +
      "Over 2001–2026 the GLDAS global land trend is +0.058 mm/day per decade against +0.012 for FLDAS.",
    sources:
      "GLDAS-2 README (GES DISC, rev. 2025-08-13) §1.2.3; FLDAS README (GES DISC, rev. 2022-07-12) §1.1; project check #79.",
  },
  gldas_soilmoist: {
    summary: "Caution: two model products disagree on the sign of this trend.",
    details:
      "Over the same land cells and months (January 2001 to July 2026), the global land trend of 0–10 cm soil moisture " +
      "is −0.43 kg m⁻² per decade in GLDAS-2.1 and +0.16 in FLDAS (same Noah model family, MERRA-2 and CHIRPS forcing), " +
      "and the two global land series correlate at only 0.08. " +
      "FLDAS is also a model simulation and the only product compared, so this check cannot tell which of the two is closer to the truth. " +
      "No clear step was found at the GDAS/GFS upgrade months (May 2011, July 2017, June 2019).",
    sources:
      "GLDAS-2 README (GES DISC, rev. 2025-08-13); FLDAS README (GES DISC, rev. 2022-07-12) §1.1, §1.3; project check #79.",
  },
};

export function trendCaveat(id: string): TrendCaveat | null {
  return TREND_CAVEATS[id] ?? null;
}
