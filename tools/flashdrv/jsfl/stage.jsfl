// Differential generator — document stage fields in Contents (gap: stage dims/bg/fps).
// Ramps width, height, frameRate, backgroundColor one at a time from a fixed baseline so
// a per-stream XOR (fladiff.py) localizes each field and ramping reveals its encoding
// (LE int? twips? RGB order?). Layout is held byte-stable: same empty doc, single property.

function js(s){ return '"' + String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"'; }
function meta(name, wiring, actual){
  var m = "{\n";
  m += '  "name": '+js(name)+',\n  "fla": '+js(name+".fla")+',\n';
  if (wiring.twinGroup) m += '  "twinGroup": '+js(wiring.twinGroup)+',\n';
  if (wiring.baseline)  m += '  "baseline": '+js(wiring.baseline)+',\n';
  m += '  "actual": '+actual+'\n}\n';
  FLfile.write(OUT + name + ".meta.json", m);
}
function act(d){
  return '{ "width": '+d.width+', "height": '+d.height+', "frameRate": '+d.frameRate
       + ', "bg": '+js(d.backgroundColor)+' }';
}
function emit(name, wiring, mut){
  var d = fl.createDocument();          // default 550x400, 12fps, #FFFFFF
  if (mut) mut(d);
  meta(name, wiring, act(d));
  flashdrvSave(d, name);
}

// Baseline twins (default doc) — establish per-stream noise mask.
emit("s_base1", { twinGroup:"S" }, null);
emit("s_base2", { twinGroup:"S" }, null);
// Width ramp (px). 550 default -> reveals twips(x20) vs px and field offset.
emit("s_w600",  { baseline:"s_base1" }, function(d){ d.width = 600; });
emit("s_w800",  { baseline:"s_base1" }, function(d){ d.width = 800; });
emit("s_w1000", { baseline:"s_base1" }, function(d){ d.width = 1000; });
// Height ramp.
emit("s_h500",  { baseline:"s_base1" }, function(d){ d.height = 500; });
emit("s_h600",  { baseline:"s_base1" }, function(d){ d.height = 600; });
// Frame rate ramp (fps).
emit("s_fps24", { baseline:"s_base1" }, function(d){ d.frameRate = 24; });
emit("s_fps30", { baseline:"s_base1" }, function(d){ d.frameRate = 30; });
// Background colour ramp (distinct R/G/B to fix byte order).
emit("s_bgR",   { baseline:"s_base1" }, function(d){ d.backgroundColor = "#FF0000"; });
emit("s_bgG",   { baseline:"s_base1" }, function(d){ d.backgroundColor = "#00FF00"; });
emit("s_bgB",   { baseline:"s_base1" }, function(d){ d.backgroundColor = "#0000FF"; });
emit("s_bgX",   { baseline:"s_base1" }, function(d){ d.backgroundColor = "#123456"; });
