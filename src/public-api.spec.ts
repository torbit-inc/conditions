import 'reflect-metadata';
import {
  COMPARISON_OPERATORS,
  CONDITION_MAX_DEPTH,
  ComparisonOperator,
  ConditionShapeValidatorService,
  ConditionsModule,
} from './index';

/**
 * Public API of the shape-validation addition (1.4.0): consumers validate
 * untrusted condition trees before persisting or evaluating them.
 */
describe('public API — condition shape validation', () => {
  it('exports the runtime operator list, typed as ComparisonOperator', () => {
    const operators: readonly ComparisonOperator[] = COMPARISON_OPERATORS;
    expect(operators).toEqual(
      expect.arrayContaining(['eq', 'in', 'between', 'isNotNull', 'endsWith']),
    );
    expect(new Set(operators).size).toBe(17);
  });

  it('exports the maximum nesting depth', () => {
    expect(CONDITION_MAX_DEPTH).toBe(8);
  });

  it('provides and exports ConditionShapeValidatorService from ConditionsModule', () => {
    const providers: unknown[] = Reflect.getMetadata('providers', ConditionsModule);
    const exported: unknown[] = Reflect.getMetadata('exports', ConditionsModule);
    expect(providers).toContain(ConditionShapeValidatorService);
    expect(exported).toContain(ConditionShapeValidatorService);
  });
});
