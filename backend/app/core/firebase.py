import os
import firebase_admin
from firebase_admin import credentials, firestore
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

def initialize_firebase():
    if not firebase_admin._apps:
        try:
            if settings.FIREBASE_CREDENTIALS_PATH and os.path.exists(settings.FIREBASE_CREDENTIALS_PATH):
                cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
                firebase_admin.initialize_app(cred)
                logger.info(f"Initialized Firebase with credentials from {settings.FIREBASE_CREDENTIALS_PATH}")
            else:
                # Fallback to default application credentials (or if no auth is needed for local emulator)
                firebase_admin.initialize_app()
                logger.info("Initialized Firebase with default credentials")
        except Exception as e:
            logger.error(f"Failed to initialize Firebase: {e}")

# Initialize immediately
initialize_firebase()

def get_db():
    try:
        return firestore.client()
    except Exception as e:
        logger.error(f"Failed to get Firestore client: {e}")
        return None
