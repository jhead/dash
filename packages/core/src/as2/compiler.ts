import { parse } from "./parser.js";
import type {
  Program, Statement, Expression,
  IfStmt, ForStmt, ForInStmt, WhileStmt, DoWhileStmt,
  ExprStmt, VarDecl, FunctionDecl, ClassDecl,
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

  private compileForStmt(stmt: ForStmt): void {
    // Init
    if (stmt.init !== null) {
      if (stmt.init.type === 'VarDecl') {
        const vd = stmt.init as VarDecl;
        this.pushString(vd.name);
        if (vd.init !== null) {
          this.compileExpr(vd.init);
          this.emit(0x3c); // ActionDefineLocal
        } else {
          this.emit(0x41); // ActionDefineLocal2
        }
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

    // exit: patch the undefined-check jump to land here
    const loopEnd = this.buf.length;
    this.patchJump(exitJumpPos, loopEnd);

    // Pop the undefined sentinel that caused us to exit
    this.emit(0x17); // ActionPop

    this.loopStack.pop();
    for (const p of ctx.breakPatches) this.patchJump(p, loopEnd);
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
  private compileSwitchStmt(stmt: SwitchStmt): void {
    // Separate default from non-default cases
    const defaultCase = stmt.cases.find((c) => c.test === null) ?? null;
    const valueCases  = stmt.cases.filter((c) => c.test !== null);

    // Push discriminant once — stays on stack throughout all case comparisons
    this.compileExpr(stmt.discriminant);

    // Set up break context (continue has no meaning inside switch)
    const ctx: LoopContext = { breakPatches: [], continuePatches: [] };
    this.loopStack.push(ctx);

    // Per-case: position of the ActionIf offset field for skipping to next case.
    // Each skip-jump must point to the START of the NEXT case comparison (not to
    // defaultStart), so that each case is tested in sequence. Only the last case's
    // skip-jump lands at defaultStart.
    //
    // Correct AVM1 switch pattern for each case:
    //   ActionDuplicate       ; copy discriminant (original D stays below)
    //   PUSH case_value
    //   ActionEquals2         ; pops dup + case_value, pushes bool
    //   ActionNot             ; invert for skip-when-not-equal
    //   ActionIf(next_case)   ; skip to next case comparison if no match
    //   ActionPop             ; match found — pop original discriminant
    //   [case body]           ; break emits ActionJump(switchEnd)
    //   // next_case: (next case's DUP starts here)
    // After all cases:
    //   ActionPop             ; no match — pop original discriminant
    //   [default body]        ; (or nothing if no default)

    let prevSkipPatch: number | null = null;

    for (const c of valueCases) {
      // Patch the previous case's skip-jump to land here (start of this case's DUP)
      if (prevSkipPatch !== null) {
        this.patchJump(prevSkipPatch, this.buf.length);
      }

      // Duplicate the discriminant
      this.emit(0x4c); // ActionDuplicate

      // Push case test value
      this.compileExpr(c.test!);

      // ActionEquals2 — strict equality (0x49)
      this.emit(0x49);

      // ActionNot — we want to skip forward when NOT equal
      this.emit(0x12); // ActionNot

      // ActionIf — jump to next case when (not equal) is truthy
      prevSkipPatch = this.emitActionIf();

      // Matched: pop the original discriminant (the dup was consumed by ActionEquals2)
      this.emit(0x17); // ActionPop

      // Compile case body
      // break compiles as ActionJump(switchEnd) via the loopStack mechanism
      this.compileStatements(c.consequent);
      // (No automatic jump inserted — fall-through to next case's comparison is allowed)
    }

    // defaultStart: all non-matching cases eventually land here.
    // Patch the last case's skip-jump to point here.
    const defaultStart = this.buf.length;
    if (prevSkipPatch !== null) {
      this.patchJump(prevSkipPatch, defaultStart);
    }

    // No case matched: pop the original discriminant, then run default body (if any).
    // Only one ActionPop is needed here — matched cases already popped on their own path.
    if (defaultCase !== null) {
      this.emit(0x17); // ActionPop — discard discriminant before default body
      this.compileStatements(defaultCase.consequent);
    } else {
      // No default: just pop the discriminant and fall through to switchEnd
      this.emit(0x17); // ActionPop
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
  private compileTryStmt(stmt: TryStmt): void {
    const hasCatch   = stmt.catchClause !== null;
    const hasFinally = stmt.finallyBlock !== null;

    // Compile bodies into sub-buffers (number[] avoids Uint8Array variance issues)
    const trySubCompiler = new Compiler();
    trySubCompiler.currentSuperClass = this.currentSuperClass;
    trySubCompiler.loopStack = this.loopStack; // share break/continue context
    trySubCompiler.labeledLoops = this.labeledLoops; // share labeled loop context
    trySubCompiler.compileStatements(stmt.body.body);
    const tryBytes: number[] = Array.from(trySubCompiler.buf.getBytes());

    let catchBytes: number[] = [];
    let catchParam = '';
    if (hasCatch) {
      catchParam = stmt.catchClause!.param;
      const catchSubCompiler = new Compiler();
      catchSubCompiler.currentSuperClass = this.currentSuperClass;
      catchSubCompiler.loopStack = this.loopStack;
      catchSubCompiler.labeledLoops = this.labeledLoops;
      catchSubCompiler.compileStatements(stmt.catchClause!.body.body);
      catchBytes = Array.from(catchSubCompiler.buf.getBytes());
    }

    let finallyBytes: number[] = [];
    if (hasFinally) {
      const finallySubCompiler = new Compiler();
      finallySubCompiler.currentSuperClass = this.currentSuperClass;
      finallySubCompiler.loopStack = this.loopStack;
      finallySubCompiler.labeledLoops = this.labeledLoops;
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
    // flags(1) + catchName(catchNameArr.length + 1 null) or 0 if no catch
    // + TrySize(2) + CatchSize(2) + FinallySize(2)
    // The try/catch/finally BODIES follow the record and are NOT included in
    // the action's declared length (per the SWF spec and Ruffle's read_try,
    // which adds try+catch+finally sizes to the action length after parsing
    // the header). Including them desynchronizes the action stream.
    const catchNameFieldLen = hasCatch ? catchNameArr.length + 1 : 0;
    const payloadLen =
      1 +                 // flags
      catchNameFieldLen + // catch name (null-terminated) or nothing
      2 +                 // TrySize
      2 +                 // CatchSize
      2;                  // FinallySize

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

    // CatchName (null-terminated) — only when HasCatch && !CatchInRegister
    if (hasCatch) {
      for (const b of catchNameArr) this.buf.write(b);
      this.buf.write(0); // null terminator
    }

    // Bodies — write byte-by-byte from number arrays
    for (const b of tryBytes)     this.buf.write(b);
    for (const b of catchBytes)   this.buf.write(b);
    for (const b of finallyBytes) this.buf.write(b);
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
      if (stmt.init.type === 'VarDecl') {
        const vd = stmt.init as VarDecl;
        this.pushString(vd.name);
        if (vd.init !== null) {
          this.compileExpr(vd.init);
          this.emit(0x3c); // ActionDefineLocal
        } else {
          this.emit(0x41); // ActionDefineLocal2
        }
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

    const loopEnd = this.buf.length;
    this.patchJump(exitJumpPos, loopEnd);
    this.emit(0x17); // ActionPop

    this.loopStack.pop();
    this.labeledLoops.delete(label);
    for (const p of ctx.breakPatches) this.patchJump(p, loopEnd);
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
   *   ActionPush "RegExp"
   *   ActionPush pattern
   *   [ActionPush flags]         (only if flags is non-empty)
   *   ActionPush argCount (1 or 2)
   *   ActionNew                  (0x4a)  — new RegExp(pattern[, flags])
   *
   * Uses the same ActionNew (0x4a) pattern as compileNewExpr for consistency.
   * Stack layout for ActionNew: className | nArgs | arg[n-1] | ... | arg[0]
   * (deepest = className, arg[0] on top)
   */
  private compileRegExpLiteral(expr: RegExpLiteral): void {
    // className string (deepest)
    this.pushString('RegExp');

    // nArgs
    const argCount = expr.flags.length > 0 ? 2 : 1;
    this.pushInt(argCount);

    // args in reverse order (last arg on top for ActionNew)
    if (expr.flags.length > 0) {
      // arg[1] = flags (pushed second, deeper)
      this.pushString(expr.flags);
    }
    // arg[0] = pattern (pushed last, on top)
    this.pushString(expr.pattern);

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

    if (expr.left.type === 'MemberExpr') {
      const member = expr.left as MemberExpr;
      if (op === '=') {
        // ActionSetMember: stack = [... obj name value] (obj deepest, value on top)
        this.compileExpr(member.object);
        this.pushString(member.property);
        this.compileExpr(expr.right);
        this.emit(0x4f); // ActionSetMember
        this.pushUndefined(); // expression result
      } else {
        // Compound member assignment: obj.prop OP= rhs
        //   obj name           (for SetMember)
        //   obj name           (for GetMember)
        //   GetMember          → current value
        //   rhs, arith op      → result
        //   SetMember          (pops result, name, obj)
        // The object expression is evaluated twice — acceptable for the
        // common `mc._x += dx` / `_root.score.text += s` shapes.
        const arithOp = op.slice(0, -1); // strip trailing '='
        this.compileExpr(member.object);
        this.pushString(member.property);
        this.compileExpr(member.object);
        this.pushString(member.property);
        this.emit(0x4e); // ActionGetMember → current value
        this.compileExpr(expr.right);
        this.emitArithOp(arithOp);
        this.emit(0x4f); // ActionSetMember
        this.pushUndefined(); // expression result
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
        this.emit(0x4f); // ActionSetMember
        this.pushUndefined();
      } else {
        // Compound indexed assignment: obj[i] OP= rhs (same shape as above)
        const arithOp = op.slice(0, -1);
        this.compileExpr(idx.object);
        this.compileExpr(idx.index);
        this.compileExpr(idx.object);
        this.compileExpr(idx.index);
        this.emit(0x4e); // ActionGetMember → current value
        this.compileExpr(expr.right);
        this.emitArithOp(arithOp);
        this.emit(0x4f); // ActionSetMember
        this.pushUndefined();
      }
      return;
    }

    if (expr.left.type === 'Identifier') {
      const name = (expr.left as Identifier).name;
      if (op === '=') {
        // ActionSetVariable: stack = [... name value] (name below value)
        this.pushString(name);
        this.compileExpr(expr.right);
        this.emit(0x1d); // ActionSetVariable
        this.pushUndefined(); // expression result
      } else {
        // Compound: name OP= rhs
        // We need: load current, apply op, store back.
        // Stack layout for SetVariable at the end: [name, result]
        // Sequence:
        //   push name         ← for SetVariable at end
        //   push name + GetVariable → current value
        //   push rhs
        //   emitArithOp       → result = current OP rhs on stack
        //   ActionSetVariable (pops name and result)
        const arithOp = op.slice(0, -1); // strip trailing '='
        this.pushString(name);          // name for SetVariable
        this.pushString(name);
        this.emit(0x1c);                // ActionGetVariable → current value
        this.compileExpr(expr.right);   // rhs
        this.emitArithOp(arithOp);      // result on top of stack
        this.emit(0x1d);                // ActionSetVariable (pops name then result)
        this.pushUndefined();           // expression result
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

    // 'in' operator: key in obj → obj.hasOwnProperty(key)
    // ActionCallMethod stack (top popped first by Ruffle):
    //   method_name | object | numArgs | arg[0] | ... | arg[n-1]
    if (op === 'in') {
      this.compileExpr(expr.left);   // push key (arg[0], deepest)
      this.pushInt(1);               // nArgs = 1
      this.compileExpr(expr.right);  // push obj (object)
      this.pushString('hasOwnProperty'); // method name (top)
      this.emit(0x52);               // ActionCallMethod
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
        // Negate: 0 - operand
        this.pushInt(0);
        this.compileExpr(expr.operand);
        this.emit(0x0b); // ActionSubtract
        break;

      case '+':
        // Unary plus — evaluate operand (no numeric coerce in MVP)
        this.compileExpr(expr.operand);
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
        } else if (expr.operand.type === 'Identifier') {
          // ActionDelete2 (0x3B): pops name → deletes variable in scope chain
          this.pushString((expr.operand as Identifier).name);
          this.emit(0x3b); // ActionDelete2
        } else {
          this.pushBool(false);
        }
        break;

      case '++':
        // Prefix increment — result is new value
        if (expr.operand.type === 'Identifier') {
          const name = (expr.operand as Identifier).name;
          // Correct AVM1 stack sequence for prefix ++x (returns newValue):
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
          this.compileIncDecNonIdentifier(expr.operand, 0x50);
        }
        break;

      case '--':
        // Prefix decrement — result is new value
        if (expr.operand.type === 'Identifier') {
          const name = (expr.operand as Identifier).name;
          // Correct AVM1 stack sequence for prefix --x (returns newValue):
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
          this.compileIncDecNonIdentifier(expr.operand, 0x51);
        }
        break;

      default:
        this.compileExpr(expr.operand);
        break;
    }
  }

  /**
   * Increment/decrement (`++` / `--`) on a non-Identifier target.
   * For MemberExpr (`obj.prop++`) and IndexExpr (`arr[i]++`) the new value is
   * stored back via ActionSetMember; the expression result (new value) is left
   * on the stack. For anything else, fall back to inc/dec without store-back.
   *
   * `opcode` is 0x50 (ActionIncrement) or 0x51 (ActionDecrement).
   */
  private compileIncDecNonIdentifier(operand: Expression, opcode: number): void {
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
      this.emit(0x4e);                     // ActionGetMember → [obj, name, value]
      this.emit(opcode);                   // Inc/Dec        → [obj, name, newValue]
      // Keep the new value as the expression result: StoreRegister saves the
      // top of stack WITHOUT popping, SetMember then consumes the triple, and
      // a register-push restores the result.
      this.emitWithPayload(0x87, [0]);     // ActionStoreRegister r0 (no pop)
      this.emit(0x4f);                     // ActionSetMember (pops value, name, obj)
      this.emitWithPayload(0x96, [4, 0]);  // ActionPush register r0 → newValue
    } else {
      this.compileExpr(operand);
      this.emit(opcode);                   // inc/dec result on stack (no store-back)
    }
  }

  private compileCallExpr(expr: CallExpr): void {
    if (expr.callee.type === 'MemberExpr') {
      const member = expr.callee as MemberExpr;
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

      // Built-in: loadMovie(url, target) → push target + push url + ActionGetURL2 method=0x40
      if (name === 'loadMovie') {
        this.compileExpr(expr.args[1] ?? { type: 'Literal', value: '' } as any);
        this.compileExpr(expr.args[0] ?? { type: 'Literal', value: '' } as any);
        // ActionGetURL2: method=0x40 (load movie into target)
        this.emitWithPayload(0x9a, [0x40]);
        this.pushUndefined();
        return;
      }

      // Built-in: loadMovieNum(url, level) → push "_level"+level + push url + ActionGetURL2 method=0x40
      if (name === 'loadMovieNum') {
        // Construct target string "_level<N>" from the level argument
        // Push "_level" + level as a concatenated string via stack operations
        this.pushString('_level');
        this.compileExpr(expr.args[1] ?? { type: 'Literal', value: 0 } as any);
        this.emit(0x47); // ActionAdd2 — concatenate "_level" + level
        // Now push the url
        this.compileExpr(expr.args[0] ?? { type: 'Literal', value: '' } as any);
        // ActionGetURL2: method=0x40 (load movie into target)
        this.emitWithPayload(0x9a, [0x40]);
        this.pushUndefined();
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
    // ActionSetVariable pops value (top) then name (below), so sequence is:
    //   push tempName
    //   compile callee  → pushes fn on top
    //   ActionSetVariable → stores fn into tempName, consumes both
    //   push args (reverse), push argCount, push tempName
    //   ActionCallFunction
    const tmpName = `__callTmp${this.callTmpCounter++}`;
    this.pushString(tmpName);
    this.compileExpr(expr.callee); // function value on top
    this.emit(0x1d); // ActionSetVariable — stores fn, leaves nothing on stack
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
    // ActionNewObject (0x40) stack layout (deepest first, top is arg[0]):
    //   className-string | nArgs | arg[n-1] | ... | arg[0]
    //
    // ActionNewObject pops the class name as a STRING, not as an object reference.
    // For `new pkg.sub.ClassName()` we must push "pkg.sub.ClassName" as a string,
    // NOT resolve the member chain to an object via GetVariable/GetMember.
    const className = this.memberExprToString(expr.callee);
    if (className !== null) {
      this.pushString(className);
    } else {
      // Computed/dynamic callee (e.g. new obj["class"]()) — best effort: evaluate
      // the callee expression and leave it on the stack as the class name slot.
      // AVM1 will coerce it to a string when ActionNewObject runs.
      this.compileExpr(expr.callee);
    }
    this.pushInt(expr.args.length);
    for (let i = expr.args.length - 1; i >= 0; i--) {
      this.compileExpr(expr.args[i]!);
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
    // ActionInitArray (0x36): pops count, then elements (element[0] on top) → pushes Array
    this.pushInt(expr.elements.length);
    for (let i = expr.elements.length - 1; i >= 0; i--) {
      this.compileExpr(expr.elements[i]!);
    }
    this.emit(0x42); // ActionInitArray
  }

  private compileObjectLiteral(expr: ObjectLiteral): void {
    // ActionInitObject (0x43): pops count, then (key, value) pairs (last pair on top) → pushes Object
    this.pushInt(expr.properties.length);
    for (let i = expr.properties.length - 1; i >= 0; i--) {
      const prop = expr.properties[i]!;
      this.pushString(prop.key);
      this.compileExpr(prop.value);
    }
    this.emit(0x43); // ActionInitObject
  }

  // ---- Function compilation ------------------------------------------------

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
    // flags (preload/suppress bits) — 0 for simplicity
    this.buf.writeUI16(0);

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
      // For ActionNew (0x4a), the compileNewExpr pattern pushes:
      //   className-string, nArgs, arg[n-1]..arg[0]   (deepest = className)
      // ActionNew pops them in that order and pushes the new instance.

      // target object: ClassName
      this.pushString(className);
      this.emit(0x1c); // ActionGetVariable → ClassName function object

      // property name
      this.pushString('prototype');

      // new SuperClass(): push class name (string), push arg count 0, ActionNew
      this.pushString(superName);
      this.pushInt(0);
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
