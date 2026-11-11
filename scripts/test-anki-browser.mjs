import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Uses an isolated Chrome profile and a fixture whose Anki requests never leave the page.
const profile = await mkdtemp(path.join(tmpdir(), "hakkutsu-anki-browser-"));
const executable = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const processHandle = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-networking",
  "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
try {
  let port;
  for (let index = 0; index < 150; index++) {
    try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!port) throw new Error("Chrome did not start its isolated debugging endpoint");
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map(), exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id); pending.delete(message.id);
      if (message.error) call?.reject(new Error(JSON.stringify(message.error))); else call?.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Page.navigate", { url: "http://127.0.0.1:4173/tests/anki.html" });
  let status;
  for (let index = 0; index < 600; index++) {
    status = await evaluate("({result:document.documentElement.dataset.result, text:document.querySelector('#results')?.textContent})");
    if (status?.result || exceptions.length) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log(status?.text);
  if (exceptions.length) throw new Error(exceptions.join("\n"));
  if (status?.result !== "passed") throw new Error("Browser integration checks did not pass");
  await mkdir("test-results", { recursive: true });
  const responsive = [];
  for (const width of [320, 768, 1024, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.querySelector('dialog').showModal()");
    await new Promise(resolve => setTimeout(resolve, 100));
    const fits = await evaluate("document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth + 1");
    const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(`test-results/anki-${width}.png`, Buffer.from(screenshot.data, "base64"));
    if (!fits) {
      console.log(await evaluate("Array.from(document.querySelectorAll('dialog,dialog *')).filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({tag:e.tagName,class:e.className,width:e.clientWidth,scroll:e.scrollWidth,text:e.textContent.slice(0,90)}))"));
      throw new Error(`Sync preview overflows at ${width}px`);
    }
    await evaluate("document.querySelector('dialog').close()");
    responsive.push({ width, fits });
  }
  await writeFile("test-results/anki-browser.json", JSON.stringify({ ...status, responsive, exceptions }, null, 2));
  console.log("PASS responsive sync preview at 320, 768, 1024, 1440px");
  await cdp("Browser.close");
} finally {
  socket?.close(); processHandle.kill();
  const resolvedProfile = path.resolve(profile);
  if (path.dirname(resolvedProfile) !== path.resolve(tmpdir()) || !path.basename(resolvedProfile).startsWith("hakkutsu-anki-browser-")) {
    throw new Error("Refusing to clean a browser profile outside the task's temporary directory");
  }
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 25, retryDelay: 100 });
}
