/**
 * DoInitAction (tag 59) encoder.
 *
 * Emits an AVM1 init script that calls Object.registerClass(linkageId, ClassName)
 * so that attachMovie() and `new ClassName()` work at runtime.
 *
 * AVM1 bytecode structure:
 *   ActionPush "ClassName"      // push class name string (arg 1)
 *   ActionGetVariable           // resolve ClassName → constructor
 *   ActionPush "LinkageId"      // push linkage identifier (arg 0)
 *   ActionPush 2 (integer)      // arg count
 *   ActionPush "Object"         // object name
 *   ActionGetVariable           // resolve Object global ← object (below method_name)
 *   ActionPush "registerClass"  // method name ← TOP (popped first by ActionCallMethod)
 *   ActionCallMethod (0x52)     // call Object.registerClass(linkageId, ClassName)
 *   ActionPop (0x17)            // discard return value
 *   ActionEnd (0x00)
 */

/**
 * Encode a single ActionPush (0x96) instruction for a string value.
 *
 * Format: 0x96, <UI16LE length>, 0x00 (type=string), <UTF-8 bytes>, 0x00
 * where length = 1 (type byte) + byteLen(string) + 1 (null terminator)
 */
function encodePushString(s: string): number[] {
  const encoded = new TextEncoder().encode(s);
  // length field = type byte (1) + string bytes + null terminator (1)
  const len = 1 + encoded.length + 1;
  const bytes: number[] = [
    0x96,           // ActionPush opcode
    len & 0xff,     // UI16LE low byte
    (len >> 8) & 0xff, // UI16LE high byte
    0x00,           // type = string
    ...encoded,
    0x00,           // null terminator
  ];
  return bytes;
}

/**
 * Encode ActionPush integer (type 7, UI32LE value).
 * Format: 0x96, 0x05, 0x00, 0x07, <UI32LE value>
 */
function encodePushInt(value: number): number[] {
  return [
    0x96,                         // ActionPush opcode
    0x05, 0x00,                   // length = 5 (1 type + 4 value bytes)
    0x07,                         // type = integer
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ];
}

/**
 * Build the AVM1 bytecode for:
 *   Object.registerClass("linkageId", ClassName)
 */
function buildRegisterClassBytecode(className: string, linkageId: string): Uint8Array {
  const bytes: number[] = [
    // Push className string and resolve to constructor
    ...encodePushString(className),
    0x1c,                          // ActionGetVariable

    // Push linkageId string
    ...encodePushString(linkageId),

    // Push arg count = 2
    ...encodePushInt(2),

    // Push "Object" and resolve it (object — below method_name on stack)
    ...encodePushString("Object"),
    0x1c,                          // ActionGetVariable

    // Push "registerClass" method name (TOP — popped first by ActionCallMethod)
    ...encodePushString("registerClass"),

    0x52,                          // ActionCallMethod
    0x17,                          // ActionPop
    0x00,                          // ActionEnd
  ];
  return new Uint8Array(bytes);
}

/**
 * Encode a complete DoInitAction (tag 59) tag body.
 *
 * Structure:
 *   SpriteId: UI16  (character ID of the exported sprite)
 *   ActionRecord: AVM1 bytecode
 *
 * Returns the raw tag body bytes (WITHOUT the tag record header).
 */
export function encodeDoInitAction(
  spriteId: number,
  className: string,
  linkageId: string
): Uint8Array {
  const actionBytes = buildRegisterClassBytecode(className, linkageId);
  const body = new Uint8Array(2 + actionBytes.length);
  // SpriteId as UI16LE
  body[0] = spriteId & 0xff;
  body[1] = (spriteId >> 8) & 0xff;
  body.set(actionBytes, 2);
  return body;
}
