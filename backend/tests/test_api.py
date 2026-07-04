"""
Backend tests for Hakkutsu API.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


class TestHealthEndpoint:
    """Tests for the health check endpoint."""

    def test_root_health(self, client: TestClient):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert data["service"] == "Hakkutsu API"

    def test_v1_health(self, client: TestClient):
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"


class TestAnalyzeEndpoint:
    """Tests for the text analysis endpoint."""

    def test_analyze_simple_text(self, client: TestClient):
        response = client.post(
            "/api/v1/analyze",
            json={"text": "日本語を勉強する"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["text"] == "日本語を勉強する"
        assert len(data["tokens"]) > 0
        assert data["token_count"] > 0

    def test_analyze_empty_text(self, client: TestClient):
        response = client.post(
            "/api/v1/analyze",
            json={"text": ""},
        )
        assert response.status_code == 422  # Validation error

    def test_analyze_response_structure(self, client: TestClient):
        response = client.post(
            "/api/v1/analyze",
            json={"text": "食べる"},
        )
        assert response.status_code == 200
        data = response.json()

        token = data["tokens"][0]
        assert "surface" in token
        assert "dictionary_form" in token
        assert "reading" in token
        assert "pos" in token
        assert "is_japanese" in token


class TestSubtitlesEndpoint:
    """Tests for the subtitle extraction endpoint."""

    def test_subtitles_invalid_url(self, client: TestClient):
        response = client.post(
            "/api/v1/subtitles/youtube",
            json={"video_url": "not-a-url"},
        )
        assert response.status_code == 400


class TestOcrEndpoint:
    """Tests for the OCR endpoint."""

    def test_ocr_placeholder(self, client: TestClient):
        response = client.post(
            "/api/v1/ocr",
            json={"image_data": "base64data", "language": "jpn"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["language"] == "jpn"
        assert data["full_text"] == ""
