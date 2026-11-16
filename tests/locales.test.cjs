const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { loader } = require("./load-typescript.cjs");
const load = loader();
const languages = ["en", "vi", "ja", "zh", "ko", "es", "fr", "id"];
const locales = Object.fromEntries(languages.map(lang => [lang, load(`src/shared/locales/${lang}.ts`)[lang]]));

test("all eight complete locales have identical keys, nonempty strings and matching placeholders", () => {
  const keys = Object.keys(locales.en).sort();
  const placeholders = value => (value.match(/\{[a-zA-Z_]\w*\}|%[sd]/g) || []).sort();
  for (const [lang, locale] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(locale).sort(), keys, `${lang} keys`);
    for (const key of keys) {
      assert.equal(typeof locale[key], "string", `${lang}.${key}`);
      assert.ok(locale[key].trim(), `${lang}.${key} is empty`);
      assert.deepEqual(placeholders(locale[key]), placeholders(locales.en[key]), `${lang}.${key} placeholders`);
    }
  }
});

test("literal translation references exist and locale objects do not duplicate keys", () => {
  function inspect(file) {
    const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        assert.ok(node.arguments[0].text in locales.en, `${file}: missing ${node.arguments[0].text}`);
      }
      if (file.includes(`${path.sep}locales${path.sep}`) && ts.isObjectLiteralExpression(node)) {
        const keys = node.properties.filter(ts.isPropertyAssignment).map(property => property.name.getText(ast));
        assert.equal(new Set(keys).size, keys.length, `${file}: duplicate locale keys`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(entry.name)) inspect(file);
    }
  }
  walk(path.resolve(__dirname, "../src"));
});
