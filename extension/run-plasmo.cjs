const path = require("node:path")
const { spawnSync } = require("node:child_process")

const plasmoBin = require.resolve("plasmo/bin/index.mjs")
const gracefulFsPatch = path.resolve(__dirname, "require-graceful-fs.js").replace(/\\/g, "/")

const env = { ...process.env }
const reqArg = `--require="${gracefulFsPatch}"`
env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${reqArg}` : reqArg

const result = spawnSync(
  process.execPath,
  [`--require=${gracefulFsPatch}`, plasmoBin, ...process.argv.slice(2)],
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
