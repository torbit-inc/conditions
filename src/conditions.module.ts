import { Module } from '@nestjs/common';
import { ConditionEvaluatorService } from './services/condition-evaluator.service';
import { ConditionSqlCompilerService } from './services/condition-sql-compiler.service';

/**
 * Provides the condition services for consumers.
 *
 * Import once in a service's AppModule (or wherever segments / policies / etc.
 * live). Both services are stateless and safe to share — the evaluator filters
 * in memory, the SQL compiler pushes the same condition tree down into a WHERE
 * clause so the database does the filtering.
 */
@Module({
  providers: [ConditionEvaluatorService, ConditionSqlCompilerService],
  exports: [ConditionEvaluatorService, ConditionSqlCompilerService],
})
export class ConditionsModule {}
