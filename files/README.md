# Oedipus Detective — Year 7 Latin Adventure

An interactive choose-your-own-adventure website for Year 7 Latin students. The story of Oedipus told as a detective novel, written in beginner Latin with click-to-reveal English translations.

## Project brief for Claude Code

Build a single-page website that delivers a branching Latin story with these features:

1. **Branching narrative** — students make choices that lead to different scenes. Multiple routes converge toward the same tragic reveal.
2. **Click-to-reveal Latin** — every Latin word is clickable. Click once to show English meaning, click again to hide. Use the `vocab.json` lookup.
3. **Character cards** — when students meet a character in the story, that character's card unlocks in a "Personae" section. Cards show stats, a Latin catchphrase, and a short bio.
4. **Comprehension quizzes** — multiple choice questions appear in key scenes. Students get feedback (correct/incorrect) and an explanation.
5. **Clue tracker** — each choice yields a "clue" added to a running detective-style evidence list.
6. **Vocabulary tracker** — automatically tracks which Latin words a student has encountered through the story.

## Recommended tech stack

- **Plain HTML + CSS + JavaScript** is fine — keep it simple so it runs anywhere a school can host static files.
- **Or React + Vite** if you want component structure (`<Scene>`, `<CharacterCard>`, `<Quiz>`, `<Vocab>`).
- **Tailwind CSS** for styling if using React.
- No backend needed. All state lives in the browser.

## Suggested file layout

```
oedipus-detective/
├── index.html
├── style.css
├── app.js          (or src/App.jsx if React)
├── data/
│   ├── scenes.json
│   ├── characters.json
│   ├── vocab.json
│   └── quizzes.json
└── README.md
```

## Design notes

- **Visual feel**: ancient parchment vibe is fine, but stay readable. Serif headings (something like Cormorant or EB Garamond), clean sans body (Inter or system).
- **Mobile-first** — students will use iPads. Tap targets must be finger-sized.
- **Click-to-reveal** should be obvious: dotted underline under Latin words, hover state on desktop, brief highlight when revealed.
- **Character cards** can have coloured accents — assign each character a colour palette.
- **The tragedy**: Jocasta's death and the marriage to mother are stated plainly but not dwelt on. Oedipus's self-blinding is implied through his final line about "now truly seeing." Keep this tone — age-appropriate but faithful.

## Content files

All content sits in the four JSON files below. Schemas are documented at the top of each file. Edit content freely — the story can be expanded with more branches, more characters, more vocab.

## Latin level

Year 7 / first-year Latin. Mostly present tense, simple accusatives, basic relative pronouns. Some perfect tense (necavit, dixit, fugit) where the narrative demands past action — these are flagged in vocab and clickable like everything else.
