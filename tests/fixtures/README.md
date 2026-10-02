`manga-layout.png` is a synthetic OCR fixture drawn locally with Windows
System.Drawing and the Yu Gothic font. It contains two vertical dialogue
columns (日本語を勉強します and 今日は晴れです), a horizontal heading
(漫画の発売予定), and panel/speech-bubble outlines. It contains no third-party
manga artwork. The integration test uses the bundled Japanese traineddata
without downloading models.

`manga-dialogue-regions.png` extends that fixture with two vertical columns
inside the left speech bubble (本を読みます and 楽しいです). The OCR integration
test checks that each bubble becomes one dialogue region and the horizontal
heading stays separate. Geometry fixtures in the regression tests additionally
cover punctuation, numbers, furigana, and bubble/panel dividers.
