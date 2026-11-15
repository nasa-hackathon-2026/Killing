import type { ReactNode } from "react";
import { useI18n } from "../i18n";

// Content shown as it is for a researcher (the role table's
// `fullStatistics`) and folded under a summary for everyone else. With
// `student`, students see it unfolded too (the role's `readingAid`).
export function Fold({
  summary,
  children,
  student = false,
  open = false,
}: {
  summary: string;
  children: ReactNode;
  student?: boolean;
  open?: boolean;
}) {
  const { settings } = useI18n();
  if (settings.fullStatistics || (student && settings.readingAid)) {
    return <>{children}</>;
  }
  return (
    <details className="timeline-details investigation-fold" open={open}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

// A reading note for students and researchers (the role table's
// `readingAid`); hidden for Everyone.
export function ReadingNote({ children }: { children: ReactNode }) {
  const { settings } = useI18n();
  if (!settings.readingAid) return null;
  return <p className="timeline-chart-note investigation-why">{children}</p>;
}
