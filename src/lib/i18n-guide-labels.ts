import type { Dictionary, LanguageCode } from "./i18n";

// Headings for the explanatory safety guide. The topic text lives in
// i18n-completion-d; these labels were accidentally left in English there.
const labels: Record<
  Exclude<LanguageCode, "en">,
  readonly [pattern: string, why: string, consequence: string, response: string, expand: string, collapse: string]
> = {
  zh: ["可以从中学到什么", "为什么会发生", "可能造成什么后果", "如何理解与应对", "查看解释", "收起解释"],
  hi: ["इससे क्या सीखें", "यह क्यों होता है", "इसके क्या परिणाम हो सकते हैं", "इसे कैसे समझें", "व्याख्या पढ़ें", "व्याख्या छिपाएँ"],
  es: ["Lo que se repite", "Por qué ocurre", "Qué consecuencias puede tener", "Cómo entenderlo y reaccionar", "Leer la explicación", "Ocultar la explicación"],
  fr: ["Ce qui se répète", "Pourquoi cela arrive", "Les conséquences possibles", "Comment comprendre et réagir", "Lire l’explication", "Masquer l’explication"],
  ar: ["ما الذي نتعلمه", "لماذا يحدث هذا", "ما العواقب المحتملة", "كيف نفهمه ونتعامل معه", "اقرأ التفسير", "أخفِ التفسير"],
  bn: ["এ থেকে যা বোঝা যায়", "এটি কেন ঘটে", "কী পরিণতি হতে পারে", "কীভাবে বুঝবেন ও সাড়া দেবেন", "ব্যাখ্যা পড়ুন", "ব্যাখ্যা লুকান"],
  pt: ["O que se repete", "Por que acontece", "Quais podem ser as consequências", "Como entender e reagir", "Ler a explicação", "Ocultar a explicação"],
  ru: ["Что из этого следует", "Почему это происходит", "К чему это может привести", "Как это понять и реагировать", "Читать объяснение", "Скрыть объяснение"],
  ur: ["اس سے کیا سمجھیں", "یہ کیوں ہوتا ہے", "اس کے کیا نتائج ہو سکتے ہیں", "اسے کیسے سمجھیں اور ردعمل دیں", "وضاحت پڑھیں", "وضاحت چھپائیں"],
  id: ["Pola yang sering muncul", "Mengapa ini terjadi", "Apa dampaknya", "Cara memahami dan merespons", "Baca penjelasan", "Sembunyikan penjelasan"],
  de: ["Was sich daraus ergibt", "Warum das passiert", "Welche Folgen es haben kann", "Wie man es versteht und reagiert", "Erklärung lesen", "Erklärung ausblenden"],
  ja: ["繰り返し起きること", "なぜ起きるのか", "どんな結果につながるか", "どう理解し対応するか", "説明を読む", "説明を閉じる"],
  sw: ["Mambo yanayojirudia", "Kwa nini hutokea", "Matokeo yanayoweza kutokea", "Jinsi ya kuelewa na kujibu", "Soma maelezo", "Ficha maelezo"],
  mr: ["यातून काय समजते", "हे का घडते", "त्याचे काय परिणाम होऊ शकतात", "कसे समजून प्रतिसाद द्यावा", "स्पष्टीकरण वाचा", "स्पष्टीकरण लपवा"],
  te: ["ఇలా తరచూ జరిగేవి", "ఇది ఎందుకు జరుగుతుంది", "దీనివల్ల ఏమి జరగవచ్చు", "దీనిని అర్థం చేసుకుని స్పందించడం", "వివరణ చదవండి", "వివరణ దాచండి"],
  tr: ["Tekrarlanan örüntüler", "Neden oluyor", "Neye yol açabilir", "Nasıl anlayıp karşılık verebilirsiniz", "Açıklamayı oku", "Açıklamayı gizle"],
  ta: ["இதிலிருந்து அறிய வேண்டியது", "இது ஏன் நடக்கிறது", "இதன் விளைவுகள் என்ன", "எப்படிப் புரிந்து பதிலளிப்பது", "விளக்கத்தைப் படிக்கவும்", "விளக்கத்தை மறைக்கவும்"],
  vi: ["Những điều thường lặp lại", "Vì sao xảy ra", "Hậu quả có thể là gì", "Cách hiểu và phản ứng", "Đọc lời giải thích", "Ẩn lời giải thích"],
  ko: ["반복되는 패턴", "왜 일어날까요", "어떤 결과가 생길까요", "어떻게 이해하고 대응할까요", "설명 읽기", "설명 숨기기"],
};

export const guideLabelTranslations = Object.fromEntries(
  Object.entries(labels).map(([code, value]) => [
    code,
    {
      guidePatternTitle: value[0],
      guideWhyLabel: value[1],
      guideConsequenceLabel: value[2],
      guideReasoningLabel: value[3],
      guideExpand: value[4],
      guideCollapse: value[5],
    } satisfies Dictionary,
  ]),
) as Partial<Record<LanguageCode, Dictionary>>;
