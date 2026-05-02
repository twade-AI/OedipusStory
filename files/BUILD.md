# Build instructions for Claude Code

Read this file in full before starting. It tells you exactly what to build and how to wire the content together.

## What to build

A single-page educational website that loads `data/scenes.json`, `data/characters.json`, `data/vocab.json`, and `data/quizzes.json`, and renders an interactive Latin choose-your-own-adventure.

## Recommended approach

Plain HTML + CSS + vanilla JavaScript. No framework needed unless the user asks. Keep it as a static site so it can be hosted on GitHub Pages, school servers, or run locally by double-clicking `index.html`.

If you do use React (e.g. with Vite), keep the data files as static JSON imports — do not hardcode content into components.

## Required features

### 1. Scene rendering
- Load scenes from `scenes.json`. Start at scene ID `start`.
- Display: chapter label, scene title (Latin + English), Latin narrative paragraph, the choice question, and the choice buttons.
- Each choice button shows the Latin choice text on top and the English translation in smaller italic underneath.
- Clicking a choice navigates to `choice.next` and adds `choice.clue` to the running clue list.

### 2. Click-to-reveal Latin (critical feature)
- Every Latin word in narrative, questions, and choice text should be wrapped in a span with class `lat`.
- On click, the span toggles a `revealed` state that appends the English meaning in parentheses, italicised.
- Look up English meaning from `vocab.json` using the lowercased word with punctuation stripped.
- If a word is not in vocab, render it as plain text (no underline, no click behaviour).

Implementation hint — write a helper function:
```js
function latinize(text) {
  return text.split(/(\s+|[.,!?;:])/).map(token => {
    if (/^\s+$/.test(token) || /^[.,!?;:]$/.test(token)) return token;
    const clean = token.toLowerCase().replace(/[.,!?;:"']/g, "");
    if (vocab[clean]) {
      return `<span class="lat" data-en="${vocab[clean]}">${token}</span>`;
    }
    return token;
  }).join("");
}
```

CSS for the reveal:
```css
.lat { cursor: pointer; border-bottom: 1px dotted #888; }
.lat:hover { background: #fff3cd; }
.lat.revealed::after { content: " (" attr(data-en) ")"; font-style: italic; opacity: 0.85; }
```

### 3. Character cards
- A "Personae" tab shows character cards for everyone the student has met.
- "Met" = the character's ID appears in any visited scene's `chars` array.
- Each card shows: coloured avatar with initials, name, Latin title + English, Latin bio + English, four stat bars (sapientia, fortitudo, superbia, fatum), Latin catchphrase + English.
- Stat bars: render a horizontal bar filled to `(value / 10) * 100%` width, coloured with the character's theme colour.

### 4. Comprehension quizzes
- When a scene with a matching key in `quizzes.json` is shown, display the quiz inline beneath the narrative.
- Four options. Clicking shows correct/wrong feedback (green/red), then displays the explanation.
- After answering, the quiz stays answered for that scene — don't re-prompt if the student returns.

### 5. Clue tracker
- An "Indicia" tab lists every clue gathered, in order, numbered.
- Clues are added when a choice is made. Don't add duplicates.
- Render the Latin clue with `latinize()` so it's also clickable.

### 6. Vocabulary tracker
- A "Verba" tab lists every Latin word the student has actually encountered in their playthrough.
- Compute this dynamically: walk through visited scenes, tokenise all Latin text, intersect with vocab keys.
- Display as a two-column grid: Latin word, English meaning.

### 7. Reset button
- "Iterum" button that wipes state and returns to the start scene. Useful for classroom replay.

## State shape

```js
const state = {
  current: "start",        // scene ID
  history: [],             // visited scene IDs in order
  clues: [],               // list of clue strings (Latin)
  charsMet: new Set(),     // character IDs unlocked
  quizDone: {},            // { sceneId: "correct" | "wrong" }
  view: "story"            // story | cards | clues | vocab
};
```

Persist to `localStorage` if you want students to resume — optional but nice.

## Visual design

- **Colour palette**: warm parchment background (`#faf6ee` light mode), deep navy or aubergine accents. Avoid bright cartoon colours.
- **Typography**: serif headings (EB Garamond, Cormorant, or Crimson Text from Google Fonts), sans-serif body (Inter or system stack).
- **Character colour map** (use these hex values for stat bars and avatar backgrounds):
  - purple: `#7F77DD` fill, `#CECBF6` background
  - pink: `#D4537E` fill, `#F4C0D1` background
  - blue: `#378ADD` fill, `#B5D4F4` background
  - amber: `#BA7517` fill, `#FAC775` background
  - teal: `#1D9E75` fill, `#9FE1CB` background
  - coral: `#D85A30` fill, `#F5C4B3` background

## Mobile

Students will use iPads. Make sure:
- Tap targets are at least 44px tall
- Latin words have enough spacing to tap individually
- Choice buttons stack vertically on narrow screens
- Tab bar wraps or scrolls horizontally if needed

## Accessibility

- Click-to-reveal Latin words should also work with keyboard (tabindex, Enter key)
- Quiz answers should be announced to screen readers
- Sufficient colour contrast (avoid yellow text on white)

## Out of scope (do not build unless asked)

- User accounts / login
- Multiplayer or class leaderboards
- Audio narration (could be a future feature)
- AI-generated story expansion (the content is fixed in JSON)

## When you're done

- Run a local server (`python -m http.server` or `npx serve`) and click through the whole story end to end
- Verify all three opening branches work
- Check at least one quiz triggers and gives feedback
- Confirm character cards unlock as you progress
- Test on a phone-sized viewport
