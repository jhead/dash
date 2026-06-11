import type {
  Program, Statement, Expression,
  Block, CaseClause, BinaryExpr,
} from "./ast.js";

export interface FormatOptions {
  readonly indent?: string;        // default '  ' (2 spaces)
  readonly semicolons?: boolean;   // default true
  readonly maxLineLength?: number; // default 80 (informational, not enforced)
}

class Formatter {
  private indent: string;
  private semi: string;

  constructor(opts: FormatOptions = {}) {
    this.indent = opts.indent ?? '  ';
    this.semi = opts.semicolons !== false ? ';' : '';
  }

  formatProgram(program: Program): string {
    return program.body.map(s => this.stmt(s, '')).join('\n');
  }

  // -------------------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------------------

  private stmt(node: Statement, depth: string): string {
    const i = depth;
    const ii = depth + this.indent;

    switch (node.type) {
      case 'VarDecl': {
        const typeAnnotation = node.varType ? `:${node.varType}` : '';
        const init = node.init ? ` = ${this.expr(node.init)}` : '';
        const parts: string[] = [];
        if (node.access) parts.push(node.access);
        if (node.isStatic) parts.push('static');
        const prefix = parts.length ? parts.join(' ') + ' ' : '';
        return `${i}${prefix}var ${node.name}${typeAnnotation}${init}${this.semi}`;
      }

      case 'FunctionDecl': {
        const params = node.params.join(', ');
        const ret = node.returnType ? `:${node.returnType}` : '';
        const name = node.name ? ` ${node.name}` : '';
        const parts: string[] = [];
        if (node.access) parts.push(node.access);
        if (node.isStatic) parts.push('static');
        const prefix = parts.length ? parts.join(' ') + ' ' : '';
        const body = this.stmtBlock(node.body, i);
        return `${i}${prefix}function${name}(${params})${ret} ${body}`;
      }

      case 'ClassDecl': {
        const ext = node.superClass ? ` extends ${node.superClass}` : '';
        const impl = node.interfaces.length
          ? ` implements ${node.interfaces.join(', ')}`
          : '';
        const dyn = node.isDynamic ? 'dynamic ' : '';
        const members = node.body
          .map(m => this.stmt(m as Statement, ii))
          .join('\n');
        const body = members ? `{\n${members}\n${i}}` : '{}';
        return `${i}${dyn}class ${node.name}${ext}${impl} ${body}`;
      }

      case 'InterfaceDecl': {
        const ext = node.superInterfaces.length
          ? ` extends ${node.superInterfaces.join(', ')}`
          : '';
        const members = node.body
          .map(m => this.stmt(m as Statement, ii))
          .join('\n');
        const body = members ? `{\n${members}\n${i}}` : '{}';
        return `${i}interface ${node.name}${ext} ${body}`;
      }

      case 'Block': {
        return i + this.stmtBlock(node, i);
      }

      case 'IfStmt': {
        const test = this.expr(node.test);
        const cons = this.stmtInline(node.consequent, i);
        const alt = node.alternate
          ? ` else ${this.stmtInline(node.alternate, i)}`
          : '';
        return `${i}if (${test}) ${cons}${alt}`;
      }

      case 'ForStmt': {
        let initStr = '';
        if (node.init) {
          if (node.init.type === 'VarDecl') {
            // Strip leading indentation and trailing semicolon for for-init
            initStr = this.stmt(node.init, '').trim().replace(/;$/, '');
          } else if (node.init.type === 'ExprStmt') {
            initStr = this.expr(node.init.expression);
          }
        }
        const testStr = node.test ? this.expr(node.test) : '';
        const updateStr = node.update ? this.expr(node.update) : '';
        const body = this.stmtInline(node.body, i);
        return `${i}for (${initStr}; ${testStr}; ${updateStr}) ${body}`;
      }

      case 'ForInStmt': {
        const left =
          node.left.type === 'VarDecl'
            ? this.stmt(node.left, '').trim().replace(/;$/, '')
            : node.left.name;
        const right = this.expr(node.right);
        const body = this.stmtInline(node.body, i);
        return `${i}for (${left} in ${right}) ${body}`;
      }

      case 'WhileStmt': {
        const body = this.stmtInline(node.body, i);
        return `${i}while (${this.expr(node.test)}) ${body}`;
      }

      case 'DoWhileStmt': {
        const body = this.stmtInline(node.body, i);
        return `${i}do ${body} while (${this.expr(node.test)})${this.semi}`;
      }

      case 'ReturnStmt':
        return `${i}return${node.value ? ' ' + this.expr(node.value) : ''}${this.semi}`;

      case 'BreakStmt':
        return `${i}break${this.semi}`;

      case 'ContinueStmt':
        return `${i}continue${this.semi}`;

      case 'ThrowStmt':
        return `${i}throw ${this.expr(node.value)}${this.semi}`;

      case 'TryStmt': {
        const body = this.stmtBlock(node.body, i);
        let result = `${i}try ${body}`;
        if (node.catchClause) {
          const cb = this.stmtBlock(node.catchClause.body, i);
          result += ` catch (${node.catchClause.param}) ${cb}`;
        }
        if (node.finallyBlock) {
          const fb = this.stmtBlock(node.finallyBlock, i);
          result += ` finally ${fb}`;
        }
        return result;
      }

      case 'SwitchStmt': {
        const cases = node.cases.map(c => this.fmtCaseClause(c, ii)).join('\n');
        const body = cases ? `{\n${cases}\n${i}}` : '{}';
        return `${i}switch (${this.expr(node.discriminant)}) ${body}`;
      }

      case 'WithStmt': {
        const body = this.stmtInline(node.body, i);
        return `${i}with (${this.expr(node.object)}) ${body}`;
      }

      case 'ExprStmt':
        return `${i}${this.expr(node.expression)}${this.semi}`;

      default:
        return `${i}/* [(node as { type: string }).type] */`;
    }
  }

  /** Format a Block's braces+body, without leading depth prefix. */
  private stmtBlock(node: Block, depth: string): string {
    const ii = depth + this.indent;
    if (node.body.length === 0) return '{}';
    const stmts = node.body.map(s => this.stmt(s, ii)).join('\n');
    return `{\n${stmts}\n${depth}}`;
  }

  /**
   * Format a statement to appear inline after a keyword (if/while/for/etc).
   * Block statements keep their braces; others appear on the same line.
   */
  private stmtInline(node: Statement, depth: string): string {
    if (node.type === 'Block') {
      return this.stmtBlock(node, depth);
    }
    return this.stmt(node, '').trim();
  }

  private fmtCaseClause(node: CaseClause, depth: string): string {
    const ii = depth + this.indent;
    const label = node.test ? `${depth}case ${this.expr(node.test)}:` : `${depth}default:`;
    const body = node.consequent.map(s => this.stmt(s, ii)).join('\n');
    return body ? `${label}\n${body}` : label;
  }

  // -------------------------------------------------------------------------
  // Expressions
  // -------------------------------------------------------------------------

  private expr(node: Expression): string {
    switch (node.type) {
      case 'Literal':
        return node.raw;

      case 'Identifier':
        return node.name;

      case 'BinaryExpr':
        return `${this.exprParens(node.left, node)} ${node.operator} ${this.exprParens(node.right, node)}`;

      case 'AssignExpr':
        return `${this.expr(node.left)} ${node.operator} ${this.expr(node.right)}`;

      case 'UnaryExpr':
        return node.prefix
          ? `${node.operator}${this.expr(node.operand)}`
          : `${this.expr(node.operand)}${node.operator}`;

      case 'CallExpr':
        return `${this.expr(node.callee)}(${node.args.map(a => this.expr(a)).join(', ')})`;

      case 'NewExpr':
        return `new ${this.expr(node.callee)}(${node.args.map(a => this.expr(a)).join(', ')})`;

      case 'MemberExpr':
        return `${this.exprMemberBase(node.object)}.${node.property}`;

      case 'IndexExpr':
        return `${this.exprMemberBase(node.object)}[${this.expr(node.index)}]`;

      case 'TernaryExpr':
        return `${this.expr(node.test)} ? ${this.expr(node.consequent)} : ${this.expr(node.alternate)}`;

      case 'ArrayLiteral':
        return `[${node.elements.map(e => this.expr(e)).join(', ')}]`;

      case 'ObjectLiteral': {
        if (node.properties.length === 0) return '{}';
        const props = node.properties
          .map(p => `${p.key}: ${this.expr(p.value)}`)
          .join(', ');
        return `{${props}}`;
      }

      case 'FunctionDecl': {
        // Function expression (anonymous or named)
        const params = node.params.join(', ');
        const ret = node.returnType ? `:${node.returnType}` : '';
        const name = node.name ? ` ${node.name}` : '';
        // Inline body for expressions — just emit signature with placeholder body
        // A full multi-line emit is only practical from stmt(), so we keep it brief here.
        return `function${name}(${params})${ret} { ... }`;
      }

      default:
        return `/* ${(node as { type: string }).type} */`;
    }
  }

  /**
   * Wrap a sub-expression in parens when it has lower precedence than the parent
   * binary expression (simple heuristic based on operator).
   */
  private exprParens(node: Expression, parent: BinaryExpr): string {
    if (
      node.type === 'BinaryExpr' &&
      precedence(node.operator) < precedence(parent.operator)
    ) {
      return `(${this.expr(node)})`;
    }
    if (node.type === 'AssignExpr' || node.type === 'TernaryExpr') {
      return `(${this.expr(node)})`;
    }
    return this.expr(node);
  }

  /**
   * Wrap base of member/index access in parens if needed (e.g. function call
   * results don't need parens, but literals do for clarity).
   */
  private exprMemberBase(node: Expression): string {
    if (node.type === 'Literal' || node.type === 'ObjectLiteral') {
      return `(${this.expr(node)})`;
    }
    return this.expr(node);
  }
}

// Simple operator precedence table (higher = tighter binding)
function precedence(op: string): number {
  switch (op) {
    case '||': return 1;
    case '&&': return 2;
    case '|': return 3;
    case '^': return 4;
    case '&': return 5;
    case '==': case '!=': case '===': case '!==': return 6;
    case '<': case '>': case '<=': case '>=':
    case 'instanceof': case 'in': return 7;
    case '<<': case '>>': case '>>>': return 8;
    case '+': case '-': return 9;
    case '*': case '/': case '%': return 10;
    default: return 0;
  }
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/**
 * Format an AS2 AST back to source code.
 */
export function format(ast: Program, options?: FormatOptions): string {
  return new Formatter(options).formatProgram(ast);
}

/**
 * Format a single statement.
 */
export function formatStatement(
  stmt: Statement,
  indent: string,
  options: FormatOptions = {}
): string {
  return new Formatter(options)['stmt'](stmt, indent);
}

/**
 * Format a single expression.
 */
export function formatExpression(
  expr: Expression,
  options: FormatOptions = {}
): string {
  return new Formatter(options)['expr'](expr);
}
