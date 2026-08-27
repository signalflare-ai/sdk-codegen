import { Schema } from "effect";
import { ValidationReport } from "../contract/diagnostics.js";

export class SdkConfigLoadError extends Schema.TaggedError<SdkConfigLoadError>()(
  "SdkConfigLoadError",
  {
    message: Schema.String,
    validation: Schema.optionalKey(ValidationReport),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class ContractLoadError extends Schema.TaggedError<ContractLoadError>()(
  "ContractLoadError",
  {
    message: Schema.String,
    validation: ValidationReport,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class GenerationError extends Schema.TaggedError<GenerationError>()("GenerationError", {
  message: Schema.String,
  validation: Schema.optionalKey(ValidationReport),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class CliUsageError extends Schema.TaggedError<CliUsageError>()("CliUsageError", {
  message: Schema.String,
}) {}
