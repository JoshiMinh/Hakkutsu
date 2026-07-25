const state = { chapter: null, pageIndex: 0, selectedBlock: -1, mode: "original", saved: new Set() };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);

async function api(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) { let message = `Lỗi HTTP ${response.status}`; try { message = (await response.json()).detail || message; } catch (_) {} throw new Error(message); }
    return response.json();
}

function currentPage() { return state.chapter.pages[state.pageIndex]; }

function renderPage() {
    const page = currentPage();
    state.selectedBlock = -1;
    $("#reader-image").src = state.mode === "original" ? page.original_image_url : page.translated_image_url;
    $("#reader-subtitle").textContent = `Chapter ${state.chapter.chapter_number} · Trang ${page.page_number}/${state.chapter.pages.length}`;
    $("#reader-thumbs").innerHTML = state.chapter.pages.map((item, index) => `<button class="reader-thumb ${index === state.pageIndex ? "active" : ""}" data-page-index="${index}"><img src="${item.original_image_url}" alt="Trang ${item.page_number}"><span>Trang ${item.page_number}</span></button>`).join("");
    $("#hotspot-layer").innerHTML = page.blocks.map((block, index) => `<button class="study-hotspot" data-block-index="${index}" aria-label="Hội thoại ${index + 1}" style="left:${block.x / page.width * 100}%;top:${block.y / page.height * 100}%;width:${block.width / page.width * 100}%;height:${block.height / page.height * 100}%"></button>`).join("");
    $("#bubble-label").textContent = "Chọn một hội thoại";
    $("#learning-content").innerHTML = '<div class="reader-empty">Click vào một ô hội thoại trên ảnh để bắt đầu học.</div>';
}

function renderLearning(index) {
    const page = currentPage(); const block = page.blocks[index]; state.selectedBlock = index;
    document.querySelectorAll(".study-hotspot").forEach((item, itemIndex) => item.classList.toggle("active", itemIndex === index));
    $("#bubble-label").textContent = `Hội thoại ${index + 1}`;
    const tokens = (block.analysis?.tokens || []).map((token, tokenIndex) => {
        const key = `${token.lemma || token.surface}|${token.reading || ""}`;
        return `<article class="token"><div><strong>${escapeHtml(token.surface)}</strong><small>${escapeHtml(token.reading || "")} · ${escapeHtml(token.part_of_speech || "")}</small><small>${escapeHtml(token.meaning_vi || token.dictionary_gloss || "Chưa có nghĩa")}</small></div><button class="btn btn-small" data-save-token="${tokenIndex}" ${state.saved.has(key) ? "disabled" : ""}>${state.saved.has(key) ? "Đã lưu" : "+ Lưu"}</button></article>`;
    }).join("") || '<div class="empty">Không có từ cần phân tích.</div>';
    const grammar = (block.analysis?.grammar || []).map((item) => `<article class="grammar-item"><strong>${escapeHtml(item.pattern || "Mẫu câu")}</strong><div>${escapeHtml(item.explanation_vi || "")}</div></article>`).join("") || '<div class="empty">Không phát hiện mẫu ngữ pháp nổi bật.</div>';
    $("#learning-content").innerHTML = `<div class="sentence-card"><div class="sentence-jp" lang="ja">${escapeHtml(block.original_text)}</div><div class="sentence-vi">${escapeHtml(block.translation)}</div></div><div class="section-title">Từ vựng</div><div class="token-list">${tokens}</div><div class="section-title">Ngữ pháp</div>${grammar}`;
}

async function saveToken(index) {
    const page = currentPage(); const block = page.blocks[state.selectedBlock]; const token = block.analysis.tokens[index];
    const payload = { lemma: token.lemma || token.surface, reading: token.reading || "", surface: token.surface || "", meaning_vi: token.meaning_vi || token.dictionary_gloss || "", source_sentence: block.original_text, translation: block.translation, manga_title: state.chapter.manga_title, chapter_number: String(state.chapter.chapter_number), page_number: page.page_number };
    await api("/api/vocabulary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    state.saved.add(`${payload.lemma}|${payload.reading}`); renderLearning(state.selectedBlock);
}

async function load() {
    try {
        const chapterId = Number(location.pathname.split("/").filter(Boolean).pop());
        const [chapter, vocabulary] = await Promise.all([api(`/api/study/chapters/${chapterId}`), api("/api/vocabulary")]);
        state.chapter = chapter; vocabulary.forEach((item) => state.saved.add(`${item.lemma}|${item.reading}`));
        $("#reader-title").textContent = chapter.manga_title; $("#reader-chapter").textContent = `Chapter ${chapter.chapter_number}`; renderPage();
    } catch (error) { $("#learning-content").innerHTML = `<div class="reader-empty">${escapeHtml(error.message)}</div>`; }
}

$("#reader-thumbs").addEventListener("click", (event) => { const button = event.target.closest("[data-page-index]"); if (button) { state.pageIndex = Number(button.dataset.pageIndex); renderPage(); } });
$("#hotspot-layer").addEventListener("click", (event) => { const button = event.target.closest("[data-block-index]"); if (button) renderLearning(Number(button.dataset.blockIndex)); });
$("#learning-content").addEventListener("click", (event) => { const button = event.target.closest("[data-save-token]"); if (button) saveToken(Number(button.dataset.saveToken)).catch((error) => alert(error.message)); });
$("#mode-original").addEventListener("click", () => { state.mode = "original"; $("#mode-original").classList.add("active"); $("#mode-translated").classList.remove("active"); if (state.chapter) renderPage(); });
$("#mode-translated").addEventListener("click", () => { state.mode = "translated"; $("#mode-translated").classList.add("active"); $("#mode-original").classList.remove("active"); if (state.chapter) renderPage(); });
load();
