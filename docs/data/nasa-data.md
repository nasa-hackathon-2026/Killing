# NASA data used in this project

Generated from `data/snapshot/catalog.json` (snapshot date 2026-11-14). Do not edit by hand; run `uv run python -m trend_detective.data_lists`.

All series are stored as monthly values for points and regions in Taiwan. Units are kept as provided by each product.

| Variable | NASA product | Version | Period | Accessed via | DOI / citation |
|---|---|---|---|---|---|
| Precipitation (GPM IMERG Final) | GPM_3IMERGM.07 | 07 | 2001-01 to 2025-09 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/GPM/IMERG/3B-MONTH/07 |
| Near-surface air temperature (GLDAS Noah) | GLDAS_NOAH025_M.2.1 | 2.1 | 2001-01 to 2026-07 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/SXAVCZFAQLNO |
| Soil moisture 0–10 cm (GLDAS Noah) | GLDAS_NOAH025_M.2.1 | 2.1 | 2001-01 to 2026-07 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/SXAVCZFAQLNO |
| Evapotranspiration (GLDAS Noah) | GLDAS_NOAH025_M.2.1 | 2.1 | 2001-01 to 2026-07 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/SXAVCZFAQLNO |
| Surface air temperature (AIRS) | AIRS3STM.7.0 | 7.0 | 2002-09 to 2026-10 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/UBENJB9D3T2H |
| Total column water vapor (AIRS) | AIRS3STM.7.0 | 7.0 | 2002-09 to 2026-10 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/UBENJB9D3T2H |
| 2 m air temperature (MERRA-2) | M2IMNXASM.5.12.4 | 5.12.4 | 2001-01 to 2026-09 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/5ESKGQTZG7FO |
| Tropospheric NO2 column (OMI) | OMNO2d.003 | 003 | 2004-10 to 2026-03 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/Aura/OMI/DATA3007 |
| Total column ozone (OMI) | OMTO3d.003 | 003 | 2004-10 to 2026-11 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/Aura/OMI/DATA3001 |
| UV aerosol index (OMI) | OMAERUVd.003 | 003 | 2004-10 to 2026-11 | NASA Giovanni time-series API (point); NASA Harmony / Giovanni Averaging Service (area mean) | https://doi.org/10.5067/Aura/OMI/DATA3003 |
| 2 m air temperature (NASA POWER, MERRA-2) | MERRA-2 (via NASA POWER) | MERRA-2 | 2001-01 to 2026-09 | NASA POWER Monthly API (point) | The data was obtained from the National Aeronautics and Space Administration (NASA) Langley Research Center (LaRC) Prediction of Worldwide Energy Resources (POWER) Project funded through the NASA Earth Science Division. POWER Monthly and Annual API v2.10.0, accessed 2026-11-14. |
| Vegetation greenness, NDVI (MODIS Terra) | MOD13A3.061 | 061 | 2001-01 to 2026-10 | NASA AppEEARS area request (area statistics) | https://doi.org/10.5067/MODIS/MOD13A3.061 |
| Daytime land surface temperature (MODIS Terra, via Planetary Computer) | MOD11A2.061 | 061 | 2001-01 to 2026-10 | Accessed via Microsoft Planetary Computer (STAC API, cloud-optimized GeoTIFF); area statistics computed locally | https://doi.org/10.5067/MODIS/MOD11A2.061 |
| Vegetation greenness, NDVI (MODIS Terra 250 m 16-day, via Planetary Computer) | MOD13Q1.061 | 061 | 2001-01 to 2026-09 | Accessed via Microsoft Planetary Computer (STAC API, cloud-optimized GeoTIFF); area statistics computed locally | https://doi.org/10.5067/MODIS/MOD13Q1.061 |
