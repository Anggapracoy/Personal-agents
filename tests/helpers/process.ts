import { spawnSync as nativeSpawnSync, type SpawnSyncOptions } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Linux limits the size of a single argv entry. Controller fixtures are larger
// than that limit; load their source from a temporary file while preserving
// Python -c argv semantics and leaving stdin available for the test's input.
export const spawnSync: typeof nativeSpawnSync = ((
  command: string,
  argsOrOptions?: readonly string[] | SpawnSyncOptions,
  options?: SpawnSyncOptions,
) => {
  if (!Array.isArray(argsOrOptions)) return nativeSpawnSync(command, argsOrOptions as SpawnSyncOptions);
  const args = argsOrOptions as readonly string[];
  if (command !== 'python3' || args[0] !== '-c' || typeof args[1] !== 'string') return nativeSpawnSync(command, args, options);
  const directory = mkdtempSync(join(tmpdir(), 'dash-python-test-'));
  const path = join(directory, 'program.py');
  try {
    writeFileSync(path, args[1], { mode: 0o600 });
    const loader = "import sys; from pathlib import Path; _source=Path(sys.argv.pop(1)).read_text(encoding='utf-8'); exec(compile(_source, '<string>', 'exec'))";
    return nativeSpawnSync(command, ['-c', loader, path, ...args.slice(2)], options);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}) as typeof nativeSpawnSync;
