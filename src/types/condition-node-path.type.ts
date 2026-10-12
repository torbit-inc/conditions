/** Where a node sits in the condition tree, for error messages and the depth bound. */
export type ConditionNodePath = {
  /** Dot/bracket path such as `condition.and[1].not` */
  readonly path: string;
  /** 1-based depth of the node (the root is 1) */
  readonly depth: number;
};
