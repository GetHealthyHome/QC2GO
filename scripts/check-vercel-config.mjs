// Validates vercel.json before it can reach a deploy.
//
// An invalid vercel.json does not fail the build or the tests — it fails at
// deploy time, after everything else has gone green, which is a slow and
// confusing place to find out. This ran too late once already: a `comment`
// property inside a headers entry is rejected by Vercel's schema, and the only
// signal was a failed deployment on the PR.
import fs from 'node:fs';

const problems = [];
const fail = (message) => problems.push(message);

let config;
try {
  config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
} catch (error) {
  console.error(`vercel.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

/** Vercel rejects unknown keys outright rather than ignoring them. */
const TOP_LEVEL = new Set([
  '$schema',
  'buildCommand',
  'cleanUrls',
  'devCommand',
  'framework',
  'headers',
  'ignoreCommand',
  'installCommand',
  'outputDirectory',
  'redirects',
  'regions',
  'rewrites',
  'trailingSlash',
]);
const ROUTE_ENTRY = new Set(['source', 'headers', 'has', 'missing']);
const HEADER_ENTRY = new Set(['key', 'value']);

for (const key of Object.keys(config)) {
  if (!TOP_LEVEL.has(key)) fail(`unknown top-level key: "${key}"`);
}

if (!Array.isArray(config.headers)) {
  fail('"headers" must be an array');
} else {
  config.headers.forEach((entry, index) => {
    const where = `headers[${index}]`;
    for (const key of Object.keys(entry)) {
      if (!ROUTE_ENTRY.has(key)) fail(`${where} has unsupported property "${key}"`);
    }
    if (typeof entry.source !== 'string') fail(`${where}.source must be a string`);
    if (!Array.isArray(entry.headers)) {
      fail(`${where}.headers must be an array`);
      return;
    }
    entry.headers.forEach((header, headerIndex) => {
      const headerWhere = `${where}.headers[${headerIndex}]`;
      for (const key of Object.keys(header)) {
        if (!HEADER_ENTRY.has(key)) fail(`${headerWhere} has unsupported property "${key}"`);
      }
      if (typeof header.key !== 'string') fail(`${headerWhere}.key must be a string`);
      if (typeof header.value !== 'string') fail(`${headerWhere}.value must be a string`);
    });
  });
}

// The build has to actually produce what the config points Vercel at.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (config.buildCommand && !Object.values(pkg.scripts ?? {}).length) {
  fail('package.json has no scripts but vercel.json sets a buildCommand');
}
const scriptName = config.buildCommand?.replace(/^npm run /, '');
if (scriptName && !pkg.scripts?.[scriptName]) {
  fail(`buildCommand runs "${scriptName}", which is not a script in package.json`);
}

if (problems.length) {
  console.error(`vercel.json has ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('vercel.json OK');
