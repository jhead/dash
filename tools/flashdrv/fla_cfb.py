#!/usr/bin/env python3
"""Dependency-free OLE2 / Compound File Binary (CFB) reader for FLA files.

FLA documents (Flash 5 .. CS4) are CFB containers. This module extracts the named
streams (Contents, Page N, Symbol N, ...) so the structural parser (flaparse.py) can
walk them. Implements MS-CFB v3/v4 including the mini-FAT for sub-cutoff streams.

Usage:
  from fla_cfb import CFB
  cfb = CFB(open("x.fla","rb").read())
  cfb.names()                 # list of stream/storage names
  cfb.read("Contents")        # bytes of a stream (searched across all storages)
  cfb.dump_tree()             # print directory tree
"""
import struct
import sys

ENDOFCHAIN = 0xFFFFFFFE
FREESECT = 0xFFFFFFFF
FATSECT = 0xFFFFFFFD
DIFSECT = 0xFFFFFFFC
NOSTREAM = 0xFFFFFFFF


class DirEntry:
    __slots__ = ("name", "type", "left", "right", "child", "start", "size", "idx")

    def __init__(self, name, type_, left, right, child, start, size, idx):
        self.name = name
        self.type = type_      # 1=storage 2=stream 5=root
        self.left = left
        self.right = right
        self.child = child
        self.start = start
        self.size = size
        self.idx = idx


class CFB:
    def __init__(self, data: bytes):
        self.data = data
        if data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
            raise ValueError("not a CFB file (bad magic)")
        (self.minor, self.major, self.byte_order, self.sector_pow, self.mini_pow) = \
            struct.unpack_from("<HHHHH", data, 24)
        self.sector_size = 1 << self.sector_pow
        self.mini_sector_size = 1 << self.mini_pow
        (self.num_dir_sectors, self.num_fat_sectors, self.first_dir_sector,
         self.transaction_sig, self.mini_cutoff, self.first_minifat_sector,
         self.num_minifat_sectors, self.first_difat_sector,
         self.num_difat_sectors) = struct.unpack_from("<IIIIIIIII", data, 40)
        self.difat = list(struct.unpack_from("<109I", data, 76))
        self._read_difat_extra()
        self._read_fat()
        self._read_dir()
        self._read_minifat()
        self._build_index()

    # ---- sector helpers ----
    def _sector_offset(self, sector):
        return 512 + sector * self.sector_size

    def _read_sector(self, sector):
        off = self._sector_offset(sector)
        return self.data[off:off + self.sector_size]

    def _read_difat_extra(self):
        sect = self.first_difat_sector
        per = self.sector_size // 4
        while sect != ENDOFCHAIN and sect != FREESECT and self.num_difat_sectors:
            raw = self._read_sector(sect)
            vals = struct.unpack_from("<%dI" % per, raw, 0)
            self.difat.extend(vals[:-1])
            sect = vals[-1]

    def _read_fat(self):
        self.fat = []
        per = self.sector_size // 4
        for s in self.difat:
            if s == FREESECT or s == ENDOFCHAIN:
                continue
            raw = self._read_sector(s)
            self.fat.extend(struct.unpack_from("<%dI" % per, raw, 0))

    def _chain(self, start):
        out = []
        s = start
        seen = set()
        while s != ENDOFCHAIN and s != FREESECT:
            if s in seen or s >= len(self.fat):
                break
            seen.add(s)
            out.append(s)
            s = self.fat[s]
        return out

    def _read_chain(self, start, size=None):
        buf = bytearray()
        for s in self._chain(start):
            buf += self._read_sector(s)
        if size is not None:
            return bytes(buf[:size])
        return bytes(buf)

    def _read_dir(self):
        raw = self._read_chain(self.first_dir_sector)
        self.entries = []
        n = len(raw) // 128
        for i in range(n):
            base = i * 128
            name_len = struct.unpack_from("<H", raw, base + 64)[0]
            if name_len == 0:
                name = ""
            else:
                name = raw[base:base + name_len - 2].decode("utf-16-le", "replace")
            type_ = raw[base + 66]
            left, right, child = struct.unpack_from("<III", raw, base + 68)
            start, size_lo, size_hi = struct.unpack_from("<III", raw, base + 116)
            size = size_lo | (size_hi << 32)
            self.entries.append(DirEntry(name, type_, left, right, child, start, size, i))
        self.root = self.entries[0]
        # root entry's stream = the mini-stream container
        self.mini_stream = self._read_chain(self.root.start, self.root.size)

    def _read_minifat(self):
        raw = self._read_chain(self.first_minifat_sector)
        per = len(raw) // 4
        self.minifat = list(struct.unpack_from("<%dI" % per, raw, 0)) if per else []

    def _read_mini_chain(self, start, size):
        buf = bytearray()
        s = start
        seen = set()
        while s != ENDOFCHAIN and s != FREESECT and s < len(self.minifat):
            if s in seen:
                break
            seen.add(s)
            off = s * self.mini_sector_size
            buf += self.mini_stream[off:off + self.mini_sector_size]
            s = self.minifat[s]
        return bytes(buf[:size])

    def _build_index(self):
        self.by_name = {}
        for e in self.entries:
            if e.type in (2, 5) and e.name:
                self.by_name.setdefault(e.name, e)

    def stream_bytes(self, e: DirEntry) -> bytes:
        if e.size < self.mini_cutoff and e.type != 5:
            return self._read_mini_chain(e.start, e.size)
        return self._read_chain(e.start, e.size)

    # ---- public ----
    def names(self):
        return [e.name for e in self.entries if e.type == 2]

    def read(self, name) -> bytes:
        e = self.by_name.get(name)
        if e is None:
            raise KeyError(name)
        return self.stream_bytes(e)

    def streams(self):
        """dict name -> bytes for all streams."""
        return {e.name: self.stream_bytes(e) for e in self.entries if e.type == 2 and e.name}

    def stream_file_offset(self, name, stream_off):
        """Map a stream-relative byte offset to its absolute file offset. Supports main-FAT
        streams (size >= cutoff) directly; mini-FAT streams map through the root mini-stream
        (which itself lives in main-FAT sectors)."""
        e = self.by_name[name]
        if e.size >= self.mini_cutoff or e.type == 5:
            sect = self._chain(e.start)[stream_off // self.sector_size]
            return self._sector_offset(sect) + (stream_off % self.sector_size)
        # mini stream: find mini-sector, then where that mini-sector lives in the root stream
        mini_idx = stream_off // self.mini_sector_size
        s = e.start
        for _ in range(mini_idx):
            s = self.minifat[s]
        root_byte = s * self.mini_sector_size + (stream_off % self.mini_sector_size)
        root_sect = self._chain(self.root.start)[root_byte // self.sector_size]
        return self._sector_offset(root_sect) + (root_byte % self.sector_size)

    def patch(self, name, stream_off, newbytes):
        """Return a NEW file-bytes bytearray with `newbytes` written at the given stream
        offset of stream `name`. Handles sector boundaries byte-by-byte."""
        out = bytearray(self.data)
        for k, b in enumerate(newbytes):
            out[self.stream_file_offset(name, stream_off + k)] = b
        return out

    def dump_tree(self):
        for e in self.entries:
            tname = {1: "storage", 2: "stream", 5: "root"}.get(e.type, "?%d" % e.type)
            if e.type in (2, 5):
                print("  %-22s %-8s size=%d" % (repr(e.name), tname, e.size))


if __name__ == "__main__":
    cfb = CFB(open(sys.argv[1], "rb").read())
    print("sector=%d mini=%d cutoff=%d" % (cfb.sector_size, cfb.mini_sector_size, cfb.mini_cutoff))
    cfb.dump_tree()
