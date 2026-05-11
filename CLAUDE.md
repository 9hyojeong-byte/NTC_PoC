# NTC_PoC_v02 — NE Times Class PoC

## 프로젝트 개요
NE Times 영어 기사를 활용한 교실 학습 관리 시스템 PoC.
선생님이 학생별로 기사를 배정하고, 학생의 학습 진행을 추적한다.

## 기술 스택
- **React 18 + Vite 6** (ES Module)
- 별도 CSS 파일 없음 — 인라인 스타일 + JS 상수(`src/lib/constants.js`)
- 상태: React useState / 로컬스토리지(`ntc_rec_v1_` 키)
- 데이터: `src/data/` JSON 파일 → `src/lib/selectors.js` 어댑터

## 주요 파일
| 파일 | 역할 |
|------|------|
| `src/App.jsx` | 단일 메인 컴포넌트 (~87KB) |
| `src/lib/constants.js` | 디자인 토큰, 반/학생 seed 데이터, 난이도 매핑 |
| `src/lib/selectors.js` | JSON → App 내부 포맷 어댑터 |
| `src/lib/audio.js` | 단어 MP3 재생 헬퍼 |
| `src/data/articles.json` | 기사 원문 + 번역 (4개) |
| `src/data/words.json` | 기사별 어휘 (16단어/기사) |
| `src/data/workbook.json` | 학습 활동 퀴즈 데이터 |

## 기사 & 난이도
| articleSeq | 난이도 | 색상 |
|-----------|--------|------|
| 786 | 입문 | 초록 |
| 785 | 기초 | 파랑 |
| 121 | 기본 | 주황 |
| 122 | 기본 | 주황 |

## 학습 활동 유형
`Word Choice` / `Multiple Choice` / `Unscramble` / `Matching` / `True/False`

## 학생 진행 상태 키
- `r` 읽기 완료 / `wl` 단어보기 / `v` 단어퀴즈 / `w` 녹음 제출

## 개발 명령어
```bash
npm run dev      # http://localhost:5173
npm run build    # dist/ 생성
npm run preview  # 빌드 미리보기
```

## 코딩 컨벤션
- 변수명 단축 표기 사용: `X`(색상), `F`(폰트), `CLS`(반), `ALL`(전체학생), `IA`(초기배정)
- 인라인 스타일은 `X.xxx` 토큰 참조
- 오디오: `public/audio/words/{articleSeq}/{wordSeq}.mp3`
