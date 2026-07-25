/**
 * Firebase Authentication and Firestore service.
 *
 * Handles Google sign-in, auth state, and vocabulary sync.
 * Firebase SDK is loaded dynamically to keep the bundle small
 * when Firebase isn't configured.
 *
 * Phase 1: Stub implementation. Fill in your Firebase config
 * to enable cloud sync.
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

/**
 * Firebase service — currently a stub.
 *
 * To enable Firebase:
 * 1. Create a Firebase project at https://console.firebase.google.com
 * 2. Enable Authentication (Google provider)
 * 3. Create a Firestore database
 * 4. Copy your config and fill in the values below
 */
class FirebaseService {
  private initialized = false;

  /** Check if Firebase is configured */
  isConfigured(): boolean {
    // Will return true when Firebase config is provided
    return false;
  }

  /** Initialize Firebase (call once) */
  async initialize(_config: FirebaseConfig): Promise<void> {
    if (this.initialized) return;

    // Phase 1: Firebase integration is optional
    // When implemented, this will:
    // 1. Initialize Firebase app
    // 2. Set up auth state listener
    // 3. Connect to Firestore
    console.log("[Hakkutsu] Firebase initialization skipped (not configured)");
    this.initialized = true;
  }

  /** Get current user or null */
  async getCurrentUser(): Promise<{ uid: string; email: string; displayName: string } | null> {
    return null;
  }

  /** Sign in with Google */
  async signInWithGoogle(): Promise<void> {
    console.warn("[Hakkutsu] Firebase not configured. Sign-in unavailable.");
  }

  /** Sign out */
  async signOut(): Promise<void> {
    console.warn("[Hakkutsu] Firebase not configured. Sign-out unavailable.");
  }

  /** Sync vocabulary to Firestore */
  async syncVocabulary(_userId: string, _entries: unknown[]): Promise<void> {
    console.warn("[Hakkutsu] Firebase not configured. Vocabulary sync unavailable.");
  }
}

/** Singleton instance */
export const firebaseService = new FirebaseService();
