/**
 * That every edge function is at least syntactically a program.
 *
 * Nothing checked this. `npm run typecheck` reads `tsconfig`, which covers
 * `src/` — the browser app — and stops there. The function suites
 * (`check:scribe`, `check:checkpoints`) import the pure rule modules beside
 * each function, never `index.ts` itself, because `index.ts` calls
 * `Deno.serve` on import and reaches for `jsr:` and `npm:` specifiers Node
 * cannot resolve.
 *
 * So the entrypoint of every edge function — the file deciding who is allowed
 * in and what comes back — was the one file in the repository that nothing
 * read until a deploy read it. An `index.ts` could be merged with a syntax
 * error and CI would be entirely green. That is not hypothetical: an import
 * landed inside another import's braces, every check passed, the PR merged,
 * and the first thing to notice was `supabase functions deploy` rejecting the
 * bundle with "Expected ',', got '{'".
 *
 * Every import is treated as external, so this is a parse and not a link:
 * `jsr:@supabase/supabase-js@2` is read as the opaque string it is, and
 * neither a Deno install nor the network is needed. No type checking either.
 *
 * It is a low bar on purpose — "does this file parse" and nothing more. It is
 * also precisely the bar that was missing.
 */
import { build } from 'vite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../supabase/functions/', import.meta.url).pathname;

/** Every .ts file under supabase/functions — entrypoints and shared alike. */
function sources(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (entry.endsWith('.ts')) found.push(path);
  }
  return found.sort();
}

const files = sources(root);
if (files.length === 0) {
  console.log('FAIL  no edge function sources found — has the path moved?');
  process.exit(1);
}

let failures = 0;

for (const path of files) {
  const relative = path.slice(root.length);
  try {
    await build({
      logLevel: 'silent',
      build: {
        write: false,
        lib: { entry: path, formats: ['es'], fileName: 'parsed' },
        // Parse, do not link. Nothing is resolved, so a Deno-only specifier is
        // just a string and a missing module is not mistaken for a syntax error.
        rollupOptions: { external: () => true },
        minify: false,
      },
    });
    console.log(`  ok  ${relative}`);
  } catch (error) {
    failures += 1;
    const detail = (error?.message ?? String(error)).split('\n').slice(0, 4).join('\n      ');
    console.log(`FAIL  ${relative}\n      ${detail}`);
  }
}

console.log(
  failures === 0
    ? `\nAll ${files.length} edge function sources parse.\n`
    : `\n${failures} of ${files.length} FAILED to parse — a deploy would reject these.\n`,
);
process.exit(failures === 0 ? 0 : 1);
