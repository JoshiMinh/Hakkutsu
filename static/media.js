const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const state = { sources: [], source: null, segment: null, saved: new Set() };

async function api(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
    return body;
}

function setStatus(message = "", isError = false) {
    const node = $("#media-status");
    node.textContent = message;
    node.classList.toggle("error", isError);
}

function formatTime(seconds = 0) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")}` : `${minutes}:${String(secs).padStart(2,"0")}`;
}

function sourceLabel(item) {
    return ({youtube:"YouTube", netflix:"Netflix", subtitle_file:"SRT/VTT", manual:"Văn bản"})[item.source_type] || item.source_type;
}

async function loadSources(selectId = null, selectSegmentId = null) {
    state.sources = await api("/api/media");
    $("#source-count").textContent = `${state.sources.length} nội dung`;
    $("#source-list").innerHTML = state.sources.map((item) => `<button class="source-item ${state.source?.id === item.id ? "active" : ""}" data-source-id="${item.id}"><strong>${escapeHtml(item.title || "Chưa đặt tên")}</strong><small>${sourceLabel(item)} · ${item.segment_count} câu · ${item.analyzed_count || 0} đã học</small></button>`).join("") || '<div class="empty">Chưa có nội dung. Hãy nhập YouTube, SRT/VTT hoặc dán câu Nhật ở phía trên.</div>';
    const target = selectId || state.source?.id;
    if (target) await selectSource(target, selectSegmentId);
}

async function selectSource(id, selectedSegmentId = null) {
    state.source = await api(`/api/media/${id}`);
    state.segment = selectedSegmentId
        ? state.source.segments.find((item) => item.id === Number(selectedSegmentId)) || null
        : null;
    $("#active-source-title").textContent = state.source.title || "Chưa đặt tên";
    $("#delete-source").hidden = false;
    renderSources();
    renderSegments();
    renderAnalysis();
}

function renderSources() {
    document.querySelectorAll("[data-source-id]").forEach((node) => node.classList.toggle("active", Number(node.dataset.sourceId) === state.source?.id));
}

function renderSegments() {
    const segments = state.source?.segments || [];
    $("#segment-list").innerHTML = segments.map((item) => `<button class="segment-item ${state.segment?.id === item.id ? "active" : ""}" data-segment-id="${item.id}"><time>${formatTime(item.start_time)}</time><span class="segment-text">${escapeHtml(item.source_text)}</span><span class="done">${item.analyzed_at ? "Đã phân tích" : ""}</span></button>`).join("") || '<div class="empty">Nguồn này chưa có câu phụ đề.</div>';
}

function findSegment(id) { return state.source?.segments.find((item) => item.id === Number(id)); }

function renderAnalysis() {
    const item = state.segment;
    if (!item) {
        $("#analysis-time").textContent = "Chưa chọn câu";
        $("#analysis-content").innerHTML = '<div class="empty">Chọn một câu phụ đề để xem và phân tích.</div>';
        return;
    }
    $("#analysis-time").textContent = formatTime(item.start_time);
    const analysis = item.analysis || {};
    const tokens = analysis.tokens || [];
    const grammar = analysis.grammar || [];
    const tokenHtml = tokens.map((token) => {
        const key = `${token.lemma || token.surface}|${token.reading || ""}`;
        const saved = state.saved.has(key);
        return `<div class="media-token"><div><strong>${escapeHtml(token.surface)}</strong><small>${escapeHtml(token.reading || "")} · ${escapeHtml(token.lemma || "")} · ${escapeHtml(token.part_of_speech || "")}</small><small>${escapeHtml(token.meaning_vi || token.dictionary_gloss || "Chưa có nghĩa")}</small></div><button class="btn btn-small ${saved ? "saved" : ""}" data-save-token='${escapeHtml(JSON.stringify(token))}'>${saved ? "Đã lưu" : "+ Lưu"}</button></div>`;
    }).join("");
    const grammarHtml = grammar.map((entry) => `<div class="grammar-item"><strong>${escapeHtml(entry.pattern || "Mẫu câu")}</strong><div>${escapeHtml(entry.explanation_vi || entry.explanation || "")}</div></div>`).join("");
    $("#analysis-content").innerHTML = `<div class="media-sentence"><div class="jp">${escapeHtml(item.source_text)}</div><div class="vi">${escapeHtml(item.translation || "Chưa dịch")}</div><div class="analyze-actions"><button id="analyze-segment" class="btn btn-primary">${item.analyzed_at ? "Phân tích lại" : "Dịch & phân tích"}</button>${state.source?.source_url ? `<a class="btn" href="${escapeHtml(state.source.source_url)}" target="_blank" rel="noreferrer">Mở nguồn ↗</a>` : ""}</div></div>${tokens.length ? `<div class="section-title">Từ vựng</div><div class="media-token-list">${tokenHtml}</div>` : ""}${grammar.length ? `<div class="section-title">Ngữ pháp</div>${grammarHtml}` : ""}`;
}

$("#source-list").addEventListener("click", (event) => { const button = event.target.closest("[data-source-id]"); if (button) selectSource(Number(button.dataset.sourceId)).catch((error) => setStatus(error.message, true)); });
$("#segment-list").addEventListener("click", (event) => { const button = event.target.closest("[data-segment-id]"); if (!button) return; state.segment = findSegment(button.dataset.segmentId); renderSegments(); renderAnalysis(); });

$("#analysis-content").addEventListener("click", async (event) => {
    if (event.target.closest("#analyze-segment")) {
        const button = event.target.closest("#analyze-segment");
        button.disabled = true; button.textContent = "Qwen đang dịch và phân tích…";
        setStatus("Đang xử lý một câu. Lần đầu có thể lâu hơn vì model local cần nạp vào bộ nhớ.");
        try {
            const result = await api(`/api/media/segments/${state.segment.id}/analyze`, { method: "POST" });
            Object.assign(state.segment, { translation: result.translation, analysis: result.analysis, analyzed_at: result.analyzed_at });
            setStatus("Đã dịch, tách từ và phân tích ngữ pháp. Kết quả đã được cache.");
            const sourceId = state.source.id;
            const segmentId = state.segment.id;
            renderSegments(); renderAnalysis(); await loadSources(sourceId, segmentId);
        } catch (error) { setStatus(error.message, true); renderAnalysis(); }
        return;
    }
    const save = event.target.closest("[data-save-token]");
    if (!save || !state.segment || !state.source) return;
    const token = JSON.parse(save.dataset.saveToken);
    const payload = {
        lemma: token.lemma || token.surface, reading: token.reading || "", surface: token.surface || "",
        meaning_vi: token.meaning_vi || token.dictionary_gloss || "", source_sentence: state.segment.source_text,
        translation: state.segment.translation || "", manga_title: state.source.title, chapter_number: sourceLabel(state.source),
        source_kind: state.source.source_type, source_url: state.source.source_url || "", source_time: state.segment.start_time
    };
    const result = await api("/api/vocabulary", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    state.saved.add(`${result.lemma}|${result.reading}`); renderAnalysis();
});

$("#youtube-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; setStatus("Đang lấy track phụ đề tiếng Nhật từ YouTube…");
    try { const result = await api("/api/media/youtube", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ video_url:$("#youtube-url").value, title:$("#youtube-title").value, language:"ja" }) }); setStatus(`Đã nhập ${result.segment_count} câu từ YouTube.`); await loadSources(result.id); event.target.reset(); }
    catch (error) { setStatus(error.message, true); } finally { button.disabled = false; }
});

$("#subtitle-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; setStatus("Đang đọc file phụ đề…");
    const data = new FormData(); data.append("file", $("#subtitle-file").files[0]); data.append("title", $("#subtitle-title").value);
    try { const result = await api("/api/media/import-subtitle", { method:"POST", body:data }); setStatus(`Đã nhập ${result.segment_count} câu từ file phụ đề.`); await loadSources(result.id); event.target.reset(); }
    catch (error) { setStatus(error.message, true); } finally { button.disabled = false; }
});

$("#manual-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const lines = $("#manual-text").value.split(/\r?\n/).map((text) => text.trim()).filter(Boolean);
    if (!lines.length) return setStatus("Hãy nhập ít nhất một câu tiếng Nhật.", true);
    try { const result = await api("/api/media/import", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ title:$("#manual-title").value || "Văn bản Nhật", source_type:"manual", segments:lines.map((text, index) => ({text,start:index,duration:0})) }) }); setStatus(`Đã tạo ${result.segment_count} câu.`); await loadSources(result.id); event.target.reset(); }
    catch (error) { setStatus(error.message, true); }
});

$("#delete-source").addEventListener("click", async () => {
    if (!state.source || !confirm(`Xóa “${state.source.title}” và toàn bộ phụ đề đã lưu?`)) return;
    await api(`/api/media/${state.source.id}`, {method:"DELETE"}); state.source = null; state.segment = null; $("#delete-source").hidden = true; $("#active-source-title").textContent = "Chọn một nội dung"; renderSegments(); renderAnalysis(); await loadSources();
});

Promise.all([api("/api/vocabulary"), loadSources()]).then(([words]) => words.forEach((item) => state.saved.add(`${item.lemma}|${item.reading}`))).catch((error) => setStatus(error.message, true));
