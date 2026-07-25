import { initializeApp, getApp, getApps } from "firebase/app"
import { getAuth } from "firebase/auth"
import { getFirestore } from "firebase/firestore"

const firebaseConfig = {
  projectId: "hakkutsu-161ff",
  appId: "1:306935659851:web:b3c3b7e715e56cff2e7cce",
  storageBucket: "hakkutsu-161ff.firebasestorage.app",
  apiKey: "AIzaSyDkZW3eevXnCE_5f9xEE0a5HnV7StYHFUA",
  authDomain: "hakkutsu-161ff.firebaseapp.com",
  messagingSenderId: "306935659851",
  measurementId: "G-69H31RQVT1"
}

// Initialize Firebase
const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
