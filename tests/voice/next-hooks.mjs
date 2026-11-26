// Resolve hook for the tests that load a route file (app/api/voice/*/route.ts, through
// importVoiceRoute in voice-fixtures.ts). The routes import "next/server", a package path without an
// "exports" map: Node's ES module resolver needs its file name, which the Next.js bundler finds by
// itself. Registered at run time, on top of tests/assistant/loader.mjs.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
}
