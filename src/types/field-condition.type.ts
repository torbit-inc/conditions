import { ComparisonOperator } from './comparison-operator.type';

/**
 * A single field comparison condition.
 *
 * Dot-paths resolve through nested objects (e.g. `industryData.cuotasEnMora`).
 */
export type FieldCondition = {
  /** Dot-path to the field in the evaluation context */
  readonly field: string;

  /** Comparison operator */
  readonly operator: ComparisonOperator;

  /** Value to compare against (omitted for exists/notExists/isNull/isNotNull) */
  readonly value?: unknown;
};
