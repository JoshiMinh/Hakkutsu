const path = require("node:path")
const { spawnSync } = require("node:child_process")

const plasmoBin = require.resolve("plasmo/bin/index.mjs")
const gracefulFsPatch = path.resolve(__dirname, "require-graceful-fs.js").replace(/\\/g, "/")

const env = { ...process.env }
const reqArg = `-r "${gracefulFsPatch}"`
env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${reqArg}` : reqArg

// Limit Parcel concurrency on Windows to prevent EMFILE descriptor exhaustion
if (!env.PARCEL_WORKER_BACKEND) {
  env.PARCEL_WORKER_BACKEND = "process"
}
if (!env.PARCEL_WORKERS) {
  env.PARCEL_WORKERS = "2"
}
if (!env.PARCEL_MAX_CONCURRENT_CALLS) {
  env.PARCEL_MAX_CONCURRENT_CALLS = "10"
}
if (!env.UV_THREADPOOL_SIZE) {
  env.UV_THREADPOOL_SIZE = "64"
}

const result = spawnSync(
  process.execPath,
  ["-r", gracefulFsPatch, plasmoBin, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env,
    stdio: "inherit"
  }
)

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)

