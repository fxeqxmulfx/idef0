import type { Span } from './diagnostics.ts';

/** The four ICOM roles of IDEF0: Input, Control, Output, Mechanism. */
export type Role = 'input' | 'control' | 'output' | 'mechanism';

export const ROLES: readonly Role[] = ['input', 'control', 'output', 'mechanism'];

/** One arrow attached to an activity, e.g. `control "Design Specs"`. */
export interface IcomDecl {
  role: Role;
  label: string;
  /** Written in parentheses: `("Weather")`. The arrow is tunneled (not shown on the other level). */
  tunneled: boolean;
  span?: Span;
}

export interface ActivityDecl {
  /** Optional explicit node number such as `A12`; checked against the position in the tree. */
  node?: string;
  nodeSpan?: Span;
  name: string;
  nameSpan?: Span;
  icoms: IcomDecl[];
  children: ActivityDecl[];
}

export interface MetaDecl {
  key: string;
  value: string;
  keySpan?: Span;
  valueSpan?: Span;
}

/** A parsed `.idef0` file (or the result of the TypeScript builder API). */
export interface DocumentAst {
  meta: MetaDecl[];
  activities: ActivityDecl[];
}
