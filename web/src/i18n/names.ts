// Names that come from the data catalogs (variables, places), in the active
// language. The catalogs carry English names; the `variables` and `places`
// namespaces carry the translations. An id the namespaces do not list keeps
// the catalog's English name. Product names (GPM IMERG, MERRA-2, GLDAS …)
// and units are never translated.
import { getVoice, t, tOptional, type Voice } from "./core";

export function variableName(id: string, fallback?: string): string {
  return tOptional(`variables.${id}.name`) ?? fallback ?? id;
}

// The short name a companion uses for what it tracks.
export function variableShort(id: string, fallback?: string): string {
  return tOptional(`variables.${id}.short`) ?? variableName(id, fallback);
}

// The one-sentence definition in the active (or given) voice, or null.
export function variableDefinition(
  id: string,
  voice: Voice = getVoice(),
): string | null {
  return tOptional(`variables.${id}.definition.${voice}`);
}

export function placeName(id: string, fallback?: string): string {
  return tOptional(`places.names.${id}`) ?? fallback ?? id;
}

export function placeGroupName(id: string): string {
  return t(`places.groups.${id}`);
}
