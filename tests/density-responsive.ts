export async function runDensityResponsiveTests() {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;top:0;left:0;height:800px;border:0;z-index:2147483645";
  document.body.append(frame);
  try {
    for (const width of [320, 768, 1024, 1440]) {
      frame.style.width = `${width}px`;
      await new Promise<void>((resolve, reject) => {
        frame.onload = () => resolve(); frame.onerror = () => reject(new Error("Preview failed to load"));
        frame.src = `/tests/page-difficulty.preview.html?width=${width}`;
      });
      const end = performance.now() + 4000;
      while (!frame.contentDocument?.querySelector("#preview .hk-difficulty__panel")) {
        if (performance.now() > end) throw new Error("Preview failed to render");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const panel = frame.contentDocument!.querySelector<HTMLElement>("#preview .hk-difficulty__panel")!;
      const rect = panel.getBoundingClientRect();
      if (rect.left < 0 || rect.right > width || panel.scrollWidth > panel.clientWidth) throw new Error(`Panel overflow at ${width}px`);
      const select = panel.querySelector("select")!;
      if (select.getBoundingClientRect().height < 44) throw new Error(`Undersized reading control at ${width}px`);
      if (!panel.textContent?.includes("70%")) throw new Error("Coverage requirement missing");
    }
  } finally { frame.remove(); }
}
