// Minimal probe: one doc with one movieclip symbol, no linkage. Isolates whether the
// library/addNewItem path (vs linkage) is what stalls the batch. Also a twin for masking.
var a = fl.createDocument();
a.library.addNewItem("movie clip", "Sym");
flashdrvSave(a, "lib_a");
var b = fl.createDocument();
b.library.addNewItem("movie clip", "Sym");
flashdrvSave(b, "lib_b");
