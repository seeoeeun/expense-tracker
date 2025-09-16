// Helper UI funcs
const $ = sel => document.querySelector(sel);
const fmtKRW = n => (n||0).toLocaleString('ko-KR') + '원';
const todayStr = () => {
  const t = new Date(); return ymd(t.getFullYear(), t.getMonth(), t.getDate());
};
const ymd = (y,m,d) => `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const monthKey = (y,m) => `${y}-${String(m+1).padStart(2,'0')}`;
const clampDay = (day, dim) => Math.min(day, dim);

// Firebase init
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
db.enablePersistence().catch(()=>{}); // offline cache best-effort

// Global state
const state = {
  user: null,
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedDate: todayStr(),
  unsubExpenses: null,
  unsubRecurring: null,
  expenses: [],
  recurring: [],
};

$('#date').value = state.selectedDate;

// Auth UI
$('#login').addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  await auth.signInWithPopup(provider);
});
$('#logout').addEventListener('click', async () => { await auth.signOut(); });

firebase.auth().onAuthStateChanged(user => {
  state.user = user;
  $('#userLabel').textContent = user ? (user.displayName || user.email || '로그인 됨') : '';
  $('#login').style.display = user ? 'none' : 'inline-block';
  $('#logout').style.display = user ? 'inline-block' : 'none';
  bindDataListeners();
  render();
});

// Data listeners
function bindDataListeners(){
  // cleanup
  if (state.unsubExpenses) { state.unsubExpenses(); state.unsubExpenses = null; }
  if (state.unsubRecurring) { state.unsubRecurring(); state.unsubRecurring = null; }
  state.expenses = []; state.recurring = [];

  if (!state.user) return;

  // expenses for month
  const mk = monthKey(state.year, state.month);
  state.unsubExpenses = db.collection('users').doc(state.user.uid)
    .collection('expenses')
    .where('monthKey','==', mk)
    .orderBy('amount','desc') // ← 인덱스 없으면 에러 발생. 인덱스 생성했거나, 필요시 이 줄을 지우고 아래 sort만 사용해도 돼요.
    .onSnapshot(snap => {
      state.expenses = snap.docs.map(d=>({ id: d.id, ...d.data() }))
        .sort((a,b)=> b.amount - a.amount); // 안전하게 클라이언트 정렬도 유지
      renderCalendar(); renderList(); renderSums();
    });

  // recurring (all)
  state.unsubRecurring = db.collection('users').doc(state.user.uid)
    .collection('recurring')
    .onSnapshot(snap => {
      state.recurring = snap.docs.map(d=>({ id: d.id, ...d.data() }));
      renderCalendar(); renderList(); renderRecurring();
    });
}

// ✅ Add handlers (즉시 반영+DB 저장)
$('#add').addEventListener('click', async () => {
  if (!state.user) { alert('먼저 로그인해줘'); return; }
  const name = $('#name').value.trim();
  const amount = parseFloat($('#amount').value);
  const category = $('#category').value;
  const date = $('#date').value || todayStr();
  const memo = $('#memo').value.trim();

  if (!name) return alert('지출 이름을 입력해줘');
  if (!isFinite(amount) || amount <= 0) return alert('금액을 숫자로 입력해줘');
  if (!['필수','투자','소비'].includes(category)) return alert('카테고리 오류');

  const mk = date.slice(0,7);

  // 1) 화면에 '즉시' 보이게 임시 항목 추가 (현재 보고 있는 달일 때만)
  if (mk === monthKey(state.year, state.month)) {
    const temp = {
      id: 'temp-' + Math.random().toString(36).slice(2),
      name, amount, category, date, monthKey: mk, memo
    };
    // 위에 orderBy가 있어도 onSnapshot이 오기 전까지는 우리가 직접 정렬
    state.expenses = [temp, ...state.expenses].sort((a,b)=>b.amount-a.amount);
    state.selectedDate = date;
    renderCalendar(); renderList(); renderSums();
  }

  // 2) DB에 실제 저장 (스냅샷이 오면 위 임시 항목은 서버 데이터로 자동 대체됨)
  try {
    await db.collection('users').doc(state.user.uid)
      .collection('expenses').add({ name, amount, category, date, monthKey: mk, memo });
  } catch (e) {
    alert('저장 실패: ' + e.message);
    // 실패했다면 임시 항목을 제거해 UI와 일치시켜도 됨(선택):
    state.expenses = state.expenses.filter(x => !String(x.id).startsWith('temp-'));
    renderCalendar(); renderList(); renderSums();
    return;
  }

  // 3) 입력칸 초기화
  $('#name').value = ''; $('#amount').value = ''; $('#memo').value = '';
});

// 삭제
async function onDelete(id){
  if (!state.user) return;
  await db.collection('users').doc(state.user.uid).collection('expenses').doc(id).delete();
}

$('#rAdd').addEventListener('click', async () => {
  if (!state.user) { alert('먼저 로그인해줘'); return; }
  const name = $('#rName').value.trim();
  const amount = parseFloat($('#rAmount').value);
  const category = $('#rCategory').value;
  const day = parseInt($('#rDay').value,10);
  const start = $('#rStart').value;

  if (!name) return alert('이름 입력');
  if (!isFinite(amount) || amount<=0) return alert('금액 확인');
  if (!(day>=1 && day<=31)) return alert('일자는 1~31');

  const startYear = start ? parseInt(start.split('-')[0],10) : new Date().getFullYear();
  const startMonth = start ? parseInt(start.split('-')[1],10)-1 : new Date().getMonth();

  await db.collection('users').doc(state.user.uid)
    .collection('recurring').add({ name, amount, category, day, startYear, startMonth, active: true });

  $('#rName').value=''; $('#rAmount').value=''; $('#rDay').value=''; $('#rStart').value='';
});

async function onRDelete(id){
  if (!state.user) return;
  await db.collection('users').doc(state.user.uid).collection('recurring').doc(id).delete();
}

// Month navigation
$('#prev').addEventListener('click', ()=>changeMonth(-1));
$('#next').addEventListener('click', ()=>changeMonth(1));
$('#export').addEventListener('click', onExport);
$('#importBtn').addEventListener('click', ()=>$('#importFile').click());
$('#importFile').addEventListener('change', onImport);

function changeMonth(delta){
  let y = state.year, m = state.month + delta;
  if (m<0){ y--; m=11; } else if (m>11){ y++; m=0; }
  state.year = y; state.month = m;
  $('#date').value = ymd(y,m,new Date().getDate());
  bindDataListeners(); // rebind month-scoped query
  render();
}

// Rendering
function render(){
  renderMonthLabel();
  renderCalendar();
  renderList();
  renderRecurring();
  renderSums();
  // PWA SW
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('./sw.js').catch(()=>{}); }
}
function renderMonthLabel(){
  const d = new Date(state.year, state.month, 1);
  $('#monthLabel').textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
}

function renderCalendar(){
  // Head
  const head = $('#calendarHead');
  if (!head.dataset.ready){
    head.innerHTML='';
    ['일','월','화','수','목','금','토'].forEach(w=>{
      const el = document.createElement('div'); el.className='dow'; el.textContent=w; head.appendChild(el);
    });
    head.dataset.ready = '1';
  }

  const cal = $('#calendar');
  cal.innerHTML = '';

  const first = new Date(state.year, state.month, 1);
  const dim = new Date(state.year, state.month+1, 0).getDate();
  const startDow = first.getDay();

  const totals = Array(dim).fill(0);

  // Add expenses
  for (const e of state.expenses){
    const d = parseInt(e.date.slice(8,10),10);
    if (d>=1 && d<=dim) totals[d-1]+= e.amount;
  }
  // Add recurring (virtual)
  for (const r of state.recurring){
    if (!r.active) continue;
    if (r.startYear>state.year || (r.startYear===state.year && r.startMonth>state.month)) continue;
    const d = clampDay(r.day, dim);
    totals[d-1] += r.amount;
  }

  // Leading blanks
  for (let i=0;i<startDow;i++) cal.appendChild(document.createElement('div'));

  for (let d=1; d<=dim; d++){
    const cell = document.createElement('div'); cell.className='day';
    const fullDate = ymd(state.year, state.month, d);
    const h = document.createElement('div'); h.className='d'; h.textContent=d; cell.appendChild(h);
    const total = document.createElement('div'); total.className='total'; total.textContent = totals[d-1] ? fmtKRW(totals[d-1]) : ''; cell.appendChild(total);
    if (fullDate === todayStr()) cell.classList.add('today');
    if (fullDate === state.selectedDate) cell.classList.add('selected');
    cell.addEventListener('click', ()=>{ state.selectedDate = fullDate; $('#date').value = fullDate; renderCalendar(); renderList(); });
    cal.appendChild(cell);
  }
}

function renderList(){
  $('#selectedDateLabel').textContent = state.selectedDate;
  const list = $('#list'); list.innerHTML='';

  const arr = state.expenses.filter(e=> e.date === state.selectedDate).sort((a,b)=>b.amount-a.amount);

  const d = new Date(state.selectedDate);
  const dim = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  const rec = state.recurring.filter(r=> r.active &&
    !(r.startYear>d.getFullYear() || (r.startYear===d.getFullYear() && r.startMonth>d.getMonth())) &&
    clampDay(r.day, dim) === d.getDate()
  ).map(r=>({
    id:'rec-'+r.id, name:r.name, amount:r.amount, category:r.category, memo:'(반복)'
  }));

  const combined = [...rec, ...arr];
  if (combined.length===0){
    const empty = document.createElement('div'); empty.className='empty'; empty.textContent='등록된 내역이 없습니다'; list.appendChild(empty); return;
  }
  for (const e of combined){
    const row = document.createElement('div'); row.className='item';
    const left = document.createElement('div');
    const name = document.createElement('div'); name.className='name'; name.textContent=e.name;
    const meta = document.createElement('div'); meta.className='meta'; meta.textContent = e.category + (e.memo ? ' · ' + e.memo : '');
    left.appendChild(name); left.appendChild(meta);
    const right = document.createElement('div'); right.className='right'; right.innerHTML = '<div>'+fmtKRW(e.amount)+'</div>';
    if (!String(e.id).startsWith('rec-')){
      const del = document.createElement('button'); del.textContent='삭제'; del.addEventListener('click', ()=>onDelete(e.id)); right.appendChild(del);
    } else {
      const tag = document.createElement('div'); tag.className='meta'; tag.textContent='반복'; right.appendChild(tag);
    }
    row.appendChild(left); row.appendChild(right); list.appendChild(row);
  }
}

function renderRecurring(){
  const list = $('#rList'); list.innerHTML='';
  if (state.recurring.length===0){
    const empty = document.createElement('div'); empty.className='empty'; empty.textContent='등록된 반복 지출이 없습니다'; list.appendChild(empty); return;
  }
  for (const r of state.recurring){
    const row = document.createElement('div'); row.className='item';
    const left = document.createElement('div');
    const name = document.createElement('div'); name.className='name'; name.textContent = r.name;
    const meta = document.createElement('div'); meta.className='meta'; meta.textContent = `${r.category} · 매월 ${r.day}일 · 시작 ${r.startYear}-${String(r.startMonth+1).padStart(2,'0')}`;
    left.appendChild(name); left.appendChild(meta);
    const right = document.createElement('div'); right.className='right';
    right.innerHTML = '<div>'+fmtKRW(r.amount)+'</div>';
    const del = document.createElement('button'); del.textContent='삭제'; del.addEventListener('click', ()=>onRDelete(r.id)); right.appendChild(del);
    row.appendChild(left); row.appendChild(right); list.appendChild(row);
  }
}

function renderSums(){
  const mk = monthKey(state.year, state.month);
  const sumCat = { '필수':0, '투자':0, '소비':0 };
  for (const e of state.expenses){ if (e.monthKey===mk) sumCat[e.category]+= e.amount; }
  for (const r of state.recurring){
    if (!r.active) continue;
    if (r.startYear>state.year || (r.startYear===state.year && r.startMonth>state.month)) continue;
    sumCat[r.category]+= r.amount;
  }
  $('#sumEssential').textContent = '필수 ' + fmtKRW(sumCat['필수']);
  $('#sumInvest').textContent   = '투자 ' + fmtKRW(sumCat['투자']);
  $('#sumSpend').textContent    = '소비 ' + fmtKRW(sumCat['소비']);
}

// Import/Export (JSON backup compatible with this structure)
function onExport(){
  const payload = {
    expenses: state.expenses,
    recurring: state.recurring
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download='expenses-backup.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function onImport(evt){
  const file = evt.target.files[0]; if (!file) return;
  const text = await file.text();
  try {
    const obj = JSON.parse(text);
    if (!obj || !Array.isArray(obj.expenses) || !Array.isArray(obj.recurring)) throw new Error('형식 오류');
    if (!state.user) throw new Error('로그인 필요');

    const batch = db.batch();
    const uref = db.collection('users').doc(state.user.uid);
    // import expenses
    for (const e of obj.expenses){
      const ref = uref.collection('expenses').doc();
      batch.set(ref, {
        name: e.name, amount: e.amount, category: e.category,
        date: e.date, monthKey: e.date.slice(0,7), memo: e.memo || ''
      });
    }
    // import recurring
    for (const r of obj.recurring){
      const ref = uref.collection('recurring').doc();
      batch.set(ref, {
        name: r.name, amount: r.amount, category: r.category,
        day: r.day, startYear: r.startYear, startMonth: r.startMonth, active: !!r.active
      });
    }
    await batch.commit();
    alert('가져오기 완료');
  } catch(e){
    alert('가져오기 실패: ' + e.message);
  } finally { evt.target.value=''; }
}
