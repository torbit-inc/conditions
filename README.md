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

Without `fieldTypes`, the evaluator preserves JavaScript's default coercion behavior (backwards compatible with the original `business-rules-service` implementation).

## Usage in NestJS

```ts
import { ConditionsModule, ConditionEvaluatorService } from '@torbit-inc/conditions';

@Module({ imports: [ConditionsModule] })
export class MyModule {}

@Injectable()
export class MyService {
  constructor(private readonly evaluator: ConditionEvaluatorService) {}
}
```
