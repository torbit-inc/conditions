import { Injectable } from '@nestjs/common';
import type { ComparisonOperator } from '../types/comparison-operator.type';
import { COMPARISON_OPERATORS } from '../constants/comparison-operators.constant';
import { CONDITION_MAX_DEPTH } from '../constants/condition-max-depth.constant';
import type { ConditionNodePath } from '../types/condition-node-path.type';

/** Logical combinator keys of the DSL. */
const COMBINATOR_KEYS: readonly string[] = ['and', 'or', 'not'];

/** Keys a field comparison (leaf) may carry. */
const LEAF_KEYS: readonly string[] = ['field', 'operator', 'value'];

/** Operators whose value must be an array of candidates. */
const LIST_OPERATORS: readonly string[] = ['in', 'notIn'];

/** Hint appended to errors about an unrecognised node shape. */
const SHAPE_HINT =
  'use "and", "or", "not" or a field comparison {field, operator, value}';

/** A JSON object node of the tree (not null, not an array). */
type ConditionNode = Record<string, unknown>;

/**
 * Checks that an untrusted value is a well-formed `@torbit-inc/conditions`
 * tree: only `and` / `or` / `not` combinators and leaves with a string `field`
 * and a known operator, bounded in depth. The shared evaluator assumes this
 * shape and throws (→ HTTP 500) when it does not hold, so writes are checked
 * up front and stored trees are checked again before evaluation.
 */
@Injectable()
export class ConditionShapeValidatorService {
  /** Returns every shape problem found, path-qualified; empty when valid. */
  errors(condition: unknown): string[] {
    return this.nodeErrors(condition, { path: 'condition', depth: 1 });
  }

  /** True when the value is a well-formed condition tree. */
  isValid(condition: unknown): boolean {
    return this.errors(condition).length === 0;
  }

  /** Validates one node and, recursively, its children. */
  private nodeErrors(node: unknown, at: ConditionNodePath): string[] {
    if (at.depth > CONDITION_MAX_DEPTH) {
      return [`${at.path}: nested too deep (max ${CONDITION_MAX_DEPTH})`];
    }
    if (!this.isObjectNode(node)) return [`${at.path}: must be an object`];

    const keys = Object.keys(node);
    const unknownKeys = keys.filter(
      (k) => !COMBINATOR_KEYS.includes(k) && !LEAF_KEYS.includes(k),
    );
    if (unknownKeys.length > 0) {
      return unknownKeys.map((k) => `${at.path}: unknown key "${k}" — ${SHAPE_HINT}`);
    }
    if (keys.length === 0) return [`${at.path}: must be one of: ${SHAPE_HINT}`];

    const combinators = keys.filter((k) => COMBINATOR_KEYS.includes(k));
    if (combinators.length > 0 && keys.length > 1) {
      const listed = keys.map((k) => `"${k}"`).join(', ');
      return [`${at.path}: mixes keys ${listed} — a node is exactly one of: ${SHAPE_HINT}`];
    }
    return combinators.length === 1
      ? this.combinatorErrors(node, combinators[0], at)
      : this.leafErrors(node, at.path);
  }

  /** Validates an `and` / `or` (array of nodes) or a `not` (single node). */
  private combinatorErrors(
    node: ConditionNode,
    key: string,
    at: ConditionNodePath,
  ): string[] {
    const child = node[key];
    const path = `${at.path}.${key}`;
    if (key === 'not') return this.nodeErrors(child, { path, depth: at.depth + 1 });
    if (!Array.isArray(child)) return [`${path}: must be an array of conditions`];
    return child.flatMap((c: unknown, i) =>
      this.nodeErrors(c, { path: `${path}[${i}]`, depth: at.depth + 1 }),
    );
  }

  /** Validates a field comparison leaf. */
  private leafErrors(node: ConditionNode, path: string): string[] {
    const errors: string[] = [];
    const { field, operator, value } = node;
    if (typeof field !== 'string' || field.trim() === '') {
      errors.push(`${path}: "field" must be a non-empty string`);
    }
    if (!this.isKnownOperator(operator)) {
      const known = COMPARISON_OPERATORS.join(', ');
      errors.push(`${path}: unknown operator "${String(operator)}" — expected one of ${known}`);
      return errors;
    }
    return [...errors, ...this.valueErrors(operator, value, path)];
  }

  /** Validates the value shape the list/range operators require. */
  private valueErrors(
    operator: ComparisonOperator,
    value: unknown,
    path: string,
  ): string[] {
    if (LIST_OPERATORS.includes(operator) && !Array.isArray(value)) {
      return [`${path}: operator "${operator}" requires an array value`];
    }
    if (operator === 'between' && !(Array.isArray(value) && value.length === 2)) {
      return [`${path}: operator "between" requires [min, max]`];
    }
    return [];
  }

  /** True for a JSON object (not null, not an array). */
  private isObjectNode(node: unknown): node is ConditionNode {
    return typeof node === 'object' && node !== null && !Array.isArray(node);
  }

  /** True when the value is one of the DSL's comparison operators. */
  private isKnownOperator(operator: unknown): operator is ComparisonOperator {
    return (COMPARISON_OPERATORS as readonly unknown[]).includes(operator);
  }
}
