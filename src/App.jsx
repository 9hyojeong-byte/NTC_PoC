import React, { useState, useMemo, useEffect, useRef } from "react";

/* ── lib imports ── */
import { GLOBAL_CSS, BANDS, BM, CLS, ALL, IA, IP, TL, F, X, CLASS_DEFAULT_SEQS, LEVEL_FREQ_SEQS } from "./lib/constants.js";
import { ARTS, W, WB } from "./lib/selectors.js";
import { playWordAudio } from "./lib/audio.js";

/* ═══════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════ */
const gP = (p, s, q) => {
  const x = p[`${s}_${q}`];
  if (!x) return { r: false, wl: false, v: false, sb: false, w: false };
  return { r: !!x.r, wl: !!x.wl, v: !!x.v, sb: !!x.sb, w: !!x.w };
};
const iD = (p, s, q) => {
  const x = gP(p, s, q);
  return x.r && x.wl && x.v && x.sb && x.w;
};

function recStorageKey(stId, artSeq) {
  return `ntc_rec_v1_${stId}_${artSeq}`;
}
function loadRecMap(stId, artSeq) {
  try {
    const raw = localStorage.getItem(recStorageKey(stId, artSeq));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveRecMap(stId, artSeq, map) {
  localStorage.setItem(recStorageKey(stId, artSeq), JSON.stringify(map));
}
function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const m of cands) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}
const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5];

function hl(text, words) {
  if (!words.length) return [{ t: "t", c: text }];
  const sorted = [...words].sort((a, b) => b.en.length - a.en.length);
  const low = text.toLowerCase(); const segs = []; let i = 0;
  while (i < text.length) {
    let m = null;
    for (const w of sorted) {
      const wl = w.en.toLowerCase();
      if (low.substring(i).startsWith(wl)) {
        const nc = text[i + wl.length]; const pc = i > 0 ? text[i - 1] : " ";
        if ((/[^a-zA-Z'-]/.test(pc) || i === 0) && (!nc || /[^a-zA-Z'-]/.test(nc))) { m = w; break; }
      }
    }
    if (m) { segs.push({ t: "w", c: text.substring(i, i + m.en.length), w: m }); i += m.en.length; }
    else {
      let nx = text.length;
      for (const w of sorted) { const idx = low.indexOf(w.en.toLowerCase(), i + 1); if (idx !== -1 && idx < nx) nx = idx; }
      segs.push({ t: "t", c: text.substring(i, nx) }); i = nx;
    }
  }
  return segs;
}

function splitSentenceRanges(text) {
  if (!text) return [];
  const ranges = [];
  const rx = /[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const raw = m[0];
    const leading = raw.match(/^\s*/)?.[0]?.length || 0;
    const trailing = raw.match(/\s*$/)?.[0]?.length || 0;
    const start = m.index + leading;
    const end = m.index + raw.length - trailing;
    if (end > start) ranges.push({ start, end, text: text.slice(start, end) });
  }
  return ranges;
}

function detectSpeechSegments(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.02));
  const silenceThreshold = 0.012;
  const minSpeechMs = 180;
  const minPauseMs = 220;
  const maxJoinMs = 140;
  const segments = [];
  const pauses = [];
  let i = 0;
  let inSilenceFrom = null;

  while (i < data.length) {
    let rms = 0;
    const end = Math.min(i + windowSize, data.length);
    for (let j = i; j < end; j++) rms += data[j] * data[j];
    rms = Math.sqrt(rms / Math.max(1, end - i));

    if (rms >= silenceThreshold) {
      if (inSilenceFrom !== null) {
        const silenceMs = ((i - inSilenceFrom) / sampleRate) * 1000;
        if (silenceMs >= minPauseMs) pauses.push({ start: inSilenceFrom / sampleRate, end: i / sampleRate });
        inSilenceFrom = null;
      }
      const start = i;
      let lastSound = i;
      i = end;
      while (i < data.length) {
        let chunkRms = 0;
        const chunkEnd = Math.min(i + windowSize, data.length);
        for (let j = i; j < chunkEnd; j++) chunkRms += data[j] * data[j];
        chunkRms = Math.sqrt(chunkRms / Math.max(1, chunkEnd - i));
        if (chunkRms >= silenceThreshold) lastSound = chunkEnd;
        const silenceMs = ((chunkEnd - lastSound) / sampleRate) * 1000;
        if (silenceMs >= minPauseMs) break;
        i = chunkEnd;
      }
      const segStart = start / sampleRate;
      const segEnd = lastSound / sampleRate;
      if ((segEnd - segStart) * 1000 >= minSpeechMs) segments.push({ start: segStart, end: segEnd });
    } else {
      if (inSilenceFrom === null) inSilenceFrom = i;
      i = end;
    }
  }
  if (inSilenceFrom !== null) {
    const silenceMs = ((data.length - inSilenceFrom) / sampleRate) * 1000;
    if (silenceMs >= minPauseMs) pauses.push({ start: inSilenceFrom / sampleRate, end: data.length / sampleRate });
  }

  if (!segments.length) {
    return {
      segments: [{ start: 0, end: audioBuffer.duration }],
      pauses,
      speechStart: 0,
      speechEnd: audioBuffer.duration,
    };
  }

  const merged = [segments[0]];
  for (let k = 1; k < segments.length; k++) {
    const prev = merged[merged.length - 1];
    const cur = segments[k];
    if ((cur.start - prev.end) * 1000 <= maxJoinMs) prev.end = cur.end;
    else merged.push(cur);
  }
  return {
    segments: merged,
    pauses,
    speechStart: merged[0].start,
    speechEnd: merged[merged.length - 1].end,
  };
}

function selectPauseBoundaries(sentences, pauseCenters, speechStart, speechEnd) {
  const n = sentences.length;
  if (n <= 1) return [];
  const expected = [];
  const totalChars = Math.max(1, sentences.reduce((sum, s) => sum + Math.max(1, s.text.length), 0));
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    acc += Math.max(1, sentences[i].text.length);
    expected.push(speechStart + (acc / totalChars) * (speechEnd - speechStart));
  }
  if (pauseCenters.length < n - 1) return expected;

  const m = pauseCenters.length;
  const dp = Array.from({ length: n - 1 }, () => Array(m).fill(Infinity));
  const prevIdx = Array.from({ length: n - 1 }, () => Array(m).fill(-1));

  for (let j = 0; j < m; j++) dp[0][j] = Math.abs(pauseCenters[j] - expected[0]);
  for (let i = 1; i < n - 1; i++) {
    for (let j = 0; j < m; j++) {
      const local = Math.abs(pauseCenters[j] - expected[i]);
      for (let pj = 0; pj < j; pj++) {
        const cost = dp[i - 1][pj] + local;
        if (cost < dp[i][j]) {
          dp[i][j] = cost;
          prevIdx[i][j] = pj;
        }
      }
    }
  }

  let bestLast = 0;
  for (let j = 1; j < m; j++) if (dp[n - 2][j] < dp[n - 2][bestLast]) bestLast = j;
  const out = Array(n - 1).fill(0);
  let cur = bestLast;
  for (let i = n - 2; i >= 0; i--) {
    out[i] = pauseCenters[cur];
    cur = prevIdx[i][cur];
    if (cur < 0 && i > 0) {
      for (let k = i - 1; k >= 0; k--) out[k] = expected[k];
      break;
    }
  }
  return out;
}

function mapSentenceSegments(sentences, analysis, duration) {
  if (!sentences.length) return {};
  const map = {};
  const speechStart = analysis?.speechStart ?? 0;
  const speechEnd = analysis?.speechEnd ?? duration;
  const pauseCenters = (analysis?.pauses || [])
    .filter((p) => p.start > speechStart && p.end < speechEnd)
    .map((p) => (p.start + p.end) / 2);
  const boundaries = selectPauseBoundaries(sentences, pauseCenters, speechStart, speechEnd);
  sentences.forEach((s, idx) => {
    const start = idx === 0 ? speechStart : boundaries[idx - 1];
    const end = idx === sentences.length - 1 ? speechEnd : boundaries[idx];
    map[s.key] = { start, end: Math.max(start + 0.05, end) };
  });
  return map;
}

/* ═══════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════ */
const Bd = ({ b }) => {
  const d = BANDS[b]; if (!d) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, color: d.c, background: d.bg, border: `1px solid ${d.r}` }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: d.c }} />{b}
    </span>
  );
};
const Tp = ({ t }) => (
  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 500, color: "#6366f1", background: "#eef2ff" }}>{t}</span>
);
const Dt = ({ on }) => (
  <span style={{ width: 10, height: 10, borderRadius: "50%", background: on ? X.gn : X.bdr, display: "inline-block", border: on ? `2px solid #a7f3d0` : `2px solid #e2e8f0` }} />
);

const Bt = ({ v = "primary", size, children, disabled, style: sx, ...p }) => {
  const vs = { primary: { bg: X.dk, co: "#fff" }, success: { bg: X.gn, co: "#fff" }, outline: { bg: "#fff", co: X.tx, bd: `1px solid ${X.bdr}` }, ghost: { bg: "transparent", co: X.sub } };
  const s = vs[v] || vs.primary;
  const lgStyle = size === "lg" ? { padding: "14px 40px", fontSize: 16, borderRadius: 12 } : {};
  return (
    <button disabled={disabled} style={{ padding: "8px 20px", borderRadius: 9, border: s.bd || "none", cursor: disabled ? "default" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: F.b, background: s.bg, color: s.co, opacity: disabled ? .45 : 1, transition: "background-color .15s, border-color .15s, color .15s, opacity .15s", ...lgStyle, ...sx }} {...p}>
      {children}
    </button>
  );
};
const Cd = ({ children, style: sx, ...p }) => (
  <div className="card-hover" style={{ background: X.card, borderRadius: 14, padding: 20, border: `1px solid ${X.bdr}`, ...sx }} {...p}>{children}</div>
);
const Hd = ({ children, sub }) => (
  <div style={{ marginBottom: 16 }}>
    <h3 style={{ fontFamily: F.h, fontWeight: 700, fontSize: 17, color: X.tx }}>{children}</h3>
    {sub && <p style={{ fontSize: 12, color: X.sub, marginTop: 2 }}>{sub}</p>}
  </div>
);

function StudentRecordingStep({ sSt, sArt, sentenceRows, onSubmit, onBack }) {
  const rows = sentenceRows || [];
  const [recMap, setRecMap] = useState({});
  const [recErr, setRecErr] = useState(null);
  const [activeRecKey, setActiveRecKey] = useState(null);
  const [playingRecKey, setPlayingRecKey] = useState(null);
  const [recIdx, setRecIdx] = useState(0);
  const streamRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const playingAudioRef = useRef(null);
  const discardOnStopRef = useRef(false);

  const cleanupMedia = () => {
    discardOnStopRef.current = true;
    if (playingAudioRef.current) {
      playingAudioRef.current.pause();
      playingAudioRef.current = null;
    }
    setPlayingRecKey(null);
    if (mrRef.current && mrRef.current.state !== "inactive") {
      try { mrRef.current.stop(); } catch { /* ignore */ }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mrRef.current = null;
    chunksRef.current = [];
    discardOnStopRef.current = false;
  };

  useEffect(() => {
    if (!sArt) return;
    setRecMap(loadRecMap(sSt, sArt));
    setRecErr(null);
    setRecIdx(0);
  }, [sSt, sArt]);

  useEffect(() => () => { cleanupMedia(); }, []);

  const startRec = async (key) => {
    if (activeRecKey && activeRecKey !== key) return;
    if (mrRef.current && mrRef.current.state === "recording") return;
    if (playingAudioRef.current) {
      playingAudioRef.current.pause();
      playingAudioRef.current = null;
      setPlayingRecKey(null);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setRecErr(null);
    discardOnStopRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickRecorderMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mrRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const streamNow = streamRef.current;
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        chunksRef.current = [];
        mrRef.current = null;
        if (streamNow) streamNow.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const shouldDiscard = discardOnStopRef.current;
        discardOnStopRef.current = false;
        setActiveRecKey(null);
        if (shouldDiscard || blob.size === 0) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result;
          if (typeof dataUrl !== "string") return;
          const next = { ...loadRecMap(sSt, sArt), [key]: dataUrl };
          saveRecMap(sSt, sArt, next);
          setRecMap(next);
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      setActiveRecKey(key);
    } catch {
      setRecErr("마이크를 사용할 수 없습니다. 브라우저 권한을 확인해 주세요.");
      setActiveRecKey(null);
      cleanupMedia();
    }
  };

  const cancelRecording = () => {
    discardOnStopRef.current = true;
    if (mrRef.current && mrRef.current.state === "recording") {
      try { mrRef.current.stop(); } catch { /* ignore */ }
    }
  };

  const completeRecording = () => {
    discardOnStopRef.current = false;
    if (mrRef.current && mrRef.current.state === "recording") {
      try { mrRef.current.stop(); } catch { /* ignore */ }
    }
  };

  const playRec = (key) => {
    const url = recMap[key];
    if (!url) return;
    if (playingAudioRef.current) {
      playingAudioRef.current.pause();
      playingAudioRef.current = null;
    }
    const a = new Audio(url);
    playingAudioRef.current = a;
    setPlayingRecKey(key);
    const finish = () => {
      if (playingAudioRef.current === a) {
        playingAudioRef.current = null;
        setPlayingRecKey((cur) => (cur === key ? null : cur));
      }
    };
    a.onended = finish;
    a.onerror = finish;
    a.play().catch(() => { finish(); });
  };

  const goTo = (i) => {
    if (activeRecKey) return;
    if (playingAudioRef.current) {
      playingAudioRef.current.pause();
      playingAudioRef.current = null;
      setPlayingRecKey(null);
    }
    setRecIdx(i);
    setRecErr(null);
  };

  const nRec = rows.filter((r) => recMap[r.key]).length;
  const allDone = rows.length === 0 || nRec === rows.length;
  const row = rows[recIdx] || null;
  const isRec = row ? activeRecKey === row.key : false;
  const isPlaying = row ? playingRecKey === row.key : false;
  const has = row ? !!recMap[row.key] : false;
  const isLast = recIdx === rows.length - 1;

  return (
    <div>
      <Bt v="ghost" onClick={onBack} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
      <Cd style={{ maxWidth: 640, margin: "0 auto" }}>
        <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 20, marginBottom: 12 }}>녹음하기</h2>

        {/* 프로그래스바 */}
        <div style={{ display: "flex", gap: 5, marginBottom: 20 }}>
          {rows.map((r, i) => {
            const done = !!recMap[r.key];
            const cur = i === recIdx;
            return (
              <div
                key={r.key}
                onClick={() => goTo(i)}
                style={{
                  position: "relative",
                  flex: 1,
                  height: 8,
                  borderRadius: 4,
                  cursor: activeRecKey ? "default" : "pointer",
                  background: done ? "#a7f3d0" : cur ? X.ac : "#f1f5f9",
                  border: cur ? `2px solid ${X.ac}` : "2px solid transparent",
                  transition: "background .2s",
                }}
              >
                {!done && !cur && (
                  <span style={{
                    position: "absolute",
                    top: -3,
                    right: -2,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: X.rd,
                    border: "1px solid #fff",
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* 문장 카드 */}
        {row && (
          <div className="fade-up" key={recIdx} style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: X.sub }}>
                문장 {recIdx + 1} / {rows.length}
              </span>
              {has && <span style={{ fontSize: 12, color: X.gn, fontWeight: 700 }}>✓ 녹음됨</span>}
            </div>

            <div style={{
              padding: "20px 22px",
              borderRadius: 14,
              background: "#fafbfd",
              border: `1px solid ${isRec ? "#fecaca" : has ? "#a7f3d0" : X.bdr}`,
              marginBottom: 16,
            }}>
              <p style={{ fontSize: 16, lineHeight: 1.8, color: X.tx, margin: 0 }}>{row.text}</p>
            </div>

            {recErr && (
              <div style={{ fontSize: 12, color: X.rd, marginBottom: 12, padding: "8px 10px", background: X.rbg, borderRadius: 8 }}>
                {recErr}
              </div>
            )}

            {/* 녹음중 상태 표시 */}
            {isRec && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", marginBottom: 12 }}>
                <span className="ntc-rec-dot" aria-hidden />
                <span style={{ fontWeight: 800, fontSize: 14, color: "#b91c1c", letterSpacing: 0.3 }}>녹음중</span>
              </div>
            )}

            {/* 재생중 표시 */}
            {isPlaying && !isRec && (
              <div className="ntc-play-pulse" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe", marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb", flexShrink: 0 }} aria-hidden />
                <span style={{ fontSize: 12, fontWeight: 800, color: "#1d4ed8" }}>▶ 재생중</span>
              </div>
            )}

            {/* 버튼 그룹 */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {!isRec && (
                <Bt v="primary" onClick={() => startRec(row.key)}>
                  🎤 {has ? "다시 녹음" : "녹음 시작"}
                </Bt>
              )}
              {isRec && (
                <>
                  <Bt v="outline" onClick={cancelRecording} style={{ color: X.rd, borderColor: "#fecaca" }}>
                    🗑 녹음취소
                  </Bt>
                  <Bt v="success" onClick={completeRecording}>
                    ✓ 녹음완료
                  </Bt>
                </>
              )}
              {!isRec && has && (
                <Bt
                  v="outline"
                  onClick={() => playRec(row.key)}
                  style={isPlaying ? { border: "2px solid #2563eb", background: "#eff6ff", color: "#1d4ed8", fontWeight: 700 } : undefined}
                >
                  {isPlaying ? "🔊 재생중…" : "🔊 내 녹음 듣기"}
                </Bt>
              )}
            </div>
          </div>
        )}

        {/* 이전 / 다음 네비게이션 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <Bt
            v="outline"
            disabled={recIdx === 0 || !!activeRecKey}
            onClick={() => goTo(recIdx - 1)}
          >
            ← 이전 문장
          </Bt>

          {isLast ? (
            <div style={{ textAlign: "center" }}>
              <Bt v="success" size="lg" disabled={!allDone} onClick={onSubmit}>
                제출하고 완료하기
              </Bt>
              {!allDone && (
                <p style={{ fontSize: 11, color: X.mt, marginTop: 6 }}>
                  모든 문장을 녹음해야 제출할 수 있습니다 ({nRec}/{rows.length})
                </p>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: X.sub }}>
              {nRec} / {rows.length} 녹음 완료
            </span>
          )}

          <Bt
            v="outline"
            disabled={isLast || !!activeRecKey}
            onClick={() => goTo(recIdx + 1)}
          >
            다음 문장 →
          </Bt>
        </div>
      </Cd>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SENTENCE BUILD STEP
   ═══════════════════════════════════════════ */
function tokenizeSentence(text) {
  return text.trim().split(/\s+/).filter(Boolean).map((w, i) => ({ w, id: `${i}__${w}` }));
}
function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function SentenceBuildStep({ sentences, onComplete, onBack }) {
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState([]);
  const [pool, setPool] = useState(() => sentences[0] ? shuffleArr(tokenizeSentence(sentences[0].en)) : []);
  const [checked, setChecked] = useState(false);
  const [correct, setCorrect] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongSentences, setWrongSentences] = useState([]);
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const dragSrcIdx = useRef(null);
  const dragTargetIdx = useRef(null);
  const hasDragged = useRef(false);
  const tokenRefs = useRef([]);

  // Pointer Events 기반 D&D (마우스 + 터치 모두 지원)
  const onPtrDown = (e, i) => {
    if (checked) return;
    hasDragged.current = false;
    dragSrcIdx.current = i;
    dragTargetIdx.current = null;
    setDraggingIdx(i);
    setDragOverIdx(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPtrMove = (e) => {
    if (dragSrcIdx.current === null) return;
    hasDragged.current = true;
    let found = null;
    for (let j = 0; j < tokenRefs.current.length; j++) {
      if (j === dragSrcIdx.current) continue;
      const el = tokenRefs.current[j];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        found = j;
        break;
      }
    }
    dragTargetIdx.current = found;
    setDragOverIdx(found);
  };
  const onPtrUp = () => {
    const src = dragSrcIdx.current;
    const tgt = dragTargetIdx.current;
    if (src !== null && tgt !== null && src !== tgt) {
      setSel(prev => {
        const next = [...prev];
        const [removed] = next.splice(src, 1);
        next.splice(tgt, 0, removed);
        return next;
      });
    }
    dragSrcIdx.current = null;
    dragTargetIdx.current = null;
    setDraggingIdx(null);
    setDragOverIdx(null);
  };

  useEffect(() => {
    if (!sentences[idx]) return;
    setPool(shuffleArr(tokenizeSentence(sentences[idx].en)));
    setSel([]);
    setChecked(false);
    setCorrect(false);
  }, [idx, sentences]);

  const cur = sentences[idx];
  if (!cur) return <div style={{ textAlign: "center", color: X.mt, padding: 40 }}>문장 데이터가 없습니다.</div>;

  const pickWord = (token) => {
    setPool(p => p.filter(t => t.id !== token.id));
    setSel(s => [...s, token]);
  };
  const unpickWord = (token) => {
    if (checked) return;
    setSel(s => s.filter(t => t.id !== token.id));
    setPool(p => [...p, token]);
  };
  const checkAnswer = () => {
    setCorrect(sel.map(t => t.w).join(" ") === cur.en);
    setChecked(true);
  };
  const nextSentence = () => {
    const newCor = correctCount + (correct ? 1 : 0);
    const newWrongs = correct ? wrongSentences : [...wrongSentences, { en: cur.en, kr: cur.kr }];
    if (idx + 1 >= sentences.length) onComplete(newCor, sentences.length, newWrongs);
    else { setCorrectCount(newCor); setWrongSentences(newWrongs); setIdx(i => i + 1); }
  };
  const retry = () => {
    setPool(shuffleArr(tokenizeSentence(cur.en)));
    setSel([]);
    setChecked(false);
    setCorrect(false);
  };

  const allPlaced = pool.length === 0;
  const isLast = idx === sentences.length - 1;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {onBack && <Bt v="ghost" onClick={onBack} style={{ marginBottom: 12 }}>← 과제 목록</Bt>}
      {/* 헤더 & 진행 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 20, color: X.tx }}>문장 만들기</h2>
        <span style={{ fontSize: 13, color: X.sub, fontWeight: 600 }}>{idx + 1} / {sentences.length}</span>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 28 }}>
        {sentences.map((_, i) => {
          const done = i < idx || (i === idx && checked && correct);
          const cur_ = i === idx;
          return (
            <div key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: done ? "#a855f7" : cur_ ? "#d8b4fe" : X.bdr, transition: "background .3s" }} />
          );
        })}
      </div>

      {/* 한국어 뜻 */}
      <div style={{ background: "#f5f3ff", border: "1px solid #e9d5ff", borderRadius: 16, padding: "18px 24px", marginBottom: 20, textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#9333ea", fontWeight: 700, marginBottom: 8, letterSpacing: "0.05em" }}>뜻</div>
        <div style={{ fontSize: 16, color: X.tx, fontWeight: 500, lineHeight: 1.7 }}>{cur.kr}</div>
      </div>

      {/* 선택된 단어 영역 */}
      <div style={{ minHeight: 72, background: checked ? (correct ? "#f0fdf4" : "#fef2f2") : X.abg, border: `2px dashed ${checked ? (correct ? "#a7f3d0" : "#fecaca") : X.ac}`, borderRadius: 16, padding: "14px 18px", marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start", alignContent: "flex-start" }}>
        {sel.length === 0 && !checked && (
          <span style={{ color: X.mt, fontSize: 13 }}>단어를 순서대로 선택하세요</span>
        )}
        {sel.map((token, i) => (
          <button key={token.id}
            ref={el => { tokenRefs.current[i] = el; }}
            onPointerDown={e => onPtrDown(e, i)}
            onPointerMove={onPtrMove}
            onPointerUp={onPtrUp}
            onPointerCancel={onPtrUp}
            onClick={() => { if (!hasDragged.current) unpickWord(token); }}
            style={{ padding: "6px 14px", borderRadius: 20, border: `2px solid ${checked ? (correct ? "#a7f3d0" : "#fecaca") : draggingIdx === i ? "#93c5fd" : dragOverIdx === i ? "#a78bfa" : X.ac}`, background: checked ? (correct ? "#dcfce7" : "#fee2e2") : draggingIdx === i ? "#dbeafe" : dragOverIdx === i ? "#ede9fe" : "#fff", color: X.tx, fontSize: 14, fontWeight: 600, cursor: checked ? "default" : draggingIdx === i ? "grabbing" : "grab", fontFamily: "inherit", transition: draggingIdx === i ? "none" : "all .15s", opacity: draggingIdx === i ? 0.5 : 1, transform: draggingIdx === i ? "scale(0.95)" : dragOverIdx === i ? "scale(1.08)" : "scale(1)", touchAction: "none", userSelect: "none" }}>
            {token.w}
          </button>
        ))}
      </div>

      {/* 정답 확인 결과 */}
      {checked && (
        <div style={{ marginBottom: 20, padding: "16px 20px", borderRadius: 14, background: correct ? "#f0fdf4" : "#fef2f2", border: `1px solid ${correct ? "#a7f3d0" : "#fecaca"}`, textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: correct ? X.gn : X.rd }}>{correct ? "🎉 정답!" : "❌ 틀렸어요"}</div>
          {!correct && (
            <div style={{ fontSize: 13, color: X.sub, marginBottom: 12 }}>
              <span style={{ fontWeight: 600, color: X.gn }}>정답: </span>{cur.en}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 10 }}>
            {!correct && (
              <button onClick={retry} style={{ padding: "9px 20px", borderRadius: 10, border: `1px solid ${X.bdr}`, background: "#fff", color: X.tx, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                🔄 다시 해볼게요
              </button>
            )}
            <button onClick={nextSentence} style={{ padding: "9px 24px", borderRadius: 10, border: "none", background: "#a855f7", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              {isLast ? "✅ 완료" : "다음 문장 →"}
            </button>
          </div>
        </div>
      )}

      {/* 단어 풀 */}
      {!checked && (
        <div style={{ background: "#fafbfd", borderRadius: 16, padding: "14px 18px", border: `1px solid ${X.bdr}`, display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {pool.map(token => (
            <button key={token.id} onClick={() => pickWord(token)}
              style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${X.bdr}`, background: "#fff", color: X.tx, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 3px rgba(0,0,0,.07)", transition: "all .15s" }}>
              {token.w}
            </button>
          ))}
          {pool.length === 0 && (
            <span style={{ color: X.mt, fontSize: 13 }}>모든 단어를 배치했어요 — 문장 확인을 눌러보세요!</span>
          )}
        </div>
      )}

      {/* 확인 버튼 */}
      {!checked && (
        <div style={{ textAlign: "center" }}>
          <button onClick={checkAnswer} disabled={!allPlaced}
            style={{ padding: "12px 44px", borderRadius: 12, border: "none", background: allPlaced ? "#a855f7" : X.bdr, color: "#fff", fontSize: 15, fontWeight: 700, cursor: allPlaced ? "pointer" : "default", fontFamily: "inherit", transition: "all .2s", opacity: allPlaced ? 1 : 0.6 }}>
            문장 확인
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── PROG DETAIL MODAL ─── */
function ProgDetailModal({ modal, onClose, effProg, scores = {}, label = "직전 과제", onRevoke = null }) {
  const [recExpanded, setRecExpanded] = useState({});
  const [playingKey, setPlayingKey] = useState(null);
  const audioRef = useRef(null);

  const { cls, prevStudents } = modal;
  const levelKey = cls.level || cls.nm.replace("반", "");
  const band = BANDS[levelKey] || { c: X.ac, bg: X.abg, r: "#bfdbfe" };

  const stepKeys = ["wl", "r", "v", "sb", "w"];
  const stepLabels = { wl: "단어보기", r: "읽기", v: "단어퀴즈", sb: "문장만들기", w: "녹음" };
  const artSeqs = [...new Set(prevStudents.flatMap(x => x.arts.map(a => a.seq)))];

  // incomplete first
  const sorted = [...prevStudents].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlayingKey(null);
  };
  const togglePlay = (pKey, url) => {
    if (playingKey === pKey) { stopAudio(); return; }
    stopAudio();
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlayingKey(null);
    a.play().catch(() => {});
    setPlayingKey(pKey);
  };
  useEffect(() => () => { if (audioRef.current) audioRef.current.pause(); }, []);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="fade-up" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 580, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,.18)" }}>
        {/* Sticky header */}
        <div style={{ padding: "18px 22px 16px", borderBottom: `1px solid ${band.r}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: band.bg, borderRadius: "20px 20px 0 0", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 17, color: band.c }}>{cls.nm}</div>
            <div style={{ fontSize: 12, color: band.c, opacity: 0.75, marginTop: 2 }}>{label}</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: band.c, opacity: 0.6, lineHeight: 1, marginLeft: 12 }}>×</button>
        </div>
        {/* Scrollable body */}
        <div style={{ overflow: "auto", padding: "16px 22px 20px" }}>
          {/* Articles */}
          {artSeqs.map(seq => {
            const art = ARTS.find(a => a.seq === seq);
            const b = BANDS[BM[seq]];
            return (
              <div key={seq} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: "#f8fafc", border: `1px solid ${X.bdr}`, marginBottom: 10 }}>
                {art?.img && <img src={art.img} style={{ width: 52, height: 36, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} alt="" />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{art?.title}</div>
                  {b && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: b.c, background: b.bg, borderRadius: 20, padding: "1px 7px", marginTop: 2 }}><span style={{ width: 4, height: 4, borderRadius: "50%", background: b.c }} />{BM[seq]}</span>}
                </div>
                {onRevoke && <button onClick={onRevoke} style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", background: "#fff1f2", border: "1px solid #fecaca", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontFamily: F.b, flexShrink: 0 }}>기사 회수</button>}
              </div>
            );
          })}
          {/* Progress table */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${X.bdr}` }}>
                <th style={{ textAlign: "left", padding: "8px 10px", color: X.sub, fontWeight: 600, fontSize: 11, width: "30%" }}>학생</th>
                {stepKeys.map(k => (
                  <th key={k} style={{ textAlign: "center", padding: "8px 4px", color: X.sub, fontWeight: 600, fontSize: 11 }}>{stepLabels[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.flatMap(({ st, done, arts }) => {
                const artSeq = arts[0]?.seq;
                const pg = gP(effProg, st.id, artSeq);
                const recKey = `${st.id}_${artSeq}`;
                const sc = scores[recKey] || {};
                const isExpanded = !!recExpanded[recKey];
                const recMapData = pg.w ? loadRecMap(st.id, artSeq) : {};
                const art = ARTS.find(a => a.seq === artSeq);
                const sentRows = art ? art.ps.flatMap(pa =>
                  splitSentenceRanges(pa.en).map((r, sIdx) => ({ key: `${pa.pid}_${sIdx}`, text: r.text }))
                ).filter((_, i) => [2, 5].includes(i)) : [];
                const hasRec = Object.keys(recMapData).length > 0;

                const mainRow = (
                  <tr key={st.id} style={{ borderBottom: `1px solid #f0f2f5`, background: done ? "#fff" : "#fff8f8" }}>
                    <td style={{ padding: "10px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontWeight: 600, color: X.tx }}>{st.nm}</span>
                        {st.id.startsWith("s_") && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#a855f7", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.03em" }}>NEW</span>}
                        <span style={{ fontSize: 10, fontWeight: 700, color: done ? X.gn : X.rd, background: done ? X.gbg : X.rbg, borderRadius: 10, padding: "1px 6px" }}>{done ? "완료" : "미완료"}</span>
                      </div>
                    </td>
                    {stepKeys.map(k => (
                      <td key={k} style={{ textAlign: "center", padding: "10px 4px" }}>
                        {k === "w" && pg.w && hasRec ? (
                          <button
                            onClick={() => setRecExpanded(p => ({ ...p, [recKey]: !p[recKey] }))}
                            style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color: "#7c3aed", background: isExpanded ? "#ede9fe" : "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "3px 7px", cursor: "pointer" }}
                          >{isExpanded ? "▾" : "▸"} 듣기</button>
                        ) : k === "v" && pg.v && sc.voc ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: X.gn }}>{sc.voc.cor}/{sc.voc.tot}</span>
                        ) : k === "sb" && pg.sb && sc.sb ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: X.gn }}>{sc.sb.cor}/{sc.sb.tot}</span>
                        ) : (
                          <Dt on={pg[k]} />
                        )}
                      </td>
                    ))}
                  </tr>
                );

                if (!isExpanded || !hasRec) return [mainRow];

                const recRow = (
                  <tr key={`${st.id}_rec`} style={{ borderBottom: `1px solid #f0f2f5` }}>
                    <td colSpan={6} style={{ padding: "4px 10px 12px 18px" }}>
                      <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                        {sentRows.map(sr => {
                          const url = recMapData[sr.key];
                          if (!url) return null;
                          const pKey = `${recKey}_${sr.key}`;
                          const isPlaying = playingKey === pKey;
                          return (
                            <div key={sr.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <button
                                onClick={() => togglePlay(pKey, url)}
                                className={isPlaying ? "ntc-play-pulse" : ""}
                                style={{ width: 28, height: 28, borderRadius: "50%", border: "none", background: isPlaying ? "#7c3aed" : "#ede9fe", color: isPlaying ? "#fff" : "#7c3aed", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}
                              >{isPlaying ? "■" : "▶"}</button>
                              <span style={{ fontSize: 12, color: X.tx, lineHeight: 1.5 }}>{sr.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );

                return [mainRow, recRow];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   STUDENT DETAIL MODAL
   ═══════════════════════════════════════════ */
function StudentDetailModal({ modal, onClose, effProg, scores = {}, onDelete }) {
  const [recExpanded, setRecExpanded] = useState({});
  const [playingKey, setPlayingKey] = useState(null);
  const audioRef = useRef(null);

  const { st, cls, artSeqs } = modal;
  const levelKey = cls.level || cls.nm.replace("반", "");
  const band = BANDS[levelKey] || { c: X.ac, bg: X.abg, r: "#bfdbfe" };
  const stepKeys = ["wl", "r", "v", "sb", "w"];
  const stepLabels = { wl: "단어보기", r: "읽기", v: "단어퀴즈", sb: "문장만들기", w: "녹음" };

  const stopAudio = () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } setPlayingKey(null); };
  const togglePlay = (pKey, url) => {
    if (playingKey === pKey) { stopAudio(); return; }
    stopAudio();
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlayingKey(null);
    a.play().catch(() => {});
    setPlayingKey(pKey);
  };
  useEffect(() => () => { if (audioRef.current) audioRef.current.pause(); }, []);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="fade-up" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 580, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,.18)" }}>
        <div style={{ padding: "18px 22px 16px", borderBottom: `1px solid ${band.r}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: band.bg, borderRadius: "20px 20px 0 0", flexShrink: 0 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 17, color: band.c }}>{st.nm}</div>
              {st.id.startsWith("s_") && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#a855f7", borderRadius: 4, padding: "1px 5px" }}>NEW</span>}
            </div>
            <div style={{ fontSize: 12, color: band.c, opacity: 0.75, marginTop: 2 }}>{cls.nm} · 학습 상세 현황</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 12 }}>
            {onDelete && (
              <button
                onClick={() => { if (window.confirm(`${st.nm} 학생을 삭제하시겠습니까?`)) { onDelete(st.id); onClose(); } }}
                style={{ fontSize: 12, fontWeight: 500, color: X.mt, background: "transparent", border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontFamily: F.b }}
              >학생 삭제</button>
            )}
            <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: band.c, opacity: 0.6, lineHeight: 1 }}>×</button>
          </div>
        </div>
        <div style={{ overflow: "auto", padding: "16px 22px 20px" }}>
          {artSeqs.length === 0
            ? <p style={{ textAlign: "center", color: X.mt, fontSize: 13, padding: "32px 0" }}>배정된 과제가 없습니다.</p>
            : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${X.bdr}` }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", color: X.sub, fontWeight: 600, fontSize: 11, width: "38%" }}>기사</th>
                    {stepKeys.map(k => (
                      <th key={k} style={{ textAlign: "center", padding: "8px 4px", color: X.sub, fontWeight: 600, fontSize: 11 }}>{stepLabels[k]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {artSeqs.flatMap(seq => {
                    const art = ARTS.find(a => a.seq === seq);
                    const pg = gP(effProg, st.id, seq);
                    const done = pg.r && pg.wl && pg.v && pg.sb && pg.w;
                    const recKey = `${st.id}_${seq}`;
                    const sc = scores[recKey] || {};
                    const isExpanded = !!recExpanded[recKey];
                    const recMapData = pg.w ? loadRecMap(st.id, seq) : {};
                    const sentRows = art ? art.ps.flatMap(pa =>
                      splitSentenceRanges(pa.en).map((r, sIdx) => ({ key: `${pa.pid}_${sIdx}`, text: r.text }))
                    ).filter((_, i) => [2, 5].includes(i)) : [];
                    const hasRec = Object.keys(recMapData).length > 0;
                    const b = BANDS[BM[seq]];

                    const mainRow = (
                      <tr key={seq} style={{ borderBottom: `1px solid #f0f2f5`, background: done ? "#fff" : "#fff8f8" }}>
                        <td style={{ padding: "10px 10px" }}>
                          <div style={{ fontWeight: 600, fontSize: 12, color: X.tx, marginBottom: 3 }}>{art?.title || seq}</div>
                          <div style={{ display: "flex", gap: 4 }}>
                            {b && <span style={{ fontSize: 10, fontWeight: 700, color: b.c, background: b.bg, borderRadius: 4, padding: "1px 5px" }}>{BM[seq]}</span>}
                            <span style={{ fontSize: 10, fontWeight: 700, color: done ? X.gn : X.rd, background: done ? X.gbg : X.rbg, borderRadius: 10, padding: "1px 6px" }}>{done ? "완료" : "미완료"}</span>
                          </div>
                        </td>
                        {stepKeys.map(k => (
                          <td key={k} style={{ textAlign: "center", padding: "10px 4px" }}>
                            {k === "w" && pg.w && hasRec ? (
                              <button
                                onClick={() => setRecExpanded(p => ({ ...p, [recKey]: !p[recKey] }))}
                                style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color: "#7c3aed", background: isExpanded ? "#ede9fe" : "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "3px 7px", cursor: "pointer" }}
                              >{isExpanded ? "▾" : "▸"} 듣기</button>
                            ) : k === "v" && pg.v && sc.voc ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: X.gn }}>{sc.voc.cor}/{sc.voc.tot}</span>
                            ) : k === "sb" && pg.sb && sc.sb ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: X.gn }}>{sc.sb.cor}/{sc.sb.tot}</span>
                            ) : (
                              <Dt on={pg[k]} />
                            )}
                          </td>
                        ))}
                      </tr>
                    );

                    if (!isExpanded || !hasRec) return [mainRow];

                    const recRow = (
                      <tr key={`${seq}_rec`} style={{ borderBottom: `1px solid #f0f2f5` }}>
                        <td colSpan={6} style={{ padding: "4px 10px 12px 18px" }}>
                          <div style={{ background: "#f5f3ff", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                            {sentRows.map(sr => {
                              const url = recMapData[sr.key];
                              if (!url) return null;
                              const pKey = `${recKey}_${sr.key}`;
                              const isPlaying = playingKey === pKey;
                              return (
                                <div key={sr.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <button
                                    onClick={() => togglePlay(pKey, url)}
                                    className={isPlaying ? "ntc-play-pulse" : ""}
                                    style={{ width: 28, height: 28, borderRadius: "50%", border: "none", background: isPlaying ? "#7c3aed" : "#ede9fe", color: isPlaying ? "#fff" : "#7c3aed", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}
                                  >{isPlaying ? "■" : "▶"}</button>
                                  <span style={{ fontSize: 12, color: X.tx, lineHeight: 1.5 }}>{sr.text}</span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );

                    return [mainRow, recRow];
                  })}
                </tbody>
              </table>
            )
          }
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ARTICLE PROGRESS MODAL (학생×기사 상세)
   ═══════════════════════════════════════════ */
function ArticleProgressModal({ modal, onClose, effProg, scores = {} }) {
  const [playingKey, setPlayingKey] = useState(null);
  const audioRef = useRef(null);

  const { st, cls, seq } = modal;
  const levelKey = cls.level || cls.nm.replace("반", "");
  const band = BANDS[levelKey] || { c: X.ac, bg: X.abg, r: "#bfdbfe" };
  const art = ARTS.find(a => a.seq === seq);
  const b = BANDS[BM[seq]];

  const pg = gP(effProg, st.id, seq);
  const recKey = `${st.id}_${seq}`;
  const sc = scores[recKey] || {};
  const recMapData = pg.w ? loadRecMap(st.id, seq) : {};
  const hasRec = Object.keys(recMapData).length > 0;

  const allSentRows = art ? art.ps.flatMap(pa =>
    splitSentenceRanges(pa.en).map((r, sIdx) => ({ key: `${pa.pid}_${sIdx}`, text: r.text }))
  ) : [];
  const recSentRows = allSentRows.filter((_, i) => [2, 5].includes(i));

  const stopAudio = () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } setPlayingKey(null); };
  const togglePlay = (pKey, url) => {
    if (playingKey === pKey) { stopAudio(); return; }
    stopAudio();
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlayingKey(null);
    a.play().catch(() => {});
    setPlayingKey(pKey);
  };
  useEffect(() => () => { if (audioRef.current) audioRef.current.pause(); }, []);

  const steps = [
    { key: "wl", icon: "📋", label: "단어보기", done: pg.wl },
    { key: "r",  icon: "📖", label: "읽기",     done: pg.r },
    { key: "v",  icon: "📝", label: "단어퀴즈", done: pg.v },
    { key: "sb", icon: "✏️", label: "문장만들기", done: pg.sb },
    { key: "w",  icon: "🎤", label: "녹음",     done: pg.w },
  ];
  const allDone = steps.every(s => s.done);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="fade-up" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,.18)" }}>
        {/* 헤더 */}
        <div style={{ padding: "18px 22px 16px", borderBottom: `1px solid ${band.r}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: band.bg, borderRadius: "20px 20px 0 0", flexShrink: 0 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 17, color: band.c }}>{st.nm}</div>
              {st.id.startsWith("s_") && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#a855f7", borderRadius: 4, padding: "1px 5px" }}>NEW</span>}
            </div>
            <div style={{ fontSize: 12, color: band.c, opacity: 0.75, marginTop: 2 }}>{cls.nm} · 과제 상세</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: band.c, opacity: 0.6, lineHeight: 1, marginLeft: 12 }}>×</button>
        </div>

        {/* 스크롤 본문 */}
        <div style={{ overflow: "auto", padding: "16px 22px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 기사 정보 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: `1px solid ${X.bdr}` }}>
            {art?.img && <img src={art.img} style={{ width: 52, height: 36, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} alt="" />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: X.tx, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art?.title || seq}</div>
              <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                {b && <span style={{ fontSize: 10, fontWeight: 700, color: b.c, background: b.bg, borderRadius: 4, padding: "1px 5px" }}>{BM[seq]}</span>}
                <span style={{ fontSize: 10, fontWeight: 700, color: allDone ? X.gn : X.am, background: allDone ? X.gbg : X.abg2, borderRadius: 4, padding: "1px 5px" }}>{allDone ? "완료" : "진행 중"}</span>
              </div>
            </div>
          </div>

          {/* 단계별 상세 */}
          {steps.map(step => {
            const isDone = step.done;
            const isVoc = step.key === "v";
            const isSb = step.key === "sb";
            const isRec = step.key === "w";

            return (
              <div key={step.key} style={{ borderRadius: 12, border: `1px solid ${isDone ? "#e2e8f0" : "#f1f5f9"}`, overflow: "hidden" }}>
                {/* 단계 헤더 */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: isDone ? "#f8fafc" : "#fafbfc" }}>
                  <span style={{ fontSize: 16 }}>{step.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: X.tx, flex: 1 }}>{step.label}</span>
                  {isVoc && isDone && sc.voc ? (
                    <span style={{ fontSize: 12, fontWeight: 700, color: sc.voc.cor === sc.voc.tot ? X.gn : X.am }}>
                      {sc.voc.cor} / {sc.voc.tot} 정답
                    </span>
                  ) : isSb && isDone && sc.sb ? (
                    <span style={{ fontSize: 12, fontWeight: 700, color: sc.sb.cor === sc.sb.tot ? X.gn : X.am }}>
                      {sc.sb.cor} / {sc.sb.tot} 정답
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, color: isDone ? X.gn : X.mt }}>
                      {isDone ? "완료" : "미완료"}
                    </span>
                  )}
                </div>

                {/* 단어퀴즈 오답 */}
                {isVoc && isDone && sc.voc?.wrongs?.length > 0 && (
                  <div style={{ padding: "8px 14px 12px", background: "#fff", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: X.sub, marginBottom: 2 }}>오답 단어</div>
                    {sc.voc.wrongs.map((w, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca" }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: X.rd, flexShrink: 0 }}>✗</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: X.tx }}>{w.en}</div>
                          <div style={{ fontSize: 11, color: X.sub, marginTop: 1 }}>
                            내 답: <span style={{ color: X.rd, fontWeight: 600 }}>{w.ans || "미선택"}</span>
                            {" / "}정답: <span style={{ color: X.gn, fontWeight: 600 }}>{w.kr}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {isVoc && isDone && sc.voc && (!sc.voc.wrongs || sc.voc.wrongs.length === 0) && sc.voc.cor === sc.voc.tot && (
                  <div style={{ padding: "8px 14px 10px", background: "#fff" }}>
                    <div style={{ fontSize: 12, color: X.gn, fontWeight: 600 }}>모두 정답!</div>
                  </div>
                )}

                {/* 문장만들기 오답 */}
                {isSb && isDone && sc.sb?.wrongs?.length > 0 && (
                  <div style={{ padding: "8px 14px 12px", background: "#fff", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: X.sub, marginBottom: 2 }}>오답 문장</div>
                    {sc.sb.wrongs.map((s, i) => (
                      <div key={i} style={{ padding: "8px 10px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: X.rd, marginBottom: 3 }}>✗ 틀린 문장</div>
                        <div style={{ fontSize: 12, color: X.tx, lineHeight: 1.5 }}>{s.en}</div>
                        {s.kr && <div style={{ fontSize: 11, color: X.sub, marginTop: 2 }}>{s.kr}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {isSb && isDone && sc.sb && (!sc.sb.wrongs || sc.sb.wrongs.length === 0) && sc.sb.cor === sc.sb.tot && (
                  <div style={{ padding: "8px 14px 10px", background: "#fff" }}>
                    <div style={{ fontSize: 12, color: X.gn, fontWeight: 600 }}>모두 정답!</div>
                  </div>
                )}

                {/* 녹음 재생 */}
                {isRec && isDone && hasRec && (
                  <div style={{ padding: "8px 14px 12px", background: "#fff", display: "flex", flexDirection: "column", gap: 8 }}>
                    {recSentRows.map(sr => {
                      const url = recMapData[sr.key];
                      if (!url) return null;
                      const pKey = `${recKey}_${sr.key}`;
                      const isPlaying = playingKey === pKey;
                      return (
                        <div key={sr.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <button
                            onClick={() => togglePlay(pKey, url)}
                            className={isPlaying ? "ntc-play-pulse" : ""}
                            style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: isPlaying ? "#7c3aed" : "#ede9fe", color: isPlaying ? "#fff" : "#7c3aed", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}
                          >{isPlaying ? "■" : "▶"}</button>
                          <span style={{ fontSize: 12, color: X.tx, lineHeight: 1.5 }}>{sr.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   APP
   ═══════════════════════════════════════════ */
export default function App() {
  const [role, setRole] = useState("teacher");
  const [sv, setSv] = useState("tasks");
  const [sSt, setSSt] = useState("s1");
  const [sArt, setSArt] = useState(null);
  const [asgn, setAsgn] = useState(() => {
    try { const s = localStorage.getItem("ntc_asgn_v1"); return s ? JSON.parse(s) : IA; } catch { return IA; }
  });
  const [prog, setProg] = useState(() => {
    try { const s = localStorage.getItem("ntc_prog_v1"); return s ? JSON.parse(s) : IP; } catch { return IP; }
  });
  const [lF, setLF] = useState(null);
  const [tF, setTF] = useState(null);
  const [kr, setKr] = useState(false);
  const [pw, setPw] = useState(null);
  const [artPlaying, setArtPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [articlePlayingSentenceKey, setArticlePlayingSentenceKey] = useState(null);
  const artAudioRef = useRef(null);
  const [sentencePlayingKey, setSentencePlayingKey] = useState(null);
  const sentenceSourceRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sentenceAudioCacheRef = useRef({});
  const [va, setVa] = useState({});
  const [vchecked, setVchecked] = useState({});
  const [vd, setVd] = useState(false);
  const [vo, setVo] = useState({});
  const [wa, setWa] = useState({});
  const [wd, setWd] = useState(false);
  const [scores, setScores] = useState(() => {
    try { const s = localStorage.getItem("ntc_scores_v1"); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  // at: { t: "class", id: "c1"|"__all__" } | { t: "students", ids: string[] }
  const [at, setAt] = useState({ t: "class", id: "c1" });
  const [ar, setAr] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [lastAssigned, setLastAssigned] = useState(false);

  /* ─── PERSIST STATE ─── */
  useEffect(() => { localStorage.setItem("ntc_asgn_v1", JSON.stringify(asgn)); }, [asgn]);

  /* 앱 시작 시 CLASS_DEFAULT_SEQS 누락분 병합 (스테일 localStorage 대응) */
  useEffect(() => {
    setAsgn(p => {
      const next = { ...p };
      let changed = false;
      clsData.forEach(cls => {
        const defSeqs = CLASS_DEFAULT_SEQS[cls.id] || [];
        cls.sts.forEach(st => {
          const cur = next[st.id] || [];
          const missing = defSeqs.filter(seq => !cur.some(a => a.seq === seq));
          if (missing.length > 0) {
            next[st.id] = [...cur, ...missing.map(seq => ({ seq }))];
            changed = true;
          }
        });
      });
      return changed ? next : p;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { localStorage.setItem("ntc_prog_v1", JSON.stringify(prog)); }, [prog]);
  useEffect(() => { localStorage.setItem("ntc_scores_v1", JSON.stringify(scores)); }, [scores]);


  const [useSeed, setUseSeed] = useState(true);
  const effProg = useSeed ? { ...IP, ...prog } : prog;

  const resetAll = () => {
    if (!window.confirm("모든 학습 진행 데이터를 초기화하시겠습니까?\n(배정 내역, 진행 상태, 녹음 파일이 모두 삭제됩니다)")) return;
    Object.keys(localStorage).filter(k => k.startsWith("ntc_") && k !== "ntc_cls_v2").forEach(k => localStorage.removeItem(k));
    setAsgn(IA);
    setProg(IP);
    setScores({});
    setSArt(null);
    setSv("tasks");
  };

  /* ─── DYNAMIC STUDENTS ─── */
  const [clsData, setClsData] = useState(() => {
    try {
      const s = localStorage.getItem("ntc_cls_v2");
      const data = s ? JSON.parse(s) : CLS;
      const defaults = { c1: "입문", c3: "기본" };
      return data
        .filter(c => c.id !== "c2" && c.id !== "c4")
        .map(c => defaults[c.id] && !c.level ? { ...c, level: defaults[c.id] } : c);
    } catch { return CLS; }
  });
  const dynALL = useMemo(
    () => clsData.flatMap(c => c.sts.map(s => ({ ...s, cId: c.id, cNm: c.nm }))),
    [clsData]
  );
  const [clsFreq, setClsFreq] = useState(() => {
    try { const s = localStorage.getItem("ntc_freq_v1"); const stored = s ? JSON.parse(s) : {}; return { c1: "주3회", c2: "주2회", c3: "주2회", c4: "주3회", ...stored }; } catch { return { c1: "주3회", c2: "주2회", c3: "주2회", c4: "주3회" }; }
  });
  const setFreq = (cId, val) => {
    const next = { ...clsFreq, [cId]: val };
    setClsFreq(next);
    localStorage.setItem("ntc_freq_v1", JSON.stringify(next));
  };
  const FREQS = ["주2회", "주3회", "주5회"];
  const cycleFreq = (cId) => { const cur = clsFreq[cId] || "주2회"; setFreq(cId, FREQS[(FREQS.indexOf(cur) + 1) % FREQS.length]); };
  const saveCls = (next) => {
    setClsData(next);
    localStorage.setItem("ntc_cls_v2", JSON.stringify(next));
  };
  const addStudent = (nm, cId) => {
    const newId = `s_${Date.now()}`;
    const next = clsData.map(c =>
      c.id === cId ? { ...c, sts: [...c.sts, { id: newId, nm }] } : c
    );
    saveCls(next);
    const cls = clsData.find(c => c.id === cId);
    const freq = clsFreq[cId] || "주2회";
    const defSeqs = (cls?.level ? LEVEL_FREQ_SEQS[cls.level]?.[freq] : null) ?? CLASS_DEFAULT_SEQS[cId];
    if (defSeqs?.length) {
      setAsgn(p => ({ ...p, [newId]: defSeqs.map(seq => ({ seq })) }));
    }
  };
  const removeStudent = (stId) => {
    const next = clsData.map(c => ({ ...c, sts: c.sts.filter(s => s.id !== stId) }));
    saveCls(next);
  };

  /* ─── STUDENT ADD MODAL STATE ─── */
  const [wlIdx, setWlIdx] = useState(0);
  const [wlRevealIdx, setWlRevealIdx] = useState(-1);
  const [vocIdx, setVocIdx] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCId, setAddCId] = useState("");
  const [addClsModal, setAddClsModal] = useState(null); // { nm, level, freq }
  const CLS_LEVEL_OPTIONS = [
    { key: "Kinder", level: "입문" },
    { key: "Kids",   level: "기초" },
    { key: "Junior", level: "기본" },
    { key: "Times",  level: "심화" },
  ];
  const addClass = () => {
    const { nm, level, freq } = addClsModal;
    if (!nm.trim() || !level) return;
    const newId = `c_${Date.now()}`;
    const next = [...clsData, { id: newId, nm: nm.trim(), sts: [], level }];
    saveCls(next);
    setFreq(newId, freq);
    setAddClsModal(null);
    showToast(`${nm.trim()} 반이 추가되었습니다.`);
  };
  const [levelPick, setLevelPick] = useState(null); // 0~3 선택된 레벨 그룹 인덱스
  const [useLevel, setUseLevel] = useState(false);

  const LEVEL_GROUPS = [
    {
      label: "입문반",
      desc: "유치원 ~ 초등학교 2학년",
      color: BANDS["입문"].c,
      bg: BANDS["입문"].bg,
      sentences: [
        "I like cats and dogs.",
        "She has a big red ball.",
      ],
    },
    {
      label: "기초반",
      desc: "초등학교 3학년 ~ 6학년",
      color: BANDS["기초"].c,
      bg: BANDS["기초"].bg,
      sentences: [
        "My family goes to the park every weekend.",
        "The children learned about animals in science class.",
      ],
    },
    {
      label: "기본반",
      desc: "초등학교 고학년 ~ 중학생",
      color: BANDS["기본"].c,
      bg: BANDS["기본"].bg,
      sentences: [
        "Scientists discovered that plants communicate through underground networks.",
        "Ancient civilizations built remarkable structures without modern tools.",
      ],
    },
    {
      label: "심화반",
      desc: "중학교 3학년 ~ 성인",
      color: BANDS["심화"].c,
      bg: BANDS["심화"].bg,
      sentences: [
        "The rapid advancement of artificial intelligence has sparked ethical debates worldwide.",
        "Environmental degradation poses unprecedented challenges to global biodiversity conservation.",
      ],
    },
  ];

  /* 추천 레벨 → clsData 내 매칭되는 반 id */
  const recommendCId = (lvIdx) => {
    const lbl = LEVEL_GROUPS[lvIdx].label; // "입문반" etc.
    const match = clsData.find(c => c.nm === lbl);
    if (match) return match.id;
    // 없으면 band 매핑으로 근사
    if (lvIdx <= 1) return clsData[0]?.id ?? "";
    return clsData[clsData.length - 1]?.id ?? "";
  };

  const openAddModal = () => {
    setAddName("");
    setAddCId(clsData[0]?.id ?? "");
    setLevelPick(null);
    setUseLevel(false);
    setShowAddModal(true);
  };
  const closeAddModal = () => setShowAddModal(false);
  const submitAdd = () => {
    const name = addName.trim();
    if (!name || !addCId) return;
    addStudent(name, addCId);
    closeAddModal();
    showToast(`${name} 학생이 등록되었습니다.`);
  };

  useEffect(() => {
    const id = "ne-times-v2";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id; el.textContent = GLOBAL_CSS;
      document.head.appendChild(el);
    }
  }, []);

  // 기사가 바뀌면 재생 중인 오디오 자동 정지
  useEffect(() => {
    if (artAudioRef.current) {
      artAudioRef.current.pause();
      artAudioRef.current = null;
    }
    if (sentenceSourceRef.current) {
      sentenceSourceRef.current.stop();
      sentenceSourceRef.current.disconnect();
      sentenceSourceRef.current = null;
    }
    setArtPlaying(false);
    setArticlePlayingSentenceKey(null);
    setSentencePlayingKey(null);
  }, [sArt]);

  useEffect(() => () => {
    if (sentenceSourceRef.current) {
      sentenceSourceRef.current.stop();
      sentenceSourceRef.current.disconnect();
      sentenceSourceRef.current = null;
    }
    if (audioCtxRef.current) audioCtxRef.current.close();
  }, []);

  useEffect(() => {
    if (sv === "rd") return;
    if (sentenceSourceRef.current) {
      sentenceSourceRef.current.stop();
      sentenceSourceRef.current.disconnect();
      sentenceSourceRef.current = null;
    }
    if (artAudioRef.current) {
      artAudioRef.current.pause();
      artAudioRef.current = null;
      setArtPlaying(false);
    }
    setArticlePlayingSentenceKey(null);
    setSentencePlayingKey(null);
  }, [sv]);

  useEffect(() => {
    if (artAudioRef.current) artAudioRef.current.playbackRate = playbackRate;
    if (sentenceSourceRef.current) sentenceSourceRef.current.playbackRate.value = playbackRate;
  }, [playbackRate]);

  const showToast = (msg, withAction = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    setLastAssigned(withAction);
    toastTimer.current = setTimeout(() => { setToast(null); setLastAssigned(false); }, 3500);
  };

  const uP = (s, q, f) => {
    const k = `${s}_${q}`;
    setProg((p) => {
      const prev = p[k] || {};
      return { ...p, [k]: { r: false, wl: false, v: false, sb: false, w: false, ...prev, [f]: true } };
    });
  };
  const cA = sArt ? ARTS.find(a => a.seq === sArt) : null;
  const cW = sArt ? (W[sArt] || []) : [];
  const cWB = sArt ? (WB[sArt] || []) : [];
  const sAs = useMemo(() => (asgn[sSt] || []).map(a => ({ ...a, art: ARTS.find(x => x.seq === a.seq), pg: gP(prog, sSt, a.seq) })), [asgn, sSt, prog]);
  const sentenceMeta = useMemo(() => {
    if (!cA) return { byPid: {}, all: [] };
    const byPid = {};
    const all = [];
    cA.ps.forEach((pa, pIdx) => {
      const ranges = splitSentenceRanges(pa.en).map((r, sIdx) => {
        const key = `${pa.pid}_${sIdx}`;
        const item = { ...r, key, pid: pa.pid, pIdx, sIdx };
        all.push(item);
        return item;
      });
      byPid[pa.pid] = ranges;
    });
    return { byPid, all };
  }, [cA]);

  const sbSentences = useMemo(() => {
    if (!cA) return [];
    const result = [];
    cA.ps.forEach(pa => {
      const enSents = splitSentenceRanges(pa.en);
      const krSents = splitSentenceRanges(pa.kr);
      enSents.forEach((es, i) => {
        result.push({ en: es.text.trim(), kr: krSents[i]?.text.trim() || pa.kr });
      });
    });
    return result.filter((_, i) => [1, 4, 6, 7].includes(i));
  }, [cA]);

  const ensureSentenceAudio = async () => {
    if (!cA?.mp3 || cA.mp3 === "#") return null;
    const cached = sentenceAudioCacheRef.current[cA.seq];
    if (cached) return cached;

    const res = await fetch(cA.mp3);
    const arr = await res.arrayBuffer();
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtxRef.current;
    const buffer = await ctx.decodeAudioData(arr.slice(0));
    const speechAnalysis = detectSpeechSegments(buffer);
    // MP3는 "기사 제목 + 기사 본문" 순서로 구성되어 있으므로,
    // 재생용 문장 매핑에는 제목 문장도 앞에 포함시킨다.
    const titleRanges = splitSentenceRanges(cA.title).map((r, idx) => ({
      ...r,
      key: `__title_${idx}`,
      pid: null,
      pIdx: -1,
      sIdx: idx,
    }));
    const audioSentences = [...titleRanges, ...sentenceMeta.all];
    const sentenceMap = mapSentenceSegments(audioSentences, speechAnalysis, buffer.duration);
    const packed = { buffer, sentenceMap };
    sentenceAudioCacheRef.current[cA.seq] = packed;
    return packed;
  };

  const playSentenceByKey = async (key) => {
    if (!cA?.mp3 || cA.mp3 === "#") return;
    try {
      if (artAudioRef.current) {
        artAudioRef.current.pause();
        artAudioRef.current = null;
        setArtPlaying(false);
        setArticlePlayingSentenceKey(null);
      }
      if (sentenceSourceRef.current) {
        sentenceSourceRef.current.stop();
        sentenceSourceRef.current.disconnect();
        sentenceSourceRef.current = null;
      }

      const prepared = await ensureSentenceAudio();
      if (!prepared) return;
      const { buffer, sentenceMap } = prepared;
      const seg = sentenceMap[key];
      if (!seg) return;

      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = playbackRate;
      src.connect(ctx.destination);
      sentenceSourceRef.current = src;
      setSentencePlayingKey(key);
      src.onended = () => {
        if (sentenceSourceRef.current === src) {
          sentenceSourceRef.current.disconnect();
          sentenceSourceRef.current = null;
          setSentencePlayingKey(null);
        }
      };
      src.start(0, seg.start, Math.max(0.05, seg.end - seg.start));
    } catch {
      setSentencePlayingKey(null);
    }
  };

  const syncArticleHighlightByTime = async (audioEl) => {
    if (!audioEl || !cA?.mp3 || cA.mp3 === "#") return;
    const prepared = await ensureSentenceAudio();
    if (!prepared || artAudioRef.current !== audioEl) return;
    const { sentenceMap } = prepared;
    const current = sentenceMeta.all.find((s) => {
      const seg = sentenceMap[s.key];
      return seg && audioEl.currentTime >= seg.start && audioEl.currentTime < seg.end;
    });
    setArticlePlayingSentenceKey(current ? current.key : null);
  };

  const cR = () => {
    uP(sSt, sArt, "r");
    initVocOptions(cW.filter(w => w.pid).slice(0, 4), cW);
    setSv("voc");
  };
  const initVocOptions = (wordList, allWords) => {
    // allWords: 해당 기사의 전체 단어 — 보기 풀(pool)로 사용
    const pool = (allWords && allWords.length > wordList.length ? allWords : wordList);
    const o = {};
    wordList.forEach((w) => {
      const distractors = pool
        .filter(pw => pw.kr !== w.kr)
        .sort(() => Math.random() - 0.5)
        .slice(0, 2)
        .map(pw => pw.kr);
      // 보기가 2개 미만이면 wordList 내에서 보충
      const extra = wordList
        .filter(pw => pw.kr !== w.kr && !distractors.includes(pw.kr))
        .map(pw => pw.kr);
      const opts3 = [...distractors, ...extra].slice(0, 2);
      o[w.i] = [w.kr, ...opts3].sort(() => Math.random() - 0.5);
    });
    setVo(o);
    setVa({});
    setVchecked({});
    setVd(false);
    setVocIdx(0);
  };
  const goWlToRd = () => {
    uP(sSt, sArt, "wl");
    setSv("rd");
  };
  const cV = () => {
    const ws = cW.filter(w => w.pid).slice(0, 4);
    const cor = ws.filter(w => va[w.i] === w.kr).length;
    const wrongs = ws.filter(w => va[w.i] !== w.kr).map(w => ({ en: w.en, kr: w.kr, ans: va[w.i] || "" }));
    const k = `${sSt}_${sArt}`;
    setScores(p => ({ ...p, [k]: { ...(p[k] || {}), voc: { cor, tot: ws.length, wrongs } } }));
    uP(sSt, sArt, "v");
    setSv("ssb");
  };
  const cSb = (cor, tot, wrongs = []) => {
    const k = `${sSt}_${sArt}`;
    setScores(p => ({ ...p, [k]: { ...(p[k] || {}), sb: { cor, tot, wrongs } } }));
    uP(sSt, sArt, "sb");
    setSv("rec");
  };
  const cRecSubmit = () => {
    uP(sSt, sArt, "w");
    setSv("dn");
  };
  const cWk = () => {
    const autoTypes = ["wc", "mc", "tf", "us", "mt"];
    let cor = 0; let tot = 0;
    cWB.forEach((act, ai) => {
      if (!autoTypes.includes(act.t)) return;
      if (act.qs) {
        act.qs.forEach(q => { tot++; if (wa[`${ai}_${q.id}`] === q.a) cor++; });
      } else if (act.left) {
        act.left.forEach((_, li) => { tot++; if (wa[`${ai}_m_${li + 1}`] === act.ans[String(li + 1)]) cor++; });
      }
    });
    const k = `${sSt}_${sArt}`;
    setScores(p => ({ ...p, [k]: { ...(p[k] || {}), wb: { cor, tot } } }));
    uP(sSt, sArt, "w"); setSv("dn");
  };
  const bk = () => { setSArt(null); setSv("tasks"); setPw(null); };
  // 현재 at 기준 대상 학생 목록 반환
  const getTargetStudents = () => {
    if (at.t === "students") return dynALL.filter(s => (at.ids || []).includes(s.id));
    if (at.id === "__all__") return dynALL;
    return clsData.find(c => c.id === at.id)?.sts || [];
  };

  const dAR = () => {
    const ts = getTargetStudents();
    const fl = ARTS.filter(a => { if (lF && BM[a.seq] !== lF) return false; if (tF && a.tc !== tF) return false; return true; });
    const r = fl.find(a => ts.every(s => !(asgn[s.id] || []).some(x => x.seq === a.seq)));
    setAr(r || null);
  };

  const dAs = (seq) => {
    const ts = getTargetStudents();
    setAsgn(p => { const n = { ...p }; ts.forEach(s => { if (!n[s.id]) n[s.id] = []; if (!n[s.id].some(a => a.seq === seq)) n[s.id] = [...n[s.id], { seq }]; }); return n; });
    setAr(null);
    const art = ARTS.find(a => a.seq === seq);
    const targetLabel = at.t === "students"
      ? `${(at.ids || []).map(id => dynALL.find(s => s.id === id)?.nm).filter(Boolean).join(", ")}에게`
      : at.id === "__all__" ? "전체에"
      : `${clsData.find(c => c.id === at.id)?.nm || ""}에`;
    showToast(`${targetLabel} '${art?.title}' 배정 완료`, true);
  };

  const isAssigned = (seq) => {
    const ts = getTargetStudents();
    if (!ts.length) return false;
    if (at.t === "students") return ts.every(s => (asgn[s.id] || []).some(a => a.seq === seq));
    return ts.every(s => (asgn[s.id] || []).some(a => a.seq === seq));
  };

  const [revokeModal, setRevokeModal] = useState(null); // { seq, art, targets }
  const [detailModal, setDetailModal] = useState(null); // { cls, prevStudents, label }
  const [studentDetailModal, setStudentDetailModal] = useState(null); // { st, cls, artSeqs }
  const [artProgModal, setArtProgModal] = useState(null); // { st, cls, seq }
  const [assignModal, setAssignModal] = useState(null); // { cls }
  const [freqModal, setFreqModal] = useState(null); // { cId, nm, cur }
  const [clsSettingsModal, setClsSettingsModal] = useState(null); // { cls, nm, level, freq }

  const revokeAsgn = (seq) => {
    const ts = getTargetStudents();
    const targets = ts.filter(s => (asgn[s.id] || []).some(a => a.seq === seq));
    if (!targets.length) return;
    const art = ARTS.find(a => a.seq === seq);
    setRevokeModal({ seq, art, targets });
  };

  const confirmRevoke = () => {
    if (!revokeModal) return;
    const { seq, art, targets } = revokeModal;
    setAsgn(p => {
      const n = { ...p };
      targets.forEach(s => { n[s.id] = (n[s.id] || []).filter(a => a.seq !== seq); });
      return n;
    });
    setRevokeModal(null);
    showToast(`'${art?.title}' 회수 완료`);
  };

  /* ─── TEACHER DASHBOARD ─── */
  const TDash = () => {
    const tA = Object.values(asgn).flat().length;
    const tD = Object.entries(effProg).filter(([, v]) => v.r && v.wl && v.v && v.w).length;
    const tP = Object.entries(effProg).filter(([, v]) => (v.r || v.wl || v.v || v.w) && !(v.r && v.wl && v.v && v.w)).length;
    const tN = tA - tD - tP;
    return (
      <div>
        <Cd style={{ marginBottom: 20, padding: 24, background: `linear-gradient(135deg,${X.dk} 0%,#1e293b 100%)`, color: "#fff", border: "none", display: "flex", alignItems: "center", gap: 20 }}>

          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 22 }}>박지영 선생님</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 3 }}>NE 영어학원 · 담당 {clsData.length}개 반 · 학생 {dynALL.length}명</div>
          </div>
          <div style={{ textAlign: "right", padding: "8px 16px", background: "rgba(255,255,255,.06)", borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b" }}>오늘</div>
            <div style={{ fontFamily: F.h, fontWeight: 700, fontSize: 14 }}>2026. 4. 2.</div>
          </div>
        </Cd>
      </div>
    );
  };

  /* ─── TEACHER ASSIGN ─── */
  const TAssign = () => {
    const fl = ARTS.filter(a => { if (lF && BM[a.seq] !== lF) return false; if (tF && a.tc !== tF) return false; return true; });
    const tps = [...new Set(ARTS.map(a => a.tc))];
    return (
      <div>
        <p style={{ fontSize: 13, color: X.sub, marginBottom: 14 }}>반 또는 학생을 선택한 뒤 기사를 배정하세요.</p>
        <Cd style={{ marginBottom: 14, padding: 16 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* 배정 대상 — 반 select */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: X.sub }}>배정 대상</span>
              <select
                style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${X.bdr}`, fontSize: 13, fontFamily: F.b, width: 110 }}
                value={at.t === "class" ? at.id : "__individual__"}
                onChange={e => {
                  const v = e.target.value;
                  if (v === "__individual__") return; // 학생 버튼으로만 전환
                  if (v === "__all__") setAt({ t: "class", id: "__all__" });
                  else setAt({ t: "class", id: v });
                }}
              >
                <option value="__all__">전체</option>
                {clsData.map(c => <option key={c.id} value={c.id}>{c.nm}</option>)}
                {at.t === "students" && <option value="__individual__">개별 선택 중</option>}
              </select>
            </div>
            {/* 학생 선택 — 반 하이라이트 + 개별 다중 선택 토글 */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {dynALL.map(s => {
                const inClass = at.t === "class" && (at.id === "__all__" || at.id === s.cId);
                const isActive = at.t === "students" && (at.ids || []).includes(s.id);
                const cls = clsData.find(c => c.id === s.cId);
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (at.t === "class") {
                        // 반 선택 상태에서 학생 클릭 → 개별 선택 모드로 전환, 해당 학생 선택
                        setAt({ t: "students", ids: [s.id] });
                      } else {
                        // 개별 선택 모드에서 토글
                        const cur = at.ids || [];
                        const next = cur.includes(s.id) ? cur.filter(id => id !== s.id) : [...cur, s.id];
                        if (next.length === 0) {
                          // 모두 해제 시 전체 반으로 복귀
                          setAt({ t: "class", id: "__all__" });
                        } else {
                          setAt({ t: "students", ids: next });
                        }
                      }
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "5px 10px", borderRadius: 8,
                      border: `1px solid ${isActive ? X.dk : inClass ? "#c7d2fe" : X.bdr}`,
                      background: isActive ? X.dk : inClass ? "#eef2ff" : "transparent",
                      color: isActive ? "#fff" : inClass ? "#4338ca" : X.mt,
                      fontSize: 13, fontWeight: isActive || inClass ? 600 : 400,
                      cursor: "pointer", fontFamily: F.b,
                      transition: "background-color .15s, border-color .15s, color .15s",
                    }}
                  >
                    {s.nm}
                    <span style={{
                      fontSize: 10, fontWeight: 500,
                      color: isActive ? "rgba(255,255,255,0.65)" : inClass ? "#818cf8" : X.mt,
                      background: isActive ? "rgba(255,255,255,0.15)" : inClass ? "#e0e7ff" : "#f1f5f9",
                      padding: "1px 5px", borderRadius: 4,
                    }}>
                      {cls?.nm}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Cd>
        <Cd style={{ marginBottom: 14, padding: 16 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: X.sub }}>난이도</span>
              <select style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${X.bdr}`, fontSize: 13, fontFamily: F.b }} value={lF || ""} onChange={e => setLF(e.target.value || null)}>
                <option value="">전체</option>{Object.keys(BANDS).map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: X.sub }}>주제</span>
              <select style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${X.bdr}`, fontSize: 13, fontFamily: F.b }} value={tF || ""} onChange={e => setTF(e.target.value || null)}>
                <option value="">전체</option>{tps.map(t => { const a = ARTS.find(x => x.tc === t); return <option key={t} value={t}>{a?.topic}</option>; })}
              </select>
            </div>
            <Bt v="outline" onClick={dAR}>🤖 자동 추천</Bt>
          </div>
        </Cd>
        {ar && (
          <Cd style={{ marginBottom: 14, border: `2px solid ${X.ac}`, background: X.abg, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: X.ac }}>📌 자동 추천 — 미출제 기사 우선</div>
            <div style={{ fontSize: 12, color: X.sub, marginBottom: 12, padding: "6px 10px", background: "rgba(37,99,235,.06)", borderRadius: 8, borderLeft: `3px solid ${X.ac}` }}>
              {lF || tF
                ? `선택한 ${lF ? `난이도(${lF})` : ""}${lF && tF ? " · " : ""}${tF ? `주제 조건` : ""}에 맞는 미배정 기사입니다.`
                : `현재 선택한 대상에게 아직 배정되지 않은 기사 중 가장 적합한 기사입니다.`
              }
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <img src={ar.img} style={{ width: 88, height: 60, objectFit: "cover", borderRadius: 10 }} alt="" />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: F.h, fontWeight: 700, fontSize: 15 }}>{ar.title}</div>
                <div style={{ fontSize: 12, color: X.sub }}>{ar.tkr}</div>
                <div style={{ marginTop: 6, display: "flex", gap: 6 }}><Bd b={BM[ar.seq]} /><Tp t={ar.topic} /></div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Bt v="success" onClick={() => dAs(ar.seq)}>배정 확인</Bt>
                <Bt v="ghost" onClick={() => setAr(null)}>취소</Bt>
              </div>
            </div>
          </Cd>
        )}
        <div style={{ display: "grid", gap: 10 }}>
          {fl.map(a => {
            const assigned = isAssigned(a.seq);
            return (
              <Cd key={a.seq} style={{ display: "flex", gap: 16, alignItems: "center", padding: 16 }}>
                <img src={a.img} style={{ width: 100, height: 68, objectFit: "cover", borderRadius: 10 }} alt="" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: F.h, fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: X.sub, marginBottom: 6 }}>{a.tkr} · {a.tp}</div>
                  <div style={{ display: "flex", gap: 6 }}><Bd b={BM[a.seq]} /><Tp t={a.topic} /></div>
                </div>
                {assigned
                  ? <Bt v="outline" onClick={() => revokeAsgn(a.seq)} style={{ color: X.gn, borderColor: "#a7f3d0", background: X.gbg }}>배정됨 ✓</Bt>
                  : <Bt v="primary" onClick={() => dAs(a.seq)}>배정</Bt>
                }
              </Cd>
            );
          })}
          {!fl.length && <Cd style={{ textAlign: "center", color: X.mt, padding: 40 }}>해당 조건의 기사가 없습니다.</Cd>}
        </div>
      </div>
    );
  };

  /* ─── TEACHER PROGRESS ─── */
  const TProg = () => {
    const STEP_LABELS = ["단어보기", "읽기", "단어퀴즈", "문장만들기", "녹음"];

    const clsWithSts = clsData.filter(cls => cls.sts.length > 0);

    const ClassCardHeader = ({ cls, band }) => (
      <div style={{ padding: "12px 18px", background: band.bg, borderBottom: `1px solid ${band.r}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: F.h, fontWeight: 800, fontSize: 15, color: band.c }}>{cls.nm}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: band.c, background: "rgba(255,255,255,0.7)", border: `1px solid ${band.r}`, borderRadius: 6, padding: "2px 7px", fontFamily: F.b }}>{(clsFreq[cls.id] || "주2회").replace("주", "주 ").replace("회", " 회")}</span>
        <span style={{ fontSize: 11, color: band.c, marginLeft: 2 }}>{cls.sts.length}명</span>
        <button onClick={e => { e.stopPropagation(); setAt({ t: "class", id: cls.id }); setAr(null); setAssignModal({ cls }); }} style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: X.dk, borderRadius: 20, padding: "3px 11px", border: "none", cursor: "pointer", fontFamily: F.b, marginLeft: "auto" }}>+ 기사 배정</button>
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <p style={{ fontSize: 13, color: X.sub, margin: 0 }}>이번 주에 발행된 콘텐츠의 학습 현황입니다.</p>

        {/* ── 요약 ── */}
        <div>
          <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 16, color: X.tx, marginBottom: 12 }}>요약</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
            {clsWithSts.map(cls => {
              const levelKey = cls.level || cls.nm.replace("반", "");
              const band = BANDS[levelKey] || { c: X.ac, bg: X.abg, r: "#bfdbfe" };
              const allSeqs = [...new Set(cls.sts.flatMap(st => (asgn[st.id] || []).map(a => a.seq)))];
              return (
                <Cd key={cls.id} className="card-hover" style={{ padding: 0, overflow: "hidden" }}>
                  <ClassCardHeader cls={cls} band={band} />
                  {allSeqs.length === 0 ? (
                    <div style={{ padding: "24px 18px", textAlign: "center" }}>
                      <p style={{ fontSize: 13, color: X.mt }}>배정된 과제 없음</p>
                    </div>
                  ) : (
                    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {allSeqs.map(seq => {
                        const art = ARTS.find(a => a.seq === seq);
                        const students = cls.sts
                          .filter(st => (asgn[st.id] || []).some(a => a.seq === seq))
                          .map(st => ({ st, done: iD(effProg, st.id, seq), arts: [{ seq }] }));
                        const doneCount = students.filter(x => x.done).length;
                        const total = students.length;
                        const allDone = doneCount === total && total > 0;
                        const bmLabel = BM[seq];
                        return (
                          <div key={seq}
                            onClick={() => setDetailModal({ cls, prevStudents: students, label: art?.title || seq, seq })}
                            style={{ padding: "10px 14px", borderRadius: 10, background: "#f8fafc", border: `1px solid ${X.bdr}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: X.tx, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>{art?.title || seq}</div>
                              {bmLabel && BANDS[bmLabel] && <div style={{ fontSize: 11, color: X.sub, fontWeight: 500 }}>{BANDS[bmLabel].min}L–{BANDS[bmLabel].max}L</div>}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              {allDone
                                ? <span style={{ fontSize: 11, fontWeight: 700, color: X.gn, background: X.gbg, borderRadius: 20, padding: "3px 10px" }}>✓ 전원완료</span>
                                : <span style={{ fontSize: 11, fontWeight: 700, color: X.sub, background: "#f1f5f9", borderRadius: 20, padding: "3px 10px" }}>{total - doneCount}명 진행중</span>
                              }
                              <span style={{ fontSize: 16, color: X.mt, lineHeight: 1 }}>›</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Cd>
              );
            })}
          </div>
        </div>

        {/* ── 상세 ── */}
        <div>
          <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 16, color: X.tx, marginBottom: 12 }}>상세</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {clsWithSts.map(cls => {
              const levelKey = cls.level || cls.nm.replace("반", "");
              const band = BANDS[levelKey] || { c: X.ac, bg: X.abg, r: "#bfdbfe" };
              const allSeqs = [...new Set(cls.sts.flatMap(st => (asgn[st.id] || []).map(a => a.seq)))];
              return (
                <Cd key={cls.id} style={{ padding: 0, overflow: "hidden" }}>
                  <ClassCardHeader cls={cls} band={band} />
                  {allSeqs.length === 0 ? (
                    <div style={{ padding: "24px", textAlign: "center" }}>
                      <p style={{ fontSize: 13, color: X.mt }}>배정된 과제 없음</p>
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
                        <colgroup>
                          <col style={{ width: 150 }} />
                          {allSeqs.map(seq => <col key={seq} style={{ width: 160 }} />)}
                        </colgroup>
                        <thead>
                          <tr style={{ background: "#f8fafc", height: 48 }}>
                            <th style={{ padding: "0 18px", textAlign: "left", fontWeight: 700, color: X.sub, fontSize: 12, borderBottom: `2px solid ${X.bdr}`, verticalAlign: "middle" }}>학생</th>
                            {allSeqs.map(seq => {
                              const art = ARTS.find(a => a.seq === seq);
                              const bmLabel = BM[seq];
                              return (
                                <th key={seq} style={{ padding: "0 16px", textAlign: "center", fontWeight: 700, color: X.tx, borderBottom: `2px solid ${X.bdr}`, borderLeft: `1px solid ${X.bdr}`, verticalAlign: "middle" }}>
                                  <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art?.title || seq}</div>
                                  {bmLabel && BANDS[bmLabel] && <div style={{ fontSize: 10, color: X.sub, fontWeight: 500, marginTop: 2 }}>{BANDS[bmLabel].min}L–{BANDS[bmLabel].max}L</div>}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {cls.sts.map((st, stIdx) => {
                            const stAsgn = (asgn[st.id] || []).map(a => a.seq);
                            return (
                              <tr key={st.id} style={{ borderBottom: `1px solid #f0f0f4`, background: stIdx % 2 === 0 ? "#fff" : "#fafbfc", height: 56 }}>
                                <td style={{ padding: "0 18px", verticalAlign: "middle", fontWeight: 600, color: X.tx }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ width: 28, height: 28, borderRadius: 8, background: band.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: band.c, fontWeight: 700, fontFamily: F.h, flexShrink: 0 }}>{st.nm[0]}</div>
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.nm}</span>
                                  </div>
                                </td>
                                {allSeqs.map(seq => {
                                  if (!stAsgn.includes(seq)) {
                                    return (
                                      <td key={seq} style={{ padding: "0 16px", textAlign: "center", verticalAlign: "middle", borderLeft: `1px solid ${X.bdr}` }}>
                                        <span style={{ color: X.bdr, fontSize: 16 }}>—</span>
                                      </td>
                                    );
                                  }
                                  const pg = gP(effProg, st.id, seq);
                                  const steps = [pg.wl, pg.r, pg.v, pg.sb, pg.w];
                                  const doneCnt = steps.filter(Boolean).length;
                                  const allDone = doneCnt === 5;
                                  return (
                                    <td key={seq} style={{ padding: "0 16px", textAlign: "center", verticalAlign: "middle", borderLeft: `1px solid ${X.bdr}`, cursor: "pointer" }}
                                      onClick={() => setArtProgModal({ st, cls, seq })}
                                      title={`${st.nm} · ${ARTS.find(a => a.seq === seq)?.title || seq}`}
                                    >
                                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                                        {allDone ? (
                                          <span style={{ width: 30, height: 30, borderRadius: "50%", background: X.gbg, color: X.gn, fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                                        ) : doneCnt > 0 ? (
                                          <span style={{ width: 30, height: 30, borderRadius: "50%", background: X.abg2, color: X.am, fontWeight: 800, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{doneCnt}/5</span>
                                        ) : (
                                          <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#f1f5f9", color: X.mt, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</span>
                                        )}
                                        <div style={{ display: "flex", gap: 2 }}>
                                          {steps.map((v, i) => (
                                            <div key={i} title={STEP_LABELS[i]} style={{ width: 7, height: 4, borderRadius: 2, background: v ? X.gn : "#e2e8f0" }} />
                                          ))}
                                        </div>
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Cd>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  /* ─── TEACHER STUDENTS ─── */
  const TStudents = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: X.sub }}>학생을 등록하고 반을 지정합니다.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setAddClsModal({ nm: "", level: "", freq: "주2회" })}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 10, border: `1px solid ${X.bdr}`, background: "#fff", color: X.tx, fontSize: 13, fontWeight: 700, fontFamily: F.b, cursor: "pointer" }}
          >+ 반 추가</button>
          <button
            onClick={openAddModal}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 10, border: "none", background: X.dk, color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: F.b, cursor: "pointer" }}
          >+ 학생 등록</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
        {clsData.map(cls => {
          const levelKey = cls.level || cls.nm.replace("반", "");
          const band = BANDS[levelKey] || { c: X.ac, bg: X.abg, r: "#bfdbfe" };
          const bColor = band.c;
          const bBg = band.bg;
          return (
            <Cd key={cls.id} style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "12px 16px", background: bBg, borderBottom: `1px solid ${X.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span style={{ fontFamily: F.h, fontWeight: 700, fontSize: 15, color: bColor, whiteSpace: "nowrap" }}>{cls.nm}</span>
                  {levelKey && BANDS[levelKey] && <span style={{ fontSize: 10, fontWeight: 700, color: bColor, background: "rgba(255,255,255,0.7)", border: `1px solid ${band.r}`, borderRadius: 20, padding: "1px 7px", whiteSpace: "nowrap" }}>{levelKey}</span>}
                  <span style={{ fontSize: 10, fontWeight: 600, color: bColor, background: "rgba(255,255,255,0.5)", borderRadius: 20, padding: "1px 7px", whiteSpace: "nowrap" }}>{clsFreq[cls.id] || "주2회"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, color: bColor, fontWeight: 600 }}>{cls.sts.length}명</span>
                  <button onClick={() => setClsSettingsModal({ cls, nm: cls.nm, level: cls.level || "", freq: clsFreq[cls.id] || "주2회" })}
                    style={{ border: "none", background: "rgba(255,255,255,0.6)", borderRadius: 8, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, color: bColor }}>⚙</button>
                </div>
              </div>
              {cls.sts.length === 0 ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <button
                    onClick={openAddModal}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 10, border: `1px dashed ${X.bdr}`, background: "#f8f9fa", color: X.sub, fontSize: 13, fontWeight: 700, fontFamily: F.b, cursor: "pointer" }}
                  >+ 학생 등록</button>
                </div>
              ) : (
                <div style={{ padding: "8px 0" }}>
                  {cls.sts.map(st => {
                    const stSeqs = (asgn[st.id] || []).map(a => a.seq);
                    const doneCnt = stSeqs.filter(seq => iD(effProg, st.id, seq)).length;
                    return (
                      <div
                        key={st.id}
                        onClick={() => setStudentDetailModal({ st, cls, artSeqs: stSeqs })}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid #f5f5f7`, cursor: "pointer" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 10, background: bBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: bColor, fontWeight: 700, fontFamily: F.h }}>
                            {st.nm[0]}
                          </div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 14, fontWeight: 600 }}>{st.nm}</span>
                              {st.id.startsWith("s_") && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#a855f7", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.03em" }}>NEW</span>}
                            </div>
                            {stSeqs.length > 0 ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                                <div style={{ display: "flex", gap: 3 }}>
                                  {stSeqs.map(seq => {
                                    const pg = gP(effProg, st.id, seq);
                                    const steps = [pg.wl, pg.r, pg.v, pg.sb, pg.w];
                                    const cnt = steps.filter(Boolean).length;
                                    const bg = cnt === 5 ? X.gn : cnt > 0 ? X.am : "#e2e8f0";
                                    return <div key={seq} style={{ width: 7, height: 7, borderRadius: "50%", background: bg }} />;
                                  })}
                                </div>
                                <span style={{ fontSize: 11, color: X.sub }}>
                                  {doneCnt === stSeqs.length
                                    ? <span style={{ color: X.gn, fontWeight: 700 }}>전체 완료</span>
                                    : <><span style={{ color: doneCnt > 0 ? X.am : X.mt, fontWeight: 600 }}>{doneCnt}/{stSeqs.length}</span> 완료</>
                                  }
                                </span>
                              </div>
                            ) : (
                              <span style={{ fontSize: 11, color: X.mt, marginTop: 2, display: "block" }}>배정 과제 없음</span>
                            )}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: X.mt, flexShrink: 0 }}>›</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Cd>
          );
        })}
      </div>
    </div>
  );

  /* ─── WEEKLY CALENDAR ─── */
  const WeekCalendar = ({ isMobile }) => {
    const now = new Date();
    const seoulMs = now.getTime() + (now.getTimezoneOffset() + 9 * 60) * 60000;
    const today = new Date(seoulMs);
    const todayDow = today.getDay();

    const monday = new Date(today);
    monday.setDate(today.getDate() - (todayDow === 0 ? 6 : todayDow - 1));
    monday.setHours(0, 0, 0, 0);

    const REF = new Date(2026, 0, 5);
    const weekIdx = Math.max(0, Math.round((monday - REF) / (7 * 24 * 60 * 60 * 1000)));

    const stCls = clsData.find(c => c.sts.some(s => s.id === sSt));
    const freq = stCls ? (clsFreq[stCls.id] || "주2회") : "주2회";
    const FREQ_SLOTS = { "주2회": [2, 4], "주3회": [1, 3, 5], "주5회": [1, 2, 3, 4, 5] };
    const slotDays = FREQ_SLOTS[freq] || [2, 4];
    const slotsPerWeek = slotDays.length;
    const DAY_KR = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

    const goToArt = (entry) => {
      if (!entry || !entry.art) return;
      setSArt(entry.seq);
      const p = entry.pg;
      const done = p.r && p.wl && p.v && p.sb && p.w;
      if (done) setSv("dn");
      else if (p.wl && p.r && p.v && p.sb && !p.w) setSv("rec");
      else if (p.wl && p.r && p.v && !p.sb) setSv("ssb");
      else if (p.wl && p.r && !p.v) { const _aw = W[entry.seq] || []; initVocOptions(_aw.filter(w => w.pid).slice(0, 4), _aw); setSv("voc"); }
      else if (p.wl && !p.r) setSv("rd");
      else setSv("wl");
      setVa({}); setWa({}); setVd(false); setWd(false);
    };

    const days = [1, 2, 3, 4, 5].map(dow => {
      const isSlot = slotDays.includes(dow);
      const slotPos = slotDays.indexOf(dow);
      const globalIdx = isSlot ? weekIdx * slotsPerWeek + slotPos : -1;
      const artIdx = (isSlot && sAs.length > 0) ? globalIdx % sAs.length : -1;
      const entry = artIdx >= 0 ? sAs[artIdx] : null;
      const date = new Date(monday);
      date.setDate(monday.getDate() + (dow - 1));
      const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      return { dow, isSlot, entry, date, isToday: dateKey === todayKey, isPast: date < new Date(today.getFullYear(), today.getMonth(), today.getDate()) };
    });

    const headerRow = (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: F.h, fontWeight: 700, fontSize: 16, color: X.tx }}>이번 주 일정</span>
        <span style={{ fontSize: 11, color: X.sub, fontWeight: 600, background: "#f1f5f9", border: `1px solid ${X.bdr}`, borderRadius: 20, padding: "2px 8px" }}>{freq}</span>
      </div>
    );

    /* ── 모바일: 세로 리스트 ── */
    if (isMobile) {
      return (
        <div style={{ marginBottom: 8 }}>
          {headerRow}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {days.map(({ dow, isSlot, entry, date, isToday, isPast }) => {
              const art = entry?.art;
              const pg = entry?.pg;
              const done = pg ? !!(pg.r && pg.wl && pg.v && pg.sb && pg.w) : false;
              const stepVals = pg ? [pg.wl, pg.r, pg.v, pg.sb, pg.w] : [];
              const stepDone = stepVals.filter(Boolean).length;

              return (
                <div key={dow}
                  onClick={() => goToArt(entry)}
                  style={{
                    display: "flex", alignItems: "stretch", borderRadius: 14, overflow: "hidden",
                    border: isToday ? `2px solid ${X.ac}` : `1px solid ${X.bdr}`,
                    background: "#fff",
                    opacity: !isSlot ? 0.35 : 1,
                    cursor: entry ? "pointer" : "default",
                    minHeight: 72,
                  }}
                >
                  {/* 요일/날짜 뱃지 */}
                  <div style={{
                    width: 58, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    background: isToday ? X.abg : "#fafafa",
                    borderRight: `1px solid ${X.bdr}`, gap: 2,
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: isToday ? X.ac : X.sub, fontFamily: F.h }}>{DAY_KR[dow]}</span>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", fontSize: 13, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isToday ? X.ac : "transparent",
                      color: isToday ? "#fff" : X.tx,
                    }}>{date.getDate()}</div>
                  </div>

                  {/* 기사 썸네일 */}
                  {art && (
                    <div style={{ width: 80, flexShrink: 0, position: "relative", overflow: "hidden" }}>
                      <img src={art.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      {done && (
                        <div style={{ position: "absolute", inset: 0, background: "rgba(16,185,129,0.7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#fff" }}>✓</div>
                      )}
                    </div>
                  )}

                  {/* 기사 정보 */}
                  <div style={{ flex: 1, minWidth: 0, padding: "10px 12px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                    {art ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {isToday && !done && <span style={{ fontSize: 10, fontWeight: 800, color: X.ac, background: X.abg, borderRadius: 6, padding: "1px 6px", flexShrink: 0 }}>오늘!</span>}
                          <span style={{ fontSize: 13, fontWeight: 700, color: isPast && !done ? X.mt : X.tx, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{art.title}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ display: "flex", gap: 2, flex: 1 }}>
                            {stepVals.map((v, i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: v ? X.gn : X.bdr }} />)}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: done ? X.gn : stepDone > 0 ? X.am : X.mt, flexShrink: 0 }}>
                            {done ? "완료" : `${stepDone}/5`}
                          </span>
                        </div>
                      </>
                    ) : isSlot ? (
                      <span style={{ fontSize: 13, color: X.mt }}>과제 없음</span>
                    ) : (
                      <span style={{ fontSize: 13, color: "#d0d5dd" }}>수업 없음</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    /* ── 데스크톱: 5열 카드 그리드 ── */
    return (
      <div style={{ marginBottom: 8 }}>
        {headerRow}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {days.map(({ dow, isSlot, entry, date, isToday, isPast }) => {
            const art = entry?.art;
            const pg = entry?.pg;
            const done = pg ? !!(pg.r && pg.wl && pg.v && pg.sb && pg.w) : false;
            return (
              <div key={dow}
                onClick={() => goToArt(entry)}
                style={{
                  borderRadius: 14, border: isToday ? `2px solid ${X.ac}` : `1px solid ${X.bdr}`,
                  background: "#fff", overflow: "hidden", display: "flex", flexDirection: "column",
                  cursor: entry ? "pointer" : "default", opacity: !isSlot ? 0.32 : 1,
                  transition: "box-shadow .15s, transform .15s",
                }}
                onMouseEnter={e => { if (entry) { e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,.10)"; e.currentTarget.style.transform = "translateY(-2px)"; }}}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = ""; e.currentTarget.style.transform = ""; }}
              >
                <div style={{ padding: "8px 10px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", background: isToday ? X.abg : "#fafafa", borderBottom: `1px solid ${X.bdr}` }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isToday ? X.ac : X.sub }}>{DAY_KR[dow]}</span>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: isToday ? X.ac : "transparent", color: isToday ? "#fff" : X.tx, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {date.getDate()}
                  </div>
                </div>
                {art ? (
                  <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                    <div style={{ position: "relative", width: "100%", paddingTop: "75%" }}>
                      <img src={art.img} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                      {done && <div style={{ position: "absolute", inset: 0, background: "rgba(16,185,129,0.72)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, color: "#fff" }}>✓</div>}
                      {isToday && !done && <div style={{ position: "absolute", top: 6, right: 6, background: X.ac, color: "#fff", fontSize: 9, fontWeight: 800, borderRadius: 8, padding: "2px 7px" }}>오늘!</div>}
                    </div>
                    <div style={{ padding: "8px 10px 10px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isPast && !done ? X.mt : X.tx, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{art.title}</div>
                      <div style={{ display: "flex", gap: 2, marginTop: 6 }}>
                        {[pg.wl, pg.r, pg.v, pg.sb, pg.w].map((v, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: v ? X.gn : X.bdr }} />)}
                      </div>
                    </div>
                  </div>
                ) : isSlot ? (
                  <div style={{ padding: "24px 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 11, color: X.mt }}>과제 없음</span>
                  </div>
                ) : (
                  <div style={{ padding: "24px 10px" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ─── STUDENT TASKS ─── */
  const STasks = () => {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 600);
    useEffect(() => {
      const mq = window.matchMedia("(max-width:600px)");
      const handler = e => setIsMobile(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }, []);

    return (
      <div className="fade-up">
        {/* 헤더 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 10 : 0 }}>
            <div>
              <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: isMobile ? 20 : 24 }}>나의 과제</h2>
              <p style={{ fontSize: 13, color: X.sub, marginTop: 4 }}>선생님이 배정한 기사를 순서대로 학습하세요.</p>
            </div>
            <select
              style={{ padding: "7px 12px", borderRadius: 10, border: `1px solid ${X.bdr}`, fontSize: 13, fontFamily: F.b, color: X.tx, background: "#fff", width: isMobile ? "100%" : "auto" }}
              value={sSt} onChange={e => { setSSt(e.target.value); setSArt(null); setSv("tasks"); }}
            >
              {dynALL.map(s => <option key={s.id} value={s.id}>{s.nm} ({s.cNm})</option>)}
            </select>
          </div>
        </div>
        <WeekCalendar isMobile={isMobile} />
        {!sAs.length && (
          <Cd style={{ textAlign: "center", padding: 48, color: X.mt }}>배정된 과제가 없습니다.</Cd>
        )}
      </div>
    );
  };

  /* ─── STUDENT READING HERO (full-width, rendered outside container) ─── */
  const SReadHero = () => {
    if (!cA) return null;
    return (
      <div style={{ position: "relative", width: "100%", height: 320, overflow: "hidden" }}>
        {/* 블러 배경 이미지 */}
        <img src={cA.img} alt="" style={{ position: "absolute", inset: -20, width: "calc(100% + 40px)", height: "calc(100% + 40px)", objectFit: "cover", filter: "blur(22px) saturate(0.75) brightness(0.58)", transform: "scale(1.1)" }} />
        {/* 그라디언트 오버레이 */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.22) 55%, #f5f6fa 100%)" }} />
        {/* back button — top-left */}
        <button
          onClick={e => { e.stopPropagation(); bk(); }}
          style={{ position: "absolute", top: 16, left: 20, zIndex: 10, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.18)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 100, color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: F.b, padding: "7px 16px", cursor: "pointer" }}
        >
          ← 과제 목록
        </button>
        {/* 중앙 이미지 — margin: 28px auto 로 위아래 여백 확보 */}
        <img
          src={cA.img}
          alt={cA.title}
          style={{ position: "absolute", zIndex: 1, top: 28, bottom: 28, left: "50%", transform: "translateX(-50%)", height: "calc(100% - 56px)", width: "auto", maxWidth: "60%", objectFit: "contain", borderRadius: 10, filter: "drop-shadow(0 6px 28px rgba(0,0,0,0.32))" }}
        />
      </div>
    );
  };

  /* ─── STUDENT READING (header + body only, hero is hoisted) ─── */
  const SRead = () => {
    if (!cA) return null;
    const pidW = cW.filter(w => w.pid);
    const noP = cW.filter(w => !w.pid);

    return (
      <div onClick={() => setPw(null)}>

        {/* ── Article header ── */}
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 24px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: "3px 10px", borderRadius: 20, background: X.abg, color: X.ac }}>{cA.tp}</span>
            <span style={{ fontSize: 12, color: X.sub }}>{cA.topic}</span>
            {BM[cA.seq] && <span style={{ marginLeft: "auto" }}><Bd b={BM[cA.seq]} /></span>}
          </div>
          <h1 style={{ fontFamily: F.h, fontWeight: 800, fontSize: "clamp(22px,3.5vw,32px)", letterSpacing: -0.5, lineHeight: 1.2, color: X.tx, marginBottom: 6 }}>{cA.title}</h1>
          <div style={{ fontSize: 16, color: X.sub, marginBottom: 20 }}>{cA.tkr}</div>
          <div className="ntc-read-controls">
            <Bt v="outline" onClick={e => { e.stopPropagation(); setKr(!kr); }}>{kr ? "🇰🇷 번역 숨기기" : "🇰🇷 번역 보기"}</Bt>
            <Bt v="outline"
              onClick={e => {
                e.stopPropagation();
                if (!cA.mp3 || cA.mp3 === "#") return;
                if (artPlaying) {
                  artAudioRef.current?.pause();
                  artAudioRef.current = null;
                  setArtPlaying(false);
                  setArticlePlayingSentenceKey(null);
                } else {
                  if (sentenceSourceRef.current) {
                    sentenceSourceRef.current.stop();
                    sentenceSourceRef.current.disconnect();
                    sentenceSourceRef.current = null;
                    setSentencePlayingKey(null);
                  }
                  const a = new Audio(cA.mp3);
                  a.playbackRate = playbackRate;
                  artAudioRef.current = a;
                  setArtPlaying(true);
                  syncArticleHighlightByTime(a);
                  a.ontimeupdate = () => { syncArticleHighlightByTime(a); };
                  a.play();
                  a.onended = () => { artAudioRef.current = null; setArtPlaying(false); setArticlePlayingSentenceKey(null); };
                }
              }}
              style={{ opacity: artPlaying ? 0.6 : 1, transition: "opacity .2s" }}
            >
              {artPlaying ? "⏸ 재생중..." : "🔊 듣기"}
            </Bt>
            <div className="ntc-speed-row">
              {PLAYBACK_RATES.map((rate) => {
                const active = playbackRate === rate;
                return (
                  <button
                    key={rate}
                    onClick={(e) => { e.stopPropagation(); setPlaybackRate(rate); }}
                    style={{
                      border: active ? "1px solid #2563eb" : `1px solid ${X.bdr}`,
                      background: active ? "#eff6ff" : "#fff",
                      color: active ? "#1d4ed8" : X.sub,
                      borderRadius: 8,
                      padding: "6px 8px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      lineHeight: 1,
                    }}
                    title={`재생속도 ${rate.toFixed(2).replace(".00", ".0")}배`}
                  >
                    {rate.toFixed(2).replace(".00", ".0")}x
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 24px 40px" }}>
          {cA.ps.map(pa => {
            const pw2 = pidW.filter(w => w.pid === pa.pid);
            const segs = hl(pa.en, pw2);
            const sentenceRanges = sentenceMeta.byPid[pa.pid] || [];
            const isH = pa.en.length < 50 && !pa.en.includes(".");
            let cursor = 0;
            return (
              <div key={pa.pid} style={{ marginBottom: isH ? 8 : 24 }}>
                <p style={{ fontSize: isH ? 18 : 17, fontWeight: isH ? 700 : 400, fontFamily: isH ? F.h : F.b, lineHeight: isH ? 1.4 : 1.95, color: isH ? X.tx : "#374151", marginTop: isH ? 28 : 0 }}>
                  {segs.map((seg, i) => {
                    if (seg.t !== "w") {
                      const segStart = cursor;
                      const segEnd = cursor + seg.c.length;
                      cursor = segEnd;
                      const chunks = [];
                      let pos = segStart;
                      let localKey = 0;
                      const intersects = sentenceRanges.filter(r => r.end > segStart && r.start < segEnd);

                      if (!intersects.length) return <span key={i}>{seg.c}</span>;

                      intersects.forEach((r) => {
                        if (r.start > pos) {
                          const plain = pa.en.slice(pos, r.start);
                          if (plain) chunks.push(<span key={`${i}_p_${localKey++}`}>{plain}</span>);
                        }
                        const hitStart = Math.max(pos, r.start);
                        const hitEnd = Math.min(segEnd, r.end);
                        if (hitEnd > hitStart) {
                          const txt = pa.en.slice(hitStart, hitEnd);
                          const active = sentencePlayingKey === r.key || articlePlayingSentenceKey === r.key;
                          chunks.push(
                            <span
                              key={`${i}_s_${r.key}_${localKey++}`}
                              onClick={e => { e.stopPropagation(); playSentenceByKey(r.key); }}
                              title="문장 듣기"
                              style={{
                                cursor: "pointer",
                                borderRadius: 4,
                                background: active ? "#dcfce7" : "transparent",
                                boxShadow: active ? "inset 0 -1px 0 #22c55e" : "none",
                                transition: "background .15s, box-shadow .15s",
                              }}
                            >
                              {txt}
                            </span>
                          );
                        }
                        pos = hitEnd;
                      });

                      if (pos < segEnd) {
                        const tail = pa.en.slice(pos, segEnd);
                        if (tail) chunks.push(<span key={`${i}_t_${localKey++}`}>{tail}</span>);
                      }
                      return <span key={i}>{chunks}</span>;
                    }
                    cursor += seg.c.length;
                    const isOpen = pw === seg.w.i;
                    return (
                      <span key={i} style={{ display: "inline-block", position: "relative" }}>
                        <span
                          style={{ background: isOpen ? "#bfdbfe" : "#dbeafe", borderRadius: 4, padding: "1px 3px", cursor: "pointer", borderBottom: `1px solid ${isOpen ? "#2563eb" : "#93c5fd"}`, transition: "background .15s" }}
                          onClick={e => { e.stopPropagation(); setPw(isOpen ? null : seg.w.i); }}
                        >
                          {seg.c}
                        </span>
                        {isOpen && (
                          <span
                            onClick={e => e.stopPropagation()}
                            style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20, display: "block", background: "#fff", border: `1px solid ${X.bdr}`, borderRadius: 12, padding: "12px 16px", boxShadow: "0 8px 24px rgba(0,0,0,.12)", minWidth: 190, whiteSpace: "nowrap" }}
                          >
                            <div style={{ fontFamily: F.h, fontWeight: 700, fontSize: 16, marginBottom: 3, color: X.tx }}>{seg.w.en}</div>
                            <div style={{ fontSize: 13, color: X.sub, marginBottom: 10 }}>{seg.w.kr}</div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <Bt v="outline" style={{ fontSize: 11, padding: "3px 8px" }}
                                onClick={e => { e.stopPropagation(); playWordAudio(cA.seq, seg.w.mp3); }}>
                                🔊 발음
                              </Bt>
                              <Bt v="ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setPw(null)}>닫기</Bt>
                            </div>
                          </span>
                        )}
                      </span>
                    );
                  })}
                </p>
                {kr && pa.kr && (
                  <p style={{ fontSize: 13, color: X.sub, lineHeight: 1.75, marginTop: 6, paddingLeft: 14, borderLeft: `3px solid ${X.bdr}` }}>{pa.kr}</p>
                )}
              </div>
            );
          })}

          {noP.length > 0 && (
            <div style={{ marginTop: 32, padding: "16px 20px", background: "#f8fafc", borderRadius: 12, border: `1px solid ${X.bdr}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: X.sub, letterSpacing: .5, marginBottom: 10 }}>추가 단어</div>
              {noP.map((w, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderBottom: i < noP.length - 1 ? `1px solid ${X.bdr}` : "none" }}>
                  <span style={{ fontWeight: 600, color: X.tx }}>{w.en}</span>
                  <span style={{ color: X.sub }}>{w.kr}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 36, textAlign: "center" }}>
            <Bt v="success" size="lg" onClick={e => { e.stopPropagation(); cR(); }}>읽기 완료 → 단어퀴즈</Bt>
          </div>
        </div>
      </div>
    );
  };

  /* ─── STUDENT WORD LIST (단어보기 — 플래시카드) ─── */
  const SWl = () => {
    if (!cA) return null;
    const words = cW.filter((w) => w.pid).sort((a, b) => Number(a.i) - Number(b.i));
    if (words.length === 0) return (
      <div>
        <Bt v="ghost" onClick={bk} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
        <Cd style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", padding: 40 }}>
          <p style={{ color: X.mt, fontSize: 13 }}>표시할 단어가 없습니다.</p>
        </Cd>
      </div>
    );
    const idx = Math.min(wlIdx, words.length - 1);
    const w = words[idx];
    const isLast = idx === words.length - 1;
    const isFirst = idx === 0;
    return (
      <div>
        <Bt v="ghost" onClick={bk} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 20 }}>단어 보기</h2>
            <span style={{ fontSize: 13, color: X.sub, fontWeight: 600 }}>{idx + 1} / {words.length}</span>
          </div>

          {/* 진행 바 */}
          <div style={{ height: 4, borderRadius: 2, background: X.bdr, marginBottom: 28, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: X.ac, width: `${((idx + 1) / words.length) * 100}%`, transition: "width .3s" }} />
          </div>

          {/* 카드 + 화살표 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* 이전 화살표 */}
            <button
              onClick={() => setWlIdx(i => Math.max(0, i - 1))}
              disabled={isFirst}
              style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, border: `1px solid ${X.bdr}`, background: isFirst ? "#f8f9fa" : "#fff", color: isFirst ? X.mt : X.tx, fontSize: 20, cursor: isFirst ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}
            >‹</button>

            {/* 플래시카드 */}
            <div style={{ flex: 1, borderRadius: 20, border: `1px solid ${X.bdr}`, background: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,.07)", padding: "40px 32px", textAlign: "center", minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
              <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 32, color: X.tx, letterSpacing: "-0.5px" }}>{w.en}</div>
              <div style={{ width: 40, height: 2, borderRadius: 1, background: X.bdr }} />
              {wlRevealIdx === idx ? (
                <div style={{ fontSize: 18, color: X.sub, fontWeight: 500 }}>{w.kr}</div>
              ) : (
                <button
                  type="button"
                  onClick={() => setWlRevealIdx(idx)}
                  style={{ padding: "8px 20px", borderRadius: 20, border: `1px solid ${X.ac}`, background: X.abg, color: X.ac, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: F.b }}
                >
                  뜻 보기
                </button>
              )}
              {w.mp3 && (
                <button
                  type="button"
                  onClick={() => playWordAudio(cA.seq, w.mp3)}
                  style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 20, border: `1px solid ${X.bdr}`, background: "#f8f9fa", cursor: "pointer", fontSize: 13, color: X.sub, fontFamily: F.b }}
                >
                  🔊 발음 듣기
                </button>
              )}
            </div>

            {/* 다음 화살표 */}
            <button
              onClick={() => setWlIdx(i => Math.min(words.length - 1, i + 1))}
              disabled={isLast}
              style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, border: `1px solid ${X.bdr}`, background: isLast ? "#f8f9fa" : "#fff", color: isLast ? X.mt : X.tx, fontSize: 20, cursor: isLast ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}
            >›</button>
          </div>

          {/* 하단 점 내비게이션 */}
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 20 }}>
            {words.map((_, i) => (
              <button
                key={i}
                onClick={() => setWlIdx(i)}
                style={{ width: i === idx ? 20 : 8, height: 8, borderRadius: 4, border: "none", background: i === idx ? X.ac : X.bdr, cursor: "pointer", padding: 0, transition: "all .25s" }}
              />
            ))}
          </div>

          {/* 마지막 카드에서만 완료 버튼 노출 */}
          {isLast && (
            <div style={{ marginTop: 28, textAlign: "center" }}>
              <Bt v="success" size="lg" onClick={goWlToRd}>단어 확인 완료 → 읽기</Bt>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ─── STUDENT VOCAB ─── */
  const SVoc = () => {
    if (!cA) return null;
    const ws = cW.filter(w => w.pid).slice(0, 4);
    const isLast = vocIdx >= ws.length - 1;

    /* 전체 결과 요약 화면 */
    if (vd) {
      const cor = ws.filter(w => va[w.i] === w.kr).length;
      return (
        <div>
          <Bt v="ghost" onClick={bk} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            <div style={{ textAlign: "center", padding: "32px 24px", marginBottom: 20, borderRadius: 20, background: "#fff", border: `1px solid ${X.bdr}`, boxShadow: "0 4px 24px rgba(0,0,0,.07)" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{cor === ws.length ? "🎉" : cor >= ws.length * 0.8 ? "👍" : "📚"}</div>
              <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 32, color: cor === ws.length ? X.gn : X.am, marginBottom: 4 }}>{cor} / {ws.length}</div>
              <div style={{ fontSize: 14, color: X.sub }}>정답</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {ws.map((w, i) => {
                const ans = va[w.i]; const ok = ans === w.kr;
                return (
                  <div key={w.i} style={{ padding: "14px 16px", borderRadius: 12, background: ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${ok ? "#a7f3d0" : "#fecaca"}`, display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: ok ? X.gn : X.rd, flexShrink: 0 }}>{ok ? "✓" : "✗"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{i + 1}. {w.en}</div>
                      {!ok && <div style={{ fontSize: 12, color: X.sub, marginTop: 2 }}>내 답: <span style={{ color: X.rd }}>{ans || "미선택"}</span> / 정답: <span style={{ color: X.gn, fontWeight: 600 }}>{w.kr}</span></div>}
                    </div>
                    {w.mp3 && <button onClick={() => playWordAudio(cA.seq, w.mp3)} style={{ border: `1px solid ${X.bdr}`, background: "#fff", borderRadius: 7, width: 28, height: 28, cursor: "pointer", fontSize: 13 }}>🔊</button>}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <Bt v="outline" size="lg" onClick={() => { setVd(false); setVa({}); setVchecked({}); setVocIdx(0); }}>다시 풀어보기</Bt>
              <Bt v="success" size="lg" onClick={cV}>문장만들기 →</Bt>
            </div>
          </div>
        </div>
      );
    }

    /* 문제별 퀴즈 화면 */
    const w = ws[vocIdx];
    const opts = (() => {
      if (!w) return [];
      const cached = vo[w.i];
      if (cached && cached.length >= 2) return cached;
      // vo 미초기화 시 즉석 생성 — 기사 전체 단어를 보기 풀로 사용
      const distractors = cW
        .filter(pw => pw.kr !== w.kr)
        .sort(() => Math.random() - 0.5)
        .slice(0, 2)
        .map(pw => pw.kr);
      return [w.kr, ...distractors].sort(() => Math.random() - 0.5);
    })();
    const sel = w ? va[w.i] : null;
    const isChecked = w ? !!vchecked[w.i] : false;
    const isCorrect = isChecked && sel === w?.kr;

    const optStyle = (o) => {
      if (!isChecked) {
        const picked = sel === o;
        return {
          border: `2px solid ${picked ? X.ac : X.bdr}`,
          background: picked ? X.abg : "#fff",
          color: picked ? X.ac : X.tx,
          fontWeight: picked ? 700 : 400,
          cursor: "pointer",
        };
      }
      if (o === w.kr) return { border: `2px solid ${X.gn}`, background: "#f0fdf4", color: X.gn, fontWeight: 700, cursor: "default" };
      if (o === sel && sel !== w.kr) return { border: `2px solid ${X.rd}`, background: "#fef2f2", color: X.rd, fontWeight: 700, cursor: "default" };
      return { border: `2px solid ${X.bdr}`, background: "#fafbfd", color: X.mt, fontWeight: 400, cursor: "default" };
    };

    const goNext = () => {
      if (isLast) setVd(true);
      else setVocIdx(i => i + 1);
    };

    return (
      <div>
        <Bt v="ghost" onClick={bk} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          {/* 헤더 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 20 }}>단어 퀴즈</h2>
            <span style={{ fontSize: 13, color: X.sub, fontWeight: 600 }}>{vocIdx + 1} / {ws.length}</span>
          </div>

          {/* 프로그래스바 */}
          <div style={{ display: "flex", gap: 4, marginBottom: 28 }}>
            {ws.map((ww, i) => {
              const checked = !!vchecked[ww.i];
              const correct = checked && va[ww.i] === ww.kr;
              const isCur = i === vocIdx;
              const bg = isCur ? X.ac : checked ? (correct ? X.gn : X.rd) : va[ww.i] ? "#a7f3d0" : "#f1f5f9";
              return (
                <button key={i} onClick={() => setVocIdx(i)}
                  style={{ flex: 1, height: 8, borderRadius: 4, border: "none", background: bg, cursor: "pointer", padding: 0, transition: "background .2s" }} />
              );
            })}
          </div>

          {/* 문제 카드 */}
          {w && (
            <div style={{ background: "#fff", borderRadius: 20, border: `1px solid ${X.bdr}`, boxShadow: "0 4px 24px rgba(0,0,0,.07)", padding: "32px 28px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, justifyContent: "center" }}>
                <span style={{ fontFamily: F.h, fontWeight: 800, fontSize: 28, color: X.tx }}>{w.en}</span>
                {w.mp3 && (
                  <button onClick={() => playWordAudio(cA.seq, w.mp3)}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: `1px solid ${X.bdr}`, background: "#f8f9fa", cursor: "pointer", fontSize: 15, flexShrink: 0 }}>
                    🔊
                  </button>
                )}
              </div>
              <p style={{ fontSize: 13, color: X.sub, textAlign: "center", marginBottom: 20 }}>알맞은 뜻을 선택하세요.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {opts.map((o, oi) => {
                  const st = optStyle(o);
                  const picked = sel === o;
                  const isAns = o === w.kr;
                  return (
                    <button key={oi}
                      onClick={() => { if (!isChecked) setVa(p => ({ ...p, [w.i]: o })); }}
                      style={{ padding: "14px 20px", borderRadius: 12, fontFamily: F.b, fontSize: 15, textAlign: "left", display: "flex", alignItems: "center", gap: 10, transition: "all .15s", ...st }}>
                      <span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${st.border.split(" ")[2]}`, background: (isChecked && isAns) ? X.gn : (isChecked && picked && !isAns) ? X.rd : picked ? X.ac : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 11, color: "#fff", fontWeight: 700 }}>
                        {isChecked ? (isAns ? "✓" : (picked ? "✗" : String.fromCharCode(65 + oi))) : (picked ? "✓" : String.fromCharCode(65 + oi))}
                      </span>
                      {o}
                    </button>
                  );
                })}
              </div>

              {/* 채점 결과 피드백 */}
              {isChecked && (
                <div style={{ marginTop: 20, padding: "12px 16px", borderRadius: 10, background: isCorrect ? "#f0fdf4" : "#fef2f2", border: `1px solid ${isCorrect ? "#a7f3d0" : "#fecaca"}`, textAlign: "center" }}>
                  <span style={{ fontWeight: 700, color: isCorrect ? X.gn : X.rd, fontSize: 15 }}>
                    {isCorrect ? "🎉 정답!" : `❌ 틀렸어요 — 정답: ${w.kr}`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 하단 버튼 */}
          {!isChecked ? (
            <div style={{ display: "flex", gap: 10 }}>
              {vocIdx > 0 && (
                <button onClick={() => setVocIdx(i => i - 1)}
                  style={{ padding: "12px 18px", borderRadius: 10, border: `1px solid ${X.bdr}`, background: "#fff", fontSize: 14, fontWeight: 600, fontFamily: F.b, cursor: "pointer", color: X.sub }}>
                  ← 이전
                </button>
              )}
              <button onClick={() => { if (sel) setVchecked(p => ({ ...p, [w.i]: true })); }}
                disabled={!sel}
                style={{ flex: 1, padding: "13px", borderRadius: 10, border: "none", background: sel ? X.ac : "#e2e8f0", color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: F.b, cursor: sel ? "pointer" : "default", transition: "all .2s" }}>
                정답 확인
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setVa(p => { const n = { ...p }; delete n[w.i]; return n; }); setVchecked(p => { const n = { ...p }; delete n[w.i]; return n; }); }}
                style={{ flex: 1, padding: "13px", borderRadius: 10, border: `1px solid ${X.bdr}`, background: "#fff", fontSize: 14, fontWeight: 600, fontFamily: F.b, cursor: "pointer", color: X.sub }}>
                🔄 다시 풀어보기
              </button>
              <button onClick={goNext}
                style={{ flex: 1, padding: "13px", borderRadius: 10, border: "none", background: X.dk, color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: F.b, cursor: "pointer" }}>
                {isLast ? "결과 보기 →" : "다음 문제 →"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ─── STUDENT WORKBOOK ─── */
  const SWB = () => {
    if (!cA) return null;
    const rA = (act, ai) => {
      if (act.t === "wc" || act.t === "mc") {
        return (
          <div key={ai} style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: F.h, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{act.title}</h3>
            {act.qs.map(q => {
              const k = `${ai}_${q.id}`; const sel = wa[k]; const opts = act.t === "wc" ? q.o.map(o => [o, o]) : Object.entries(q.o); const ok = wd && sel === q.a; const bad = wd && sel && sel !== q.a;
              return (
                <div key={q.id} style={{ marginBottom: 10, padding: 14, background: wd ? (ok ? "#f0fdf4" : bad ? "#fef2f2" : "#fafbfd") : "#fafbfd", borderRadius: 10, border: `1px solid ${wd ? (ok ? "#a7f3d0" : bad ? "#fecaca" : X.bdr) : X.bdr}` }}>
                  <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 14 }}>{q.p}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {opts.map(([v, l]) => <Bt key={v} v={sel === v ? "primary" : "outline"} disabled={wd} style={{ border: wd && v === q.a ? `2px solid ${X.gn}` : undefined }} onClick={() => setWa(p => ({ ...p, [k]: v }))}>{l}</Bt>)}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      if (act.t === "tf") {
        return (
          <div key={ai} style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: F.h, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{act.title}</h3>
            {act.qs.map(q => {
              const k = `${ai}_${q.id}`; const sel = wa[k]; const ok = wd && sel === q.a; const bad = wd && sel && sel !== q.a;
              return (
                <div key={q.id} style={{ marginBottom: 10, padding: 14, background: wd ? (ok ? "#f0fdf4" : bad ? "#fef2f2" : "#fafbfd") : "#fafbfd", borderRadius: 10, border: `1px solid ${wd ? (ok ? "#a7f3d0" : bad ? "#fecaca" : X.bdr) : X.bdr}` }}>
                  <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 14 }}>{q.p}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["T", "F"].map(v => <Bt key={v} v={sel === v ? "primary" : "outline"} disabled={wd} style={{ border: wd && v === q.a ? `2px solid ${X.gn}` : undefined }} onClick={() => setWa(p => ({ ...p, [k]: v }))}>{v === "T" ? "True" : "False"}</Bt>)}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      if (act.t === "us") {
        return (
          <div key={ai} style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: F.h, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{act.title}</h3>
            {act.qs.map(q => {
              const k = `${ai}_${q.id}`; const val = wa[k] || ""; const ok = wd && val.toLowerCase().trim() === q.a.toLowerCase(); const bad = wd && val && !ok;
              return (
                <div key={q.id} style={{ marginBottom: 10, padding: 14, background: wd ? (ok ? "#f0fdf4" : bad ? "#fef2f2" : "#fafbfd") : "#fafbfd", borderRadius: 10, border: `1px solid ${wd ? (ok ? "#a7f3d0" : bad ? "#fecaca" : X.bdr) : X.bdr}` }}>
                  <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 14 }}>글자: <span style={{ fontFamily: "monospace", letterSpacing: 4, color: X.ac }}>{q.j}</span></div>
                  <input type="text" value={val} disabled={wd} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${ok ? X.gn : bad ? X.rd : X.bdr}`, fontSize: 14, fontFamily: F.b, width: 220 }} onChange={e => setWa(p => ({ ...p, [k]: e.target.value }))} placeholder="정답 입력..." />
                  {wd && bad && <span style={{ fontSize: 12, color: X.gn, marginLeft: 8 }}>정답: {q.a}</span>}
                </div>
              );
            })}
          </div>
        );
      }
      if (act.t === "mt") {
        return (
          <div key={ai} style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: F.h, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{act.title}</h3>
            {act.left.map((l, li) => {
              const k = `${ai}_m_${li + 1}`; const sel = wa[k]; const ca = act.ans[String(li + 1)]; const ok = wd && sel === ca; const bad = wd && sel && sel !== ca;
              return (
                <div key={li} style={{ marginBottom: 10, padding: 14, background: wd ? (ok ? "#f0fdf4" : bad ? "#fef2f2" : "#fafbfd") : "#fafbfd", borderRadius: 10, border: `1px solid ${wd ? (ok ? "#a7f3d0" : bad ? "#fecaca" : X.bdr) : X.bdr}` }}>
                  <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 14 }}>{l} ...</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Object.entries(act.right).map(([kk, vv]) => <Bt key={kk} v={sel === kk ? "primary" : "outline"} disabled={wd} style={{ fontSize: 12, border: wd && kk === ca ? `2px solid ${X.gn}` : undefined }} onClick={() => setWa(p => ({ ...p, [k]: kk }))}>{kk}) {vv.substring(0, 35)}</Bt>)}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      return (
        <div key={ai} style={{ marginBottom: 20, padding: 16, background: "#fafbfd", borderRadius: 10, border: `1px dashed ${X.bdr}` }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: X.sub, marginBottom: 8 }}>📝 {act.title}</h3>
          <div style={{ fontSize: 11, color: X.mt }}>이 활동은 선생님과 함께 진행합니다.</div>
        </div>
      );
    };
    return (
      <div>
        <Bt v="ghost" onClick={bk} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
        <Cd style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 20, marginBottom: 4 }}>문제풀이</h2>
          <p style={{ fontSize: 13, color: X.sub, marginBottom: 24 }}>{cA.title}</p>
          {cWB.map((a, i) => rA(a, i))}
          <div style={{ textAlign: "center", marginTop: 20 }}>
            {!wd
              ? <Bt v="primary" size="lg" onClick={() => setWd(true)}>채점하기</Bt>
              : <Bt v="success" size="lg" onClick={cWk}>문제풀이 완료 →</Bt>
            }
          </div>
        </Cd>
      </div>
    );
  };

  /* ─── STUDENT DONE ─── */
  const SDn = () => {
    const ws = cW.filter(w => w.pid).slice(0, 4);
    const vocCor = ws.filter(w => va[w.i] === w.kr).length;
    const scVoc = scores[`${sSt}_${sArt}`]?.voc;
    const vocLabel = scVoc && scVoc.tot > 0 ? `${scVoc.cor} / ${scVoc.tot} 정답` : (ws.length > 0 ? `${vocCor} / ${ws.length} 정답` : "완료");
    const nSen = sentenceMeta.all.filter((_, i) => [2, 5].includes(i)).length;
    const dummyMin = Math.floor(Math.random() * 4) + 6;
    return (
      <div className="fade-up">
        <Bt v="ghost" onClick={bk} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
        <Cd style={{ padding: "40px 48px", maxWidth: 560, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 52, marginBottom: 10 }}>🎉</div>
            <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 24, marginBottom: 6 }}>학습 완료!</h2>
            <p style={{ fontSize: 14, color: X.sub }}><strong>{cA?.title}</strong> 학습을 모두 마쳤습니다.</p>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 14, padding: "20px 24px", marginBottom: 28, border: `1px solid ${X.bdr}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: X.sub, marginBottom: 14, letterSpacing: .3 }}>학습 요약</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: X.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${X.bdr}` }}>
                <div style={{ fontSize: 11, color: X.sub, marginBottom: 4 }}>📖 읽기</div>
                <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 16, color: X.gn }}>완료</div>
              </div>
              <div style={{ background: X.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${X.bdr}` }}>
                <div style={{ fontSize: 11, color: X.sub, marginBottom: 4 }}>📋 단어 보기</div>
                <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 16, color: X.gn }}>완료</div>
              </div>
              <div style={{ background: X.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${X.bdr}` }}>
                <div style={{ fontSize: 11, color: X.sub, marginBottom: 4 }}>📝 단어 퀴즈</div>
                <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 16, color: X.gn }}>
                  {vocLabel}
                </div>
              </div>
              <div style={{ background: X.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${X.bdr}` }}>
                <div style={{ fontSize: 11, color: X.sub, marginBottom: 4 }}>🎤 녹음 제출</div>
                <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 16, color: X.gn }}>
                  {nSen > 0 ? `${nSen}문장` : "완료"}
                </div>
              </div>
              <div style={{ background: X.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${X.bdr}` }}>
                <div style={{ fontSize: 11, color: X.sub, marginBottom: 4 }}>⏱ 소요 시간</div>
                <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 16, color: X.tx }}>약 {dummyMin}분</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <Bt v="primary" size="lg" onClick={bk}>과제 목록으로</Bt>
            <Bt v="ghost" onClick={() => { setSv("rd"); }} style={{ fontSize: 13 }}>📖 본문 다시 읽기</Bt>
          </div>
        </Cd>
      </div>
    );
  };

  /* ─── STEP BAR ─── */
  const SB = () => {
    const ss = ["wl", "rd", "voc", "ssb", "rec", "dn"];
    const ls = ["📋 단어보기", "📖 읽기", "📝 단어퀴즈", "✏️ 문장만들기", "🎤 녹음", "✅ 완료"];
    const ci = ss.indexOf(sv);
    const pg = sArt ? gP(prog, sSt, sArt) : { r: false, wl: false, v: false, sb: false, w: false };
    const done = pg.r && pg.wl && pg.v && pg.sb && pg.w;
    const canGo = () => true;
    return (
      <div className="ntc-step-bar" style={{ marginBottom: 20, background: X.card, borderRadius: 14, padding: 4, border: `1px solid ${X.bdr}` }}>
        {ss.map((s, i) => {
          const active = i === ci;
          const past = i < ci;
          const allowed = canGo(i);
          return (
            <button key={s}
              className="ntc-step-item"
              onClick={() => { if (allowed && !active) setSv(s); }}
              style={{ padding: "9px 4px", borderRadius: 10, border: "none", fontSize: 11, fontWeight: 700, fontFamily: F.b, whiteSpace: "nowrap", textAlign: "center", background: active ? X.dk : past ? X.gbg : "#f1f5f9", color: active ? "#fff" : past ? X.gn : X.mt, cursor: allowed && !active ? "pointer" : "default", transition: "all .2s", opacity: allowed ? 1 : 0.5 }}
            >{ls[i]}</button>
          );
        })}
      </div>
    );
  };

  /* ─── MAIN RENDER ─── */
  const secRefs = { dash: useRef(null), assign: useRef(null), progress: useRef(null), students: useRef(null) };
  const [tAct, setTAct] = useState("progress");

  const scrollTo = (key) => {
    setTAct(key);
    secRefs[key]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const svs = {
    tasks: <STasks />,
    wl: <SWl />,
    rd: <SRead />,
    voc: <SVoc />,
    ssb: <SentenceBuildStep sentences={sbSentences} onComplete={cSb} onBack={bk} />,
    rec: (
      <StudentRecordingStep
        sSt={sSt}
        sArt={sArt}
        sentenceRows={sentenceMeta.all.filter((_, i) => [2, 5].includes(i))}
        onSubmit={cRecSubmit}
        onBack={bk}
      />
    ),
    dn: <SDn />,
  };

  return (
    <div style={{ fontFamily: F.b, background: X.bg, minHeight: "100vh", color: X.tx }} onClick={() => setPw(null)}>
      {/* 헤더 */}
      <div style={{ background: X.card, borderBottom: `1px solid ${X.bdr}`, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 44, position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <img src="/Bi_new_times_bk.svg" alt="NE Times" style={{ height: 17, width: "auto", display: "block" }} />
          <span style={{ fontFamily: F.b, fontWeight: 700, fontSize: 11, color: "#fff", background: X.dk, padding: "2px 7px", borderRadius: 5, marginTop: 3, display: "inline-block" }}>Class</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 10, padding: 3 }}>
            {[["teacher", "선생님"], ["student", "학생"]].map(([r, l]) => (
              <button key={r} onClick={() => { setRole(r); setPw(null); if (r === "student") { setSArt(null); setSv("tasks"); } }}
                style={{ padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F.b, background: role === r ? "#fff" : "transparent", color: role === r ? X.tx : X.mt, boxShadow: role === r ? "0 1px 3px rgba(0,0,0,.1)" : "none", transition: "all .15s" }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Teacher sticky 탭바 */}
      {role === "teacher" && (
        <div style={{ position: "sticky", top: 44, zIndex: 40, background: X.card, borderBottom: `1px solid ${X.bdr}`, padding: "0 24px" }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", gap: 0 }}>
            {[["progress", "학습 현황"], ["students", "반 관리"]].map(([v, l]) => (
              <button key={v} onClick={() => setTAct(v)}
                style={{ padding: "12px 22px", border: "none", borderBottom: tAct === v ? `2px solid ${X.dk}` : "2px solid transparent", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F.b, background: "transparent", color: tAct === v ? X.tx : X.sub, transition: "all .15s" }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Student 읽기 화면: 탭바 먼저, 그 다음 full-width hero */}
      {role === "student" && sv === "rd" && sArt && (
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 16px 0" }}>
          <SB />
        </div>
      )}
      {role === "student" && sv === "rd" && sArt && <SReadHero />}

      {/* 콘텐츠 영역 */}
      <div style={{ maxWidth: role === "teacher" ? 1280 : 1040, margin: "0 auto", padding: role === "student" && sv === "rd" ? "0 16px 24px" : "24px 16px" }}>
        {role === "teacher" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <div style={{ marginBottom: 32 }}>
              <TDash />
            </div>
            {tAct === "progress" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <span style={{ width: 4, height: 22, borderRadius: 2, background: X.gn, display: "inline-block" }} />
                  <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 24, color: X.tx }}>학습 현황</h2>
                </div>
                <TProg />
              </div>
            )}
            {tAct === "students" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <span style={{ width: 4, height: 22, borderRadius: 2, background: X.am, display: "inline-block" }} />
                  <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 24, color: X.tx }}>반 관리</h2>
                </div>
                <TStudents />
              </div>
            )}
          </div>
        ) : (
          <>
            {/* StepBar: 읽기 화면에서는 hero 아래(컨테이너 안 상단)에 위치 */}
            {sv !== "tasks" && sv !== "rd" && sArt && <div><SB /></div>}
            {svs[sv]}
          </>
        )}
      </div>

      {/* 수업 주기 선택 모달 */}
      {freqModal && (() => {
        const { cId, nm, sel } = freqModal;
        const levelKey = nm.replace("반", "");
        const band = BANDS[levelKey] || { c: X.ac, bg: X.abg, r: "#bfdbfe" };
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            onClick={e => { if (e.target === e.currentTarget) setFreqModal(null); }}
          >
            <div className="fade-up" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 360, boxShadow: "0 24px 60px rgba(0,0,0,.18)", overflow: "hidden" }}>
              <div style={{ padding: "18px 22px 16px", borderBottom: `1px solid ${X.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: band.bg }}>
                <div>
                  <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 17, color: band.c }}>{nm}</div>
                  <div style={{ fontSize: 12, color: band.c, opacity: 0.75, marginTop: 2 }}>수업 주기 설정</div>
                </div>
                <button onClick={() => setFreqModal(null)} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: band.c, opacity: 0.6, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: "20px 22px" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
                  {["주2회", "주3회", "주5회"].map(opt => {
                    const on = sel === opt;
                    return (
                      <button key={opt} onClick={() => setFreqModal(p => ({ ...p, sel: opt }))}
                        style={{ flex: 1, padding: "14px 0", borderRadius: 12, border: `2px solid ${on ? band.c : X.bdr}`, background: on ? band.bg : "#fff", color: on ? band.c : X.sub, fontFamily: F.b, fontWeight: 700, fontSize: 14, cursor: "pointer", transition: "all .15s" }}
                      >{opt}</button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Bt v="outline" style={{ flex: 1 }} onClick={() => setFreqModal(null)}>취소</Bt>
                  <Bt v="primary" style={{ flex: 1 }} onClick={() => { setFreq(cId, sel); setFreqModal(null); showToast(`${nm} 수업 주기를 ${sel}로 변경했습니다`); }}>저장</Bt>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 기사 회수 확인 모달 */}
      {revokeModal && (() => {
        const { art, targets } = revokeModal;
        const band = BANDS[BM[art?.seq]];
        return (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            onClick={e => { if (e.target === e.currentTarget) setRevokeModal(null); }}
          >
            <div className="fade-up" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(0,0,0,.18)", overflow: "hidden" }}>
              {/* 헤더 */}
              <div style={{ padding: "18px 22px 16px", borderBottom: `1px solid ${X.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: F.h, fontWeight: 800, fontSize: 17 }}>기사 회수</span>
                <button onClick={() => setRevokeModal(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: X.mt, lineHeight: 1 }}>×</button>
              </div>
              {/* 기사 정보 */}
              <div style={{ padding: "20px 22px 0" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center", padding: 14, borderRadius: 12, background: "#f8fafc", border: `1px solid ${X.bdr}`, marginBottom: 20 }}>
                  {art?.img && <img src={art.img} style={{ width: 72, height: 50, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} alt="" />}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: X.tx, marginBottom: 4 }}>{art?.title}</div>
                    {band && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, color: band.c, background: band.bg, border: `1px solid ${band.r}` }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: band.c }} />{BM[art?.seq]}
                      </span>
                    )}
                  </div>
                </div>
                {/* 대상 학생 */}
                <p style={{ fontSize: 13, color: X.sub, marginBottom: 10 }}>아래 학생에게서 이 기사를 회수합니다.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 24 }}>
                  {targets.map(s => (
                    <span key={s.id} style={{ padding: "5px 13px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: X.rbg, color: X.rd, border: "1px solid #fecaca" }}>{s.nm}</span>
                  ))}
                </div>
              </div>
              {/* 액션 버튼 */}
              <div style={{ padding: "0 22px 20px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Bt v="outline" onClick={() => setRevokeModal(null)}>취소</Bt>
                <Bt v="primary" style={{ background: X.rd }} onClick={confirmRevoke}>회수하기</Bt>
              </div>
            </div>
          </div>
        );
      })()}


      {/* 학습현황 상세 모달 */}
      {detailModal && <ProgDetailModal
        modal={detailModal}
        onClose={() => setDetailModal(null)}
        effProg={effProg}
        scores={scores}
        label={detailModal.label || "직전 과제"}
        onRevoke={detailModal.seq ? () => {
          if (!window.confirm("이 기사를 회수하겠습니까?")) return;
          const { cls, seq } = detailModal;
          setAsgn(p => {
            const n = { ...p };
            cls.sts.forEach(st => { if (n[st.id]) n[st.id] = n[st.id].filter(a => a.seq !== seq); });
            return n;
          });
          setDetailModal(null);
          showToast("기사가 회수되었습니다.");
        } : null}
      />}

      {/* 학생별 상세 모달 */}
      {studentDetailModal && <StudentDetailModal modal={studentDetailModal} onClose={() => setStudentDetailModal(null)} effProg={effProg} scores={scores} onDelete={removeStudent} />}

      {/* 학생×기사 과제 상세 모달 */}
      {artProgModal && <ArticleProgressModal modal={artProgModal} onClose={() => setArtProgModal(null)} effProg={effProg} scores={scores} />}

      {/* 반 추가 모달 */}
      {addClsModal && (() => {
        const { nm, level, freq } = addClsModal;
        const band = level ? BANDS[level] : null;
        const canSubmit = nm.trim() && level;
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            onClick={e => { if (e.target === e.currentTarget) setAddClsModal(null); }}>
            <div className="fade-up" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 440, boxShadow: "0 24px 60px rgba(0,0,0,.18)" }}>
              <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${X.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: F.h, fontWeight: 800, fontSize: 18 }}>반 추가</span>
                <button onClick={() => setAddClsModal(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: X.mt, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
                {/* 반 이름 */}
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: X.sub, marginBottom: 8 }}>반 이름</label>
                  <input
                    value={nm}
                    onChange={e => setAddClsModal(p => ({ ...p, nm: e.target.value }))}
                    placeholder="예: 월수금반"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${X.bdr}`, fontSize: 14, fontFamily: F.b, outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                {/* 기사 레벨 */}
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: X.sub, marginBottom: 8 }}>기사 레벨</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {CLS_LEVEL_OPTIONS.map(opt => {
                      const b = BANDS[opt.level];
                      const sel = level === opt.level;
                      return (
                        <button key={opt.key} onClick={() => setAddClsModal(p => ({ ...p, level: opt.level }))}
                          style={{ flex: 1, padding: "8px 4px", borderRadius: 10, border: `2px solid ${sel ? b.c : X.bdr}`, background: sel ? b.bg : "#fff", color: sel ? b.c : X.sub, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: F.b, transition: "all .15s" }}>
                          <div>{opt.key}</div>
                          <div style={{ fontSize: 10, fontWeight: 500, marginTop: 2, opacity: 0.8 }}>{opt.level}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* 수업 주기 */}
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: X.sub, marginBottom: 8 }}>수업 주기</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["주2회", "주3회", "주5회"].map(f => {
                      const sel = freq === f;
                      return (
                        <button key={f} onClick={() => setAddClsModal(p => ({ ...p, freq: f }))}
                          style={{ flex: 1, padding: "9px 4px", borderRadius: 10, border: `2px solid ${sel ? X.dk : X.bdr}`, background: sel ? X.dk : "#fff", color: sel ? "#fff" : X.sub, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: F.b, transition: "all .15s" }}>
                          {f.replace("주", "주 ").replace("회", " 회")}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* 자동 발행 안내 메시지 */}
                {level && (() => {
                  const LK = { 입문: "Kinder", 기초: "Kids", 기본: "Junior", 심화: "Times" };
                  const FD = { 주2회: { n: 2, days: "화·목" }, 주3회: { n: 3, days: "월·수·금" }, 주5회: { n: 5, days: "월·화·수·목·금" } };
                  const lk = LK[level] || level;
                  const { n, days } = FD[freq] || { n: 2, days: "화·목" };
                  const lines = [
                    <span>매주 월요일 <b>{lk} 기사 {n}개가 자동 발행</b>됩니다.</span>,
                    <span>학생 화면에는 <b>{days}</b> 과제로 1개씩 배치되며, 난이도는 표시되지 않습니다.</span>,
                    <span>학생 추가 시 이번 주 기사도 즉시 발행됩니다.</span>,
                  ];
                  return (
                    <div style={{ padding: "12px 16px", borderRadius: 12, background: "#f0f9ff", border: "1px solid #bae6fd" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#0369a1", marginBottom: 7, display: "flex", alignItems: "center", gap: 5 }}>
                        <span>📋</span> 자동 발행 안내
                      </div>
                      {lines.map((line, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#0c4a6e", lineHeight: 1.75, display: "flex", gap: 6 }}>
                          <span style={{ color: "#7dd3fc", flexShrink: 0 }}>•</span>
                          <span>{line}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {/* 미리보기 */}
                {band && nm.trim() && (
                  <div style={{ padding: "10px 14px", borderRadius: 10, background: band.bg, border: `1px solid ${band.r}`, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: F.h, fontWeight: 800, fontSize: 15, color: band.c }}>{nm.trim()}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: band.c, background: "rgba(255,255,255,0.7)", border: `1px solid ${band.r}`, borderRadius: 6, padding: "2px 7px" }}>{freq.replace("주", "주 ").replace("회", " 회")}</span>
                  </div>
                )}
                {/* 버튼 */}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setAddClsModal(null)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${X.bdr}`, background: "#fff", fontSize: 14, fontWeight: 600, fontFamily: F.b, cursor: "pointer", color: X.sub }}>취소</button>
                  <button onClick={addClass} disabled={!canSubmit}
                    style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: canSubmit ? X.dk : "#e2e8f0", color: canSubmit ? "#fff" : X.mt, fontSize: 14, fontWeight: 700, fontFamily: F.b, cursor: canSubmit ? "pointer" : "default", transition: "all .15s" }}>
                    반 추가 완료
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 기사 수동배정 모달 */}
      {assignModal && (() => {
        const { cls } = assignModal;
        const levelKey = cls.level || cls.nm.replace("반", "");
        const band = BANDS[levelKey] || { c: X.ac, bg: X.abg, r: "#bfdbfe" };
        const fl = ARTS.filter(a => { if (lF && BM[a.seq] !== lF) return false; if (tF && a.tc !== tF) return false; return true; });
        const tps = [...new Set(ARTS.map(a => a.tc))];
        const closeModal = () => { setAssignModal(null); setAr(null); setLF(null); setTF(null); };
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
            <div className="fade-up" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 620, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,.18)" }}>
              {/* 헤더 */}
              <div style={{ padding: "18px 22px 16px", borderBottom: `1px solid ${band.r}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: band.bg, borderRadius: "20px 20px 0 0", flexShrink: 0 }}>
                <div>
                  <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 17, color: band.c }}>{cls.nm}</div>
                  <div style={{ fontSize: 12, color: band.c, opacity: 0.75, marginTop: 2 }}>기사 수동배정 · {cls.sts.length}명 대상</div>
                </div>
                <button onClick={closeModal} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: band.c, opacity: 0.6, lineHeight: 1 }}>×</button>
              </div>
              {/* 필터 */}
              <div style={{ padding: "12px 22px", borderBottom: `1px solid ${X.bdr}`, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", flexShrink: 0, background: "#fafafa" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: X.sub }}>난이도</span>
                  <select style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid ${X.bdr}`, fontSize: 12, fontFamily: F.b }} value={lF || ""} onChange={e => setLF(e.target.value || null)}>
                    <option value="">전체</option>{Object.keys(BANDS).map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: X.sub }}>주제</span>
                  <select style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid ${X.bdr}`, fontSize: 12, fontFamily: F.b }} value={tF || ""} onChange={e => setTF(e.target.value || null)}>
                    <option value="">전체</option>{tps.map(t => { const a = ARTS.find(x => x.tc === t); return <option key={t} value={t}>{a?.topic}</option>; })}
                  </select>
                </div>
              </div>
              {/* 기사 목록 */}
              <div style={{ overflow: "auto", padding: "14px 22px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                {fl.map(a => {
                  const assigned = isAssigned(a.seq);
                  const b = BANDS[BM[a.seq]];
                  return (
                    <Cd key={a.seq} style={{ display: "flex", gap: 14, alignItems: "center", padding: 14 }}>
                      <img src={a.img} style={{ width: 88, height: 60, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} alt="" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: F.h, fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{a.title}</div>
                        <div style={{ fontSize: 11, color: X.sub, marginBottom: 5 }}>{a.tkr}</div>
                        <div style={{ display: "flex", gap: 5 }}>
                          {b && <span style={{ fontSize: 10, fontWeight: 500, color: X.sub }}>{b.min}L–{b.max}L</span>}
                          <span style={{ fontSize: 10, fontWeight: 600, color: b ? b.c : X.ac, background: b ? b.bg : X.abg, borderRadius: 4, padding: "1px 6px" }}>{a.topic}</span>
                        </div>
                      </div>
                      {assigned
                        ? <button onClick={() => revokeAsgn(a.seq)} style={{ fontSize: 12, fontWeight: 700, color: X.gn, borderColor: "#a7f3d0", background: X.gbg, border: "1px solid #a7f3d0", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontFamily: F.b, flexShrink: 0 }}>배정됨 ✓</button>
                        : <button onClick={() => dAs(a.seq)} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: X.ac, border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontFamily: F.b, flexShrink: 0 }}>배정</button>
                      }
                    </Cd>
                  );
                })}
                {!fl.length && <div style={{ textAlign: "center", color: X.mt, padding: 40, fontSize: 13 }}>해당 조건의 기사가 없습니다.</div>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 반 설정 모달 */}
      {clsSettingsModal && (() => {
        const { cls, nm, level, freq } = clsSettingsModal;
        const lk = level || cls.nm.replace("반", "");
        const band = BANDS[lk] || { c: X.ac, bg: X.abg, r: "#bfdbfe" };
        const save = () => {
          if (!nm.trim()) return;
          const next = clsData.map(c => c.id === cls.id ? { ...c, nm: nm.trim(), level } : c);
          saveCls(next);
          setFreq(cls.id, freq);
          setClsSettingsModal(null);
          showToast(`${nm.trim()} 설정이 저장되었습니다.`);
        };
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            onClick={e => { if (e.target === e.currentTarget) setClsSettingsModal(null); }}>
            <div className="fade-up" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 460, boxShadow: "0 24px 60px rgba(0,0,0,.18)", overflow: "hidden" }}>
              <div style={{ padding: "18px 22px 16px", borderBottom: `1px solid ${X.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: band.bg }}>
                <span style={{ fontFamily: F.h, fontWeight: 800, fontSize: 17, color: band.c }}>반 설정</span>
                <button onClick={() => setClsSettingsModal(null)} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: band.c, opacity: 0.6, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: 24 }}>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: X.sub, marginBottom: 8 }}>반 이름</label>
                  <input value={nm} onChange={e => setClsSettingsModal(p => ({ ...p, nm: e.target.value }))}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${X.bdr}`, fontSize: 14, fontFamily: F.b, boxSizing: "border-box", outline: "none" }} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: X.sub, marginBottom: 8 }}>난이도</label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                    {CLS_LEVEL_OPTIONS.map(opt => {
                      const ob = BANDS[opt.level] || { c: X.ac, bg: X.abg };
                      const sel = level === opt.level;
                      return (
                        <button key={opt.key} onClick={() => setClsSettingsModal(p => ({ ...p, level: opt.level }))}
                          style={{ padding: "10px 6px", borderRadius: 10, border: `2px solid ${sel ? ob.c : X.bdr}`, background: sel ? ob.bg : "#fff", cursor: "pointer", textAlign: "center", transition: "all .15s" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: sel ? ob.c : X.tx, fontFamily: F.h }}>{opt.key}</div>
                          <div style={{ fontSize: 10, color: sel ? ob.c : X.mt, marginTop: 2 }}>{opt.level}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: X.sub, marginBottom: 8 }}>수업 주기</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["주2회", "주3회", "주5회"].map(f => (
                      <button key={f} onClick={() => setClsSettingsModal(p => ({ ...p, freq: f }))}
                        style={{ flex: 1, padding: "10px", borderRadius: 10, border: `2px solid ${freq === f ? X.dk : X.bdr}`, background: freq === f ? X.dk : "#fff", color: freq === f ? "#fff" : X.tx, fontSize: 13, fontWeight: 700, fontFamily: F.b, cursor: "pointer", transition: "all .15s" }}>
                        {f.replace("주", "주 ").replace("회", " 회")}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setClsSettingsModal(null)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${X.bdr}`, background: "#fff", fontSize: 14, fontWeight: 600, fontFamily: F.b, cursor: "pointer", color: X.sub }}>취소</button>
                  <button onClick={save} disabled={!nm.trim()}
                    style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: nm.trim() ? X.dk : "#e2e8f0", color: nm.trim() ? "#fff" : X.mt, fontSize: 14, fontWeight: 700, fontFamily: F.b, cursor: nm.trim() ? "pointer" : "default", transition: "all .15s" }}>
                    저장
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 토스트 */}
      {showAddModal && (() => {
        const recLabel = levelPick !== null ? LEVEL_GROUPS[levelPick].label : null;
        const recCId = levelPick !== null ? recommendCId(levelPick) : null;
        return (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            onClick={e => { if (e.target === e.currentTarget) closeAddModal(); }}
          >
            <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.18)" }}>
              <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${X.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: F.h, fontWeight: 800, fontSize: 18 }}>학생 등록</span>
                <button onClick={closeAddModal} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: X.mt, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: 24 }}>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: X.sub, marginBottom: 6 }}>학생 이름</label>
                  <input
                    value={addName}
                    onChange={e => setAddName(e.target.value)}
                    placeholder="이름을 입력하세요"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${X.bdr}`, fontSize: 14, fontFamily: F.b, boxSizing: "border-box", outline: "none" }}
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: X.sub, marginBottom: 8 }}>반 지정</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {clsData.filter(c => c.sts.length > 0 || c.id.startsWith("c_")).map(c => {
                      const lk = c.level || c.nm.replace("반", "");
                      const band = Object.entries(BANDS).find(([k]) => k === lk);
                      const bc = band ? band[1].c : X.ac;
                      const bbg = band ? band[1].bg : X.abg;
                      const sel = addCId === c.id;
                      return (
                        <button key={c.id} onClick={() => setAddCId(c.id)}
                          style={{ padding: "12px 14px", borderRadius: 10, border: `2px solid ${sel ? bc : X.bdr}`, background: sel ? bbg : "#fff", cursor: "pointer", textAlign: "left", transition: "all .15s" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: sel ? bc : X.tx, fontFamily: F.h }}>{c.nm}</span>
                            {clsFreq[c.id] && <span style={{ fontSize: 10, fontWeight: 700, color: sel ? bc : X.mt, background: sel ? `${bc}22` : "#f1f5f9", borderRadius: 4, padding: "1px 5px" }}>{clsFreq[c.id]}</span>}
                          </div>
                          <div style={{ fontSize: 11, color: X.sub, marginTop: 2 }}>{c.sts.length}명 재학 중</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {addCId && (
                  <div style={{ marginBottom: 20, padding: "10px 14px", borderRadius: 10, background: "#f8f9fa", fontSize: 12, color: X.sub }}>
                    배정될 반: <strong style={{ color: X.tx }}>{clsData.find(c => c.id === addCId)?.nm ?? "미선택"}</strong>
                  </div>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={closeAddModal} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${X.bdr}`, background: "#fff", fontSize: 14, fontWeight: 600, fontFamily: F.b, cursor: "pointer", color: X.sub }}>취소</button>
                  <button onClick={submitAdd} disabled={!addName.trim() || !addCId}
                    style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: addName.trim() && addCId ? X.dk : "#e2e8f0", color: addName.trim() && addCId ? "#fff" : X.mt, fontSize: 14, fontWeight: 700, fontFamily: F.b, cursor: addName.trim() && addCId ? "pointer" : "default", transition: "all .15s" }}>
                    등록 완료
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {toast && (
        <div className="toast-anim" style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", zIndex: 999, background: "#0f172a", color: "#fff", borderRadius: 12, padding: "12px 24px", fontSize: 14, fontFamily: F.b, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 16 }}>
          <span>{toast}</span>
          {lastAssigned && (
            <button
              onClick={() => {
                const sid = at.t === "students"
          ? ((at.ids || [])[0] || dynALL[0]?.id || "s1")
          : at.id === "__all__" ? (dynALL[0]?.id || "s1")
          : (clsData.find(c => c.id === at.id)?.sts[0]?.id || "s1");
                setRole("student"); setSSt(sid); setSArt(null); setSv("tasks"); setToast(null);
              }}
              style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.3)", color: "#fff", borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 600, fontFamily: F.b, cursor: "pointer", whiteSpace: "nowrap" }}>
              학생 화면에서 확인 →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
