import { FieldCondition } from './field-condition.type';

/**
 * Structured, composable condition tree.
 *
 * Intentionally NOT Turing-complete — limited to field comparisons and logical
 * combinators (and / or / not). Trees are serializable to JSONB and survive
 * round-trips through PostgreSQL.
 */
export type Condition =
  | FieldCondition
  | { readonly and: Condition[] }
  | { readonly or: Condition[] }
  | { readonly not: Condition };
