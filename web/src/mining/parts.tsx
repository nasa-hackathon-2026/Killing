import type { ReactNode } from "react";

// Collapsible method text: closed by default so each section starts with the
// question and the numbers.
export function MethodDetails({ children }: { children: ReactNode }) {
  return (
    <details className="method">
      <summary>Method details</summary>
      {children}
    </details>
  );
}
