import { describe, it, expect } from 'vitest';
import { compileAS2 } from '../compiler.js';

describe('String() cast', () => {
  it('emits ActionToString (0x4B) for String(x)', () => {
    const buf = compileAS2('var s = String(myVar);');
    // ActionToString opcode is 0x4B
    expect(Array.from(buf)).toContain(0x4B);
  });

  it('does not contain ActionCallFunction for String()', () => {
    const buf = compileAS2('String(x);');
    // Should emit the var name push + ActionGetVariable + ActionToString
    const bytes = Array.from(buf);
    expect(bytes).toContain(0x4B);
    // ActionCallFunction is 0x9E — must NOT appear
    expect(bytes).not.toContain(0x9E);
  });
});
