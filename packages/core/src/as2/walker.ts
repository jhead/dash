import type {
  Program, Statement, Expression,
  FunctionDecl, ClassDecl, InterfaceDecl, VarDecl,
  Block, IfStmt, ForStmt, ForInStmt, WhileStmt, DoWhileStmt,
  ReturnStmt, BreakStmt, ContinueStmt, ThrowStmt,
  TryStmt, CatchClause, SwitchStmt, CaseClause, WithStmt,
  ExprStmt, BinaryExpr, UnaryExpr, AssignExpr,
  CallExpr, NewExpr, MemberExpr, IndexExpr, TernaryExpr,
  Literal, Identifier, ArrayLiteral, ObjectLiteral, PropertyDef,
} from "./ast.js";

export type ASTNode =
  | Program
  | Statement
  | Expression
  | CatchClause
  | CaseClause
  | PropertyDef;

export interface Visitor {
  /** Called when entering a node (before children). Return false to skip children. */
  enter?: (node: ASTNode) => void | false;
  /** Called when leaving a node (after children). */
  exit?: (node: ASTNode) => void;
  // Per-node-type visitors (called in addition to enter/exit)
  Program?: (node: Program) => void;
  FunctionDecl?: (node: FunctionDecl) => void;
  ClassDecl?: (node: ClassDecl) => void;
  InterfaceDecl?: (node: InterfaceDecl) => void;
  VarDecl?: (node: VarDecl) => void;
  Block?: (node: Block) => void;
  IfStmt?: (node: IfStmt) => void;
  ForStmt?: (node: ForStmt) => void;
  ForInStmt?: (node: ForInStmt) => void;
  WhileStmt?: (node: WhileStmt) => void;
  DoWhileStmt?: (node: DoWhileStmt) => void;
  ReturnStmt?: (node: ReturnStmt) => void;
  BreakStmt?: (node: BreakStmt) => void;
  ContinueStmt?: (node: ContinueStmt) => void;
  ThrowStmt?: (node: ThrowStmt) => void;
  TryStmt?: (node: TryStmt) => void;
  CatchClause?: (node: CatchClause) => void;
  SwitchStmt?: (node: SwitchStmt) => void;
  CaseClause?: (node: CaseClause) => void;
  WithStmt?: (node: WithStmt) => void;
  ExprStmt?: (node: ExprStmt) => void;
  BinaryExpr?: (node: BinaryExpr) => void;
  UnaryExpr?: (node: UnaryExpr) => void;
  AssignExpr?: (node: AssignExpr) => void;
  CallExpr?: (node: CallExpr) => void;
  NewExpr?: (node: NewExpr) => void;
  MemberExpr?: (node: MemberExpr) => void;
  IndexExpr?: (node: IndexExpr) => void;
  TernaryExpr?: (node: TernaryExpr) => void;
  Literal?: (node: Literal) => void;
  Identifier?: (node: Identifier) => void;
  ArrayLiteral?: (node: ArrayLiteral) => void;
  ObjectLiteral?: (node: ObjectLiteral) => void;
  PropertyDef?: (node: PropertyDef) => void;
}

/**
 * Walk an AST node depth-first. Calls visitor.enter before children,
 * visitor.exit after. If enter returns false, children are skipped.
 */
export function walk(node: ASTNode, visitor: Visitor): void {
  if (visitor.enter) {
    const result = visitor.enter(node);
    if (result === false) return;
  }

  // Call per-node-type visitor
  const specific = (visitor as Record<string, ((n: ASTNode) => void) | undefined>)[node.type];
  if (specific) specific(node);

  // Recurse into children
  walkChildren(node, visitor);

  if (visitor.exit) visitor.exit(node);
}

function walkChildren(node: ASTNode, visitor: Visitor): void {
  switch (node.type) {
    case 'Program':
      node.body.forEach(s => walk(s as ASTNode, visitor));
      break;
    case 'Block':
      node.body.forEach(s => walk(s as ASTNode, visitor));
      break;
    case 'FunctionDecl':
      walk(node.body as ASTNode, visitor);
      break;
    case 'ClassDecl':
      node.body.forEach(m => walk(m as ASTNode, visitor));
      break;
    case 'InterfaceDecl':
      node.body.forEach(m => walk(m as ASTNode, visitor));
      break;
    case 'VarDecl':
      if (node.init) walk(node.init as ASTNode, visitor);
      break;
    case 'IfStmt':
      walk(node.test as ASTNode, visitor);
      walk(node.consequent as ASTNode, visitor);
      if (node.alternate) walk(node.alternate as ASTNode, visitor);
      break;
    case 'ForStmt':
      if (node.init) walk(node.init as ASTNode, visitor);
      if (node.test) walk(node.test as ASTNode, visitor);
      if (node.update) walk(node.update as ASTNode, visitor);
      walk(node.body as ASTNode, visitor);
      break;
    case 'ForInStmt':
      walk(node.left as ASTNode, visitor);
      walk(node.right as ASTNode, visitor);
      walk(node.body as ASTNode, visitor);
      break;
    case 'WhileStmt':
      walk(node.test as ASTNode, visitor);
      walk(node.body as ASTNode, visitor);
      break;
    case 'DoWhileStmt':
      walk(node.body as ASTNode, visitor);
      walk(node.test as ASTNode, visitor);
      break;
    case 'ReturnStmt':
      if (node.value) walk(node.value as ASTNode, visitor);
      break;
    case 'ThrowStmt':
      walk(node.value as ASTNode, visitor);
      break;
    case 'TryStmt':
      walk(node.body as ASTNode, visitor);
      if (node.catchClause) walk(node.catchClause as ASTNode, visitor);
      if (node.finallyBlock) walk(node.finallyBlock as ASTNode, visitor);
      break;
    case 'CatchClause':
      walk(node.body as ASTNode, visitor);
      break;
    case 'SwitchStmt':
      walk(node.discriminant as ASTNode, visitor);
      node.cases.forEach(c => walk(c as ASTNode, visitor));
      break;
    case 'CaseClause':
      if (node.test) walk(node.test as ASTNode, visitor);
      node.consequent.forEach(s => walk(s as ASTNode, visitor));
      break;
    case 'WithStmt':
      walk(node.object as ASTNode, visitor);
      walk(node.body as ASTNode, visitor);
      break;
    case 'ExprStmt':
      walk(node.expression as ASTNode, visitor);
      break;
    case 'BinaryExpr':
    case 'AssignExpr':
      walk(node.left as ASTNode, visitor);
      walk(node.right as ASTNode, visitor);
      break;
    case 'UnaryExpr':
      walk(node.operand as ASTNode, visitor);
      break;
    case 'CallExpr':
      walk(node.callee as ASTNode, visitor);
      node.args.forEach(a => walk(a as ASTNode, visitor));
      break;
    case 'NewExpr':
      walk(node.callee as ASTNode, visitor);
      node.args.forEach(a => walk(a as ASTNode, visitor));
      break;
    case 'MemberExpr':
      walk(node.object as ASTNode, visitor);
      break;
    case 'IndexExpr':
      walk(node.object as ASTNode, visitor);
      walk(node.index as ASTNode, visitor);
      break;
    case 'TernaryExpr':
      walk(node.test as ASTNode, visitor);
      walk(node.consequent as ASTNode, visitor);
      walk(node.alternate as ASTNode, visitor);
      break;
    case 'ArrayLiteral':
      node.elements.forEach(e => walk(e as ASTNode, visitor));
      break;
    case 'ObjectLiteral':
      node.properties.forEach(p => walk(p as ASTNode, visitor));
      break;
    case 'PropertyDef':
      walk(node.value as ASTNode, visitor);
      break;
    // Leaf nodes: Literal, Identifier, BreakStmt, ContinueStmt — no children
    default:
      break;
  }
}

/**
 * Collect all nodes of a specific type from an AST.
 */
export function findAll<T extends ASTNode>(
  root: ASTNode,
  type: T['type']
): T[] {
  const results: T[] = [];
  walk(root, {
    enter(node) {
      if (node.type === type) {
        results.push(node as T);
      }
    },
  });
  return results;
}

/**
 * Collect all identifiers referenced in an AST.
 */
export function collectIdentifiers(root: ASTNode): string[] {
  const names = new Set<string>();
  walk(root, {
    Identifier(node) {
      names.add(node.name);
    },
  });
  return Array.from(names);
}

/**
 * Collect all function/class/var declarations at the top level of a program.
 */
export function collectTopLevelDecls(
  program: Program
): (FunctionDecl | ClassDecl | VarDecl)[] {
  return program.body.filter(
    (s): s is FunctionDecl | ClassDecl | VarDecl =>
      s.type === 'FunctionDecl' || s.type === 'ClassDecl' || s.type === 'VarDecl'
  );
}
