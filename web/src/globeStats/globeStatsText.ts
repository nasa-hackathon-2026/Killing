import { t } from "../i18n";

export const GLOBE_STATS_TEXT = {
  get controlLabel() {
    return t("globeStats.controlLabel");
  },
  get modeNone() {
    return t("globeStats.modeNone");
  },
  get modeTrend() {
    return t("globeStats.modeTrend");
  },
  get modeGap() {
    return t("globeStats.modeGap");
  },
  get modeAlike() {
    return t("globeStats.modeAlike");
  },
  get legendShow() {
    return t("globeStats.legendShow");
  },
  get legendHide() {
    return t("globeStats.legendHide");
  },
  get tableShow() {
    return t("globeStats.tableShow");
  },
  get tableHide() {
    return t("globeStats.tableHide");
  },
  get tableTitle() {
    return t("globeStats.tableTitle");
  },
  get tableClose() {
    return t("globeStats.tableClose");
  },
  get overlayLabel() {
    return t("globeStats.overlayLabel");
  },
  get needVariable() {
    return t("globeStats.needVariable");
  },
  get loading() {
    return t("globeStats.loading");
  },
  get loadError() {
    return t("globeStats.loadError");
  },
  get trendIntro() {
    return t("globeStats.trendIntro");
  },
  get trendUp() {
    return t("globeStats.trendUp");
  },
  get trendDown() {
    return t("globeStats.trendDown");
  },
  get trendLength() {
    return t("globeStats.trendLength");
  },
  get trendSolid() {
    return t("globeStats.trendSolid");
  },
  get trendHollow() {
    return t("globeStats.trendHollow");
  },
  get trendUnreliable() {
    return t("globeStats.trendUnreliable");
  },
  get trendNoData() {
    return t("globeStats.trendNoData");
  },
  get trendKeyShort() {
    return t("globeStats.trendKeyShort");
  },
  get pausedForTrendMap() {
    return t("globeStats.pausedForTrendMap");
  },
  get trendLengthScale() {
    return t("globeStats.trendLengthScale");
  },
  get gapIntro() {
    return t("globeStats.gapIntro");
  },
  get gapHalves() {
    return t("globeStats.gapHalves");
  },
  get gapRing() {
    return t("globeStats.gapRing");
  },
  get gapObsWarn() {
    return t("globeStats.gapObsWarn");
  },
  get gapModelStripes() {
    return t("globeStats.gapModelStripes");
  },
  get gapOnlyTemperature() {
    return t("globeStats.gapOnlyTemperature");
  },
  get gapModelSelect() {
    return t("globeStats.gapModelSelect");
  },
  get gapNoPairs() {
    return t("globeStats.gapNoPairs");
  },
  get gapClick() {
    return t("globeStats.gapClick");
  },
  get alikeIntro() {
    return t("globeStats.alikeIntro");
  },
  get alikeWidth() {
    return t("globeStats.alikeWidth");
  },
  get alikeColour() {
    return t("globeStats.alikeColour");
  },
  get alikeDashed() {
    return t("globeStats.alikeDashed");
  },
  get alikeNotCause() {
    return t("globeStats.alikeNotCause");
  },
  get alikeSource() {
    return t("globeStats.alikeSource");
  },
  get alikeNone() {
    return t("globeStats.alikeNone");
  },
  get alikeSamePlace() {
    return t("globeStats.alikeSamePlace");
  },
  get alikeGlobal() {
    return t("globeStats.alikeGlobal");
  },
  get reliable() {
    return t("globeStats.reliable");
  },
  get notReliable() {
    return t("globeStats.notReliable");
  },
  get noResult() {
    return t("globeStats.noResult");
  },
  get notAnalysed() {
    return t("globeStats.notAnalysed");
  },
  get significantFdr() {
    return t("globeStats.significantFdr");
  },
  get significantOnly() {
    return t("globeStats.significantOnly");
  },
  get notSignificant() {
    return t("globeStats.notSignificant");
  },
  get perDecade() {
    return t("globeStats.perDecade");
  },
  get clickSelect() {
    return t("globeStats.clickSelect");
  },
  get model() {
    return t("globeStats.model");
  },
  get station() {
    return t("globeStats.station");
  },
  get correlation() {
    return t("globeStats.correlation");
  },
  get commonMonths() {
    return t("globeStats.commonMonths");
  },
  get rmse() {
    return t("globeStats.rmse");
  },
  get similarity() {
    return t("globeStats.similarity");
  },
  get similarityDetrended() {
    return t("globeStats.similarityDetrended");
  },
  get yes() {
    return t("globeStats.yes");
  },
  get no() {
    return t("globeStats.no");
  },
  get columnPlace() {
    return t("globeStats.columnPlace");
  },
  get columnChange() {
    return t("globeStats.columnChange");
  },
  get columnSignificance() {
    return t("globeStats.columnSignificance");
  },
  get columnReliability() {
    return t("globeStats.columnReliability");
  },
  get columnModel() {
    return t("globeStats.columnModel");
  },
  get columnStation() {
    return t("globeStats.columnStation");
  },
  get columnCorrelation() {
    return t("globeStats.columnCorrelation");
  },
  get columnMonths() {
    return t("globeStats.columnMonths");
  },
  get columnWarning() {
    return t("globeStats.columnWarning");
  },
  get columnOther() {
    return t("globeStats.columnOther");
  },
  get columnSimilarity() {
    return t("globeStats.columnSimilarity");
  },
  get columnDetrended() {
    return t("globeStats.columnDetrended");
  },
  get columnDashed() {
    return t("globeStats.columnDashed");
  },
} as const;

export type GlobeStatsTextKey = keyof typeof GLOBE_STATS_TEXT;
