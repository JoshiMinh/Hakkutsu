const state = {
    page: null, blocks: [], selectedIndex: -1, dirty: false, drag: null,
    changeVersion: 0, autosaveTimer: null, savingPromise: null,
    slideDragId: null, loadingPage: false, previewMode: "edited",
    recentProcessed: new Set(), batchJobId: null,
};
const $ = (selector) => document.querySelector(selector);

async function api(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        let message = `Lỗi HTTP ${response.status}`;
        try { message = (await response.json()).detail || message; } catch (_) { /* ignore */ }
        throw new Error(message);
    }
    return response.json();
}

function setStatus(message, type = "") {
    const status = $("#status");
    status.textContent = message;
    status.className = type;
}

function setAutosave(message, type = "") {
    const element = $("#autosave-state");
    element.textContent = message;
    element.className = `autosave-state ${type}`;
}

function markDirty() {
    state.dirty = true;
    state.changeVersion += 1;
    setStatus("Có thay đổi chưa lưu", "dirty");
    setAutosave("Sẽ tự lưu…", "saving");
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = window.setTimeout(() => savePage({ silent: true }), 2000);
    if (state.page?.workflow_state === "completed") {
        state.page.workflow_state = "review";
        updatePrimaryAction();
    }
}

function currentBlock() { return state.blocks[state.selectedIndex] || null; }
function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

async function loadPage(requestedPageId = null, { pushHistory = false } = {}) {
    const pageId = Number(requestedPageId || new URLSearchParams(location.search).get("page"));
    if (!Number.isInteger(pageId) || pageId < 1) {
        setStatus("URL thiếu mã trang hợp lệ", "dirty");
        return;
    }
    try {
        state.loadingPage = true;
        const page = await api(`/api/pages/${pageId}`);
        state.page = page;
        state.blocks = state.page.text_blocks.map((block) => ({ ...block }));
        state.selectedIndex = state.blocks.length ? 0 : -1;
        state.dirty = false;
        state.previewMode = "edited";
        window.clearTimeout(state.autosaveTimer);
        $("#editor-title").textContent = state.page.manga_title;
        $("#editor-subtitle").textContent = `Chapter ${state.page.chapter_number} · Trang ${state.page.page_number}`;
        $("#chapter-label").textContent = `Chapter ${state.page.chapter_number}`;
        $("#original-image").src = state.page.original_image_url;
        $("#toggle-bubbles").disabled = !state.page.bubble_preview_url;
        $("#toggle-bubbles").dataset.mode = "original";
        $("#preview-image").src = state.page.clean_image_url;
        $("#toggle-mask").disabled = !state.page.mask_preview_url;
        $("#toggle-mask").dataset.mode = "clean";
        $("#export-page").href = `/api/pages/${state.page.id}/export.png`;
        $("#image-size").textContent = `${state.page.width} × ${state.page.height}px`;
        $("#outside-text-policy").value = state.page.outside_text_policy || "auto";
        $("#refresh-tonari-source").classList.toggle(
            "hidden", state.page.chapter_source_provider !== "tonarinoyj"
        );
        renderDecisionBadge();
        renderQaBadge();
        updateNavigation();
        renderSlides();
        render();
        updatePrimaryAction();
        if (pushHistory) history.pushState({ pageId }, "", `/editor?page=${pageId}`);
        setStatus("Đã tải dữ liệu", "saved");
        setAutosave("Đã đồng bộ", "saved");
    } catch (error) {
        setStatus(error.message, "dirty");
        setAutosave("Lỗi tải trang", "error");
    } finally {
        state.loadingPage = false;
    }
}

function updateNavigation() {
    const pages = state.page.chapter_pages;
    const index = pages.findIndex((item) => item.id === state.page.id);
    $("#page-position").textContent = `${index + 1} / ${pages.length}`;
    $("#previous-page").disabled = index <= 0;
    $("#next-page").disabled = index >= pages.length - 1;
    $("#previous-page").dataset.pageId = index > 0 ? pages[index - 1].id : "";
    $("#next-page").dataset.pageId = index < pages.length - 1 ? pages[index + 1].id : "";
}

const workflowLabels = {
    unprocessed: "Chưa xử lý", processing: "Đang chạy", in_progress: "Đang làm",
    review: "Cần kiểm tra", completed: "Hoàn thành",
};

const editorialLabels = {
    auto: "",
    preserve_sfx: "Giữ SFX",
    needs_manual_repair: "Cần sửa tay",
};

function editorialClass(page) {
    if (page.editorial_decision === "preserve_sfx") return "decision-preserve";
    if (page.editorial_decision === "needs_manual_repair") return "decision-manual";
    return "";
}

function renderDecisionBadge() {
    const badge = $("#page-decision-badge");
    const label = editorialLabels[state.page?.editorial_decision || "auto"];
    badge.className = `decision-badge ${editorialClass(state.page || {})} ${label ? "" : "hidden"}`;
    badge.textContent = label;
    badge.title = state.page?.editorial_note || label;
}

function renderQaBadge() {
    const badge = $("#page-qa-badge");
    const page = state.page || {};
    const issues = page.qa_issues || [];
    const accepted = page.qa_status === "warning" && Boolean(page.qa_overridden);
    const labels = {
        pass: "QA đạt",
        warning: accepted ? "QA đã chấp nhận" : "QA cảnh báo",
        error: "QA lỗi",
    };
    const label = labels[page.qa_status];
    badge.className = `decision-badge ${accepted ? "qa-badge-accepted" : `qa-badge-${page.qa_status || "pass"}`} ${label ? "" : "hidden"}`;
    badge.textContent = label || "";
    badge.title = issues.length ? issues.map((item) => item.message).join(" · ") : "Không phát hiện vấn đề chất lượng";
}

function renderSlides() {
    const list = $("#slides-list");
    list.innerHTML = state.page.chapter_pages.map((page) => {
        const qaClass = page.qa_status === "warning" && page.qa_overridden ? "qa-accepted" : page.qa_status === "warning" ? "qa-warning" : page.qa_status === "error" ? "qa-error" : "";
        const recentClass = state.recentProcessed.has(page.id) ? "just-processed" : "";
        const issueTitle = (page.qa_issues || []).map((item) => item.message).join(" · ");
        const decisionLabel = editorialLabels[page.editorial_decision || "auto"];
        const stateLabel = page.qa_status === "warning" && page.qa_overridden ? "✓ Đã chấp nhận cảnh báo" : page.qa_status === "warning" ? "⚠ Cảnh báo" : page.qa_status === "error" ? "✕ Lỗi" : workflowLabels[page.workflow_state] || page.workflow_state;
        return `<article class="slide-item ${page.id === state.page.id ? "active" : ""} ${qaClass} ${recentClass} ${editorialClass(page)}" draggable="true" data-page-id="${page.id}" title="${escapeHtml(issueTitle)}">
        <span class="slide-number">${page.page_number}</span>
        <img class="slide-thumb" src="${page.original_image_url}" alt="Trang ${page.page_number}" loading="lazy">
        <button class="slide-delete" data-delete-page="${page.id}" title="Xóa trang ${page.page_number}">×</button>
        <span class="slide-state">${decisionLabel ? `${escapeHtml(decisionLabel)} · ` : ""}${stateLabel}${page.original_filename ? ` · ${escapeHtml(page.original_filename)}` : ""}</span>
    </article>`;
    }).join("");
    list.querySelector(".slide-item.active")?.scrollIntoView({ block: "nearest" });
}

function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
}

function chapterPipelineTargets() {
    return (state.page?.chapter_pages || []).filter((page) => (
        page.review_status !== "approved" && (
            page.status === "uploaded"
            || page.status === "failed"
            || !page.qa_status
            || page.qa_status === "unknown"
            || page.qa_status === "error"
            || (page.qa_status === "warning" && !page.qa_overridden)
            || (Number(page.block_count || 0) > 0 && !page.clean_image_path)
        )
    ));
}

function updatePrimaryAction() {
    if (!state.page) return;
    const button = $("#run-full-pipeline");
    const count = chapterPipelineTargets().length;
    button.disabled = Boolean(state.batchJobId) || count === 0;
    button.textContent = state.batchJobId
        ? "Đang xử lý toàn bộ…"
        : count
            ? `▶ Xử lý toàn bộ ${count} trang`
            : "✓ Không còn trang cần xử lý";
}

function render() {
    renderBlockList();
    renderOverlay();
    renderInspector();
}

function renderBlockList() {
    const list = $("#block-list");
    const labels = { dialogue: "Thoại", narration: "Dẫn", skill: "Tên chiêu", sfx: "SFX", title: "Tiêu đề", ignore: "Bỏ qua" };
    list.innerHTML = state.blocks.map((block, index) => `<button class="block-chip ${index === state.selectedIndex ? "active" : ""} ${block.render_mode === "preserve" ? "preserve" : ""}" data-block-index="${index}">Block ${index + 1} · ${labels[block.content_type || block.text_kind] || "Thoại"}</button>`).join("");
}

function isSuppressedDuplicate(index) {
    const candidate = state.blocks[index];
    const candidateArea = candidate.width * candidate.height;
    return state.blocks.some((other, otherIndex) => {
        if (otherIndex === index || other.width * other.height < candidateArea) return false;
        if (other.width * other.height === candidateArea && otherIndex > index) return false;
        const overlapWidth = Math.max(0, Math.min(candidate.x + candidate.width, other.x + other.width) - Math.max(candidate.x, other.x));
        const overlapHeight = Math.max(0, Math.min(candidate.y + candidate.height, other.y + other.height) - Math.max(candidate.y, other.y));
        return overlapWidth * overlapHeight / Math.max(1, Math.min(candidateArea, other.width * other.height)) >= .8;
    });
}

function renderOverlay() {
    const layer = $("#overlay-layer");
    layer.innerHTML = "";
    state.blocks.forEach((block, index) => {
        if (isSuppressedDuplicate(index)) return;
        const element = document.createElement("div");
        const skipped = block.translation_mode === "skip";
        const preserved = block.render_mode === "preserve" || skipped;
        const stale = !preserved && Boolean(state.page.needs_inpainting);
        element.className = `block-overlay ${index === state.selectedIndex ? "selected" : ""} ${preserved ? "preserve" : ""} ${stale ? "stale-clean" : ""}`;
        element.dataset.blockIndex = index;
        element.style.left = `${block.x / state.page.width * 100}%`;
        element.style.top = `${block.y / state.page.height * 100}%`;
        element.style.width = `${block.width / state.page.width * 100}%`;
        element.style.height = `${block.height / state.page.height * 100}%`;
        element.style.transform = `rotate(${block.rotation}deg)`;
        element.style.color = block.color;
        element.style.fontFamily = block.font_family;
        const displayText = block.final_translation || block.ai_translation || "...";
        const hasExactLayout = block.render_source_text === displayText && Boolean(block.render_text);
        const displayFontSize = hasExactLayout ? block.render_font_size : block.font_size;
        element.style.fontSize = `${displayFontSize / state.page.width * $("#preview-stage").clientWidth}px`;
        element.innerHTML = preserved
            ? `<div class="preserve-label">${skipped ? "BỎ QUA" : "GIỮ CHỮ GỐC"}</div>${index === state.selectedIndex ? '<div class="resize-handle" data-resize></div>' : ""}`
            : stale
                ? `<div class="stale-clean-label">CẦN CHẠY XÓA AI</div>${index === state.selectedIndex ? '<div class="resize-handle" data-resize></div>' : ""}`
                : `<div class="block-text" style="text-align:${block.text_align}"><span></span></div>${index === state.selectedIndex ? '<div class="resize-handle" data-resize></div>' : ""}`;
        const textSpan = element.querySelector(".block-text span");
        if (textSpan) {
            textSpan.textContent = hasExactLayout ? block.render_text : displayText;
            textSpan.style.transform = `translateY(${(block.text_offset_y || 0) / state.page.width * $("#preview-stage").clientWidth}px)`;
            if (block.text_kind === "sfx" || ["shout", "action", "brush", "horror", "skill"].includes(block.style_preset)) {
                const stroke = String(block.color || "#000000").toLowerCase() === "#ffffff" ? "#000000" : "#ffffff";
                const width = Math.max(1, displayFontSize / state.page.width * $("#preview-stage").clientWidth / 18);
                textSpan.style.textShadow = `${width}px 0 ${stroke}, -${width}px 0 ${stroke}, 0 ${width}px ${stroke}, 0 -${width}px ${stroke}`;
            }
        }
        layer.appendChild(element);
    });
}

function renderInspector() {
    const block = currentBlock();
    $("#empty-inspector").classList.toggle("hidden", Boolean(block));
    $("#inspector").classList.toggle("hidden", !block);
    $("#selected-label").textContent = block ? `Block ${state.selectedIndex + 1} / ${state.blocks.length}` : "Chưa chọn";
    if (!block) return;
    if (block.ocr_provider) {
        const confidence = block.ocr_confidence == null
            ? "không cung cấp"
            : `${Math.round(block.ocr_confidence * 100)}%`;
        $("#ocr-info").textContent = `OCR: ${block.ocr_provider} · Độ tin cậy recognition: ${confidence}`;
    } else {
        $("#ocr-info").textContent = "TextBlock được tạo hoặc chỉnh thủ công";
    }
    $("#render-mode").value = block.render_mode || "replace";
    $("#content-type").value = block.content_type || (block.text_kind === "sfx" ? "sfx" : "dialogue");
    $("#translation-mode").value = block.translation_mode || "translate";
    $("#style-preset").value = block.style_preset || (block.text_kind === "sfx" ? "action" : "dialogue");
    const reasons = block.policy_reasons || [];
    const sourceLabel = block.policy_source === "manual"
        ? "Admin đã chọn thủ công"
        : block.visual_model
            ? `AI thị giác ${block.visual_model}${block.visual_confidence == null ? "" : ` ${Math.round(block.visual_confidence * 100)}%`}`
            : "Hệ thống tự nhận diện";
    const score = Math.round(Number(block.sfx_score || 0) * 100);
    const visibleReasons = block.policy_source === "manual" ? [] : reasons;
    const translationLabel = block.translation_mode === "skip" ? "Không dịch" : "Có dịch";
    const imageLabel = block.render_mode === "preserve" ? "giữ chữ gốc" : "thay chữ trên ảnh";
    const maskLabel = block.mask_strategy && block.mask_strategy !== "auto" ? ` · mask ${block.mask_strategy}` : "";
    const visual = block.visual_suggestion || {};
    const actionLabels = { replace: "thay chữ", preserve: "giữ chữ gốc", skip: "bỏ qua" };
    const qwenLine = visual.model
        ? `<br><span class="visual-suggestion"><strong>Qwen đề xuất:</strong> ${escapeHtml(actionLabels[visual.effective_action || visual.action] || visual.action || "chưa rõ")}`
            + ` · ${escapeHtml(visual.content_type || "")}`
            + ` · mask ${escapeHtml(visual.mask_strategy || "standard")}`
            + `${visual.confidence == null ? "" : ` · ${Math.round(Number(visual.confidence) * 100)}%`}`
            + `${visual.reason ? `<br>${escapeHtml(visual.reason)}` : ""}</span>`
        : `<br><span class="visual-suggestion muted"><strong>Qwen:</strong> chưa có phân tích cho block này</span>`;
    $("#policy-info").innerHTML = `<strong>${translationLabel} · ${imageLabel}</strong> · ${sourceLabel}${block.policy_source === "manual" ? "" : ` · điểm SFX ${score}%`}${maskLabel}${visibleReasons.length ? `<br>${visibleReasons.map(escapeHtml).join(" · ")}` : ""}${qwenLine}`;
    const values = {
        "#original-text": block.original_text, "#ai-translation": block.ai_translation,
        "#final-translation": block.final_translation, "#font-family": block.font_family,
        "#font-size": block.font_size, "#color": block.color, "#text-align": block.text_align,
        "#rotation": block.rotation, "#position-x": block.x, "#position-y": block.y,
        "#block-width": block.width, "#block-height": block.height
    };
    Object.entries(values).forEach(([selector, value]) => { $(selector).value = value; });
}

function selectBlock(index) {
    state.selectedIndex = index;
    render();
}

function addBlock() {
    const width = Math.max(80, Math.round(state.page.width * .25));
    const height = Math.max(50, Math.round(state.page.height * .1));
    state.blocks.push({
        x: Math.round((state.page.width - width) / 2), y: Math.round((state.page.height - height) / 2),
        width, height, original_text: "", ai_translation: "", final_translation: "Bản dịch mới",
        font_family: "Arial", font_size: Math.max(16, Math.round(state.page.width * .035)), color: "#000000",
        text_align: "center", text_offset_y: 0,
        placement_anchor_x: null, placement_anchor_y: null, rotation: 0,
        text_kind: "dialogue", content_type: "dialogue", translation_mode: "translate",
        render_mode: "replace", style_preset: "dialogue", policy_source: "manual",
        sfx_score: 0, mask_strategy: "auto", visual_confidence: null, visual_model: null,
        visual_suggestion_json: "{}", visual_suggestion: {},
        policy_reasons_json: "[]", policy_reasons: []
    });
    state.selectedIndex = state.blocks.length - 1;
    markDirty(); render();
}

function deleteBlock() {
    if (!currentBlock()) return;
    state.blocks.splice(state.selectedIndex, 1);
    state.selectedIndex = Math.min(state.selectedIndex, state.blocks.length - 1);
    markDirty(); render();
}

function updateBlock(field, value) {
    const block = currentBlock();
    if (!block) return;
    block[field] = value;
    markDirty();
    renderOverlay();
    renderBlockList();
}

function bindInspector() {
    const bindings = {
        "#original-text": ["original_text", String], "#ai-translation": ["ai_translation", String],
        "#final-translation": ["final_translation", String], "#font-family": ["font_family", String],
        "#font-size": ["font_size", Number], "#color": ["color", String], "#text-align": ["text_align", String],
        "#rotation": ["rotation", Number], "#position-x": ["x", Number], "#position-y": ["y", Number],
        "#block-width": ["width", Number], "#block-height": ["height", Number]
    };
    Object.entries(bindings).forEach(([selector, [field, convert]]) => {
        $(selector).addEventListener("input", (event) => updateBlock(field, convert(event.target.value)));
    });
    $("#content-type").addEventListener("change", (event) => {
        const block = currentBlock();
        if (!block) return;
        block.content_type = event.target.value;
        block.text_kind = ["skill", "sfx", "title"].includes(block.content_type) ? "sfx" : "dialogue";
        if (block.content_type === "ignore") {
            block.translation_mode = "skip";
            block.render_mode = "preserve";
        }
        const defaults = { dialogue: "dialogue", narration: "narration", skill: "skill", sfx: "action", title: "action" };
        if (defaults[block.content_type]) block.style_preset = defaults[block.content_type];
        block.policy_source = "manual";
        markDirty(); render();
    });
    $("#translation-mode").addEventListener("change", (event) => {
        const block = currentBlock();
        if (!block) return;
        block.translation_mode = event.target.value;
        if (block.translation_mode === "skip") block.render_mode = "preserve";
        block.policy_source = "manual";
        markDirty(); render();
    });
    $("#style-preset").addEventListener("change", (event) => {
        const block = currentBlock();
        if (!block) return;
        block.style_preset = event.target.value;
        const presetFonts = {
            dialogue: "Arial", narration: "Times New Roman", shout: "Impact",
            action: "Impact", brush: "Comic Sans MS Bold",
            horror: "Times New Roman Bold", skill: "Impact",
        };
        block.font_family = presetFonts[block.style_preset] || block.font_family;
        block.policy_source = "manual";
        markDirty(); render();
    });
    $("#render-mode").addEventListener("change", (event) => {
        const block = currentBlock();
        if (!block) return;
        block.render_mode = event.target.value;
        if (block.translation_mode === "skip" && block.render_mode === "replace") {
            block.translation_mode = "translate";
        }
        if (block.render_mode === "replace") state.page.needs_inpainting = true;
        block.policy_source = "manual";
        block.policy_reasons_json = JSON.stringify(block.policy_reasons || []);
        markDirty();
        render();
        setStatus("Đã đổi cách xử lý. Hãy chạy lại bước xóa chữ để làm mới ảnh nền.");
    });
}

function beginPointerAction(event) {
    const overlay = event.target.closest("[data-block-index]");
    if (!overlay) return;
    const index = Number(overlay.dataset.blockIndex);
    if (state.selectedIndex !== index) selectBlock(index);
    const rect = $("#preview-stage").getBoundingClientRect();
    const block = state.blocks[index];
    state.drag = {
        mode: event.target.matches("[data-resize]") ? "resize" : "move",
        startX: event.clientX, startY: event.clientY, rect,
        original: { x: block.x, y: block.y, width: block.width, height: block.height }
    };
    event.preventDefault();
}

function movePointer(event) {
    if (!state.drag) return;
    const block = currentBlock();
    const dx = (event.clientX - state.drag.startX) / state.drag.rect.width * state.page.width;
    const dy = (event.clientY - state.drag.startY) / state.drag.rect.height * state.page.height;
    if (state.drag.mode === "move") {
        block.x = Math.round(clamp(state.drag.original.x + dx, 0, state.page.width - block.width));
        block.y = Math.round(clamp(state.drag.original.y + dy, 0, state.page.height - block.height));
        block.placement_anchor_x = block.x;
        block.placement_anchor_y = block.y;
        block.text_offset_y = 0;
    } else {
        block.width = Math.round(clamp(state.drag.original.width + dx, 20, state.page.width - block.x));
        block.height = Math.round(clamp(state.drag.original.height + dy, 20, state.page.height - block.y));
    }
    markDirty(); renderOverlay(); renderInspector();
}

async function savePage({ silent = false } = {}) {
    window.clearTimeout(state.autosaveTimer);
    if (state.savingPromise) await state.savingPromise;
    if (!state.dirty || !state.page) return true;
    const pageId = state.page.id;
    const capturedVersion = state.changeVersion;
    const blocks = state.blocks.map((block) => ({ ...block }));
    setAutosave("Đang lưu…", "saving");
    if (!silent) setStatus("Đang lưu thay đổi…");
    state.savingPromise = api(`/api/pages/${pageId}/text-blocks`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocks })
    });
    try {
        const saveResult = await state.savingPromise;
        if (saveResult.requires_inpainting && state.page?.id === pageId) {
            state.page.needs_inpainting = true;
            state.page.clean_image_url = null;
            $("#preview-image").src = state.page.original_image_url;
            renderOverlay();
            setStatus("Ảnh sạch cũ đã hết hiệu lực · hãy bấm Xử lý trang để chạy LaMa", "dirty");
        }
        if (state.page?.id === pageId && state.changeVersion === capturedVersion) {
            state.dirty = false;
            setAutosave("Đã tự lưu", "saved");
            if (!saveResult.requires_inpainting) {
                setStatus(`Đã tự lưu ${blocks.length} TextBlock`, "saved");
            }
        } else if (state.page?.id === pageId) {
            window.clearTimeout(state.autosaveTimer);
            state.autosaveTimer = window.setTimeout(() => savePage({ silent: true }), 700);
        }
        return true;
    } catch (error) {
        state.dirty = true;
        setAutosave("Lưu thất bại", "error");
        setStatus(error.message, "dirty");
        return false;
    } finally {
        state.savingPromise = null;
    }
}

async function flushAutosave() {
    window.clearTimeout(state.autosaveTimer);
    if (state.savingPromise) await state.savingPromise;
    return state.dirty ? savePage({ silent: true }) : true;
}

async function reloadCurrentPage() {
    if (state.page) await loadPage(state.page.id);
}

function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function runOcr() {
    if (!await flushAutosave()) return;
    let replaceExisting = false;
    if (state.blocks.length) {
        replaceExisting = confirm(
            "Chạy lại OCR sẽ thay thế toàn bộ TextBlock hiện tại, gồm cả nội dung đã chỉnh tay. Bạn có chắc không?"
        );
        if (!replaceExisting) return;
    }

    const button = $("#run-ocr");
    button.disabled = true;
    button.textContent = "Đang OCR...";
    try {
        const started = await api(`/api/pages/${state.page.id}/ocr`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ replace_existing: replaceExisting })
        });
        setStatus("Đang tải mô hình và nhận dạng chữ...");
        for (;;) {
            await wait(1000);
            const job = await api(`/api/jobs/${started.job_id}`);
            if (job.status === "completed") {
                state.dirty = false;
                if (job.result_count === 0) {
                    setStatus("Không phát hiện được chữ. Hãy khoanh + TextBlock rồi bấm Nhận dạng chữ trong vùng này.", "dirty");
                } else {
                    setStatus(`OCR hoàn tất: phát hiện ${job.result_count} vùng chữ`, "saved");
                }
                await wait(500);
                await reloadCurrentPage();
                return;
            }
            if (job.status === "failed") {
                throw new Error(job.error_message || "OCR thất bại");
            }
            setStatus(`OCR đang xử lý · ${Math.round(job.progress * 100)}%`);
        }
    } catch (error) {
        setStatus(error.message, "dirty");
        button.disabled = false;
        button.textContent = "Chạy OCR";
    }
}

async function ocrSelectedRegion() {
    const block = currentBlock();
    if (!block || !state.page) return;
    const button = $("#ocr-selected-region");
    button.disabled = true;
    button.textContent = "Đang nhận dạng...";
    try {
        const result = await api(`/api/pages/${state.page.id}/ocr-crop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                x: block.source_x ?? block.x,
                y: block.source_y ?? block.y,
                width: block.source_width ?? block.width,
                height: block.source_height ?? block.height,
            }),
        });
        if (!result.text) throw new Error("Manga-OCR chưa đọc được vùng này. Hãy nới khung sát đủ toàn bộ chữ rồi thử lại.");
        block.original_text = result.text;
        block.ocr_provider = "manual-region+manga-ocr";
        block.ocr_confidence = null;
        block.content_type = block.content_type === "dialogue" ? "skill" : block.content_type;
        block.text_kind = ["skill", "sfx", "title"].includes(block.content_type) ? "sfx" : block.text_kind;
        block.style_preset = block.content_type === "skill" ? "skill" : block.style_preset;
        block.policy_source = "manual";
        markDirty();
        render();
        await savePage({ silent: true });
        setStatus(`Đã nhận dạng vùng: ${result.text}`, "saved");
    } catch (error) {
        setStatus(error.message, "dirty");
    } finally {
        button.disabled = false;
        button.textContent = "Nhận dạng chữ trong vùng này";
    }
}

async function runFullPipeline() {
    if (!await flushAutosave()) return;
    const button = $("#rerun-current-page");
    button.disabled = true;
    button.textContent = "Đang chạy lại toàn bộ trang…";
    try {
        const started = await api(`/api/pages/${state.page.id}/pipeline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // The primary action must never destroy OCR/manual edits. Resetting
            // OCR remains an explicit advanced action in the Tools menu.
            body: JSON.stringify({ replace_existing: false })
        });
        for (;;) {
            await wait(1000);
            const job = await api(`/api/jobs/${started.job_id}`);
            const step = job.current_step || "Đang chuẩn bị";
            if (job.status === "completed") {
                setStatus(`Xử lý trang hoàn tất · ${job.result_count} TextBlock`, "saved");
                await wait(500);
                await reloadCurrentPage();
                button.disabled = false;
                button.textContent = "Chạy lại toàn bộ trang này";
                return;
            }
            if (job.status === "failed") {
                throw new Error(job.error_message || `${step} thất bại`);
            }
            setStatus(`${step} · ${Math.round(job.progress * 100)}%`);
        }
    } catch (error) {
        await reloadCurrentPage();
        setStatus(error.message, "dirty");
        button.disabled = false;
        button.textContent = "Chạy lại toàn bộ trang này";
    }
}

async function runChapterPipeline() {
    if (!await flushAutosave()) return;
    const targets = chapterPipelineTargets();
    if (!targets.length) {
        setStatus("Không còn trang mới, lỗi hoặc cảnh báo cần xử lý", "saved");
        updatePrimaryAction();
        return;
    }
    if (!confirm(`Xử lý tuần tự toàn bộ ${targets.length} trang đang cần chỉnh trong chapter này?`)) return;
    try {
        const started = await api(`/api/chapters/${state.page.chapter_id}/pipeline`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ include_warnings: true }),
        });
        state.batchJobId = started.job_id;
        updatePrimaryAction();
        for (;;) {
            await wait(1000);
            const job = await api(`/api/jobs/${started.job_id}`);
            (job.items || []).filter((item) => item.status === "completed").forEach((item) => state.recentProcessed.add(item.page_id));
            renderSlides();
            setStatus(`${job.current_step || "Đang xử lý"} · ${Math.round(job.progress * 100)}%`);
            if (job.status === "completed") {
                const warnings = (job.items || []).filter((item) => item.status === "warning").length;
                const failed = (job.items || []).filter((item) => item.status === "failed").length;
                await reloadCurrentPage();
                setStatus(`Xong chapter · ${job.result_count} đạt · ${warnings} cảnh báo · ${failed} lỗi`, failed ? "dirty" : "saved");
                break;
            }
            if (job.status === "failed") throw new Error(job.error_message || "Batch chapter thất bại");
        }
    } catch (error) { setStatus(error.message, "dirty"); }
    finally { state.batchJobId = null; updatePrimaryAction(); }
}

async function refreshTonariSource() {
    if (!await flushAutosave()) return;
    const warning = "Tải lại ảnh gốc và ghép đúng tile Tonari sẽ đặt lại toàn bộ TextBlock, bản dịch, mask và trạng thái duyệt của chapter. Ảnh nguồn cũ sẽ được giữ trong thư mục backup. Tiếp tục?";
    if (!confirm(warning)) return;
    const button = $("#refresh-tonari-source");
    button.disabled = true;
    try {
        const started = await api(`/api/chapters/${state.page.chapter_id}/refresh-source`, { method: "POST" });
        for (;;) {
            await wait(1000);
            const job = await api(`/api/jobs/${started.job_id}`);
            setStatus(`${job.current_step || "Đang ghép lại ảnh nguồn"} · ${Math.round(job.progress * 100)}%`);
            if (job.status === "completed") {
                await reloadCurrentPage();
                setStatus(`Đã ghép lại ${job.result_count} trang Tonari. Hãy chạy xử lý chapter.`, "saved");
                return;
            }
            if (job.status === "failed") throw new Error(job.error_message || "Tải lại ảnh nguồn thất bại");
        }
    } catch (error) {
        setStatus(error.message, "dirty");
    } finally {
        button.disabled = false;
    }
}

async function runBubbleAnalysis() {
    if (!await flushAutosave()) return;
    const button = $("#run-bubble-analysis");
    button.disabled = true;
    button.textContent = "Đang phân tích...";
    try {
        const started = await api(`/api/pages/${state.page.id}/bubble-segmentation`, { method: "POST" });
        setStatus("Đang tải MangaLens và phân đoạn từng bong bóng thoại...");
        for (;;) {
            await wait(1000);
            const job = await api(`/api/jobs/${started.job_id}`);
            if (job.status === "completed") {
                setStatus(`Đã phát hiện ${job.result_count} vùng bóng thoại`, "saved");
                await wait(400);
                await reloadCurrentPage();
                return;
            }
            if (job.status === "failed") {
                throw new Error(job.error_message || "Phân tích bóng thoại thất bại");
            }
            setStatus(`${job.current_step || "Đang phân tích bóng thoại"} · ${Math.round(job.progress * 100)}%`);
        }
    } catch (error) {
        setStatus(error.message, "dirty");
        button.disabled = false;
        button.textContent = "Phân tích bóng thoại";
    }
}

async function runTranslation() {
    if (!await flushAutosave()) return;
    if (!state.blocks.some((block) => block.original_text.trim())) {
        alert("Trang chưa có văn bản OCR để dịch.");
        return;
    }
    let overwriteExistingAi = false;
    if (state.blocks.some((block) => block.ai_translation.trim())) {
        overwriteExistingAi = confirm(
            "Trang đã có đề xuất AI. Dịch lại sẽ thay đề xuất AI nhưng vẫn giữ bản dịch cuối bạn đã sửa. Tiếp tục?"
        );
        if (!overwriteExistingAi) return;
    }

    const button = $("#run-translation");
    button.disabled = true;
    button.textContent = "Đang dịch...";
    try {
        const started = await api(`/api/pages/${state.page.id}/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ overwrite_existing_ai: overwriteExistingAi })
        });
        setStatus("Đang dịch toàn bộ hội thoại trên trang...");
        for (;;) {
            await wait(1000);
            const job = await api(`/api/jobs/${started.job_id}`);
            if (job.status === "completed") {
                state.dirty = false;
                setStatus(`Đã dịch ${job.result_count} TextBlock`, "saved");
                await wait(500);
                await reloadCurrentPage();
                return;
            }
            if (job.status === "failed") {
                throw new Error(job.error_message || "Dịch trang thất bại");
            }
            setStatus(`Đang dịch · ${Math.round(job.progress * 100)}%`);
        }
    } catch (error) {
        setStatus(error.message, "dirty");
        button.disabled = false;
        button.textContent = "Dịch trang";
    }
}

async function runInpainting() {
    if (!await flushAutosave()) return;
    if (!state.blocks.length) {
        alert("Trang chưa có TextBlock để xóa chữ.");
        return;
    }
    if (!confirm("Tạo lại ảnh sạch từ ảnh gốc và các vùng chữ hiện tại?")) return;

    const button = $("#run-inpainting");
    button.disabled = true;
    button.textContent = "Đang xóa chữ...";
    try {
        const started = await api(`/api/pages/${state.page.id}/inpaint`, { method: "POST" });
        setStatus("Đang tạo mask và phục hồi nền...");
        for (;;) {
            await wait(1000);
            const job = await api(`/api/jobs/${started.job_id}`);
            if (job.status === "completed") {
                setStatus(`Đã làm sạch ${job.result_count} vùng chữ`, "saved");
                await wait(500);
                await reloadCurrentPage();
                return;
            }
            if (job.status === "failed") {
                throw new Error(job.error_message || "Tạo ảnh sạch thất bại");
            }
            setStatus(`Đang phục hồi nền · ${Math.round(job.progress * 100)}%`);
        }
    } catch (error) {
        setStatus(error.message, "dirty");
        button.disabled = false;
        button.textContent = "Xóa chữ Nhật";
    }
}

async function autoTypeset() {
    if (!await flushAutosave()) return;
    const button = $("#auto-typeset");
    button.disabled = true;
    button.textContent = "Đang căn chữ...";
    try {
        const result = await api(`/api/pages/${state.page.id}/typeset`, { method: "POST" });
        setStatus(`Đã tự căn ${result.count} TextBlock`, "saved");
        await wait(400);
        await reloadCurrentPage();
    } catch (error) {
        setStatus(error.message, "dirty");
        button.disabled = false;
        button.textContent = "Tự căn chữ";
    }
}

async function setEditorialDecision(decision) {
    if (!await flushAutosave()) return;
    const messages = {
        preserve_sfx: "Giữ nguyên chữ hiệu ứng/SFX hoặc trang tranh này và xem là đạt QA?",
        needs_manual_repair: "Đánh dấu trang này cần sửa tay trước khi xuất bản?",
        auto: "Xóa quyết định biên tập và kiểm tra QA tự động lại?",
    };
    if (!confirm(messages[decision])) return;
    try {
        const result = await api(`/api/pages/${state.page.id}/editorial-decision`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision, note: "" }),
        });
        await reloadCurrentPage();
        const labels = {
            preserve_sfx: "Đã giữ SFX/trang tranh",
            needs_manual_repair: "Đã đánh dấu cần sửa tay",
            auto: "Đã quay lại QA tự động",
        };
        setStatus(`${labels[decision]} · QA ${result.quality?.status || "unknown"}`, result.quality?.status === "pass" ? "saved" : "dirty");
    } catch (error) {
        setStatus(error.message, "dirty");
    }
}

function toggleMaskPreview() {
    if (!state.page.mask_preview_url) return;
    const button = $("#toggle-mask");
    const showMask = state.previewMode !== "mask";
    $("#preview-image").src = showMask ? state.page.mask_preview_url : state.page.clean_image_url;
    state.previewMode = showMask ? "mask" : "edited";
    $("#overlay-layer").classList.toggle("hidden", showMask);
    button.dataset.mode = showMask ? "mask" : "clean";
    button.textContent = showMask ? "Quay lại ảnh đã chỉnh" : "Xem mask";
}

function toggleBubblePreview() {
    if (!state.page.bubble_preview_url) return;
    const button = $("#toggle-bubbles");
    const showBubbles = button.dataset.mode === "original";
    $("#original-image").src = showBubbles ? state.page.bubble_preview_url : state.page.original_image_url;
    button.dataset.mode = showBubbles ? "bubbles" : "original";
    button.textContent = showBubbles ? "Xem ảnh gốc" : "Xem vùng bóng thoại";
}

async function navigateTo(pageId) {
    if (!pageId) return;
    const target = Number(pageId);
    if (target === state.page?.id || state.loadingPage) return;
    if (!await flushAutosave()) return;
    await loadPage(target, { pushHistory: true });
}

async function reorderSlides(pageIds) {
    try {
        await api(`/api/chapters/${state.page.chapter_id}/pages/order`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page_ids: pageIds }),
        });
        await reloadCurrentPage();
        setStatus("Đã lưu thứ tự trang", "saved");
    } catch (error) { setStatus(error.message, "dirty"); await reloadCurrentPage(); }
}

async function deletePage(pageId) {
    const page = state.page.chapter_pages.find((item) => item.id === pageId);
    if (!page || !confirm(`Xóa vĩnh viễn trang ${page.page_number}? Ảnh và kết quả xử lý của trang này sẽ bị xóa.`)) return;
    if (!await flushAutosave()) return;
    try {
        const result = await api(`/api/pages/${pageId}`, { method: "DELETE" });
        if (!result.remaining_page_ids.length) { location.href = "/"; return; }
        const oldIndex = state.page.chapter_pages.findIndex((item) => item.id === pageId);
        const target = result.remaining_page_ids[Math.min(oldIndex, result.remaining_page_ids.length - 1)];
        await loadPage(target, { pushHistory: true });
        setStatus("Đã xóa trang", "saved");
    } catch (error) { setStatus(error.message, "dirty"); }
}

async function deleteChapter() {
    const count = state.page.chapter_pages.length;
    if (!confirm(`Xóa vĩnh viễn Chapter ${state.page.chapter_number} và toàn bộ ${count} trang?`)) return;
    if (!await flushAutosave()) return;
    try { await api(`/api/chapters/${state.page.chapter_id}`, { method: "DELETE" }); location.href = "/"; }
    catch (error) { setStatus(error.message, "dirty"); }
}

async function addPages(files) {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    if (!selected.length) return;
    const data = new FormData();
    selected.sort((a, b) => a.name.localeCompare(b.name, "vi", { numeric: true })).forEach((file) => data.append("files", file));
    data.append("preserve_order", "true");
    data.append("batch_label", "Thêm từ editor");
    try {
        setStatus(`Đang thêm ${selected.length} ảnh…`);
        await api(`/api/chapters/${state.page.chapter_id}/pages`, { method: "POST", body: data });
        await reloadCurrentPage();
        setStatus(`Đã thêm ${selected.length} trang`, "saved");
    } catch (error) { setStatus(error.message, "dirty"); }
    finally { $("#slides-add-pages").value = ""; }
}

function closeToolsMenu() {
    $("#tools-menu").classList.add("hidden");
    $("#tools-toggle").setAttribute("aria-expanded", "false");
}

async function openHistory() {
    $("#history-drawer").classList.add("open");
    $("#history-drawer").setAttribute("aria-hidden", "false");
    $("#history-backdrop").classList.remove("hidden");
    const list = $("#history-list");
    list.innerHTML = '<div class="empty">Đang tải…</div>';
    try {
        const events = await api("/api/history");
        let currentDay = "";
        list.innerHTML = events.map((item) => {
            const date = new Date(item.created_at);
            const day = date.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
            const heading = day !== currentDay ? `<div class="history-day">${escapeHtml(day)}</div>` : "";
            currentDay = day;
            const location = [item.manga_title, item.chapter_number ? `Chapter ${item.chapter_number}` : "", item.page_number ? `Trang ${item.page_number}` : ""].filter(Boolean).join(" · ");
            return `${heading}<article class="history-item"><strong>${escapeHtml(item.summary)}</strong><span>${escapeHtml(location)} · ${date.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}</span></article>`;
        }).join("") || '<div class="empty">Chưa có hoạt động trong 7 ngày gần đây.</div>';
    } catch (error) { list.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}

function closeHistory() {
    $("#history-drawer").classList.remove("open");
    $("#history-drawer").setAttribute("aria-hidden", "true");
    $("#history-backdrop").classList.add("hidden");
}

async function saveOutsideTextPolicy(event) {
    if (!state.page) return;
    const policy = event.target.value;
    try {
        await flushAutosave();
        const result = await api(`/api/pages/${state.page.id}/outside-text-policy`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ policy }),
        });
        state.page.outside_text_policy = result.outside_text_policy;
        await loadPage(state.page.id);
        setStatus("Đã lưu chính sách chữ ngoài bong bóng", "saved");
    } catch (error) {
        event.target.value = state.page.outside_text_policy || "auto";
        setStatus(error.message, "dirty");
    }
}

$("#add-block").addEventListener("click", addBlock);
$("#outside-text-policy").addEventListener("change", saveOutsideTextPolicy);
$("#delete-block").addEventListener("click", deleteBlock);
$("#run-ocr").addEventListener("click", runOcr);
$("#ocr-selected-region").addEventListener("click", ocrSelectedRegion);
$("#run-full-pipeline").addEventListener("click", runChapterPipeline);
$("#rerun-current-page").addEventListener("click", runFullPipeline);
$("#refresh-tonari-source").addEventListener("click", refreshTonariSource);
$("#run-bubble-analysis").addEventListener("click", runBubbleAnalysis);
$("#run-translation").addEventListener("click", runTranslation);
$("#run-inpainting").addEventListener("click", runInpainting);
$("#auto-typeset").addEventListener("click", autoTypeset);
$("#mark-preserve-sfx").addEventListener("click", () => setEditorialDecision("preserve_sfx"));
$("#mark-manual-repair").addEventListener("click", () => setEditorialDecision("needs_manual_repair"));
$("#reset-editorial-decision").addEventListener("click", () => setEditorialDecision("auto"));
$("#toggle-mask").addEventListener("click", toggleMaskPreview);
$("#toggle-bubbles").addEventListener("click", toggleBubblePreview);
$("#export-page").addEventListener("click", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    const href = event.currentTarget.href;
    flushAutosave().then((saved) => { if (saved) location.href = href; });
});
$("#apply-ai").addEventListener("click", () => { if (currentBlock()) { currentBlock().final_translation = currentBlock().ai_translation; markDirty(); render(); } });
$("#block-list").addEventListener("click", (event) => { const button = event.target.closest("[data-block-index]"); if (button) selectBlock(Number(button.dataset.blockIndex)); });
$("#overlay-layer").addEventListener("pointerdown", beginPointerAction);
window.addEventListener("pointermove", movePointer);
window.addEventListener("pointerup", () => { state.drag = null; });
$("#previous-page").addEventListener("click", (event) => navigateTo(event.currentTarget.dataset.pageId));
$("#next-page").addEventListener("click", (event) => navigateTo(event.currentTarget.dataset.pageId));
$("#slides-add-pages").addEventListener("change", (event) => addPages(event.target.files));
$("#delete-chapter").addEventListener("click", deleteChapter);
$("#open-history").addEventListener("click", openHistory);
$("#close-history").addEventListener("click", closeHistory);
$("#history-backdrop").addEventListener("click", closeHistory);
$("#tools-toggle").addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = $("#tools-menu");
    const opening = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !opening);
    event.currentTarget.setAttribute("aria-expanded", String(opening));
});
$("#tools-menu").addEventListener("click", (event) => { if (event.target.closest("button")) closeToolsMenu(); });
document.addEventListener("click", (event) => { if (!event.target.closest(".tools-menu-wrap")) closeToolsMenu(); });
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeToolsMenu();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); flushAutosave(); }
});
$("#slides-list").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete-page]");
    if (remove) { event.stopPropagation(); deletePage(Number(remove.dataset.deletePage)); return; }
    const slide = event.target.closest("[data-page-id]");
    if (slide) navigateTo(Number(slide.dataset.pageId));
});
$("#slides-list").addEventListener("dragstart", (event) => {
    const slide = event.target.closest("[data-page-id]");
    if (slide) state.slideDragId = Number(slide.dataset.pageId);
});
$("#slides-list").addEventListener("dragover", (event) => {
    const slide = event.target.closest("[data-page-id]");
    if (slide) { event.preventDefault(); slide.classList.add("drag-over"); }
});
$("#slides-list").addEventListener("dragleave", (event) => event.target.closest("[data-page-id]")?.classList.remove("drag-over"));
$("#slides-list").addEventListener("drop", async (event) => {
    event.preventDefault();
    const target = event.target.closest("[data-page-id]");
    document.querySelectorAll(".slide-item.drag-over").forEach((item) => item.classList.remove("drag-over"));
    if (!target || !state.slideDragId) return;
    const ids = state.page.chapter_pages.map((item) => item.id);
    const from = ids.indexOf(state.slideDragId); const to = ids.indexOf(Number(target.dataset.pageId));
    if (from >= 0 && to >= 0 && from !== to) { const [moved] = ids.splice(from, 1); ids.splice(to, 0, moved); await reorderSlides(ids); }
    state.slideDragId = null;
});
window.addEventListener("beforeunload", (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("popstate", async () => {
    const pageId = Number(new URLSearchParams(location.search).get("page"));
    if (pageId && pageId !== state.page?.id && await flushAutosave()) await loadPage(pageId);
});
window.addEventListener("resize", () => { if (state.page) renderOverlay(); });

bindInspector();
loadPage();
