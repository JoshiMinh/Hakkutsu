const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Load the production TS directly; no parallel implementation or test framework dependency.
function loader(mocks = {}) {
  const cache = new Map();
  return function load(file) {
    const absolute = path.resolve(__dirname, "..", file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} }; cache.set(absolute, module);
    const source = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const localRequire = id => {
      if (id in mocks) return mocks[id];
      if (id.endsWith(".json")) return JSON.parse(fs.readFileSync(id.startsWith("~/") ? path.resolve(__dirname,"../src",id.slice(2)) : path.resolve(path.dirname(absolute),id),"utf8"));
      if (id.startsWith("~/")) return load(`src/${id.slice(2)}.ts`);
      if (id.startsWith(".")) return load(path.relative(path.resolve(__dirname, ".."), path.resolve(path.dirname(absolute), `${id}.ts`)));
      return require(id);
    };
    vm.runInThisContext(`(function(exports,require,module){${source}\n})`, { filename: absolute })(module.exports, localRequire, module);
    return module.exports;
  };
}

module.exports = { loader };
