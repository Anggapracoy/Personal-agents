export type SandboxProvider = {
  create(): Promise<void>;
  destroy(): Promise<void>;
  exec(command: string, options?: { timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  listOutputFiles(): Promise<string[]>;
};
