// Preview real popup components with disposable extension APIs, without touching user data.
const listener = { addListener() {}, removeListener() {} };
Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
  storage: { sync: { async get() { return {}; }, async set() {}, async remove() {} }, onChanged: listener },
  runtime: { onMessage: listener, getURL: (url: string) => `/${url}`, async sendMessage() { return { payload: {} }; } },
  tabs: { async query() { return []; }, async create() {} },
} });
void import("../src/entrypoints/popup/main");
