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

  const API_BASE = "http://localhost:8000/api/v1/mangas"

  useEffect(() => {
    fetchMangas()
  }, [])

  const fetchMangas = async () => {
    try {
      const res = await fetch(API_BASE)
      const data = await res.json()
      setMangas(data)
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
    
    try {
      const res = await fetch(`${API_BASE}/${manga.id}/chapters`)
      const data = await res.json()
      setChapters(data)
    } catch (err) {
      console.error(err)
    }
  }

  const handleChapterSelect = async (chapter: Chapter) => {
    setSelectedChapter(chapter)
    setPages([])
    setActivePage(null)
    
    if (!selectedManga) return
    try {
      const res = await fetch(`${API_BASE}/${selectedManga.id}/chapters/${chapter.id}/pages`)
      const data = await res.json()
      setPages(data)
    } catch (err) {
      console.error(err)
    }
  }

  const handlePageSelect = async (page: Page) => {
    setActivePage(page)
    if (!selectedManga || !selectedChapter) return
    
    try {
      const res = await fetch(`${API_BASE}/${selectedManga.id}/chapters/${selectedChapter.id}/pages/${page.id}/blocks`)
      const data = await res.json()
      setBlocks(data)
    } catch (err) {
      console.error(err)
    }
  }

  const runOcr = async () => {
    // This is handled on upload now based on our endpoint changes, or we can trigger it
    alert("OCR is run automatically on upload.")
  }
  
  const runTranslation = async () => {
    if (!selectedManga || !selectedChapter || !activePage) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/${selectedManga.id}/chapters/${selectedChapter.id}/pages/${activePage.id}/translate`, {
        method: "POST"
      })
      const data = await res.json()
      setBlocks(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }
  
  const runInpainting = async () => {
    if (!selectedManga || !selectedChapter || !activePage) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/${selectedManga.id}/chapters/${selectedChapter.id}/pages/${activePage.id}/inpaint`, {
        method: "POST"
      })
      const data = await res.json()
      setActivePage(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="editor-page" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="topbar editor-header">
        <div className="editor-identity">
          <div className="brand">Hakkutsu Manga Studio</div>
        </div>
        <div className="editor-actions">
          <button className="btn" onClick={runTranslation} disabled={!activePage || loading}>Translate Page</button>
          <button className="btn" onClick={runInpainting} disabled={!activePage || loading}>Inpaint Page</button>
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
              <div key={m.id} onClick={() => handleMangaSelect(m)} style={{ cursor: "pointer", fontWeight: selectedManga?.id === m.id ? "bold" : "normal" }}>
                {m.title}
              </div>
            ))}
            
            {selectedManga && (
              <>
                <h4 style={{ marginTop: "20px" }}>Chapters</h4>
                {chapters.map(c => (
                  <div key={c.id} onClick={() => handleChapterSelect(c)} style={{ cursor: "pointer", fontWeight: selectedChapter?.id === c.id ? "bold" : "normal" }}>
                    Ch. {c.chapter_number} - {c.title}
                  </div>
                ))}
              </>
            )}
            
            {selectedChapter && (
              <>
                <h4 style={{ marginTop: "20px" }}>Pages</h4>
                {pages.map(p => (
                  <div key={p.id} onClick={() => handlePageSelect(p)} style={{ cursor: "pointer", fontWeight: activePage?.id === p.id ? "bold" : "normal" }}>
                    Page {p.page_number} ({p.status})
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>

        {/* 4-Panel Workspace */}
        <section className="visual-workspace" style={{ display: "flex", flex: 1 }}>
          <section className="panel visual-panel" style={{ flex: 1, borderRight: "1px solid #333" }}>
            <div className="panel-title">Original</div>
            <div className="canvas-scroll">
              {activePage?.original_image_path ? (
                <img src={`http://localhost:8000/static/${activePage.original_image_path}`} alt="Original" style={{ maxWidth: "100%" }} />
              ) : (
                <div style={{ padding: "20px" }}>Select a page</div>
              )}
            </div>
          </section>
          
          <section className="panel visual-panel" style={{ flex: 1, borderRight: "1px solid #333" }}>
            <div className="panel-title">Clean / Preview</div>
            <div className="canvas-scroll" style={{ position: "relative" }}>
              {activePage?.clean_image_path && (
                <img src={`http://localhost:8000/static/${activePage.clean_image_path}`} alt="Clean" style={{ maxWidth: "100%", display: "block" }} />
              )}
              {/* Text overlays would render here */}
              {blocks.map(block => (
                <div key={block.id} style={{
                  position: "absolute",
                  left: block.x,
                  top: block.y,
                  width: block.width,
                  height: block.height,
                  border: selectedBlockId === block.id ? "2px solid red" : "1px solid blue",
                  color: block.color,
                  fontSize: `${block.font_size}px`,
                  fontFamily: block.font_family,
                  textAlign: block.text_align as any,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }} onClick={() => setSelectedBlockId(block.id)}>
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
                      <textarea className="input" rows={3} readOnly value={block.original_text} />
                    </div>
                    <div className="field">
                      <label>AI Translation</label>
                      <textarea className="input" rows={3} readOnly value={block.ai_translation} />
                    </div>
                    <div className="field">
                      <label>Final Translation</label>
                      <textarea className="input" rows={3} value={block.final_translation} onChange={(e) => {
                        const newBlocks = blocks.map(b => b.id === block.id ? { ...b, final_translation: e.target.value } : b)
                        setBlocks(newBlocks)
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">Select a text block to edit properties.</div>
            )}
          </div>
        </aside>
      </main>
    </div>
  )
}
