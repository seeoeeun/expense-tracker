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
  activeTab: 'record', // ← 추가
  selectedCategory: '필수',
  filterCategory: null, // ⬅️ null=전체, '필수'|'투자'|'소비' 중 하나
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
    
      // 기존 렌더링
      renderCalendar();
      renderList();
      renderSums();
    
      // 🔻 추가: 기록 탭이면 오늘 목록도 갱신
      if (state.activeTab === 'record') {
        renderTodayList();
      }
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
  const category = state.selectedCategory || '필수';
  const date = todayStr();
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

// 🔻 여기에 이어서 캘린더 탭 전용 Add 핸들러 추가
$('#addCal').addEventListener('click', async () => {
  if (!state.user) { alert('먼저 로그인해줘'); return; }

  const name = $('#cName').value.trim();
  const amount = parseFloat($('#cAmount').value);
  const category = state.selectedCategory || '필수';
  const date = $('#cDate').value || state.selectedDate || todayStr();
  const memo = ($('#cMemo')?.value || '').trim();

  if (!name) return alert('지출 이름을 입력해줘');
  if (!isFinite(amount) || amount <= 0) return alert('금액을 숫자로 입력해줘');
  if (!['필수','투자','소비'].includes(category)) return alert('카테고리 오류');

  const mk = date.slice(0,7);

  // 1) 현재 보고 있는 달이면 UI에 즉시 추가
  if (mk === monthKey(state.year, state.month)) {
    const temp = { id: 'temp-' + Math.random().toString(36).slice(2),
      name, amount, category, date, monthKey: mk, memo };
    state.expenses = [temp, ...state.expenses].sort((a,b)=>b.amount-a.amount);
    state.selectedDate = date;
    renderCalendar(); renderList(); renderSums();
  }

  // 2) Firestore 저장
  try {
    await db.collection('users').doc(state.user.uid)
      .collection('expenses')
      .add({ name, amount, category, date, monthKey: mk, memo });
  } catch (e) {
    alert('저장 실패: ' + e.message);
    state.expenses = state.expenses.filter(x => !String(x.id).startsWith('temp-'));
    renderCalendar(); renderList(); renderSums();
    return;
  }

  // 3) 입력칸 초기화
  $('#cName').value = '';
  $('#cAmount').value = '';
  if ($('#cMemo')) $('#cMemo').value = '';
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
  // const category = $('#rCategory').value;
  const category = state.selectedCategory || '필수'; // ← 동그라미 선택값 사용
  const day = parseInt($('#rDay').value,10);
  const start = $('#rStart').value;

  if (!name) return alert('이름 입력');
  if (!isFinite(amount) || amount<=0) return alert('금액 확인');
  if (!(day>=1 && day<=31)) return alert('일자는 1~31');

  const startYear = start ? parseInt(start.split('-')[0],10) : new Date().getFullYear();
  const startMonth = start ? parseInt(start.split('-')[1],10)-1 : new Date().getMonth();
  const startYM = start || `${startYear}-${String(startMonth+1).padStart(2,'0')}`;

  await db.collection('users').doc(state.user.uid)
    .collection('recurring').add({ name, amount, category, day, startYear, startMonth, start: startYM, active: true });

  $('#rName').value=''; $('#rAmount').value=''; $('#rDay').value=''; $('#rStart').value='';
});

async function onRDelete(id){
  if (!state.user) return;
  await db.collection('users').doc(state.user.uid).collection('recurring').doc(id).delete();
}

// Month navigation
$('#prev').addEventListener('click', ()=>changeMonth(-1));
$('#next').addEventListener('click', ()=>changeMonth(1));

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
  renderCalendarHead();   // ⬅️ 요일 헤더 호출 추가
  renderCalendar();
  renderList();
  renderRecurring();
  renderSums();
  // PWA SW
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('./sw.js').catch(()=>{}); }
}

// 카테고리 선택 함수
function selectCategory(val){
  state.selectedCategory = val;
  document.querySelectorAll('.category-picker .circle').forEach(b => {
    const on = b.dataset.value === val;
    b.classList.toggle('is-selected', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

// 동그라미 버튼 클릭 시 상태 반영
document.querySelectorAll('.category-picker .circle').forEach(btn => {
  btn.addEventListener('click', () => selectCategory(btn.dataset.value));
});

// 초기 기본값 반영(필수)
selectCategory(state.selectedCategory);


function setActiveTab(tab) {
  state.activeTab = tab;


  // 섹션 표시/숨김
  $('#tab-record').style.display   = tab === 'record'   ? '' : 'none';
  $('#tab-calendar').style.display = tab === 'calendar' ? '' : 'none';
  $('#tab-recurring').style.display= tab === 'recurring'? '' : 'none';
  $('#tab-settings').style.display = (tab === 'settings')  ? '' : 'none'; // ← 추가

  // 탭바 활성 표시
  document.querySelectorAll('.tablink').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
    btn.setAttribute('aria-current', btn.dataset.tab === tab ? 'page' : 'false');
  });

  // 탭 별로 필요한 렌더 보조
  if (tab === 'record') {
    renderTodayList();
  } else if (tab === 'calendar') {
    renderMonthLabel(); renderCalendar(); renderList(); renderSums();
  } else if (tab === 'recurring') {
    renderRecurring();
  } else if (tab === 'settings') {
    // 설정 탭은 별도 렌더 없음 (필요하면 버전/로그아웃 안내 등 넣기)
  }

  const entry = document.getElementById('entryBar');
  if (entry) entry.style.display = (tab === 'record') ? '' : 'none';

  // ⬇️ 추가: 입력 날짜 제어
  const dateInput = $('#date');
  if (tab === 'record') {
    if (dateInput) {
      dateInput.value = todayStr();
      dateInput.setAttribute('disabled', 'disabled');  // Today에서는 오늘만
      dateInput.title = '투데이 탭에서는 오늘만 입력할 수 있어요';
    }
  } else {
    if (dateInput) {
      dateInput.removeAttribute('disabled');
    }
    const cDate = $('#cDate');
    if (cDate) cDate.value = state.selectedDate; // 캘린더 폼에 선택 날짜 반영
  }

  // 🔻 여기에 body class 토글 추가
  document.body.classList.remove('tab-record','tab-calendar','tab-recurring','tab-settings');
  document.body.classList.add(`tab-${tab}`);

  if (tab === 'record') {
    renderTodayList();
  } else if (tab === 'calendar') {
    renderMonthLabel(); renderCalendar(); renderList(); renderSums();
    const cDate = $('#cDate');
    if (cDate) cDate.value = state.selectedDate;
  } else if (tab === 'recurring') {
    renderRecurring();
  }
}

// 탭 버튼 이벤트 바인딩 (한 번만)
document.querySelectorAll('.tablink').forEach(btn => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

// 앱 시작 시 기본 탭
setActiveTab(state.activeTab);


// 카테고리 필터 토글: pill 클릭 → 해당 카테고리만 달력에 표시
['sumEssential','sumInvest','sumSpend'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => {
    const map = { sumEssential: '필수', sumInvest: '투자', sumSpend: '소비' };
    const cat = map[id];
    // 같은 걸 다시 누르면 전체보기로 해제
    state.filterCategory = (state.filterCategory === cat) ? null : cat;
    // 활성 pill 표시 업데이트
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    if (state.filterCategory) el.classList.add('active');
    // 달력/리스트/합계 다시 그리기
    renderMonthLabel(); renderCalendarHead(); renderCalendar(); renderList(); renderSums();
  });
});



// 2-1) 영어 월 이름 상수
const EN_MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

// 2-2) 월 라벨 렌더
function renderMonthLabel(){
const label = document.getElementById('monthLabel');
if (!label) return;
label.textContent = `${EN_MONTHS[state.month]} ${state.year}`;

// (선택) 버튼 기호 보장
const prev = document.getElementById('prev');
const next = document.getElementById('next');
if (prev) prev.textContent = '◀';
if (next) next.textContent = '▶';
}

function renderCalendarHead(){
  const head = $('#calendarHead');
  if (!head) return;
  head.innerHTML = '';
  const days = ['S','M','T','W','T','F','S']; // ← 한글 요일 대신 영문 1글자
  for (const d of days) {
    const el = document.createElement('div');
    el.className = 'cell head';
    el.textContent = d;
    head.appendChild(el);
  }
}



// 'YYYY-MM' -> {y,m}
function parseYM(ym){ const [y,m] = ym.split('-').map(n=>parseInt(n,10)); return {y, m}; }

// 해당 월의 말일
function lastDateOf(year, month){ return new Date(year, month+1, 0).getDate(); }


function recurringSumForDate(dateStr, filterCat = null){
  if (!state.recurring || state.recurring.length === 0) return 0;
  const [y, m, d] = dateStr.split('-').map(n=>parseInt(n,10));
  const last = lastDateOf(y, m-1);

  let sum = 0;
  for (const r of state.recurring){
    const amt = Number(r.amount)||0;
    if (!amt) continue;

    const startYM = getRecurringStartYM(r);
    if (!startYM) continue;
    const {y: sy, m: sm} = parseYM(startYM);
    const afterStart = (y > sy) || (y === sy && m >= sm);
    if (!afterStart) continue;

    const day = Math.min(Number(r.day)||1, last);
    if (d !== day) continue;

    // 카테고리 필터 적용
    const rcat = r.category || '소비';
    if (filterCat && rcat !== filterCat) continue;

    sum += amt;
  }
  return sum;
}


// 반복 항목 시작월을 'YYYY-MM'로 통일해서 반환
function getRecurringStartYM(r){
  if (r.start) return r.start; // 이미 문자열이면 그대로
  if (Number.isInteger(r.startYear) && Number.isInteger(r.startMonth)) {
    const y = r.startYear;
    const m = r.startMonth + 1; // 저장은 0-based였음
    return `${y}-${String(m).padStart(2,'0')}`;
  }
  return null;
}



function renderCalendar(){
  const grid = $('#calendar');
  if (!grid) return;

  grid.innerHTML = '';

  const year = state.year;
  const month = state.month; // 0~11
  const first = new Date(year, month, 1);
  const startDay = first.getDay();               // 0(Sun)~6(Sat)
  const lastDate = new Date(year, month+1, 0).getDate();

  // 앞쪽 빈칸
  for (let i=0; i<startDay; i++){
    const empty = document.createElement('div');
    empty.className = 'cell empty';
    grid.appendChild(empty);
  }

  // 날짜 칸
  for (let day=1; day<=lastDate; day++){
    const dstr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

    // 해당 날짜 합계 계산
    const sumExpense = state.expenses
    .filter(e => e.date === dstr)
    .filter(e => !state.filterCategory || e.category === state.filterCategory)
    .reduce((a,b)=> a + (Number(b.amount)||0), 0);
  
    // recurring도 필터 반영하도록 함수에 카테고리 전달
    const sumRecurring = recurringSumForDate(dstr, state.filterCategory);
  
    const sum = sumExpense + sumRecurring;

    // 셀 구성
    const cell = document.createElement('div');
    cell.className = 'cell day' + (state.selectedDate === dstr ? ' selected' : '');
    cell.dataset.date = dstr;

    const dayEl = document.createElement('div');
    dayEl.className = 'cday';
    dayEl.textContent = String(day);             // 큰 날짜 숫자

    // 선택된 날짜면 클래스만 추가
    dayEl.classList.toggle('is-selected', state.selectedDate === dstr);

    const amtEl = document.createElement('div');
    amtEl.className = 'camt';
    // 교체: 캘린더에서는 '원' 제거
    amtEl.textContent = sum ? fmtKRW(sum).replace(/원$/, '') : '\u00A0'; // nbsp

    cell.appendChild(dayEl);
    cell.appendChild(amtEl);

    // 클릭 시 선택 날짜 변경
    cell.addEventListener('click', ()=>{
      state.selectedDate = dstr;
      const cDateEl = $('#cDate');        // ⬅️ 추가
      if (cDateEl) cDateEl.value = dstr;  // ⬅️ 추가
      renderCalendar();
      renderList();
    });

    grid.appendChild(cell);
  }
}

// 반복 지출 삭제 (Firestore)
async function deleteRecurring(id){
  if (!state.user || !id) return;
  try {
    await db.collection('users').doc(state.user.uid)
      .collection('recurring').doc(id).delete();
  } catch (e) {
    console.error('deleteRecurring failed:', e);
    alert('반복 지출 삭제 중 오류가 발생했어요.');
  }
}


function renderList(){
  const box = $('#list');
  if (!box) return;

  const sel = state.selectedDate; // 'YYYY-MM-DD'
  const lab = $('#selectedDateLabel');   // ⬅️ 추가
  if (lab) lab.textContent = sel;        // ⬅️ 추가

  // 일반 지출
  const listBase = state.expenses.filter(e => e.date === sel);

  // 반복 지출 → 당일에 해당하는 것만 가짜 아이템으로 생성
  const recSumToday = [];
  const [y,m,d] = sel.split('-').map(n=>parseInt(n,10));
  const last = lastDateOf(y, m-1);
  for (const r of state.recurring || []){
    const startYM = getRecurringStartYM(r);
    if (!startYM) { /* 시작월 미정이면 스킵 */ continue; }
    const {y: sy, m: sm} = parseYM(startYM);    
    const afterStart = (y > sy) || (y === sy && m >= sm);
    const day = Math.min(Number(r.day)||1, last);
    if (afterStart && d === day){
      recSumToday.push({
        id: `rec-${r.id}-${sel}`,
        name: r.name || '(반복 지출)',
        amount: Number(r.amount)||0,
        category: r.category || '소비',
        _recurring: true
      });
    }
  }

  const list = [...listBase, ...recSumToday].sort((a,b)=> (b.amount||0)-(a.amount||0));

  box.innerHTML = '';
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nothing here :o';
    box.appendChild(empty);
    return;
  }

  for (const e of list) {
    const row = document.createElement('div'); row.className = 'trow';
    const dot = document.createElement('span'); dot.className = 'dot ' + catToClass(e.category);
    const name = document.createElement('div'); name.className = 'tname'; name.textContent = e.name;
    const amt = document.createElement('div'); amt.className = 'tamt'; amt.textContent = fmtKRW(e.amount);

    // 반복에서 유도된 항목은 삭제 버튼 숨김
    row.appendChild(dot); row.appendChild(name); row.appendChild(amt);
    if (!e._recurring) {
      const delBtn = document.createElement('button'); delBtn.className='tdelete'; delBtn.textContent='Delete';
      delBtn.addEventListener('click', ()=>onDelete(e.id));
      row.appendChild(delBtn);
    }
    box.appendChild(row);
  }
}


function renderRecurring(){
  const box = $('#rList');
  if (!box) return;

  const list = [...(state.recurring || [])]
    .sort((a,b) => (b.amount||0) - (a.amount||0));

  box.innerHTML = '';

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nothing here :o';
    box.appendChild(empty);
    return;
  }

  for (const r of list) {
    const row = document.createElement('div');
    row.className = 'trow';

    const dot = document.createElement('span');
    dot.className = 'dot ' + catToClass(r.category || '소비');

    const name = document.createElement('div');
    name.className = 'tname';
    // 예: "넷플릭스 · 매월 15일 시작 2025-03"
    const day = r.day ? ` · 매월 ${r.day}일` : '';
    const startYM = getRecurringStartYM(r);
    const start = r.start ? ` 시작 ${r.start}` : '';
    name.textContent = `${r.name || ''}${day}${start}`.trim();

    const amt = document.createElement('div');
    amt.className = 'tamt';
    amt.textContent = fmtKRW(r.amount || 0);

    const delBtn = document.createElement('button');
    delBtn.className = 'tdelete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      deleteRecurring(r.id);
    });
    

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(amt);
    row.appendChild(delBtn);

    box.appendChild(row);
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

function catToClass(cat){
  if (cat === '필수') return 'essential';
  if (cat === '투자') return 'invest';
  return 'spend'; // 소비
}


function renderTodayList(){
  const today = todayStr();
  const box = $('#todayList');
  if (!box) return;

  const list = state.expenses.filter(e => e.date === today)
               .sort((a,b) => b.amount - a.amount);
  box.innerHTML = '';
  if (list.length === 0) {
    document.body.classList.remove('has-today');
    const empty = document.createElement('div');
    empty.className = 'welcome';
    empty.innerHTML = `
      <strong class="welcome-hello">Hello, Mia!</strong>
      <span class="welcome-sub">How Are You Doing Today? :^)</span>
    `;    
    box.appendChild(empty);
    return;
  }
  document.body.classList.add('has-today');

  for (const e of list) {
    const row = document.createElement('div'); 
    row.className = 'trow';

    // ● 카테고리 동그라미
    const dot = document.createElement('span');
    dot.className = 'dot ' + catToClass(e.category);

    // 이름
    const name = document.createElement('div');
    name.className = 'tname';
    name.textContent = e.name;

    // 금액
    const amt = document.createElement('div');
    amt.className = 'tamt';
    amt.textContent = fmtKRW(e.amount);

    // 삭제 버튼
    const delBtn = document.createElement('button');
    delBtn.className = 'tdelete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', ()=>onDelete(e.id));

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(amt);
    row.appendChild(delBtn);

    box.appendChild(row);
  }
}

// 반복 탭 카테고리 선택 로직
let selectedRCategory = '필수'; // 기본값

// 초기 상태(선택): 첫 버튼에 active 주기
const first = document.querySelector('#rCategoryGroup .cat-btn[data-value="필수"]');
if (first && !first.classList.contains('active')) first.classList.add('active');

// 클릭 토글
document.querySelectorAll('#rCategoryGroup .cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#rCategoryGroup .cat-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedRCategory = btn.dataset.value;
  });
});


// rAdd 버튼 로직에서 category 읽을 때 교체
$('#rAdd').addEventListener('click', async () => {
  const name = $('#rName').value.trim();
  const amount = parseInt($('#rAmount').value,10) || 0;
  const day = parseInt($('#rDay').value,10) || 1;
  const start = $('#rStart').value; // 'YYYY-MM'

  if (!name || !amount) return alert('이름/금액을 입력하세요');

  const startYear = start ? parseInt(start.split('-')[0],10) : new Date().getFullYear();
  const startMonth = start ? parseInt(start.split('-')[1],10)-1 : new Date().getMonth();
  const startYM = start || `${startYear}-${String(startMonth+1).padStart(2,'0')}`;

  await db.collection('users').doc(state.user.uid)
    .collection('recurring')
    .add({
      name, amount,
      category: selectedRCategory, // 여기서 버튼으로 고른 값 사용
      day, startYear, startMonth, start: startYM,
      active: true
    });

  $('#rName').value = '';
  $('#rAmount').value = '';
  $('#rDay').value = '';
  $('#rStart').value = '';
  // 선택값 초기화 필요하면 여기도 reset
});

