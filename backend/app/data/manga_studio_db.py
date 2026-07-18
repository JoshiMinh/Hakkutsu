from typing import List, Optional
import uuid
from datetime import datetime, UTC
from app.core.firebase import get_db
from app.models.manga_studio import Manga, Chapter, Page, TextBlock, MangaCreate, ChapterCreate, TextBlockInput

def get_mangas_collection():
    db = get_db()
    if not db:
        raise Exception("Firestore not initialized")
    return db.collection('mangas')

def utc_now():
    return datetime.now(UTC)

# --- Manga ---
def create_manga(data: MangaCreate) -> Manga:
    mangas_ref = get_mangas_collection()
    manga_id = str(uuid.uuid4())
    now = utc_now()
    manga = Manga(
        id=manga_id,
        title=data.title,
        author=data.author,
        description=data.description,
        tags=data.tags,
        created_at=now,
        updated_at=now
    )
    mangas_ref.document(manga_id).set(manga.model_dump())
    return manga

def get_manga(manga_id: str) -> Optional[Manga]:
    doc = get_mangas_collection().document(manga_id).get()
    if doc.exists:
        return Manga(**doc.to_dict())
    return None

def list_mangas() -> List[Manga]:
    docs = get_mangas_collection().order_by("created_at", direction="DESCENDING").stream()
    return [Manga(**doc.to_dict()) for doc in docs]

# --- Chapters ---
def create_chapter(manga_id: str, data: ChapterCreate) -> Chapter:
    chapters_ref = get_mangas_collection().document(manga_id).collection('chapters')
    chapter_id = str(uuid.uuid4())
    now = utc_now()
    chapter = Chapter(
        id=chapter_id,
        chapter_number=data.chapter_number,
        title=data.title,
        status="pending",
        created_at=now,
        updated_at=now
    )
    chapters_ref.document(chapter_id).set(chapter.model_dump())
    return chapter

def list_chapters(manga_id: str) -> List[Chapter]:
    chapters_ref = get_mangas_collection().document(manga_id).collection('chapters')
    docs = chapters_ref.order_by("chapter_number").stream()
    return [Chapter(**doc.to_dict()) for doc in docs]

def get_chapter(manga_id: str, chapter_id: str) -> Optional[Chapter]:
    doc = get_mangas_collection().document(manga_id).collection('chapters').document(chapter_id).get()
    if doc.exists:
        return Chapter(**doc.to_dict())
    return None

# --- Pages ---
def create_page(manga_id: str, chapter_id: str, page_number: int, original_image_path: str, width: int, height: int) -> Page:
    pages_ref = get_mangas_collection().document(manga_id).collection('chapters').document(chapter_id).collection('pages')
    page_id = str(uuid.uuid4())
    now = utc_now()
    page = Page(
        id=page_id,
        page_number=page_number,
        original_image_path=original_image_path,
        width=width,
        height=height,
        created_at=now,
        updated_at=now
    )
    pages_ref.document(page_id).set(page.model_dump())
    return page

def list_pages(manga_id: str, chapter_id: str) -> List[Page]:
    pages_ref = get_mangas_collection().document(manga_id).collection('chapters').document(chapter_id).collection('pages')
    docs = pages_ref.order_by("page_number").stream()
    return [Page(**doc.to_dict()) for doc in docs]

def get_page(manga_id: str, chapter_id: str, page_id: str) -> Optional[Page]:
    doc = get_mangas_collection().document(manga_id).collection('chapters').document(chapter_id).collection('pages').document(page_id).get()
    if doc.exists:
        return Page(**doc.to_dict())
    return None

def update_page(manga_id: str, chapter_id: str, page: Page) -> Page:
    page.updated_at = utc_now()
    get_mangas_collection().document(manga_id).collection('chapters').document(chapter_id).collection('pages').document(page.id).set(page.model_dump())
    return page

# --- Text Blocks ---
def save_text_blocks(manga_id: str, chapter_id: str, page_id: str, blocks_data: List[TextBlockInput]) -> List[TextBlock]:
    page_ref = get_mangas_collection().document(manga_id).collection('chapters').document(chapter_id).collection('pages').document(page_id)
    blocks_ref = page_ref.collection('text_blocks')
    
    # Optional: Delete existing if this is a complete replacement (depending on logic)
    
    saved_blocks = []
    now = utc_now()
    db = get_db()
    batch = db.batch()
    
    for block_in in blocks_data:
        block_id = block_in.id or str(uuid.uuid4())
        doc_ref = blocks_ref.document(block_id)
        
        block = TextBlock(
            id=block_id,
            **block_in.model_dump(exclude={'id'}),
            created_at=now,
            updated_at=now
        )
        batch.set(doc_ref, block.model_dump())
        saved_blocks.append(block)
        
    batch.commit()
    return saved_blocks

def get_text_blocks(manga_id: str, chapter_id: str, page_id: str) -> List[TextBlock]:
    blocks_ref = get_mangas_collection().document(manga_id).collection('chapters').document(chapter_id).collection('pages').document(page_id).collection('text_blocks')
    docs = blocks_ref.stream()
    return [TextBlock(**doc.to_dict()) for doc in docs]

def delete_all_text_blocks(manga_id: str, chapter_id: str, page_id: str):
    blocks_ref = get_mangas_collection().document(manga_id).collection('chapters').document(chapter_id).collection('pages').document(page_id).collection('text_blocks')
    docs = blocks_ref.stream()
    db = get_db()
    batch = db.batch()
    for doc in docs:
        batch.delete(doc.reference)
    batch.commit()
