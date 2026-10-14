/**
 * Every comparison operator the DSL supports, as a runtime list — the single
 * source of truth for `ComparisonOperator`. Consumers use it to refuse
 * unknown operators before the evaluator throws on them.
 *
 *  - equality:     eq, neq
 *  - ordering:     gt, lt, gte, lte
 *  - membership:   in, notIn
 *  - presence:     exists, notExists, isNull, isNotNull
 *  - substring:    contains, notContains, startsWith, endsWith
 *  - range:        between  (value is [min, max])
 */
export const COMPARISON_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'in',
  'notIn',
  'exists',
  'notExists',
  'isNull',
  'isNotNull',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'between',
] as const;
