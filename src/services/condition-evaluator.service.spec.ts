import { ConditionEvaluatorService } from './condition-evaluator.service';
import { Condition } from '../types/condition.type';

describe('ConditionEvaluatorService', () => {
  let service: ConditionEvaluatorService;

  beforeEach(() => {
    service = new ConditionEvaluatorService();
  });

  const context = {
    user: {
      plan: 'basic',
      startupFeePaid: false,
      age: 25,
      roles: ['user', 'editor'],
      subscription: { status: 'active', isTrial: true },
    },
    order: { total: 150.5, items: 3 },
    missing: null,
  };

  /* === Ported tests from business-rules-service (behavior parity) === */

  describe('eq operator', () => {
    it('matches equal string values', () => {
      const c: Condition = { field: 'user.plan', operator: 'eq', value: 'basic' };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('does not match different string values', () => {
      const c: Condition = { field: 'user.plan', operator: 'eq', value: 'premium' };
      expect(service.evaluate(c, context)).toBe(false);
    });
    it('matches boolean values', () => {
      const c: Condition = { field: 'user.startupFeePaid', operator: 'eq', value: false };
      expect(service.evaluate(c, context)).toBe(true);
    });
  });

  describe('neq operator', () => {
    it('matches when values differ', () => {
      const c: Condition = { field: 'user.plan', operator: 'neq', value: 'premium' };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('does not match when values are equal', () => {
      const c: Condition = { field: 'user.plan', operator: 'neq', value: 'basic' };
      expect(service.evaluate(c, context)).toBe(false);
    });
  });

  describe('numeric comparisons (default JS coercion)', () => {
    it('gt: matches when field > value', () => {
      const c: Condition = { field: 'user.age', operator: 'gt', value: 18 };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('lt: matches when field < value', () => {
      const c: Condition = { field: 'user.age', operator: 'lt', value: 30 };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('gte: matches when field >= value', () => {
      const c: Condition = { field: 'user.age', operator: 'gte', value: 25 };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('lte: matches when field <= value', () => {
      const c: Condition = { field: 'order.total', operator: 'lte', value: 200 };
      expect(service.evaluate(c, context)).toBe(true);
    });
  });

  describe('in / notIn', () => {
    it('in: matches when field value is in the array', () => {
      const c: Condition = { field: 'user.plan', operator: 'in', value: ['basic', 'trial'] };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('notIn: matches when field value is not in the array', () => {
      const c: Condition = { field: 'user.plan', operator: 'notIn', value: ['premium'] };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('in: returns false when expected is not an array', () => {
      const c: Condition = { field: 'user.plan', operator: 'in', value: 'basic' as unknown };
      expect(service.evaluate(c, context)).toBe(false);
    });
  });

  describe('exists / notExists', () => {
    it('exists: matches when field has a value', () => {
      const c: Condition = { field: 'user.plan', operator: 'exists' };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('exists: does not match when field is null', () => {
      const c: Condition = { field: 'missing', operator: 'exists' };
      expect(service.evaluate(c, context)).toBe(false);
    });
    it('notExists: matches for unresolvable path', () => {
      const c: Condition = { field: 'nonexistent.deep.path', operator: 'notExists' };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('exists: returns true for falsy-but-present values (0, empty string, false)', () => {
      expect(service.evaluate({ field: 'balance', operator: 'exists' }, { balance: 0 })).toBe(true);
      expect(service.evaluate({ field: 'name', operator: 'exists' }, { name: '' })).toBe(true);
      expect(service.evaluate({ field: 'opted', operator: 'exists' }, { opted: false })).toBe(true);
    });
  });

  describe('combinators', () => {
    it('and: returns true when all conditions pass', () => {
      const c: Condition = {
        and: [
          { field: 'user.plan', operator: 'eq', value: 'basic' },
          { field: 'user.age', operator: 'gte', value: 18 },
        ],
      };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('and: empty array is vacuously true', () => {
      expect(service.evaluate({ and: [] }, context)).toBe(true);
    });
    it('or: empty array is false', () => {
      expect(service.evaluate({ or: [] }, context)).toBe(false);
    });
    it('not: negates the inner condition', () => {
      const c: Condition = { not: { field: 'user.plan', operator: 'eq', value: 'premium' } };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('deeply nested logical tree', () => {
      const c: Condition = {
        or: [
          {
            and: [
              { field: 'user.plan', operator: 'eq', value: 'premium' },
              { field: 'user.age', operator: 'gte', value: 18 },
            ],
          },
          {
            and: [
              { field: 'user.plan', operator: 'eq', value: 'basic' },
              { field: 'order.total', operator: 'gt', value: 100 },
            ],
          },
        ],
      };
      expect(service.evaluate(c, context)).toBe(true);
    });
  });

  describe('unsupported operator', () => {
    it('throws', () => {
      const c = { field: 'user.plan', operator: 'regex' as 'eq', value: '.*' } as Condition;
      expect(() => service.evaluate(c, context)).toThrow('Unsupported operator');
    });
  });

  /* === Typed coercion === */

  describe('typed coercion (fieldTypes hint)', () => {
    it('coerces string "41" to number for gt comparison', () => {
      const ctx = { industryData: { cuotasEnMora: '41' } };
      const c: Condition = {
        field: 'industryData.cuotasEnMora',
        operator: 'gt',
        value: 1,
      };
      expect(
        service.evaluate(c, ctx, {
          fieldTypes: { 'industryData.cuotasEnMora': 'number' },
        }),
      ).toBe(true);
    });

    it('coerces non-numeric string to NaN — gt returns false', () => {
      const ctx = { industryData: { cuotasEnMora: 'abc' } };
      const c: Condition = {
        field: 'industryData.cuotasEnMora',
        operator: 'gt',
        value: 1,
      };
      expect(
        service.evaluate(c, ctx, {
          fieldTypes: { 'industryData.cuotasEnMora': 'number' },
        }),
      ).toBe(false);
    });

    it('coerces expected value too: gt with string field and string expected', () => {
      const ctx = { industryData: { cuotasEnMora: '41' } };
      const c: Condition = {
        field: 'industryData.cuotasEnMora',
        operator: 'gt',
        value: '40',
      };
      expect(
        service.evaluate(c, ctx, {
          fieldTypes: { 'industryData.cuotasEnMora': 'number' },
        }),
      ).toBe(true);
    });

    it('coerces strings to booleans', () => {
      const ctx = { flag: 'true' };
      const c: Condition = { field: 'flag', operator: 'eq', value: true };
      expect(
        service.evaluate(c, ctx, { fieldTypes: { flag: 'boolean' } }),
      ).toBe(true);
    });

    it('coerces ISO date strings for ordering', () => {
      const ctx = { d: '2026-05-01T00:00:00Z' };
      const c: Condition = { field: 'd', operator: 'gt', value: '2025-01-01T00:00:00Z' };
      expect(
        service.evaluate(c, ctx, { fieldTypes: { d: 'date' } }),
      ).toBe(true);
    });

    it('defaults to JS coercion when no type hint is given', () => {
      const ctx = { score: '30' };
      const c: Condition = { field: 'score', operator: 'gt', value: 25 };
      expect(service.evaluate(c, ctx)).toBe(true);
    });
  });

  /* === Numeric-operator-implies-number === */

  describe('numeric operators imply Number coercion (no fieldType hint)', () => {
    it('gt: compares strings as numbers — "30" > "5" is true', () => {
      const ctx = { score: '30' };
      const c: Condition = { field: 'score', operator: 'gt', value: '5' };
      expect(service.evaluate(c, ctx)).toBe(true);
    });

    it('gt: non-numeric string coerces to NaN — never matches', () => {
      const ctx = { score: 'abc' };
      const c: Condition = { field: 'score', operator: 'gt', value: '5' };
      expect(service.evaluate(c, ctx)).toBe(false);
    });

    it('lt: string < string treats both as numbers', () => {
      const ctx = { score: '5' };
      const c: Condition = { field: 'score', operator: 'lt', value: '30' };
      expect(service.evaluate(c, ctx)).toBe(true);
    });

    it('between: string bounds get parsed too', () => {
      const ctx = { score: '15' };
      const c: Condition = {
        field: 'score',
        operator: 'between',
        value: ['10', '20'],
      };
      expect(service.evaluate(c, ctx)).toBe(true);
    });

    it('between: returns false when field is non-numeric', () => {
      const ctx = { score: 'not-a-number' };
      const c: Condition = {
        field: 'score',
        operator: 'between',
        value: ['10', '20'],
      };
      expect(service.evaluate(c, ctx)).toBe(false);
    });

    it('explicit string fieldType still wins over the numeric-operator default', () => {
      /* If the caller really wants lexicographic gt, they say so. */
      const ctx = { code: 'B' };
      const c: Condition = { field: 'code', operator: 'gt', value: 'A' };
      expect(
        service.evaluate(c, ctx, { fieldTypes: { code: 'string' } }),
      ).toBe(true);
    });

    it('eq: NOT a numeric operator — preserves strict equality', () => {
      const ctx = { score: '30' };
      const c: Condition = { field: 'score', operator: 'eq', value: 30 };
      /* String "30" !== number 30 under strict eq */
      expect(service.evaluate(c, ctx)).toBe(false);
    });
  });

  /* === New operators === */

  describe('isNull / isNotNull', () => {
    it('isNull matches exact null but not undefined', () => {
      expect(service.evaluate({ field: 'missing', operator: 'isNull' }, context)).toBe(true);
      expect(service.evaluate({ field: 'absent.path', operator: 'isNull' }, context)).toBe(false);
    });
    it('isNotNull matches everything except null', () => {
      expect(service.evaluate({ field: 'missing', operator: 'isNotNull' }, context)).toBe(false);
      expect(service.evaluate({ field: 'user.age', operator: 'isNotNull' }, context)).toBe(true);
      expect(service.evaluate({ field: 'absent.path', operator: 'isNotNull' }, context)).toBe(true);
    });
  });

  describe('contains / notContains', () => {
    it('contains matches substring', () => {
      const c: Condition = { field: 'user.plan', operator: 'contains', value: 'asi' };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('contains is false when field is not a string', () => {
      const c: Condition = { field: 'user.age', operator: 'contains', value: '2' };
      expect(service.evaluate(c, context)).toBe(false);
    });
    it('notContains matches absence of substring', () => {
      const c: Condition = { field: 'user.plan', operator: 'notContains', value: 'xyz' };
      expect(service.evaluate(c, context)).toBe(true);
    });
  });

  describe('startsWith / endsWith', () => {
    it('startsWith matches prefix', () => {
      expect(
        service.evaluate({ field: 'user.plan', operator: 'startsWith', value: 'ba' }, context),
      ).toBe(true);
    });
    it('endsWith matches suffix', () => {
      expect(
        service.evaluate({ field: 'user.plan', operator: 'endsWith', value: 'ic' }, context),
      ).toBe(true);
    });
  });

  describe('between', () => {
    it('inclusive range — matches at lower bound', () => {
      const c: Condition = { field: 'user.age', operator: 'between', value: [25, 30] };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('inclusive range — matches at upper bound', () => {
      const c: Condition = { field: 'user.age', operator: 'between', value: [18, 25] };
      expect(service.evaluate(c, context)).toBe(true);
    });
    it('does not match outside range', () => {
      const c: Condition = { field: 'user.age', operator: 'between', value: [40, 50] };
      expect(service.evaluate(c, context)).toBe(false);
    });
    it('returns false for malformed value', () => {
      const c: Condition = { field: 'user.age', operator: 'between', value: [25] as unknown };
      expect(service.evaluate(c, context)).toBe(false);
    });
    it('coerces bounds with field type', () => {
      const ctx = { industryData: { cuotasEnMora: '41' } };
      const c: Condition = {
        field: 'industryData.cuotasEnMora',
        operator: 'between',
        value: ['40', '50'],
      };
      expect(
        service.evaluate(c, ctx, {
          fieldTypes: { 'industryData.cuotasEnMora': 'number' },
        }),
      ).toBe(true);
    });
  });
});
