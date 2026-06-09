export interface FileIOAdapter {
  openFile(): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveFile(bytes: Uint8Array, suggestedName: string): Promise<boolean>;
}

// In-memory implementation for testing
export const memoryFileIO: FileIOAdapter = {
  openFile: async () => null,
  saveFile: async () => true,
};
