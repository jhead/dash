import sys,struct
d=open(sys.argv[1],'rb').read()
e=struct.unpack_from('<I',d,0x3C)[0]; coff=e+4
nsec,=struct.unpack_from('<H',d,coff+2); opt=coff+20
ddir=opt+96; imp_rva,_=struct.unpack_from('<II',d,ddir+8)
sh=opt+struct.unpack_from('<H',d,coff+16)[0]; secs=[]
for i in range(nsec):
    o=sh+i*40; vsz,vrva,rsz,rraw=struct.unpack_from('<IIII',d,o+8); secs.append((vrva,vsz,rraw,rsz))
def r(rva):
    for vrva,vsz,rraw,rsz in secs:
        if vrva<=rva<vrva+max(vsz,rsz): return rraw+(rva-vrva)
o=r(imp_rva); out={}
while True:
    olt,_,_,nm,ft=struct.unpack_from('<IIIII',d,o); o+=20
    if nm==0: break
    dn=d[r(nm):].split(b'\0',1)[0].decode(); to=r(olt or ft); fs=[]
    while True:
        v,=struct.unpack_from('<I',d,to); to+=4
        if v==0: break
        fs.append(f"#ord{v&0xffff}" if v&0x80000000 else d[r(v)+2:].split(b'\0',1)[0].decode())
    out[dn]=fs
bad=[s for fs in out.values() for s in fs if s in ("RtlWaitOnAddress","WaitOnAddress","RtlGetSystemTimePrecise","WakeByAddressSingle","WakeByAddressAll","GetSystemTimePreciseAsFileTime")]
for dn,fs in out.items(): print(f"== {dn} ({len(fs)}) ==\n  "+", ".join(sorted(fs)))
print("\n"+("CLEAN ✅ no Win8+ imports" if not bad else f"❌ Win8+ present: {bad}"))
