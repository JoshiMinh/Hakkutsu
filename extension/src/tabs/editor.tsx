import { useState, useEffect } from "react"
import type { Manga, Chapter, Page, TextBlock } from "../types/manga_studio"
import "../style.css"

export default function MangaEditorTab() {
  const [mangas, setMangas] = useState<Manga[]>([])
  const [selectedManga, setSelectedManga] = useState<Manga | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [activePage, setActivePage] = useState<Page | null>(null)
  const [blocks, setBlocks] = useState<TextBlock[]>([])
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>("")

  const SERVER_URL = "http://localhost:8000"
  const API_BASE = `${SERVER_URL}/api`

  useEffect(() => {
    fetchMangas()
  }, [])

  const fetchMangas = async () => {
    try {
      const res = await fetch(`${API_BASE}/manga`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMangas(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error("Failed to fetch mangas", err)
    }
  }

  const handleMangaSelect = async (manga: Manga) => {
    setSelectedManga(manga)
    setChapters([])
    setSelectedChapter(null)
    setPages([])
    setActivePage(null)
    setBlocks([])
    
    try {
      const res = await fetch(`${API_BASE}/manga/${manga.id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setChapters(Array.isArray(data.chapters) ? data.chapters : [])
    } catch (err) {
      console.error("Failed to fetch chapters", err)
    }
  }

  const handleChapterSelect = async (chapter: Chapter) => {
    setSelectedChapter(chapter)
    setPages([])
    setActivePage(null)
    setBlocks([])
    
    try {
      const res = await fetch(`${API_BASE}/chapters/${chapter.id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setPages(Array.isArray(data.pages) ? data.pages : [])
    } catch (err) {
      console.error("Failed to fetch chapter pages", err)
    }
  }

  const handlePageSelect = async (page: Page) => {
    setActivePage(page)
    setSelectedBlockId(null)
    
    try {
      const res = await fetch(`${API_BASE}/pages/${page.id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setActivePage(data)
      setBlocks(Array.isArray(data.text_blocks) ? data.text_blocks : [])
    } catch (err) {
      console.error("Failed to fetch page details", err)
    }
  }

  const pollJob = async (jobId: number, taskName: string): Promise<void> => {
    const startTime = Date.now()
    const timeoutMs = 60000
    while (Date.now() - startTime < timeoutMs) {
      const res = await fetch(`${API_BASE}/jobs/${jobId}`)
      if (res.ok) {
        const job = await res.json()
        if (job.status === "completed") {
          setStatusMessage(`${taskName} completed!`)
          return
        }
        if (job.status === "failed") {
          throw new Error(job.error_message || `${taskName} failed`)
        }
        setStatusMessage(`${taskName}: ${job.current_step || job.status}...`)
      }
      await new Promise(resolve => setTimeout(resolve, 800))
    }
    throw new Error(`${taskName} timed out`)
  }

  const reloadActivePage = async (pageId: string | number) => {
    const res = await fetch(`${API_BASE}/pages/${pageId}`)
    if (res.ok) {
      const data = await res.json()
      setActivePage(data)
      setBlocks(Array.isArray(data.text_blocks) ? data.text_blocks : [])
    }
  }
  
  const runTranslation = async () => {
    if (!activePage) return
    setLoading(true)
    setStatusMessage("Starting translation...")
    try {
      const res = await fetch(`${API_BASE}/pages/${activePage.id}/translate`, {
        method: "POST"
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.job_id) {
        await pollJob(data.job_id, "Translation")
        await reloadActivePage(activePage.id)
      }
    } catch (err: any) {
      console.error("Translation error:", err)
      setStatusMessage(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }
  
  const runInpainting = async () => {
    if (!activePage) return
    setLoading(true)
    setStatusMessage("Starting inpainting...")
    try {
      const res = await fetch(`${API_BASE}/pages/${activePage.id}/inpaint`, {
        method: "POST"
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.job_id) {
        await pollJob(data.job_id, "Inpainting")
        await reloadActivePage(activePage.id)
      }
    } catch (err: any) {
      console.error("Inpainting error:", err)
      setStatusMessage(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const originalImgUrl = activePage?.original_image_path
    ? `${SERVER_URL}/uploads/${activePage.original_image_path}`
    : null

  const cleanImgUrl = activePage?.clean_image_path
    ? `${SERVER_URL}/uploads/${activePage.clean_image_path}`
    : originalImgUrl

  return (
    <div className="editor-page" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="topbar editor-header">
        <div className="editor-identity">
          <div className="brand">Hakkutsu Manga Studio</div>
          {statusMessage && (
            <span style={{ fontSize: "13px", color: "var(--hk-accent-primary, #6366f1)", marginLeft: "16px" }}>
              {statusMessage}
            </span>
          )}
        </div>
        <div className="editor-actions">
          <button className="btn" onClick={runTranslation} disabled={!activePage || loading}>
            Translate Page
          </button>
          <button className="btn" onClick={runInpainting} disabled={!activePage || loading}>
            Inpaint Page
          </button>
        </div>
      </header>

      <main className="editor-shell" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <aside className="slides-pane panel" style={{ width: "250px", overflowY: "auto" }}>
          <div className="slides-header">
            <strong>Library</strong>
          </div>
          <div style={{ padding: "10px" }}>
            <h4>Mangas</h4>
            {mangas.map(m => (
              <div
                key={m.id}
                onClick={() => handleMangaSelect(m)}
                style={{
                  padding: "6px 8px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: selectedManga?.id === m.id ? "bold" : "normal",
                  backgroundColor: selectedManga?.id === m.id ? "rgba(99, 102, 241, 0.15)" : "transparent"
                }}
              >
                {m.title}
              </div>
            ))}
            
            {selectedManga && (
              <>
                <h4 style={{ marginTop: "20px" }}>Chapters</h4>
                {chapters.map(c => (
                  <div
                    key={c.id}
                    onClick={() => handleChapterSelect(c)}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: selectedChapter?.id === c.id ? "bold" : "normal",
                      backgroundColor: selectedChapter?.id === c.id ? "rgba(99, 102, 241, 0.15)" : "transparent"
                    }}
                  >
                    Ch. {c.chapter_number} - {c.title}
                  </div>
                ))}
              </>
            )}
            
            {selectedChapter && (
              <>
                <h4 style={{ marginTop: "20px" }}>Pages</h4>
                {pages.map(p => (
                  <div
                    key={p.id}
                    onClick={() => handlePageSelect(p)}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: activePage?.id === p.id ? "bold" : "normal",
                      backgroundColor: activePage?.id === p.id ? "rgba(99, 102, 241, 0.15)" : "transparent"
                    }}
                  >
                    Page {p.page_number} ({p.status})
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>

        {/* Workspace */}
        <section className="visual-workspace" style={{ display: "flex", flex: 1 }}>
          <section className="panel visual-panel" style={{ flex: 1, borderRight: "1px solid #333" }}>
            <div className="panel-title">Original</div>
            <div className="canvas-scroll">
              {originalImgUrl ? (
                <img src={originalImgUrl} alt="Original" style={{ maxWidth: "100%" }} />
              ) : (
                <div style={{ padding: "20px", color: "#888" }}>Select a page to view</div>
              )}
            </div>
          </section>
          
          <section className="panel visual-panel" style={{ flex: 1, borderRight: "1px solid #333" }}>
            <div className="panel-title">Clean / Inpainted</div>
            <div className="canvas-scroll" style={{ position: "relative" }}>
              {cleanImgUrl && (
                <img src={cleanImgUrl} alt="Clean" style={{ maxWidth: "100%", display: "block" }} />
              )}
              {blocks.map(block => (
                <div
                  key={block.id}
                  style={{
                    position: "absolute",
                    left: block.x,
                    top: block.y,
                    width: block.width,
                    height: block.height,
                    border: selectedBlockId === block.id ? "2px solid #ef4444" : "1px dashed #6366f1",
                    backgroundColor: "rgba(99, 102, 241, 0.08)",
                    color: block.color || "#000",
                    fontSize: `${block.font_size || 14}px`,
                    fontFamily: block.font_family || "inherit",
                    textAlign: (block.text_align as any) || "center",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxSizing: "border-box"
                  }}
                  onClick={() => setSelectedBlockId(block.id)}
                >
                  {block.final_translation || block.ai_translation || block.original_text}
                </div>
              ))}
            </div>
          </section>
        </section>

        {/* Inspector */}
        <aside className="panel inspector-panel" style={{ width: "300px", overflowY: "auto" }}>
          <div className="panel-title">Properties</div>
          <div style={{ padding: "10px" }}>
            {selectedBlockId ? (
              <div>
                {blocks.filter(b => b.id === selectedBlockId).map(block => (
                  <div key={block.id}>
                    <div className="field">
                      <label>Original OCR</label>
                      <textarea className="input" rows={3} readOnly value={block.original_text || ""} />
                    </div>
                    <div className="field" style={{ marginTop: "12px" }}>
                      <label>AI Translation</label>
                      <textarea className="input" rows={3} readOnly value={block.ai_translation || ""} />
                    </div>
                    <div className="field" style={{ marginTop: "12px" }}>
                      <label>Final Translation</label>
                      <textarea
                        className="input"
                        rows={3}
                        value={block.final_translation || ""}
                        onChange={(e) => {
                          const newBlocks = blocks.map(b => b.id === block.id ? { ...b, final_translation: e.target.value } : b)
                          setBlocks(newBlocks)
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty" style={{ color: "#888", padding: "12px" }}>
                Select a text block to inspect or edit.
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  )
}
