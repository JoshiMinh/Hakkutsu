const path = require("node:path")
const { spawnSync } = require("node:child_process")

const plasmoBin = require.resolve("plasmo/bin/index.mjs")
const gracefulFsPatch = path.resolve(__dirname, "require-graceful-fs.js")

const result = spawnSync(
  process.execPath,
  [`--require=${gracefulFsPatch}`, plasmoBin, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  }
)

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
