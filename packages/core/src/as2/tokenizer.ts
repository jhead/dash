export type TokenType =
  | 'keyword'
  | 'identifier'
  | 'number'
  | 'string'
  | 'regex'
  | 'operator'
  | 'punctuation'
  | 'comment'
  | 'whitespace'
  | 'newline'
  | 'eof';

export interface Token {
  readonly type: TokenType;
  readonly value: string;    // raw source text
  readonly line: number;     // 1-based
  readonly col: number;      // 1-based
  readonly pos: number;      // 0-based character offset in source
}

export const AS2_KEYWORDS = new Set([
  'var', 'function', 'if', 'else', 'for', 'while', 'do', 'return',
  'new', 'delete', 'this', 'typeof', 'instanceof', 'in',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'class', 'extends', 'implements', 'interface', 'import',
  'dynamic', 'intrinsic', 'private', 'protected', 'public', 'static',
  '_global', 'with', 'switch', 'case', 'default', 'break', 'continue',
  'try', 'catch', 'finally', 'throw', 'void',
  'get', 'set',  // property accessors
  // Note: Flash 4 legacy operators (add, eq, ne, lt, gt, le, ge) are NOT keywords —
  // they're contextual identifiers handled by the parser so they remain usable as
  // variable/function names in Flash 8 code.
]);

/**
 * Tokenize an ActionScript 2 source string.
 * Returns all tokens including whitespace and comments.
 * Use filterTokens() to get only meaningful tokens.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function advance(n = 1) {
    for (let i = 0; i < n; i++) {
      if (source[pos] === '\n') { line++; col = 1; } else { col++; }
      pos++;
    }
  }

  function peek(offset = 0) { return source[pos + offset] ?? ''; }

  function makeToken(type: TokenType, value: string, startPos: number, startLine: number, startCol: number): Token {
    return { type, value, line: startLine, col: startCol, pos: startPos };
  }

  while (pos < source.length) {
    const startPos = pos, startLine = line, startCol = col;
    const ch = source[pos];

    // --- Whitespace ---
    if (ch === '\n') {
      advance(); tokens.push(makeToken('newline', '\n', startPos, startLine, startCol)); continue;
    }
    if (ch === '\r') {
      const val = source[pos + 1] === '\n' ? '\r\n' : '\r';
      advance(val.length); tokens.push(makeToken('newline', val, startPos, startLine, startCol)); continue;
    }
    if (' \t\f\v'.includes(ch)) {
      let val = '';
      while (pos < source.length && ' \t\f\v'.includes(source[pos])) { val += source[pos]; advance(); }
      tokens.push(makeToken('whitespace', val, startPos, startLine, startCol)); continue;
    }

    // --- Comments ---
    if (ch === '/' && peek(1) === '/') {
      let val = '//';
      advance(2);
      while (pos < source.length && source[pos] !== '\n') { val += source[pos]; advance(); }
      tokens.push(makeToken('comment', val, startPos, startLine, startCol)); continue;
    }
    if (ch === '/' && peek(1) === '*') {
      let val = '/*';
      advance(2);
      while (pos < source.length && !(source[pos] === '*' && peek(1) === '/')) { val += source[pos]; advance(); }
      if (pos < source.length) { val += '*/'; advance(2); }
      tokens.push(makeToken('comment', val, startPos, startLine, startCol)); continue;
    }

    // --- String literals ---
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let val = quote;
      advance();
      while (pos < source.length && source[pos] !== quote) {
        if (source[pos] === '\\') { val += source[pos]; advance(); }
        if (pos < source.length) { val += source[pos]; advance(); }
      }
      if (pos < source.length) { val += quote; advance(); }
      tokens.push(makeToken('string', val, startPos, startLine, startCol)); continue;
    }

    // --- Numbers ---
    if ((ch >= '0' && ch <= '9') || (ch === '.' && peek(1) >= '0' && peek(1) <= '9')) {
      let val = '';
      if (ch === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
        val += '0x'; advance(2);
        while (pos < source.length && /[0-9a-fA-F]/.test(source[pos])) { val += source[pos]; advance(); }
      } else {
        while (pos < source.length && /[0-9]/.test(source[pos])) { val += source[pos]; advance(); }
        if (pos < source.length && source[pos] === '.') { val += '.'; advance(); }
        while (pos < source.length && /[0-9]/.test(source[pos])) { val += source[pos]; advance(); }
        if (pos < source.length && (source[pos] === 'e' || source[pos] === 'E')) {
          val += source[pos]; advance();
          if (source[pos] === '+' || source[pos] === '-') { val += source[pos]; advance(); }
          while (pos < source.length && /[0-9]/.test(source[pos])) { val += source[pos]; advance(); }
        }
      }
      tokens.push(makeToken('number', val, startPos, startLine, startCol)); continue;
    }

    // --- Identifiers and keywords ---
    if (/[a-zA-Z_$]/.test(ch)) {
      let val = '';
      while (pos < source.length && /[a-zA-Z0-9_$]/.test(source[pos])) { val += source[pos]; advance(); }
      const type: TokenType = AS2_KEYWORDS.has(val) ? 'keyword' : 'identifier';
      tokens.push(makeToken(type, val, startPos, startLine, startCol)); continue;
    }

    // --- Multi-char operators ---
    const fourChar = source.slice(pos, pos + 4);
    const threeChar = source.slice(pos, pos + 3);
    const two = source.slice(pos, pos + 2);
    if (fourChar === '>>>=') {
      tokens.push(makeToken('operator', fourChar, startPos, startLine, startCol)); advance(4); continue;
    }
    if (['===', '!==', '>>>', '<<=', '>>='].includes(threeChar)) {
      tokens.push(makeToken('operator', threeChar, startPos, startLine, startCol)); advance(3); continue;
    }
    if (['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '>>>'].includes(two)) {
      tokens.push(makeToken('operator', two, startPos, startLine, startCol)); advance(2); continue;
    }

    // --- Single-char operators ---
    if ('+-*/%&|^~!<>=?:'.includes(ch)) {
      tokens.push(makeToken('operator', ch, startPos, startLine, startCol)); advance(); continue;
    }

    // --- Punctuation ---
    if ('(){}[];,.'.includes(ch)) {
      tokens.push(makeToken('punctuation', ch, startPos, startLine, startCol)); advance(); continue;
    }

    // --- Unknown: treat as punctuation ---
    tokens.push(makeToken('punctuation', ch, startPos, startLine, startCol)); advance();
  }

  tokens.push(makeToken('eof', '', pos, line, col));
  return tokens;
}

/** Return only tokens that are not whitespace, newline, or comment. */
export function filterTokens(tokens: Token[]): Token[] {
  return tokens.filter(t => t.type !== 'whitespace' && t.type !== 'newline' && t.type !== 'comment');
}

/**
 * Attempt to scan a regex literal starting at `startPos` in `source`.
 * The character at `startPos` must be `/`.
 * Returns a Token of type `regex` whose value is the full literal (e.g. `/foo/gi`),
 * or null if the `/` cannot start a valid regex (e.g. it is an empty pattern `//`
 * that collides with a line comment — but that is already consumed as comment before
 * this is called).
 *
 * Called by the parser only when `/` appears in a primary-expression position.
 */
export function scanRegexAt(
  source: string,
  startPos: number,
  startLine: number,
  startCol: number
): Token | null {
  let pos = startPos;
  if (source[pos] !== '/') return null;
  pos++; // consume opening '/'

  // Scan pattern — must not be empty (// is a line comment, never reaches here)
  let pattern = '';
  let inClass = false; // inside [...]
  while (pos < source.length) {
    const ch = source[pos];
    if (ch === '\n' || ch === '\r') return null; // unterminated
    if (ch === '\\' && pos + 1 < source.length) {
      // escaped character — consume two chars
      pattern += ch + source[pos + 1];
      pos += 2;
      continue;
    }
    if (ch === '[') { inClass = true; pattern += ch; pos++; continue; }
    if (ch === ']') { inClass = false; pattern += ch; pos++; continue; }
    if (ch === '/' && !inClass) {
      pos++; // consume closing '/'
      break;
    }
    pattern += ch;
    pos++;
  }

  // Scan flags: [gimsuy]*
  let flags = '';
  while (pos < source.length && /[a-zA-Z]/.test(source[pos]!)) {
    flags += source[pos];
    pos++;
  }

  const value = '/' + pattern + '/' + flags;
  return { type: 'regex', value, line: startLine, col: startCol, pos: startPos };
}
