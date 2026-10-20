import type { Dictionary, LanguageCode } from "./i18n";

// Headings for the explanatory safety guide. The topic text lives in
// i18n-completion-d; these labels were accidentally left in English there.
const labels: Record<
  Exclude<LanguageCode, "en">,
  readonly [pattern: string, why: string, consequence: string, response: string, expand: string, collapse: string]
> = {
  zh: ["可以从中学到什么", "为什么会发生", "可能造成什么后果", "需要知道的", "查看解释", "收起解释"],
  hi: ["इससे क्या सीखें", "यह क्यों होता है", "इसके क्या परिणाम हो सकते हैं", "क्या जानना ज़रूरी है", "व्याख्या पढ़ें", "व्याख्या छिपाएँ"],
  es: ["Lo que se repite", "Por qué ocurre", "Qué consecuencias puede tener", "Qué conviene saber", "Leer la explicación", "Ocultar la explicación"],
  fr: ["Ce qui se répète", "Pourquoi cela arrive", "Les conséquences possibles", "Ce qu’il faut savoir", "Lire l’explication", "Masquer l’explication"],
  ar: ["ما الذي نتعلمه", "لماذا يحدث هذا", "ما العواقب المحتملة", "ما الذي ينبغي معرفته", "اقرأ التفسير", "أخفِ التفسير"],
  bn: ["এ থেকে যা বোঝা যায়", "এটি কেন ঘটে", "কী পরিণতি হতে পারে", "যা জানা দরকার", "ব্যাখ্যা পড়ুন", "ব্যাখ্যা লুকান"],
  pt: ["O que se repete", "Por que acontece", "Quais podem ser as consequências", "O que vale saber", "Ler a explicação", "Ocultar a explicação"],
  ru: ["Что из этого следует", "Почему это происходит", "К чему это может привести", "Что важно понимать", "Читать объяснение", "Скрыть объяснение"],
  ur: ["اس سے کیا سمجھیں", "یہ کیوں ہوتا ہے", "اس کے کیا نتائج ہو سکتے ہیں", "کیا جاننا ضروری ہے", "وضاحت پڑھیں", "وضاحت چھپائیں"],
  id: ["Pola yang sering muncul", "Mengapa ini terjadi", "Apa dampaknya", "Yang perlu diketahui", "Baca penjelasan", "Sembunyikan penjelasan"],
  de: ["Was sich daraus ergibt", "Warum das passiert", "Welche Folgen es haben kann", "Was man wissen sollte", "Erklärung lesen", "Erklärung ausblenden"],
  ja: ["繰り返し起きること", "なぜ起きるのか", "どんな結果につながるか", "知っておくこと", "説明を読む", "説明を閉じる"],
  sw: ["Mambo yanayojirudia", "Kwa nini hutokea", "Matokeo yanayoweza kutokea", "Unachohitaji kujua", "Soma maelezo", "Ficha maelezo"],
  mr: ["यातून काय समजते", "हे का घडते", "त्याचे काय परिणाम होऊ शकतात", "काय समजून घ्यावे", "स्पष्टीकरण वाचा", "स्पष्टीकरण लपवा"],
  te: ["ఇలా తరచూ జరిగేవి", "ఇది ఎందుకు జరుగుతుంది", "దీనివల్ల ఏమి జరగవచ్చు", "తెలుసుకోవలసినది", "వివరణ చదవండి", "వివరణ దాచండి"],
  tr: ["Tekrarlanan örüntüler", "Neden oluyor", "Neye yol açabilir", "Bilmeniz gerekenler", "Açıklamayı oku", "Açıklamayı gizle"],
  ta: ["இதிலிருந்து அறிய வேண்டியது", "இது ஏன் நடக்கிறது", "இதன் விளைவுகள் என்ன", "தெரிந்துகொள்ள வேண்டியது", "விளக்கத்தைப் படிக்கவும்", "விளக்கத்தை மறைக்கவும்"],
  vi: ["Những điều thường lặp lại", "Vì sao xảy ra", "Hậu quả có thể là gì", "Điều cần biết", "Đọc lời giải thích", "Ẩn lời giải thích"],
  ko: ["반복되는 패턴", "왜 일어날까요", "어떤 결과가 생길까요", "알아둘 점", "설명 읽기", "설명 숨기기"],
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
