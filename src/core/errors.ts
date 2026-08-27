import { Schema } from "effect";
import type { ValidationReport } from "../contract/diagnostics.js";
import { isRecord } from "../shared/object.js";

const ValidationReportSchema = Schema.declare<ValidationReport>(
  (value): value is ValidationReport =>
    isRecord(value) &&
    typeof value.valid === "boolean" &&
    Array.isArray(value.diagnostics) &&
    isRecord(value.summary) &&
    typeof value.summary.errors === "number" &&
    typeof value.summary.warnings === "number" &&
    typeof value.summary.info === "number",
  { identifier: "ValidationReport" },
);

export class SdkConfigLoadError extends Schema.TaggedError<SdkConfigLoadError>()(
  "SdkConfigLoadError",
  {
    message: Schema.String,
    validation: Schema.optionalKey(ValidationReportSchema),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class ContractLoadError extends Schema.TaggedError<ContractLoadError>()(
  "ContractLoadError",
  {
    message: Schema.String,
    validation: ValidationReportSchema,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class GenerationError extends Schema.TaggedError<GenerationError>()("GenerationError", {
  message: Schema.String,
  validation: Schema.optionalKey(ValidationReportSchema),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
