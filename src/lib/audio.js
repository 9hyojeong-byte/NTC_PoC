/**
 * audio.js
 * 단어 오디오 재생 헬퍼.
 * 경로 규칙: /audio/words/{articleSeq}/{mp3File}
 */

/**
 * 단어 오디오 URL을 반환한다.
 * @param {string} articleSeq - 기사 시퀀스 번호 (예: "121")
 * @param {string} mp3File    - mp3 파일명 (예: "001.mp3")
 * @returns {string} public 기준 절대 경로
 */
export function wordAudioUrl(articleSeq, mp3File) {
  return `/audio/words/${articleSeq}/${mp3File}`;
}

/**
 * 단어 오디오를 재생한다.
 * mp3File이 없으면 Web Speech API(TTS)로 영어 단어를 읽어준다.
 * @param {string} articleSeq
 * @param {string} mp3File
 * @param {string} [englishWord] - mp3File 없을 때 TTS 폴백용 영어 단어
 */
export function playWordAudio(articleSeq, mp3File, englishWord) {
  if (!mp3File) {
    // TTS 폴백: 브라우저 내장 Web Speech API로 발음
    if (englishWord && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(englishWord);
      utt.lang = "en-US";
      utt.rate = 0.85;
      window.speechSynthesis.speak(utt);
    }
    return;
  }
  const url = mp3File.startsWith("http")
    ? mp3File
    : wordAudioUrl(articleSeq, mp3File);
  const audio = new Audio(url);
  audio.play().catch(() => {
    // 오디오 파일 없거나 브라우저 정책으로 재생 실패 시 무시
  });
}
