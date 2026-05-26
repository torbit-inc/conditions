import { Injectable } from '@nestjs/common';
import { Condition } from '../types/condition.type';
import { ComparisonOperator } from '../types/comparison-operator.type';
import { FieldType } from '../types/field-type.type';

/**
 * Optional evaluation hints. When `fieldTypes` is supplied, the evaluator
 * coerces resolved field values to the declared primitive type before applying
 * comparison operators. This is required when conditions filter JSONB-backed
 * data where everything arrives as strings (e.g. an ingestion payload).
 *
 * Without hints, the evaluator preserves JavaScript's default coercion (the
 * original behavior of the business-rules-service evaluator).
 */
export interface EvaluateOptions {
  readonly fieldTypes?: Record<string, FieldType>;
}

/**
 * Evaluates Condition trees against a context object.
 *
 * Supports field comparisons, logical combinators (and/or/not), nested
 * dot-path resolution, and optional typed coercion for JSONB-sourced data.
 */
@Injectable()
export class ConditionEvaluatorService {
  evaluate(
    condition: Condition,
    context: Record<string, unknown>,
    options: EvaluateOptions = {},
  ): boolean {
    if ('and' in condition) {
      return condition.and.every((c) => this.evaluate(c, context, options));
    }

    if ('or' in condition) {
      return condition.or.some((c) => this.evaluate(c, context, options));
    }

    if ('not' in condition) {
      return !this.evaluate(condition.not, context, options);
    }

    const rawValue = this.getNestedValue(context, condition.field);
    const declaredType = options.fieldTypes?.[condition.field];
    return this.applyOperator(
      rawValue,
      condition.operator,
      condition.value,
      declaredType,
    );
  }

  /**
   * Resolves a dot-path against a nested object. Returns undefined for
   * unresolvable paths (safe forward references).
   */
  private getNestedValue(
    obj: Record<string, unknown>,
    path: string,
  ): unknown {
    const segments = path.split('.');
    let current: unknown = obj;

    for (const segment of segments) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }

    return current;
  }

  /**
   * Coerces a value to the declared field type. Returns the original value
   * when no type is declared or when coercion would lose information (the
   * comparison itself will handle the fallout via NaN or strict-equality).
   */
  private coerce(value: unknown, type: FieldType | undefined): unknown {
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

  /**
   * Operators whose semantics are inherently numeric — if no explicit
   * `fieldType` hint is supplied, the evaluator defaults to `'number'`
   * so `"30" > "5"` yields `true` instead of falling into JavaScript's
   * lexicographic string comparison (which would return `false`).
   *
   * Strings that don't parse as numbers coerce to `NaN`; every comparison
   * against `NaN` is `false`, so non-numeric data silently fails to match
   * — the documented contract.
   */
  private static readonly NUMERIC_OPERATORS: ReadonlySet<ComparisonOperator> =
    new Set(['gt', 'lt', 'gte', 'lte', 'between']);

  /**
   * Applies a comparison operator. When `declaredType` is set, both the field
   * value and (where relevant) the expected value are coerced before
   * comparison. Numeric-only operators (gt/lt/gte/lte/between) default to
   * `'number'` coercion when no type hint is provided.
   */
  private applyOperator(
    rawValue: unknown,
    operator: ComparisonOperator,
    rawExpected: unknown,
    declaredType: FieldType | undefined,
  ): boolean {
    /** Presence operators short-circuit before coercion */
    switch (operator) {
      case 'exists':
        return rawValue !== undefined && rawValue !== null;
      case 'notExists':
        return rawValue === undefined || rawValue === null;
      case 'isNull':
        return rawValue === null;
      case 'isNotNull':
        return rawValue !== null;
    }

    const effectiveType: FieldType | undefined =
      declaredType ??
      (ConditionEvaluatorService.NUMERIC_OPERATORS.has(operator)
        ? 'number'
        : undefined);

    const fieldValue = this.coerce(rawValue, effectiveType);
    const expected =
      operator === 'in' ||
      operator === 'notIn' ||
      operator === 'between'
        ? rawExpected
        : this.coerce(rawExpected, effectiveType);

    switch (operator) {
      case 'eq':
        return fieldValue === expected;
      case 'neq':
        return fieldValue !== expected;
      case 'gt':
        return (fieldValue as number) > (expected as number);
      case 'lt':
        return (fieldValue as number) < (expected as number);
      case 'gte':
        return (fieldValue as number) >= (expected as number);
      case 'lte':
        return (fieldValue as number) <= (expected as number);
      case 'in':
        return Array.isArray(rawExpected) && rawExpected.includes(fieldValue);
      case 'notIn':
        return Array.isArray(rawExpected) && !rawExpected.includes(fieldValue);
      case 'contains':
        return (
          typeof fieldValue === 'string' &&
          typeof expected === 'string' &&
          fieldValue.includes(expected)
        );
      case 'notContains':
        return (
          typeof fieldValue === 'string' &&
          typeof expected === 'string' &&
          !fieldValue.includes(expected)
        );
      case 'startsWith':
        return (
          typeof fieldValue === 'string' &&
          typeof expected === 'string' &&
          fieldValue.startsWith(expected)
        );
      case 'endsWith':
        return (
          typeof fieldValue === 'string' &&
          typeof expected === 'string' &&
          fieldValue.endsWith(expected)
        );
      case 'between': {
        if (!Array.isArray(rawExpected) || rawExpected.length !== 2) {
          return false;
        }
        const min = this.coerce(rawExpected[0], effectiveType);
        const max = this.coerce(rawExpected[1], effectiveType);
        return (
          (fieldValue as number) >= (min as number) &&
          (fieldValue as number) <= (max as number)
        );
      }
      default:
        throw new Error(`Unsupported operator: "${String(operator)}"`);
    }
  }
}
