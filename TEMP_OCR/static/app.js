const state = {
    library: { items: [], counts: {}, total: 0 },
    filter: "all",
    query: "",
    selectedMangaId: null,
    selectedManga: null,
    importItems: [],
    importChapterId: null,
    importBusy: false,
    draggedIndex: null,
    tonariSeries: null,
    tonariEpisodes: [],
    tonariJobId: null,
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[char]);
const stateLabels = {
    unprocessed: "Chưa xử lý",
    in_progress: "Đang làm",
    processing: "Đang chạy",
    review: "Cần kiểm tra",
    completed: "Hoàn thành",
};

async function api(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        let message = `Lỗi HTTP ${response.status}`;
        try { message = (await response.json()).detail || message; } catch (_) { /* ignore */ }
        throw new Error(message);
    }
    return response.json();
}

function showNotice(message, isError = false) {
    const notice = $("#notice");
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.classList.remove("hidden");
    window.setTimeout(() => notice.classList.add("hidden"), 5200);
}

function showModal(id) { $(id).classList.remove("hidden"); }
function hideModals() {
    document.querySelectorAll(".modal-backdrop").forEach((item) => item.classList.add("hidden"));
    resetImport();
}

function summaryCard(key, count, description) {
    return `<article class="summary-card">
        <div class="summary-label"><span>${stateLabels[key]}</span><i class="state-dot ${key}"></i></div>
        <div><strong>${count}</strong><div class="muted">${description}</div></div>
    </article>`;
}

async function loadLibrary() {
    const grid = $("#manga-grid");
    grid.innerHTML = '<div class="empty">Đang tải thư viện…</div>';
    try {
        state.library = await api("/api/library");
        renderLibrarySummary();
        renderLibrary();
    } catch (error) {
        grid.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
}

function renderLibrarySummary() {
    const counts = state.library.counts;
    $("#library-summary").innerHTML = [
        summaryCard("unprocessed", counts.unprocessed || 0, "Dự án mới nhập"),
        summaryCard("in_progress", counts.in_progress || 0, "Đang chạy hoặc làm dở"),
        summaryCard("review", counts.review || 0, "Chờ bạn duyệt"),
        summaryCard("completed", counts.completed || 0, "Đã xác nhận"),
    ].join("");
    document.querySelectorAll("[data-count]").forEach((element) => {
        const key = element.dataset.count;
        element.textContent = key === "all" ? state.library.total : (counts[key] || 0);
    });
}

function renderLibrary() {
    const query = state.query.trim().toLocaleLowerCase("vi");
    const items = state.library.items.filter((item) => {
        const matchesState = state.filter === "all" || item.library_state === state.filter;
        const haystack = `${item.title} ${item.author || ""} ${item.tags || ""}`.toLocaleLowerCase("vi");
        return matchesState && (!query || haystack.includes(query));
    });
    const grid = $("#manga-grid");
    if (!items.length) {
        grid.innerHTML = `<div class="empty">Không có dự án nào trong nhóm này.</div>`;
        return;
    }
    grid.innerHTML = items.map(renderProjectCard).join("");
}

function renderProjectCard(manga) {
    const counts = manga.state_counts;
    const done = counts.completed || 0;
    const action = manga.library_state === "review" ? "Kiểm tra kết quả" : manga.library_state === "completed" ? "Mở dự án" : manga.library_state === "unprocessed" ? "Chuẩn bị xử lý" : "Tiếp tục làm";
    const supplemental = counts.unprocessed ? `${counts.unprocessed} trang mới` : counts.review ? `${counts.review} trang cần duyệt` : `${manga.chapter_count} chapter`;
    return `<article class="project-card" data-project-state="${manga.library_state}">
        <div class="project-cover">
            <span class="cover-letter">${escapeHtml((manga.title || "M").slice(0, 1).toUpperCase())}</span>
            <span class="state-badge ${manga.library_state}">${stateLabels[manga.library_state]}</span>
        </div>
        <div class="project-body">
            <div class="project-heading"><div><h3>${escapeHtml(manga.title)}</h3><div class="muted">${escapeHtml(manga.author || "Chưa có tác giả")}</div></div></div>
            <div class="project-meta"><span>${manga.page_count} trang</span><span>${supplemental}</span></div>
            <div class="progress-track"><span style="width:${manga.progress_percent}%"></span></div>
            <div class="progress-copy"><span>${done}/${manga.page_count} trang hoàn thành</span><span>${manga.progress_percent}%</span></div>
            <div class="project-actions"><button class="btn btn-primary" data-view-manga="${manga.id}">${action}</button>${manga.latest_page_id ? `<a class="btn" href="/editor?page=${manga.latest_page_id}">Editor</a>` : ""}</div>
        </div>
    </article>`;
}

async function loadMangaDetail(mangaId) {
    const detail = $("#manga-detail");
    detail.classList.remove("hidden");
    detail.innerHTML = '<div class="empty">Đang tải chi tiết…</div>';
    try {
        const manga = await api(`/api/manga/${mangaId}`);
        state.selectedMangaId = mangaId;
        state.selectedManga = manga;
        detail.innerHTML = `<div class="detail-header">
            <div><div class="eyebrow">CHI TIẾT DỰ ÁN</div><h2>${escapeHtml(manga.title)}</h2><div class="muted">Quản lý chapter, nhập ảnh và kiểm tra từng trang.</div></div>
            <button class="btn btn-primary" data-add-chapter="${manga.id}">+ Thêm chapter</button>
        </div>
        <div class="chapter-list">${manga.chapters.length ? manga.chapters.map(renderChapter).join("") : '<div class="empty">Chưa có chapter.</div>'}</div>`;
        detail.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
        detail.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
}

function renderChapter(chapter) {
    const counts = chapter.state_counts;
    const canApprove = chapter.page_count > 0 && !counts.unprocessed && !counts.processing && !counts.in_progress && counts.review;
    const canPublish = chapter.status === "completed";
    const publishRunning = chapter.publish_job && ["pending", "processing"].includes(chapter.publish_job.status);
    const publishLabel = publishRunning ? `${chapter.publish_job.current_step || "Đang xuất bản"} · ${Math.round((chapter.publish_job.progress || 0) * 100)}%` : chapter.publication_status === "published" ? "↻ Cập nhật Study" : "Gửi sang Study";
    const pages = chapter.pages.map((page) => `<a class="page-card" href="/editor?page=${page.id}">
        <img loading="lazy" src="/uploads/${page.original_image_path}" alt="Trang ${page.page_number}">
        <div class="page-info"><div class="page-name">${escapeHtml(page.original_filename || `Trang ${page.page_number}`)}</div><div class="page-state">Trang ${page.page_number} · ${stateLabels[page.workflow_state] || page.workflow_state}</div></div>
    </a>`).join("");
    return `<article class="chapter">
        <div class="chapter-row">
            <div class="chapter-title"><strong>Chapter ${escapeHtml(chapter.chapter_number)} ${escapeHtml(chapter.title || "")}</strong><span>${chapter.page_count} trang</span>
                <div class="chapter-stats">${counts.unprocessed ? `<span class="mini-stat">${counts.unprocessed} chưa xử lý</span>` : ""}${counts.in_progress || counts.processing ? `<span class="mini-stat">${counts.in_progress + counts.processing} đang làm</span>` : ""}${counts.review ? `<span class="mini-stat review">${counts.review} cần duyệt</span>` : ""}${counts.completed ? `<span class="mini-stat completed">${counts.completed} hoàn thành</span>` : ""}</div>
            </div>
            <div class="toolbar"><button class="btn" data-toggle-pages="${chapter.id}">Xem trang</button><button class="btn" data-upload-pages="${chapter.id}" data-chapter-name="Chapter ${escapeHtml(chapter.chapter_number)}">+ Thêm nhiều trang</button>${canApprove ? `<button class="btn btn-primary" data-approve-chapter="${chapter.id}">✓ Xác nhận hoàn thành</button>` : ""}${canPublish ? `<button class="btn btn-primary" data-publish-chapter="${chapter.id}" data-publish-job="${publishRunning ? chapter.publish_job.id : ""}">${publishLabel}</button>` : ""}</div>
        </div>
        <div id="chapter-pages-${chapter.id}" class="page-grid hidden">${pages || '<div class="empty">Chapter chưa có ảnh.</div>'}</div>
    </article>`;
}

function naturalKey(name) {
    return name.normalize("NFKC").toLocaleLowerCase("vi").split(/(\d+)/).map((part) => /^\d+$/.test(part) ? Number(part) : part);
}
function naturalCompare(first, second) {
    const a = naturalKey(first); const b = naturalKey(second);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        if (a[index] === undefined) return -1;
        if (b[index] === undefined) return 1;
        if (a[index] === b[index]) continue;
        if (typeof a[index] === typeof b[index]) return a[index] < b[index] ? -1 : 1;
        return String(a[index]).localeCompare(String(b[index]), "vi");
    }
    return 0;
}

function resetImport() {
    state.importItems.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    state.importItems = [];
    state.importChapterId = null;
    state.importBusy = false;
    $("#import-workspace").classList.add("hidden");
    $("#import-preview").innerHTML = "";
    $("#confirm-import").disabled = true;
    $("#folder-picker").value = "";
    $("#files-picker").value = "";
    $("#upload-form [name=batch_label]").value = "";
}

function clearImportSelection() {
    state.importItems.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    state.importItems = [];
    state.importBusy = false;
    state.draggedIndex = null;
    $("#import-preview").innerHTML = "";
    $("#confirm-import").disabled = true;
    $("#folder-picker").value = "";
    $("#files-picker").value = "";
}

function openImportModal(chapterId, chapterName) {
    resetImport();
    state.importChapterId = chapterId;
    $("#upload-form [name=chapter_id]").value = chapterId;
    $("#upload-chapter-label").textContent = chapterName;
    showModal("#upload-modal");
}

async function sha256(file) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function imageDimensions(file) {
    try {
        const bitmap = await createImageBitmap(file);
        const result = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return result;
    } catch (_) { return { width: 0, height: 0 }; }
}

async function prepareImport(fileList) {
    const allowed = /\.(jpe?g|png|webp)$/i;
    const descriptors = Array.from(fileList).map((entry) => entry.file
        ? entry
        : { file: entry, relativePath: entry.webkitRelativePath || entry.name });
    const files = descriptors.filter(({ file }) => file.type.startsWith("image/") || allowed.test(file.name));
    if (!files.length) { showNotice("Không tìm thấy ảnh JPG, PNG hoặc WebP.", true); return; }
    clearImportSelection();
    state.importBusy = true;
    $("#import-workspace").classList.remove("hidden");
    $("#import-status").textContent = "Đang đọc kích thước và kiểm tra nội dung…";
    const sorted = files.sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
    state.importItems = sorted.map(({ file, relativePath }) => ({ file, displayName: relativePath, previewUrl: URL.createObjectURL(file), width: 0, height: 0, hash: "", duplicateType: null, duplicateOf: null, possibleSpread: false }));
    renderImportPreview();
    try {
        for (let index = 0; index < state.importItems.length; index += 1) {
            const item = state.importItems[index];
            const [hash, dimensions] = await Promise.all([sha256(item.file), imageDimensions(item.file)]);
            item.hash = hash; item.width = dimensions.width; item.height = dimensions.height;
            item.possibleSpread = dimensions.width > dimensions.height * 1.28;
            $("#import-status").textContent = `Đã kiểm tra ${index + 1}/${state.importItems.length} ảnh…`;
        }
        state.importBusy = false;
        await refreshImportDuplicates();
    } catch (error) {
        state.importBusy = false;
        showNotice(error.message, true);
        $("#import-status").textContent = `Không thể kiểm tra: ${error.message}`;
        renderImportPreview();
    }
}

async function refreshImportDuplicates() {
    if (!state.importItems.length || state.importItems.some((item) => !item.hash)) {
        renderImportPreview();
        return;
    }
    const checked = await api(`/api/chapters/${state.importChapterId}/import-check`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: state.importItems.map((item) => ({ name: item.displayName, content_hash: item.hash })) }),
    });
    checked.files.forEach((result, index) => {
        state.importItems[index].duplicateType = result.duplicate_type;
        state.importItems[index].duplicateOf = result.duplicate_of;
    });
    $("#import-status").textContent = checked.duplicate_count
        ? "Có ảnh trùng cần loại bỏ trước khi nhập."
        : "Đã sẵn sàng. Hãy kiểm tra thứ tự trang.";
    renderImportPreview();
}

function renderImportPreview() {
    const duplicateCount = state.importItems.filter((item) => item.duplicateType).length;
    $("#import-count").textContent = `${state.importItems.length} ảnh được chọn`;
    const warning = $("#duplicate-warning");
    warning.classList.toggle("hidden", duplicateCount === 0);
    warning.textContent = duplicateCount ? `${duplicateCount} ảnh bị trùng. Hãy loại chúng khỏi danh sách trước khi nhập.` : "";
    $("#confirm-import").disabled = state.importBusy || !state.importItems.length || duplicateCount > 0;
    $("#import-preview").innerHTML = state.importItems.map((item, index) => {
        const duplicateLabel = item.duplicateType === "existing" ? "Đã có trong chapter" : item.duplicateType === "selection" ? "Trùng trong lựa chọn" : "";
        const spreadLabel = item.possibleSpread ? '<span class="spread-mark">Có thể là trang đôi</span>' : "";
        return `<article class="import-item ${item.duplicateType ? "duplicate" : ""}" draggable="true" data-import-index="${index}">
            <div class="import-thumb"><img src="${item.previewUrl}" alt=""><span class="page-order">${index + 1}</span>${duplicateLabel ? `<span class="duplicate-mark">${duplicateLabel}</span>` : ""}${spreadLabel}</div>
            <div class="import-info"><div class="import-name" title="${escapeHtml(item.displayName)}">${escapeHtml(item.displayName)}</div><div class="import-details">${item.width ? `${item.width} × ${item.height}` : "Đang đọc…"} · ${(item.file.size / 1024 / 1024).toFixed(2)} MB</div>
            <div class="reorder-actions"><button type="button" data-move-import="up" data-index="${index}" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-move-import="down" data-index="${index}" ${index === state.importItems.length - 1 ? "disabled" : ""}>↓</button><button type="button" data-remove-import="${index}" title="Loại ảnh">×</button></div></div>
        </article>`;
    }).join("");
}

function moveImport(from, to) {
    if (from === to || to < 0 || to >= state.importItems.length) return;
    const [item] = state.importItems.splice(from, 1);
    state.importItems.splice(to, 0, item);
    renderImportPreview();
}

function readEntryFile(entry, relativePath) {
    return new Promise((resolve, reject) => entry.file(
        (file) => resolve({ file, relativePath: `${relativePath}${file.name}` }),
        reject,
    ));
}

function readDirectoryEntries(reader) {
    return new Promise((resolve, reject) => {
        const entries = [];
        const readBatch = () => reader.readEntries((batch) => {
            if (!batch.length) { resolve(entries); return; }
            entries.push(...batch); readBatch();
        }, reject);
        readBatch();
    });
}

async function walkDroppedEntry(entry, parentPath = "") {
    if (entry.isFile) return [await readEntryFile(entry, parentPath)];
    if (!entry.isDirectory) return [];
    const directoryPath = `${parentPath}${entry.name}/`;
    const children = await readDirectoryEntries(entry.createReader());
    const nested = await Promise.all(children.map((child) => walkDroppedEntry(child, directoryPath)));
    return nested.flat();
}

async function collectDroppedFiles(dataTransfer) {
    const items = Array.from(dataTransfer.items || []);
    const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return Array.from(dataTransfer.files).map((file) => ({ file, relativePath: file.name }));
    return (await Promise.all(entries.map((entry) => walkDroppedEntry(entry)))).flat();
}

$("#open-manga-modal").addEventListener("click", () => showModal("#manga-modal"));
$("#open-tonari-modal").addEventListener("click", () => showModal("#tonari-modal"));
$("#refresh").addEventListener("click", async () => { await loadLibrary(); if (state.selectedMangaId) await loadMangaDetail(state.selectedMangaId); });
$("#library-search").addEventListener("input", (event) => { state.query = event.target.value; renderLibrary(); });
$("#library-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-filter]"); if (!tab) return;
    state.filter = tab.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === tab));
    renderLibrary();
});
document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", hideModals));

function renderTonariResults(items) {
    $("#tonari-results").innerHTML = items.length ? items.map((item) => `<button type="button" class="source-card" data-tonari-series="${escapeHtml(item.id)}" data-seed-episode="${escapeHtml(item.latest_episode_id || "")}">
        <span class="source-cover">${item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="">` : escapeHtml((item.title || "T").slice(0, 1))}</span>
        <span><strong>${escapeHtml(item.title || "Không rõ tên")}</strong><small>${escapeHtml(item.author || item.latest_episode_title || "Tonari no Young Jump")}</small></span><span class="source-arrow">→</span>
    </button>`).join("") : '<div class="empty">Không tìm thấy truyện phù hợp.</div>';
}

function renderTonariEpisodes() {
    const selected = state.tonariEpisodes.filter((item) => item.selected).length;
    $("#tonari-import").disabled = !selected || Boolean(state.tonariJobId);
    $("#tonari-import").textContent = selected ? `Nhập ${selected} chapter đã chọn` : "Nhập chapter đã chọn";
    $("#tonari-episode-list").innerHTML = state.tonariEpisodes.length ? state.tonariEpisodes.map((item) => `<label class="episode-row ${item.is_public ? "" : "unavailable"}">
        <input type="checkbox" data-tonari-episode="${escapeHtml(item.episode_id)}" ${item.selected ? "checked" : ""} ${item.is_public ? "" : "disabled"}>
        <span><strong>${escapeHtml(item.title || `Episode ${item.episode_id}`)}</strong><small>${item.published_at ? new Date(item.published_at).toLocaleDateString("vi-VN") : "Không rõ ngày"} · ${item.page_count || 0} trang</small></span>
        <span class="availability ${item.is_public ? "public" : ""}">${item.is_public ? "Đọc được" : "Không khả dụng"}</span>
    </label>`).join("") : '<div class="empty">Không tìm thấy chapter công khai trong feed hiện tại.</div>';
}

async function monitorTonariImport(jobId) {
    state.tonariJobId = jobId; $("#tonari-progress").classList.remove("hidden"); renderTonariEpisodes();
    for (;;) {
        const job = await api(`/api/jobs/${jobId}`); const percent = Math.round((job.progress || 0) * 100);
        $("#tonari-progress-bar").style.width = `${percent}%`; $("#tonari-progress-step").textContent = job.current_step || "Đang import…"; $("#tonari-progress-percent").textContent = `${percent}%`;
        if (job.status === "completed") { state.tonariJobId = null; renderTonariEpisodes(); showNotice(`Đã import ${job.result_count || 0} chapter từ Tonari.`); await loadLibrary(); return; }
        if (job.status === "failed") { state.tonariJobId = null; renderTonariEpisodes(); throw new Error(job.error_message || "Import từ Tonari thất bại"); }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
}

$("#tonari-search-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = $("#tonari-search-button"); button.disabled = true; button.textContent = "Đang tìm…";
    $("#tonari-results").innerHTML = '<div class="empty">Đang tìm trên Tonari no Young Jump…</div>'; $("#tonari-episodes").classList.add("hidden");
    try { renderTonariResults((await api(`/api/sources/tonarinoyj/search?q=${encodeURIComponent($("#tonari-query").value)}`)).items); }
    catch (error) { $("#tonari-results").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
    finally { button.disabled = false; button.textContent = "Tìm truyện"; }
});

$("#tonari-results").addEventListener("click", async (event) => {
    const card = event.target.closest("[data-tonari-series]"); if (!card) return;
    $("#tonari-episodes").classList.remove("hidden"); $("#tonari-episode-list").innerHTML = '<div class="empty">Đang đọc danh sách chapter…</div>';
    try {
        const data = await api(`/api/sources/tonarinoyj/series/${card.dataset.tonariSeries}?seed_episode_id=${card.dataset.seedEpisode || ""}`);
        state.tonariSeries = data.series; state.tonariEpisodes = data.episodes.map((item) => ({ ...item, selected: false }));
        $("#tonari-series-title").textContent = data.series.title || "Tonari manga"; $("#tonari-series-meta").textContent = `${data.episodes.filter((item) => item.is_public).length} chapter đang đọc được`; renderTonariEpisodes();
    } catch (error) { $("#tonari-episode-list").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
});

$("#tonari-episode-list").addEventListener("change", (event) => { const input = event.target.closest("[data-tonari-episode]"); if (!input) return; const episode = state.tonariEpisodes.find((item) => item.episode_id === input.dataset.tonariEpisode); if (episode) episode.selected = input.checked; renderTonariEpisodes(); });
$("#tonari-select-all").addEventListener("click", () => { state.tonariEpisodes.forEach((item) => { item.selected = item.is_public; }); renderTonariEpisodes(); });
$("#tonari-import").addEventListener("click", async () => {
    const episodeIds = state.tonariEpisodes.filter((item) => item.selected).map((item) => item.episode_id); if (!episodeIds.length || !state.tonariSeries) return;
    try { const result = await api("/api/sources/tonarinoyj/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ series_id: state.tonariSeries.id, episode_ids: episodeIds }) }); await monitorTonariImport(result.job_id); }
    catch (error) { showNotice(error.message, true); }
});

async function monitorPublish(button, jobId) {
    button.disabled = true;
    for (;;) {
        const job = await api(`/api/jobs/${jobId}`);
        button.textContent = `${job.current_step || "Đang xuất bản"} · ${Math.round((job.progress || 0) * 100)}%`;
        showNotice(button.textContent);
        if (job.status === "completed") return job;
        if (job.status === "failed") throw new Error(job.error_message || "Xuất bản Study thất bại");
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
}

document.addEventListener("click", async (event) => {
    const view = event.target.closest("[data-view-manga]");
    const addChapter = event.target.closest("[data-add-chapter]");
    const upload = event.target.closest("[data-upload-pages]");
    const toggle = event.target.closest("[data-toggle-pages]");
    const approve = event.target.closest("[data-approve-chapter]");
    const publish = event.target.closest("[data-publish-chapter]");
    const move = event.target.closest("[data-move-import]");
    const remove = event.target.closest("[data-remove-import]");
    if (view) await loadMangaDetail(Number(view.dataset.viewManga));
    if (addChapter) { $("#chapter-form [name=manga_id]").value = addChapter.dataset.addChapter; showModal("#chapter-modal"); }
    if (upload) openImportModal(Number(upload.dataset.uploadPages), upload.dataset.chapterName);
    if (toggle) $(`#chapter-pages-${toggle.dataset.togglePages}`).classList.toggle("hidden");
    if (approve) {
        if (!window.confirm("Xác nhận tất cả trang trong chapter này đã đạt và chuyển sang Hoàn thành?")) return;
        try { await api(`/api/chapters/${approve.dataset.approveChapter}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: true }) }); showNotice("Đã xác nhận chapter hoàn thành."); await loadLibrary(); await loadMangaDetail(state.selectedMangaId); } catch (error) { showNotice(error.message, true); }
    }
    if (publish) {
        const existingJobId = Number(publish.dataset.publishJob || 0);
        if (!existingJobId && !window.confirm("Chuẩn bị dữ liệu học và xuất bản chapter này sang Study? Bạn có thể rời trang và quay lại xem tiến độ.")) return;
        publish.disabled = true;
        const oldText = publish.textContent;
        publish.textContent = "Đang chuẩn bị Study…";
        try {
            const started = existingJobId ? { job_id: existingJobId } : await api(`/api/chapters/${publish.dataset.publishChapter}/publish`, { method: "POST" });
            await monitorPublish(publish, started.job_id);
            showNotice("Đã xuất bản chapter sang Study.");
            await loadLibrary();
            await loadMangaDetail(state.selectedMangaId);
        } catch (error) { showNotice(error.message, true); publish.disabled = false; publish.textContent = oldText; }
    }
    if (move) { const index = Number(move.dataset.index); moveImport(index, move.dataset.moveImport === "up" ? index - 1 : index + 1); }
    if (remove) {
        const index = Number(remove.dataset.removeImport);
        URL.revokeObjectURL(state.importItems[index].previewUrl);
        state.importItems.splice(index, 1);
        try { await refreshImportDuplicates(); } catch (error) { showNotice(error.message, true); renderImportPreview(); }
    }
});

$("#import-preview").addEventListener("dragstart", (event) => { const card = event.target.closest("[data-import-index]"); if (card) state.draggedIndex = Number(card.dataset.importIndex); });
$("#import-preview").addEventListener("dragover", (event) => { event.preventDefault(); const card = event.target.closest("[data-import-index]"); if (card) card.classList.add("drag-over"); });
$("#import-preview").addEventListener("dragleave", (event) => event.target.closest("[data-import-index]")?.classList.remove("drag-over"));
$("#import-preview").addEventListener("drop", (event) => { event.preventDefault(); const card = event.target.closest("[data-import-index]"); if (card && state.draggedIndex !== null) moveImport(state.draggedIndex, Number(card.dataset.importIndex)); state.draggedIndex = null; });

$("#choose-folder").addEventListener("click", () => $("#folder-picker").click());
$("#choose-files").addEventListener("click", () => $("#files-picker").click());
$("#folder-picker").addEventListener("change", (event) => prepareImport(event.target.files));
$("#files-picker").addEventListener("change", (event) => prepareImport(event.target.files));
const dropZone = $("#drop-zone");
["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }));
["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
dropZone.addEventListener("drop", async (event) => {
    try { await prepareImport(await collectDroppedFiles(event.dataTransfer)); }
    catch (error) { showNotice(`Không thể đọc thư mục: ${error.message}`, true); }
});

$("#manga-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
    try { await api("/api/manga", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); form.reset(); hideModals(); showNotice("Đã tạo dự án truyện."); await loadLibrary(); } catch (error) { showNotice(error.message, true); }
});

$("#chapter-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const mangaId = data.manga_id; delete data.manga_id;
    try { await api(`/api/manga/${mangaId}/chapters`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); form.reset(); hideModals(); showNotice("Đã tạo chapter."); await loadLibrary(); await loadMangaDetail(Number(mangaId)); } catch (error) { showNotice(error.message, true); }
});

$("#upload-form").addEventListener("submit", async (event) => {
    event.preventDefault(); if (state.importBusy || !state.importItems.length) return;
    const button = $("#confirm-import"); button.disabled = true; button.textContent = "Đang nhập ảnh…";
    const data = new FormData();
    state.importItems.forEach((item) => data.append("files", item.file, item.file.name));
    data.append("preserve_order", "true");
    data.append("batch_label", event.currentTarget.elements.batch_label.value || "");
    try {
        const uploaded = await api(`/api/chapters/${state.importChapterId}/pages`, { method: "POST", body: data });
        hideModals(); showNotice(`Đã nhập ${uploaded.length} trang theo đúng thứ tự đã duyệt.`); await loadLibrary(); if (state.selectedMangaId) await loadMangaDetail(state.selectedMangaId);
    } catch (error) { showNotice(error.message, true); button.disabled = false; }
    finally { button.textContent = "Nhập các trang theo thứ tự này"; }
});

loadLibrary();
