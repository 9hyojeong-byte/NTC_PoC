import React, { useState, useMemo, useEffect, useRef } from "react";

/* ── lib imports ── */
import { GLOBAL_CSS, BANDS, BM, CLS, ALL, IA, IP, TL, F, X } from "./lib/constants.js";
import { ARTS, W, WB } from "./lib/selectors.js";
import { playWordAudio } from "./lib/audio.js";

/* ═══════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════ */
const gP = (p, s, q) => {
  const x = p[`${s}_${q}`];
  if (!x) return { r: false, wl: false, v: false, w: false };
  return { r: !!x.r, wl: !!x.wl, v: !!x.v, w: !!x.w };
};
const iD = (p, s, q) => {
  const x = gP(p, s, q);
  return x.r && x.wl && x.v && x.w;
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
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: d.c }} />{b} · {d.min}L–{d.max}L
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
  const streamRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const playingAudioRef = useRef(null);
  /** true면 MediaRecorder stop 시 파일로 저장하지 않고 버림 */
  const discardOnStopRef = useRef(false);

  const cleanupMedia = () => {
    discardOnStopRef.current = true;
    if (playingAudioRef.current) {
      playingAudioRef.current.pause();
      playingAudioRef.current = null;
    }
    setPlayingRecKey(null);
    if (mrRef.current && mrRef.current.state !== "inactive") {
      try {
        mrRef.current.stop();
      } catch {
        /* ignore */
      }
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
  }, [sSt, sArt]);

  useEffect(() => () => {
    cleanupMedia();
  }, []);

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
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const streamNow = streamRef.current;
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        chunksRef.current = [];
        mrRef.current = null;
        if (streamNow) {
          streamNow.getTracks().forEach((t) => t.stop());
        }
        streamRef.current = null;
        const shouldDiscard = discardOnStopRef.current;
        discardOnStopRef.current = false;
        setActiveRecKey(null);
        if (shouldDiscard || blob.size === 0) {
          return;
        }
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
      try {
        mrRef.current.stop();
      } catch {
        /* ignore */
      }
    }
  };

  const completeRecording = () => {
    discardOnStopRef.current = false;
    if (mrRef.current && mrRef.current.state === "recording") {
      try {
        mrRef.current.stop();
      } catch {
        /* ignore */
      }
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
    a.play().catch(() => {
      finish();
    });
  };

  const nRec = rows.filter((r) => recMap[r.key]).length;
  const allDone = rows.length === 0 || nRec === rows.length;

  return (
    <div>
      <Bt v="ghost" onClick={onBack} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
      <Cd style={{ maxWidth: 800, margin: "0 auto" }}>
        <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 20, marginBottom: 4 }}>녹음하기</h2>
        <p style={{ fontSize: 13, color: X.sub, marginBottom: 8 }}>문장마다 영어로 녹음해 보세요. 모든 문장을 한 번씩 녹음해야 제출할 수 있습니다.</p>
        <div style={{ fontSize: 12, color: X.ac, marginBottom: 16 }}>
          녹음 진행: {rows.length ? `${nRec} / ${rows.length}` : "0 / 0"}
        </div>
        {recErr && (
          <div style={{ fontSize: 12, color: X.rd, marginBottom: 12, padding: "8px 10px", background: X.rbg, borderRadius: 8 }}>
            {recErr}
          </div>
        )}
        <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
          {rows.map((row, idx) => {
            const has = !!recMap[row.key];
            const isRec = activeRecKey === row.key;
            const isPlaying = playingRecKey === row.key;
            return (
              <div
                key={row.key}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border: `1px solid ${X.bdr}`,
                  background: "#fafbfd",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: X.sub, marginBottom: 6 }}>문장 {idx + 1}</div>
                <p style={{ fontSize: 15, lineHeight: 1.75, color: X.tx, marginBottom: 12 }}>{row.text}</p>
                {isPlaying && (
                  <div
                    className="ntc-play-pulse"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 10,
                      padding: "8px 12px",
                      borderRadius: 10,
                      background: "#eff6ff",
                      border: "1px solid #bfdbfe",
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#1d4ed8", letterSpacing: 0.2 }}>▶ 현재 재생중</span>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb", flexShrink: 0 }} aria-hidden />
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {!isRec && (
                    <Bt
                      v="primary"
                      onClick={() => startRec(row.key)}
                      disabled={!!activeRecKey && activeRecKey !== row.key}
                    >
                      녹음 시작
                    </Bt>
                  )}
                  {isRec && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca" }}>
                        <span style={{ fontWeight: 800, fontSize: 14, color: "#b91c1c", letterSpacing: 0.3 }}>녹음중</span>
                        <span className="ntc-rec-dot" aria-hidden title="녹음 표시등" />
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <Bt
                          v="outline"
                          onClick={cancelRecording}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: X.rd, borderColor: "#fecaca" }}
                          title="방금 녹음 취소"
                        >
                          <span aria-hidden style={{ fontSize: 16 }}>🗑</span>
                          녹음취소
                        </Bt>
                        <Bt v="success" onClick={completeRecording} title="녹음 저장">
                          녹음완료
                        </Bt>
                      </div>
                    </div>
                  )}
                  {!isRec && (
                    <Bt
                      v="outline"
                      disabled={!has}
                      onClick={() => playRec(row.key)}
                      style={
                        isPlaying
                          ? {
                              border: "2px solid #2563eb",
                              background: "#eff6ff",
                              color: "#1d4ed8",
                              fontWeight: 700,
                            }
                          : undefined
                      }
                    >
                      {isPlaying ? "🔊 재생중…" : "내 녹음 듣기"}
                    </Bt>
                  )}
                  {has && <span style={{ fontSize: 12, color: X.gn, fontWeight: 600 }}>✓ 녹음됨</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: "center" }}>
          <Bt v="success" size="lg" disabled={!allDone} onClick={onSubmit}>제출하고 완료하기</Bt>
          {!allDone && rows.length > 0 && (
            <p style={{ fontSize: 12, color: X.mt, marginTop: 10 }}>모든 문장을 녹음하면 제출할 수 있습니다.</p>
          )}
        </div>
      </Cd>
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
  const [asgn, setAsgn] = useState(IA);
  const [prog, setProg] = useState(IP);
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
  const [vd, setVd] = useState(false);
  const [vo, setVo] = useState({});
  const [wa, setWa] = useState({});
  const [wd, setWd] = useState(false);
  const [scores, setScores] = useState({
    "s1_786": { voc: { cor: 5, tot: 8 }, wb: { cor: 2, tot: 3 } },
    "s2_786": { voc: { cor: 7, tot: 8 } },
  });
  // at: { t: "class", id: "c1"|"__all__" } | { t: "students", ids: string[] }
  const [at, setAt] = useState({ t: "class", id: "c1" });
  const [ar, setAr] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [lastAssigned, setLastAssigned] = useState(false);

  /* ─── DYNAMIC STUDENTS ─── */
  const [clsData, setClsData] = useState(() => {
    try {
      const s = localStorage.getItem("ntc_cls_v2");
      return s ? JSON.parse(s) : CLS;
    } catch { return CLS; }
  });
  const dynALL = useMemo(
    () => clsData.flatMap(c => c.sts.map(s => ({ ...s, cId: c.id, cNm: c.nm }))),
    [clsData]
  );
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
  };
  const removeStudent = (stId) => {
    const next = clsData.map(c => ({ ...c, sts: c.sts.filter(s => s.id !== stId) }));
    saveCls(next);
  };

  /* ─── STUDENT ADD MODAL STATE ─── */
  const [wlIdx, setWlIdx] = useState(0);
  const [vocIdx, setVocIdx] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCId, setAddCId] = useState("");
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
      return { ...p, [k]: { r: false, wl: false, v: false, w: false, ...prev, [f]: true } };
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
    setSv("wl");
    setWlIdx(0);
    setVa({});
    setVd(false);
  };
  const initVocOptions = (wordList) => {
    const ak = wordList.map(w => w.kr);
    const o = {};
    wordList.forEach((w) => {
      const wr = ak.filter((k) => k !== w.kr).sort(() => Math.random() - 0.5).slice(0, 2);
      o[w.i] = [w.kr, ...wr].sort(() => Math.random() - 0.5);
    });
    setVo(o);
    setVa({});
    setVd(false);
    setVocIdx(0);
  };
  const goWlToVoc = () => {
    uP(sSt, sArt, "wl");
    initVocOptions(cW.filter(w => w.pid).slice(0, 8));
    setSv("voc");
  };
  const cV = () => {
    const ws = cW.filter(w => w.pid).slice(0, 8);
    const cor = ws.filter(w => va[w.i] === w.kr).length;
    const k = `${sSt}_${sArt}`;
    setScores(p => ({ ...p, [k]: { ...(p[k] || {}), voc: { cor, tot: ws.length } } }));
    uP(sSt, sArt, "v");
    setSv("rec");
  };
  const cRecSubmit = () => {
    const keys = sentenceMeta.all.map((s) => s.key);
    const map = loadRecMap(sSt, sArt);
    if (keys.length && keys.some((k) => !map[k])) return;
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
    setAsgn(p => { const n = { ...p }; ts.forEach(s => { if (!n[s.id]) n[s.id] = []; if (!n[s.id].some(a => a.seq === seq)) n[s.id] = [...n[s.id], { seq, at: "04-02" }]; }); return n; });
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
    // 개별 다중 선택: 선택된 모든 학생에게 배정된 경우만 "배정됨"
    if (at.t === "students") return ts.every(s => (asgn[s.id] || []).some(a => a.seq === seq));
    return ts.every(s => (asgn[s.id] || []).some(a => a.seq === seq));
  };

  /* ─── TEACHER DASHBOARD ─── */
  const TDash = () => {
    const tA = Object.values(asgn).flat().length;
    const tD = Object.entries(prog).filter(([, v]) => v.r && v.wl && v.v && v.w).length;
    const tP = Object.entries(prog).filter(([, v]) => (v.r || v.wl || v.v || v.w) && !(v.r && v.wl && v.v && v.w)).length;
    const tN = tA - tD - tP;
    return (
      <div>
        <Cd style={{ marginBottom: 20, padding: 24, background: `linear-gradient(135deg,${X.dk} 0%,#1e293b 100%)`, color: "#fff", border: "none", display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 60, height: 60, borderRadius: 16, background: "rgba(255,255,255,.15)", flexShrink: 0, overflow: "hidden" }}>
            <img src="/C_01.png" alt="박지영 선생님" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 22 }}>박지영 선생님</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 3 }}>NE 영어학원 · 담당 {clsData.length}개 반 · 학생 {dynALL.length}명</div>
          </div>
          <div style={{ textAlign: "right", padding: "8px 16px", background: "rgba(255,255,255,.06)", borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b" }}>오늘</div>
            <div style={{ fontFamily: F.h, fontWeight: 700, fontSize: 14 }}>2026. 4. 2.</div>
          </div>
        </Cd>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
          {[{ l: "전체 배정", v: tA, co: X.ac }, { l: "학습 완료", v: tD, co: X.gn }, { l: "진행 중", v: tP, co: X.am }, { l: "미시작", v: tN, co: X.rd }].map((k, i) =>
            <Cd key={i} style={{ textAlign: "center", padding: "20px 12px" }}>
              <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 30, color: k.co, lineHeight: 1 }}>{k.v}</div>
              <div style={{ fontSize: 12, color: X.sub, marginTop: 6 }}>{k.l}</div>
            </Cd>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <Hd sub="반별 과제 진행 현황">반 요약</Hd>
            {clsData.map(cls => {
              const all = cls.sts.flatMap(s => (asgn[s.id] || []).map(a => ({ sid: s.id, ...a })));
              const dn = all.filter(a => iD(prog, a.sid, a.seq)).length; const tot = all.length; const pct = tot ? Math.round(dn / tot * 100) : 0;
              const nd = cls.sts.filter(s => (asgn[s.id] || []).some(a => !iD(prog, s.id, a.seq)));
              return (
                <Cd key={cls.id} style={{ marginBottom: 12, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{cls.nm}</span>
                    <span style={{ fontSize: 12, color: X.sub }}>{cls.sts.length}명</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: "#f1f5f9", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 4, background: pct === 100 ? X.gn : X.ac, width: `${pct}%`, transition: "width .5s" }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: pct === 100 ? X.gn : X.ac, minWidth: 40, textAlign: "right" }}>{pct}%</span>
                  </div>
                  {nd.length > 0 && <div style={{ fontSize: 12, color: X.am }}>⚠ 미완료 {nd.length}명: {nd.map(s => s.nm).join(", ")}</div>}
                  {nd.length === 0 && tot > 0 && <div style={{ fontSize: 12, color: X.gn }}>✓ 전원 완료</div>}
                  {tot === 0 && <div style={{ fontSize: 12, color: X.mt }}>배정 없음</div>}
                </Cd>
              );
            })}
            <Hd sub="오늘의 추천 할 일">할 일</Hd>
            <Cd style={{ padding: 16 }}>
              {[{ d: false, t: "입문반 미완료 학생 리마인드" }, { d: false, t: "기본반 새 기사 배정" }, { d: true, t: "지난주 학습 현황 확인" }].map((td, i) =>
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < 2 ? `1px solid ${X.bdr}` : "none" }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${td.d ? X.gn : X.bdr}`, background: td.d ? X.gbg : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: X.gn }}>{td.d ? "✓" : ""}</span>
                  <span style={{ fontSize: 13, color: td.d ? X.mt : X.tx, textDecoration: td.d ? "line-through" : "none" }}>{td.t}</span>
                </div>
              )}
            </Cd>
          </div>
          <div>
            <Hd sub="학생 활동 기록">최근 활동</Hd>
            <Cd style={{ padding: 16 }}>
              {TL.map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < TL.length - 1 ? `1px solid ${X.bdr}` : "none" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: "#f8f9fb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{e.ic}</div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{e.m}</div><div style={{ fontSize: 11, color: X.mt, marginTop: 2 }}>{e.t}</div></div>
                </div>
              ))}
            </Cd>
          </div>
        </div>
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
                  ? <Bt v="outline" disabled style={{ color: X.gn, borderColor: "#a7f3d0", background: X.gbg }}>배정됨 ✓</Bt>
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
    // 시드 기반 결정적 랜덤 — 같은 학생/기사/타입이면 항상 같은 값
    const seedRand = (seed) => {
      let s = seed;
      s = ((s >>> 16) ^ s) * 0x45d9f3b;
      s = ((s >>> 16) ^ s) * 0x45d9f3b;
      s = (s >>> 16) ^ s;
      return (s >>> 0) / 0xffffffff;
    };
    const dummyScore = (stId, seq, type) => {
      const seed = (stId + seq + type).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      const tot = type === "voc" ? 8 : (() => {
        const wb = WB[seq] || [];
        const autoTypes = ["wc", "mc", "tf", "us", "mt"];
        return wb.filter(a => autoTypes.includes(a.t)).reduce((s, a) => s + (a.qs?.length || a.left?.length || 0), 0) || 5;
      })();
      const cor = Math.max(1, Math.round(seedRand(seed) * tot));
      return { cor, tot };
    };
    const ScoreCell = ({ on, sc, started, stId, seq, type }) => {
      let label = null;
      if (sc && sc.tot > 0) {
        label = `${sc.cor}/${sc.tot}`;
      } else if (on) {
        // 완료 상태인데 실제 점수 없으면 결정적 더미 점수 표시
        const d = dummyScore(stId, seq, type);
        label = `${d.cor}/${d.tot}`;
      }
      return (
        <td style={{ textAlign: "center", padding: "12px 8px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Dt on={on} />
            {label && (
              <span style={{ fontSize: 11, color: X.sub, fontVariantNumeric: "tabular-nums" }}>
                {label}
              </span>
            )}
          </div>
        </td>
      );
    };
    return (
      <div>
        <p style={{ fontSize: 13, color: X.sub, marginBottom: 14 }}>학생별 학습 단계 진행 상태</p>
        {clsData.map(cls => (
          <Cd key={cls.id} style={{ marginBottom: 20, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", background: "#fafbfd", borderBottom: `1px solid ${X.bdr}`, fontFamily: F.h, fontWeight: 700, fontSize: 15 }}>{cls.nm}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${X.bdr}` }}>
                  {["학생", "기사", "읽기", "단어보기", "단어퀴즈", "녹음", "상태"].map(h => (
                    <th key={h} style={{ textAlign: h === "학생" || h === "기사" ? "left" : "center", padding: "10px 16px", color: X.sub, fontWeight: 600, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cls.sts.flatMap(st => {
                  const sa = asgn[st.id] || [];
                  if (!sa.length) return [
                    <tr key={st.id} style={{ borderBottom: `1px solid #f5f5f7` }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>{st.nm}</td>
                      <td colSpan={6} style={{ padding: "12px 16px", color: X.mt }}>배정 없음</td>
                    </tr>
                  ];
                  return sa.map((a, idx) => {
                    const ax = ARTS.find(x => x.seq === a.seq);
                    const p = gP(prog, st.id, a.seq);
                    const d = p.r && p.wl && p.v && p.w;
                    const s = [p.r, p.wl, p.v, p.w].filter(Boolean).length;
                    const sc = scores[`${st.id}_${a.seq}`] || {};
                    return (
                      <tr key={`${st.id}_${a.seq}`} style={{ borderBottom: `1px solid #f5f5f7` }}>
                        {idx === 0 && <td rowSpan={sa.length} style={{ padding: "12px 16px", fontWeight: 600, verticalAlign: "top" }}>{st.nm}</td>}
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ fontWeight: 500, marginBottom: 3 }}>{ax?.title?.substring(0, 22)}</div>
                          <Bd b={BM[a.seq]} />
                        </td>
                        <td style={{ textAlign: "center", padding: "12px 8px" }}><Dt on={p.r} /></td>
                        <td style={{ textAlign: "center", padding: "12px 8px" }}><Dt on={p.wl} /></td>
                        <ScoreCell on={p.v} sc={sc.voc} started={p.wl} stId={st.id} seq={a.seq} type="voc" />
                        <td style={{ textAlign: "center", padding: "12px 8px" }}><Dt on={p.w} /></td>
                        <td style={{ textAlign: "center" }}>
                          <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, color: d ? X.gn : s > 0 ? X.am : X.mt, background: d ? X.gbg : s > 0 ? X.abg2 : "#f8f9fa" }}>
                            {d ? "✓ 완료" : s > 0 ? `진행중 ${s}/4` : "미시작"}
                          </span>
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </Cd>
        ))}
      </div>
    );
  };

  /* ─── TEACHER STUDENTS ─── */
  const TStudents = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: X.sub }}>학생을 등록하고 반을 지정합니다.</p>
        <button
          onClick={openAddModal}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 10, border: "none", background: X.dk, color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: F.b, cursor: "pointer" }}
        >
          + 학생 등록
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
        {clsData.filter(cls => cls.sts.length > 0).map(cls => {
          const band = Object.entries(BANDS).find(([k]) => k === cls.nm.replace("반", ""));
          const bColor = band ? band[1].c : X.ac;
          const bBg = band ? band[1].bg : X.abg;
          return (
            <Cd key={cls.id} style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: bBg, borderBottom: `1px solid ${X.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: F.h, fontWeight: 700, fontSize: 15, color: bColor }}>{cls.nm}</span>
                <span style={{ fontSize: 12, color: bColor, fontWeight: 600 }}>{cls.sts.length}명</span>
              </div>
              {cls.sts.length === 0 ? (
                <div style={{ padding: "20px 16px", color: X.mt, fontSize: 13, textAlign: "center" }}>등록된 학생이 없습니다.</div>
              ) : (
                <div style={{ padding: "8px 0" }}>
                  {cls.sts.map(st => (
                    <div key={st.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid #f5f5f7` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: bBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: bColor, fontWeight: 700, fontFamily: F.h }}>
                          {st.nm[0]}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{st.nm}</span>
                      </div>
                      <button
                        onClick={() => { if (window.confirm(`${st.nm} 학생을 삭제하시겠습니까?`)) removeStudent(st.id); }}
                        style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, color: X.mt, padding: "4px 8px", borderRadius: 6 }}
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Cd>
          );
        })}
      </div>
    </div>
  );

  /* ─── STUDENT TASKS ─── */
  const STasks = () => (
    <div className="fade-up">
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 24 }}>나의 과제</h2>
        <p style={{ fontSize: 13, color: X.sub, marginTop: 4 }}>선생님이 배정한 기사를 순서대로 학습하세요.</p>
      </div>
      {!sAs.length
        ? <Cd style={{ textAlign: "center", padding: 48, color: X.mt }}>배정된 과제가 없습니다.</Cd>
        : (
          <div style={{ display: "grid", gap: 14 }}>
            {sAs.map(({ art, seq, pg }) => {
              if (!art) return null;
              const d = pg.r && pg.wl && pg.v && pg.w;
              const s = [pg.r, pg.wl, pg.v, pg.w].filter(Boolean).length;
              return (
                <Cd key={seq} style={{ display: "flex", gap: 20, alignItems: "center", cursor: "pointer", padding: 20 }}
                  onClick={() => {
                    setSArt(seq);
                    if (d) setSv("dn");
                    else if (pg.r && pg.wl && pg.v && !pg.w) setSv("rec");
                    else if (pg.r && pg.wl && !pg.v) { initVocOptions((W[seq] || []).filter(w => w.pid).slice(0, 8)); setSv("voc"); }
                    else if (pg.r && !pg.wl) setSv("wl");
                    else setSv("rd");
                    setVa({});
                    setWa({});
                    setVd(false);
                    setWd(false);
                  }}
                >
                  <img src={art.img} style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 14 }} alt="" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: F.h, fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{art.title}</div>
                    <div style={{ fontSize: 12, color: X.sub, marginBottom: 10 }}>{art.topic}</div>
                    <div style={{ display: "flex", gap: 5 }}>
                      {["📖 읽기", "📋 단어보기", "📝 단어퀴즈", "🎤 녹음"].map((l, i) => (
                        <span key={i} style={{ padding: "3px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: [pg.r, pg.wl, pg.v, pg.w][i] ? X.gbg : "#f8f9fa", color: [pg.r, pg.wl, pg.v, pg.w][i] ? X.gn : X.mt, border: `1px solid ${[pg.r, pg.wl, pg.v, pg.w][i] ? "#a7f3d0" : X.bdr}` }}>
                          {[pg.r, pg.wl, pg.v, pg.w][i] ? "✓" : ""} {l}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 48, height: 48, borderRadius: "50%", background: d ? X.gbg : s ? X.abg2 : "#f8f9fa", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.h, fontWeight: 800, fontSize: 17, color: d ? X.gn : s ? X.am : X.mt }}>
                      {d ? "✓" : `${s}/4`}
                    </div>
                  </div>
                </Cd>
              );
            })}
          </div>
        )
      }
    </div>
  );

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
          <div style={{ display: "flex", gap: 8, paddingBottom: 20, borderBottom: `1px solid ${X.bdr}` }}>
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
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
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
            <Bt v="success" size="lg" onClick={e => { e.stopPropagation(); cR(); }}>읽기 완료 → 단어보기</Bt>
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
              <div style={{ fontSize: 18, color: X.sub, fontWeight: 500 }}>{w.kr}</div>
              {w.mp3 && (
                <button
                  type="button"
                  onClick={() => playWordAudio(cA.seq, w.mp3)}
                  style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 20, border: `1px solid ${X.bdr}`, background: "#f8f9fa", cursor: "pointer", fontSize: 13, color: X.sub, fontFamily: F.b }}
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
              <Bt v="success" size="lg" onClick={goWlToVoc}>단어 확인 완료 → 단어퀴즈</Bt>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ─── STUDENT VOCAB ─── */
  const SVoc = () => {
    if (!cA) return null;
    const ws = cW.filter(w => w.pid).slice(0, 8);
    const cor = ws.filter(w => va[w.i] === w.kr).length;
    const vocPass = ws.length > 0 && cor / ws.length >= 0.8;
    const allAnswered = ws.every(w => va[w.i]);
    const isLast = vocIdx >= ws.length - 1;

    /* 결과 화면 */
    if (vd) {
      return (
        <div>
          <Bt v="ghost" onClick={bk} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
          <div style={{ maxWidth: 560, margin: "0 auto" }}>
            {/* 결과 요약 */}
            <div style={{ textAlign: "center", padding: "32px 24px", marginBottom: 20, borderRadius: 20, background: "#fff", border: `1px solid ${X.bdr}`, boxShadow: "0 4px 24px rgba(0,0,0,.07)" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{cor === ws.length ? "🎉" : cor >= ws.length * 0.8 ? "👍" : "📚"}</div>
              <div style={{ fontFamily: F.h, fontWeight: 800, fontSize: 32, color: cor === ws.length ? X.gn : X.am, marginBottom: 4 }}>{cor} / {ws.length}</div>
              <div style={{ fontSize: 14, color: X.sub }}>정답</div>
            </div>
            {/* 문항별 결과 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {ws.map((w, i) => {
                const sel = va[w.i]; const ok = sel === w.kr;
                return (
                  <div key={w.i} style={{ padding: "14px 16px", borderRadius: 12, background: ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${ok ? "#a7f3d0" : "#fecaca"}`, display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: ok ? X.gn : X.rd, flexShrink: 0 }}>{ok ? "✓" : "✗"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{i + 1}. {w.en}</div>
                      {!ok && <div style={{ fontSize: 12, color: X.sub, marginTop: 2 }}>내 답: <span style={{ color: X.rd }}>{sel || "미선택"}</span> / 정답: <span style={{ color: X.gn, fontWeight: 600 }}>{w.kr}</span></div>}
                    </div>
                    {w.mp3 && <button onClick={() => playWordAudio(cA.seq, w.mp3)} style={{ border: `1px solid ${X.bdr}`, background: "#fff", borderRadius: 7, width: 28, height: 28, cursor: "pointer", fontSize: 13 }}>🔊</button>}
                  </div>
                );
              })}
            </div>
            <div style={{ textAlign: "center" }}>
              {vocPass
                ? <Bt v="success" size="lg" onClick={cV}>단어 완료 → 녹음하기</Bt>
                : <Bt v="outline" size="lg" onClick={() => { setVd(false); setVa({}); setVocIdx(0); }}>다시 풀어보기</Bt>}
            </div>
          </div>
        </div>
      );
    }

    /* 퀴즈 화면 */
    const w = ws[vocIdx];
    const opts = w ? (vo[w.i] || [w.kr]) : [];
    const sel = w ? va[w.i] : null;

    return (
      <div>
        <Bt v="ghost" onClick={bk} style={{ marginBottom: 12 }}>← 과제 목록</Bt>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          {/* 헤더 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 20 }}>단어 퀴즈</h2>
            <span style={{ fontSize: 13, color: X.sub, fontWeight: 600 }}>{vocIdx + 1} / {ws.length}</span>
          </div>

          {/* 프로그래스바 — 문항별 슬롯 */}
          <div style={{ display: "flex", gap: 4, marginBottom: 28 }}>
            {ws.map((ww, i) => {
              const answered = !!va[ww.i];
              const isCur = i === vocIdx;
              const bg = isCur
                ? X.ac                        /* 현재 문항: 파랑 */
                : answered
                  ? "#a7f3d0"                 /* 답 선택됨: 연초록 */
                  : "#f1f5f9";                /* 미선택: 연회색 */
              const border = !answered && !isCur ? `1px solid ${X.bdr}` : "none";
              return (
                <button key={i} onClick={() => setVocIdx(i)}
                  style={{ flex: 1, height: 8, borderRadius: 4, border, background: bg, cursor: "pointer", padding: 0, transition: "background .2s", position: "relative" }}>
                  {/* 미선택 문항에 빨간 점 */}
                  {!answered && !isCur && (
                    <span style={{ position: "absolute", top: -5, right: -2, width: 6, height: 6, borderRadius: "50%", background: X.rd, border: "1px solid #fff" }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* 문제 카드 */}
          {w && (
            <div style={{ background: "#fff", borderRadius: 20, border: `1px solid ${X.bdr}`, boxShadow: "0 4px 24px rgba(0,0,0,.07)", padding: "32px 28px", marginBottom: 20 }}>
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
              {/* 선택지 버튼 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {opts.map((o, oi) => {
                  const isSelected = sel === o;
                  return (
                    <button key={oi} onClick={() => setVa(p => ({ ...p, [w.i]: o }))}
                      style={{
                        padding: "14px 20px", borderRadius: 12, border: `2px solid ${isSelected ? X.ac : X.bdr}`,
                        background: isSelected ? X.abg : "#fff", color: isSelected ? X.ac : X.tx,
                        fontFamily: F.b, fontSize: 15, fontWeight: isSelected ? 700 : 400,
                        cursor: "pointer", textAlign: "left", transition: "all .15s",
                        display: "flex", alignItems: "center", gap: 10,
                      }}>
                      <span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${isSelected ? X.ac : X.bdr}`, background: isSelected ? X.ac : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 11, color: "#fff", fontWeight: 700 }}>
                        {isSelected ? "✓" : String.fromCharCode(65 + oi)}
                      </span>
                      {o}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 하단 버튼 */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {vocIdx > 0 && (
              <button onClick={() => setVocIdx(i => i - 1)}
                style={{ padding: "12px 18px", borderRadius: 10, border: `1px solid ${X.bdr}`, background: "#fff", fontSize: 14, fontWeight: 600, fontFamily: F.b, cursor: "pointer", color: X.sub }}>
                ← 이전
              </button>
            )}
            {!isLast ? (
              <button onClick={() => setVocIdx(i => i + 1)}
                style={{ flex: 1, padding: "13px", borderRadius: 10, border: "none", background: X.dk, color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: F.b, cursor: "pointer" }}>
                다음 문제 →
              </button>
            ) : (
              <button onClick={() => setVd(true)} disabled={!allAnswered}
                style={{ flex: 1, padding: "13px", borderRadius: 10, border: "none", background: allAnswered ? X.gn : "#e2e8f0", color: allAnswered ? "#fff" : X.mt, fontSize: 14, fontWeight: 700, fontFamily: F.b, cursor: allAnswered ? "pointer" : "default", transition: "all .2s" }}>
                {allAnswered ? "정답 확인 →" : `정답 확인 (${ws.filter(ww => !va[ww.i]).length}문제 미선택)`}
              </button>
            )}
          </div>

          {/* 전체 진행 요약 */}
          {ws.some(ww => !va[ww.i]) && (
            <p style={{ textAlign: "center", fontSize: 12, color: X.mt, marginTop: 12 }}>
              미선택 문항: {ws.map((ww, i) => !va[ww.i] ? i + 1 : null).filter(Boolean).join(", ")}번
            </p>
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
    const ws = cW.filter(w => w.pid).slice(0, 8);
    const vocCor = ws.filter(w => va[w.i] === w.kr).length;
    const scVoc = scores[`${sSt}_${sArt}`]?.voc;
    const vocLabel = scVoc && scVoc.tot > 0 ? `${scVoc.cor} / ${scVoc.tot} 정답` : (ws.length > 0 ? `${vocCor} / ${ws.length} 정답` : "완료");
    const nSen = sentenceMeta.all.length;
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
    const ss = ["rd", "wl", "voc", "rec", "dn"];
    const ls = ["📖 읽기", "📋 단어보기", "📝 단어퀴즈", "🎤 녹음", "✅ 완료"];
    const ci = ss.indexOf(sv);
    const pg = sArt ? gP(prog, sSt, sArt) : { r: false, wl: false, v: false, w: false };
    const done = pg.r && pg.wl && pg.v && pg.w;
    const canGo = (i) => {
      if (done) return true;
      if (i === 0) return true;
      if (i === 1) return pg.r;
      if (i === 2) return pg.wl;
      if (i === 3) return pg.v;
      if (i === 4) return pg.w;
      return false;
    };
    return (
      <div style={{ display: "flex", gap: 2, marginBottom: 20, background: X.card, borderRadius: 12, padding: 4, border: `1px solid ${X.bdr}` }}>
        {ss.map((s, i) => {
          const active = i === ci;
          const past = i < ci;
          const allowed = canGo(i);
          return (
            <div
              key={s}
              onClick={() => { if (allowed && !active) setSv(s); }}
              style={{ flex: 1, textAlign: "center", padding: "9px 0", borderRadius: 10, fontSize: 12, fontWeight: 600, background: active ? X.dk : past ? X.gbg : "transparent", color: active ? "#fff" : past ? X.gn : X.mt, transition: "all .2s", cursor: allowed && !active ? "pointer" : "default", opacity: allowed ? 1 : 0.4 }}
            >
              {ls[i]}
            </div>
          );
        })}
      </div>
    );
  };

  /* ─── MAIN RENDER ─── */
  const secRefs = { dash: useRef(null), assign: useRef(null), progress: useRef(null), students: useRef(null) };
  const [tAct, setTAct] = useState("dash");

  const scrollTo = (key) => {
    setTAct(key);
    secRefs[key]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const svs = {
    tasks: <STasks />,
    rd: <SRead />,
    wl: <SWl />,
    voc: <SVoc />,
    rec: (
      <StudentRecordingStep
        sSt={sSt}
        sArt={sArt}
        sentenceRows={sentenceMeta.all}
        onSubmit={cRecSubmit}
        onBack={bk}
      />
    ),
    dn: <SDn />,
  };

  return (
    <div style={{ fontFamily: F.b, background: X.bg, minHeight: "100vh", color: X.tx }} onClick={() => setPw(null)}>
      {/* 헤더 */}
      <div style={{ background: X.card, borderBottom: `1px solid ${X.bdr}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <img src="/Bi_new_times_bk.svg" alt="NE Times" style={{ height: 22, width: "auto", display: "block" }} />
          <span style={{ fontFamily: F.b, fontWeight: 700, fontSize: 14, color: "#fff", background: X.dk, padding: "3px 10px", borderRadius: 7, marginTop: 5, display: "inline-block" }}>Class</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {role === "student" && (
            <select style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid ${X.bdr}`, fontSize: 12, fontFamily: F.b }} value={sSt} onChange={e => { setSSt(e.target.value); setSArt(null); setSv("tasks"); }}>
              {dynALL.map(s => <option key={s.id} value={s.id}>{s.nm} ({s.cNm})</option>)}
            </select>
          )}
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 10, padding: 3 }}>
            {[["teacher", "👩‍🏫 선생님"], ["student", "👨‍🎓 학생"]].map(([r, l]) => (
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
        <div style={{ position: "sticky", top: 56, zIndex: 40, background: X.card, borderBottom: `1px solid ${X.bdr}`, padding: "0 24px" }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", gap: 0 }}>
            {[["dash", "대시보드"], ["assign", "기사 배정"], ["progress", "학습 현황"], ["students", "학생 관리"]].map(([v, l]) => (
              <button key={v} onClick={() => scrollTo(v)}
                style={{ padding: "12px 22px", border: "none", borderBottom: tAct === v ? `2px solid ${X.dk}` : "2px solid transparent", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: F.b, background: "transparent", color: tAct === v ? X.tx : X.sub, transition: "all .15s" }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Student 읽기 화면: hero를 컨테이너 밖에 full-width로 렌더 */}
      {role === "student" && sv === "rd" && sArt && <SReadHero />}

      {/* 콘텐츠 영역 */}
      <div style={{ maxWidth: role === "teacher" ? 1280 : 1040, margin: "0 auto", padding: role === "student" && sv === "rd" ? "0 16px 24px" : "24px 16px" }}>
        {role === "teacher" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <div ref={secRefs.dash} style={{ scrollMarginTop: 100, marginBottom: 56 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <span style={{ width: 4, height: 22, borderRadius: 2, background: X.dk, display: "inline-block" }} />
                <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 24, color: X.tx }}>대시보드</h2>
              </div>
              <TDash />
            </div>
            <div ref={secRefs.assign} style={{ scrollMarginTop: 100, marginBottom: 56 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <span style={{ width: 4, height: 22, borderRadius: 2, background: X.ac, display: "inline-block" }} />
                <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 24, color: X.tx }}>기사 배정</h2>
              </div>
              <TAssign />
            </div>
            <div ref={secRefs.progress} style={{ scrollMarginTop: 100, marginBottom: 56 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <span style={{ width: 4, height: 22, borderRadius: 2, background: X.gn, display: "inline-block" }} />
                <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 24, color: X.tx }}>학습 현황</h2>
              </div>
              <TProg />
            </div>
            <div ref={secRefs.students} style={{ scrollMarginTop: 100, marginBottom: 56 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <span style={{ width: 4, height: 22, borderRadius: 2, background: X.am, display: "inline-block" }} />
                <h2 style={{ fontFamily: F.h, fontWeight: 800, fontSize: 24, color: X.tx }}>학생 관리</h2>
              </div>
              <TStudents />
            </div>
          </div>
        ) : (
          <>
            {/* StepBar: 읽기 화면에서는 hero 아래(컨테이너 안 상단)에 위치 */}
            {sv !== "tasks" && sArt && <div style={{ paddingTop: sv === "rd" ? 20 : 0 }}><SB /></div>}
            {svs[sv]}
          </>
        )}
      </div>

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
                  <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 10, padding: 3, gap: 0, marginBottom: 14 }}>
                    {[["직접 선택", false], ["레벨 테스트로 추천받기", true]].map(([lbl, val]) => (
                      <button
                        key={lbl}
                        onClick={() => { setUseLevel(val); if (!val) setLevelPick(null); }}
                        style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: F.b, background: useLevel === val ? "#fff" : "transparent", color: useLevel === val ? X.tx : X.mt, boxShadow: useLevel === val ? "0 1px 3px rgba(0,0,0,.1)" : "none", transition: "all .15s" }}
                      >{lbl}</button>
                    ))}
                  </div>
                  {!useLevel ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {clsData.map(c => {
                        const band = Object.entries(BANDS).find(([k]) => k === c.nm.replace("반", ""));
                        const bc = band ? band[1].c : X.ac;
                        const bbg = band ? band[1].bg : X.abg;
                        const sel = addCId === c.id;
                        return (
                          <button key={c.id} onClick={() => setAddCId(c.id)}
                            style={{ padding: "12px 14px", borderRadius: 10, border: `2px solid ${sel ? bc : X.bdr}`, background: sel ? bbg : "#fff", cursor: "pointer", textAlign: "left", transition: "all .15s" }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: sel ? bc : X.tx, fontFamily: F.h }}>{c.nm}</div>
                            <div style={{ fontSize: 11, color: X.sub, marginTop: 2 }}>{c.sts.length}명 재학 중</div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: 12, color: X.sub, marginBottom: 12 }}>학생이 편하게 읽을 수 있는 문장 수준을 선택하세요.</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {LEVEL_GROUPS.map((g, i) => {
                          const sel = levelPick === i;
                          return (
                            <button key={i} onClick={() => { setLevelPick(i); setAddCId(recommendCId(i)); }}
                              style={{ padding: "14px 16px", borderRadius: 12, border: `2px solid ${sel ? g.color : X.bdr}`, background: sel ? g.bg : "#fff", cursor: "pointer", textAlign: "left", transition: "all .15s" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <span style={{ padding: "2px 10px", borderRadius: 20, background: g.color, color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: F.h }}>{g.label}</span>
                                <span style={{ fontSize: 11, color: X.sub }}>{g.desc}</span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {g.sentences.map((s, si) => (
                                  <div key={si} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                    <span style={{ fontSize: 11, color: g.color, marginTop: 1, flexShrink: 0 }}>›</span>
                                    <span style={{ fontSize: 13, color: sel ? "#1e293b" : X.tx, fontStyle: "italic" }}>{s}</span>
                                  </div>
                                ))}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {recLabel && (
                        <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10, background: LEVEL_GROUPS[levelPick].bg, border: `1px solid ${LEVEL_GROUPS[levelPick].color}22`, display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 18 }}>✨</span>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: LEVEL_GROUPS[levelPick].color }}>추천 반: {recLabel}</div>
                            <div style={{ fontSize: 11, color: X.sub, marginTop: 2 }}>
                              {recCId && clsData.find(c => c.id === recCId) ? "현재 클래스에 배정됩니다." : "해당 반이 없습니다. 직접 선택 탭에서 반을 지정해 주세요."}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
