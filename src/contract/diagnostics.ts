import { Schema } from "effect";

export const DIAGNOSTIC_SEVERITIES = ["error", "warning", "info"] as const;
export const DiagnosticSeverity = Schema.Literals(DIAGNOSTIC_SEVERITIES);
export type DiagnosticSeverity = typeof DiagnosticSeverity.Type;

export const DiagnosticOperation = Schema.Struct({
  method: Schema.String,
  path: Schema.String,
  operationId: Schema.optionalKey(Schema.String),
});
export interface DiagnosticOperation extends Schema.Schema.Type<typeof DiagnosticOperation> {}

export const Diagnostic = Schema.Struct({
  severity: DiagnosticSeverity,
  code: Schema.NonEmptyString,
  message: Schema.String,
  file: Schema.optionalKey(Schema.String),
  pointer: Schema.optionalKey(Schema.String),
  operation: Schema.optionalKey(DiagnosticOperation),
  hint: Schema.optionalKey(Schema.String),
});
export interface Diagnostic extends Schema.Schema.Type<typeof Diagnostic> {}

export const DiagnosticSummary = Schema.Struct({
  errors: Schema.Number,
  warnings: Schema.Number,
  info: Schema.Number,
});
export interface DiagnosticSummary extends Schema.Schema.Type<typeof DiagnosticSummary> {}

export const ValidationReport = Schema.Struct({
  valid: Schema.Boolean,
  diagnostics: Schema.Array(Diagnostic),
  summary: DiagnosticSummary,
});
export interface ValidationReport extends Schema.Schema.Type<typeof ValidationReport> {}

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
  const summary = { errors: 0, warnings: 0, info: 0 };

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
