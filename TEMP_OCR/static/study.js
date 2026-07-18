const grid = document.querySelector("#study-grid");
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);

async function loadStudy() {
    try {
        const response = await fetch("/api/study");
        if (!response.ok) throw new Error("Không tải được thư viện Study");
        const items = await response.json();
        document.querySelector("#study-count").textContent = `${items.length} chapter đã xuất bản`;
        grid.innerHTML = items.map((item) => `<a class="study-card" href="/study/chapter/${item.chapter_id}">
            <div class="study-cover">${item.cover_url ? `<img loading="lazy" src="${item.cover_url}" alt="${escapeHtml(item.manga_title)}">` : ""}</div>
            <div class="study-card-body"><div class="eyebrow">CHAPTER ${escapeHtml(item.chapter_number)}</div><h2>${escapeHtml(item.manga_title)}</h2><p>${escapeHtml(item.chapter_title || `${item.page_count} trang`)} · ${item.page_count} trang</p></div>
        </a>`).join("") || '<div class="empty">Chưa có chapter nào được xuất bản. Hãy xác nhận và gửi chapter từ Admin.</div>';
    } catch (error) { grid.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}
loadStudy();
