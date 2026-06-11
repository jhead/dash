import { parse } from "./parser.js";
import type {
  Program, Statement, Expression,
  IfStmt, ForStmt, ForInStmt, WhileStmt, DoWhileStmt,
  ExprStmt, VarDecl, FunctionDecl, ClassDecl, SequenceExpr, Block,
  BinaryExpr, UnaryExpr, AssignExpr, CallExpr, NewExpr,
  MemberExpr, IndexExpr, TernaryExpr, Literal, Identifier,
  ArrayLiteral, ObjectLiteral,
  SwitchStmt, ThrowStmt, TryStmt, WithStmt, LabeledStmt,
  RegExpLiteral,
} from "./ast.js";

// ---------------------------------------------------------------------------
// ByteBuffer — growable byte array with back-patching support
// ---------------------------------------------------------------------------

class ByteBuffer {
  private bytes: number[] = [];

  write(byte: number): void {
    this.bytes.push(byte & 0xff);
  }

  writeUI16(v: number): void {
    this.write(v & 0xff);
    this.write((v >> 8) & 0xff);
  }

  /** Write a signed 16-bit value as two's-complement little-endian. */
  writeSI16(v: number): void {
    const u = ((v & 0xffff) + 0x10000) % 0x10000;
    this.writeUI16(u);
  }

  writeBytes(arr: Uint8Array): void {
    for (const b of arr) this.bytes.push(b);
  }

  /** Back-patch a UI16 at a previously recorded byte offset. */
  patchUI16(pos: number, value: number): void {
    const u = ((value & 0xffff) + 0x10000) % 0x10000;
    this.bytes[pos] = u & 0xff;
    this.bytes[pos + 1] = (u >> 8) & 0xff;
  }

  /** Back-patch a signed 16-bit value. */
  patchSI16(pos: number, value: number): void {
    this.patchUI16(pos, value);
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  get length(): number {
    return this.bytes.length;
  }
}

// ---------------------------------------------------------------------------
// Loop context — for break/continue back-patching
// ---------------------------------------------------------------------------

interface LoopContext {
  /** SI16 field positions of ActionJump records that should jump to loop end (break). */
  breakPatches: number[];
  /** SI16 field positions of ActionJump records that should jump to continue target. */
  continuePatches: number[];
}

// ---------------------------------------------------------------------------
// String collection — first pass for constant pool construction
// ---------------------------------------------------------------------------

/**
 * Walk all statements and expressions in the AST, collecting every string
 * that the compiler would emit via pushString().  Returns a Map from each
 * string to the number of times it appears so the caller can decide which
 * strings are worth pooling.
 *
 * Strings collected here must exactly match every site where the compiler
 * calls pushString():
 *   - string Literal values
 *   - Identifier names (for GetVariable / SetVariable)
 *   - MemberExpr / AssignExpr property names
 *   - VarDecl names
 *   - ForIn loop variable names
 *   - ObjectLiteral property keys
 *   - RegExpLiteral ("RegExp", pattern, flags)
 *   - FunctionDecl / ClassDecl names, param names, method names, etc.
 *   - Built-in call patterns (super "call", "hasOwnProperty", etc.)
 */
function collectStrings(stmts: Statement[]): Map<string, number> {
  const counts = new Map<string, number>();
  function add(s: string): void {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  function scanStmts(ss: Statement[]): void {
    for (const s of ss) scanStmt(s);
  }

  function scanStmt(s: Statement): void {
    switch (s.type) {
      case 'Block':       scanStmts(s.body); break;
      case 'ExprStmt':    scanExpr(s.expression); break;
      case 'VarDecl':
        add(s.name);
        if (s.init !== null) scanExpr(s.init);
        break;
      case 'IfStmt':
        scanExpr(s.test);
        scanStmt(s.consequent);
        if (s.alternate !== null) scanStmt(s.alternate);
        break;
      case 'WhileStmt':
        scanExpr(s.test);
        scanStmt(s.body);
        break;
      case 'DoWhileStmt':
        scanStmt(s.body);
        scanExpr(s.test);
        break;
      case 'ForStmt':
        if (s.init !== null) {
          if (s.init.type === 'VarDecl') {
            add((s.init as VarDecl).name);
            if ((s.init as VarDecl).init !== null) scanExpr((s.init as VarDecl).init!);
          } else if (s.init.type === 'Block') {
            scanStmts((s.init as Block).body);
          } else {
            scanExpr((s.init as ExprStmt).expression);
          }
        }
        if (s.test !== null) scanExpr(s.test);
        if (s.update !== null) scanExpr(s.update);
        scanStmt(s.body);
        break;
      case 'ForInStmt': {
        const varName = s.left.type === 'VarDecl'
          ? (s.left as VarDecl).name
          : (s.left as Identifier).name;
        add(varName);
        scanExpr(s.right);
        scanStmt(s.body);
        break;
      }
      case 'ReturnStmt':
        if (s.value !== null) scanExpr(s.value);
        break;
      case 'ThrowStmt':   scanExpr(s.value); break;
      case 'TryStmt':
        scanStmts(s.body.body);
        if (s.catchClause !== null) {
          // catch param is used as a string variable name
          add(s.catchClause.param);
          scanStmts(s.catchClause.body.body);
        }
        if (s.finallyBlock !== null) scanStmts(s.finallyBlock.body);
        break;
      case 'SwitchStmt':
        scanExpr(s.discriminant);
        for (const c of s.cases) {
          if (c.test !== null) scanExpr(c.test);
          scanStmts(c.consequent);
        }
        break;
      case 'WithStmt':
        scanExpr(s.object);
        scanStmt(s.body);
        break;
      case 'LabeledStmt':
        scanStmt(s.body);
        break;
      case 'FunctionDecl':
        if (s.name !== null) add(s.name);
        scanStmts(s.body.body);
        break;
      case 'ClassDecl':
        scanClassDecl(s as ClassDecl);
        break;
      default: break;
    }
  }

  function scanClassDecl(decl: ClassDecl): void {
    add(decl.name);
    if (decl.superClass !== null) {
      add(decl.superClass);
      add('prototype');
      add('constructor');
      // super.call pattern used in constructor body
      add('call');
    }
    for (const iface of decl.interfaces) {
      add(iface);
    }

    // Separate getter/setter pairs from regular members (mirrors compiler logic)
    const getsetPairs = new Set<string>();
    for (const member of decl.body) {
      if (member.type === 'FunctionDecl') {
        const fn = member as FunctionDecl;
        if (fn.name === null) continue;
        if (fn.isGetter || fn.isSetter) {
          getsetPairs.add(fn.name);
        }
      }
    }

    for (const member of decl.body) {
      if (member.type === 'FunctionDecl') {
        const fn = member as FunctionDecl;
        if (fn.name === null) continue;
        add(fn.name); // method name or ctor name
        if (!fn.isStatic && !fn.isGetter && !fn.isSetter) {
          // Non-static method: pushes className + GetVariable + "prototype" + GetMember
          add('prototype');
        } else if (fn.isStatic) {
          // Static method: pushes className + GetVariable
          // (no extra strings beyond methodName which is already added)
        }
        scanStmts(fn.body.body);
      } else if (member.type === 'VarDecl') {
        const vd = member as VarDecl;
        add(vd.name);
        if (!vd.isStatic) {
          // Instance property: pushes className + GetVariable + "prototype" + GetMember
          add('prototype');
        }
        if (vd.init !== null) scanExpr(vd.init);
      }
    }

    // addProperty strings for getter/setter pairs
    for (const _propName of getsetPairs) {
      add('addProperty');
      add('prototype');
      // _propName already added in the member loop
    }
  }

  function scanExpr(e: Expression): void {
    switch (e.type) {
      case 'Literal':
        if (typeof e.value === 'string') add(e.value);
        break;
      case 'Identifier':
        switch (e.name) {
          case 'undefined': case 'null': case 'true': case 'false':
          case 'NaN': case 'Infinity': break; // these don't push a string
          case 'newline': add('\r'); break; // newline constant → pushes "\r"
          default: add(e.name); break;
        }
        break;
      case 'AssignExpr':
        if (e.left.type === 'MemberExpr') {
          // pushString(property) × 1 or 2 depending on compound vs simple
          const prop = (e.left as MemberExpr).property;
          add(prop);
          if (e.operator !== '=') add(prop); // compound: property pushed twice
          scanExpr((e.left as MemberExpr).object);
          if (e.operator !== '=') scanExpr((e.left as MemberExpr).object); // compound: object twice
          scanExpr(e.right);
        } else if (e.left.type === 'IndexExpr') {
          scanExpr((e.left as IndexExpr).object);
          scanExpr((e.left as IndexExpr).index);
          if (e.operator !== '=') {
            scanExpr((e.left as IndexExpr).object);
            scanExpr((e.left as IndexExpr).index);
          }
          scanExpr(e.right);
        } else if (e.left.type === 'Identifier') {
          const name = (e.left as Identifier).name;
          add(name);
          if (e.operator !== '=') add(name); // compound: name pushed twice
          scanExpr(e.right);
        }
        break;
      case 'BinaryExpr':
        if (e.operator === 'in') {
          // GetMember probe: typeof(obj[key]) !== "undefined"
          add('undefined');
        }
        scanExpr(e.left);
        scanExpr(e.right);
        break;
      case 'UnaryExpr':
        if ((e.operator === '++' || e.operator === '--') && e.operand.type === 'Identifier') {
          add((e.operand as Identifier).name); // pushed twice (get + set)
          add((e.operand as Identifier).name);
        } else if (e.operator === 'delete') {
          if (e.operand.type === 'MemberExpr') {
            scanExpr((e.operand as MemberExpr).object);
            add((e.operand as MemberExpr).property);
          } else if (e.operand.type === 'Identifier') {
            add((e.operand as Identifier).name);
          }
        } else {
          scanExpr(e.operand);
        }
        break;
      case 'CallExpr':
        if (e.callee.type === 'MemberExpr') {
          const member = e.callee as MemberExpr;
          // String.fromCharCode(n) is special-cased to ActionMBChr (0x63) —
          // no strings added to the constant pool for this call.
          if (
            member.object.type === 'Identifier' &&
            (member.object as Identifier).name === 'String' &&
            member.property === 'fromCharCode' &&
            e.args.length === 1
          ) {
            for (const a of e.args) scanExpr(a);
            break;
          }
          scanExpr(member.object);
          add(member.property);
          for (const a of e.args) scanExpr(a);
        } else if (e.callee.type === 'Identifier') {
          const name = (e.callee as Identifier).name;
          if (name === 'super') {
            // super(...) → SuperClass.call(this, ...)
            add('this');
            add('call');
          } else if (!['stop', 'play', 'nextFrame', 'prevFrame',
                       'gotoAndPlay', 'gotoAndStop', 'trace',
                       'getURL', 'loadMovie', 'loadMovieNum',
                       'unloadMovie', 'unloadMovieNum',
                       'startDrag', 'stopDrag'].includes(name)
                    && !(name === 'int' && e.args.length === 1)
                    && !(name === 'Number' && e.args.length === 1)
                    && !(name === 'String' && e.args.length === 1)
                    && !(name === 'Boolean' && e.args.length === 1)
                    && !(name === 'getTimer' && e.args.length === 0)
                    && !(name === 'random' && e.args.length === 1)
                    && !(name === 'chr' && e.args.length === 1)
                    && !(name === 'ord' && e.args.length === 1)
                    && !(name === 'eval' && e.args.length === 1)
                    && !(name === 'length' && e.args.length === 1)
                    && !(name === 'substring' && e.args.length === 3)) {
            add(name);
          }
          if (name === 'loadMovieNum' || name === 'unloadMovieNum') {
            add('_level');
          }
          for (const a of e.args) scanExpr(a);
        } else if (e.callee.type === 'IndexExpr') {
          scanExpr((e.callee as IndexExpr).object);
          scanExpr((e.callee as IndexExpr).index);
          for (const a of e.args) scanExpr(a);
        } else {
          // complex callee — temp var name not known in advance, skip
          scanExpr(e.callee);
          for (const a of e.args) scanExpr(a);
        }
        break;
      case 'NewExpr': {
        // className string
        function memberToStr(ex: Expression): string | null {
          if (ex.type === 'Identifier') return (ex as Identifier).name;
          if (ex.type === 'MemberExpr') {
            const m = ex as MemberExpr;
            const obj = memberToStr(m.object);
            if (obj !== null) return `${obj}.${m.property}`;
          }
          return null;
        }
        for (const a of e.args) scanExpr(a);
        const className = memberToStr(e.callee);
        if (className !== null) add(className);
        else scanExpr(e.callee);
        break;
      }
      case 'MemberExpr':
        scanExpr(e.object);
        add(e.property);
        break;
      case 'IndexExpr':
        scanExpr(e.object);
        scanExpr(e.index);
        break;
      case 'TernaryExpr':
        scanExpr(e.test);
        scanExpr(e.consequent);
        scanExpr(e.alternate);
        break;
      case 'SequenceExpr':
        for (const sub of e.expressions) scanExpr(sub);
        break;
      case 'ArrayLiteral':
        for (const el of e.elements) scanExpr(el);
        break;
      case 'ObjectLiteral':
        for (const p of e.properties) {
          add(p.key);
          scanExpr(p.value);
        }
        break;
      case 'RegExpLiteral':
        add('RegExp');
        add(e.pattern);
        if (e.flags.length > 0) add(e.flags);
        break;
      case 'FunctionDecl':
        // anonymous function expression — compile body strings
        scanStmts(e.body.body);
        break;
      default: break;
    }
  }

  scanStmts(stmts);
  return counts;
}

/**
 * Build a constant pool from string-count map.
 * All strings are pooled (matching real Flash 8 behavior).
 * Returns a Map from string → pool index.
 */
function buildConstantPool(counts: Map<string, number>): Map<string, number> {
  const pool = new Map<string, number>();
  let idx = 0;
  for (const [str] of counts) {
    pool.set(str, idx++);
  }
  return pool;
}

/**
 * Encode an ActionConstantPool (0x88) action block.
 *
 * Format: opcode(0x88) + UI16 length + UI16 count + NUL-terminated strings
 */
function encodeConstantPool(pool: Map<string, number>): Uint8Array {
  // Sort pool entries by index
  const strings: string[] = [];
  for (const [str, idx] of pool) {
    strings[idx] = str;
  }

  const enc = new TextEncoder();
  let strByteLen = 0;
  const encodedStrings: Uint8Array[] = [];
  for (const s of strings) {
    const b = enc.encode(s);
    encodedStrings.push(b);
    strByteLen += b.length + 1; // +1 for NUL terminator
  }

  // payload = UI16 count + NUL-terminated strings
  const payloadLen = 2 + strByteLen;
  // total = opcode(1) + UI16 length(2) + payload
  const total = 1 + 2 + payloadLen;
  const out = new Uint8Array(total);
  let pos = 0;
  out[pos++] = 0x88; // ActionConstantPool opcode
  out[pos++] = payloadLen & 0xff;
  out[pos++] = (payloadLen >> 8) & 0xff;
  out[pos++] = strings.length & 0xff;
  out[pos++] = (strings.length >> 8) & 0xff;
  for (const b of encodedStrings) {
    out.set(b, pos);
    pos += b.length;
    out[pos++] = 0; // NUL terminator
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

class Compiler {
  buf = new ByteBuffer();
  loopStack: LoopContext[] = [];
  /** Maps label names to their loop contexts, for labeled break/continue. */
  labeledLoops: Map<string, LoopContext> = new Map();
  /** Current superclass name, set when compiling class methods that have inheritance. */
  currentSuperClass: string | null = null;
  /** Counter for generating unique temp variable names for complex callees. */
  private callTmpCounter = 0;
  /**
   * Constant pool: maps string → pool index.  When set, pushString() emits
   * ActionPush type=8 (UI8 pool index) or type=9 (UI16 pool index) instead of
   * type=0 (inline NUL-terminated string).  The pool header (ActionConstantPool
   * 0x88) is emitted once by compileProgram(); sub-compilers inherit the pool
   * from their parent so all references use the same indices.
   */
  constantPool: Map<string, number> | null = null;

  // ---- Low-level emitters --------------------------------------------------

  /** Emit a no-payload action (opcode < 0x80). */
  private emit(opcode: number): void {
    this.buf.write(opcode);
  }

  /** Emit an action with a payload (opcode >= 0x80 typically). */
  private emitWithPayload(opcode: number, payload: Uint8Array | number[]): void {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    this.buf.write(opcode);
    this.buf.writeUI16(bytes.length);
    this.buf.writeBytes(bytes);
  }

  // ---- ActionPush helpers --------------------------------------------------

  private pushString(s: string): void {
    // If a constant pool is active, emit a pool-index reference instead of
    // an inline string — saves bytes and matches real Flash 8 output.
    if (this.constantPool !== null) {
      const idx = this.constantPool.get(s);
      if (idx !== undefined) {
        if (idx < 256) {
          // ActionPush type=8: UI8 pool index (2-byte payload)
          this.emitWithPayload(0x96, [8, idx]);
        } else {
          // ActionPush type=9: UI16 pool index (3-byte payload)
          this.emitWithPayload(0x96, [9, idx & 0xff, (idx >> 8) & 0xff]);
        }
        return;
      }
    }
    const strBytes = new TextEncoder().encode(s);
    // payload: type(1) + utf8 bytes + null terminator(1)
    const payload = new Uint8Array(1 + strBytes.length + 1);
    payload[0] = 0; // type = string
    payload.set(strBytes, 1);
    // payload[1 + strBytes.length] is already 0 (null terminator)
    this.emitWithPayload(0x96, payload);
  }

  private pushInt(n: number): void {
    const payload = new Uint8Array(5);
    payload[0] = 7; // type = integer (SI32 LE) — SWF ActionPush type 7
    new DataView(payload.buffer).setInt32(1, n, true);
    this.emitWithPayload(0x96, payload);
  }

  private pushNumber(n: number): void {
    const payload = new Uint8Array(9);
    payload[0] = 6; // type = double (IEEE 754 64-bit LE) — SWF ActionPush type 6
    new DataView(payload.buffer).setFloat64(1, n, true);
    this.emitWithPayload(0x96, payload);
  }

  private pushBool(b: boolean): void {
    this.emitWithPayload(0x96, [5, b ? 1 : 0]); // type = boolean — SWF ActionPush type 5
  }

  private pushUndefined(): void {
    this.emitWithPayload(0x96, [3]); // type = undefined — SWF ActionPush type 3
  }

  private pushNull(): void {
    this.emitWithPayload(0x96, [2]); // type = null — SWF ActionPush type 2
  }

  // ---- Control-flow jump helpers -------------------------------------------

  /**
   * Emit ActionIf (0x9D) with a placeholder SI16 offset.
   * Returns the byte-position of the SI16 offset field.
   *
   * AVM1 ActionIf: pops top of stack; if truthy, jumps by `offset` bytes
   * relative to the byte immediately following the entire record
   * (i.e., relative to offsetFieldPos + 2).
   */
  private emitActionIf(): number {
    this.buf.write(0x9d);       // ActionIf opcode
    this.buf.writeUI16(2);       // payload length = 2 (just the SI16 offset)
    const offsetFieldPos = this.buf.length;
    this.buf.writeSI16(0);       // placeholder
    return offsetFieldPos;
  }

  /**
   * Emit ActionJump (0x99) with a placeholder SI16 offset.
   * Returns the byte-position of the SI16 offset field.
   */
  private emitActionJump(): number {
    this.buf.write(0x99);
    this.buf.writeUI16(2);
    const offsetFieldPos = this.buf.length;
    this.buf.writeSI16(0);
    return offsetFieldPos;
  }

  /**
   * Back-patch a jump so that execution lands at `targetPos`.
   * `offsetFieldPos` is the position of the SI16 offset field.
   * The offset is relative to `offsetFieldPos + 2`.
   */
  private patchJump(offsetFieldPos: number, targetPos: number): void {
    const afterField = offsetFieldPos + 2;
    const delta = targetPos - afterField;
    this.buf.patchSI16(offsetFieldPos, delta);
  }

  // ---- Public entry point --------------------------------------------------

  compileProgram(program: Program): Uint8Array {
    // Pass 1: collect all strings from the AST and build a constant pool.
    // Emit ActionConstantPool (0x88) before the body actions when there is at
    // least one string to pool.  The pool is shared with all sub-compilers so
    // function bodies and try/catch blocks reference the same indices.
    const counts = collectStrings(program.body);
    if (counts.size > 0) {
      this.constantPool = buildConstantPool(counts);
      const poolBytes = encodeConstantPool(this.constantPool);
      this.buf.writeBytes(poolBytes);
    }

    // Pass 2: compile the program body
    for (const stmt of program.body) {
      this.compileStmt(stmt);
    }
    return this.buf.getBytes();
  }

  /** Compile a list of statements into this compiler's buffer. */
  compileStatements(stmts: Statement[]): void {
    for (const stmt of stmts) {
      this.compileStmt(stmt);
    }
  }

  // ---- Statement compilation -----------------------------------------------

  private compileStmt(stmt: Statement): void {
    switch (stmt.type) {
      case 'ExprStmt':
        this.compileExpr(stmt.expression);
        this.emit(0x17); // ActionPop — discard expression result
        break;

      case 'VarDecl':
        this.pushString(stmt.name);
        if (stmt.init !== null) {
          this.compileExpr(stmt.init);
          this.emit(0x3c); // ActionDefineLocal (pops name then value from stack)
        } else {
          this.emit(0x41); // ActionDefineLocal2 (pops name, assigns undefined)
        }
        break;

      case 'ReturnStmt':
        if (stmt.value !== null) {
          this.compileExpr(stmt.value);
        } else {
          this.pushUndefined();
        }
        this.emit(0x3e); // ActionReturn
        break;

      case 'IfStmt':
        this.compileIfStmt(stmt);
        break;

      case 'Block':
        for (const s of stmt.body) this.compileStmt(s);
        break;

      case 'WhileStmt':
        this.compileWhileStmt(stmt);
        break;

      case 'DoWhileStmt':
        this.compileDoWhileStmt(stmt);
        break;

      case 'ForStmt':
        this.compileForStmt(stmt);
        break;

      case 'ForInStmt':
        this.compileForInStmt(stmt as ForInStmt);
        break;

      case 'BreakStmt': {
        const label = (stmt as any).label as string | null;
        if (label !== null && label !== undefined) {
          const ctx = this.labeledLoops.get(label);
          if (ctx === undefined) {
            throw new Error(`Compiler error: undefined label "${label}" in break statement`);
          }
          ctx.breakPatches.push(this.emitActionJump());
        } else {
          const ctx = this.loopStack[this.loopStack.length - 1];
          if (ctx !== undefined) {
            ctx.breakPatches.push(this.emitActionJump());
          }
        }
        break;
      }

      case 'ContinueStmt': {
        const label = (stmt as any).label as string | null;
        if (label !== null && label !== undefined) {
          const ctx = this.labeledLoops.get(label);
          if (ctx === undefined) {
            throw new Error(`Compiler error: undefined label "${label}" in continue statement`);
          }
          ctx.continuePatches.push(this.emitActionJump());
        } else {
          const ctx = this.loopStack[this.loopStack.length - 1];
          if (ctx !== undefined) {
            ctx.continuePatches.push(this.emitActionJump());
          }
        }
        break;
      }

      case 'FunctionDecl':
        this.compileFunctionDeclStmt(stmt as FunctionDecl);
        break;

      case 'ClassDecl':
        this.compileClassDecl(stmt as ClassDecl);
        break;

      case 'InterfaceDecl':
        // Interface declarations have no runtime representation — skip silently
        break;

      case 'SwitchStmt':
        this.compileSwitchStmt(stmt as SwitchStmt);
        break;

      case 'ThrowStmt':
        this.compileThrowStmt(stmt as ThrowStmt);
        break;

      case 'TryStmt':
        this.compileTryStmt(stmt as TryStmt);
        break;

      case 'WithStmt':
        this.compileWithStmt(stmt as WithStmt);
        break;

      case 'LabeledStmt':
        this.compileLabeledStmt(stmt as LabeledStmt);
        break;

      default:
        // Unknown statement type — skip silently
        break;
    }
  }

  private compileIfStmt(stmt: IfStmt): void {
    this.compileExpr(stmt.test);
    // ActionNot inverts the condition.
    // ActionIf jumps when top-of-stack is truthy.
    // After ActionNot: truthy ↔ original test was false → we jump over the consequent.
    this.emit(0x12); // ActionNot
    const ifOffsetPos = this.emitActionIf(); // jump to else/end when !test is truthy

    this.compileStmt(stmt.consequent);

    if (stmt.alternate !== null) {
      const jumpOffsetPos = this.emitActionJump(); // jump over alternate after consequent
      this.patchJump(ifOffsetPos, this.buf.length); // conditional jump lands at alternate
      this.compileStmt(stmt.alternate);
      this.patchJump(jumpOffsetPos, this.buf.length); // unconditional jump lands after alternate
    } else {
      this.patchJump(ifOffsetPos, this.buf.length); // conditional jump lands after consequent
    }
  }

  private compileWhileStmt(stmt: WhileStmt): void {
    const loopStart = this.buf.length;
    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);

    this.compileExpr(stmt.test);
    this.emit(0x12); // ActionNot
    const exitJumpPos = this.emitActionIf(); // jump when test was false → exit loop

    this.compileStmt(stmt.body);

    const backJumpPos = this.emitActionJump();
    this.patchJump(backJumpPos, loopStart); // loop back to condition

    const loopEnd = this.buf.length;
    this.patchJump(exitJumpPos, loopEnd);

    this.loopStack.pop();
    for (const p of ctx.breakPatches) this.patchJump(p, loopEnd);
    for (const p of ctx.continuePatches) this.patchJump(p, loopStart);
  }

  private compileDoWhileStmt(stmt: DoWhileStmt): void {
    const loopStart = this.buf.length;
    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);

    this.compileStmt(stmt.body);

    const condStart = this.buf.length; // continue lands here for do-while
    this.compileExpr(stmt.test);
    const backJumpPos = this.emitActionIf(); // if test truthy, loop back
    this.patchJump(backJumpPos, loopStart);

    const loopEnd = this.buf.length;
    this.loopStack.pop();
    for (const p of ctx.breakPatches) this.patchJump(p, loopEnd);
    for (const p of ctx.continuePatches) this.patchJump(p, condStart);
  }

  private compileForVarInit(init: VarDecl | Block): void {
    const decls = init.type === 'VarDecl' ? [init] : init.body as VarDecl[];
    for (const vd of decls) {
      this.pushString(vd.name);
      if (vd.init !== null) {
        this.compileExpr(vd.init);
        this.emit(0x3c); // ActionDefineLocal
      } else {
        this.emit(0x41); // ActionDefineLocal2
      }
    }
  }

  private compileForStmt(stmt: ForStmt): void {
    // Init
    if (stmt.init !== null) {
      if (stmt.init.type === 'VarDecl' || stmt.init.type === 'Block') {
        this.compileForVarInit(stmt.init);
      } else {
        // ExprStmt init
        this.compileExpr((stmt.init as ExprStmt).expression);
        this.emit(0x17); // Pop
      }
    }

    const loopStart = this.buf.length;
    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);

    let exitJumpPos = -1;
    if (stmt.test !== null) {
      this.compileExpr(stmt.test);
      this.emit(0x12); // ActionNot
      exitJumpPos = this.emitActionIf(); // exit when test is false
    }

    this.compileStmt(stmt.body);

    const updateStart = this.buf.length; // continue lands here
    if (stmt.update !== null) {
      this.compileExpr(stmt.update);
      this.emit(0x17); // Pop
    }

    const backJumpPos = this.emitActionJump();
    this.patchJump(backJumpPos, loopStart);

    const loopEnd = this.buf.length;
    if (exitJumpPos !== -1) this.patchJump(exitJumpPos, loopEnd);

    this.loopStack.pop();
    for (const p of ctx.breakPatches) this.patchJump(p, loopEnd);
    for (const p of ctx.continuePatches) this.patchJump(p, updateStart);
  }

  private compileForInStmt(stmt: ForInStmt): void {
    // Get the variable name to assign each key to
    const left = stmt.left;
    const varName = left.type === 'VarDecl' ? (left as VarDecl).name : (left as Identifier).name;

    // If it's a var declaration, define the local variable first (initialized to undefined)
    if (left.type === 'VarDecl') {
      this.pushString(varName);
      this.emit(0x41); // ActionDefineLocal2 — defines local with undefined value
    }

    // Push the object to enumerate
    this.compileExpr(stmt.right);

    // ActionEnumerate2 (0x55): pops object, pushes all enumerable keys onto the stack,
    // then pushes undefined as the sentinel on top.
    // Stack after: [..., keyN, ..., key1, undefined(top)]
    this.emit(0x55); // ActionEnumerate2

    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);

    // loop_top: check top of stack — undefined means we're done, otherwise it's a key
    const loopTop = this.buf.length;

    // Duplicate top to test without consuming the actual key
    this.emit(0x4c); // ActionDuplicate — stack: [..., key, key_dup]

    // Push undefined to compare against
    this.pushUndefined(); // stack: [..., key, key_dup, undefined]

    // ActionEquals2 (0x49): pops two values, pushes true if equal
    this.emit(0x49); // stack: [..., key, (key_dup == undefined)]

    // If equal to undefined, exit the loop (ActionIf jumps when truthy)
    const exitJumpPos = this.emitActionIf();

    // Not undefined: the duplicate was consumed by ActionEquals2; the original key is on top.
    // Assign it to the loop variable. ActionSetVariable needs [name, value] with name below value.
    this.pushString(varName); // stack: [..., key, varName]
    this.emit(0x4d);          // ActionStackSwap → [..., varName, key]
    this.emit(0x1d);          // ActionSetVariable → pops key (value) and varName (name), key popped from stack

    // Compile body
    this.compileStmt(stmt.body);

    // continue patches land here — jump back to top of loop
    const continueTarget = this.buf.length;
    const backJumpPos = this.emitActionJump();
    this.patchJump(backJumpPos, loopTop);

    // Natural exit: the undefined sentinel is on top of the stack (the Dup+Equals2+ActionIf
    // consumed the dup but left the original sentinel in place).
    const loopEnd = this.buf.length;
    this.patchJump(exitJumpPos, loopEnd);
    // Pop the undefined sentinel that caused us to exit.
    this.emit(0x17); // ActionPop
    // Jump over the break drain loop.
    const skipDrainPos = this.emitActionJump();

    // Break drain loop: break exits early leaving N remaining keys + the undefined
    // sentinel on the stack.  Drain keys one by one until we see undefined, then
    // pop the sentinel too.
    //
    // drainTop:
    //   ActionDup
    //   pushUndefined
    //   ActionEquals2          ; is top === undefined?
    //   ActionIf drainDone     ; yes → exit drain loop (sentinel still on stack)
    //   ActionPop              ; no  → pop this key
    //   ActionJump drainTop
    // drainDone:
    //   ActionPop              ; pop the undefined sentinel
    const drainTop = this.buf.length;
    this.emit(0x4c);            // ActionDuplicate
    this.pushUndefined();
    this.emit(0x49);            // ActionEquals2
    const drainDonePos = this.emitActionIf();
    this.emit(0x17);            // ActionPop (discard the non-undefined key)
    const drainBackPos = this.emitActionJump();
    this.patchJump(drainBackPos, drainTop);

    const drainDone = this.buf.length;
    this.patchJump(drainDonePos, drainDone);
    this.emit(0x17);            // ActionPop (discard the undefined sentinel)

    // afterCleanup: both the natural-exit path and the break-drain path land here.
    const afterCleanup = this.buf.length;
    this.patchJump(skipDrainPos, afterCleanup);

    this.loopStack.pop();
    // Break patches land at the drain loop entry, not at loopEnd.
    for (const p of ctx.breakPatches) this.patchJump(p, drainTop);
    for (const p of ctx.continuePatches) this.patchJump(p, continueTarget);
  }

  // ---- Switch/case ---------------------------------------------------------

  /**
   * Compile switch(discriminant) { case v: stmts... default: stmts... }
   *
   * Strategy: duplicate-and-compare pattern.
   *   1. Push discriminant value once.
   *   2. For each non-default case:
   *        ActionDuplicate   - copy discriminant
   *        push case value
   *        ActionEquals2     - strict compare
   *        ActionNot         - invert so we jump past body when NOT equal
   *        ActionIf(next)    - skip body when not equal
   *        ActionPop         - discard dup when we matched
   *        <case body>       - break compiles as ActionJump(end)
   *        ActionJump(end)   - fall-through guard (overridden by explicit break)
   *   3. Default case (if any): just ActionPop + body (no comparison needed)
   *   4. If no default, ActionPop then fall through to end.
   *
   * `break` inside switch uses the same loopStack mechanism as loops.
   */
  /**
   * Returns true if the statement list clearly ends with an unconditional
   * transfer (break, continue, return, throw) so that fall-through cannot
   * reach the next case.  Conservative: if the list is empty or the last
   * statement is anything other than those four forms, we assume fall-through
   * is possible.
   */
  private static caseEndsWithTransfer(stmts: Statement[]): boolean {
    if (stmts.length === 0) return false;
    const last = stmts[stmts.length - 1];
    return (
      last.type === 'BreakStmt' ||
      last.type === 'ContinueStmt' ||
      last.type === 'ReturnStmt' ||
      last.type === 'ThrowStmt'
    );
  }

  private compileSwitchStmt(stmt: SwitchStmt): void {
    // Push discriminant once — stays on stack throughout all case comparisons
    this.compileExpr(stmt.discriminant);

    // Set up break context (continue has no meaning inside switch)
    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);

    // AVM1 switch layout (cases emitted in SOURCE ORDER):
    //
    //   <discriminant>
    //
    //   comparison_block_N:          ← prevSkipPatch from case N-1 lands here
    //     ActionDuplicate            ; copy discriminant (original D stays on stack)
    //     PUSH case_value
    //     ActionStrictEquals
    //     ActionNot                  ; invert: truthy when NOT equal
    //     ActionIf(comparison_block_N+1)  ← prevSkipPatch
    //   bodyStart_N:                 ← match-path falls through to here
    //     ActionPop                  ; pop original discriminant (dup was consumed)
    //   stmtStart_N:                 ← fall-through jumps from case N-1 land here
    //     <case body>
    //     [ActionJump(end)]          ; explicit break
    //     [ActionJump(stmtStart_N+1)]; fall-through: jump PAST next item's comparison
    //                                ;   AND ActionPop (discriminant already consumed)
    //
    //   For the `default` case (wherever it appears in source order):
    //   defaultPop:                  ← no-match path jump lands here (may be backward)
    //     ActionPop                  ; discard discriminant (no-match path only)
    //   defaultStmtStart:            ← fall-through jumps from previous case land here
    //     <default body>
    //     [ActionJump(stmtStart_next)]; fall-through to next source-order case
    //
    //   switchEnd:                   ← break patches, fall-through from last case
    //
    // Key: default body is emitted at its SOURCE POSITION so that fall-through
    // semantics are correct when default appears between other cases.  The
    // "no match → default" dispatch is a backward jump when default precedes
    // value cases that follow it (patched at the end of the case loop).

    // prevSkipPatch: offset-field pos of the ActionIf that skips to the next
    //   comparison block when the current case does NOT match.
    let prevSkipPatch: number | null = null;

    // prevFallThroughPatches: offset-field positions of ActionJump instructions
    //   at the END of the PREVIOUS case body that need to jump to THIS case's
    //   body start (right after ActionPop).  Populated only when a case falls
    //   through (i.e., its last statement is not a transfer).
    let prevFallThroughPatches: number[] = [];

    // defaultPopOffset: byte position of the ActionPop that heads the default body
    //   (the entry point for the no-match path, which still has the discriminant on
    //   the stack).  Set when the default case is encountered; null if no default.
    let defaultPopOffset: number | null = null;

    for (const c of stmt.cases) {
      if (c.test !== null) {
        // ---- Value case: Comparison block ------------------------------------

        // Patch the previous case's skip-jump to land here (start of this DUP)
        if (prevSkipPatch !== null) {
          this.patchJump(prevSkipPatch, this.buf.length);
        }

        // Duplicate the discriminant
        this.emit(0x4c); // ActionDuplicate

        // Push case test value
        this.compileExpr(c.test);

        // ActionStrictEquals (0x66) — strict equality (JS switch uses ===)
        this.emit(0x66);

        // ActionNot — invert so ActionIf jumps when NOT equal
        this.emit(0x12); // ActionNot

        // ActionIf — jump to next comparison when not equal
        prevSkipPatch = this.emitActionIf();

        // ---- Body block ------------------------------------------------------

        // body_N starts HERE (after comparison) — the match-path ActionIf above
        // falls through to here.  Fall-through jumps from the PREVIOUS case body
        // must NOT land here because those come from a path where the discriminant
        // was already popped; landing before this ActionPop would double-pop the
        // stack and corrupt subsequent operations.  We save those patches now and
        // apply them AFTER the ActionPop so they jump to stmtStart instead.
        const prevFallThroughPatchesSaved = prevFallThroughPatches;
        prevFallThroughPatches = [];

        // Matched: pop the original discriminant (the dup was consumed by Equals2)
        this.emit(0x17); // ActionPop

        // stmtStart: first instruction of the case body — fall-through jumps from
        // the previous case land here, bypassing the ActionPop above.
        const stmtStart = this.buf.length;
        for (const p of prevFallThroughPatchesSaved) {
          this.patchJump(p, stmtStart);
        }

        // Compile case body; break emits ActionJump(switchEnd) via loopStack
        this.compileStatements(c.consequent);

        // If the case body does NOT end with an unconditional transfer, it falls
        // through to the next case.  Emit a placeholder ActionJump now; we will
        // patch it to land at the next case's stmtStart once we know that offset.
        if (!Compiler.caseEndsWithTransfer(c.consequent)) {
          prevFallThroughPatches.push(this.emitActionJump());
        }

      } else {
        // ---- Default case: emitted at source position -----------------------
        //
        // The default case has TWO entry points:
        //   1. defaultPop (= this.buf.length right now): the no-match path.
        //      The discriminant is still on the stack here, so we emit ActionPop.
        //   2. defaultStmtStart (after ActionPop): the fall-through path from
        //      the previous source-order case, which already consumed the discriminant.
        //
        // If default is non-trailing (more value cases follow in source), the
        // no-match dispatch (prevSkipPatch after all comparisons) will be patched
        // to defaultPopOffset at the end of the loop — this may be a backward jump.

        defaultPopOffset = this.buf.length;    // no-match path will jump here
        this.emit(0x17);                        // ActionPop — discard discriminant

        // defaultStmtStart: fall-through patches from the previous case land here
        const defaultStmtStart = this.buf.length;
        for (const p of prevFallThroughPatches) {
          this.patchJump(p, defaultStmtStart);
        }
        prevFallThroughPatches = [];

        // Compile default body; break emits ActionJump(switchEnd) via loopStack
        this.compileStatements(c.consequent);

        // If default falls through, emit a placeholder jump so the next
        // source-order case can patch it to its stmtStart.
        if (!Compiler.caseEndsWithTransfer(c.consequent)) {
          prevFallThroughPatches.push(this.emitActionJump());
        }
      }
    }

    // ---- End of cases: resolve the final skip-patch and fall-throughs -------

    if (defaultPopOffset !== null) {
      // A default case was emitted somewhere in source order.
      // The last value-case's skip-jump must reach defaultPop (may be backward
      // if default appeared before the last value case).
      if (prevSkipPatch !== null) {
        this.patchJump(prevSkipPatch, defaultPopOffset);
      }
      // Fall-through patches after the last emitted case body go to switchEnd.
      for (const p of prevFallThroughPatches) {
        ctx.breakPatches.push(p);
      }
    } else {
      // No default case: the no-match path just pops the discriminant and falls
      // through to switchEnd.
      const noMatchPos = this.buf.length;
      if (prevSkipPatch !== null) {
        this.patchJump(prevSkipPatch, noMatchPos);
      }
      this.emit(0x17); // ActionPop — discard discriminant on no-match path

      // Fall-through patches from the last value-case skip the pop above and
      // land directly at switchEnd.
      for (const p of prevFallThroughPatches) {
        ctx.breakPatches.push(p);
      }
    }

    // End of switch — patch all breaks
    const switchEnd = this.buf.length;
    this.loopStack.pop();
    for (const p of ctx.breakPatches) this.patchJump(p, switchEnd);
  }

  // ---- Throw ---------------------------------------------------------------

  private compileThrowStmt(stmt: ThrowStmt): void {
    this.compileExpr(stmt.value);
    this.emit(0x2a); // ActionThrow
  }

  // ---- Try/catch/finally ---------------------------------------------------

  /**
   * Compile try/catch/finally using ActionTry (0x8F).
   *
   * ActionTry record format (SWF spec):
   *   opcode:        0x8F (1 byte)
   *   length:        UI16 — size of everything after this field
   *   flags:         UI8
   *     bit 0: HasCatchBlock  (1 if catch present)
   *     bit 1: HasFinallyBlock (1 if finally present)
   *     bit 2: CatchInRegister (0 = named variable, 1 = register)
   *   [if HasCatch && !CatchInRegister]: CatchName  null-terminated string
   *   [if HasCatch && CatchInRegister]:  CatchRegister UI8
   *   TrySize:     UI16
   *   CatchSize:   UI16
   *   FinallySize: UI16
   *   TryBody:     <TrySize bytes>
   *   CatchBody:   <CatchSize bytes>   (0 bytes if no catch)
   *   FinallyBody: <FinallySize bytes> (0 bytes if no finally)
   */
  /**
   * Snapshot the current lengths of all break/continue patch arrays on every
   * live LoopContext so we can identify which entries were newly added by a
   * sub-compiler.
   */
  private snapshotPatchCounts(): Array<{ breakLen: number; continueLen: number }> {
    return this.loopStack.map(ctx => ({
      breakLen:    ctx.breakPatches.length,
      continueLen: ctx.continuePatches.length,
    }));
  }

  /**
   * After a sub-compiler has run and its bytes are about to be appended to this
   * (parent) buffer starting at byte `parentBase`, rebase all newly added patch
   * positions in the shared loopStack from sub-compiler-relative to parent-relative.
   *
   * `snapshot` must be the value returned by `snapshotPatchCounts()` taken
   * immediately before the sub-compiler ran.
   */
  private rebasePatchOffsets(
    snapshot: Array<{ breakLen: number; continueLen: number }>,
    parentBase: number,
  ): void {
    for (let i = 0; i < this.loopStack.length; i++) {
      const ctx  = this.loopStack[i];
      const snap = snapshot[i];
      if (!snap) continue; // defensive: stack grew inside sub-compiler (shouldn't happen)
      for (let j = snap.breakLen; j < ctx.breakPatches.length; j++) {
        ctx.breakPatches[j] += parentBase;
      }
      for (let j = snap.continueLen; j < ctx.continuePatches.length; j++) {
        ctx.continuePatches[j] += parentBase;
      }
    }
  }

  private compileTryStmt(stmt: TryStmt): void {
    const hasCatch   = stmt.catchClause !== null;
    const hasFinally = stmt.finallyBlock !== null;

    // Compile bodies into sub-buffers (number[] avoids Uint8Array variance issues).
    //
    // Each sub-compiler shares the parent's loopStack so that break/continue inside
    // a try/catch/finally body can resolve to enclosing loop targets.  However,
    // each sub-compiler has its own `buf` starting at position 0, so any patch
    // positions recorded in the shared loopStack contexts are sub-compiler-relative.
    // We must rebase them to parent-buffer-relative positions after appending the
    // sub-bytes.  `snapshotPatchCounts` + `rebasePatchOffsets` handle this.

    const trySnapshot = this.snapshotPatchCounts();
    const trySubCompiler = new Compiler();
    trySubCompiler.currentSuperClass = this.currentSuperClass;
    trySubCompiler.loopStack = this.loopStack; // share break/continue context
    trySubCompiler.labeledLoops = this.labeledLoops; // share labeled loop context
    trySubCompiler.constantPool = this.constantPool; // inherit parent's constant pool
    trySubCompiler.compileStatements(stmt.body.body);
    const tryBytes: number[] = Array.from(trySubCompiler.buf.getBytes());

    let catchBytes: number[] = [];
    let catchParam = '';
    let catchSnapshot: Array<{ breakLen: number; continueLen: number }> = [];
    if (hasCatch) {
      catchParam = stmt.catchClause!.param;
      catchSnapshot = this.snapshotPatchCounts();
      const catchSubCompiler = new Compiler();
      catchSubCompiler.currentSuperClass = this.currentSuperClass;
      catchSubCompiler.loopStack = this.loopStack;
      catchSubCompiler.labeledLoops = this.labeledLoops;
      catchSubCompiler.constantPool = this.constantPool; // inherit parent's constant pool
      catchSubCompiler.compileStatements(stmt.catchClause!.body.body);
      catchBytes = Array.from(catchSubCompiler.buf.getBytes());
    }

    let finallyBytes: number[] = [];
    let finallySnapshot: Array<{ breakLen: number; continueLen: number }> = [];
    if (hasFinally) {
      finallySnapshot = this.snapshotPatchCounts();
      const finallySubCompiler = new Compiler();
      finallySubCompiler.currentSuperClass = this.currentSuperClass;
      finallySubCompiler.loopStack = this.loopStack;
      finallySubCompiler.labeledLoops = this.labeledLoops;
      finallySubCompiler.constantPool = this.constantPool; // inherit parent's constant pool
      finallySubCompiler.compileStatements(stmt.finallyBlock!.body);
      finallyBytes = Array.from(finallySubCompiler.buf.getBytes());
    }

    // Build flags byte
    let flags = 0;
    if (hasCatch)   flags |= 0x01; // HasCatchBlock
    if (hasFinally) flags |= 0x02; // HasFinallyBlock
    // bit 2 (CatchInRegister) = 0: use named variable

    // Encode catch name if present (number[] to avoid Uint8Array variance)
    const catchNameArr: number[] = hasCatch
      ? Array.from(new TextEncoder().encode(catchParam))
      : [];

    // Compute payload length:
    // flags(1) + TrySize(2) + CatchSize(2) + FinallySize(2) + catchName(N+1)
    //
    // The try/catch/finally BODIES follow the record and are NOT included in
    // the action's declared length (per the SWF spec and Ruffle's read_try,
    // which adds try+catch+finally sizes to the action length after parsing
    // the header). Including them desynchronizes the action stream.
    //
    // NOTE: Ruffle's read_try() unconditionally calls read_str() for catch_var
    // regardless of HasCatchBlock (ruffle/swf/src/avm1/read.rs:370-374).
    // We must always emit at least a null byte for catch_var or read_str()
    // consumes bytes from TryBody, corrupting the finally body.
    const catchNameFieldLen = hasCatch ? catchNameArr.length + 1 : 1; // always >= 1
    const payloadLen =
      1 +                 // flags
      2 +                 // TrySize
      2 +                 // CatchSize
      2 +                 // FinallySize
      catchNameFieldLen;  // catch name (null-terminated); always >= 1 null byte

    // Emit the record
    this.buf.write(0x8f); // ActionTry opcode
    this.buf.writeUI16(payloadLen);

    // flags
    this.buf.write(flags);

    // TrySize, CatchSize, FinallySize — BEFORE the catch name (field order per
    // the SWF spec / Ruffle's read_try: flags, sizes, then catch var).
    this.buf.writeUI16(tryBytes.length);
    this.buf.writeUI16(catchBytes.length);
    this.buf.writeUI16(finallyBytes.length);

    // CatchName (null-terminated) — always emitted because Ruffle's read_try()
    // unconditionally calls read_str() for catch_var regardless of HasCatchBlock.
    // When there is no catch, emit just a null byte (empty string "").
    if (hasCatch) {
      for (const b of catchNameArr) this.buf.write(b);
    }
    this.buf.write(0); // null terminator (always present)

    // Bodies — write byte-by-byte from number arrays.
    // Rebase break/continue patch positions collected during sub-compilation from
    // sub-compiler-relative (buf starts at 0) to parent-buffer-relative offsets.
    const tryBase = this.buf.length;
    for (const b of tryBytes) this.buf.write(b);
    this.rebasePatchOffsets(trySnapshot, tryBase);

    if (hasCatch && catchSnapshot.length > 0) {
      const catchBase = this.buf.length;
      for (const b of catchBytes) this.buf.write(b);
      this.rebasePatchOffsets(catchSnapshot, catchBase);
    } else {
      for (const b of catchBytes) this.buf.write(b);
    }

    if (hasFinally && finallySnapshot.length > 0) {
      const finallyBase = this.buf.length;
      for (const b of finallyBytes) this.buf.write(b);
      this.rebasePatchOffsets(finallySnapshot, finallyBase);
    } else {
      for (const b of finallyBytes) this.buf.write(b);
    }
  }

  // ---- With statement ------------------------------------------------------

  /**
   * Compile a with(object) { body } statement.
   *
   * ActionWith (0x94) pushes an object onto the scope chain.
   * All variable lookups inside the with block automatically check this object first.
   *
   * Record format:
   *   opcode  (1 byte): 0x94
   *   length  (UI16):   2  (size of the size field)
   *   size    (UI16):   byte length of the compiled body
   *   <body>
   */
  private compileWithStmt(stmt: WithStmt): void {
    // 1. Compile the object expression (leaves it on stack)
    this.compileExpr(stmt.object);

    // 2. Emit ActionWith header with placeholder size
    this.buf.write(0x94);          // ActionWith opcode
    this.buf.writeUI16(2);         // record payload length = 2 (just the size field)
    const sizeOffset = this.buf.length;
    this.buf.writeUI16(0);         // placeholder size (will be back-patched)

    // 3. Compile body
    const bodyStart = this.buf.length;
    this.compileStmt(stmt.body);
    const bodyLen = this.buf.length - bodyStart;

    // 4. Back-patch the size field
    this.buf.patchUI16(sizeOffset, bodyLen);
  }

  // ---- Labeled statement ---------------------------------------------------

  /**
   * Compile a labeled statement: label: <loop-statement>
   *
   * Registers the label in labeledLoops so that `break label` and `continue label`
   * can jump to the correct targets. Only loop statements (for/while/do-while/for-in)
   * benefit from labeling; for non-loop bodies the label is compiled as a no-op.
   */
  private compileLabeledStmt(stmt: LabeledStmt): void {
    const body = stmt.body;
    const isLoop =
      body.type === 'ForStmt' ||
      body.type === 'WhileStmt' ||
      body.type === 'DoWhileStmt' ||
      body.type === 'ForInStmt';

    if (isLoop) {
      // Create a loop context for this label and register it BEFORE compiling the
      // body so that break/continue can reference it. The loop compilers push their
      // own ctx onto loopStack — we create a SEPARATE ctx for label resolution.
      // After the loop is compiled we patch all jumps recorded in labelCtx.
      //
      // The trick: we intercept the loop compilation by temporarily registering a
      // ctx in labeledLoops. The loop compiler pushes its own ctx onto loopStack,
      // and we share the same ctx object so that break/continue recorded by either
      // mechanism point to the same patch list.
      //
      // Implementation: compile the loop normally — the loop methods will push their
      // own ctx. After compilation, patching is already done by the loop methods.
      // For labeled break/continue we need the ctx to be the SAME object as the one
      // pushed by the loop method. So we install a pre-created ctx, and make the loop
      // methods use it. The cleanest approach is: install the labeled ctx in
      // labeledLoops before compilation, then have the loop method use the same ctx.
      //
      // Simpler approach: compile the loop body with a special hook. Instead, we
      // pre-register a ctx, compile the statement, then check if it was used.
      // Since the loop methods create their own LoopContext, we need to ensure
      // labeled break/continue go to the same place as unlabeled ones.
      //
      // Actual approach: before compilation, add a sentinel ctx to labeledLoops.
      // After compilation, the loop method will have patched its own ctx. The labeled
      // ctx may be empty or may have entries from labeled break/continue.
      // We patch the labeled ctx's entries with the same targets the loop used.
      //
      // Cleanest: We override the loop compilation to reuse the labeled ctx.
      this.compileLabeledLoop(stmt.label, body);
    } else {
      // For non-loop labeled statements, just compile the body.
      // Labeled break targeting a non-loop is treated as a jump to end of body.
      const labelCtx: LoopContext = { breakPatches: [], continuePatches: [] };
      this.labeledLoops.set(stmt.label, labelCtx);
      this.compileStmt(body);
      const afterBody = this.buf.length;
      this.labeledLoops.delete(stmt.label);
      for (const p of labelCtx.breakPatches) this.patchJump(p, afterBody);
      // continue on non-loop: just patch to after body as well (fallback)
      for (const p of labelCtx.continuePatches) this.patchJump(p, afterBody);
    }
  }

  /**
   * Compile a labeled loop. Creates a shared LoopContext that is registered both
   * in labeledLoops (for labeled break/continue) and pushed onto loopStack (for
   * the loop compilation itself), so all break/continue patches go to the same ctx.
   */
  private compileLabeledLoop(label: string, stmt: Statement): void {
    // We directly implement the loop compilation here with a shared ctx approach.
    // The loop-type-specific compile methods create their own ctx — to share it,
    // we compile the loop inline with pre-registered ctx.
    switch (stmt.type) {
      case 'ForStmt':    this.compileLabeledForStmt(label, stmt as ForStmt);    break;
      case 'WhileStmt':  this.compileLabeledWhileStmt(label, stmt as WhileStmt); break;
      case 'DoWhileStmt': this.compileLabeledDoWhileStmt(label, stmt as DoWhileStmt); break;
      case 'ForInStmt':  this.compileLabeledForInStmt(label, stmt as ForInStmt); break;
      default:           this.compileStmt(stmt); break;
    }
  }

  private compileLabeledWhileStmt(label: string, stmt: WhileStmt): void {
    const loopStart = this.buf.length;
    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);
    this.labeledLoops.set(label, ctx);

    this.compileExpr(stmt.test);
    this.emit(0x12); // ActionNot
    const exitJumpPos = this.emitActionIf();

    this.compileStmt(stmt.body);

    const backJumpPos = this.emitActionJump();
    this.patchJump(backJumpPos, loopStart);

    const loopEnd = this.buf.length;
    this.patchJump(exitJumpPos, loopEnd);

    this.loopStack.pop();
    this.labeledLoops.delete(label);
    for (const p of ctx.breakPatches) this.patchJump(p, loopEnd);
    for (const p of ctx.continuePatches) this.patchJump(p, loopStart);
  }

  private compileLabeledDoWhileStmt(label: string, stmt: DoWhileStmt): void {
    const loopStart = this.buf.length;
    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);
    this.labeledLoops.set(label, ctx);

    this.compileStmt(stmt.body);

    const condStart = this.buf.length;
    this.compileExpr(stmt.test);
    const backJumpPos = this.emitActionIf();
    this.patchJump(backJumpPos, loopStart);

    const loopEnd = this.buf.length;
    this.loopStack.pop();
    this.labeledLoops.delete(label);
    for (const p of ctx.breakPatches) this.patchJump(p, loopEnd);
    for (const p of ctx.continuePatches) this.patchJump(p, condStart);
  }

  private compileLabeledForStmt(label: string, stmt: ForStmt): void {
    // Init
    if (stmt.init !== null) {
      if (stmt.init.type === 'VarDecl' || stmt.init.type === 'Block') {
        this.compileForVarInit(stmt.init);
      } else {
        this.compileExpr((stmt.init as ExprStmt).expression);
        this.emit(0x17);
      }
    }

    const loopStart = this.buf.length;
    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);
    this.labeledLoops.set(label, ctx);

    let exitJumpPos = -1;
    if (stmt.test !== null) {
      this.compileExpr(stmt.test);
      this.emit(0x12); // ActionNot
      exitJumpPos = this.emitActionIf();
    }

    this.compileStmt(stmt.body);

    const updateStart = this.buf.length;
    if (stmt.update !== null) {
      this.compileExpr(stmt.update);
      this.emit(0x17);
    }

    const backJumpPos = this.emitActionJump();
    this.patchJump(backJumpPos, loopStart);

    const loopEnd = this.buf.length;
    if (exitJumpPos !== -1) this.patchJump(exitJumpPos, loopEnd);

    this.loopStack.pop();
    this.labeledLoops.delete(label);
    for (const p of ctx.breakPatches) this.patchJump(p, loopEnd);
    for (const p of ctx.continuePatches) this.patchJump(p, updateStart);
  }

  private compileLabeledForInStmt(label: string, stmt: ForInStmt): void {
    const left = stmt.left;
    const varName = left.type === 'VarDecl' ? (left as VarDecl).name : (left as Identifier).name;

    if (left.type === 'VarDecl') {
      this.pushString(varName);
      this.emit(0x41);
    }

    this.compileExpr(stmt.right);
    this.emit(0x55); // ActionEnumerate2

    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);
    this.labeledLoops.set(label, ctx);

    const loopTop = this.buf.length;
    this.emit(0x4c); // ActionDuplicate
    this.pushUndefined();
    this.emit(0x49); // ActionEquals2
    const exitJumpPos = this.emitActionIf();

    this.pushString(varName);
    this.emit(0x4d); // ActionStackSwap
    this.emit(0x1d); // ActionSetVariable

    this.compileStmt(stmt.body);

    const continueTarget = this.buf.length;
    const backJumpPos = this.emitActionJump();
    this.patchJump(backJumpPos, loopTop);

    // Natural exit: undefined sentinel is on top of the stack.
    const loopEnd = this.buf.length;
    this.patchJump(exitJumpPos, loopEnd);
    this.emit(0x17); // ActionPop — pop the undefined sentinel
    // Jump over the break drain loop.
    const skipDrainPos = this.emitActionJump();

    // Break drain loop: drain remaining keys + undefined sentinel from the stack.
    const drainTop = this.buf.length;
    this.emit(0x4c);            // ActionDuplicate
    this.pushUndefined();
    this.emit(0x49);            // ActionEquals2
    const drainDonePos = this.emitActionIf();
    this.emit(0x17);            // ActionPop (discard the non-undefined key)
    const drainBackPos = this.emitActionJump();
    this.patchJump(drainBackPos, drainTop);

    const drainDone = this.buf.length;
    this.patchJump(drainDonePos, drainDone);
    this.emit(0x17);            // ActionPop (discard the undefined sentinel)

    const afterCleanup = this.buf.length;
    this.patchJump(skipDrainPos, afterCleanup);

    this.loopStack.pop();
    this.labeledLoops.delete(label);
    // Break patches land at the drain loop entry.
    for (const p of ctx.breakPatches) this.patchJump(p, drainTop);
    for (const p of ctx.continuePatches) this.patchJump(p, continueTarget);
  }

  // ---- Expression compilation ----------------------------------------------

  private compileExpr(expr: Expression): void {
    switch (expr.type) {
      case 'Literal':       this.compileLiteral(expr);       break;
      case 'Identifier':    this.compileIdentifier(expr);    break;
      case 'AssignExpr':    this.compileAssignExpr(expr);    break;
      case 'BinaryExpr':    this.compileBinaryExpr(expr);    break;
      case 'UnaryExpr':     this.compileUnaryExpr(expr);     break;
      case 'CallExpr':      this.compileCallExpr(expr);      break;
      case 'NewExpr':       this.compileNewExpr(expr);       break;
      case 'MemberExpr':    this.compileMemberExpr(expr);    break;
      case 'IndexExpr':     this.compileIndexExpr(expr);     break;
      case 'TernaryExpr':   this.compileTernaryExpr(expr);   break;
      case 'SequenceExpr':  this.compileSequenceExpr(expr);  break;
      case 'ArrayLiteral':  this.compileArrayLiteral(expr);  break;
      case 'ObjectLiteral': this.compileObjectLiteral(expr); break;
      case 'RegExpLiteral': this.compileRegExpLiteral(expr as RegExpLiteral); break;
      case 'FunctionDecl':
        // Function expression — compile as anonymous function value
        this.compileFunctionExpr(expr as FunctionDecl);
        break;
      default:
        throw new Error(`Unsupported expression node type: ${(expr as any).kind ?? JSON.stringify(expr)}`);

    }
  }

  private compileLiteral(expr: Literal): void {
    const v = expr.value;
    if (v === null) {
      this.pushNull();
    } else if (typeof v === 'string') {
      this.pushString(v);
    } else if (typeof v === 'boolean') {
      this.pushBool(v);
    } else if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) {
        this.pushInt(v);
      } else {
        this.pushNumber(v);
      }
    } else {
      this.pushUndefined();
    }
  }

  /**
   * Compile a RegExp literal `/pattern/flags` to:
   *   ActionPush flags           (if non-empty, deepest arg)
   *   ActionPush pattern         (arg[0], just below nArgs)
   *   ActionPush argCount (1 or 2)
   *   ActionPush "RegExp"        (className on top — first popped by ActionNewObject)
   *   ActionNewObject            (0x40)  — new RegExp(pattern[, flags])
   *
   * Stack layout for ActionNewObject (0x40): className on TOP, then nArgs, then args.
   * (deepest = last arg, className on top — matches compileNewExpr push order)
   */
  private compileRegExpLiteral(expr: RegExpLiteral): void {
    const argCount = expr.flags.length > 0 ? 2 : 1;

    // args deepest-first: arg[n-1] pushed first (deepest), arg[0] just below nArgs
    if (expr.flags.length > 0) {
      // arg[1] = flags (deepest — pushed first)
      this.pushString(expr.flags);
    }
    // arg[0] = pattern
    this.pushString(expr.pattern);

    // nArgs
    this.pushInt(argCount);

    // className LAST (on top — first popped by ActionNewObject)
    this.pushString('RegExp');

    this.emit(0x40); // ActionNewObject
  }

  private compileIdentifier(expr: Identifier): void {
    // Well-known constants that map directly to push values
    switch (expr.name) {
      case 'undefined': this.pushUndefined();      return;
      case 'null':      this.pushNull();            return;
      case 'true':      this.pushBool(true);        return;
      case 'false':     this.pushBool(false);       return;
      case 'NaN':       this.pushNumber(NaN);       return;
      case 'Infinity':  this.pushNumber(Infinity);  return;
      // AVM1 global constant: newline === "\r" (carriage return)
      case 'newline':   this.pushString('\r');      return;
      case 'super':
        // In AVM1, 'super' resolves to the superclass constructor.
        // If we know the current superclass, use it; otherwise fall back to variable lookup.
        if (this.currentSuperClass !== null) {
          this.pushString(this.currentSuperClass);
          this.emit(0x1c); // ActionGetVariable → SuperClass
          return;
        }
        break;
    }
    this.pushString(expr.name);
    this.emit(0x1c); // ActionGetVariable
  }

  private compileAssignExpr(expr: AssignExpr): void {
    const op = expr.operator;

    // Helper: save TOS to register 0 without popping, then after the Set action
    // restore it so the assigned value remains as the expression result.
    //
    // Why StoreRegister instead of ActionDuplicate (0x4c)?
    //   ActionDuplicate copies TOS, giving stack [..., name_or_obj, value, value].
    //   SetVariable then pops the top value as the VALUE and the second value as
    //   the VARIABLE NAME — but that second value is the duplicate of the rhs, not
    //   the name string, so the wrong variable gets set and the original name is
    //   orphaned on the stack.  SetMember has the same problem: the dup ends up
    //   where the property name should be.
    //   StoreRegister saves TOS into r0 without altering the stack, so
    //   SetVariable/SetMember still see the correct [name, value] / [obj, name, value]
    //   layout, and we Push(r0) afterwards to restore the result.

    if (expr.left.type === 'MemberExpr') {
      const member = expr.left as MemberExpr;
      if (op === '=') {
        // ActionSetMember: stack = [... obj name value] (obj deepest, value on top)
        this.compileExpr(member.object);
        this.pushString(member.property);
        this.compileExpr(expr.right);
        // Save value to r0 before SetMember consumes it, then restore as result.
        this.emitWithPayload(0x87, [0]);     // ActionStoreRegister r0 (no pop)
        this.emit(0x4f);                     // ActionSetMember (pops value, name, obj)
        this.emitWithPayload(0x96, [4, 0]);  // ActionPush register r0 → expression result
      } else {
        // Compound member assignment: obj.prop OP= rhs
        //   obj name           (for SetMember)
        //   obj name           (for GetMember)
        //   GetMember          → current value
        //   rhs, arith op      → result
        //   StoreRegister r0   → save result (no pop)
        //   SetMember          (pops result, name, obj)
        //   Push r0            → expression result
        // The object expression is evaluated twice — acceptable for the
        // common `mc._x += dx` / `_root.score.text += s` shapes.
        const arithOp = op.slice(0, -1); // strip trailing '='
        this.compileExpr(member.object);
        this.pushString(member.property);
        this.compileExpr(member.object);
        this.pushString(member.property);
        this.emit(0x4e);                     // ActionGetMember → current value
        this.compileExpr(expr.right);
        this.emitArithOp(arithOp);           // result on top of stack
        this.emitWithPayload(0x87, [0]);     // ActionStoreRegister r0 (no pop)
        this.emit(0x4f);                     // ActionSetMember (pops result, name, obj)
        this.emitWithPayload(0x96, [4, 0]);  // ActionPush register r0 → expression result
      }
      return;
    }

    if (expr.left.type === 'IndexExpr') {
      const idx = expr.left as IndexExpr;
      if (op === '=') {
        // ActionSetMember also works for indexed access
        this.compileExpr(idx.object);
        this.compileExpr(idx.index);
        this.compileExpr(expr.right);
        this.emitWithPayload(0x87, [0]);     // ActionStoreRegister r0 (no pop)
        this.emit(0x4f);                     // ActionSetMember (pops value, index, obj)
        this.emitWithPayload(0x96, [4, 0]);  // ActionPush register r0 → expression result
      } else {
        // Compound indexed assignment: obj[i] OP= rhs (same shape as member above)
        const arithOp = op.slice(0, -1);
        this.compileExpr(idx.object);
        this.compileExpr(idx.index);
        this.compileExpr(idx.object);
        this.compileExpr(idx.index);
        this.emit(0x4e);                     // ActionGetMember → current value
        this.compileExpr(expr.right);
        this.emitArithOp(arithOp);           // result on top of stack
        this.emitWithPayload(0x87, [0]);     // ActionStoreRegister r0 (no pop)
        this.emit(0x4f);                     // ActionSetMember (pops result, index, obj)
        this.emitWithPayload(0x96, [4, 0]);  // ActionPush register r0 → expression result
      }
      return;
    }

    if (expr.left.type === 'Identifier') {
      const name = (expr.left as Identifier).name;
      if (op === '=') {
        // ActionSetVariable: stack = [... name value] (name below value)
        // StoreRegister saves the value (TOS) to r0 before SetVariable consumes
        // both name and value; Push(r0) restores it as the expression result.
        this.pushString(name);
        this.compileExpr(expr.right);
        this.emitWithPayload(0x87, [0]);     // ActionStoreRegister r0 (no pop)
        this.emit(0x1d);                     // ActionSetVariable (pops value then name)
        this.emitWithPayload(0x96, [4, 0]);  // ActionPush register r0 → expression result
      } else {
        // Compound: name OP= rhs
        // Stack layout at SetVariable: [name, result] (name below, result on TOS)
        // StoreRegister saves result to r0 while SetVariable can still see [name, result].
        const arithOp = op.slice(0, -1); // strip trailing '='
        this.pushString(name);           // name for SetVariable
        this.pushString(name);
        this.emit(0x1c);                 // ActionGetVariable → current value
        this.compileExpr(expr.right);    // rhs
        this.emitArithOp(arithOp);       // result on top of stack → [name, result]
        this.emitWithPayload(0x87, [0]); // ActionStoreRegister r0 (no pop)
        this.emit(0x1d);                 // ActionSetVariable (pops result then name)
        this.emitWithPayload(0x96, [4, 0]); // ActionPush register r0 → expression result
      }
      return;
    }

    // Fallback — just evaluate rhs
    this.compileExpr(expr.right);
  }

  /** Emit the arithmetic/bitwise opcode for a binary operator string. */
  private emitArithOp(op: string): void {
    switch (op) {
      case '+':   this.emit(0x47); break; // ActionAdd2
      case '-':   this.emit(0x0b); break; // ActionSubtract
      case '*':   this.emit(0x0c); break; // ActionMultiply
      case '/':   this.emit(0x0d); break; // ActionDivide
      case '%':   this.emit(0x3f); break; // ActionModulo
      case '&':   this.emit(0x60); break; // ActionBitAnd
      case '|':   this.emit(0x61); break; // ActionBitOr
      case '^':   this.emit(0x62); break; // ActionBitXor
      case '<<':  this.emit(0x63); break; // ActionBitLShift
      case '>>':  this.emit(0x64); break; // ActionBitRShift
      case '>>>': this.emit(0x65); break; // ActionBitURShift
      default:    throw new Error(`Unsupported compound-assignment operator: ${op}`);
    }
  }

  private compileBinaryExpr(expr: BinaryExpr): void {
    const op = expr.operator;

    // Short-circuit operators must not pre-evaluate both sides
    if (op === '&&') { this.compileShortCircuitAnd(expr); return; }
    if (op === '||') { this.compileShortCircuitOr(expr);  return; }

    // 'in' operator: key in obj → typeof(obj[key]) !== "undefined"
    // AVM1 has no ActionIn opcode. We probe via GetMember and check the result
    // type. This correctly handles inherited prototype properties (unlike
    // hasOwnProperty). Limitation: returns false when the property value IS
    // undefined, but that is an acceptable AVM1 approximation.
    // Stack for ActionGetMember (0x4e): top = property name, next = object.
    if (op === 'in') {
      this.compileExpr(expr.right);  // push obj
      this.compileExpr(expr.left);   // push key (top)
      this.emit(0x4e);               // ActionGetMember → property value (or undefined)
      this.emit(0x44);               // ActionTypeOf → type string
      this.pushString('undefined');  // push "undefined" for comparison
      this.emit(0x49);               // ActionEquals2 → true if type == "undefined"
      this.emit(0x12);               // ActionNot → true if property EXISTS
      return;
    }

    this.compileExpr(expr.left);
    this.compileExpr(expr.right);

    switch (op) {
      case '+':   this.emit(0x47); break; // ActionAdd2
      case '-':   this.emit(0x0b); break; // ActionSubtract
      case '*':   this.emit(0x0c); break; // ActionMultiply
      case '/':   this.emit(0x0d); break; // ActionDivide
      case '%':   this.emit(0x3f); break; // ActionModulo
      case '&':   this.emit(0x60); break; // ActionBitAnd
      case '|':   this.emit(0x61); break; // ActionBitOr
      case '^':   this.emit(0x62); break; // ActionBitXor
      case '<<':  this.emit(0x63); break; // ActionBitLShift
      case '>>':  this.emit(0x64); break; // ActionBitRShift
      case '>>>': this.emit(0x65); break; // ActionBitURShift
      case '==':  this.emit(0x49); break; // ActionEquals2 (abstract equality)
      case '===': this.emit(0x66); break; // ActionStrictEquals (SWF6+)
      case '!=':  this.emit(0x49); this.emit(0x12); break; // Equals2 + Not
      case '!==': this.emit(0x66); this.emit(0x12); break; // StrictEquals + Not
      case '<':   this.emit(0x48); break; // ActionLess2
      case '>':   this.emit(0x67); break; // ActionGreater (SWF6+)
      case '<=':  this.emit(0x67); this.emit(0x12); break; // !(left > right)
      case '>=':  this.emit(0x48); this.emit(0x12); break; // !(left < right)
      case 'add': this.emit(0x21); break; // ActionStringAdd (Flash 4 string concat)
      case 'eq':  this.emit(0x13); break; // ActionStringEquals
      case 'ne':  this.emit(0x13); this.emit(0x12); break; // StringEquals + Not
      case 'lt':  this.emit(0x29); break; // ActionStringLess
      case 'gt':  this.emit(0x68); break; // ActionStringGreater
      case 'le':  this.emit(0x68); this.emit(0x12); break; // !(StringGreater) = le
      case 'ge':  this.emit(0x29); this.emit(0x12); break; // !(StringLess) = ge
      case 'instanceof': this.emit(0x54); break; // ActionInstanceOf
      case 'as':
        // 'x as Type' is a compile-time type assertion — evaluates to x unchanged.
        // Both operands are already on the stack; discard the type operand.
        this.emit(0x17); // ActionPop — discard the right-hand type value
        break;
      default:
        throw new Error(`Unsupported binary operator: ${op}`);
    }
  }

  private compileShortCircuitAnd(expr: BinaryExpr): void {
    // left && right:
    //   Evaluate left. If falsy → result = left (skip right).
    //   If truthy → result = right.
    this.compileExpr(expr.left);
    this.emit(0x4c); // ActionDuplicate — keep a copy of left for the result
    // ActionNot: truthy when left was falsy → that's when we want to skip right
    this.emit(0x12); // ActionNot
    const skipPos = this.emitActionIf(); // jump when !left is truthy (i.e., left was falsy)
    // Left was truthy: discard the kept copy, evaluate right as the result
    this.emit(0x17); // Pop the duplicate
    this.compileExpr(expr.right);
    // Both paths merge here
    this.patchJump(skipPos, this.buf.length);
  }

  private compileShortCircuitOr(expr: BinaryExpr): void {
    // left || right:
    //   Evaluate left. If truthy → result = left (skip right).
    //   If falsy → result = right.
    this.compileExpr(expr.left);
    this.emit(0x4c); // ActionDuplicate
    const skipPos = this.emitActionIf(); // jump when left is truthy → keep the duplicate as result
    // Left was falsy: discard the duplicate, evaluate right
    this.emit(0x17); // Pop the duplicate
    this.compileExpr(expr.right);
    this.patchJump(skipPos, this.buf.length);
  }

  private compileUnaryExpr(expr: UnaryExpr): void {
    switch (expr.operator) {
      case '!':
        this.compileExpr(expr.operand);
        this.emit(0x12); // ActionNot
        break;

      case '-':
        // Optimization: fold unary minus on a numeric literal into a direct negative push.
        if (expr.operand.type === 'Literal' && typeof (expr.operand as Literal).value === 'number') {
          const negVal = -((expr.operand as Literal).value as number);
          if (Number.isInteger(negVal) && negVal >= -2147483648 && negVal <= 2147483647) {
            this.pushInt(negVal);
          } else {
            this.pushNumber(negVal);
          }
        } else {
          // General case: 0 - operand
          this.pushInt(0);
          this.compileExpr(expr.operand);
          this.emit(0x0b); // ActionSubtract
        }
        break;

      case '+':
        // Unary plus — coerce operand to number (AS2: +x === Number(x))
        this.compileExpr(expr.operand);
        this.emit(0x4A); // ActionToNumber
        break;

      case '~':
        // Bitwise NOT: operand ^ -1
        this.compileExpr(expr.operand);
        this.pushInt(-1);
        this.emit(0x62); // ActionBitXor
        break;

      case 'typeof':
        this.compileExpr(expr.operand);
        this.emit(0x44); // ActionTypeOf
        break;

      case 'void':
        this.compileExpr(expr.operand);
        this.emit(0x17); // Pop result
        this.pushUndefined();
        break;

      case 'delete':
        if (expr.operand.type === 'MemberExpr') {
          // ActionDelete (0x3A): pops name (top), then object → deletes object[name]
          this.compileExpr((expr.operand as MemberExpr).object);
          this.pushString((expr.operand as MemberExpr).property);
          this.emit(0x3a); // ActionDelete
        } else if (expr.operand.type === 'IndexExpr') {
          // ActionDelete (0x3A) also handles computed keys: push object, push key, delete
          this.compileExpr((expr.operand as IndexExpr).object);
          this.compileExpr((expr.operand as IndexExpr).index);
          this.emit(0x3a); // ActionDelete
        } else if (expr.operand.type === 'Identifier') {
          // ActionDelete2 (0x3B): pops name → deletes variable in scope chain
          this.pushString((expr.operand as Identifier).name);
          this.emit(0x3b); // ActionDelete2
        } else {
          this.pushBool(false);
        }
        break;

      case '++':
        if (expr.operand.type === 'Identifier') {
          const name = (expr.operand as Identifier).name;
          if (expr.prefix) {
            // Prefix increment — result is new value
            // AVM1 stack sequence for ++x (returns newValue):
            //   push name, GetVariable → [old]
            //   Increment              → [new]
            //   Duplicate              → [new, new-copy]
            //   push name              → [new, new-copy, "name"]
            //   Swap                   → [new, "name", new-copy]
            //   SetVariable (pops new-copy as value, "name" as name)  → [new]
            //   [new remains as expression result]
            this.pushString(name);
            this.emit(0x1c); // ActionGetVariable
            this.emit(0x50); // ActionIncrement
            this.emit(0x4c); // ActionDuplicate
            this.pushString(name);
            this.emit(0x4d); // ActionStackSwap
            this.emit(0x1d); // ActionSetVariable
            // expression result (new value) is now on top
          } else {
            // Postfix increment — result is OLD value
            // AVM1 stack sequence for x++ (returns oldValue):
            //   push name, GetVariable → [old]
            //   Duplicate              → [old, old-copy]
            //   Increment              → [old, new]
            //   push name              → [old, new, "name"]
            //   Swap                   → [old, "name", new]
            //   SetVariable (pops new as value, "name" as name)  → [old]
            //   [old remains as expression result]
            this.pushString(name);
            this.emit(0x1c); // ActionGetVariable
            this.emit(0x4c); // ActionDuplicate
            this.emit(0x50); // ActionIncrement
            this.pushString(name);
            this.emit(0x4d); // ActionStackSwap
            this.emit(0x1d); // ActionSetVariable
            // expression result (old value) is now on top
          }
        } else {
          this.compileIncDecNonIdentifier(expr.operand, 0x50, expr.prefix);
        }
        break;

      case '--':
        if (expr.operand.type === 'Identifier') {
          const name = (expr.operand as Identifier).name;
          if (expr.prefix) {
            // Prefix decrement — result is new value
            // AVM1 stack sequence for --x (returns newValue):
            //   push name, GetVariable → [old]
            //   Decrement              → [new]
            //   Duplicate              → [new, new-copy]
            //   push name              → [new, new-copy, "name"]
            //   Swap                   → [new, "name", new-copy]
            //   SetVariable (pops new-copy as value, "name" as name)  → [new]
            //   [new remains as expression result]
            this.pushString(name);
            this.emit(0x1c); // ActionGetVariable
            this.emit(0x51); // ActionDecrement
            this.emit(0x4c); // ActionDuplicate
            this.pushString(name);
            this.emit(0x4d); // ActionStackSwap
            this.emit(0x1d); // ActionSetVariable
            // expression result (new value) is now on top
          } else {
            // Postfix decrement — result is OLD value
            // AVM1 stack sequence for x-- (returns oldValue):
            //   push name, GetVariable → [old]
            //   Duplicate              → [old, old-copy]
            //   Decrement              → [old, new]
            //   push name              → [old, new, "name"]
            //   Swap                   → [old, "name", new]
            //   SetVariable (pops new as value, "name" as name)  → [old]
            //   [old remains as expression result]
            this.pushString(name);
            this.emit(0x1c); // ActionGetVariable
            this.emit(0x4c); // ActionDuplicate
            this.emit(0x51); // ActionDecrement
            this.pushString(name);
            this.emit(0x4d); // ActionStackSwap
            this.emit(0x1d); // ActionSetVariable
            // expression result (old value) is now on top
          }
        } else {
          this.compileIncDecNonIdentifier(expr.operand, 0x51, expr.prefix);
        }
        break;

      default:
        this.compileExpr(expr.operand);
        break;
    }
  }

  /**
   * Increment/decrement (`++` / `--`) on a non-Identifier target.
   * For MemberExpr (`obj.prop++`) and IndexExpr (`arr[i]++`) the modified value
   * is stored back via ActionSetMember.
   *
   * - Postfix (`prefix=false`): expression result is the OLD value (before Inc/Dec).
   * - Prefix  (`prefix=true`):  expression result is the NEW value (after Inc/Dec).
   *
   * `opcode` is 0x50 (ActionIncrement) or 0x51 (ActionDecrement).
   */
  private compileIncDecNonIdentifier(operand: Expression, opcode: number, prefix: boolean): void {
    if (operand.type === 'MemberExpr' || operand.type === 'IndexExpr') {
      // Compile (object, name) twice: once for the SetMember write-back, once
      // for the GetMember read. (Object expression is evaluated twice; fine
      // for the common `a.b++` / `_root.score++` shapes.)
      const compileTarget = (): void => {
        if (operand.type === 'MemberExpr') {
          this.compileExpr((operand as MemberExpr).object);
          this.pushString((operand as MemberExpr).property);
        } else {
          this.compileExpr((operand as IndexExpr).object);
          this.compileExpr((operand as IndexExpr).index);
        }
      };
      compileTarget();                     // [obj, name]              (for SetMember)
      compileTarget();                     // [obj, name, obj, name]   (for GetMember)
      this.emit(0x4e);                     // ActionGetMember → [obj, name, oldValue]
      if (!prefix) {
        // Postfix: save OLD value into r0 BEFORE Inc/Dec so the expression
        // result is the value that existed before the mutation.
        // Stack: [obj, name, oldValue]
        this.emitWithPayload(0x87, [0]);   // ActionStoreRegister r0 (no pop)
        this.emit(opcode);                 // Inc/Dec → [obj, name, newValue]
        this.emit(0x4f);                   // ActionSetMember (pops newValue, name, obj)
        this.emitWithPayload(0x96, [4, 0]); // ActionPush register r0 → oldValue
      } else {
        // Prefix: Inc/Dec first, then save NEW value into r0.
        // Stack: [obj, name, oldValue]
        this.emit(opcode);                 // Inc/Dec → [obj, name, newValue]
        this.emitWithPayload(0x87, [0]);   // ActionStoreRegister r0 (no pop)
        this.emit(0x4f);                   // ActionSetMember (pops newValue, name, obj)
        this.emitWithPayload(0x96, [4, 0]); // ActionPush register r0 → newValue
      }
    } else {
      this.compileExpr(operand);
      this.emit(opcode);                   // inc/dec result on stack (no store-back)
    }
  }

  private compileCallExpr(expr: CallExpr): void {
    if (expr.callee.type === 'MemberExpr') {
      const member = expr.callee as MemberExpr;

      // Built-in: String.fromCharCode(n) → push n, ActionMBAsciiToChar (0x37)
      // Flash Professional emits ActionMBAsciiToChar instead of a generic method call.
      if (
        member.object.type === 'Identifier' &&
        (member.object as Identifier).name === 'String' &&
        member.property === 'fromCharCode' &&
        expr.args.length === 1
      ) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x37); // ActionMBAsciiToChar
        return;
      }

      // super.method(args) → Animal.prototype.method.call(this, args)
      // Must be handled before the generic MemberExpr path so that `super`
      // resolves to Animal.prototype.method rather than Animal.method.
      if (
        member.object.type === 'Identifier' &&
        (member.object as Identifier).name === 'super' &&
        this.currentSuperClass !== null
      ) {
        const superName = this.currentSuperClass;
        const methodName = member.property;
        // ActionCallMethod stack (top popped first by Ruffle):
        //   method_name | object | numArgs | arg[0] | ... | arg[n-1]
        // We want: "call" | Animal.prototype.speak | nArgs+1 | this | arg[0] | ... | arg[n-1]
        // Push actual args deepest first (arg[n-1] first)
        for (let i = expr.args.length - 1; i >= 0; i--) {
          this.compileExpr(expr.args[i]!);
        }
        // Push 'this' as the first argument to .call()
        this.pushString('this');
        this.emit(0x1c); // ActionGetVariable → this
        // Push nArgs + 1 (user args + 'this')
        this.pushInt(expr.args.length + 1);
        // Build Animal.prototype.method on the stack
        this.pushString(superName);
        this.emit(0x1c); // ActionGetVariable → Animal
        this.pushString('prototype');
        this.emit(0x4e); // ActionGetMember → Animal.prototype
        this.pushString(methodName);
        this.emit(0x4e); // ActionGetMember → Animal.prototype.speak
        // Push method name "call" — top of stack, first popped by Ruffle
        this.pushString('call');
        this.emit(0x52); // ActionCallMethod → Animal.prototype.speak.call(this, ...)
        return;
      }

      // ActionCallMethod stack layout (Ruffle pops top first):
      //   method_name | object | numArgs | arg[0] | ... | arg[n-1]
      //   (bottom to top: arg[n-1], ..., arg[0], numArgs, object, method_name)
      // Push args deepest first (arg[n-1] first = deepest, arg[0] last = just above numArgs)
      for (let i = expr.args.length - 1; i >= 0; i--) {
        this.compileExpr(expr.args[i]!);
      }
      // Push numArgs
      this.pushInt(expr.args.length);
      // Push and evaluate the object
      this.compileExpr(member.object);
      // Push method name — top of stack, first popped by Ruffle
      this.pushString(member.property);
      this.emit(0x52); // ActionCallMethod
      return;
    }

    if (expr.callee.type === 'Identifier') {
      const name = (expr.callee as Identifier).name;

      // super(...) → SuperClass.call(this, ...) via ActionCallMethod
      if (name === 'super' && this.currentSuperClass !== null) {
        const superName = this.currentSuperClass;
        // ActionCallMethod stack (top popped first by Ruffle):
        //   method_name | object | numArgs | arg[0] | ... | arg[n-1]
        // super(args) → SuperClass.call(this, arg0, ..., argN-1)
        // Push args deepest first (arg[n-1] first = deepest)
        for (let i = expr.args.length - 1; i >= 0; i--) {
          this.compileExpr(expr.args[i]!);
        }
        // push 'this' as arg[0] (closest to numArgs)
        this.pushString('this');
        this.emit(0x1c); // ActionGetVariable → this
        // Push nArgs (user args + 1 for 'this')
        this.pushInt(expr.args.length + 1);
        // Push SuperClass (object to call .call on)
        this.pushString(superName);
        this.emit(0x1c); // ActionGetVariable → SuperClass
        // Push method name "call" — top of stack
        this.pushString('call');
        this.emit(0x52); // ActionCallMethod
        return;
      }

      // Built-in: stop() → ActionStop
      if (name === 'stop' && expr.args.length === 0) {
        this.emit(0x07); // ActionStop
        this.pushUndefined();
        return;
      }
      // Built-in: play() → ActionPlay
      if (name === 'play' && expr.args.length === 0) {
        this.emit(0x06); // ActionPlay
        this.pushUndefined();
        return;
      }
      // Built-in: nextFrame() → ActionNextFrame
      if (name === 'nextFrame' && expr.args.length === 0) {
        this.emit(0x04); // ActionNextFrame
        this.pushUndefined();
        return;
      }
      // Built-in: prevFrame() → ActionPrevFrame
      if (name === 'prevFrame' && expr.args.length === 0) {
        this.emit(0x05); // ActionPrevFrame
        this.pushUndefined();
        return;
      }
      // Built-in: gotoAndPlay(frame) → push frame, ActionGotoFrame2 (0x9F) PlayFlag=1
      if (name === 'gotoAndPlay' && expr.args.length >= 1) {
        this.compileExpr(expr.args[0]!);
        // ActionGotoFrame2: opcode 0x9F, length=1, flags byte: bit0=PlayFlag(1)=play after goto
        // bit1=SceneBiasFlag (0 here); bit0=PlayFlag
        this.emitWithPayload(0x9f, [0x01]); // flags = 0x01: PlayFlag=1
        this.pushUndefined();
        return;
      }
      // Built-in: gotoAndStop(frame) → push frame, ActionGotoFrame2 (0x9F) PlayFlag=0
      if (name === 'gotoAndStop' && expr.args.length >= 1) {
        this.compileExpr(expr.args[0]!);
        // ActionGotoFrame2: opcode 0x9F, length=1, flags byte: bit0=PlayFlag=0 (stop after goto)
        this.emitWithPayload(0x9f, [0x00]); // flags = 0x00: PlayFlag=0
        this.pushUndefined();
        return;
      }
      // Built-in: trace(x) → ActionTrace
      if (name === 'trace') {
        if (expr.args.length >= 1) {
          this.compileExpr(expr.args[0]!);
        } else {
          this.pushUndefined();
        }
        this.emit(0x26); // ActionTrace
        this.pushUndefined();
        return;
      }

      // Built-in: getURL(url[, window]) → push url + push window + ActionGetURL2 (0x9A)
      if (name === 'getURL') {
        this.compileExpr(expr.args[0] ?? { type: 'Literal', value: '' } as any);
        this.compileExpr(expr.args[1] ?? { type: 'Literal', value: '' } as any);
        // ActionGetURL2: opcode=0x9A, length=1, method byte=0 (no send/load)
        this.emitWithPayload(0x9a, [0x00]);
        this.pushUndefined();
        return;
      }

      // Built-in: loadMovie(url, target) → push url + push target + ActionGetURL2 method=0x40
      // ActionGetURL2 pops target FIRST (top of stack), then url (deeper).
      // So push url first (deeper), then target last (on top).
      if (name === 'loadMovie') {
        this.compileExpr(expr.args[0] ?? { type: 'Literal', value: '' } as any); // url (deeper)
        this.compileExpr(expr.args[1] ?? { type: 'Literal', value: '' } as any); // target (on top)
        // ActionGetURL2: method=0x40 (load movie into target)
        this.emitWithPayload(0x9a, [0x40]);
        this.pushUndefined();
        return;
      }

      // Built-in: loadMovieNum(url, level) → push url + push "_level"+level + ActionGetURL2 method=0x40
      // ActionGetURL2 pops target FIRST (top of stack), then url (deeper).
      // So push url first (deeper), then target string "_level<N>" last (on top).
      if (name === 'loadMovieNum') {
        // Push url first (deeper)
        this.compileExpr(expr.args[0] ?? { type: 'Literal', value: '' } as any);
        // Construct target string "_level<N>" from the level argument and push it on top
        this.pushString('_level');
        this.compileExpr(expr.args[1] ?? { type: 'Literal', value: 0 } as any);
        this.emit(0x47); // ActionAdd2 — concatenate "_level" + level
        // ActionGetURL2: method=0x40 (load movie into target)
        this.emitWithPayload(0x9a, [0x40]);
        this.pushUndefined();
        return;
      }

      // Built-in: unloadMovie(target) → push "" + push target + ActionGetURL2 method=0x40
      // An empty URL with method=0x40 tells Flash/Ruffle to unload the movie at target.
      if (name === 'unloadMovie') {
        this.pushString(''); // empty url (deeper)
        this.compileExpr(expr.args[0] ?? { type: 'Literal', value: '' } as any); // target (on top)
        // ActionGetURL2: method=0x40 (empty url = unload)
        this.emitWithPayload(0x9a, [0x40]);
        this.pushUndefined();
        return;
      }

      // Built-in: unloadMovieNum(level) → push "" + push "_level"+level + ActionGetURL2 method=0x40
      if (name === 'unloadMovieNum') {
        this.pushString(''); // empty url (deeper)
        // Construct target string "_level<N>" from the level argument and push it on top
        this.pushString('_level');
        this.compileExpr(expr.args[0] ?? { type: 'Literal', value: 0 } as any);
        this.emit(0x47); // ActionAdd2 — concatenate "_level" + level
        // ActionGetURL2: method=0x40 (empty url = unload)
        this.emitWithPayload(0x9a, [0x40]);
        this.pushUndefined();
        return;
      }

      // Built-in: stopDrag() → ActionEndDrag (0x28), no arguments needed
      if (name === 'stopDrag') {
        this.emit(0x28); // ActionEndDrag
        this.pushUndefined();
        return;
      }

      // Built-in: startDrag(target, lockCenter[, left, top, right, bottom])
      // ActionStartDrag (0x27) pops from the stack top-first:
      //   1. target (TOP — popped first, so must be pushed LAST)
      //   2. lock_center
      //   3. do_constrain
      //   4. y_max (bottom)   \  only when do_constrain=1
      //   5. x_max (right)     |
      //   6. y_min (top)       |
      //   7. x_min (left)     /  (deepest, pushed FIRST)
      // So we push deepest-first: coords first (if constrain), then constrain flag,
      // then lockCenter, then target last (top of stack).
      if (name === 'startDrag') {
        if (expr.args.length === 0) {
          // startDrag() — drag 'this', no lock, no constrain
          this.pushInt(0);      // do_constrain = false (deepest)
          this.pushInt(0);      // lockCenter = false
          this.pushString('');  // target = "" (self) — TOP of stack
        } else if (expr.args.length >= 2 && expr.args.length < 6) {
          // startDrag(target, lockCenter) — no constrain
          this.pushInt(0);                 // do_constrain = false (deepest)
          this.compileExpr(expr.args[1]!); // lockCenter
          this.compileExpr(expr.args[0]!); // target — TOP of stack
        } else {
          // startDrag(target, lockCenter, left, top, right, bottom) — with constrain
          this.compileExpr(expr.args[2]!); // left   (x_min) — deepest
          this.compileExpr(expr.args[3]!); // top    (y_min)
          this.compileExpr(expr.args[4]!); // right  (x_max)
          this.compileExpr(expr.args[5]!); // bottom (y_max)
          this.pushInt(1);                 // do_constrain = true
          this.compileExpr(expr.args[1]!); // lockCenter
          this.compileExpr(expr.args[0]!); // target — TOP of stack
        }
        this.emit(0x27); // ActionStartDrag
        this.pushUndefined();
        return;
      }

      // Built-in: getTimer() → ActionGetTime (0x34)
      if (name === 'getTimer' && expr.args.length === 0) {
        this.emit(0x34); // ActionGetTime
        return;
      }

      // Built-in: random(n) → push n, ActionRandomNumber (0x30)
      if (name === 'random' && expr.args.length === 1) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x30); // ActionRandomNumber
        return;
      }

      // Built-in: int(x) → push x, ActionToInteger (0x18)
      if (name === 'int' && expr.args.length === 1) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x18); // ActionToInteger
        return;
      }

      // Built-in: Number(x) → push x, ActionToNumber (0x4A)
      if (name === 'Number' && expr.args.length === 1) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x4A); // ActionToNumber
        return;
      }

      // Built-in: String(x) → push x, ActionToString (0x4B)
      if (name === 'String' && expr.args.length === 1) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x4B); // ActionToString
        return;
      }

      // Built-in: Boolean(x) → push x, ActionNot (0x12) twice (double-not = toBoolean)
      // AVM1 has no ActionToBoolean; !!x is the idiomatic equivalent.
      if (name === 'Boolean' && expr.args.length === 1) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x12); // ActionNot
        this.emit(0x12); // ActionNot (second not restores the correct boolean value)
        return;
      }

      // Built-in: chr(n) → push n, ActionChr (0x33)
      if (name === 'chr' && expr.args.length === 1) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x33); // ActionChr
        return;
      }

      // Built-in: ord(s) → push s, ActionOrd (0x32)
      if (name === 'ord' && expr.args.length === 1) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x32); // ActionOrd
        return;
      }

      // Built-in: eval(str) → push str, ActionGetVariable (0x1C)
      if (name === 'eval' && expr.args.length === 1) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x1c); // ActionGetVariable
        return;
      }

      // Built-in: length(s) → push s, ActionMBLength (0x31)
      // AVM1 global function length(str) returns the number of characters.
      if (name === 'length' && expr.args.length === 1) {
        this.compileExpr(expr.args[0]!);
        this.emit(0x31); // ActionMBLength
        return;
      }

      // Built-in: substring(s, start, length) → ActionMBSubString (0x35)
      // AVM1 stack convention (pops top first): count (top), start, string (bottom)
      // Push order: arg0(s) deepest, arg1(start), arg2(length) on top, then emit 0x35
      if (name === 'substring' && expr.args.length === 3) {
        this.compileExpr(expr.args[0]!); // string (deepest)
        this.compileExpr(expr.args[1]!); // start offset
        this.compileExpr(expr.args[2]!); // count/length (top)
        this.emit(0x35); // ActionMBSubString
        return;
      }

      // ActionCallFunction stack (top popped first by Ruffle):
      //   name | numArgs | arg[0] | ... | arg[n-1]
      // Push args deepest first (arg[n-1] first = deepest, arg[0] last = just below numArgs)
      for (let i = expr.args.length - 1; i >= 0; i--) {
        this.compileExpr(expr.args[i]!);
      }
      this.pushInt(expr.args.length);
      // Push function name on top
      this.pushString(name);
      this.emit(0x3d); // ActionCallFunction
      return;
    }

    // Complex callee (IIFE, computed call, double-call, etc.)
    //
    // For IndexExpr callees (arr[i](), obj["method"]()) we use ActionCallMethod
    // (0x52) with the computed key — this preserves `this` context, matching how
    // the static MemberExpr path works.
    if (expr.callee.type === 'IndexExpr') {
      const idx = expr.callee as IndexExpr;
      // ActionCallMethod stack (top popped first by Ruffle):
      //   method_name | object | numArgs | arg[0] | ... | arg[n-1]
      for (let i = expr.args.length - 1; i >= 0; i--) {
        this.compileExpr(expr.args[i]!);
      }
      this.pushInt(expr.args.length);
      this.compileExpr(idx.object);
      this.compileExpr(idx.index); // computed key (pushed as top = method_name slot)
      this.emit(0x52); // ActionCallMethod
      return;
    }

    // For all other complex callees (IIFEs, double-calls like factory()(), etc.)
    // use the temp-var approach:
    //   1. Store the computed function into a temp variable
    //   2. Call it by name via ActionCallFunction (0x3D)
    //
    // ActionDefineLocal pops value (top) then name (below), so sequence is:
    //   push tempName
    //   compile callee  → pushes fn on top
    //   ActionDefineLocal → stores fn into tempName (function-scoped), consumes both
    //   push args (reverse), push argCount, push tempName
    //   ActionCallFunction
    const tmpName = `__callTmp${this.callTmpCounter++}`;
    this.pushString(tmpName);
    this.compileExpr(expr.callee); // function value on top
    this.emit(0x3c); // ActionDefineLocal — stores fn as local var, leaves nothing on stack
    for (let i = expr.args.length - 1; i >= 0; i--) {
      this.compileExpr(expr.args[i]!);
    }
    this.pushInt(expr.args.length);
    this.pushString(tmpName);
    this.emit(0x3d); // ActionCallFunction
  }

  /**
   * Convert a static member expression chain (a.b.c) to a dotted string.
   * Returns null if the expression is computed or otherwise not a static chain.
   *
   * Examples:
   *   Identifier("mx")  → "mx"
   *   MemberExpr(MemberExpr(Identifier("mx"), "transitions"), "Tween")  → "mx.transitions.Tween"
   */
  private memberExprToString(expr: Expression): string | null {
    if (expr.type === 'Identifier') return (expr as Identifier).name;
    if (expr.type === 'MemberExpr') {
      const m = expr as MemberExpr;
      // Only static (dot-notation) member access, not computed (m["prop"])
      const obj = this.memberExprToString(m.object);
      if (obj !== null) return `${obj}.${m.property}`;
    }
    return null;
  }

  private compileNewExpr(expr: NewExpr): void {
    // ActionNewObject (0x40) stack layout — Ruffle pops TOP first:
    //   className-string  ← TOP (popped first by ActionNewObject)
    //   nArgs
    //   arg[0]            ← just below nArgs
    //   ...
    //   arg[n-1]          ← deepest (pushed first)
    //
    // Push order: args deepest-first (arg[n-1] first), then nArgs, then className LAST.
    // This mirrors ActionCallFunction which also puts the name on top.
    //
    // ActionNewObject pops the class name as a STRING, not as an object reference.
    // For `new pkg.sub.ClassName()` we push "pkg.sub.ClassName" as a string,
    // NOT resolve the member chain to an object via GetVariable/GetMember.
    const className = this.memberExprToString(expr.callee);
    // Push args deepest-first (last arg pushed first = deepest on stack)
    for (let i = expr.args.length - 1; i >= 0; i--) {
      this.compileExpr(expr.args[i]!);
    }
    this.pushInt(expr.args.length);
    // Push className LAST so it ends up on top — first thing ActionNewObject pops
    if (className !== null) {
      this.pushString(className);
    } else {
      // Computed/dynamic callee (e.g. new obj["class"]()) — best effort: evaluate
      // the callee expression and leave it on the stack as the class name slot.
      // AVM1 will coerce it to a string when ActionNewObject runs.
      this.compileExpr(expr.callee);
    }
    this.emit(0x40); // ActionNewObject
  }

  private compileMemberExpr(expr: MemberExpr): void {
    this.compileExpr(expr.object);
    this.pushString(expr.property);
    this.emit(0x4e); // ActionGetMember
  }

  private compileIndexExpr(expr: IndexExpr): void {
    this.compileExpr(expr.object);
    this.compileExpr(expr.index);
    this.emit(0x4e); // ActionGetMember (works for numeric indices too)
  }

  private compileSequenceExpr(expr: SequenceExpr): void {
    const last = expr.expressions.length - 1;
    for (let i = 0; i < last; i++) {
      this.compileExpr(expr.expressions[i]!);
      this.emit(0x17); // ActionPop — discard intermediate results
    }
    this.compileExpr(expr.expressions[last]!);
  }

  private compileTernaryExpr(expr: TernaryExpr): void {
    // test ? consequent : alternate
    this.compileExpr(expr.test);
    this.emit(0x12); // ActionNot → jump over consequent when test was false
    const skipConsPos = this.emitActionIf();

    this.compileExpr(expr.consequent);
    const jumpEndPos = this.emitActionJump();

    this.patchJump(skipConsPos, this.buf.length); // alternate starts here
    this.compileExpr(expr.alternate);
    this.patchJump(jumpEndPos, this.buf.length);  // both paths end here
  }

  private compileArrayLiteral(expr: ArrayLiteral): void {
    // ActionInitArray (0x42): Ruffle pops count first, then pops each element.
    // Element[0] must be on top (popped first after count), so push elements in
    // reverse order (last element first, first element last), then push count on top.
    for (let i = expr.elements.length - 1; i >= 0; i--) {
      this.compileExpr(expr.elements[i]!);
    }
    this.pushInt(expr.elements.length);
    this.emit(0x42); // ActionInitArray
  }

  private compileObjectLiteral(expr: ObjectLiteral): void {
    // ActionInitObject (0x43): Ruffle pops count first, then for each property
    // pops value then name. Push properties in reverse order (last prop first),
    // with each prop's value pushed before key so key ends up below value.
    // Then push count on top.
    for (let i = expr.properties.length - 1; i >= 0; i--) {
      const prop = expr.properties[i]!;
      this.pushString(prop.key);
      this.compileExpr(prop.value);
    }
    this.pushInt(expr.properties.length);
    this.emit(0x43); // ActionInitObject
  }

  // ---- Function compilation ------------------------------------------------

  /**
   * Walk an array of AST statements and return true if any Identifier with
   * name === 'arguments' appears (excluding nested function bodies, which have
   * their own `arguments` binding).
   *
   * Only the immediate function's body is scanned; inner DefineFunction2
   * bodies are NOT entered because they capture their own `arguments`.
   */
  private static bodyUsesArguments(stmts: Statement[]): boolean {
    function scanStmt(s: Statement): boolean {
      switch (s.type) {
        case 'Block':         return s.body.some(scanStmt);
        case 'IfStmt':        return scanExpr(s.test) || scanStmt(s.consequent) || (s.alternate != null && scanStmt(s.alternate));
        case 'ForStmt':
          return (s.init != null && scanStmt(s.init))
              || (s.test != null && scanExpr(s.test))
              || (s.update != null && scanExpr(s.update))
              || scanStmt(s.body);
        case 'ForInStmt':     return scanExpr(s.right) || scanStmt(s.body);
        case 'WhileStmt':     return scanExpr(s.test) || scanStmt(s.body);
        case 'DoWhileStmt':   return scanStmt(s.body) || scanExpr(s.test);
        case 'ReturnStmt':    return s.value != null && scanExpr(s.value);
        case 'ThrowStmt':     return scanExpr(s.value);
        case 'ExprStmt':      return scanExpr(s.expression);
        case 'VarDecl':       return s.init != null && scanExpr(s.init);
        case 'TryStmt':
          return s.body.body.some(scanStmt)
              || (s.catchClause != null && s.catchClause.body.body.some(scanStmt))
              || (s.finallyBlock != null && s.finallyBlock.body.some(scanStmt));
        case 'SwitchStmt':
          return scanExpr(s.discriminant) || s.cases.some(c => (c.test != null && scanExpr(c.test)) || c.consequent.some(scanStmt));
        case 'WithStmt':      return scanExpr(s.object) || scanStmt(s.body);
        case 'LabeledStmt':   return scanStmt(s.body);
        case 'FunctionDecl':  return false; // do NOT enter nested functions
        case 'ClassDecl':     return false;
        default:              return false;
      }
    }
    function scanExpr(e: Expression): boolean {
      switch (e.type) {
        case 'Identifier':    return e.name === 'arguments';
        case 'BinaryExpr':    return scanExpr(e.left) || scanExpr(e.right);
        case 'UnaryExpr':     return scanExpr(e.operand);
        case 'AssignExpr':    return scanExpr(e.left) || scanExpr(e.right);
        case 'CallExpr':      return scanExpr(e.callee) || e.args.some(scanExpr);
        case 'NewExpr':       return scanExpr(e.callee) || e.args.some(scanExpr);
        case 'MemberExpr':    return scanExpr(e.object);
        case 'IndexExpr':     return scanExpr(e.object) || scanExpr(e.index);
        case 'TernaryExpr':   return scanExpr(e.test) || scanExpr(e.consequent) || scanExpr(e.alternate);
        case 'SequenceExpr':  return e.expressions.some(scanExpr);
        case 'ArrayLiteral':  return e.elements.some(scanExpr);
        case 'ObjectLiteral': return e.properties.some(p => scanExpr(p.value));
        case 'FunctionDecl':  return false; // do NOT enter nested functions
        default:              return false;
      }
    }
    return stmts.some(scanStmt);
  }

  /**
   * Compile a named function declaration statement.
   * Emits ActionDefineFunction2 which assigns the function to the named variable.
   */
  private compileFunctionDeclStmt(decl: FunctionDecl): void {
    if (decl.name === null) return; // anonymous in statement position — skip
    this.emitDefineFunction2(decl.name, decl.params, decl.body.body);
  }

  /**
   * Compile a function expression (value on stack).
   * Emits ActionDefineFunction2 with empty name (anonymous) — leaves function on stack.
   */
  private compileFunctionExpr(decl: FunctionDecl): void {
    this.emitDefineFunction2('', decl.params, decl.body.body);
  }

  /**
   * Emit ActionDefineFunction2 (0x8e).
   *
   * Format:
   *   opcode (1 byte): 0x8e
   *   length (UI16):   size of the rest of the payload
   *   name (C-string): null-terminated function name ('' for anonymous)
   *   numParams (UI16): parameter count
   *   registerCount (UI8): 0 (let AVM1 manage registers)
   *   flags (UI16): 0 (no register preloads / suppressions)
   *   params: for each param: registerNumber(UI8)=0, name(C-string)
   *   codeSize (UI16): byte length of the function body actions
   *   <body actions>
   *
   * After emission the function value is left on the stack (for anonymous) or
   * stored in the named variable (for named declarations).
   */
  private emitDefineFunction2(
    name: string,
    params: string[],
    body: Statement[],
    superClass: string | null = null
  ): void {
    // Compile body into a sub-buffer so we know its size
    const subCompiler = new Compiler();
    subCompiler.currentSuperClass = superClass;
    subCompiler.constantPool = this.constantPool; // inherit parent's constant pool
    subCompiler.compileStatements(body);
    const bodyBytes = subCompiler.buf.getBytes();

    // Build the payload
    const nameBytes = new TextEncoder().encode(name);
    const paramBytes: number[] = [];
    for (const p of params) {
      paramBytes.push(0); // registerNumber = 0
      const pb = new TextEncoder().encode(p);
      for (const b of pb) paramBytes.push(b);
      paramBytes.push(0); // null terminator
    }

    // payload layout:
    // name (nameBytes.length + 1 null)
    // numParams UI16 (2)
    // registerCount UI8 (1)
    // flags UI16 (2)
    // params (paramBytes.length)
    // codeSize UI16 (2)
    // body (bodyBytes.length) — NOT included in the action length!
    //
    // Per the SWF spec (and Ruffle's read_define_function_2), the function
    // body FOLLOWS the DefineFunction2 record and is delimited by codeSize;
    // the action's declared length covers only the header. Including the body
    // makes Ruffle log "Length mismatch in AVM1 action: DefineFunction2" and
    // re-sync PAST the actions following the record, silently corrupting the
    // remainder of the action stream (e.g. the SetMember of
    // `_root.onEnterFrame = function(){...}` never executes).
    const payloadSize =
      nameBytes.length + 1 + // name + null
      2 +                    // numParams
      1 +                    // registerCount
      2 +                    // flags
      paramBytes.length +    // params
      2;                     // codeSize

    this.buf.write(0x8e); // ActionDefineFunction2
    this.buf.writeUI16(payloadSize);

    // name (C-string)
    for (const b of nameBytes) this.buf.write(b);
    this.buf.write(0); // null terminator

    // numParams
    this.buf.writeUI16(params.length);
    // registerCount (0 = auto)
    this.buf.write(0);
    // DefineFunction2 flags (SWF spec / ruffle FunctionFlags):
    //   Bit 3: SUPPRESS_ARGUMENTS — omit the `arguments` object when the body
    //          doesn't reference it. This is a pure optimisation that frees a
    //          register and matches real Flash 8 output for most methods.
    //          Safe: it only affects the implicit `arguments` binding; named
    //          parameters still arrive as named locals (registerNumber = 0).
    const suppressArgs = !Compiler.bodyUsesArguments(body);
    const flags = suppressArgs ? 0x0008 : 0x0000;
    this.buf.writeUI16(flags);

    // params: each is (UI8 register, C-string name)
    for (const b of paramBytes) this.buf.write(b);

    // codeSize
    this.buf.writeUI16(bodyBytes.length);

    // body
    this.buf.writeBytes(bodyBytes);
  }

  // ---- Class compilation ---------------------------------------------------

  /**
   * Compile a ClassDecl to AVM1 bytecode.
   *
   * Emits the prototype-chain setup equivalent to:
   *   ClassName = function(...) { <constructor body> }
   *   ClassName.prototype = new SuperClass();   // if extends
   *   ClassName.prototype.method = function() { <body> }
   *   ClassName.staticMethod = function() { <body> }
   *   ClassName.prototype.prop = initValue;     // instance prop
   *   ClassName.prop = initValue;               // static prop
   *   ClassName.prototype.addProperty("prop", getterFn, setterFn); // getter/setter
   */
  private compileClassDecl(decl: ClassDecl): void {
    const className = decl.name;

    // ---- 1. Find constructor and split members ----------------------------
    const ctor = decl.body.find(
      (m): m is FunctionDecl => m.type === 'FunctionDecl' && m.name === className
    );
    const members = decl.body.filter(
      (m) => !(m.type === 'FunctionDecl' && (m as FunctionDecl).name === className)
    );

    const ctorBody: Statement[] = ctor?.body.body ?? [];
    const ctorParams: string[] = ctor?.params ?? [];

    // ---- 2. Emit: ClassName = function(...) { ... } ----------------------
    // ActionSetVariable expects: [name, value] on stack (name below, value on top)
    this.pushString(className);
    this.emitDefineFunction2('', ctorParams, ctorBody, decl.superClass);
    this.emit(0x1d); // ActionSetVariable

    // ---- 3. Emit prototype chain if extends -------------------------------
    if (decl.superClass !== null) {
      const superName = decl.superClass;
      // Emit: ClassName.prototype = new SuperClass()
      //
      // ActionSetMember pops (from top): value, name, obj → obj.name = value
      // So we push: obj (ClassName), name ("prototype"), value (new SuperClass())
      //
      // For ActionNewObject (0x40), className must be on TOP (last pushed).
      // Stack layout: nArgs (pushed first), then className on top.
      // For a no-arg constructor: push 0 (nArgs), push superName (className), emit 0x40.

      // target object: ClassName
      this.pushString(className);
      this.emit(0x1c); // ActionGetVariable → ClassName function object

      // property name
      this.pushString('prototype');

      // new SuperClass(): push arg count 0, then class name on top, ActionNewObject
      this.pushInt(0);
      this.pushString(superName);
      this.emit(0x40); // ActionNewObject → new SuperClass() instance on top

      // ActionSetMember: pops value(new instance), name("prototype"), obj(ClassName)
      this.emit(0x4f); // ActionSetMember

      // Restore: ClassName.prototype.constructor = ClassName
      // ActionSetMember needs: obj | propName | value (obj deepest, value on top)
      // obj = ClassName.prototype
      this.pushString(className);
      this.emit(0x1c); // ActionGetVariable → ClassName
      this.pushString('prototype');
      this.emit(0x4e); // ActionGetMember → ClassName.prototype

      // propName = "constructor"
      this.pushString('constructor');

      // value = ClassName
      this.pushString(className);
      this.emit(0x1c); // ActionGetVariable → ClassName

      this.emit(0x4f); // ActionSetMember: ClassName.prototype.constructor = ClassName
    }

    // ---- 3b. Emit ActionImplementsOp (0x2c) if the class has interfaces ----
    //
    // AVM1 ActionImplementsOp stack layout (top-first pop order):
    //   constructor  ← popped first (the class function itself)
    //   count        ← number of interfaces (integer)
    //   iface[0]     ← first interface constructor (popped last)
    //   ...
    //   iface[n-1]   ← last interface constructor
    //
    // So we push in this order: iface[0], iface[1], ..., iface[n-1], count, constructor
    if (decl.interfaces.length > 0) {
      for (const iface of decl.interfaces) {
        this.pushString(iface);
        this.emit(0x1c); // ActionGetVariable → interface constructor function
      }
      this.pushInt(decl.interfaces.length);
      this.pushString(className);
      this.emit(0x1c); // ActionGetVariable → class constructor function
      this.emit(0x2c); // ActionImplementsOp
    }

    // ---- 4. Separate getter/setter pairs from regular members ------------
    // Map from property name → { getter, setter }
    const getsetPairs = new Map<string, { getter?: FunctionDecl; setter?: FunctionDecl }>();
    const regularMembers: (FunctionDecl | import('./ast.js').VarDecl)[] = [];

    for (const member of members) {
      if (member.type === 'FunctionDecl') {
        const fn = member as FunctionDecl;
        if (fn.name === null) continue;
        if (fn.isGetter || fn.isSetter) {
          const propName = fn.name;
          if (!getsetPairs.has(propName)) {
            getsetPairs.set(propName, {});
          }
          const pair = getsetPairs.get(propName)!;
          if (fn.isGetter) pair.getter = fn;
          else pair.setter = fn;
        } else {
          regularMembers.push(fn);
        }
      } else {
        regularMembers.push(member);
      }
    }

    // ---- 5. Emit instance and static methods/properties ------------------
    for (const member of regularMembers) {
      if (member.type === 'FunctionDecl') {
        const fn = member as FunctionDecl;
        if (fn.name === null) continue;
        this.compileClassMethod(className, fn, decl.superClass);
      } else {
        // VarDecl
        const vd = member as import('./ast.js').VarDecl;
        this.compileClassProperty(className, vd);
      }
    }

    // ---- 6. Emit addProperty calls for getter/setter pairs ---------------
    for (const [propName, { getter, setter }] of getsetPairs) {
      this.compileAddProperty(className, propName, getter, setter, decl.superClass);
    }
  }

  /**
   * Emit an addProperty call on ClassName.prototype for a getter/setter pair.
   *
   * Equivalent to:
   *   ClassName.prototype.addProperty("propName", getterFn, setterFn)
   *
   * AVM1 ActionCallMethod stack layout (bottom to top):
   *   obj | methodName | nArgs | arg[n-1] | ... | arg[0]
   * So for addProperty(name, getter, setter):
   *   obj = ClassName.prototype
   *   methodName = "addProperty"
   *   nArgs = 3
   *   arg[2] = propName (bottom of args)
   *   arg[1] = getter function
   *   arg[0] = setter function (top, first popped)
   */
  private compileAddProperty(
    className: string,
    propName: string,
    getter: FunctionDecl | undefined,
    setter: FunctionDecl | undefined,
    superClass: string | null
  ): void {
    // ActionCallMethod stack (top popped first by Ruffle):
    //   method_name | object | numArgs | arg[0] | ... | arg[n-1]
    // addProperty(propName, getter, setter): 3 args
    //   arg[0] = propName, arg[1] = getter, arg[2] = setter
    // Push args deepest first: arg[2] first, arg[0] last (closest to numArgs)

    // Push arg[2] = setter (deepest arg)
    if (setter !== undefined) {
      this.emitDefineFunction2('', setter.params, setter.body.body, superClass);
    } else {
      this.pushNull();
    }

    // Push arg[1] = getter
    if (getter !== undefined) {
      this.emitDefineFunction2('', getter.params, getter.body.body, superClass);
    } else {
      this.pushNull();
    }

    // Push arg[0] = property name string (closest to numArgs)
    this.pushString(propName);

    // Push nArgs = 3
    this.pushInt(3);

    // Push the prototype object (method receiver)
    this.pushString(className);
    this.emit(0x1c); // ActionGetVariable → ClassName
    this.pushString('prototype');
    this.emit(0x4e); // ActionGetMember → ClassName.prototype

    // Push method name — top of stack, first popped by Ruffle
    this.pushString('addProperty');

    this.emit(0x52); // ActionCallMethod
    this.emit(0x17); // ActionPop — discard return value
  }

  private compileClassMethod(
    className: string,
    fn: FunctionDecl,
    superClass: string | null = null
  ): void {
    const methodName = fn.name!;
    if (fn.isStatic) {
      // ClassName.methodName = function(...) { ... }
      // ActionSetMember: obj | propName | value → (sets obj.propName = value)
      this.pushString(className);
      this.emit(0x1c); // ActionGetVariable → ClassName

      this.pushString(methodName);
      this.emitDefineFunction2('', fn.params, fn.body.body, superClass);
      this.emit(0x4f); // ActionSetMember
    } else {
      // ClassName.prototype.methodName = function(...) { ... }
      // First get ClassName.prototype
      this.pushString(className);
      this.emit(0x1c); // ActionGetVariable → ClassName
      this.pushString('prototype');
      this.emit(0x4e); // ActionGetMember → ClassName.prototype

      this.pushString(methodName);
      this.emitDefineFunction2('', fn.params, fn.body.body, superClass);
      this.emit(0x4f); // ActionSetMember
    }
  }

  private compileClassProperty(className: string, vd: VarDecl): void {
    const init = vd.init;
    if (vd.isStatic) {
      // ClassName.propName = initValue
      this.pushString(className);
      this.emit(0x1c); // ActionGetVariable

      this.pushString(vd.name);
      if (init !== null) {
        this.compileExpr(init);
      } else {
        this.pushUndefined();
      }
      this.emit(0x4f); // ActionSetMember
    } else {
      // ClassName.prototype.propName = initValue
      this.pushString(className);
      this.emit(0x1c); // ActionGetVariable → ClassName
      this.pushString('prototype');
      this.emit(0x4e); // ActionGetMember → ClassName.prototype

      this.pushString(vd.name);
      if (init !== null) {
        this.compileExpr(init);
      } else {
        this.pushUndefined();
      }
      this.emit(0x4f); // ActionSetMember
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile an ActionScript 2 source string into AVM1 bytecode.
 *
 * The returned bytes are the raw AVM1 action sequence with no SWF framing.
 * Parse errors propagate as thrown exceptions.
 */
export function compileAS2(source: string): Uint8Array {
  const program = parse(source);
  const compiler = new Compiler();
  return compiler.compileProgram(program);
}
