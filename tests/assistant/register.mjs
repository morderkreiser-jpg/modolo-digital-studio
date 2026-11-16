// Registers tests/assistant/loader.mjs. Usage:
//   node --import ./tests/assistant/register.mjs --test tests/assistant/*.test.ts
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
