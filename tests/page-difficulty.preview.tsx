import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PageDifficultyPanel } from "../src/features/analytics/page-difficulty-panel";
import type { SelectiveFuriganaMode } from "../src/features/settings/types";
import type { PageDensityAnalysis } from "../src/features/analytics/types";
import "../src/styles/global.css";

const sample: PageDensityAnalysis = {
  url: "https://example.test/preview", totalJapaneseChars: 5269, totalKanji: 5269, uniqueKanji: 1123,
  jlptDistribution: { N5:1001,N4:211,N3:105,N2:0,N1:0,unranked:3952 },
  percentages: {N5:19,N4:4,N3:2,N2:0,N1:0,unranked:75}, dominantLevel:null, scope:"article", totalTextChars:7000, scriptDensity:75, totalWords:5269, uniqueWords:1234, coverage:25, vocabularyStatus:"available", familiarity:{status:"available",mature:300,learning:200,notSaved:4769},
};
function Preview() {
  const [expanded,setExpanded]=useState(true);
  const [active,setActive]=useState(false);
  const [loading,setLoading]=useState(false);
  const [mode,setMode]=useState<SelectiveFuriganaMode>("unlearned");
  return <PageDifficultyPanel analysis={sample} vietnamese expanded={expanded} onExpandedChange={setExpanded}
    loading={loading} furiganaLoading={false} furiganaActive={active} furiganaMode={mode}
    furiganaMessage="" furiganaError={false} onToggleFurigana={()=>setActive(!active)} onModeChange={setMode}
    onRescan={()=>{setLoading(true);setTimeout(()=>setLoading(false),650);}} />;
}
createRoot(document.querySelector("#preview")!).render(<Preview />);

const observer=new MutationObserver(()=>{
  const original=document.querySelector<HTMLElement>("#preview .hk-difficulty");
  if(!original?.querySelector(".hk-difficulty__panel"))return;
  observer.disconnect();
  for(const state of ["default","hover","focus","active","disabled","loading","error","success"]){
    const wrapper=document.createElement("div");wrapper.className="demo-state";
    const label=document.createElement("p");label.textContent=`Style preview · ${state}`;
    const clone=original.cloneNode(true) as HTMLElement;
    const ids=new Map<string,string>();
    for(const element of clone.querySelectorAll<HTMLElement>("[id]")){const old=element.id;element.id=`${state}-${old}`;ids.set(old,element.id);}
    for(const element of clone.querySelectorAll<HTMLElement>("*"))for(const attr of ["for","aria-labelledby","aria-controls"]){const value=element.getAttribute(attr);if(value)element.setAttribute(attr,ids.get(value)||value);}
    const toggle=clone.querySelector<HTMLButtonElement>(".hk-difficulty__toggle")!;
    toggle.classList.add(`is-${state}`);
    if(state==="disabled")toggle.disabled=true;
    const controls=clone.querySelector<HTMLElement>(".hk-difficulty__furigana")!;controls.dataset.state=state;
    if(state==="success"){toggle.setAttribute("aria-pressed","true");toggle.textContent="Bật";}
    if(state==="loading")toggle.textContent="Hủy";
    if(state==="error"||state==="loading"){const message=document.createElement("p");message.className="hk-difficulty__message";message.textContent=state==="error"?"Ví dụ lỗi: Hãy cài đặt từ điển ngoại tuyến.":"Đang thêm furigana…";controls.append(message);}
    wrapper.append(label,clone);document.querySelector("#states")!.append(wrapper);
  }
});
observer.observe(document.querySelector("#preview")!,{childList:true,subtree:true});
