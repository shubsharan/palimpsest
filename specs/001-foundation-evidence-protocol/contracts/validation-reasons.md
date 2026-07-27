# Validation Reason Contract

Both runtimes normalize validator and boundary failures into the same stable reason vocabulary. Human library messages are diagnostic only and are not cross-runtime contract values.

| Reason | Meaning | Pointer rule |
| --- | --- | --- |
| `schema_version` | Missing, non-integer, or unsupported `schemaVersion` | `/schemaVersion` |
| `required` | A required field is absent | Pointer includes the missing field |
| `unknown_field` | A schema-forbidden field is present | Pointer includes the unknown field |
| `type` | A value has the wrong JSON type | Pointer identifies the value |
| `enum` | A value is outside an allowed set | Pointer identifies the value |
| `format` | A string violates its declared format | Pointer identifies the string |
| `range` | A numeric or length bound is violated | Pointer identifies the value |
| `duplicate_key` | A JSON object repeats a decoded property name | Pointer identifies the repeated property |
| `unicode` | A string contains a lone surrogate or a path is not NFC | Pointer identifies the string |
| `number` | A number is non-finite, negative zero, or outside the permitted interoperable range | Pointer identifies the number |
| `unsafe_path` | An archive or output path is absolute, ambiguous, colliding, or otherwise forbidden | Pointer identifies the path |
| `canonical` | Raw bytes claimed as canonical do not equal the canonical serialization | Root or record pointer |
| `digest` | A declared SHA-256 does not match bytes | Pointer identifies the digest |
| `length` | A declared byte length does not match bytes | Pointer identifies the length |
| `stream` | NDJSON is malformed, noncanonical, has a sequence gap, lacks a terminal record, or continues after termination | Pointer identifies the record when known |

When several failures exist, both runtimes sort normalized failures by JSON Pointer, then reason code, and return the first. Fixture expectations use this ordering and never depend on Ajv or jsonschema message text.
