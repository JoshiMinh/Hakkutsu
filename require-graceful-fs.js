// Patches Node's built-in `fs` (both sync and async) and `fs.promises` with retry logic
// so that EMFILE errors (too many open files) are queued/retried instead of crashing Parcel.
// Required on Windows where Node 20+ native bindings (like readFileSync) bypass openSync.
const fs = require('fs');
const gracefulFs = require('graceful-fs');

// 1. Standard graceful-fs patch for callback-based functions
gracefulFs.gracefulify(fs);

// 2. Patch synchronous fs methods for EMFILE retries
// In Node 20+, methods like readFileSync use native C++ bindings directly
// and do not call fs.openSync, bypassing graceful-fs.
const syncMethodsToPatch = [
  'readFileSync',
  'writeFileSync',
  'readdirSync',
  'statSync',
  'lstatSync',
  'realpathSync',
  'existsSync',
  'accessSync',
  'openSync',
  'copyFileSync',
  'mkdirSync',
  'rmSync',
  'rmdirSync',
  'unlinkSync'
];

const sab = new SharedArrayBuffer(4);
const int32 = new Int32Array(sab);

function sleepSync(ms) {
  try {
    Atomics.wait(int32, 0, 0, ms);
  } catch {
    const stop = Date.now() + ms;
    while (Date.now() < stop) {}
  }
}

const nodeModulesFileCache = new Map();

for (const method of syncMethodsToPatch) {
  if (typeof fs[method] === 'function') {
    const orig = fs[method];
    if (method === 'readFileSync') {
      fs[method] = function (file, options) {
        // Only cache immutable node_modules files (never .plasmo or project source files)
        if (typeof file === 'string' && file.includes('node_modules') && !file.includes('.plasmo')) {
          const cacheKey = `${file}:${typeof options === 'object' ? JSON.stringify(options) : options}`;
          if (nodeModulesFileCache.has(cacheKey)) {
            return nodeModulesFileCache.get(cacheKey);
          }
          let retries = 0;
          while (true) {
            try {
              const res = orig.call(this, file, options);
              nodeModulesFileCache.set(cacheKey, res);
              return res;
            } catch (err) {
              if (err && (err.code === 'EMFILE' || err.code === 'ENFILE' || err.code === 'EBUSY') && retries < 500) {
                retries++;
                sleepSync(10 + Math.floor(Math.random() * 20));
              } else {
                throw err;
              }
            }
          }
        }
        let retries = 0;
        while (true) {
          try {
            return orig.apply(this, arguments);
          } catch (err) {
            if (err && (err.code === 'EMFILE' || err.code === 'ENFILE' || err.code === 'EBUSY') && retries < 500) {
              retries++;
              sleepSync(10 + Math.floor(Math.random() * 20));
            } else {
              throw err;
            }
          }
        }
      };
    } else {
      fs[method] = function (...args) {
        let retries = 0;
        while (true) {
          try {
            return orig.apply(this, args);
          } catch (err) {
            if (err && (err.code === 'EMFILE' || err.code === 'ENFILE' || err.code === 'EBUSY') && retries < 500) {
              retries++;
              sleepSync(10 + Math.floor(Math.random() * 20));
            } else {
              throw err;
            }
          }
        }
      };
    }
  }
}

// 3. Patch promise-based fs methods
if (fs.promises) {
  const patchPromiseFn = (fn) => {
    if (typeof fn !== 'function') return fn;
    return async function (...args) {
      let retries = 0;
      while (true) {
        try {
          return await fn.apply(this, args);
        } catch (err) {
          if (err && (err.code === 'EMFILE' || err.code === 'ENFILE' || err.code === 'EBUSY') && retries < 200) {
            retries++;
            await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 20)));
          } else {
            throw err;
          }
        }
      }
    };
  };

  const promiseMethodsToPatch = [
    'open',
    'readFile',
    'writeFile',
    'readdir',
    'stat',
    'lstat',
    'access',
    'copyFile',
    'unlink',
    'mkdir',
    'rmdir',
    'rm',
    'realpath'
  ];

  for (const method of promiseMethodsToPatch) {
    if (typeof fs.promises[method] === 'function') {
      fs.promises[method] = patchPromiseFn(fs.promises[method]);
    }
  }
}

// 4. Patch callback-based async fs methods for EMFILE retries
const callbackMethodsToPatch = [
  'readFile',
  'writeFile',
  'open',
  'readdir',
  'stat',
  'lstat',
  'access',
  'copyFile',
  'unlink'
];

for (const method of callbackMethodsToPatch) {
  if (typeof fs[method] === 'function') {
    const orig = fs[method];
    fs[method] = function (...args) {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        let retries = 0;
        const attempt = () => {
          const newArgs = [...args];
          newArgs[newArgs.length - 1] = function (err, ...res) {
            if (err && (err.code === 'EMFILE' || err.code === 'ENFILE' || err.code === 'EBUSY') && retries < 200) {
              retries++;
              setTimeout(attempt, 10 + Math.floor(Math.random() * 20));
            } else {
              cb.call(this, err, ...res);
            }
          };
          orig.apply(fs, newArgs);
        };
        attempt();
        return;
      }
      return orig.apply(this, args);
    };
  }
}


