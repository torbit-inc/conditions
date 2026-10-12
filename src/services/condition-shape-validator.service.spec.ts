import { ConditionShapeValidatorService } from './condition-shape-validator.service';
import { COMPARISON_OPERATORS } from '../constants/comparison-operators.constant';

/** Builds a condition nested `levels` deep with `not` wrappers. */
const nestedNot = (levels: number): unknown =>
  [...Array(levels)].reduce<unknown>((c) => ({ not: c }), {
    field: 'a',
    operator: 'eq',
    value: 1,
  });

/** Sample value accepted by each operator. */
const sampleValueFor = (operator: string): unknown => {
  if (operator === 'in' || operator === 'notIn') return [1, 2];
  if (operator === 'between') return [1, 2];
  return 1;
};

describe('ConditionShapeValidatorService', () => {
  const validator = new ConditionShapeValidatorService();

  describe('accepts', () => {
    it.each(COMPARISON_OPERATORS.map((op) => [op]))(
      'a leaf with operator "%s"',
      (operator) => {
        const leaf = { field: 'a.b', operator, value: sampleValueFor(operator) };
        expect(validator.errors(leaf)).toEqual([]);
        expect(validator.isValid(leaf)).toBe(true);
      },
    );

    it('a presence leaf without a value', () => {
      expect(validator.errors({ field: 'a', operator: 'exists' })).toEqual([]);
    });

    it('nested and / or / not trees', () => {
      const tree = {
        and: [
          { field: 'a', operator: 'eq', value: 1 },
          { or: [{ not: { field: 'b', operator: 'in', value: ['x'] } }] },
        ],
      };
      expect(validator.errors(tree)).toEqual([]);
    });

    it('an empty and', () => {
      expect(validator.errors({ and: [] })).toEqual([]);
    });

    it('a tree at exactly the maximum depth', () => {
      expect(validator.errors(nestedNot(7))).toEqual([]);
    });
  });

  describe('rejects', () => {
    it.each<[string, unknown, RegExp]>([
      [
        'the 2026-10-12 incident shape {all:[...]}',
        { all: [{ field: 'a', operator: 'eq', value: 1 }] },
        /condition: unknown key "all"/,
      ],
      ['a leaf without field', { operator: 'eq', value: 1 }, /condition: "field" must be a non-empty string/],
      ['a non-string field', { field: 7, operator: 'eq' }, /"field" must be a non-empty string/],
      ['an empty field', { field: '', operator: 'eq' }, /"field" must be a non-empty string/],
      ['an unknown operator', { field: 'a', operator: 'like', value: 1 }, /condition: unknown operator "like"/],
      ['a missing operator', { field: 'a', value: 1 }, /unknown operator "undefined"/],
      ['and that is not an array', { and: 'x' }, /condition\.and: must be an array/],
      ['a null child', { or: [null] }, /condition\.or\[0\]: must be an object/],
      ['an array at the root', [], /condition: must be an object/],
      ['null at the root', null, /condition: must be an object/],
      ['an empty object', {}, /condition: must be one of/],
      ['and mixed with leaf keys', { and: [], field: 'a' }, /condition: mixes keys "and", "field"/],
      ['two combinators at once', { and: [], or: [] }, /condition: mixes keys "and", "or"/],
      ['in with a non-array value', { field: 'a', operator: 'in', value: 'x' }, /operator "in" requires an array value/],
      ['notIn with a non-array value', { field: 'a', operator: 'notIn', value: 1 }, /operator "notIn" requires an array value/],
      ['between with 3 values', { field: 'a', operator: 'between', value: [1, 2, 3] }, /operator "between" requires \[min, max\]/],
      ['a leaf with an extra key', { field: 'a', operator: 'eq', value: 1, type: 'x' }, /condition: unknown key "type"/],
      ['a tree nested too deep', nestedNot(12), /nested too deep \(max 8\)/],
    ])('%s', (_label, condition, message) => {
      const errors = validator.errors(condition);
      expect(errors.join('; ')).toMatch(message);
      expect(validator.isValid(condition)).toBe(false);
    });

    it('names the path of a malformed nested leaf', () => {
      const tree = {
        and: [
          { field: 'a', operator: 'eq', value: 1 },
          { not: { operator: 'eq', value: 1 } },
        ],
      };
      expect(validator.errors(tree)).toEqual([
        'condition.and[1].not: "field" must be a non-empty string',
      ]);
    });

    it('reports every problem in the tree, not only the first', () => {
      const tree = { or: [{ all: [] }, { field: 'a', operator: 'nope' }] };
      expect(validator.errors(tree)).toHaveLength(2);
    });
  });
});
