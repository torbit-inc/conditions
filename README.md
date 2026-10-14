# @torbit-inc/conditions

Structured condition-tree DSL and JavaScript evaluator shared across Torbit services.

Used by:

- `business-rules-service` — `Policy.condition` (eligibility / visibility / constraint trees)
- `prelegal-service` — `Segment.condition` (debtor segmentation)
- any future service that needs to persist and evaluate boolean predicates over arbitrary records

## DSL

A `Condition` is a recursive tree of:

- `FieldCondition` — `{ field: 'dot.path', operator: '...', value?: ... }`
- `{ and: Condition[] }` — all must hold
- `{ or: Condition[] }` — any must hold
- `{ not: Condition }` — negation

### Operators

| Operator | Meaning | Value shape |
|---|---|---|
| `eq` / `neq` | strict equality / inequality | any |
| `gt` / `lt` / `gte` / `lte` | numeric / date comparison | number, string, Date |
| `in` / `notIn` | membership | array |
| `exists` / `notExists` | field is defined and non-null | (omit value) |
| `isNull` / `isNotNull` | field is exactly null | (omit value) |
| `contains` / `notContains` | substring match (string fields) | string |
| `startsWith` / `endsWith` | prefix / suffix match | string |
| `between` | `min <= value <= max` | `[min, max]` |

## Typed coercion

JSONB-sourced fields often arrive as strings (e.g. `"41"` from a CSV). Pass a `fieldTypes` map to coerce before comparison:

```ts
evaluator.evaluate(condition, context, {
  fieldTypes: { 'industryData.cuotasEnMora': 'number' },
});
```

Without a `fieldTypes` hint:

- the ordering operators (`gt` / `lt` / `gte` / `lte` / `between`) coerce both sides to **numbers** (since 1.1.0), so `"30" > "5"` is `true`. A value that is not numeric becomes `NaN` and the comparison is `false`, including ISO date strings. Declare `'date'` for date fields.
- every other operator uses JavaScript's default semantics.

## Validating untrusted trees

The evaluator assumes a well-formed tree and **throws** on a malformed one: a leaf without `field`, an unknown operator, a non-array `and`, or a `null` child. Check every tree that comes from an API, a file or a database row before storing or evaluating it:

```ts
import { ConditionShapeValidatorService } from '@torbit-inc/conditions';

const errors = shapeValidator.errors(body.condition);
// [] when valid, otherwise path-qualified messages, e.g.
// ['condition: unknown key "all" — use "and", "or", "not" or a field comparison {field, operator, value}']
```

The rules:

- Each node is exactly one of `and` / `or` (an array; empty is allowed), `not` (a node), or a leaf with only `field` (a non-empty string), `operator` (one of `COMPARISON_OPERATORS`) and `value`.
- `in` / `notIn` need an array value, and `between` needs `[min, max]`.
- Nesting is at most `CONDITION_MAX_DEPTH` (8).

`COMPARISON_OPERATORS` is the runtime list that `ComparisonOperator` is derived from.

## Usage in NestJS

```ts
import { ConditionsModule, ConditionEvaluatorService } from '@torbit-inc/conditions';
// ConditionsModule also provides ConditionSqlCompilerService and ConditionShapeValidatorService.

@Module({ imports: [ConditionsModule] })
export class MyModule {}

@Injectable()
export class MyService {
  constructor(private readonly evaluator: ConditionEvaluatorService) {}
}
```
