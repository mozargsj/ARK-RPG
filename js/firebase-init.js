const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCMsRQZ5UAQvVGDt8SXWRewUOKeGnaewro",
  authDomain: "ark-rpg-fd8a6.firebaseapp.com",
  projectId: "ark-rpg-fd8a6",
  storageBucket: "ark-rpg-fd8a6.firebasestorage.app",
  messagingSenderId: "454548617469",
  appId: "1:454548617469:web:e9035f5757454302202694",
  measurementId: "G-E234MJKSTS"
};

/* ─── FIREBASE INIT ─── */

firebase.initializeApp(FIREBASE_CONFIG);

const auth = firebase.auth();
const db   = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();
