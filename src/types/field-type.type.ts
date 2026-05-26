/**
 * Hint describing the underlying type of a field in the evaluation context.
 *
 * Used by ConditionEvaluatorService to coerce JSONB-sourced string values
 * (e.g. "41") into the correct primitive before applying comparison operators.
 *
 * Without a hint, the evaluator falls back to JavaScript's default coercion
 * (preserving the pre-typed-coercion behavior of the original evaluator).
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date';
