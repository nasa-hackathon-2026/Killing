import { t } from "../i18n";

export const fieldText = {
  get controlLabel() {
    return t("fields.controlLabel");
  },
  get off() {
    return t("fields.off");
  },
  get auto() {
    return t("fields.auto");
  },
  unavailable: (name: string) => t("fields.unavailable", { name }),
  get unavailableReason() {
    return t("fields.unavailableReason");
  },
  get autoNothing() {
    return t("fields.autoNothing");
  },
  get loading() {
    return t("fields.loading");
  },
  get error() {
    return t("fields.error");
  },
  typical: (month: string) => t("fields.typical", { month }),
  period: (start: number, end: number) => t("fields.period", { start, end }),
  get legendToggle() {
    return t("fields.legendToggle");
  },
  get low() {
    return t("fields.low");
  },
  get high() {
    return t("fields.high");
  },
  get densityCaption() {
    return t("fields.densityCaption");
  },
  get notThisMonth() {
    return t("fields.notThisMonth");
  },
  method: (start: number, end: number) => t("fields.method", { start, end }),
  get noWind() {
    return t("fields.noWind");
  },
  get withTrendMap() {
    return t("fields.withTrendMap");
  },
  dataKind: (kind: string) => t("fields.dataKind", { kind }),
  particleNote: (month: string, variable: string) =>
    t("fields.particleNote", { month, variable }),
} as const;
