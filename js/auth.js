/* ─── AUTH ─── */
  function signIn() {
    auth.signInWithPopup(googleProvider)
      .catch(err => console.error("Login error:", err));
  }

  function confirmApplyPoints() {

    const skip = localStorage.getItem("skipApplyPointsConfirm");
  
    if (skip === "true") {
      applyPoints();
      return;
    }
  
    document.getElementById("applyPointsModal").style.display = "flex";
  }

  function signOut() { auth.signOut().then(() => { currentUser = null; currentRole = null; showScreen('login'); }); }

 auth.onAuthStateChanged(async (user) => {
    if (!user) { showScreen('login'); return; }
    currentUser = user;
    try {
      const userRef = db.collection('users').doc(user.uid);
      const snap    = await userRef.get();

      if (!snap.exists) {
        const role = user.email === ADMIN_EMAIL ? 'admin' : 'player';
        await userRef.set({
          uid: user.uid, email: user.email,
          displayName: user.displayName || user.email,
          photoURL: user.photoURL || '',
          role, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        currentRole = role;
      } else {
        currentRole = snap.data().role;
        await userRef.update({ displayName: user.displayName || user.email, photoURL: user.photoURL || '' });
      }

      if (currentRole === 'player') {
        await initSheetForUser(user.uid, false);
        showScreen('sheet');
      } else {
        await loadDashboard();
        showScreen('dashboard');
      }
    } catch (err) {
      console.error('Auth error:', err);
      alert('Erro ao autenticar. Verifique a configuração do Firebase.');
    }
  });
