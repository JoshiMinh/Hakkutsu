// Patches Node's built-in `fs` with `graceful-fs` so that EMFILE errors
// (too many open files) are queued and retried instead of crashing Parcel.
// Required on Windows where the file descriptor limit is lower than Linux/macOS.
require('graceful-fs').gracefulify(require('fs'));
