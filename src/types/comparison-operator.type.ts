/**
 * Supported comparison operators for field-level conditions.
 *
 * The set spans:
 *  - equality:     eq, neq
 *  - ordering:     gt, lt, gte, lte
 *  - membership:   in, notIn
 *  - presence:     exists, notExists, isNull, isNotNull
 *  - substring:    contains, notContains, startsWith, endsWith
 *  - range:        between  (value is [min, max])
 */
export type ComparisonOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'exists'
  | 'notExists'
  | 'isNull'
  | 'isNotNull'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'between';
