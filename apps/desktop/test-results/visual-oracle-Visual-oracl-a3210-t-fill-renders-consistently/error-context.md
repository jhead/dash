# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: visual-oracle.spec.ts >> Visual oracle: CanvasRenderer vs Ruffle >> linear gradient fill renders consistently
- Location: e2e/visual-oracle.spec.ts:402:3

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 0.2
Received:   0.2691545454545455
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]: File
    - generic [ref=e6]: Edit
    - generic [ref=e7]: View
    - generic [ref=e8]: Insert
    - generic [ref=e9]: Modify
    - generic [ref=e10]: Text
    - generic [ref=e11]: Control
    - generic [ref=e12]: Commands
    - generic [ref=e13]: Window
    - generic [ref=e14]: Help
  - generic [ref=e15]:
    - generic [ref=e16]: Untitled-1
    - generic [ref=e17]: ›
    - generic [ref=e18]: Scene 1
  - generic [ref=e19]:
    - generic [ref=e21]:
      - generic [ref=e22]:
        - button "Selection (V)" [ref=e23]:
          - img [ref=e24]
        - button "Subselection (A)" [ref=e26]:
          - img [ref=e27]
        - button "Free Transform (Q)" [ref=e29]:
          - img [ref=e30]
        - button "Gradient Transform (F)" [ref=e40]:
          - img [ref=e41]
        - button "Lasso (L)" [ref=e46]:
          - img [ref=e47]
        - button "Pen (P)" [ref=e51]:
          - img [ref=e52]
        - button "Line (N)" [ref=e56]:
          - img [ref=e57]
        - button "Text (T)" [ref=e59]:
          - img [ref=e60]
        - button "Oval (O)" [ref=e61]:
          - img [ref=e62]
        - button "Rectangle (R)" [ref=e64]:
          - img [ref=e65]
        - button "PolyStar (polygon/star)" [ref=e67]:
          - img [ref=e68]
        - button "Pencil (Y)" [ref=e70]:
          - img [ref=e71]
        - button "Brush (B)" [ref=e75]:
          - img [ref=e76]
        - button "Ink Bottle (S)" [ref=e80]:
          - img [ref=e81]
        - button "Paint Bucket (K)" [ref=e85]:
          - img [ref=e86]
        - button "Eyedropper (I)" [ref=e90]:
          - img [ref=e91]
        - button "Eraser (E)" [ref=e95]:
          - img [ref=e96]
        - button "Hand (H)" [ref=e98]:
          - img [ref=e99]
        - button "Zoom (Z)" [ref=e105]:
          - img [ref=e106]
      - generic [ref=e111]:
        - textbox: "#000000"
        - textbox: "#ffffff"
        - generic [ref=e112]:
          - 'generic "Stroke: #000000 (click to change)" [ref=e113] [cursor=pointer]'
          - 'generic "Fill: solid (click to change)" [ref=e114] [cursor=pointer]'
        - generic [ref=e115]:
          - button "⇅" [ref=e116] [cursor=pointer]
          - button "■" [ref=e117] [cursor=pointer]
          - button "∅" [ref=e118] [cursor=pointer]
    - generic [ref=e120]:
      - generic [ref=e125]:
        - button "Scenes" [ref=e126] [cursor=pointer]
        - button "−" [ref=e127] [cursor=pointer]
        - combobox "Zoom level (Ctrl+0 to reset)" [ref=e128] [cursor=pointer]:
          - option "25%"
          - option "50%"
          - option "75%"
          - option "100%" [selected]
          - option "150%"
          - option "200%"
          - option "400%"
        - button "+" [ref=e129] [cursor=pointer]
      - generic [ref=e130]:
        - generic [ref=e132]: Timeline
        - generic [ref=e133]:
          - generic [ref=e134]:
            - generic [ref=e137]:
              - button "●" [ref=e138] [cursor=pointer]
              - button "U" [ref=e139] [cursor=pointer]
              - generic [ref=e140]: Layer 1
              - button "X" [ref=e141] [cursor=pointer]
            - generic [ref=e142]:
              - button "+" [ref=e143] [cursor=pointer]
              - button "−" [disabled] [ref=e144]
          - generic [ref=e147]:
            - generic [ref=e148]:
              - generic: "1"
            - generic [ref=e153]:
              - generic: "6"
            - generic [ref=e158]:
              - generic: "11"
            - generic [ref=e163]:
              - generic: "16"
            - generic [ref=e168]:
              - generic: "21"
            - generic [ref=e173]:
              - generic: "26"
            - generic [ref=e178]:
              - generic: "31"
            - generic [ref=e183]:
              - generic: "36"
            - generic [ref=e188]:
              - generic: "41"
            - generic [ref=e193]:
              - generic: "46"
        - generic [ref=e293]:
          - button "|<" [ref=e294] [cursor=pointer]
          - button "<" [ref=e295] [cursor=pointer]
          - button ">" [ref=e296] [cursor=pointer]
          - button ">" [ref=e297] [cursor=pointer]
          - button ">|" [ref=e298] [cursor=pointer]
          - button "Loop" [ref=e299] [cursor=pointer]
          - button "OS" [ref=e300] [cursor=pointer]
          - generic "Click to jump to frame" [ref=e301]: 1 / 48
          - generic [ref=e302]: 12 fps
      - generic [ref=e303]:
        - generic [ref=e304]: Sound
        - generic [ref=e305]:
          - generic [ref=e306]: "Sound:"
          - combobox [ref=e307]:
            - option "None" [selected]
      - generic [ref=e308]:
        - generic [ref=e309]:
          - generic [ref=e310]: Properties
          - generic [ref=e311]: Document
        - generic [ref=e312]:
          - generic [ref=e313]:
            - generic [ref=e314]: "Size:"
            - spinbutton [ref=e315]: "550"
            - generic [ref=e316]: ×
            - spinbutton [ref=e317]: "400"
            - generic [ref=e318]: px
          - generic [ref=e320]:
            - generic [ref=e321]: "FPS:"
            - spinbutton [ref=e322]: "12"
          - generic [ref=e325]:
            - generic [ref=e326]: "BG:"
            - generic "Choose color" [ref=e327] [cursor=pointer]
            - generic [ref=e329] [cursor=pointer]: "#FFFFFF"
    - generic [ref=e330]:
      - generic [ref=e331]:
        - button "Library" [ref=e332] [cursor=pointer]
        - button "Properties" [ref=e333] [cursor=pointer]
      - generic [ref=e334]:
        - generic [ref=e335] [cursor=pointer]:
          - generic [ref=e336]: Library - Untitled-1
          - generic [ref=e337]: v
        - generic [ref=e338]:
          - button "+" [ref=e339] [cursor=pointer]
          - button "X" [disabled] [ref=e340]
          - button "+Folder" [ref=e341] [cursor=pointer]
        - textbox "Search..." [ref=e343]
        - generic [ref=e344]:
          - generic "Sort by name" [ref=e345] [cursor=pointer]: Name ^
          - generic "Sort by type" [ref=e346] [cursor=pointer]: Type
          - generic "Sort by use count" [ref=e347] [cursor=pointer]: "#"
        - generic [ref=e349]: Library is empty
  - generic [ref=e350]:
    - generic [ref=e351]: "Frame: 1"
    - generic [ref=e352]: "|"
    - generic [ref=e353]: 12 fps
    - generic [ref=e354]: "|"
    - combobox "Zoom level" [ref=e355] [cursor=pointer]:
      - option "Fit"
      - option "25%"
      - option "50%"
      - option "100%" [selected]
      - option "150%"
      - option "200%"
      - option "400%"
      - option "800%"
```

# Test source

```ts
  368 |                         { type: 'line', to: { x: 100, y: 175 } },
  369 |                         { type: 'line', to: { x: 100, y: 225 } },
  370 |                         { type: 'line', to: { x: 50, y: 225 } },
  371 |                       ],
  372 |                       closed: true,
  373 |                       fill: { type: 'solid', color: { r: 255, g: 0, b: 0, a: 255 } },
  374 |                     }],
  375 |                   },
  376 |                   x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  377 |                 }],
  378 |               }],
  379 |             }],
  380 |           },
  381 |         }],
  382 |         library: { items: [], folders: [] },
  383 |       };
  384 |     });
  385 | 
  386 |     const stageShot = await captureStageScreenshot(page, fixtureDoc);
  387 |     const ruffleShot = await captureRuffleScreenshot(page);
  388 | 
  389 |     const mismatchRatio = compareScreenshots(stageShot, ruffleShot);
  390 | 
  391 |     if (mismatchRatio >= 0.20) {
  392 |       await testInfo.attach('stage-screenshot', { body: stageShot, contentType: 'image/png' });
  393 |       await testInfo.attach('ruffle-screenshot', { body: ruffleShot, contentType: 'image/png' });
  394 |     }
  395 | 
  396 |     expect(mismatchRatio).toBeLessThan(0.20);
  397 |   });
  398 | 
  399 |   // -------------------------------------------------------------------------
  400 |   // Test 4: linear gradient fill — red-to-blue horizontal gradient rectangle
  401 |   // -------------------------------------------------------------------------
  402 |   test('linear gradient fill renders consistently', async ({ page }, testInfo: TestInfo) => {
  403 |     const fixtureDoc = await page.evaluate(() => {
  404 |       return {
  405 |         id: 'visual-gradient-doc',
  406 |         properties: {
  407 |           width: 550, height: 400, frameRate: 12,
  408 |           backgroundColor: '#ffffff', rulerUnits: 'px',
  409 |           grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
  410 |           guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
  411 |         },
  412 |         scenes: [{
  413 |           id: 'scene-1', name: 'Scene 1',
  414 |           timeline: {
  415 |             layers: [{
  416 |               id: 'layer-Layer 1', name: 'Layer 1', type: 'normal',
  417 |               visible: true, locked: false, outlineMode: false,
  418 |               outlineColor: '#ff0000', height: 20, parentFolderId: null,
  419 |               frameCount: 1,
  420 |               frames: [{
  421 |                 index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
  422 |                 label: '', labelType: 'name', script: '', sound: null,
  423 |                 motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
  424 |                 motionOrientToPath: false, motionSync: false, motionScale: false,
  425 |                 shapeEase: 0, shapeBlend: 'distributive',
  426 |                 displayObjects: [{
  427 |                   id: 'gradient-rect', type: 'shape',
  428 |                   shape: {
  429 |                     id: 'shape-gradient-rect',
  430 |                     paths: [{
  431 |                       start: { x: 100, y: 100 },
  432 |                       segments: [
  433 |                         { type: 'line', to: { x: 400, y: 100 } },
  434 |                         { type: 'line', to: { x: 400, y: 300 } },
  435 |                         { type: 'line', to: { x: 100, y: 300 } },
  436 |                       ],
  437 |                       closed: true,
  438 |                       fill: {
  439 |                         type: 'linear-gradient',
  440 |                         angle: 0,
  441 |                         stops: [
  442 |                           { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
  443 |                           { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
  444 |                         ],
  445 |                       },
  446 |                     }],
  447 |                   },
  448 |                   x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  449 |                 }],
  450 |               }],
  451 |             }],
  452 |           },
  453 |         }],
  454 |         library: { items: [], folders: [] },
  455 |       };
  456 |     });
  457 | 
  458 |     const stageShot = await captureStageScreenshot(page, fixtureDoc);
  459 |     const ruffleShot = await captureRuffleScreenshot(page);
  460 | 
  461 |     const mismatchRatio = compareScreenshots(stageShot, ruffleShot);
  462 | 
  463 |     if (mismatchRatio >= 0.20) {
  464 |       await testInfo.attach('stage-screenshot', { body: stageShot, contentType: 'image/png' });
  465 |       await testInfo.attach('ruffle-screenshot', { body: ruffleShot, contentType: 'image/png' });
  466 |     }
  467 | 
> 468 |     expect(mismatchRatio).toBeLessThan(0.20);
      |                           ^ Error: expect(received).toBeLessThan(expected)
  469 |   });
  470 | 
  471 |   // -------------------------------------------------------------------------
  472 |   // Test 5: static text — "Hello Flash 8" label at Arial 24px
  473 |   // -------------------------------------------------------------------------
  474 |   test('static text label renders consistently', async ({ page }, testInfo: TestInfo) => {
  475 |     const fixtureDoc = await page.evaluate(() => {
  476 |       return {
  477 |         id: 'visual-text-doc',
  478 |         properties: {
  479 |           width: 550, height: 400, frameRate: 12,
  480 |           backgroundColor: '#ffffff', rulerUnits: 'px',
  481 |           grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
  482 |           guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
  483 |         },
  484 |         scenes: [{
  485 |           id: 'scene-1', name: 'Scene 1',
  486 |           timeline: {
  487 |             layers: [{
  488 |               id: 'layer-Layer 1', name: 'Layer 1', type: 'normal',
  489 |               visible: true, locked: false, outlineMode: false,
  490 |               outlineColor: '#ff0000', height: 20, parentFolderId: null,
  491 |               frameCount: 1,
  492 |               frames: [{
  493 |                 index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
  494 |                 label: '', labelType: 'name', script: '', sound: null,
  495 |                 motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
  496 |                 motionOrientToPath: false, motionSync: false, motionScale: false,
  497 |                 shapeEase: 0, shapeBlend: 'distributive',
  498 |                 displayObjects: [{
  499 |                   id: 'text-1', type: 'text',
  500 |                   x: 100, y: 175, width: 300, height: 50,
  501 |                   text: 'Hello Flash 8',
  502 |                   textType: 'static',
  503 |                   fontFamily: 'Arial',
  504 |                   fontSize: 24,
  505 |                   bold: false,
  506 |                   italic: false,
  507 |                   color: { r: 0, g: 0, b: 0, a: 255 },
  508 |                   align: 'left',
  509 |                   multiline: false,
  510 |                   wordWrap: false,
  511 |                 }],
  512 |               }],
  513 |             }],
  514 |           },
  515 |         }],
  516 |         library: { items: [], folders: [] },
  517 |       };
  518 |     });
  519 | 
  520 |     const stageShot = await captureStageScreenshot(page, fixtureDoc);
  521 |     const ruffleShot = await captureRuffleScreenshot(page);
  522 | 
  523 |     const mismatchRatio = compareScreenshots(stageShot, ruffleShot);
  524 | 
  525 |     if (mismatchRatio >= 0.20) {
  526 |       await testInfo.attach('stage-screenshot', { body: stageShot, contentType: 'image/png' });
  527 |       await testInfo.attach('ruffle-screenshot', { body: ruffleShot, contentType: 'image/png' });
  528 |     }
  529 | 
  530 |     expect(mismatchRatio).toBeLessThan(0.20);
  531 |   });
  532 | 
  533 |   // -------------------------------------------------------------------------
  534 |   // Test 6: symbol instance — MovieClip placed on stage at 30° rotation
  535 |   // -------------------------------------------------------------------------
  536 |   test('symbol instance with rotation renders consistently', async ({ page }, testInfo: TestInfo) => {
  537 |     const fixtureDoc = await page.evaluate(() => {
  538 |       return {
  539 |         id: 'visual-symbol-doc',
  540 |         properties: {
  541 |           width: 550, height: 400, frameRate: 12,
  542 |           backgroundColor: '#ffffff', rulerUnits: 'px',
  543 |           grid: { showGrid: false, snapToGrid: false, gridColor: '#999999', gridWidth: 18, gridHeight: 18 },
  544 |           guides: [], snapToObjects: false, snapToPixels: false, snapToGuides: false,
  545 |         },
  546 |         scenes: [{
  547 |           id: 'scene-1', name: 'Scene 1',
  548 |           timeline: {
  549 |             layers: [{
  550 |               id: 'layer-Layer 1', name: 'Layer 1', type: 'normal',
  551 |               visible: true, locked: false, outlineMode: false,
  552 |               outlineColor: '#ff0000', height: 20, parentFolderId: null,
  553 |               frameCount: 1,
  554 |               frames: [{
  555 |                 index: 0, isKeyframe: true, isEmpty: false, tweenType: 'none',
  556 |                 label: '', labelType: 'name', script: '', sound: null,
  557 |                 motionEase: 0, motionRotate: 'none', motionRotateCount: 0,
  558 |                 motionOrientToPath: false, motionSync: false, motionScale: false,
  559 |                 shapeEase: 0, shapeBlend: 'distributive',
  560 |                 displayObjects: [{
  561 |                   id: 'inst-1', type: 'instance',
  562 |                   symbolId: 'sym-box',
  563 |                   x: 225, y: 150,
  564 |                   scaleX: 1, scaleY: 1,
  565 |                   rotation: 30,
  566 |                 }],
  567 |               }],
  568 |             }],
```