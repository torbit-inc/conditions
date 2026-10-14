import { Module } from '@nestjs/common';
import { ConditionEvaluatorService } from './services/condition-evaluator.service';
import { ConditionSqlCompilerService } from './services/condition-sql-compiler.service';
import { ConditionShapeValidatorService } from './services/condition-shape-validator.service';

/**
 * Provides the condition services for consumers.
 *
 * Import once in a service's AppModule (or wherever segments / policies / etc.
 * live). All services are stateless and safe to share — the evaluator filters
 * in memory, the SQL compiler pushes the same condition tree down into a WHERE
 * clause so the database does the filtering, and the shape validator checks
 * untrusted trees before they are stored or evaluated.
 */
@Module({
  providers: [
    ConditionEvaluatorService,
    ConditionSqlCompilerService,
    ConditionShapeValidatorService,
  ],
  exports: [
    ConditionEvaluatorService,
    ConditionSqlCompilerService,
    ConditionShapeValidatorService,
  ],
})
export class ConditionsModule {}
