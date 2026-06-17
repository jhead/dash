# Byte-walk of an empty timeline stream — `corpus/noise/base_a.fla` `Page 1` (274 B)

Manual reconciliation of docs/21 §5/§10/§11/§12 against real Flash 8 bytes. Every offset below
matched the spec; this is direct read-proof for the timeline records (not just the catalog).

```
@0    01                                  CPicPage leading marker (§8.1)
@1    ff ff 01 00 08 00 "CPicPage"        new-class tag (§5.1): def=1 len=8
@15   04 00                               pageVersion=4, 00
@17   ff ff 01 00 09 00 "CPicLayer"       new-class CPicLayer
@32   04 00                               layerVersion=4, 00
@34   ff ff 01 00 09 00 "CPicFrame"       new-class CPicFrame
@49   04 00                               frameVersion=4, 00
-- empty frame's synthetic empty shape (instanceHeader, §5.3, isInstance=false) --
@51   00 00                               pad
@53   00 00 00 80  00 00 00 80            transform-point absent → INT_MIN sentinel ×2
@61   00 00                               F8: 00, cacheAsBitmap=0
@63   03                                  instanceType = shapeType = 3
@64   00 00 01 00 00 00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00   identity Matrix (a=1.0,d=1.0)
@88   05                                  shapeVersion = 5 (§10)
@89   00 00 00 00                         totalEdgeCount = 0
@93   00 00                               fillStyleCount = 0
@95   00 00                               strokeStyleCount = 0
@97   00                                  post-edge marker
@98   00 00 00 00                         cubicCount = 0 (F5+)
-- CPicFrame fields (§9) --
@102  18                                  frameVersionB = 0x18 (the "fs" gate)
@103  01 00                               duration = 1
@105  00 06                               keyMode = 0x0600  (= 0x2600 KEYMODE_STANDARD with F8's 0x2000 cleared ✓)
@107  00 00                               acceleration = 0
@109  00 00                               soundId = 0
@111  00 00                               sound pointCount = 0
@113  01 00                               soundLoop = 1
@115  00                                  soundSync = 0 (event)
@116  00 00 00 00                         inPoint44 = 0
@120  ff ff ff 3f                         outPoint44 = 0x3FFFFFFF (default)
@124  ff ff                               soundZoomLevel = 0xFFFF (default -1)
@126  ff fe ff 00                         BomString frameLabel = "" (§9, >=F3)
@130  04 00 00 00 01 00 00 00             F5 block: frameVersionC=4, 000000, 01, 000000
@138  84 67                               frameId = 0x8467 (big-endian, random; >=MX)
@140  00 00 00 00 00 00                   6 zero
@146  ff fe ff 00 ...                     F3+ frame tween/comment/morph + post-blocks (BomStrings + flags;
                                          fields verified, sub-block ORDER approximate in §9 — see caveat)
...
-- CPicLayer properties block (§8.2) --
@193  00 00 00 80 00 00 00 80             layer transform-point sentinel
@205  0b                                  layerVersionB = 0x0B
@206  ff fe ff 07 "Layer 1"(utf16)        BomString layerName
@226  01 00 00                            isSelected, ...
@228  ff ff ff ff                         reserved sentinel
@232  4f ff 4f ff?                        (outline color region / state bytes)
...
@261  07                                  (layerType region) ...
@273  00                                  end
```

**Result:** the spec's CArchive protocol (§5), CPicPage/CPicLayer headers (§8), the empty-shape
instanceHeader + shapeVersion/counts (§5.3/§10), and the CPicFrame major fields (§9 —
frameVersionB, duration, keyMode incl. the F8 `0x2000` clear, the full sound block, the empty
frame-label BomString, and the F5 frameVersionC/frameId block) all match real Flash 8 bytes
exactly. The layer-properties trailer (layerVersionB, "Layer 1" name) is present at @205+.

**Caveat (honest):** the exact byte ORDER of the several F3+ frame sub-blocks between the
frameId block (@146) and the layer trailer (motionTweenRotate / comment u32 / MorphShape /
shapeTweenBlend / soundEffect / anchor / ease-curve) is transcribed from flacomdoc's grouped
emission and is approximate in §9; the individual fields are verified but a strict byte-walk
shows a BomString at @146 that the grouped §9 ordering lists slightly later. A future pass can
pin the exact interleave by diffing single-property frame mutants via the oracle.
```
