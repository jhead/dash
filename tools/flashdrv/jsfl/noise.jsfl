// Noise-floor probe: save the same empty doc twice. Diff base_a.fla vs base_b.fla on the
// host to find volatile (timestamp/GUID) byte offsets to mask. Run before any generator batch.
var a=fl.createDocument(); flashdrvSave(a,"base_a");
var b=fl.createDocument(); flashdrvSave(b,"base_b");
