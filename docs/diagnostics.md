# Diagnostic codes

Diagnostic codes are the stable machine-readable surface used by product CI.
Messages and hints may improve without a code change. New codes are additive;
renaming or removing a code requires a migration note. Redocly findings use the
dynamic `openapi.<rule-id>` namespace.

## Configuration

| Code                                   | Meaning                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `config.invalid`                       | The config export is not an object.                  |
| `config.schema.invalid`                | Effect Schema rejected the imported config boundary. |
| `config.product.required`              | Product configuration is missing or invalid.         |
| `config.product.id.required`           | Product ID is missing or blank.                      |
| `config.product.id.invalid`            | Product ID is not lowercase kebab-case.              |
| `config.product.display-name.required` | Product display name is missing or blank.            |
| `config.contract.required`             | Contract configuration is missing or invalid.        |
| `config.contract.spec.required`        | Contract path is missing or blank.                   |
| `config.contract.baseline.invalid`     | The configured OpenAPI baseline is unsupported.      |
| `config.profiles.required`             | No SDK profile is configured.                        |
| `config.profile.invalid`               | A profile name or profile object is invalid.         |
| `config.targets.required`              | No SDK target is configured.                         |
| `config.target.invalid`                | A target object is invalid.                          |
| `config.target.unknown`                | The target language is unsupported.                  |
| `config.target.output.required`        | Target output path is missing or blank.              |
| `config.target.identifier.required`    | Package/module/crate identifier is missing.          |
| `config.target.profile.missing`        | A target references an unconfigured profile.         |
| `config.array.required`                | A required config array is missing or empty.         |
| `config.value.invalid`                 | A config enum value is unsupported.                  |
| `config.boolean.invalid`               | A config boolean field has another type.             |

## Contract and metadata

| Code                                     | Meaning                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| `contract.file.unreadable`               | The contract file could not be read.                         |
| `contract.parse.failed`                  | Redocly could not parse or bundle the contract.              |
| `contract.document.invalid`              | The bundled root is not an object.                           |
| `contract.openapi.required`              | The OpenAPI version is missing.                              |
| `contract.openapi.unsupported`           | The OpenAPI version is outside the supported 3.1 line.       |
| `contract.openapi.baseline-mismatch`     | The 3.1 patch version differs from the authoring baseline.   |
| `contract.info.required`                 | The Info Object is missing.                                  |
| `contract.info.title.required`           | API title is missing.                                        |
| `contract.info.version.required`         | API version is missing.                                      |
| `contract.paths.required`                | Paths are missing.                                           |
| `contract.servers.required`              | Servers are missing.                                         |
| `contract.server.url.required`           | A server URL is missing.                                     |
| `contract.server.insecure`               | A non-local server does not use HTTPS.                       |
| `contract.product-metadata.required`     | `x-signalflare-product` is missing or invalid.               |
| `contract.product-id.required`           | Product metadata ID is missing.                              |
| `contract.product-id.mismatch`           | Product metadata ID differs from `sdk.config.ts`.            |
| `contract.product-display-name.required` | Product display name is missing.                             |
| `contract.product-version.invalid`       | Contract version is not a positive integer.                  |
| `contract.security-schemes.required`     | No explicit security scheme is declared.                     |
| `contract.security-scheme.invalid`       | A security scheme is malformed or unresolved.                |
| `contract.security-scheme.unsupported`   | A security scheme cannot be represented by current runtimes. |

## Operations

| Code                                        | Meaning                                                  |
| ------------------------------------------- | -------------------------------------------------------- |
| `operation.id.required`                     | `operationId` is missing.                                |
| `operation.id.invalid`                      | `operationId` is not a supported identifier.             |
| `operation.id.duplicate`                    | `operationId` is duplicated.                             |
| `operation.tags.required`                   | No service tag is declared.                              |
| `operation.sdk-metadata.required`           | `x-signalflare-sdk` is missing.                          |
| `operation.source-api.required`             | `x-signalflare-api-id` is missing.                       |
| `operation.audiences.required`              | SDK audiences are missing or empty.                      |
| `operation.audience.invalid`                | An SDK audience is unsupported.                          |
| `operation.visibility.invalid`              | SDK visibility is unsupported.                           |
| `operation.stability.invalid`               | SDK stability is unsupported.                            |
| `operation.generate.invalid`                | SDK `generate` is not boolean.                           |
| `operation.service.invalid`                 | SDK service override is blank or invalid.                |
| `operation.implemented.invalid`             | `x-signalflare-implemented` is not boolean.              |
| `operation.preview.production-audience`     | An unimplemented operation targets production.           |
| `operation.parameter.invalid`               | A parameter is malformed or unresolved.                  |
| `operation.parameter.name.required`         | Parameter name is missing.                               |
| `operation.parameter.location.invalid`      | Parameter location is unsupported.                       |
| `operation.parameter.duplicate`             | A parameter name/location pair is duplicated.            |
| `operation.path-parameter.required`         | A path parameter is not required.                        |
| `operation.path-parameter.unused`           | A path parameter has no path placeholder.                |
| `operation.path-parameter.missing`          | A path placeholder has no parameter.                     |
| `operation.path-body.duplicate`             | A path field is repeated in the JSON body.               |
| `operation.request-body.method-unsupported` | GET/DELETE declares a request body.                      |
| `operation.request-body.content.required`   | Request body content is missing.                         |
| `operation.request-schema.named-required`   | Production request JSON does not reference a component.  |
| `operation.responses.required`              | Responses are missing.                                   |
| `operation.success-response.required`       | No explicit 2xx response is declared.                    |
| `operation.response.content.invalid`        | Response content is not an object.                       |
| `operation.response-schema.named-required`  | Production success JSON does not reference a component.  |
| `operation.error-response.required`         | No expected error response is documented.                |
| `operation.error-schema.named-required`     | Error JSON does not reference a component.               |
| `operation.transport.unsupported`           | The operation requires a non-JSON transport.             |
| `operation.security.required`               | A production operation has no inherited or local policy. |
| `operation.security.invalid`                | Security requirements are not an array.                  |
| `operation.security-alternative.invalid`    | A security alternative is not an object.                 |
| `operation.security-scheme.unknown`         | A requirement references an unknown scheme.              |
| `operation.security-scopes.invalid`         | Security scopes are not strings.                         |

## Schema, profiles, and generation

| Code                                          | Meaning                                                          |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `schema.nullable.legacy`                      | OpenAPI 3.0 `nullable` appears in a 3.1 contract.                |
| `schema.effect-normalization.unsupported`     | Effect could not normalize the component schema collection.      |
| `schema.effect-import.unsupported`            | Effect cannot faithfully import a component; currently advisory. |
| `profile.not-configured`                      | A requested profile is absent.                                   |
| `profile.disabled`                            | A requested profile is disabled.                                 |
| `profile.empty`                               | A profile selects no generated operations.                       |
| `oagen.ir.model-reference.unresolved`         | Oagen IR references a missing model.                             |
| `oagen.ir.enum-reference.unresolved`          | Oagen IR references a missing enum.                              |
| `oagen.ir.discriminator-reference.unresolved` | An Oagen discriminator maps to a missing model.                  |
| `generation.typescript-import.unresolved`     | Generated TypeScript imports a missing local file.               |
