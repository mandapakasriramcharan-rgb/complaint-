/*
=========================================================
 ROUTEWISE - FIREBASE CONFIGURATION
=========================================================

Current version:
- RouteWise prototype uses localStorage.
- This file is kept ready for future Firebase integration.
- Do NOT put application logic here.
- Authentication/database logic will be added when Firebase
  is connected.
=========================================================
*/


// -------------------------------------------------------
// FIREBASE CONFIG
// -------------------------------------------------------
//
// When you create your Firebase project, replace these
// placeholder values with your Firebase project settings.
//
// Firebase Console:
// Project Settings → Your apps → Firebase SDK setup
//

const firebaseConfig = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
};


// -------------------------------------------------------
// FIREBASE STATUS
// -------------------------------------------------------
//
// We keep the application running in prototype mode until
// valid Firebase credentials are added.
//

const RouteWiseFirebase = {
    enabled: false,

    config: firebaseConfig,

    isConfigured() {
        return Boolean(
            firebaseConfig.apiKey &&
            firebaseConfig.authDomain &&
            firebaseConfig.projectId &&
            firebaseConfig.appId
        );
    }
};


// -------------------------------------------------------
// FUTURE FIREBASE INITIALIZATION
// -------------------------------------------------------
//
// When Firebase is actually connected, this section can
// initialize Firebase Auth, Firestore and Storage.
//
// Example future structure:
//
// Firebase Authentication
//   ↓
// Firestore Database
//   ↓
// Firebase Storage
//
// For now, nothing is initialized here.
//

if (RouteWiseFirebase.isConfigured()) {

    console.info(
        "RouteWise: Firebase configuration detected."
    );

    /*
    Future Firebase initialization goes here.

    Example:

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);
    */

} else {

    console.info(
        "RouteWise: Running in localStorage prototype mode."
    );
}


// -------------------------------------------------------
// GLOBAL ACCESS
// -------------------------------------------------------

window.RouteWiseFirebase = RouteWiseFirebase;