import { ComparisonOperator } from '../types/comparison-operator.type';
import { FieldType } from '../types/field-type.type';

/**
 * Shared coercion primitives for the condition DSL.
 *
 * Extracted so the in-memory `ConditionEvaluatorService` and the
 * `ConditionSqlCompilerService` apply IDENTICAL value coercion — the SQL
 * compiler coerces the *expected* side of every comparison at compile time
 * with exactly the same rules the evaluator uses at run time, which is what
 * keeps preview (SQL) and apply (SQL) in lock-step with the legacy in-memory
 * path. Do not fork this logic; both consumers depend on it being one source
 * of truth.
 */

/**
 * Operators whose semantics are inherently numeric — if no explicit field-type
 * hint is supplied they default to `'number'` so `"30" > "5"` yields `true`
 * instead of falling into JavaScript's lexicographic string comparison.
 */
export const NUMERIC_OPERATORS: ReadonlySet<ComparisonOperator> = new Set([
  'gt',
  'lt',
  'gte',
  'lte',
  'between',
]);

/**
 * Resolves the type used to coerce a comparison's operands: the declared type
 * if present, otherwise `'number'` for the numeric-only operators, otherwise
 * `undefined` (no coercion — JavaScript default semantics).
 */
export function resolveEffectiveType(
  declaredType: FieldType | undefined,
  operator: ComparisonOperator,
): FieldType | undefined {
  return declaredType ?? (NUMERIC_OPERATORS.has(operator) ? 'number' : undefined);
}

/**
 * Coerces a value to the declared field type. Returns the original value when
 * no type is declared or when the input is null/undefined. Mirrors the exact
 * rules the original business-rules-service evaluator used.
 */
export function coerceValue(value: unknown, type: FieldType | undefined): unknown {
  if (type === undefined || value === undefined || value === null) {
    return value;
  }
  if (type === 'number') {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return NaN;
      const parsed = Number(trimmed);
      return Number.isNaN(parsed) ? NaN : parsed;
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    return NaN;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
    }
    return Boolean(value);
  }
  if (type === 'date') {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? NaN : parsed;
    }
    return NaN;
  }
  /** string */
  if (typeof value === 'string') return value;
  return String(value);
}
