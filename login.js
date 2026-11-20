// --- IndexedDB ヘルパー (app.jsと共通) ---
const DB_NAME = 'food-alert-db';
const DB_VERSION = 1;
const USERS_STORE = 'users';
const FOODS_STORE = 'foods';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event) => reject('IndexedDB error: ' + request.error);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(USERS_STORE)) {
        db.createObjectStore(USERS_STORE, { keyPath: 'username' });
      }
      if (!db.objectStoreNames.contains(FOODS_STORE)) {
        const foodStore = db.createObjectStore(FOODS_STORE, { keyPath: 'id' });
        foodStore.createIndex('by_user', 'username', { unique: false });
      }
    };
  });
}

async function dbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbPut(storeName, item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}


const $ = (sel) => document.querySelector(sel);

// フォームの表示を切り替える (変更なし)
function toggleForms(show) {
  $('#loginForm').style.display = (show === 'login') ? 'block' : 'none';
  $('#registerForm').style.display = (show === 'register') ? 'block' : 'none';
  $('#showLoginLink').style.display = (show === 'register') ? 'inline' : 'none';
  $('#showRegisterLink').style.display = (show === 'login') ? 'inline' : 'none';
  $('#loginError').style.display = 'none';
  $('#regError').style.display = 'none';
}

// --- イベントリスナー ---
// 新規登録処理
$('#registerBtn').onclick = async () => {
  const username = $('#regUser').value.trim();
  const password = $('#regPass').value.trim();
  const errorEl = $('#regError');
  
  if (!username || !password) {
    errorEl.textContent = 'ユーザー名とパスワードを入力してください。';
    errorEl.style.display = 'block';
    return;
  }

  const existingUser = await dbGet(USERS_STORE, username);
  if (existingUser) {
    errorEl.textContent = 'そのユーザー名は既に使用されています。';
    errorEl.style.display = 'block';
    return;
  }

  // 注意: 本番環境ではパスワードは必ずハッシュ化してください
  await dbPut(USERS_STORE, { username, password });
  alert('登録が完了しました。ログインしてください。');
  toggleForms('login');
};

// ログイン処理
$('#loginBtn').onclick = async () => {
  const username = $('#loginUser').value.trim();
  const password = $('#loginPass').value.trim();
  const errorEl = $('#loginError');
  
  if (!username || !password) {
    errorEl.textContent = 'ユーザー名とパスワードを入力してください。';
    errorEl.style.display = 'block';
    return;
  }

  const user = await dbGet(USERS_STORE, username);

  if (user && user.password === password) {
    // ログイン成功：SessionStorageにユーザー情報を保存してリダイレクト
    sessionStorage.setItem('loggedInUser', username);
    window.location.href = './index.html';
  } else {
    errorEl.textContent = 'ユーザー名またはパスワードが間違っています。';
    errorEl.style.display = 'block';
  }
};

// フォーム切り替えリンク (変更なし)
$('#showRegisterLink').onclick = () => toggleForms('register');
$('#showLoginLink').onclick = () => toggleForms('login');

// --- 初期化処理 (変更なし) ---
// ページ読み込み時に、もし既にログイン済みならメインページへリダイレクト
if (sessionStorage.getItem('loggedInUser')) {
  window.location.href = './index.html';
}