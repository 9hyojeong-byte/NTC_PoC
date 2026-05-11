/**
 * selectors.js
 * JSON 데이터를 App이 기대하는 형태(ARTS / W / WB)로 변환하는 어댑터.
 * 스키마가 바뀌어도 이 파일만 수정하면 된다.
 */

import articlesRaw from "../data/articles.json";
import wordsRaw from "../data/words.json";
import workbookRaw from "../data/workbook.json";

/* ─── ARTS: App이 사용하는 기사 배열 ─── */
export const ARTS = articlesRaw.articles.map((a) => {
  // 모든 섹션의 단락을 하나의 ps 배열로 평탄화
  const ps = a.sections.flatMap((sec) =>
    sec.paragraphs.map((p) => ({
      pid: p.pid,
      en: p.text_with_placeholders,
      kr: p.text_kr,
    }))
  );

  return {
    seq: a.articleSeq,
    title: a.articleTitle,
    tkr: a.articleTitleKr,
    lv: a.articleLevel,
    tp: a.newspaperType,
    topic: a.uxTopic,
    tc: a.uxTopicCode,
    // 이미지: JSON에 없으면 neungyule CDN 패턴으로 fallback
    img:
      a.imageUrl && a.imageUrl.trim()
        ? a.imageUrl
        : `https://upfile.neungyule.com/upload_admin/2026/03/${a.articleSeq}_p${
            a.articleSeq === "121"
              ? "06"
              : a.articleSeq === "122"
              ? "05"
              : a.articleSeq === "785"
              ? "10"
              : "05"
          }.jpg`,
    mp3: a.mp3Url || "#",
    ps,
  };
});

/* ─── W: { [articleSeq]: wordArray } ─── */
export const W = Object.fromEntries(
  wordsRaw.items.map((item) => [
    item.articleSeq,
    item.words.map((w) => ({
      i: w.wordIndex,
      en: w.english,
      kr: w.meaning_kr,
      mp3: w.mp3File,
      pid: w.pid ?? null,
    })),
  ])
);

/* ─── WB: { [articleSeq]: activityArray } ─── */
// JSON type → App 내부 type 매핑
const TYPE_MAP = {
  word_choice: "wc",
  multiple_choice: "mc",
  unscramble: "us",
  matching: "mt",
  true_false: "tf",
  vocabulary_puzzle: null, // 미지원 → 선생님과 함께 처리
  word_search_vocabulary: null,
  short_answer: null,
  discussion: null,
  speak_out: null,
};

export const WB = Object.fromEntries(
  workbookRaw.items.map((item) => {
    const activities = item.activities
      .map((act) => {
        const t = TYPE_MAP[act.type];
        if (!t) return null; // 미지원 타입은 제외

        if (t === "wc") {
          return {
            t: "wc",
            title: act.title,
            qs: act.questions.map((q) => ({
              id: q.id,
              p: q.prompt,
              o: q.options,
              a: q.answer,
            })),
          };
        }

        if (t === "mc") {
          return {
            t: "mc",
            title: act.title,
            qs: act.questions.map((q) => ({
              id: q.id,
              p: q.prompt,
              o: q.options,
              a: q.answer,
            })),
          };
        }

        if (t === "us") {
          return {
            t: "us",
            title: act.title,
            qs: act.questions.map((q) => ({
              id: q.id,
              j: q.jumbled,
              a: q.answer,
            })),
          };
        }

        if (t === "mt") {
          return {
            t: "mt",
            title: act.title,
            left: act.leftItems,
            right: act.rightItems,
            ans: act.answers,
          };
        }

        if (t === "tf") {
          return {
            t: "tf",
            title: act.title,
            qs: act.questions.map((q) => ({
              id: q.id,
              p: q.prompt,
              a: q.answer,
            })),
          };
        }

        return null;
      })
      .filter(Boolean);

    return [item.articleSeq, activities];
  })
);
