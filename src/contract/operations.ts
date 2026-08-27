import { escapeJsonPointer, isRecord } from "../shared/object.js";

export const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS);

export interface ContractOperation {
  method: HttpMethod;
  path: string;
  pathItem: Record<string, unknown>;
  operation: Record<string, unknown>;
  pointer: string;
}

export function listContractOperations(document: Record<string, unknown>): ContractOperation[] {
  if (!isRecord(document.paths)) return [];
  const operations: ContractOperation[] = [];

  for (const [path, rawPathItem] of Object.entries(document.paths)) {
    if (!isRecord(rawPathItem)) continue;
    for (const [method, rawOperation] of Object.entries(rawPathItem)) {
      if (!HTTP_METHOD_SET.has(method.toLowerCase()) || !isRecord(rawOperation)) continue;
      operations.push({
        method: method.toLowerCase() as HttpMethod,
        path,
        pathItem: rawPathItem,
        operation: rawOperation,
        pointer: `#/paths/${escapeJsonPointer(path)}/${method}`,
      });
    }
  }

  return operations;
}
