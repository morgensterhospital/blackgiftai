// Client-side chat + Firebase auth for BLACKGIFT AI
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const resetBtn = document.getElementById('reset');
const signinBtn = document.getElementById('signin');
const signoutBtn = document.getElementById('signout');
const userinfoEl = document.getElementById('userinfo');
const statusEl = document.getElementById('status');

// init firebase (compat)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

let currentIdToken = null;
let currentUser = null;

function appendMessage(text, cls) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function updateIdToken() {
  if (!currentUser) {
    currentIdToken = null;
    return;
  }
  try {
    currentIdToken = await currentUser.getIdToken(false);
  } catch (err) {
    console.error('Failed to get ID token', err);
    currentIdToken = null;
  }
}

auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    await updateIdToken();
    signinBtn.style.display = 'none';
    signoutBtn.style.display = 'inline-block';
    userinfoEl.textContent = user.email || user.displayName || 'Signed in';
    appendMessage('Wakasainiwa se: ' + (user.email || user.displayName), 'bot');
  } else {
    currentUser = null;
    currentIdToken = null;
    signinBtn.style.display = 'inline-block';
    signoutBtn.style.display = 'none';
    userinfoEl.textContent = 'Anonymous';
    appendMessage('Uri kushandisa se anonymous. Sign in kana uchida kuchengetedza hurukuro yako.', 'bot');
  }
});

signinBtn.addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    console.error('Sign-in error', err);
    appendMessage('Kanganiso pa sign-in.', 'bot');
  }
});
signoutBtn.addEventListener('click', async () => {
  await auth.signOut();
});

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;
  appendMessage(text, 'user');
  inputEl.value = '';
  sendBtn.disabled = true;
  statusEl.textContent = 'Sending...';

  try {
    if (currentUser) currentIdToken = await currentUser.getIdToken(false);
    const headers = { 'Content-Type': 'application/json' };
    if (currentIdToken) headers['Authorization'] = `Bearer ${currentIdToken}`;

    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: text })
    });
    const data = await resp.json();
    const reply = data?.reply || 'Handina kupindura.';
    appendMessage(reply, 'bot');
    speakShona(reply);
  } catch (err) {
    console.error(err);
    appendMessage('Kanganiso: Hatikwanise kubatana ne server.', 'bot');
  } finally {
    sendBtn.disabled = false;
    statusEl.textContent = '';
  }
}

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

resetBtn.addEventListener('click', async () => {
  try {
    resetBtn.disabled = true;
    const headers = {};
    if (currentUser) {
      const token = await currentUser.getIdToken(false);
      headers['Authorization'] = `Bearer ${token}`;
    }
    await fetch('/api/reset', { method: 'POST', headers });
    messagesEl.innerHTML = '';
    appendMessage('Hurukuro yadzorerwa. Ndokumbira utange zvakare.', 'bot');
  } catch (err) {
    console.error(err);
    appendMessage('Kanganiso pa reset.', 'bot');
  } finally {
    resetBtn.disabled = false;
  }
});

function speakShona(text) {
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'sn';
  const voices = speechSynthesis.getVoices();
  const shonaVoice = voices.find(v => v.lang && v.lang.startsWith('sn'));
  if (shonaVoice) utter.voice = shonaVoice;
  utter.rate = 1.0;
  utter.pitch = 1.0;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}