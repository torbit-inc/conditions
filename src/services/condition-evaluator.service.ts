import { Injectable } from '@nestjs/common';
import { Condition } from '../types/condition.type';
import { ComparisonOperator } from '../types/comparison-operator.type';
import { FieldType } from '../types/field-type.type';
import { coerceValue, resolveEffectiveType } from './value-coercion';

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
  /**
   * IANA time zone used to bucket `date`-typed comparisons to calendar days,
   * mirroring `ConditionSqlCompilerService` so preview (SQL) and apply (JS) agree
   * on which day an instant belongs to. Defaults to `'UTC'` when omitted.
   */
  readonly timeZone?: string;
}

/** Comparison operators whose `date` semantics are calendar-day-granular. */
const DATE_RANGE_OPERATORS: ReadonlySet<ComparisonOperator> = new Set([
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'between',
]);

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
      options.timeZone ?? 'UTC',
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
   * Coerces a value to the declared field type. Delegates to the shared
   * `coerceValue` so the evaluator and the SQL compiler never drift.
   */
  private coerce(value: unknown, type: FieldType | undefined): unknown {
    return coerceValue(value, type);
  }

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
    timeZone: string,
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

    const effectiveType: FieldType | undefined = resolveEffectiveType(
      declaredType,
      operator,
    );

    /* A `date` field names a calendar day, not an instant — compare at day
       granularity in `timeZone` so JS apply agrees with the SQL compiler. */
    if (effectiveType === 'date' && DATE_RANGE_OPERATORS.has(operator)) {
      return this.applyDateOperator(rawValue, operator, rawExpected, timeZone);
    }

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

  /**
   * Compares a `date` field to the expected value at CALENDAR-DAY granularity,
   * mirroring `ConditionSqlCompilerService.renderDateComparison`: the field
   * instant is bucketed to its day in `timeZone`, the expected value is read as a
   * bare calendar day. A field/value that is not a recognisable date matches
   * nothing (mirrors SQL NULL / NaN).
   */
  private applyDateOperator(
    rawValue: unknown,
    operator: ComparisonOperator,
    rawExpected: unknown,
    timeZone: string,
  ): boolean {
    const fieldEpoch = coerceValue(rawValue, 'date');
    if (typeof fieldEpoch !== 'number' || Number.isNaN(fieldEpoch)) {
      return false;
    }
    const fieldDay = this.tzDayNumber(fieldEpoch, timeZone);

    if (operator === 'between') {
      if (!Array.isArray(rawExpected) || rawExpected.length !== 2) return false;
      const lo = this.calendarDayNumber(rawExpected[0]);
      const hi = this.calendarDayNumber(rawExpected[1]);
      if (lo === null || hi === null) return false;
      return fieldDay >= lo && fieldDay <= hi;
    }

    const valueDay = this.calendarDayNumber(rawExpected);
    if (valueDay === null) return false;

    switch (operator) {
      case 'eq':
        return fieldDay === valueDay;
      case 'neq':
        return fieldDay !== valueDay;
      case 'gt':
        return fieldDay > valueDay;
      case 'lt':
        return fieldDay < valueDay;
      case 'gte':
        return fieldDay >= valueDay;
      case 'lte':
        return fieldDay <= valueDay;
      default:
        return false;
    }
  }

  /** Integer day index (days since epoch) of `epochMs` in the given time zone. */
  private tzDayNumber(epochMs: number, timeZone: string): number {
    /* en-CA renders `YYYY-MM-DD`; the tz option shifts the wall-clock date. */
    const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date(epochMs))
      .split('-')
      .map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  }

  /** Integer day index of a bare calendar date (`YYYY-MM-DD`/Date/epoch), or null. */
  private calendarDayNumber(value: unknown): number | null {
    if (typeof value === 'string') {
      const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!match) return null;
      return (
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
        86_400_000
      );
    }
    if (value instanceof Date) {
      return Math.floor(value.getTime() / 86_400_000);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.floor(value / 86_400_000);
    }
    return null;
  }
}
