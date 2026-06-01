import { Injectable } from '@nestjs/common';
import { Condition } from '../types/condition.type';
import { ComparisonOperator } from '../types/comparison-operator.type';
import { FieldType } from '../types/field-type.type';
import { coerceValue, resolveEffectiveType } from './value-coercion';

/**
 * Physical shape of a field's SQL expression.
 *  - `column`: a native-typed table column (e.g. `d."grupo"` is integer). No
 *    text→type guard is needed before a numeric/date cast.
 *  - `json`: a JSONB text extraction (e.g. `d."industryData" #>> '{k}'`). The
 *    value is always text, so numeric/date comparisons must guard the cast to
 *    avoid aborting the whole query on a non-numeric row.
 */
export type FieldSqlKind = 'column' | 'json';

/**
 * Tells the compiler how to render a `field` path as SQL. Produced by the
 * consuming service (which alone knows its columns / JSONB layout); the
 * compiler stays schema-agnostic.
 */
export interface FieldSqlBinding {
  /** SQL expression yielding the field value (column ref or JSONB text). */
  readonly sql: string;
  /** Physical kind — drives guarded casting. */
  readonly kind: FieldSqlKind;
  /** Declared logical type — drives coercion, mirroring the evaluator. */
  readonly type?: FieldType;
}

export interface CompileOptions {
  /** Maps a dot-path to its SQL binding; `null` ⇒ the field is not filterable. */
  readonly resolveField: (path: string) => FieldSqlBinding | null;
}

export interface CompiledCondition {
  /** A parenthesised, parameterised WHERE fragment (TypeORM `.where(sql, params)`). */
  readonly sql: string;
  /** Named parameters referenced by `sql` (`:c0`, `:c1`, …). */
  readonly parameters: Record<string, unknown>;
  /** Field paths that could not be resolved (each compiled to `FALSE`). */
  readonly warnings: string[];
}

/** Mutable accumulator threaded through the recursive walk. */
interface CompileContext {
  readonly resolveField: (path: string) => FieldSqlBinding | null;
  readonly parameters: Record<string, unknown>;
  readonly warnings: string[];
  next: number;
}

/** Numeric-looking text guard (mirrors `Number(trim)` acceptance closely). */
const NUMERIC_GUARD = String.raw`^\s*-?\d+(\.\d+)?\s*$`;
/** Date-looking text guard — ISO date / timestamp prefixes. */
const DATE_GUARD = String.raw`^\s*\d{4}-\d{2}-\d{2}([T ].*)?\s*$`;

/**
 * Compiles a Condition tree into a parameterised SQL WHERE fragment so the
 * database does the filtering instead of streaming every row into the app and
 * evaluating in JavaScript.
 *
 * Semantics mirror `ConditionEvaluatorService`: the *expected* side of each
 * comparison is coerced at compile time via the shared `coerceValue`, and the
 * *field* side is cast in SQL to the same effective type, so SQL results agree
 * with the in-memory evaluator on the realistic (type-consistent) inputs the
 * field picker produces.
 *
 * Known, documented divergences (inherent to SQL three-valued logic): on a
 * NULL/absent field, `neq` and `notIn` yield no match in SQL (NULL) whereas
 * the JS evaluator treats an absent field as a non-equal/non-member match.
 * Conditions are built from a typed field picker, so these edges are rare.
 */
@Injectable()
export class ConditionSqlCompilerService {
  compile(condition: Condition, options: CompileOptions): CompiledCondition {
    const ctx: CompileContext = {
      resolveField: options.resolveField,
      parameters: {},
      warnings: [],
      next: 0,
    };
    const sql = this.walk(condition, ctx);
    return { sql, parameters: ctx.parameters, warnings: ctx.warnings };
  }

  /** Recursively renders one node. */
  private walk(condition: Condition, ctx: CompileContext): string {
    if ('and' in condition) {
      if (condition.and.length === 0) return 'TRUE';
      return `(${condition.and.map((c) => this.walk(c, ctx)).join(' AND ')})`;
    }
    if ('or' in condition) {
      if (condition.or.length === 0) return 'FALSE';
      return `(${condition.or.map((c) => this.walk(c, ctx)).join(' OR ')})`;
    }
    if ('not' in condition) {
      return `(NOT (${this.walk(condition.not, ctx)}))`;
    }
    return this.renderLeaf(condition, ctx);
  }

  /** Renders a single field comparison. */
  private renderLeaf(
    condition: { field: string; operator: ComparisonOperator; value?: unknown },
    ctx: CompileContext,
  ): string {
    const binding = ctx.resolveField(condition.field);
    if (!binding) {
      ctx.warnings.push(condition.field);
      return 'FALSE';
    }

    const op = condition.operator;

    /* Presence operators short-circuit before any cast — mirror the evaluator. */
    switch (op) {
      case 'exists':
      case 'isNotNull':
        return `${binding.sql} IS NOT NULL`;
      case 'notExists':
      case 'isNull':
        return `${binding.sql} IS NULL`;
    }

    const effectiveType = resolveEffectiveType(binding.type, op);
    const field = this.renderField(binding, effectiveType);

    switch (op) {
      case 'eq':
        return `${field} = ${this.param(ctx, coerceValue(condition.value, effectiveType))}`;
      case 'neq':
        return `${field} <> ${this.param(ctx, coerceValue(condition.value, effectiveType))}`;
      case 'gt':
        return `${field} > ${this.param(ctx, coerceValue(condition.value, effectiveType))}`;
      case 'lt':
        return `${field} < ${this.param(ctx, coerceValue(condition.value, effectiveType))}`;
      case 'gte':
        return `${field} >= ${this.param(ctx, coerceValue(condition.value, effectiveType))}`;
      case 'lte':
        return `${field} <= ${this.param(ctx, coerceValue(condition.value, effectiveType))}`;
      case 'in':
        /* Array is bound raw (uncoerced) to mirror the evaluator's `includes`. */
        return `${field} = ANY(${this.param(ctx, condition.value)})`;
      case 'notIn':
        return `(${field} <> ALL(${this.param(ctx, condition.value)}))`;
      case 'contains':
        return `${field} LIKE ${this.likeParam(ctx, condition.value, 'contains')} ESCAPE '\\'`;
      case 'notContains':
        return `${field} NOT LIKE ${this.likeParam(ctx, condition.value, 'contains')} ESCAPE '\\'`;
      case 'startsWith':
        return `${field} LIKE ${this.likeParam(ctx, condition.value, 'startsWith')} ESCAPE '\\'`;
      case 'endsWith':
        return `${field} LIKE ${this.likeParam(ctx, condition.value, 'endsWith')} ESCAPE '\\'`;
      case 'between':
        return this.renderBetween(field, condition.value, effectiveType, ctx);
      default:
        /* Unknown operator: fail closed rather than emit malformed SQL. */
        ctx.warnings.push(`${condition.field}:${String(op)}`);
        return 'FALSE';
    }
  }

  /**
   * Renders the field expression cast to the comparable type. `column` kinds
   * are already native-typed; `json` kinds are text and need a guarded cast
   * so non-numeric / non-date rows resolve to NULL (no match) instead of
   * aborting the query.
   */
  private renderField(
    binding: FieldSqlBinding,
    effectiveType: FieldType | undefined,
  ): string {
    const e = binding.sql;

    /*
     * Native-typed columns are compared RAW (just `(e)`) so the predicate stays
     * sargable and the planner can use an index on the column. Wrapping an
     * integer column in CAST(... AS numeric) — or a varchar in CAST(... AS
     * text) — would force a type conversion that defeats the index. The
     * expected value is coerced in JS to the matching type, so no field cast is
     * needed. (No typed `date` columns exist; the epoch form is kept only for
     * correctness should one appear — it is not an indexed path.)
     */
    if (binding.kind === 'column') {
      return effectiveType === 'date'
        ? `(EXTRACT(EPOCH FROM CAST((${e}) AS timestamptz)) * 1000)`
        : `(${e})`;
    }

    /*
     * JSONB extractions arrive as text, so numeric/date/boolean comparisons
     * need a cast. Casts use CAST(x AS t), never `x::t` — the `::` form
     * collides with TypeORM's `:param` placeholder parser (it reads `::numeric`
     * as a bound param named "numeric"). Numeric/date casts are guarded so a
     * non-conforming row resolves to NULL (no match) instead of aborting the
     * whole query.
     */
    switch (effectiveType) {
      case 'number':
        return `CASE WHEN (${e}) ~ '${NUMERIC_GUARD}' THEN CAST((${e}) AS numeric) END`;
      case 'date':
        return `CASE WHEN (${e}) ~ '${DATE_GUARD}' THEN (EXTRACT(EPOCH FROM CAST((${e}) AS timestamptz)) * 1000) END`;
      case 'boolean':
        return `CASE WHEN lower((${e})) = 'true' THEN true WHEN lower((${e})) = 'false' THEN false ELSE ((${e}) <> '') END`;
      case 'string':
      case undefined:
      default:
        /* Already text from `->>`; compare directly. */
        return `(${e})`;
    }
  }

  /** Renders a numeric/date BETWEEN with two coerced bounds. */
  private renderBetween(
    field: string,
    value: unknown,
    effectiveType: FieldType | undefined,
    ctx: CompileContext,
  ): string {
    if (!Array.isArray(value) || value.length !== 2) {
      /* Mirror the evaluator: malformed range matches nothing. */
      return 'FALSE';
    }
    const lo = this.param(ctx, coerceValue(value[0], effectiveType));
    const hi = this.param(ctx, coerceValue(value[1], effectiveType));
    return `${field} BETWEEN ${lo} AND ${hi}`;
  }

  /**
   * Registers a value as a fresh named parameter and returns its placeholder.
   */
  private param(ctx: CompileContext, value: unknown): string {
    const name = `c${ctx.next++}`;
    ctx.parameters[name] = value;
    return `:${name}`;
  }

  /**
   * Builds a LIKE parameter: coerce the needle to a string, escape LIKE
   * metacharacters (`\ % _`), then wrap with `%` per the substring operator.
   * Case-sensitive to mirror JavaScript `String.includes`.
   */
  private likeParam(
    ctx: CompileContext,
    value: unknown,
    mode: 'contains' | 'startsWith' | 'endsWith',
  ): string {
    const needle = String(coerceValue(value, 'string') ?? '');
    const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern =
      mode === 'contains'
        ? `%${escaped}%`
        : mode === 'startsWith'
          ? `${escaped}%`
          : `%${escaped}`;
    return this.param(ctx, pattern);
  }
}
