// Developer-only replay of ignored public-page captures; never ships with WXT.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { analyzePageDensity } from "../src/features/analytics/page-analyzer";
import { resolveDensityVocabulary } from "../src/features/analytics/density-vocabulary";
import { PageDifficultyPanel } from "../src/features/analytics/page-difficulty-panel";
import "../src/styles/global.css";

const name = new URLSearchParams(location.search).get("page") === "mixed" ? "mixed" : "syosetu";
const captured = await fetch(`/.cache/density-manual/${name}.json`).then(response => response.json());
const doc = new DOMParser().parseFromString(captured.html, "text/html");
doc.querySelectorAll("script,style,link,meta,iframe,img,svg,canvas,object,embed,video,audio,form").forEach(element => element.remove());
for (const element of doc.querySelectorAll("*")) {
  for (const attribute of [...element.attributes]) {
    if (!["class", "id", "hidden", "aria-hidden", "lang"].includes(attribute.name)) element.removeAttribute(attribute.name);
  }
}
document.body.replaceChildren(...[...doc.body.childNodes].map(node => document.importNode(node, true)));
Object.defineProperty(globalThis, "chrome", {configurable:true,value:{runtime:{sendMessage:async (message: any) => {
  if (message.type === "GET_DENSITY_KNOWLEDGE") return {type:"ERROR",payload:{error:"Replay has no access to extension SRS"}};
  return {type:"DENSITY_VOCABULARY_RESULT",payload:{words:await resolveDensityVocabulary(message.payload.texts)}};
}}}});
const result = await analyzePageDensity();
const chapter = document.querySelector("#novel_honbun, .p-novel__body .js-novel-text:not(.p-novel__text--preface):not(.p-novel__text--afterword)");
if (chapter) {
  const scoped = await analyzePageDensity(chapter);
  if (scoped.totalWords !== result.totalWords || scoped.totalKanji !== result.totalKanji) throw new Error("Chapter scope mismatch");
}
const mount = document.createElement("div"); mount.className = "hk-popup"; document.body.append(mount);
const evidence = document.createElement("pre"); evidence.style.cssText = "position:fixed;right:16px;top:16px;max-width:320px;max-height:50vh;overflow:auto;background:#141416;color:#fafafa;padding:16px;z-index:2147483640";
evidence.textContent = JSON.stringify({source:captured.url,scope:result.scope,words:result.totalWords,uniqueWords:result.uniqueWords,coverage:Math.round(result.coverage),scriptDensity:Math.round(result.scriptDensity),kanji:result.totalKanji,level:result.dominantLevel},null,2);
mount.append(evidence);
const panel = document.createElement("div"); mount.append(panel);
function Preview() {
  const [expanded,setExpanded] = useState(true);
  return <PageDifficultyPanel analysis={result} vietnamese={false} expanded={expanded} onExpandedChange={setExpanded} loading={false}
    furiganaLoading={false} furiganaActive={false} furiganaMode="all" furiganaMessage="" furiganaError={false}
    onToggleFurigana={()=>{}} onModeChange={()=>{}} onRescan={()=>location.reload()} />;
}
createRoot(panel).render(<Preview />);
