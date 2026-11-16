// Module-resolution hooks that let Node 24 run the assistant's TypeScript sources directly, using
// Node's built-in type stripping: no build step and no extra dev dependency.
//
// It teaches Node the two things the Next.js toolchain normally resolves for us:
//   - the "@/..." path alias from tsconfig.json  (→ repo root)
//   - extensionless relative imports between .ts files ("./types" → "./types.ts")
//
// Registered by tests/assistant/register.mjs:  node --import ./tests/assistant/register.mjs <file>
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];

function findFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const index = path.join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = findFile(path.join(ROOT, specifier.slice(2)));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    const parent = fileURLToPath(context.parentURL);
    if (/\.(ts|mts)$/.test(parent)) {
      const found = findFile(path.resolve(path.dirname(parent), specifier));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
