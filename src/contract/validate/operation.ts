import type { ContractOperation } from "../operations.js";
import { addDiagnostic, type ValidationContext } from "./context.js";

export function validateOperationIdentity(
  context: ValidationContext,
  operation: ContractOperation,
  operationIds: Map<string, ContractOperation>,
): void {
  const id = operation.operation.operationId;
  if (typeof id !== "string" || id.length === 0) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.id.required",
        message: "Every operation must have a stable, non-empty operationId.",
        pointer: `${operation.pointer}/operationId`,
      },
      operation,
    );
  } else if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(id)) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.id.invalid",
        message: `operationId ${JSON.stringify(id)} contains unsupported characters.`,
        pointer: `${operation.pointer}/operationId`,
      },
      operation,
    );
  } else {
    const prior = operationIds.get(id);
    if (prior) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.id.duplicate",
          message: `operationId ${JSON.stringify(id)} is also used by ${prior.method.toUpperCase()} ${prior.path}.`,
          pointer: `${operation.pointer}/operationId`,
        },
        operation,
      );
    } else {
      operationIds.set(id, operation);
    }
  }

  if (!Array.isArray(operation.operation.tags) || operation.operation.tags.length === 0) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.tags.required",
        message: "Every operation must have at least one tag for service grouping.",
        pointer: `${operation.pointer}/tags`,
      },
      operation,
    );
  }
}
