// Cluster A only: AS-export linkage, NO runtime-sharing (no URL, no RS/import). Decodes the
// linkage identifier string, exportForActionScript flag, and exportInFirstFrame flag — the
// core of §6.3 — without touching the RS path that pops a modal in session-0 Flash.
var ID = "Lk";
function js(s){ return '"' + String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"'; }
function readback(it){
  return { AS:!!it.linkageExportForAS, ff:!!it.linkageExportInFirstFrame,
           id:it.linkageIdentifier||"" };
}
function emit(name, wiring, spec){
  var doc = fl.createDocument();
  doc.library.addNewItem("movie clip", "Sym");
  var it = doc.library.items[doc.library.findItemIndex("Sym")];
  if (spec.AS) it.linkageExportForAS = true;
  if (spec.AS) it.linkageIdentifier = ID;
  it.linkageExportInFirstFrame = !!spec.ff;
  var got = readback(it);
  var m = "{\n  \"name\": "+js(name)+",\n  \"fla\": "+js(name+".fla")+",\n";
  if (wiring.twinGroup) m += "  \"twinGroup\": "+js(wiring.twinGroup)+",\n";
  if (wiring.baseline)  m += "  \"baseline\": "+js(wiring.baseline)+",\n";
  m += "  \"actual\": { \"AS\": "+got.AS+", \"ff\": "+got.ff+", \"id\": "+js(got.id)+" }\n}\n";
  FLfile.write(OUT + name + ".meta.json", m);
  flashdrvSave(doc, name);
}
// baseline: plain symbol, no linkage at all (all flags false, no id)
emit("la_none1", { twinGroup:"N" }, { AS:0, ff:0 });
emit("la_none2", { twinGroup:"N" }, { AS:0, ff:0 });
// AS-export on (+identifier "Lk", firstFrame default true)
emit("la_as",    { baseline:"la_none1" }, { AS:1, ff:1 });
// AS-export on but firstFrame off — isolates the firstFrame byte
emit("la_as_ff0",{ baseline:"la_as" },    { AS:1, ff:0 });
