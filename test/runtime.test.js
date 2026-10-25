const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("the API boots and sanitizes HTML without synchronous require(ESM) support", () => {
  // Node locally supports require(ESM), which hid the production loader failure.
  // Disable that feature to catch incompatible transitive imports at startup.
  const result = spawnSync(process.execPath, ["--no-experimental-require-module", "-e", `
    const assert = require("node:assert/strict");
    const db = require.resolve("./src/config/db");
    require.cache[db] = { id: db, filename: db, loaded: true, exports: async () => {} };
    const secret = require.resolve("./secret");
    require.cache[secret] = { id: secret, filename: secret, loaded: true, exports: {} };
    const app = require("./api/index");
    assert.equal(typeof app, "function");
    const { sanitizeRichText } = require("./src/utils/inputSecurity");
    const clean = sanitizeRichText('<p>Safe <strong>text</strong></p><script>alert(1)</script><img src=x onerror=alert(1)>');
    assert.match(clean, /<strong>text<\\/strong>/);
    assert.doesNotMatch(clean, /script|onerror|<img/i);
    console.log("CommonJS API bootstrap and sanitization passed");
  `], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, VERCEL: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /bootstrap and sanitization passed/);
});
