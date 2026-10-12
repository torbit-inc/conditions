import { COMPARISON_OPERATORS } from '../constants/comparison-operators.constant';

/**
 * Supported comparison operators for field-level conditions — derived from
 * the runtime list `COMPARISON_OPERATORS`, so the type and the list can never
 * drift.
 */
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];
