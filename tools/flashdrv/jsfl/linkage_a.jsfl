// Linkage batch A: cluster A (exportForAS, no URL). 3 saves.
var ID = "Lk";
function jb(b){ return b ? "true" : "false"; }
function js(s){ return '"' + String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"'; }
function setLinkage(item, s){
  if (s.AS)  item.linkageExportForAS  = true;
  if (s.RS)  item.linkageExportForRS  = true;
  if (s.imp) item.linkageImportForRS  = true;
  item.linkageIdentifier = ID;
  item.linkageExportInFirstFrame = !!s.ff;
  if (s.url) item.linkageURL = s.url;
}
function readback(item){
  return { AS:!!item.linkageExportForAS, RS:!!item.linkageExportForRS,
           imp:!!item.linkageImportForRS, ff:!!item.linkageExportInFirstFrame,
           id:item.linkageIdentifier, url:item.linkageURL || "" };
}
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
  flashdrvSave(doc, name);
}
// Cluster A: AS-export only, no URL. Decodes exportInFirstFrame byte.
build("a_base1", { AS:1, ff:0, RS:0, imp:0 }, { twinGroup:"A" });
build("a_base2", { AS:1, ff:0, RS:0, imp:0 }, { twinGroup:"A" });
build("a_ff",    { AS:1, ff:1, RS:0, imp:0 }, { baseline:"a_base1" });
