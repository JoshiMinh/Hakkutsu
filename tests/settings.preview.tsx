import "../src/styles/global.css";

const listener = {addListener() {}, removeListener() {}};
Object.defineProperty(globalThis,"chrome",{configurable:true,value:{
  storage:{sync:{async get(){return {};},async set(){},async remove(){}},onChanged:listener},
  runtime:{onMessage:listener,async sendMessage(){return {type:"FETCH_IMAGE_RESULT",payload:{images:[]}};}},
}});
const [{createRoot},{createElement},{DictionarySettings},{StudySettings},{DefinitionCard},{DEFAULT_SETTINGS}] = await Promise.all([
  import("react-dom/client"),import("react"),import("../src/features/settings/dictionary-settings"),import("../src/features/settings/study-settings"),import("../src/features/dictionary/definition-card"),import("../src/features/settings/types"),
]);
createRoot(document.querySelector("#settings-live")!).render(createElement("div",{className:"hk-settings-form"},
  createElement(DictionarySettings,{language:"vi"}),
  createElement(StudySettings,{settings:DEFAULT_SETTINGS,onUpdate:()=>{}}),
));
createRoot(document.querySelector("#lookup-examples")!).render(createElement("div",null,...[
  {word:"便利",reading:"べんり",supplied:"LỢI"}, {word:"連載",reading:"れんさい",supplied:undefined},
  {word:"破棄",reading:"はき",supplied:undefined},
].map(({word,reading,supplied})=>createElement(DefinitionCard,{
  key:word,token:{surface:word,dictionary_form:word,reading:{hiragana:reading,romaji:""},pos:"Word",pos_detail:[],is_japanese:false,jlpt_level:null,frequency_rank:null,definitions:[],vietnamese_sound:supplied},originalText:word,sentenceReading:reading,ankiConnected:false,hideBottomAction:true,
}))));

// Static style snapshots of the real card. The live importer above remains functional.
const observer = new MutationObserver(() => {
  const card = document.querySelector<HTMLElement>("#settings-live .hk-dictionary-settings");
  if (!card || card.textContent?.includes("Đang kiểm tra")) return;
  observer.disconnect();
  for (const state of ["default","hover","focus","active","disabled","loading","error","success"]) {
    const wrapper = document.createElement("div");
    const label = document.createElement("p"); label.className="preview-label";label.textContent=state;
    const clone = card.cloneNode(true) as HTMLElement;
    const ids = new Map<string,string>();
    for (const element of clone.querySelectorAll<HTMLElement>("[id]")) { const old=element.id; element.id=`${state}-${old}`;ids.set(old,element.id); }
    for (const element of [clone,...clone.querySelectorAll<HTMLElement>("*")]) for(const attr of ["for","aria-labelledby","aria-describedby"]) {
      const value=element.getAttribute(attr);if(value)element.setAttribute(attr,value.split(" ").map(id=>ids.get(id)||id).join(" "));
    }
    clone.dataset.state=state;
    const button=clone.querySelector<HTMLButtonElement>("button")!;
    button.classList.add(`is-${state}`);
    if(state==="disabled"||state==="loading") button.disabled=true;
    if(state==="loading") {button.textContent="Đang nhập…";clone.setAttribute("aria-busy","true");}
    const feedback=clone.querySelector(".hk-dictionary-settings__feedback")!;
    if(state==="error") feedback.textContent="Ví dụ lỗi: Tệp JSON không hợp lệ. Hãy chọn một tệp khác.";
    if(state==="success") feedback.textContent="Ví dụ thành công: Đã nhập từ điển.";
    wrapper.append(label,clone);document.querySelector("#states")!.append(wrapper);
  }
});
observer.observe(document.querySelector("#settings-live")!,{childList:true,subtree:true,characterData:true});
