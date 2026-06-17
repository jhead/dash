// Differential generator — symbol-linkage 4 flag bytes (gap #1, docs/21 §6.3).
//
// Emits a matrix of one-movieclip FLAs whose library symbol "Sym" has linkage set so that
// pairs differ by as few linkage flags as possible, holding the symbol shape + identifier
// (and, in cluster B, the URL) constant so the OLE2 file layout is byte-stable and a
// positional XOR isolates the flag's byte(s). Each .fla gets a sidecar <name>.meta.json with
// the INTENDED flag vector and the value JSFL READ BACK after Flash committed it (mutual-
// exclusion and URL rules silently override sets), plus its twin group / diff baseline. The
// host differ (tools/flashdrv/differ.py) consumes the corpus + sidecars with no hardcoded
// offsets.
//
// Hard-won Flash 8 JSFL constraints baked into this matrix (each one will hang or corrupt a
// naive batch — see FLA-RE-PLAN.md):
//   * Setting Export/Import-for-runtime-sharing WITHOUT a linkageURL pops a modal validation
//     dialog at save time -> headless Flash hangs forever. EVERY RS/import specimen has a URL.
//   * Export-for-ActionScript with NO RS/import DROPS the URL (read-back url==""), so URL
//     length is NOT stable between the AS-only cluster and the RS/import cluster -> two
//     separate equal-length clusters (A = no URL, B = URL present), never cross-diffed.
//   * Each doc must be saved+closed (flashdrvSave) before the next createDocument; leaving
//     several docs open at once also hangs the batch.
//
// Run:  flashdrv run --server http://<vmip>:8080 --script tools/flashdrv/jsfl/linkage.jsfl --out ./corpus/linkage --timeout 300
// Then: python3 tools/flashdrv/differ.py ./corpus/linkage

var ID  = "Lk";       // constant linkage identifier (constant length => stable layout)
var URL = "fd://x";   // constant URL for the runtime-sharing (cluster B) specimens

function jb(b){ return b ? "true" : "false"; }
function js(s){ return '"' + String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"'; }

// Set the linkage flags from a spec. CRITICAL: only ever set the runtime-sharing flags to
// TRUE -- ASSIGNING linkageExportForRS/linkageImportForRS = false (even on a symbol where it
// is already false) re-runs Flash's "runtime sharing needs a URL" validation and pops a modal
// that hangs headless Flash forever. A fresh createDocument symbol defaults all four false, so
// the unset flags are already false and need no assignment. Enablers (AS/RS/imp) are set
// BEFORE the identifier because Flash refuses linkageIdentifier unless an enabler is already
// on; every spec turns on at least one enabler. exportInFirstFrame is set explicitly (both
// values are safe and AS-export defaults it to true, so we must force false for the baseline).
// URL is set last (Flash only persists it when RS/import is on).
function setLinkage(item, s){
  if (s.AS)  item.linkageExportForAS  = true;
  if (s.RS)  item.linkageExportForRS  = true;
  if (s.imp) item.linkageImportForRS  = true;
  item.linkageIdentifier = ID;
  item.linkageExportInFirstFrame = !!s.ff;
  if (s.url) item.linkageURL = s.url;
}

function readback(item){
  // When import-for-RS is on, Flash reports the export booleans as `undefined`; coerce.
  return { AS:!!item.linkageExportForAS, RS:!!item.linkageExportForRS,
           imp:!!item.linkageImportForRS, ff:!!item.linkageExportInFirstFrame,
           id:item.linkageIdentifier, url:item.linkageURL || "" };
}

// name, intended spec, and differ wiring (twin group OR positional-diff baseline).
function build(name, spec, wiring){
  var doc = fl.createDocument();
  doc.library.addNewItem("movie clip", "Sym");
  var item = doc.library.items[doc.library.findItemIndex("Sym")];
  setLinkage(item, spec);
  var got = readback(item);

  var m = "{\n";
  m += '  "name": ' + js(name) + ',\n';
  m += '  "fla": ' + js(name + ".fla") + ',\n';
  if (wiring.twinGroup) m += '  "twinGroup": ' + js(wiring.twinGroup) + ',\n';
  if (wiring.baseline)  m += '  "baseline": '  + js(wiring.baseline)  + ',\n';
  m += '  "symbol": { "name": "Sym", "type": "movie clip" },\n';
  m += '  "intended": { "AS": '+jb(spec.AS)+', "ff": '+jb(spec.ff)+', "RS": '+jb(spec.RS)+', "imp": '+jb(spec.imp)+', "id": '+js(ID)+', "url": '+js(spec.url||"")+' },\n';
  m += '  "actual": { "AS": '+jb(got.AS)+', "ff": '+jb(got.ff)+', "RS": '+jb(got.RS)+', "imp": '+jb(got.imp)+', "id": '+js(got.id)+', "url": '+js(got.url)+' }\n';
  m += "}\n";
  FLfile.write(OUT + name + ".meta.json", m);

  flashdrvSave(doc, name);   // saves OUT+name+".fla" and closes the doc (required before next)
}

// ── Cluster A: AS-export, NO url, identical length. Decodes the exportInFirstFrame byte. ──
build("a_base1", { AS:1, ff:0, RS:0, imp:0 }, { twinGroup:"A" });
build("a_base2", { AS:1, ff:0, RS:0, imp:0 }, { twinGroup:"A" });
build("a_ff",    { AS:1, ff:1, RS:0, imp:0 }, { baseline:"a_base1" });  // delta: exportInFirstFrame F->T

// ── Cluster B: url present, identical length. Decodes AS, RS, import bytes. ──
build("b_base1", { AS:1, ff:0, RS:1, imp:0, url:URL }, { twinGroup:"B" });
build("b_base2", { AS:1, ff:0, RS:1, imp:0, url:URL }, { twinGroup:"B" });
build("b_as0",   { AS:0, ff:0, RS:1, imp:0, url:URL }, { baseline:"b_base1" });  // delta: exportForActionScript T->F
// RS<->import are mutually exclusive (can't toggle one alone), but the pair below moves RS
// off AND import on together; the differ matches each flag to its byte by change DIRECTION
// (RS 01->00, import 00->01), decoding both adjacent bytes at once.
build("b_imp",   { AS:0, ff:0, RS:0, imp:1, url:URL }, { baseline:"b_as0" });    // delta: RS T->F, import F->T
