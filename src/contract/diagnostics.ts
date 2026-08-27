export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticOperation {
  method: string;
  path: string;
  operationId?: string;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  file?: string;
  pointer?: string;
  operation?: DiagnosticOperation;
  hint?: string;
}

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
  info: number;
}

export interface ValidationReport {
  valid: boolean;
  diagnostics: Diagnostic[];
  summary: DiagnosticSummary;
}

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
    (left.file ?? "").localeCompare(right.file ?? "") ||
    (left.pointer ?? "").localeCompare(right.pointer ?? "") ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

export function createValidationReport(diagnostics: Iterable<Diagnostic>): ValidationReport {
  const sorted = [...diagnostics].sort(compareDiagnostics);
  const summary: DiagnosticSummary = { errors: 0, warnings: 0, info: 0 };

  for (const diagnostic of sorted) {
    if (diagnostic.severity === "error") summary.errors += 1;
    else if (diagnostic.severity === "warning") summary.warnings += 1;
    else summary.info += 1;
  }

  return {
    valid: summary.errors === 0,
    diagnostics: sorted,
    summary,
  };
}
