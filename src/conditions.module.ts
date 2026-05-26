import { Module } from '@nestjs/common';
import { ConditionEvaluatorService } from './services/condition-evaluator.service';

/**
 * Provides the ConditionEvaluatorService for consumers.
 *
 * Import once in a service's AppModule (or wherever segments / policies / etc.
 * live). The evaluator is stateless and safe to share.
 */
@Module({
  providers: [ConditionEvaluatorService],
  exports: [ConditionEvaluatorService],
})
export class ConditionsModule {}
