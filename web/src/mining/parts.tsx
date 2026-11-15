import type { ReactNode } from "react";
import { useI18n } from "../i18n";

// Collapsible method text: closed by default so each section starts with the
// question and the numbers.
export function MethodDetails({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <details className="method">
      <summary>{t("mining.label.methodDetails")}</summary>
      {children}
    </details>
  );
}
