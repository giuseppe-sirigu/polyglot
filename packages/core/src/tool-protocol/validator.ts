import { Ajv, type ValidateFunction } from "ajv";
import type { JsonSchema } from "../tools/types.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const cache = new Map<JsonSchema, ValidateFunction>();

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateAgainstSchema(schema: JsonSchema, input: unknown): ValidationResult {
  const cached = cache.get(schema);
  const validate = cached ?? ajv.compile(schema);
  if (!cached) {
    cache.set(schema, validate);
  }

  const ok = validate(input);
  if (ok) return { ok: true, errors: [] };

  const errors = (validate.errors ?? []).map((e) => {
    const path = e.instancePath || "(root)";
    return `${path} ${e.message ?? "is invalid"}`;
  });
  return { ok: false, errors };
}
