/* ═══════════════════════════════════════════
   DESIGN TOKENS
   ═══════════════════════════════════════════ */
export const F = {
  h: "'Paperozi',sans-serif",
  b: "'Pretendard',sans-serif",
};

export const X = {
  bg: "#f5f6fa",
  card: "#ffffff",
  bdr: "#e6e9f0",
  tx: "#15181f",
  sub: "#6b7280",
  mt: "#9ca3af",
  ac: "#2563eb",
  abg: "#eef3ff",
  gn: "#10b981",
  gbg: "#ecfdf5",
  am: "#f59e0b",
  abg2: "#fffbeb",
  rd: "#ef4444",
  rbg: "#fef2f2",
  dk: "#0f172a",
};

export const BANDS = {
  입문: { min: 100, max: 400, c: "#10b981", bg: "#ecfdf5", r: "#a7f3d0" },
  기초: { min: 400, max: 500, c: "#3b82f6", bg: "#eff6ff", r: "#bfdbfe" },
  기본: { min: 610, max: 800, c: "#f59e0b", bg: "#fffbeb", r: "#fde68a" },
  심화: { min: 810, max: 1000, c: "#ef4444", bg: "#fef2f2", r: "#fecaca" },
};

/* articleSeq → 난이도 레이블 매핑 */
export const BM = {
  "786": "입문",
  "785": "기초",
  "121": "기본",
  "122": "기본",
};

/* ═══════════════════════════════════════════
   CLASSROOM / STUDENT SEED DATA
   ═══════════════════════════════════════════ */
export const CLS = [
  {
    id: "c1",
    nm: "입문반",
    sts: [
      { id: "s1", nm: "김민준" },
      { id: "s2", nm: "이서윤" },
      { id: "s3", nm: "박도현" },
      { id: "s4", nm: "최하은" },
    ],
  },
  {
    id: "c2",
    nm: "기초반",
    sts: [],
  },
  {
    id: "c3",
    nm: "기본반",
    sts: [
      { id: "s5", nm: "정예준" },
      { id: "s6", nm: "한지우" },
      { id: "s7", nm: "오시우" },
      { id: "s8", nm: "윤채원" },
    ],
  },
  {
    id: "c4",
    nm: "심화반",
    sts: [],
  },
];

export const ALL = CLS.flatMap((c) =>
  c.sts.map((s) => ({ ...s, cId: c.id, cNm: c.nm }))
);

/* 반별 신규 학생 자동 배정 기사 목록 (반 id → articleSeq 배열, 순서 = 발행 순서) */
export const CLASS_DEFAULT_SEQS = {
  c1: ["785", "786", "121"], // 입문반
  c2: ["785", "121"],        // 기초반
  c3: ["121", "122"],        // 기본반
  c4: ["121", "122", "786"], // 심화반
};

/* 초기 배정 데이터 */
export const IA = {
  // 입문반
  s1: [{ seq: "785" }, { seq: "786" }, { seq: "121" }],
  s2: [{ seq: "785" }, { seq: "786" }, { seq: "121" }],
  s3: [{ seq: "785" }, { seq: "786" }, { seq: "121" }],
  s4: [{ seq: "785" }, { seq: "786" }, { seq: "121" }],
  // 기본반
  s5: [{ seq: "121" }, { seq: "122" }],
  s6: [{ seq: "121" }, { seq: "122" }],
  s7: [{ seq: "121" }, { seq: "122" }],
  s8: [{ seq: "121" }, { seq: "122" }],
};

/* 초기 진행 데이터 — 모두 미시작 */
export const IP = {};

/* 타임라인 로그 */
export const TL = [
  { t: "10분 전", m: "김민준 — Firefighting Robot 전체 완료", ic: "✅" },
  { t: "1시간 전", m: "이서윤 — Firefighting Robot 단어 퀴즈 완료", ic: "📝" },
  { t: "2시간 전", m: "한지우 — The King's Warden 전체 완료", ic: "🎉" },
  { t: "어제", m: "입문반에 Caring for Our Earth 배정", ic: "📋" },
  { t: "2일 전", m: "기본반에 April Fools' Day Pranks 배정", ic: "📋" },
];

/* CSS (글로벌 인젝션용) */
export const GLOBAL_CSS = `
@font-face { font-family:'Pretendard'; src:url('https://cdn.jsdelivr.net/gh/projectnoonnu/pretendard@1.0/Pretendard-ExtraLight.woff2') format('woff2'); font-weight:200; font-display:swap; }
@font-face { font-family:'Pretendard'; src:url('https://cdn.jsdelivr.net/gh/projectnoonnu/pretendard@1.0/Pretendard-Light.woff2') format('woff2'); font-weight:300; font-display:swap; }
@font-face { font-family:'Pretendard'; src:url('https://cdn.jsdelivr.net/gh/projectnoonnu/pretendard@1.0/Pretendard-Regular.woff2') format('woff2'); font-weight:400; font-display:swap; }
@font-face { font-family:'Paperozi'; src:url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-7Bold.woff2') format('woff2'); font-weight:700; font-display:swap; }
@font-face { font-family:'Paperozi'; src:url('https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-8ExtraBold.woff2') format('woff2'); font-weight:800; font-display:swap; }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:'Pretendard',sans-serif; }
::-webkit-scrollbar { width:6px; }
::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:3px; }
@keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
.fade-up { animation:fadeUp .3s ease both; }
.card-hover { transition:box-shadow .2s, transform .2s; }
.card-hover:hover { box-shadow:0 4px 20px rgba(0,0,0,.07); transform:translateY(-1px); }
@keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(12px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
.toast-anim { animation:toastIn .25s ease both; }
@keyframes ntcRecDotBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
.ntc-rec-dot { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; animation: ntcRecDotBlink 1s ease-in-out infinite; flex-shrink: 0; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.25); }
@keyframes ntcPlayPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.ntc-play-pulse { animation: ntcPlayPulse 1.1s ease-in-out infinite; }
`;
