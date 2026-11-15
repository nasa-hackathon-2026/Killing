# Website translation guide

Use this guide when changing a visible sentence, adding a language, or reviewing a translation. The website keeps scientific numbers and evidence the same across reader roles; only the explanation and default detail level change.

## Message files

- English is the source and fallback. Put each key in `web/src/i18n/locales/en/<namespace>.json` and its Traditional Chinese counterpart in `zh-TW/`. The Japanese, German and French files are translated by AI tools and have not been proofread by native speakers.
- Keep the same namespace, nested keys and `{{placeholder}}` names in every language. A missing translated key falls back to English at runtime; a missing file or key fails `node web/scripts/check-locales.mjs`.
- Use `general` for plain language and `expert` for statistical terms when a message needs two voices. Everyone and Student read `general`; Researcher reads `expert`. Student also opens definitions and reading tips.
- Add a short translator note to `en/_context.json` when introducing a namespace. For a term that needs more context, add a key-specific note such as `trend.change`.

## Scientific wording

- Translate “not significant” as “no clear change in this record,” with the explicit caveat that this does not mean no change.
- Keep model and satellite retrieval distinct from measurements made in situ. A model-derived change is not automatically an observed climate change.
- A trend with a documented step or disagreement uses the “not reliable as a climate signal” caution and the crossed-out trend mark. Preserve the numbers, units, uncertainty, source names and limitations.
- Companion speech states data facts and how to read the display. It does not attribute causes or offer a climate conclusion. The particle direction and layer heights are illustrative.

## Review

1. Change English and Traditional Chinese messages together; write the `ja`, `de` and `fr` values too, in the wording the existing files use, and mark them as AI translations not yet proofread. Use `node web/scripts/check-locales.mjs --sync` when adding keys: it copies the English text into the missing keys, which then have to be translated.
2. Run `npm test --prefix web` to check key sets, placeholders, nonempty values and related behavior tests.
3. Check the affected page at both Everyone and Researcher settings, including a place with no data and a cautioned GLDAS trend. Check narrow widths and the keyboard path when changing controls.

The German, French and Japanese text is translated by AI tools and has not been proofread by native speakers. Any AI drafted translation needs scientific review and native-speaker review before publication as reviewed copy.
