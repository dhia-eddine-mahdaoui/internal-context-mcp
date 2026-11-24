// Strict JSON-Schema-subset validator (type, enum, bounds, pattern, required, additionalProperties:false).
// Reports every violation with its path instead of stopping at the first, so a caller can fix a bad call in one round trip.
export interface Schema {
  type?: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array';
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: readonly (string | number)[];
  minLength?: number; maxLength?: number; pattern?: string;
  minimum?: number; maximum?: number;
  items?: Schema; minItems?: number; maxItems?: number; uniqueItems?: boolean;
  default?: unknown; description?: string;
}

export function validate(value: unknown, schema: Schema, path = 'arguments', errors: string[] = [], depth = 0): string[] {
  if (depth > 8) { errors.push(`${path}: nested too deeply`); return errors; }
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errors.push(`${path}: must be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`);
    return errors;
  }
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path}: expected an object`); break; }
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}.${key}: required`);
      for (const [key, item] of Object.entries(obj)) {
        const sub = schema.properties?.[key];
        if (!sub) {
          if (schema.additionalProperties === false) errors.push(`${path}.${key}: unknown field (allowed: ${Object.keys(schema.properties ?? {}).join(', ') || 'none'})`);
          continue;
        }
        validate(item, sub, `${path}.${key}`, errors, depth + 1);
      }
      break;
    }
    case 'string': {
      if (typeof value !== 'string') { errors.push(`${path}: expected a string`); break; }
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: must be at least ${schema.minLength} characters`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: must be at most ${schema.maxLength} characters`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match required format ${schema.pattern}`);
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) errors.push(`${path}: contains control characters`);
      break;
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) { errors.push(`${path}: expected a number`); break; }
      if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected an integer`);
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected a boolean`);
      break;
    case 'array': {
      if (!Array.isArray(value)) { errors.push(`${path}: expected an array`); break; }
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: at most ${schema.maxItems} item(s)`);
      if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) errors.push(`${path}: items must be unique`);
      if (schema.items) value.forEach((v, i) => validate(v, schema.items!, `${path}[${i}]`, errors, depth + 1));
      break;
    }
  }
  return errors;
}
