function repeat(text, count) {
  return Array.from({ length: count }, () => text).join("");
}

function repeatWithParagraphs(text, count) {
  return Array.from({ length: count }, () => text).join("\n\n");
}

function sectionTransitionsForParagraphs(paragraph, count) {
  return Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
    offset: (paragraph.length + 2) * (index + 1),
    headingIndex: index + 1,
  }));
}

const jaGeneral = "この記事では、文章を読みやすく表示するための小さな工夫を紹介します。表示単位を順番に確認しながら、必要な場所で短い間を置くと、画面を追う負担を減らせます。";
const jaTechnical = "Readerは本文を意味のある単位へ分割し、各単位に入力位置と文の境界を保持します。処理の結果は表示層から独立しているため、ChromeとSafariで同じ文章を同じ規則で扱えます。";
const jaDialogue = "「準備はできましたか」と彼女が尋ねると、彼は画面を確認してから「はい、次の段落へ進めます」と答えました。二人は急がず、途中の画像も一つずつ確認しました。";
const jaShortSentences = "まず読む。次に止める。位置を確認する。画像を開く。説明を読む。本文へ戻る。もう一度再生する。";
const jaLongSentence = "文章のまとまりが長くなっても、読み手が現在位置を見失わないように、文の境界、句読点、改行、補足、引用、画像の位置を順に調べ、表示単位の長さを安全な範囲へ収めながら、前後の文脈と進捗を保ったまま次の単位へ渡します。";
const mixedCodeNumbers = "設定値はreader.v2.3.14で管理し、最大12 graphemes、待機時間は240msから600msの範囲に収めます。URL https://example.invalid/read?id=21、識別子 9f4c-21ab、コード `displayDuration()` のような長いLatin tokenも入力として扱います。";
const enGeneral = "This small reading fixture describes a calm way to move through an article. Each display unit keeps its source position, and a short pause at a sentence boundary gives the reader time to look ahead. ";

const jaTechnicalText = repeatWithParagraphs(jaTechnical, 5);
const jaDialogueText = repeatWithParagraphs(jaDialogue, 5);
const mixedCodeNumbersText = repeatWithParagraphs(mixedCodeNumbers, 4);
const enGeneralText = repeatWithParagraphs(enGeneral, 4);

export const timingCorpus = [
  {
    id: "ja-general",
    locale: "ja",
    text: `${repeat(jaGeneral, 5)}最後に、読み手が自分の速度を確かめられるようにします。`,
    initialHeadingIndex: 0,
    sectionTransitions: [],
  },
  {
    id: "ja-technical",
    locale: "ja",
    text: jaTechnicalText,
    initialHeadingIndex: 0,
    sectionTransitions: sectionTransitionsForParagraphs(jaTechnical, 5),
  },
  {
    id: "ja-dialogue",
    locale: "ja",
    text: jaDialogueText,
    initialHeadingIndex: 0,
    sectionTransitions: sectionTransitionsForParagraphs(jaDialogue, 5),
  },
  {
    id: "ja-short-sentences",
    locale: "ja",
    text: repeat(jaShortSentences, 8),
    initialHeadingIndex: 0,
    sectionTransitions: [],
  },
  {
    id: "ja-long-sentence",
    locale: "ja",
    text: repeat(jaLongSentence, 3),
    initialHeadingIndex: 0,
    sectionTransitions: [],
  },
  {
    id: "mixed-code-numbers",
    locale: "ja",
    text: mixedCodeNumbersText,
    initialHeadingIndex: 0,
    sectionTransitions: sectionTransitionsForParagraphs(mixedCodeNumbers, 4),
  },
  {
    id: "en-general",
    locale: "en",
    text: enGeneralText,
    initialHeadingIndex: 0,
    sectionTransitions: sectionTransitionsForParagraphs(enGeneral, 4),
  },
];
