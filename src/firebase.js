// firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
// Replace these with your actual Firebase project details
const firebaseConfig = {
  apiKey: "AIzaSyA1BCdefGHijKLmno7PQRstuvwxyz12345",
  authDomain: "blocksync-demo.firebaseapp.com",
  databaseURL: "https://blocksync-demo-default-rtdb.firebaseio.com",
  projectId: "blocksync-demo",
  storageBucket: "blocksync-demo.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890",
  measurementId: "G-ABCDEFGHIJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
const db = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app);

export { db, auth, storage };