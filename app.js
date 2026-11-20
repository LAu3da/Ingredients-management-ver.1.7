// --- 認証チェック ---
const currentUser = sessionStorage.getItem('loggedInUser');
if (!currentUser) {
  window.location.href = './login.html';
}

// --- IndexedDB ヘルパー ---
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

async function dbGetAll(storeName, indexName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const source = indexName ? store.index(indexName) : store;
        const request = source.getAll(key);
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

async function dbDelete(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

const $ = (sel)=>document.querySelector(sel);
const twoDaysMs = 2*24*60*60*1000;
let deferredPrompt = null;
let currentDate = new Date();

// --- PWA, SW, 通知関連のコード ---
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault(); deferredPrompt = e;
  const btn = $('#installBtn'); btn.hidden = false;
  btn.onclick = async ()=>{
    btn.hidden = true;
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
  };
});
if ('serviceWorker'in navigator) {
    navigator.serviceWorker.register('./sw.js').then(async (registration) => {
        console.log('Service Worker registered!');
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') {
            try {
                await registration.periodicSync.register('check-expiry-foods', {
                    minInterval: 12 * 60 * 60 * 1000,
                });
                console.log('Periodic background sync registered!');
            } catch (err) {
                console.error('Periodic background sync failed:', err);
            }
        }
    });
}

async function ensurePermission(){
  if (!('Notification'in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

// --- データ読み込み ---
function load(){ return dbGetAll(FOODS_STORE, 'by_user', currentUser); }
function escapeHtml(s){return s.replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

async function renderAll() {
    const foods = await load();
    renderCalendar(foods);
    renderListView(foods);
    updateAutocomplete(foods); 
}

function updateAutocomplete(foods) {
  const historyList = $('#nameHistory');
  if (!historyList) return;
  
  historyList.innerHTML = '';
  const names = [...new Set(foods.map(f => f.name))].sort();
  
  names.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    historyList.appendChild(option);
  });
}

// --- リスト表示 (ドラッグ機能) ---
function renderListView(list) {
  const sortedList = [...list].sort((a,b)=>a.expiry-b.expiry);
  const wrap = $('#list'); wrap.innerHTML = '';
  const now = Date.now();
  for(const f of sortedList){
    const daysLeft = Math.ceil((f.expiry - now)/86400000);
    const cls = daysLeft <= 0 ? 'danger' : (daysLeft <= 2 ? 'warn' : 'ok');
    let label = '';
    if (daysLeft < -3) { label = '期限切れ'; }
    else if (daysLeft < 0) { label = '消費してください'; }
    else if (daysLeft <= 0) { label = '本日消費期限'; }
    else if (daysLeft < 3) { label = '消費してください'; }
    else { label = `賞味期限${daysLeft + 3}日前です`; }
    
    const div = document.createElement('div');
    div.className = 'item';
    div.draggable = true;
    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', f.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    
    div.innerHTML = `
      <div>
        <div><strong>${escapeHtml(f.name)}</strong> × ${f.qty}</div>
        <div style="color:#9ca3af;font-size:12px">期限: ${new Date(f.originalExpiry || f.expiry).toLocaleDateString()}</div>
      </div>
      <div style="display:flex;gap:4px;align-items:center">
        <span class="badge ${cls}" style="margin-right:4px">${label}</span>
        <button class="edit" data-action="edit">編集</button>
        <button class="danger" data-action="consume">消費</button>
      </div>`;
    
    div.querySelector('[data-action="edit"]').onclick = () => openEditModal(f.id);
    div.querySelector('[data-action="consume"]').onclick = () => consume(f.id);
    wrap.appendChild(div);
  }
}

// --- カレンダー表示 (ドロップ機能) ---
function renderCalendar(foods) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    $('#monthYear').textContent = `${year}年 ${month + 1}月`;
    const calendarGrid = $('#calendar');
    calendarGrid.innerHTML = '';
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    
    const foodsByDate = foods.reduce((acc, food) => {
        const d = new Date(food.originalExpiry || food.expiry);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(food);
        return acc;
    }, {});

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    ['日', '月', '火', '水', '木', '金', '土'].forEach(day => {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day header';
        dayEl.textContent = day;
        calendarGrid.appendChild(dayEl);
    });
    for (let i = 0; i < firstDay; i++) { calendarGrid.appendChild(document.createElement('div')); }
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        dayEl.dataset.date = dateStr;

        dayEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            dayEl.classList.add('drag-over');
        });
        dayEl.addEventListener('dragleave', () => {
            dayEl.classList.remove('drag-over');
        });
        dayEl.addEventListener('drop', (e) => {
            e.preventDefault();
            dayEl.classList.remove('drag-over');
            const foodId = e.dataTransfer.getData('text/plain');
            handleDropOnCalendar(foodId, dateStr);
        });

        const dayNumberEl = document.createElement('span');
        dayNumberEl.className = 'calendar-day-number';
        dayNumberEl.textContent = day;
        if (dateStr === todayStr) { dayNumberEl.classList.add('today'); }
        dayEl.appendChild(dayNumberEl);
        
        if (foodsByDate[dateStr]) {
            const now = Date.now();
            foodsByDate[dateStr].forEach(f => {
                const daysLeft = Math.ceil((f.expiry - now)/86400000);
                const cls = daysLeft<=0 ? 'danger' : (daysLeft<=2 ? 'warn' : 'ok');
                const itemEl = document.createElement('div');
                itemEl.className = `calendar-item ${cls}`;
                itemEl.textContent = f.name;
                itemEl.title = `${f.name} (数量: ${f.qty})`;
                
                itemEl.draggable = true;
                itemEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', f.id);
                    e.stopPropagation();
                });

                dayEl.appendChild(itemEl);
            });
        }
        calendarGrid.appendChild(dayEl);
    }
}

// --- 機能ロジック ---
async function addFood(){
  const name = $('#name').value.trim() || `食材${Date.now()%1000}`;
  const date = $('#date').value;
  // 修正: parseIntで整数のみ取得
  const qty = parseInt($('#qty').value||'1', 10);
  
  const inputDate = date ? new Date(date+'T00:00:00') : new Date();
  const originalExpiry = inputDate.getTime();
  const consumptionDate = new Date(inputDate);
  consumptionDate.setDate(consumptionDate.getDate() - 3);
  const expiry = consumptionDate.getTime();
  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()));
  
  await dbPut(FOODS_STORE, { id, username: currentUser, name, qty, expiry, originalExpiry });

  $('#name').value='';
  $('#qty').value='1';
  renderAll();
  checkAndNotify();
}

async function consume(id){ 
  await dbDelete(FOODS_STORE, id);
  renderAll();
}

async function clearAllFoods() {
  const foods = await load();
  if (foods.length === 0) return;
  if (confirm('本当にすべての食材データを削除しますか？')) {
    await Promise.all(foods.map(f => dbDelete(FOODS_STORE, f.id)));
    renderAll();
  }
}

async function handleDropOnCalendar(foodId, newDateStr) {
    if (!foodId || !newDateStr) return;
    const foods = await load();
    const targetFood = foods.find(f => f.id === foodId);
    if (!targetFood) return;

    const newDate = new Date(newDateStr + 'T00:00:00');
    const newOriginalExpiry = newDate.getTime();
    const notificationDate = new Date(newDate);
    notificationDate.setDate(notificationDate.getDate() - 3);
    const newExpiry = notificationDate.getTime();

    const updatedFood = { ...targetFood, originalExpiry: newOriginalExpiry, expiry: newExpiry };

    if (confirm(`「${targetFood.name}」の期限を ${newDateStr} に変更しますか？`)) {
        await dbPut(FOODS_STORE, updatedFood);
        renderAll();
        checkAndNotify();
    }
}

async function checkAndNotify(){
  const granted = await ensurePermission(); if(!granted) return;
  const now = Date.now();
  const near = (await load()).filter(f => f.expiry - now <= twoDaysMs);
  if (near.length===0) return;
  const title = '賞味期限が近い食材があります';
  const message = near.slice(0,3).map(f=>f.name).join('・') + (near.length>3?` ほか${near.length-3}件`:'');

  if (navigator.serviceWorker?.ready) {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, { body: message, icon: './icon-192.png', tag:'expiry' });
  } else {
    new Notification(title, { body: message });
  }
}

// --- 編集機能 ---
let currentEditingId = null;
async function openEditModal(id) {
  const foods = await load();
  const target = foods.find(f => f.id === id);
  if (!target) return;
  currentEditingId = id;
  $('#editName').value = target.name;
  $('#editQty').value = target.qty;
  const d = new Date(target.originalExpiry || target.expiry);
  $('#editDate').value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  $('#editDialog').showModal();
}

async function saveEdit() {
  if (!currentEditingId) return;
  const name = $('#editName').value.trim();
  const date = $('#editDate').value;
  // 修正: parseIntで整数のみ取得
  const qty = parseInt($('#editQty').value || '0', 10);
  
  if (!name || !date) return alert('入力してください');

  const foods = await load();
  const original = foods.find(f => f.id === currentEditingId);
  if (!original) return;

  const d = new Date(date + 'T00:00:00');
  const orgExp = d.getTime();
  const notExp = new Date(d); notExp.setDate(notExp.getDate()-3);
  
  await dbPut(FOODS_STORE, { ...original, name, qty, expiry: notExp.getTime(), originalExpiry: orgExp });
  
  $('#editDialog').close();
  currentEditingId = null;
  renderAll();
  checkAndNotify();
}

// --- イベントリスナー設定 ---
window.addEventListener('focus', checkAndNotify);
$('#add').onclick = addFood;
$('#testNotify').onclick = checkAndNotify;
$('#clearAllBtn').onclick = clearAllFoods;
$('#saveEditBtn').onclick = saveEdit;
$('#cancelEditBtn').onclick = () => { $('#editDialog').close(); currentEditingId = null; };

$('#prevMonthBtn').onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); renderAll(); };
$('#nextMonthBtn').onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); renderAll(); };

function setupDragMonthSwitching(btnId, direction) {
    const btn = $(btnId);
    let timeout = null;
    btn.addEventListener('dragover', (e) => { e.preventDefault(); btn.classList.add('drag-active'); });
    btn.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => { currentDate.setMonth(currentDate.getMonth() + direction); renderAll(); }, 700);
    });
    btn.addEventListener('dragleave', () => { btn.classList.remove('drag-active'); if(timeout) clearTimeout(timeout); });
    btn.addEventListener('drop', (e) => { e.preventDefault(); btn.classList.remove('drag-active'); if(timeout) clearTimeout(timeout); });
}
setupDragMonthSwitching('#prevMonthBtn', -1);
setupDragMonthSwitching('#nextMonthBtn', 1);

$('#logoutBtn').onclick = () => {
  if (confirm('ログアウトしますか？')) {
    sessionStorage.removeItem('loggedInUser');
    window.location.href = './login.html';
  }
};
$('h1').textContent = `${currentUser}の食材リスト`;

// --- AIレシピ提案 (Gemini) ---
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const savedKey = localStorage.getItem('gemini_api_key');
if (savedKey) $('#apiKey').value = savedKey;

async function suggestRecipe() {
  const apiKey = $('#apiKey').value.trim();
  if (!apiKey) return alert('APIキーを入力してください');
  localStorage.setItem('gemini_api_key', apiKey);

  const foods = await load();
  if (foods.length === 0) return alert('食材がありません');

  const btn = $('#suggestBtn');
  const output = $('#recipeOutput');
  const originalText = btn.textContent;
  
  btn.disabled = true; 
  btn.textContent = '思考中...🍳';
  output.style.display = 'block'; 
  output.innerHTML = '生成中...';

  try {
    const ingredients = foods.map(f => {
      const d = Math.ceil((f.expiry - Date.now())/86400000);
      return `${f.name} ${f.qty}個${d<=2?'(早めに)':''}`;
    }).join(', ');

    const prompt = `以下の食材でレシピを3つ提案して(HTML形式)。CSSやstyleタグは絶対に含めないでください: ${ingredients}`;
    
    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    
    if(!res.ok) {
        if (res.status === 429) throw new Error('混雑しています。1分後に再度お試しください(429)');
        throw new Error(`API Error: ${res.status}`);
    }
    
    const data = await res.json();
    let text = data.candidates[0].content.parts[0].text;

    text = text.replace(/```html|```/g, ''); 
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ''); 
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ''); 
    text = text.replace(/<\/?html>|<\/?body>|<\/?head>/gi, ''); 
    
    output.innerHTML = text;

  } catch (err) {
    output.textContent = 'エラー: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = originalText;
  }
}
$('#suggestBtn').onclick = suggestRecipe;

// --- 音声入力 ---
const voiceBtn = $('#voiceBtn');
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  
  recognition.lang = 'ja-JP';
  recognition.interimResults = false;
  
  recognition.onstart = () => {
    voiceBtn.textContent = '👂'; 
    voiceBtn.classList.add('recording');
  };
  
  recognition.onend = () => {
    voiceBtn.textContent = '🎤';
    voiceBtn.classList.remove('recording');
  };
  
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const cleanText = transcript.replace(/[。、]$/, '');
    
    const match = cleanText.match(/(\d+)/); 
    if (match) {
        $('#qty').value = match[0];
        $('#name').value = cleanText.replace(/\d+/g, '').replace(/個|つ|本|枚|束|パック/g, '').trim();
    } else {
        $('#name').value = cleanText;
    }
  };
  
  voiceBtn.onclick = () => {
    recognition.start();
  };
} else {
  voiceBtn.style.display = 'none';
}

renderAll();
checkAndNotify();