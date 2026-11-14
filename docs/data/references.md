# References: non-NASA data and software

Generated from `data/snapshot/catalog.json` and `pyproject.toml`. Do not edit by hand.

## Non-NASA data

| Variable | Source | Period | Accessed via | Citation |
|---|---|---|---|---|
| Station air temperature (NOAA GHCNh) | GHCNh | 2000-01 to 2026-10 | AWS Open Data (NOAA NODD) | NOAA NCEI Global Historical Climatology Network – hourly (GHCNh), accessed via AWS Open Data (NODD) on 2026-11-14. Original observations are from Taiwan's Central Weather Administration, exchanged through WMO. Only monthly means (derived data) are included here, for educational, non-commercial use; no endorsement by NOAA is implied. |

## Software

Python packages the data pipeline depends on:

- `httpx>=0.28.1`
- `mlxtend>=0.25.0`
- `netcdf4>=1.7.5.1.post1`
- `numpy>=2.4.6`
- `pymannkendall>=1.4.3`
- `rasterio>=1.4.4`
- `scikit-learn>=1.9.1`
- `scipy>=1.17.1`
- Python standard library (`sqlite3`, `csv`, `json`)
