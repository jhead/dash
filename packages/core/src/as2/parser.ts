import { tokenize, filterTokens, scanRegexAt, type Token } from "./tokenizer.js";
import type {
  Program, Statement, Expression, NodeBase,
  Block, FunctionDecl, ClassDecl, InterfaceDecl, VarDecl,
  IfStmt, ForStmt, ForInStmt, WhileStmt, DoWhileStmt,
  ReturnStmt, BreakStmt, ContinueStmt, ThrowStmt,
  TryStmt, CatchClause, SwitchStmt, CaseClause, WithStmt, LabeledStmt,
  ExprStmt,
  NewExpr,
  Identifier, ArrayLiteral, ObjectLiteral, PropertyDef,
  RegExpLiteral,
} from "./ast.js";

const EOF_TOKEN: Token = { type: 'eof', value: '', line: 0, col: 0, pos: 0 };

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '&&=', '||=', '**=']);

class Parser {
  private tokens: Token[];
  private source: string;
  private pos: number = 0;

  constructor(source: string) {
    this.source = source;
    this.tokens = filterTokens(tokenize(source));
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? EOF_TOKEN;
  }

  private advance(): Token {
    return this.tokens[this.pos++] ?? EOF_TOKEN;
  }

  private check(type: string, value?: string): boolean {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }

  private eat(type: string, value?: string): Token {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(
        `Parse error at line ${t.line}: expected ${type}${value ? ' "' + value + '"' : ''}, got "${t.value}"`
      );
    }
    return this.advance();
  }

  private tryEat(type: string, value?: string): Token | null {
    if (this.check(type, value)) return this.advance();
    return null;
  }

  /** Skip optional semicolons (AS2 has optional semicolons like JS). */
  private trySemicolon(): void {
    this.tryEat('punctuation', ';');
  }

  private base(t: Token): Pick<NodeBase, 'pos' | 'line'> {
    return { pos: t.pos, line: t.line };
  }

  // ── Public entry point ─────────────────────────────────────────────────────

  parseProgram(): Program {
    const body: Statement[] = [];
    while (!this.check('eof')) {
      body.push(this.parseStatement());
    }
    return { type: 'Program', body, pos: 0, line: 1 };
  }

  // ── Statements ─────────────────────────────────────────────────────────────

  private parseStatement(): Statement {
    const t = this.peek();

    // Skip stray semicolons
    if (t.type === 'punctuation' && t.value === ';') {
      this.advance();
      return this.parseStatement();
    }

    if (t.type === 'keyword') {
      switch (t.value) {
        case 'var':      return this.parseVarDecl(false, null);
        case 'function': return this.parseFunctionDecl(false, null);
        case 'class':    return this.parseClassDecl(false);
        case 'dynamic':  return this.parseClassDecl(true);
        case 'interface': return this.parseInterfaceDecl();
        case 'if':       return this.parseIfStmt();
        case 'for':      return this.parseForStmt();
        case 'while':    return this.parseWhileStmt();
        case 'do':       return this.parseDoWhileStmt();
        case 'return':   return this.parseReturnStmt();
        case 'break':    return this.parseBreakStmt();
        case 'continue': return this.parseContinueStmt();
        case 'throw':    return this.parseThrowStmt();
        case 'try':      return this.parseTryStmt();
        case 'switch':   return this.parseSwitchStmt();
        case 'with':     return this.parseWithStmt();
        case 'public':
        case 'private': {
          const access = t.value as 'public' | 'private';
          this.advance();
          const isStatic = !!this.tryEat('keyword', 'static');
          if (this.check('keyword', 'var')) return this.parseVarDecl(isStatic, access);
          if (this.check('keyword', 'function')) return this.parseFunctionDecl(isStatic, access);
          throw new Error(`Parse error at line ${this.peek().line}: expected var or function after ${access}`);
        }
        case 'static': {
          this.advance();
          if (this.check('keyword', 'var')) return this.parseVarDecl(true, null);
          if (this.check('keyword', 'function')) return this.parseFunctionDecl(true, null);
          throw new Error(`Parse error at line ${this.peek().line}: expected var or function after static`);
        }
        // import statements — consume as expression statement
        case 'import': {
          this.advance();
          // consume dotted path
          let path = '';
          while (!this.check('punctuation', ';') && !this.check('eof') &&
                 !this.check('punctuation', '\n')) {
            path += this.advance().value;
          }
          this.trySemicolon();
          const id: Identifier = { type: 'Identifier', name: 'import ' + path, pos: t.pos, line: t.line };
          const stmt: ExprStmt = { type: 'ExprStmt', expression: id, pos: t.pos, line: t.line };
          return stmt;
        }
      }
    }

    if (t.type === 'punctuation' && t.value === '{') {
      return this.parseBlock();
    }

    // Labeled statement: identifier ':' statement
    // Check if next token is an identifier followed by ':' (operator token)
    if (t.type === 'identifier' && this.tokens[this.pos + 1]?.type === 'operator' && this.tokens[this.pos + 1]?.value === ':') {
      return this.parseLabeledStmt();
    }

    // expression statement
    return this.parseExprStmt();
  }

  private parseBlock(): Block {
    const start = this.eat('punctuation', '{');
    const body: Statement[] = [];
    while (!this.check('punctuation', '}') && !this.check('eof')) {
      body.push(this.parseStatement());
    }
    this.eat('punctuation', '}');
    return { type: 'Block', body, ...this.base(start) };
  }

  private parseVarDecl(isStatic: boolean, access: 'public' | 'private' | null): VarDecl {
    const start = this.eat('keyword', 'var');
    const nameToken = this.eat('identifier');
    const name = nameToken.value;

    // optional type annotation: var x:Number
    let varType: string | null = null;
    if (this.tryEat('operator', ':')) {
      varType = this.parseTypeName();
    }

    // optional initialiser
    let init: Expression | null = null;
    if (this.tryEat('operator', '=')) {
      init = this.parseAssignment();
    }

    this.trySemicolon();
    return { type: 'VarDecl', name, varType, init, isStatic, access, ...this.base(start) };
  }

  /** Parse a dotted type name like Array, flash.display.MovieClip, etc. */
  private parseTypeName(): string {
    let name = '';
    // Allow identifier or keyword (e.g. 'void')
    const first = this.peek();
    if (first.type === 'identifier' || first.type === 'keyword') {
      name += this.advance().value;
    } else {
      throw new Error(`Parse error at line ${first.line}: expected type name, got "${first.value}"`);
    }
    while (this.check('punctuation', '.')) {
      this.advance();
      const part = this.peek();
      if (part.type === 'identifier' || part.type === 'keyword') {
        name += '.' + this.advance().value;
      } else break;
    }
    return name;
  }

  private parseFunctionDecl(isStatic: boolean, access: 'public' | 'private' | null): FunctionDecl {
    const start = this.eat('keyword', 'function');

    // Handle get/set property accessor keywords
    let isGetter = false;
    let isSetter = false;
    if ((this.check('keyword', 'get') || this.check('keyword', 'set')) &&
        (this.tokens[this.pos + 1]?.type === 'identifier')) {
      // consume the get/set keyword and record which kind it is
      const accessorKw = this.advance().value;
      if (accessorKw === 'get') isGetter = true;
      else isSetter = true;
    }

    // name is optional (anonymous function expression)
    let name: string | null = null;
    const next = this.peek();
    if (next.type === 'identifier' || (next.type === 'keyword' && next.value !== 'function')) {
      // Identifiers or certain keywords can be method names
      if (next.type === 'identifier') {
        name = this.advance().value;
      }
    }

    const params = this.parseFunctionParams();

    // optional return type
    let returnType: string | null = null;
    if (this.tryEat('operator', ':')) {
      returnType = this.parseTypeName();
    }

    const body = this.parseBlock();
    return { type: 'FunctionDecl', name, params, returnType, body, isStatic, access, isGetter, isSetter, ...this.base(start) };
  }

  private parseFunctionParams(): string[] {
    this.eat('punctuation', '(');
    const params: string[] = [];
    while (!this.check('punctuation', ')') && !this.check('eof')) {
      const paramToken = this.peek();
      if (paramToken.type === 'identifier' || paramToken.type === 'keyword') {
        const paramName = this.advance().value;
        // optional type annotation
        if (this.tryEat('operator', ':')) {
          this.parseTypeName(); // consumed but we don't store it in params[]
        }
        params.push(paramName);
      }
      if (!this.tryEat('punctuation', ',')) break;
    }
    this.eat('punctuation', ')');
    return params;
  }

  private parseClassDecl(isDynamic: boolean): ClassDecl {
    if (isDynamic) {
      this.eat('keyword', 'dynamic');
    }
    const start = this.eat('keyword', 'class');
    const name = this.eat('identifier').value;

    let superClass: string | null = null;
    if (this.tryEat('keyword', 'extends')) {
      superClass = this.parseTypeName();
    }

    const interfaces: string[] = [];
    if (this.tryEat('keyword', 'implements')) {
      interfaces.push(this.parseTypeName());
      while (this.tryEat('punctuation', ',')) {
        interfaces.push(this.parseTypeName());
      }
    }

    this.eat('punctuation', '{');
    const body: (FunctionDecl | VarDecl)[] = [];
    while (!this.check('punctuation', '}') && !this.check('eof')) {
      const member = this.parseClassMember();
      if (member) body.push(member);
    }
    this.eat('punctuation', '}');

    return { type: 'ClassDecl', name, superClass, interfaces, isDynamic, body, ...this.base(start) };
  }

  private parseClassMember(): FunctionDecl | VarDecl | null {
    const t = this.peek();

    // skip stray semicolons
    if (t.type === 'punctuation' && t.value === ';') {
      this.advance();
      return null;
    }

    // access modifier
    let access: 'public' | 'private' | null = null;
    if (t.type === 'keyword' && (t.value === 'public' || t.value === 'private')) {
      access = t.value as 'public' | 'private';
      this.advance();
    }

    // static modifier
    let isStatic = false;
    if (this.check('keyword', 'static')) {
      isStatic = true;
      this.advance();
    }

    const next = this.peek();
    if (next.type === 'keyword' && next.value === 'var') {
      return this.parseVarDecl(isStatic, access);
    }
    if (next.type === 'keyword' && next.value === 'function') {
      return this.parseFunctionDecl(isStatic, access);
    }
    if (next.type === 'keyword' && next.value === 'public') {
      // double access modifier edge case — re-enter
      access = 'public';
      this.advance();
      return this.parseClassMember();
    }
    if (next.type === 'keyword' && next.value === 'private') {
      access = 'private';
      this.advance();
      return this.parseClassMember();
    }

    // Unknown token in class body — skip
    this.advance();
    return null;
  }

  private parseInterfaceDecl(): InterfaceDecl {
    const start = this.eat('keyword', 'interface');
    const name = this.eat('identifier').value;

    const superInterfaces: string[] = [];
    if (this.tryEat('keyword', 'extends')) {
      superInterfaces.push(this.parseTypeName());
      while (this.tryEat('punctuation', ',')) {
        superInterfaces.push(this.parseTypeName());
      }
    }

    this.eat('punctuation', '{');
    const body: FunctionDecl[] = [];
    while (!this.check('punctuation', '}') && !this.check('eof')) {
      if (this.check('punctuation', ';')) { this.advance(); continue; }
      if (this.check('keyword', 'function')) {
        // Interface method signatures have no body — parse signature only
        const fnDecl = this.parseInterfaceMethodSig();
        if (fnDecl !== null) body.push(fnDecl);
      } else {
        this.advance(); // skip unknown tokens
      }
    }
    this.eat('punctuation', '}');
    return { type: 'InterfaceDecl', name, superInterfaces, body, ...this.base(start) };
  }

  /**
   * Parse an interface method signature: `function name(params):ReturnType;`
   * No body is expected or consumed. Returns a FunctionDecl with an empty body block.
   */
  private parseInterfaceMethodSig(): FunctionDecl | null {
    const start = this.eat('keyword', 'function');
    const nameTok = this.peek();
    if (nameTok.type !== 'identifier') {
      // skip to end of signature
      while (!this.check('punctuation', ';') && !this.check('punctuation', '}') && !this.check('eof')) {
        this.advance();
      }
      this.tryEat('punctuation', ';');
      return null;
    }
    const methodName = this.advance().value;
    const params = this.parseFunctionParams();

    // optional return type annotation
    let returnType: string | null = null;
    if (this.tryEat('operator', ':')) {
      returnType = this.parseTypeName();
    }

    // consume optional semicolon at end of signature
    this.tryEat('punctuation', ';');

    // Build an empty body block for the FunctionDecl node
    const emptyBody: import('./ast.js').Block = {
      type: 'Block',
      body: [],
      pos: start.pos,
      line: start.line,
    };

    return {
      type: 'FunctionDecl',
      name: methodName,
      params,
      returnType,
      body: emptyBody,
      isStatic: false,
      access: null,
      isGetter: false,
      isSetter: false,
      pos: start.pos,
      line: start.line,
    };
  }

  private parseIfStmt(): IfStmt {
    const start = this.eat('keyword', 'if');
    this.eat('punctuation', '(');
    const test = this.parseExpression();
    this.eat('punctuation', ')');
    const consequent = this.parseStatement();
    let alternate: Statement | null = null;
    if (this.tryEat('keyword', 'else')) {
      alternate = this.parseStatement();
    }
    return { type: 'IfStmt', test, consequent, alternate, ...this.base(start) };
  }

  private parseForStmt(): ForStmt | ForInStmt {
    const start = this.eat('keyword', 'for');
    this.eat('punctuation', '(');

    // determine if for..in
    // peek: 'var' ident 'in' OR ident 'in'
    let isForIn = false;

    if (this.check('keyword', 'var')) {
      // could be for (var x in obj) or for (var x = ...; ...)
      const savedPos = this.pos;
      this.advance(); // consume 'var'
      const identToken = this.peek();
      if (identToken.type === 'identifier') {
        this.advance(); // consume ident
        // optional type annotation
        if (this.check('operator', ':')) {
          this.advance();
          this.parseTypeName();
        }
        if (this.check('keyword', 'in')) {
          isForIn = true;
        }
      }
      // restore
      this.pos = savedPos;
    } else if (this.peek().type === 'identifier') {
      const savedPos = this.pos;
      this.advance();
      if (this.check('keyword', 'in')) {
        isForIn = true;
      }
      this.pos = savedPos;
    }

    if (isForIn) {
      let left: VarDecl | Identifier;
      if (this.check('keyword', 'var')) {
        left = this.parseVarDeclNoInit();
      } else {
        const t = this.eat('identifier');
        left = { type: 'Identifier', name: t.value, ...this.base(t) };
      }
      this.eat('keyword', 'in');
      const right = this.parseExpression();
      this.eat('punctuation', ')');
      const body = this.parseStatement();
      return { type: 'ForInStmt', left, right, body, ...this.base(start) };
    }

    // regular for
    let init: VarDecl | ExprStmt | null = null;
    if (!this.check('punctuation', ';')) {
      if (this.check('keyword', 'var')) {
        init = this.parseVarDecl(false, null);
        // varDecl already consumed optional semicolon via trySemicolon
        // but for-init uses ';' as separator, not terminator
        // if trySemicolon consumed it we're fine; otherwise eat it
      } else {
        const expr = this.parseExpression();
        this.trySemicolon();
        init = { type: 'ExprStmt', expression: expr, pos: expr.pos, line: expr.line };
      }
    } else {
      this.eat('punctuation', ';');
    }

    let test: Expression | null = null;
    if (!this.check('punctuation', ';')) {
      test = this.parseExpression();
    }
    this.eat('punctuation', ';');

    let update: Expression | null = null;
    if (!this.check('punctuation', ')')) {
      update = this.parseExpression();
    }
    this.eat('punctuation', ')');

    const body = this.parseStatement();
    return { type: 'ForStmt', init, test, update, body, ...this.base(start) };
  }

  /** Parse var decl without initialiser (used in for..in left side). */
  private parseVarDeclNoInit(): VarDecl {
    const start = this.eat('keyword', 'var');
    const name = this.eat('identifier').value;
    let varType: string | null = null;
    if (this.tryEat('operator', ':')) {
      varType = this.parseTypeName();
    }
    return { type: 'VarDecl', name, varType, init: null, isStatic: false, access: null, ...this.base(start) };
  }

  private parseWhileStmt(): WhileStmt {
    const start = this.eat('keyword', 'while');
    this.eat('punctuation', '(');
    const test = this.parseExpression();
    this.eat('punctuation', ')');
    const body = this.parseStatement();
    return { type: 'WhileStmt', test, body, ...this.base(start) };
  }

  private parseDoWhileStmt(): DoWhileStmt {
    const start = this.eat('keyword', 'do');
    const body = this.parseStatement();
    this.eat('keyword', 'while');
    this.eat('punctuation', '(');
    const test = this.parseExpression();
    this.eat('punctuation', ')');
    this.trySemicolon();
    return { type: 'DoWhileStmt', test, body, ...this.base(start) };
  }

  private parseReturnStmt(): ReturnStmt {
    const start = this.eat('keyword', 'return');
    let value: Expression | null = null;
    if (!this.check('punctuation', ';') && !this.check('punctuation', '}') && !this.check('eof')) {
      value = this.parseExpression();
    }
    this.trySemicolon();
    return { type: 'ReturnStmt', value, ...this.base(start) };
  }

  private parseBreakStmt(): BreakStmt {
    const start = this.eat('keyword', 'break');
    // Optional label: break outer; (must be on the same line — no newline between break and label)
    let label: string | null = null;
    if (this.peek().type === 'identifier') {
      label = this.advance().value;
    }
    this.trySemicolon();
    return { type: 'BreakStmt', label, ...this.base(start) };
  }

  private parseContinueStmt(): ContinueStmt {
    const start = this.eat('keyword', 'continue');
    // Optional label: continue outer;
    let label: string | null = null;
    if (this.peek().type === 'identifier') {
      label = this.advance().value;
    }
    this.trySemicolon();
    return { type: 'ContinueStmt', label, ...this.base(start) };
  }

  private parseThrowStmt(): ThrowStmt {
    const start = this.eat('keyword', 'throw');
    const value = this.parseExpression();
    this.trySemicolon();
    return { type: 'ThrowStmt', value, ...this.base(start) };
  }

  private parseTryStmt(): TryStmt {
    const start = this.eat('keyword', 'try');
    const body = this.parseBlock();

    let catchClause: CatchClause | null = null;
    if (this.tryEat('keyword', 'catch')) {
      const catchStart = this.tokens[this.pos - 1];
      this.eat('punctuation', '(');
      const param = this.eat('identifier').value;
      // optional type annotation on catch param
      if (this.tryEat('operator', ':')) {
        this.parseTypeName();
      }
      this.eat('punctuation', ')');
      const catchBody = this.parseBlock();
      catchClause = { type: 'CatchClause', param, body: catchBody, ...this.base(catchStart) };
    }

    let finallyBlock: Block | null = null;
    if (this.tryEat('keyword', 'finally')) {
      finallyBlock = this.parseBlock();
    }

    return { type: 'TryStmt', body, catchClause, finallyBlock, ...this.base(start) };
  }

  private parseSwitchStmt(): SwitchStmt {
    const start = this.eat('keyword', 'switch');
    this.eat('punctuation', '(');
    const discriminant = this.parseExpression();
    this.eat('punctuation', ')');
    this.eat('punctuation', '{');

    const cases: CaseClause[] = [];
    while (!this.check('punctuation', '}') && !this.check('eof')) {
      if (this.check('punctuation', ';')) { this.advance(); continue; }
      const caseStart = this.peek();
      let test: Expression | null = null;
      if (this.tryEat('keyword', 'case')) {
        test = this.parseExpression();
        this.eat('operator', ':');
      } else if (this.tryEat('keyword', 'default')) {
        this.eat('operator', ':');
      } else {
        this.advance(); // skip unknown
        continue;
      }
      const consequent: Statement[] = [];
      while (!this.check('keyword', 'case') && !this.check('keyword', 'default') &&
             !this.check('punctuation', '}') && !this.check('eof')) {
        consequent.push(this.parseStatement());
      }
      cases.push({ type: 'CaseClause', test, consequent, ...this.base(caseStart) });
    }
    this.eat('punctuation', '}');
    return { type: 'SwitchStmt', discriminant, cases, ...this.base(start) };
  }

  private parseWithStmt(): WithStmt {
    const start = this.eat('keyword', 'with');
    this.eat('punctuation', '(');
    const object = this.parseExpression();
    this.eat('punctuation', ')');
    const body = this.parseStatement();
    return { type: 'WithStmt', object, body, ...this.base(start) };
  }

  private parseLabeledStmt(): LabeledStmt {
    const start = this.peek();
    const label = this.advance().value; // consume identifier (label name)
    this.eat('operator', ':');          // consume ':'
    const body = this.parseStatement();
    return { type: 'LabeledStmt', label, body, ...this.base(start) };
  }

  private parseExprStmt(): ExprStmt {
    const expr = this.parseExpression();
    this.trySemicolon();
    return { type: 'ExprStmt', expression: expr, pos: expr.pos, line: expr.line };
  }

  // ── Expressions ────────────────────────────────────────────────────────────

  private parseExpression(): Expression {
    return this.parseAssignment();
  }

  private parseAssignment(): Expression {
    const left = this.parseTernary();

    const t = this.peek();
    if (t.type === 'operator' && ASSIGN_OPS.has(t.value)) {
      this.advance();
      const right = this.parseAssignment(); // right-associative
      return { type: 'AssignExpr', operator: t.value, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseTernary(): Expression {
    const test = this.parseOr();
    if (this.tryEat('operator', '?')) {
      const consequent = this.parseAssignment();
      this.eat('operator', ':');
      const alternate = this.parseAssignment();
      return { type: 'TernaryExpr', test, consequent, alternate, pos: test.pos, line: test.line };
    }
    return test;
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.check('operator', '||')) {
      const op = this.advance().value;
      const right = this.parseAnd();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseBitOr();
    while (this.check('operator', '&&')) {
      const op = this.advance().value;
      const right = this.parseBitOr();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseBitOr(): Expression {
    let left = this.parseBitXor();
    while (this.check('operator', '|')) {
      const op = this.advance().value;
      const right = this.parseBitXor();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseBitXor(): Expression {
    let left = this.parseBitAnd();
    while (this.check('operator', '^')) {
      const op = this.advance().value;
      const right = this.parseBitAnd();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseBitAnd(): Expression {
    let left = this.parseEquality();
    while (this.check('operator', '&')) {
      const op = this.advance().value;
      const right = this.parseEquality();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseEquality(): Expression {
    let left = this.parseRelational();
    while (this.check('operator', '==') || this.check('operator', '!=') ||
           this.check('operator', '===') || this.check('operator', '!==')) {
      const op = this.advance().value;
      const right = this.parseRelational();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseRelational(): Expression {
    let left = this.parseShift();
    while (this.check('operator', '<') || this.check('operator', '>') ||
           this.check('operator', '<=') || this.check('operator', '>=') ||
           this.check('keyword', 'instanceof') || this.check('keyword', 'in') ||
           this.check('identifier', 'as')) {
      const op = this.advance().value;
      const right = this.parseShift();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseShift(): Expression {
    let left = this.parseAdditive();
    while (this.check('operator', '<<') || this.check('operator', '>>') || this.check('operator', '>>>')) {
      const op = this.advance().value;
      const right = this.parseAdditive();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative();
    while (this.check('operator', '+') || this.check('operator', '-')) {
      const op = this.advance().value;
      const right = this.parseMultiplicative();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseMultiplicative(): Expression {
    let left = this.parseUnary();
    while (this.check('operator', '*') || this.check('operator', '/') || this.check('operator', '%')) {
      const op = this.advance().value;
      const right = this.parseUnary();
      left = { type: 'BinaryExpr', operator: op, left, right, pos: left.pos, line: left.line };
    }
    return left;
  }

  private parseUnary(): Expression {
    const t = this.peek();

    // prefix unary operators
    if (t.type === 'operator' && (t.value === '!' || t.value === '-' || t.value === '+' ||
        t.value === '~' || t.value === '++' || t.value === '--')) {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'UnaryExpr', operator: t.value, operand, prefix: true, ...this.base(t) };
    }
    if (t.type === 'keyword' && (t.value === 'typeof' || t.value === 'void' ||
        t.value === 'delete')) {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'UnaryExpr', operator: t.value, operand, prefix: true, ...this.base(t) };
    }

    // 'new' expression
    if (t.type === 'keyword' && t.value === 'new') {
      return this.parseNewExpr();
    }

    return this.parsePostfix();
  }

  private parseNewExpr(): NewExpr {
    const start = this.eat('keyword', 'new');
    // callee can be dotted identifier
    let callee: Expression = this.parsePrimaryIdentifier();
    while (this.check('punctuation', '.')) {
      this.advance();
      const prop = this.peek();
      if (prop.type === 'identifier' || prop.type === 'keyword') {
        callee = { type: 'MemberExpr', object: callee, property: this.advance().value, ...this.base(prop) };
      } else break;
    }

    // arguments (optional — `new Foo` without parens is valid)
    let args: Expression[] = [];
    if (this.check('punctuation', '(')) {
      args = this.parseArgList();
    }
    return { type: 'NewExpr', callee, args, ...this.base(start) };
  }

  private parsePostfix(): Expression {
    let expr = this.parseCallOrMember();
    if (this.check('operator', '++') || this.check('operator', '--')) {
      const op = this.advance().value;
      return { type: 'UnaryExpr', operator: op, operand: expr, prefix: false, pos: expr.pos, line: expr.line };
    }
    return expr;
  }

  private parseCallOrMember(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.check('punctuation', '.')) {
        this.advance();
        const prop = this.peek();
        if (prop.type === 'identifier' || prop.type === 'keyword') {
          expr = { type: 'MemberExpr', object: expr, property: this.advance().value, pos: expr.pos, line: expr.line };
        } else {
          throw new Error(`Parse error at line ${prop.line}: expected property name after '.', got "${prop.value}"`);
        }
      } else if (this.check('punctuation', '[')) {
        this.advance();
        const index = this.parseExpression();
        this.eat('punctuation', ']');
        expr = { type: 'IndexExpr', object: expr, index, pos: expr.pos, line: expr.line };
      } else if (this.check('punctuation', '(')) {
        const args = this.parseArgList();
        expr = { type: 'CallExpr', callee: expr, args, pos: expr.pos, line: expr.line };
      } else {
        break;
      }
    }
    return expr;
  }

  private parseArgList(): Expression[] {
    this.eat('punctuation', '(');
    const args: Expression[] = [];
    while (!this.check('punctuation', ')') && !this.check('eof')) {
      // Special case: on(keyPress '<key>') — `keyPress` followed by a string
      // literal without a comma is the AS2/AVM1 on() key-press event syntax.
      // Parse both tokens as a single synthetic identifier so the call parses
      // without error; the compiler treats on() calls as no-ops anyway.
      const cur = this.peek();
      if (cur.type === 'identifier' && cur.value === 'keyPress') {
        const next = this.tokens[this.pos + 1];
        if (next && next.type === 'string') {
          this.advance(); // consume 'keyPress'
          const keyToken = this.advance(); // consume the string, e.g. "'<Enter>'"
          const keyValue = keyToken.value.slice(1, -1); // strip surrounding quotes
          const synth: Identifier = {
            type: 'Identifier',
            name: `keyPress:${keyValue}`,
            pos: cur.pos,
            line: cur.line,
          };
          args.push(synth);
          if (!this.tryEat('punctuation', ',')) break;
          continue;
        }
      }
      args.push(this.parseAssignment());
      if (!this.tryEat('punctuation', ',')) break;
    }
    this.eat('punctuation', ')');
    return args;
  }

  /** Parse just an identifier (or keyword-used-as-identifier) without call/member chain. */
  private parsePrimaryIdentifier(): Expression {
    const t = this.peek();
    if (t.type === 'identifier' || t.type === 'keyword') {
      this.advance();
      return { type: 'Identifier', name: t.value, ...this.base(t) };
    }
    throw new Error(`Parse error at line ${t.line}: expected identifier, got "${t.value}"`);
  }

  private parsePrimary(): Expression {
    const t = this.peek();

    // RegExp literal: /pattern/flags
    // The tokenizer emits '/' as an operator. In primary-expression position we
    // re-scan the raw source at that character offset to read the full regex.
    if (t.type === 'operator' && t.value === '/') {
      const regexToken = scanRegexAt(this.source, t.pos, t.line, t.col);
      if (regexToken !== null) {
        // Advance past all tokenizer tokens that overlap with the regex literal
        const regexEnd = regexToken.pos + regexToken.value.length;
        while (this.pos < this.tokens.length && this.tokens[this.pos]!.pos < regexEnd) {
          this.pos++;
        }
        // Parse the value back out: /pattern/flags
        const raw = regexToken.value;
        const lastSlash = raw.lastIndexOf('/');
        const pattern = raw.slice(1, lastSlash);
        const flags = raw.slice(lastSlash + 1);
        const node: RegExpLiteral = {
          type: 'RegExpLiteral',
          pattern,
          flags,
          pos: t.pos,
          line: t.line,
        };
        return node;
      }
    }

    // Parenthesised expression
    if (t.type === 'punctuation' && t.value === '(') {
      this.advance();
      const expr = this.parseExpression();
      this.eat('punctuation', ')');
      return expr;
    }

    // Array literal
    if (t.type === 'punctuation' && t.value === '[') {
      return this.parseArrayLiteral();
    }

    // Object literal
    if (t.type === 'punctuation' && t.value === '{') {
      return this.parseObjectLiteral();
    }

    // Number literal
    if (t.type === 'number') {
      this.advance();
      const num = t.value.startsWith('0x') || t.value.startsWith('0X')
        ? parseInt(t.value, 16)
        : parseFloat(t.value);
      return { type: 'Literal', value: num, raw: t.value, ...this.base(t) };
    }

    // String literal
    if (t.type === 'string') {
      this.advance();
      // strip surrounding quotes
      const raw = t.value;
      const inner = raw.slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      return { type: 'Literal', value: inner, raw, ...this.base(t) };
    }

    // Keywords that are literals or expressions
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'true':
          this.advance();
          return { type: 'Literal', value: true, raw: 'true', ...this.base(t) };
        case 'false':
          this.advance();
          return { type: 'Literal', value: false, raw: 'false', ...this.base(t) };
        case 'null':
          this.advance();
          return { type: 'Literal', value: null, raw: 'null', ...this.base(t) };
        case 'undefined':
          this.advance();
          return { type: 'Literal', value: null, raw: 'undefined', ...this.base(t) };
        case 'NaN':
          this.advance();
          return { type: 'Literal', value: NaN, raw: 'NaN', ...this.base(t) };
        case 'Infinity':
          this.advance();
          return { type: 'Literal', value: Infinity, raw: 'Infinity', ...this.base(t) };
        case 'this':
        case '_root':
        case '_global':
        case '_parent':
        case 'super':
          this.advance();
          return { type: 'Identifier', name: t.value, ...this.base(t) };
        case 'function':
          // anonymous or named function expression
          return this.parseFunctionDecl(false, null);
      }
    }

    // Identifiers
    if (t.type === 'identifier') {
      this.advance();
      return { type: 'Identifier', name: t.value, ...this.base(t) };
    }

    throw new Error(`Parse error at line ${t.line}: unexpected token "${t.value}" (${t.type})`);
  }

  private parseArrayLiteral(): ArrayLiteral {
    const start = this.eat('punctuation', '[');
    const elements: Expression[] = [];
    while (!this.check('punctuation', ']') && !this.check('eof')) {
      // support sparse arrays: [,] [1,,3]
      if (this.check('punctuation', ',')) {
        this.advance();
        elements.push({ type: 'Literal', value: null, raw: '', pos: this.peek().pos, line: this.peek().line });
        continue;
      }
      elements.push(this.parseAssignment());
      if (!this.tryEat('punctuation', ',')) break;
    }
    this.eat('punctuation', ']');
    return { type: 'ArrayLiteral', elements, ...this.base(start) };
  }

  private parseObjectLiteral(): ObjectLiteral {
    const start = this.eat('punctuation', '{');
    const properties: PropertyDef[] = [];
    while (!this.check('punctuation', '}') && !this.check('eof')) {
      const keyToken = this.peek();
      let key: string;
      if (keyToken.type === 'identifier' || keyToken.type === 'keyword') {
        key = this.advance().value;
      } else if (keyToken.type === 'string') {
        key = this.advance().value.slice(1, -1);
      } else if (keyToken.type === 'number') {
        key = this.advance().value;
      } else {
        this.advance(); // skip
        continue;
      }
      this.eat('operator', ':');
      const value = this.parseAssignment();
      properties.push({ type: 'PropertyDef', key, value, ...this.base(keyToken) });
      if (!this.tryEat('punctuation', ',')) break;
    }
    this.eat('punctuation', '}');
    return { type: 'ObjectLiteral', properties, ...this.base(start) };
  }
}

/**
 * Parse an ActionScript 2 source string and return a Program AST.
 * Throws a descriptive error with line number on syntax errors.
 */
export function parse(source: string): Program {
  return new Parser(source).parseProgram();
}
