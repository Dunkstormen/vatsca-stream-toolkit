import fs from "node:fs";
import path from "node:path";

/** Reads and writes the JSON files in the data folder. Writes go through a temp file so a crash never leaves half a file. */
export class Store {
  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name: string): string {
    return path.join(this.dir, name);
  }

  read<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[store] ${name} unreadable, using defaults:`, (e as Error).message);
      return fallback;
    }
  }

  write(name: string, value: unknown): void {
    const target = this.file(name);
    const tmp = target + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, target);
  }
}
