export type NodeType =
  | 'Program'
  | 'FunctionDecl' | 'ClassDecl' | 'InterfaceDecl'
  | 'VarDecl' | 'AssignExpr'
  | 'IfStmt' | 'ForStmt' | 'ForInStmt' | 'WhileStmt' | 'DoWhileStmt'
  | 'ReturnStmt' | 'BreakStmt' | 'ContinueStmt' | 'ThrowStmt'
  | 'TryStmt' | 'CatchClause' | 'SwitchStmt' | 'CaseClause' | 'WithStmt'
  | 'LabeledStmt'
  | 'ExprStmt' | 'Block'
  | 'BinaryExpr' | 'UnaryExpr' | 'PostfixExpr'
  | 'CallExpr' | 'NewExpr' | 'MemberExpr' | 'IndexExpr'
  | 'TernaryExpr' | 'SequenceExpr'
  | 'Literal' | 'Identifier' | 'ArrayLiteral' | 'ObjectLiteral'
  | 'PropertyDef'
  | 'RegExpLiteral';

export interface NodeBase {
  readonly type: NodeType;
  readonly pos: number;   // position in source
  readonly line: number;
}

export interface Program extends NodeBase {
  readonly type: 'Program';
  readonly body: Statement[];
}

export interface FunctionDecl extends NodeBase {
  readonly type: 'FunctionDecl';
  readonly name: string | null;  // null for anonymous function expressions
  readonly params: string[];
  readonly returnType: string | null;
  readonly body: Block;
  readonly isStatic: boolean;
  readonly access: 'public' | 'private' | null;
  readonly isGetter: boolean;
  readonly isSetter: boolean;
}

export interface ClassDecl extends NodeBase {
  readonly type: 'ClassDecl';
  readonly name: string;
  readonly superClass: string | null;
  readonly interfaces: string[];
  readonly isDynamic: boolean;
  readonly body: (FunctionDecl | VarDecl)[];
}

export interface InterfaceDecl extends NodeBase {
  readonly type: 'InterfaceDecl';
  readonly name: string;
  readonly superInterfaces: string[];
  readonly body: FunctionDecl[];
}

export interface VarDecl extends NodeBase {
  readonly type: 'VarDecl';
  readonly name: string;
  readonly varType: string | null;     // AS2 type annotation: var x:Number
  readonly init: Expression | null;
  readonly isStatic: boolean;
  readonly access: 'public' | 'private' | null;
}

export interface Block extends NodeBase {
  readonly type: 'Block';
  readonly body: Statement[];
}

export interface IfStmt extends NodeBase {
  readonly type: 'IfStmt';
  readonly test: Expression;
  readonly consequent: Statement;
  readonly alternate: Statement | null;
}

export interface ForStmt extends NodeBase {
  readonly type: 'ForStmt';
  readonly init: VarDecl | Block | ExprStmt | null;
  readonly test: Expression | null;
  readonly update: Expression | null;
  readonly body: Statement;
}

export interface ForInStmt extends NodeBase {
  readonly type: 'ForInStmt';
  readonly left: VarDecl | Identifier;
  readonly right: Expression;
  readonly body: Statement;
}

export interface WhileStmt extends NodeBase {
  readonly type: 'WhileStmt';
  readonly test: Expression;
  readonly body: Statement;
}

export interface DoWhileStmt extends NodeBase {
  readonly type: 'DoWhileStmt';
  readonly test: Expression;
  readonly body: Statement;
}

export interface ReturnStmt extends NodeBase {
  readonly type: 'ReturnStmt';
  readonly value: Expression | null;
}

export interface BreakStmt extends NodeBase {
  readonly type: 'BreakStmt';
  readonly label: string | null;
}

export interface ContinueStmt extends NodeBase {
  readonly type: 'ContinueStmt';
  readonly label: string | null;
}

export interface LabeledStmt extends NodeBase {
  readonly type: 'LabeledStmt';
  readonly label: string;
  readonly body: Statement;
}

export interface ThrowStmt extends NodeBase {
  readonly type: 'ThrowStmt';
  readonly value: Expression;
}

export interface TryStmt extends NodeBase {
  readonly type: 'TryStmt';
  readonly body: Block;
  readonly catchClause: CatchClause | null;
  readonly finallyBlock: Block | null;
}

export interface CatchClause extends NodeBase {
  readonly type: 'CatchClause';
  readonly param: string;
  readonly body: Block;
}

export interface SwitchStmt extends NodeBase {
  readonly type: 'SwitchStmt';
  readonly discriminant: Expression;
  readonly cases: CaseClause[];
}

export interface CaseClause extends NodeBase {
  readonly type: 'CaseClause';
  readonly test: Expression | null;  // null for default
  readonly consequent: Statement[];
}

export interface WithStmt extends NodeBase {
  readonly type: 'WithStmt';
  readonly object: Expression;
  readonly body: Statement;
}

export interface ExprStmt extends NodeBase {
  readonly type: 'ExprStmt';
  readonly expression: Expression;
}

export interface BinaryExpr extends NodeBase {
  readonly type: 'BinaryExpr';
  readonly operator: string;
  readonly left: Expression;
  readonly right: Expression;
}

export interface UnaryExpr extends NodeBase {
  readonly type: 'UnaryExpr';
  readonly operator: string;
  readonly operand: Expression;
  readonly prefix: boolean;
}

export interface CallExpr extends NodeBase {
  readonly type: 'CallExpr';
  readonly callee: Expression;
  readonly args: Expression[];
}

export interface NewExpr extends NodeBase {
  readonly type: 'NewExpr';
  readonly callee: Expression;
  readonly args: Expression[];
}

export interface MemberExpr extends NodeBase {
  readonly type: 'MemberExpr';
  readonly object: Expression;
  readonly property: string;
}

export interface IndexExpr extends NodeBase {
  readonly type: 'IndexExpr';
  readonly object: Expression;
  readonly index: Expression;
}

export interface TernaryExpr extends NodeBase {
  readonly type: 'TernaryExpr';
  readonly test: Expression;
  readonly consequent: Expression;
  readonly alternate: Expression;
}

export interface SequenceExpr extends NodeBase {
  readonly type: 'SequenceExpr';
  readonly expressions: Expression[];
}

export interface Literal extends NodeBase {
  readonly type: 'Literal';
  readonly value: string | number | boolean | null;
  readonly raw: string;
}

export interface Identifier extends NodeBase {
  readonly type: 'Identifier';
  readonly name: string;
}

export interface AssignExpr extends NodeBase {
  readonly type: 'AssignExpr';
  readonly operator: string;  // '=', '+=', '-=', etc.
  readonly left: Expression;
  readonly right: Expression;
}

export interface ArrayLiteral extends NodeBase {
  readonly type: 'ArrayLiteral';
  readonly elements: Expression[];
}

export interface ObjectLiteral extends NodeBase {
  readonly type: 'ObjectLiteral';
  readonly properties: PropertyDef[];
}

export interface PropertyDef extends NodeBase {
  readonly type: 'PropertyDef';
  readonly key: string;
  readonly value: Expression;
}

// CatchClause is not a statement by itself, but included here for completeness
export type Statement =
  | Block | IfStmt | ForStmt | ForInStmt | WhileStmt | DoWhileStmt
  | ReturnStmt | BreakStmt | ContinueStmt | ThrowStmt
  | TryStmt | SwitchStmt | WithStmt | LabeledStmt
  | ExprStmt | VarDecl | FunctionDecl | ClassDecl | InterfaceDecl;

export interface RegExpLiteral extends NodeBase {
  readonly type: 'RegExpLiteral';
  readonly pattern: string;
  readonly flags: string;
}

export type Expression =
  | BinaryExpr | UnaryExpr | AssignExpr | CallExpr | NewExpr
  | MemberExpr | IndexExpr | TernaryExpr | SequenceExpr | Literal | Identifier
  | FunctionDecl | ArrayLiteral | ObjectLiteral | RegExpLiteral;
