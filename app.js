// Oedipus Detective — interactive Latin choose-your-own-adventure
(() => {
  'use strict';

  const STORAGE_KEY = 'oedipus-detective:v1';

  const COLORS = {
    purple: { fill: '#7F77DD', bg: '#CECBF6' },
    pink:   { fill: '#D4537E', bg: '#F4C0D1' },
    blue:   { fill: '#378ADD', bg: '#B5D4F4' },
    amber:  { fill: '#BA7517', bg: '#FAC775' },
    teal:   { fill: '#1D9E75', bg: '#9FE1CB' },
    coral:  { fill: '#D85A30', bg: '#F5C4B3' },
  };

  const data = { scenes: null, characters: null, vocab: null, quizzes: null, choruses: null, drills: null };

  const state = {
    current: 'sphinx_riddle',  // new students start with the prologue riddle
    history: [],       // visited scene IDs in order
    clues: [],
    charsMet: new Set(),
    quizDone: {},      // { sceneId: 'correct' | 'wrong' }
    traits: {},        // { tag: count } — accumulated through choices
    endingsSeen: [],   // ending scene IDs the student has reached, persisted across resets
    sphinxSolved: false, // once the Sphinx is defeated, replays skip the prologue
    mode: 'discipulus',  // 'tiro' (all English visible) | 'discipulus' (reveal on tap) | 'magister' (Latin only)
    chaptersSeen: [],  // chapter labels for which the chorus has been shown this playthrough
    wordStats: {},     // { word: { encountered: N, clicked: M } } — cumulative across all replays
    achievements: [],  // medallion IDs earned, cumulative across all replays
    drillResults: {},  // { chapter: { drillIndex: 'correct' | 'wrong:N' } } — cumulative
    view: 'story',
  };

  // --- achievements ---------------------------------------------------------
  // Each is keyed by id, has a Latin name, an English description, an icon
  // glyph (kept ASCII-friendly so the existing serif rendering is fine), and a
  // test() that runs against current state. Once awarded, an achievement stays
  // in state.achievements forever — even if its test would no longer pass.
  const ACHIEVEMENTS = [
    { id: 'solver',     la: 'Solutor',     en: 'Sphinx-solver',
      desc: 'Defeat the Sphinx in the prologue.',                    icon: 'Σ',
      test: () => state.sphinxSolved },
    { id: 'discipulus', la: 'Discipulus',  en: 'First fate seen',
      desc: 'Reach any ending for the first time.',                  icon: 'Ι',
      test: () => state.endingsSeen.length >= 1 },
    { id: 'detective',  la: 'Detector',    en: 'All scenes visited',
      desc: 'Visit every story scene at least once across replays.', icon: 'Δ',
      test: () => {
        if (!data.scenes) return false;
        const all = Object.keys(data.scenes).filter(k => !k.startsWith('_'));
        return all.length > 0 && all.every(id => state.history.includes(id));
      }},
    { id: 'magnum',     la: 'Magnum opus', en: 'All four fates known',
      desc: 'Unlock all four endings.',                              icon: '✦',
      test: () => state.endingsSeen.length >= 4 },
    { id: 'audax',      la: 'Audax',       en: 'A bold path',
      desc: 'Make 5+ confrontational choices in a single playthrough.', icon: '⚔',
      test: () => (state.traits.confront || 0) >= 5 },
    { id: 'patiens',    la: 'Patiens',     en: 'A patient path',
      desc: 'Make 5+ patient choices in a single playthrough.',      icon: '◯',
      test: () => (state.traits.patient || 0) >= 5 },
    { id: 'sapiens',    la: 'Sapiens',     en: 'Hundred verba mastered',
      desc: 'Master 100 Latin words across all your sessions.',      icon: '★',
      test: () => Object.values(state.wordStats || {}).filter(s => isMastered(s)).length >= 100 },
    { id: 'magisterMode', la: 'Magister',  en: 'Latin only',
      desc: 'Reach an ending while in Magister mode (Latin only).',  icon: '◈',
      test: () => state.mode === 'magister' && state.endingsSeen.length >= 1 },
    { id: 'verus',      la: 'Verus iudex', en: 'All quizzes correct',
      desc: 'Answer every quiz correctly in a single run (≥5 quizzes).', icon: '◊',
      test: () => {
        const { correct, answered } = quizScore();
        return answered >= 5 && correct === answered;
      }},
    { id: 'pius',       la: 'Pius',        en: 'Pious heart',
      desc: 'Make 4+ pious choices in a single playthrough.',        icon: '☉',
      test: () => (state.traits.pious || 0) >= 4 },
  ];

  function evaluateAchievements() {
    if (!data.scenes) return;
    const newly = [];
    for (const a of ACHIEVEMENTS) {
      if (state.achievements.includes(a.id)) continue;
      try {
        if (a.test()) {
          state.achievements.push(a.id);
          newly.push(a);
        }
      } catch (_) { /* ignore */ }
    }
    if (newly.length) {
      save();
      newly.forEach(showAchievementToast);
    }
  }

  function showAchievementToast(a) {
    const t = document.createElement('div');
    t.className = 'achievement-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${escapeHtml(a.icon)}</span>
      <div class="toast-body">
        <p class="toast-title">Honor &middot; <strong>${escapeHtml(a.la)}</strong></p>
        <p class="toast-desc"><em>${escapeHtml(a.en)}</em> — ${escapeHtml(a.desc)}</p>
      </div>`;
    document.body.appendChild(t);
    // entrance + exit animation purely via CSS class swaps
    requestAnimationFrame(() => t.classList.add('toast-in'));
    setTimeout(() => {
      t.classList.remove('toast-in');
      t.classList.add('toast-out');
      setTimeout(() => t.remove(), 600);
    }, 4500);
  }

  // A word counts as "mastered" once the student has met it ≥3 times AND
  // didn't need a gloss for the majority of those encounters.
  const MASTERY_MIN_ENCOUNTERS = 3;
  const MASTERY_MAX_CLICK_RATIO = 0.34;
  function isMastered(stats) {
    if (!stats || stats.encountered < MASTERY_MIN_ENCOUNTERS) return false;
    return (stats.clicked / stats.encountered) <= MASTERY_MAX_CLICK_RATIO;
  }

  const TRAIT_LABELS = {
    patient:    { la: "patientia",   en: "patience" },
    confront:   { la: "ira",         en: "confrontation" },
    proud:      { la: "superbia",    en: "pride" },
    pious:      { la: "pietas",      en: "piety" },
    compassion: { la: "humanitas",   en: "compassion" },
    denial:     { la: "negatio",     en: "denial" },
  };
  const ENDING_IDS = ['ending', 'ending_hubris', 'ending_denial', 'ending_dignity'];
  const ENDING_LABELS = {
    ending:          { la: "Veritas videns",  en: "The classical fate" },
    ending_hubris:   { la: "Furor regis",     en: "A king's madness" },
    ending_denial:   { la: "Casus regis",     en: "A king's fall" },
    ending_dignity:  { la: "Pietas regis",    en: "A dignified exile" },
  };

  const app = document.getElementById('app');

  // --- persistence ----------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        current: state.current,
        history: state.history,
        clues: state.clues,
        charsMet: [...state.charsMet],
        quizDone: state.quizDone,
        traits: state.traits,
        endingsSeen: state.endingsSeen,
        sphinxSolved: state.sphinxSolved,
        mode: state.mode,
        chaptersSeen: state.chaptersSeen,
        wordStats: state.wordStats,
        achievements: state.achievements,
        drillResults: state.drillResults,
      }));
    } catch (_) { /* private mode etc. */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && data.scenes && data.scenes[s.current]) {
        state.current = s.current;
        state.history = Array.isArray(s.history) ? s.history : [];
        state.clues = Array.isArray(s.clues) ? s.clues : [];
        state.charsMet = new Set(Array.isArray(s.charsMet) ? s.charsMet : []);
        state.quizDone = s.quizDone && typeof s.quizDone === 'object' ? s.quizDone : {};
        state.traits = s.traits && typeof s.traits === 'object' ? s.traits : {};
        state.endingsSeen = Array.isArray(s.endingsSeen) ? s.endingsSeen : [];
        // Backward-compat: pre-existing saves predate the riddle. If the
        // student was already past the prologue, mark it solved so they
        // aren't bounced back to the riddle on reset.
        if (typeof s.sphinxSolved === 'boolean') state.sphinxSolved = s.sphinxSolved;
        else if (s.current && s.current !== 'sphinx_riddle') state.sphinxSolved = true;
        if (typeof s.mode === 'string' && ['tiro','discipulus','magister'].includes(s.mode)) {
          state.mode = s.mode;
        }
        if (Array.isArray(s.chaptersSeen)) state.chaptersSeen = s.chaptersSeen;
        if (s.wordStats && typeof s.wordStats === 'object') state.wordStats = s.wordStats;
        if (Array.isArray(s.achievements)) state.achievements = s.achievements;
        if (s.drillResults && typeof s.drillResults === 'object') state.drillResults = s.drillResults;
      }
    } catch (_) { /* ignore */ }
  }

  // --- helpers --------------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function cleanWord(token) {
    return token.toLowerCase().replace(/[.,!?;:"'’“”—–\-()]/g, '');
  }

  // Wraps every Latin token that exists in vocab.json with a clickable span.
  function latinize(text) {
    if (!text) return '';
    const vocab = data.vocab || {};
    return text
      .split(/(\s+|[.,!?;:"'’“”—–()])/)
      .map(token => {
        if (!token) return '';
        if (/^\s+$/.test(token)) return token;
        if (/^[.,!?;:"'’“”—–()]$/.test(token)) return escapeHtml(token);
        const clean = cleanWord(token);
        if (vocab[clean]) {
          const entry = vocab[clean];
          const en = typeof entry === 'string' ? entry : (entry.en || '');
          const grammar = typeof entry === 'object' && entry.grammar ? entry.grammar : '';
          const grammarAttr = grammar ? ` data-grammar="${escapeHtml(grammar)}"` : '';
          const grammarCls = grammar ? ' has-grammar' : '';
          const wordAttr = ` data-word="${escapeHtml(clean)}"`;
          // Grammar marker is in the DOM only when there's a note; CSS keeps it
          // hidden until the parent span is .revealed.
          const marker = grammar
            ? `<span class="lat-grammar-btn" role="button" tabindex="0" aria-label="Grammar note for ${escapeHtml(clean)}">ⓘ</span>`
            : '';
          return `<span class="lat${grammarCls}" tabindex="0" role="button" data-en="${escapeHtml(en)}"${grammarAttr}${wordAttr}>${escapeHtml(token)}${marker}</span>`;
        }
        return escapeHtml(token);
      })
      .join('');
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.tab').forEach(btn => {
      if (btn.id === 'reset-btn') return;
      const isActive = btn.dataset.view === view;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    render();
  }

  // --- views ---------------------------------------------------------------
  function renderStory() {
    const scene = data.scenes[state.current];
    if (!scene) {
      app.innerHTML = `<p class="empty">Scene not found: ${escapeHtml(state.current)}</p>`;
      return;
    }

    // unlock characters present in this scene
    if (Array.isArray(scene.chars)) {
      scene.chars.forEach(id => state.charsMet.add(id));
    }
    if (!state.history.includes(state.current)) {
      state.history.push(state.current);
      // First visit — count encounters for every Latin word in the scene
      // so the Verba tab can surface mastery progress over time.
      countEncounters(scene);
    }

    // Riddle-type scenes go through their own renderer.
    if (scene.sceneType === 'riddle') {
      renderRiddle(scene);
      save();
      return;
    }

    const isEnding = !!scene.isEnding;

    // Cast — up to two characters flank the narrative (left, then right);
    // any extras drop into a small strip beneath.
    const castIds = (Array.isArray(scene.chars) ? scene.chars : []).filter(id => data.characters[id]);
    const flanking = castIds.slice(0, 2);
    const overflow = castIds.slice(2);

    const renderFlank = (id, side) => {
      const c = data.characters[id];
      const palette = COLORS[c.color] || COLORS.purple;
      const portrait = c.image
        ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" loading="lazy" decoding="async" />`
        : `<span class="cast-flank-initials" style="background:${palette.fill}">${escapeHtml(c.initials || '?')}</span>`;
      return `
        <figure class="cast-flank cast-flank-${side}" title="${escapeHtml(c.name)} — ${escapeHtml(c.titleEn)}">
          <div class="cast-flank-frame" style="--frame-tone:${palette.fill}">${portrait}</div>
          <figcaption class="cast-flank-name">
            <span class="cast-flank-name-en">${escapeHtml(c.name)}</span>
            <span class="cast-flank-name-la">${escapeHtml(c.title)}</span>
          </figcaption>
        </figure>`;
    };
    const leftFlankHtml  = flanking[0] ? renderFlank(flanking[0], 'left')  : '';
    const rightFlankHtml = flanking[1] ? renderFlank(flanking[1], 'right') : '';

    const overflowStripHtml = overflow.length === 0 ? '' : `
      <div class="scene-cast" aria-label="Also present">
        ${overflow.map(id => {
          const c = data.characters[id];
          const palette = COLORS[c.color] || COLORS.purple;
          const portrait = c.image
            ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" loading="lazy" decoding="async" />`
            : `<span class="cast-initials" style="background:${palette.fill}">${escapeHtml(c.initials || '?')}</span>`;
          return `<figure class="cast-medallion" title="${escapeHtml(c.name)} — ${escapeHtml(c.titleEn)}">
            <div class="cast-frame" style="--frame-tone:${palette.fill}">${portrait}</div>
            <figcaption class="cast-name">${escapeHtml(c.name)}</figcaption>
          </figure>`;
        }).join('')}
      </div>`;

    const choicesHtml = (scene.choices || []).map((c, i) => `
      <div class="choice-row translatable">
        <button class="choice" data-choice-index="${i}">
          <span class="choice-latin">${latinize(c.latin)}</span>
          <span class="choice-en line-en">${escapeHtml(c.en)}</span>
        </button>
        ${audioBtnHtml(c.latin || '', 'Listen to this choice aloud')}
        <button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button>
      </div>
    `).join('');

    const quiz = data.quizzes && data.quizzes[state.current];
    const quizHtml = quiz ? renderQuiz(state.current, quiz) : '';

    // Chorus interlude — first time entering a chapter, show the chorus above the scene.
    const chorusHtml = renderChorus(scene.chapter);

    // Scene illustration — painted establishing image for select scenes.
    const sceneImgHtml = scene.sceneImage ? `
      <figure class="scene-illustration">
        <img src="${escapeHtml(scene.sceneImage)}" alt="${escapeHtml(scene.titleEn || scene.title || '')}" loading="lazy" decoding="async" />
      </figure>` : '';

    app.innerHTML = `
      <article class="scene">
        ${chorusHtml}
        ${sceneImgHtml}
        <p class="scene-chapter">${escapeHtml(scene.chapter || '')}</p>
        <div class="translatable">
          <h2 class="scene-title">${escapeHtml(scene.title || '')}${audioBtnHtml(scene.title || '', 'Listen to the title')}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></h2>
          <p class="scene-title-en line-en">${escapeHtml(scene.titleEn || '')}</p>
        </div>
        ${scene.setting ? `<p class="scene-setting">${escapeHtml(scene.setting)}</p>` : ''}
        <div class="scene-stage cast-${flanking.length}">
          ${leftFlankHtml}
          <div class="narrative">
            <div class="narrative-actions">${audioBtnHtml(scene.latin || '', 'Listen to the narrative')}</div>
            ${latinize(scene.latin)}
          </div>
          ${rightFlankHtml}
        </div>
        ${overflowStripHtml}
        ${quizHtml}
        ${isEnding
          ? `<div class="ending-banner">FINIS — fabula completa est.</div>${renderEndingFooter()}`
          : `
            <div class="translatable">
              <p class="question">${latinize(scene.question)}${audioBtnHtml(scene.question || '', 'Listen to the question')}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
              <p class="question-en line-en">${escapeHtml(scene.questionEn || '')}</p>
            </div>
            <div class="choices">${choicesHtml}</div>
          `}
      </article>
    `;

    app.querySelectorAll('.choice').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.choiceIndex);
        const choice = scene.choices[i];
        if (!choice) return;
        if (choice.clue && !state.clues.includes(choice.clue)) {
          state.clues.push(choice.clue);
        }
        // Accumulate behavioural traits.
        if (Array.isArray(choice.tags)) {
          choice.tags.forEach(tag => {
            state.traits[tag] = (state.traits[tag] || 0) + 1;
          });
        }
        state.current = choice.next;
        save();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // On reaching an ending: log it (de-duped) so a Fates Known panel
    // can show progress across replays.
    if (isEnding && !state.endingsSeen.includes(state.current)) {
      state.endingsSeen.push(state.current);
    }

    save();
  }

  // Compute a running quiz score from state.quizDone. Returns { correct, answered }.
  // Excludes the sphinx_riddle (it's a one-time gate, not a comprehension quiz).
  // Increment the click count for the word inside a .lat span.
  function trackWordClick(lat) {
    const w = lat.getAttribute('data-word') || cleanWord(lat.textContent);
    if (!w || !data.vocab || !data.vocab[w]) return;
    if (!state.wordStats[w]) state.wordStats[w] = { encountered: 0, clicked: 0 };
    state.wordStats[w].clicked++;
    save();
  }

  // Walk every Latin token in a scene and increment its "encountered" stat.
  // Called once the first time the student visits a scene.
  function countEncounters(scene) {
    if (!scene || !data.vocab) return;
    const texts = [];
    if (scene.title) texts.push(scene.title);
    if (scene.latin) texts.push(scene.latin);
    if (scene.question) texts.push(scene.question);
    (scene.choices || []).forEach(c => { if (c.latin) texts.push(c.latin); });
    (scene.options || []).forEach(o => {
      if (o.latin) texts.push(o.latin);
      if (o.feedbackLatin) texts.push(o.feedbackLatin);
      if (o.hintLatin) texts.push(o.hintLatin);
    });
    const seenInScene = new Set();
    texts.join(' ').split(/(\s+|[.,!?;:"'’“”—–()])/).forEach(tok => {
      const w = cleanWord(tok);
      if (!w || !data.vocab[w] || seenInScene.has(w)) return;
      seenInScene.add(w);
      if (!state.wordStats[w]) state.wordStats[w] = { encountered: 0, clicked: 0 };
      state.wordStats[w].encountered++;
    });
  }

  // Greek chorus interlude — shown the first time a chapter is entered in a
  // playthrough. Returns HTML or an empty string. The chapter label is
  // recorded in state.chaptersSeen so the chorus only appears once per
  // session; resetting via Iterum clears the list so the choruses replay.
  function renderChorus(chapter) {
    if (!chapter || !data.choruses || !data.choruses[chapter]) return '';
    if (state.chaptersSeen.includes(chapter)) return '';
    state.chaptersSeen.push(chapter);
    const c = data.choruses[chapter];
    return `
      <aside class="chorus translatable" aria-label="Chorus interlude">
        <p class="chorus-eyebrow">Chorus &nbsp;·&nbsp; ${escapeHtml(chapter)}${audioBtnHtml(c.latin || '', 'Listen to the chorus')}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
        <p class="chorus-latin">${latinize(c.latin)}</p>
        <p class="chorus-en line-en">${escapeHtml(c.en)}</p>
      </aside>
    `;
  }

  function quizScore() {
    let correct = 0, answered = 0;
    for (const [sceneId, result] of Object.entries(state.quizDone)) {
      if (sceneId === 'sphinx_riddle' || !result) continue;
      answered++;
      if (result === 'correct') correct++;
    }
    return { correct, answered };
  }

  // Build a personalised Latin epilogue based on the path the student walked.
  // Returns { latinLines, enLines } parallel arrays of short sentences.
  function buildEpilogue() {
    const visited = new Set(state.history);
    const latin = [];
    const en = [];
    const push = (la, eng) => { latin.push(la); en.push(eng); };

    push("olim Oedipus Sphingem solvit.", "Long ago Oedipus solved the Sphinx's riddle.");
    push("rex Thebarum factus est. tum pestis Thebas vexavit.",
         "He became king of Thebes. Then a plague troubled the city.");

    // Opening branch — what did the king do first?
    if (visited.has('creon_returns')) push("Creon ad oraculum missus est. Apollo locutus est: 'necator hic manet.'",
                                            "Creon was sent to the oracle. Apollo declared: 'the killer remains here.'");
    if (visited.has('tiresias_early') || visited.has('tiresias_scene')) push("rex Tiresiam vatem caecum vocavit.",
                                                                              "The king summoned Tiresias the blind seer.");
    if (visited.has('citizens')) push("rex cives miseros ipse rogavit.",
                                       "The king himself questioned the wretched citizens.");

    // Crossroads
    if (visited.has('crossroads_clue')) push("una femina trivium narravit. iuvenis ibi Laium necavit.",
                                              "A woman told of a crossroads where a young man had killed Laius.");

    // Tiresias accusation
    if (visited.has('tiresias_accuses')) push("Tiresias dixit: 'tu es scelus.' rex non credidit.",
                                               "Tiresias declared: 'you are the crime.' The king did not believe.");

    // Quarrel
    if (visited.has('creon_quarrel')) push("rex Creonem accusavit. Iocasta intervenit.",
                                            "The king accused Creon. Jocasta intervened.");

    // Iocasta
    if (visited.has('iocasta_truth')) push("Iocasta de oraculo veteri narravit. rex perterritus est.",
                                            "Jocasta told of the old oracle. The king grew terrified.");

    // Messenger
    if (visited.has('messenger_arrives') || visited.has('messenger_reveal'))
      push("nuntius ex Corintho venit: Polybus mortuus, sed pater verus non erat.",
           "A messenger came from Corinth: Polybus was dead, and was not the true father.");

    // Shepherd
    if (visited.has('pastor_speaks')) push("pastor antiquus tandem omnia confessus est.",
                                            "The old shepherd at last confessed everything.");

    // Trait colour — top trait gives a sentence
    const sorted = Object.entries(state.traits).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (sorted.length) {
      const top = sorted[0][0];
      const traitLines = {
        confront:   ["per fabulam, rex iratus erat. multos accusavit.", "Through the story, the king was angry. He accused many."],
        proud:      ["rex superbus erat. nemini cessit.", "The king was proud. He yielded to no one."],
        patient:    ["rex patiens erat. omnia patienter audivit.", "The king was patient. He heard everything calmly."],
        pious:      ["rex deos timuit. fatum suum accepit.", "The king feared the gods. He accepted his fate."],
        compassion: ["rex civibus suis benignus erat.", "The king was kind to his people."],
        denial:     ["rex veritatem diu reiecit.", "The king long denied the truth."],
      };
      const t = traitLines[top];
      if (t) push(t[0], t[1]);
    }

    // Ending
    const endingLines = {
      ending:          ["tandem rex se caecum fecit. urbem reliquit. fabula classica completa.",
                        "At last the king blinded himself. He left the city. The classical tale is complete."],
      ending_hubris:   ["rex iratus Tiresiam necavit. dei eum reliquerunt. furor regem cepit.",
                        "The angry king had Tiresias killed. The gods abandoned him. Madness seized the king."],
      ending_denial:   ["rex veritatem reiecit. cives eum eiecerunt. casus regis tristis.",
                        "The king rejected the truth. The citizens cast him out. The king's fall was sad."],
      ending_dignity:  ["rex ipse poenam suam dixit. cum Antigona discessit. Thebae salvae sunt.",
                        "The king pronounced his own punishment. He departed with Antigone. Thebes was saved."],
    };
    const e = endingLines[state.current];
    if (e) push(e[0], e[1]);

    return { latinLines: latin, enLines: en };
  }

  // Render the ending footer: epilogue, traits, quiz score, fates known.
  function renderEndingFooter() {
    const { correct, answered } = quizScore();
    const seen = state.endingsSeen.length;
    const total = ENDING_IDS.length;

    const sortedTraits = Object.entries(state.traits)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const traitChips = sortedTraits.length
      ? sortedTraits.map(([tag]) => {
          const lbl = TRAIT_LABELS[tag] || { la: tag, en: tag };
          return `<span class="trait-chip"><span class="trait-la">${escapeHtml(lbl.la)}</span><span class="trait-en">${escapeHtml(lbl.en)}</span></span>`;
        }).join('')
      : '<span class="trait-chip muted">—</span>';

    const fatesList = ENDING_IDS.map(id => {
      const lbl = ENDING_LABELS[id];
      const got = state.endingsSeen.includes(id);
      const cls = got ? 'fate-known' : 'fate-unknown';
      const mark = got ? '✓' : '·';
      return `<li class="${cls}"><span class="fate-mark">${mark}</span><span class="fate-la">${escapeHtml(lbl.la)}</span><span class="fate-en">${escapeHtml(lbl.en)}</span></li>`;
    }).join('');

    // Personalised Latin epilogue
    const { latinLines, enLines } = buildEpilogue();
    const epilogueHtml = latinLines.map((la, i) => `
      <div class="epilogue-line translatable">
        <p class="epilogue-latin">${latinize(la)}${audioBtnHtml(la, 'Listen to this line')}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
        <p class="epilogue-en line-en">${escapeHtml(enLines[i] || '')}</p>
      </div>
    `).join('');

    const scoreHtml = answered === 0 ? '' : `
      <div class="ending-score" aria-label="Quiz score">
        <p class="ending-label">scientia tua <em>your knowledge</em></p>
        <p class="score-number"><span class="score-correct">${correct}</span> <span class="score-divider">/</span> <span class="score-total">${answered}</span></p>
        <p class="score-caption"><em>quaestiones rectae</em> — questions answered correctly</p>
      </div>
    `;

    return `
      <section class="ending-footer" aria-label="Reflection">
        <div class="ending-epilogue">
          <p class="ending-label">fabula tua <em>your story</em></p>
          <div class="epilogue-body">${epilogueHtml}</div>
        </div>
        <div class="ending-meta">
          <div class="ending-traits">
            <p class="ending-label">animus tuus erat <em>your character was</em></p>
            <div class="trait-chips">${traitChips}</div>
          </div>
          ${scoreHtml}
          <div class="ending-fates">
            <p class="ending-label">fata cognita <em>fates known</em> &nbsp;${seen} / ${total}</p>
            <ul class="fate-list">${fatesList}</ul>
            ${seen < total ? '<p class="ending-hint"><em>Press Iterum to play again — different choices lead to different fates.</em></p>' : '<p class="ending-hint"><em>You have walked all four paths. Magnum opus.</em></p>'}
          </div>
        </div>
        ${renderHonorsPanel()}
      </section>
    `;
  }

  // Earned + unearned medallions, gold for earned and muted for locked.
  function renderHonorsPanel() {
    const earned = state.achievements.length;
    const total = ACHIEVEMENTS.length;
    const tiles = ACHIEVEMENTS.map(a => {
      const got = state.achievements.includes(a.id);
      return `
        <figure class="medallion ${got ? 'earned' : 'locked'}" title="${escapeHtml(a.la)} — ${escapeHtml(a.desc)}">
          <span class="medallion-icon" aria-hidden="true">${escapeHtml(a.icon)}</span>
          <figcaption class="medallion-name">
            <span class="medallion-la">${escapeHtml(a.la)}</span>
            <span class="medallion-en">${escapeHtml(a.en)}</span>
          </figcaption>
        </figure>
      `;
    }).join('');
    return `
      <div class="ending-honors">
        <p class="ending-label">honores cogniti <em>medallions earned</em> &nbsp;${earned} / ${total}</p>
        <div class="medallion-grid">${tiles}</div>
      </div>
    `;
  }

  function renderRiddle(scene) {
    const sceneId = state.current;
    const solved = state.sphinxSolved && state.quizDone[sceneId] === 'correct';
    const opts = Array.isArray(scene.options) ? scene.options : [];
    const optsHtml = opts.map((o, i) => {
      let cls = 'riddle-tile';
      if (solved && o.correct) cls += ' correct';
      return `<button class="${cls}" data-riddle-index="${i}" ${solved ? 'disabled' : ''}>
        <span class="riddle-latin">${escapeHtml(o.latin)}</span>
        <span class="riddle-en">${escapeHtml(o.en || '')}</span>
      </button>`;
    }).join('');

    const correctIdx = opts.findIndex(o => o.correct);
    const correct = correctIdx >= 0 ? opts[correctIdx] : null;
    const continueHtml = solved && correct ? `
      <div class="riddle-feedback correct" role="status">
        <p class="riddle-feedback-latin">${latinize(correct.feedbackLatin || '')}</p>
        <p class="riddle-feedback-en">${escapeHtml(correct.feedbackEn || '')}</p>
        <button type="button" class="riddle-continue" id="riddle-continue">ad Thebas eo →</button>
      </div>
    ` : '';

    const castHtml = (Array.isArray(scene.chars) ? scene.chars : [])
      .filter(id => data.characters[id])
      .map(id => {
        const c = data.characters[id];
        const palette = COLORS[c.color] || COLORS.purple;
        const portrait = c.image
          ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" loading="lazy" decoding="async" />`
          : `<span class="cast-initials" style="background:${palette.fill}">${escapeHtml(c.initials || '?')}</span>`;
        return `<figure class="cast-medallion" title="${escapeHtml(c.name)}">
          <div class="cast-frame" style="--frame-tone:${palette.fill}">${portrait}</div>
          <figcaption class="cast-name">${escapeHtml(c.name)}</figcaption>
        </figure>`;
      }).join('');

    const chorusHtml = renderChorus(scene.chapter);
    const sceneImgHtml = scene.sceneImage ? `
      <figure class="scene-illustration">
        <img src="${escapeHtml(scene.sceneImage)}" alt="${escapeHtml(scene.titleEn || scene.title || '')}" loading="lazy" decoding="async" />
      </figure>` : '';

    app.innerHTML = `
      <article class="scene riddle-scene">
        ${chorusHtml}
        ${sceneImgHtml}
        <p class="scene-chapter">${escapeHtml(scene.chapter || '')}</p>
        <div class="translatable">
          <h2 class="scene-title">${escapeHtml(scene.title || '')}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></h2>
          <p class="scene-title-en line-en">${escapeHtml(scene.titleEn || '')}</p>
        </div>
        ${scene.setting ? `<p class="scene-setting">${escapeHtml(scene.setting)}</p>` : ''}
        ${castHtml ? `<div class="scene-cast" aria-label="In this scene">${castHtml}</div>` : ''}
        <div class="narrative">${latinize(scene.latin)}</div>
        <div class="translatable">
          <p class="question">${latinize(scene.question)}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
          <p class="question-en line-en">${escapeHtml(scene.questionEn || '')}</p>
        </div>
        <div class="riddle-tiles">${optsHtml}</div>
        <div id="riddle-feedback-slot">${continueHtml}</div>
      </article>
    `;

    if (!solved) {
      app.querySelectorAll('.riddle-tile').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.riddleIndex);
          const opt = opts[i];
          if (!opt) return;
          if (opt.correct) {
            btn.classList.add('correct');
            // disable all tiles
            app.querySelectorAll('.riddle-tile').forEach(b => { b.disabled = true; });
            state.quizDone[sceneId] = 'correct';
            state.sphinxSolved = true;
            const slot = document.getElementById('riddle-feedback-slot');
            slot.innerHTML = `
              <div class="riddle-feedback correct" role="status">
                <p class="riddle-feedback-latin">${latinize(opt.feedbackLatin || '')}</p>
                <p class="riddle-feedback-en">${escapeHtml(opt.feedbackEn || '')}</p>
                <button type="button" class="riddle-continue" id="riddle-continue">ad Thebas eo →</button>
              </div>
            `;
            save();
            document.getElementById('riddle-continue').addEventListener('click', () => {
              state.current = scene.next || 'start';
              save();
              render();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            });
          } else {
            btn.classList.add('wrong');
            btn.disabled = true;
            const slot = document.getElementById('riddle-feedback-slot');
            slot.innerHTML = `
              <div class="riddle-feedback wrong" role="status">
                <p class="riddle-feedback-latin">${latinize(opt.hintLatin || '')}</p>
                <p class="riddle-feedback-en">${escapeHtml(opt.hintEn || '')}</p>
              </div>
            `;
          }
        });
      });
    } else {
      // Already solved on a previous session — let them continue.
      const btn = document.getElementById('riddle-continue');
      if (btn) btn.addEventListener('click', () => {
        state.current = scene.next || 'start';
        save();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  function renderQuiz(sceneId, quiz) {
    const answered = state.quizDone[sceneId];
    const optsHtml = quiz.options.map((opt, i) => {
      let cls = 'quiz-opt';
      if (answered) {
        if (i === quiz.correct) cls += ' correct';
        // mark wrong on the chosen wrong answer
        if (answered === 'wrong:' + i) cls += ' wrong';
      }
      const disabled = answered ? 'disabled' : '';
      return `<button class="${cls}" data-quiz-index="${i}" ${disabled} aria-label="Answer option ${i + 1}">${escapeHtml(opt)}</button>`;
    }).join('');

    const explain = answered
      ? `<div class="quiz-explain" role="status">${escapeHtml(quiz.explain)}</div>`
      : '';

    // Once answered, show a running score so students can track their tally.
    let scorePill = '';
    if (answered) {
      const { correct, answered: total } = quizScore();
      scorePill = `<p class="quiz-score" aria-live="polite">scientia tua &nbsp;<strong>${correct}/${total}</strong>&nbsp; <em>questions correct so far</em></p>`;
    }

    return `
      <section class="quiz" aria-label="Comprehension quiz">
        <h3>Quaestio: ${escapeHtml(quiz.q)}</h3>
        <div class="quiz-options">${optsHtml}</div>
        ${explain}
        ${scorePill}
      </section>
    `;
  }

  function renderCards() {
    const ids = [...state.charsMet];
    if (ids.length === 0) {
      app.innerHTML = `<p class="empty">No characters met yet — return to the story.</p>`;
      return;
    }
    const cardsHtml = ids.map(id => {
      const c = data.characters[id];
      if (!c) return '';
      const palette = COLORS[c.color] || COLORS.purple;
      const stats = c.stats || {};
      const statRows = ['sapientia', 'fortitudo', 'superbia', 'fatum'].map(key => {
        const val = Number(stats[key] || 0);
        const pct = Math.max(0, Math.min(100, (val / 10) * 100));
        return `
          <div class="stat-row">
            <span class="stat-label">${key}</span>
            <div class="stat-bar" style="background:${palette.bg}">
              <div class="stat-fill" style="width:${pct}%; background:${palette.fill}"></div>
            </div>
            <span class="stat-num">${val}</span>
          </div>`;
      }).join('');
      const portrait = c.image
        ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}, ${escapeHtml(c.titleEn)}" loading="lazy" decoding="async" />`
        : `<span class="card-portrait-initials" style="background:${palette.fill}">${escapeHtml(c.initials || '?')}</span>`;
      return `
        <article class="card" style="--accent-fill:${palette.fill}; --accent-bg:${palette.bg}">
          <div class="card-portrait">${portrait}</div>
          <header class="card-head translatable card-title-block">
            <h3 class="card-name">${escapeHtml(c.name)}</h3>
            <p class="card-title">${escapeHtml(c.title)}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
            <p class="card-title-en line-en"><em>${escapeHtml(c.titleEn)}</em></p>
          </header>
          <div class="translatable">
            <p class="card-bio">${latinize(c.bio)}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
            <p class="card-bio-en line-en">${escapeHtml(c.bioEn)}</p>
          </div>
          <div class="stats">${statRows}</div>
          <div class="translatable card-phrase-block">
            <p class="card-phrase">“${latinize(c.phrase)}”<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
            <p class="card-phrase-en line-en">${escapeHtml(c.phraseEn)}</p>
          </div>
        </article>
      `;
    }).join('');
    app.innerHTML = `<div class="cards-grid">${cardsHtml}</div>`;
  }

  function renderClues() {
    if (state.clues.length === 0) {
      app.innerHTML = `<p class="empty">No clues yet. <em>Indicia nondum inventa sunt.</em></p>`;
      return;
    }
    const items = state.clues.map(clue => `<li>${latinize(clue)}</li>`).join('');
    app.innerHTML = `<ol class="clue-list">${items}</ol>`;
  }

  function renderVocab() {
    const vocab = data.vocab || {};
    const stats = state.wordStats || {};
    const words = Object.keys(stats).filter(w => stats[w].encountered > 0 && vocab[w]).sort();

    if (words.length === 0) {
      app.innerHTML = `<p class="empty">No vocabulary encountered yet.</p>`;
      return;
    }

    const masteredCount = words.filter(w => isMastered(stats[w])).length;
    const totalEncountered = words.length;
    const masteryPct = totalEncountered === 0 ? 0 : Math.round((masteredCount / totalEncountered) * 100);

    const rows = words.map(w => {
      const s = stats[w];
      const mastered = isMastered(s);
      const cls = mastered ? 'word-mastered' : (s.encountered >= MASTERY_MIN_ENCOUNTERS ? 'word-learning' : 'word-new');
      const ratio = s.encountered === 0 ? 0 : Math.round((s.clicked / s.encountered) * 100);
      const mark = mastered ? '★' : (s.clicked === 0 && s.encountered > 0 ? '✓' : '·');
      const title = `Encountered ${s.encountered}× · clicked for help ${s.clicked}× (${ratio}%)`;
      const entry = vocab[w];
      const meaning = typeof entry === 'string' ? entry : (entry.en || '');
      const grammar = typeof entry === 'object' && entry.grammar ? entry.grammar : '';
      const grammarHtml = grammar ? `<p class="vocab-grammar"><span class="vocab-grammar-mark">ⓘ</span>${escapeHtml(grammar)}</p>` : '';
      return `
        <div class="vocab-row ${cls}${grammar ? ' has-grammar' : ''}" title="${escapeHtml(title)}">
          <span class="vocab-mark" aria-hidden="true">${mark}</span>
          <span class="vocab-word">${escapeHtml(w)}</span>
          <span class="vocab-meaning">${escapeHtml(meaning)}</span>
          <span class="vocab-stats">${s.encountered}<span class="sep">·</span>${s.clicked}</span>
          ${grammarHtml}
        </div>
      `;
    }).join('');

    app.innerHTML = `
      <div class="vocab-summary">
        <div class="vocab-summary-stat">
          <p class="vocab-summary-label">verba cognita <em>words mastered</em></p>
          <p class="vocab-summary-number"><span class="num-correct">${masteredCount}</span><span class="num-divider">/</span><span class="num-total">${totalEncountered}</span></p>
          <div class="vocab-progress" role="progressbar" aria-valuenow="${masteryPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="vocab-progress-fill" style="width:${masteryPct}%"></div>
          </div>
        </div>
        <p class="vocab-summary-hint">A word is <em>cognitum</em> once you have met it ${MASTERY_MIN_ENCOUNTERS}+ times and asked for the gloss less than a third of the time. Stats persist across replays.</p>
      </div>
      <div class="vocab-list">
        <div class="vocab-row vocab-header" aria-hidden="true">
          <span class="vocab-mark"></span>
          <span class="vocab-word">verbum</span>
          <span class="vocab-meaning">significatio</span>
          <span class="vocab-stats" title="encounters · clicks for help">met<span class="sep">·</span>asked</span>
        </div>
        ${rows}
      </div>
    `;
  }

  // --- main render dispatcher ----------------------------------------------
  function render() {
    switch (state.view) {
      case 'cards':  renderCards();  break;
      case 'clues':  renderClues();  break;
      case 'vocab':  renderVocab();  break;
      case 'drills': renderDrills(); break;
      case 'story':
      default: renderStory(); break;
    }
    evaluateAchievements();
  }

  // Compute set of chapters the student has visited (any scene in that chapter).
  function visitedChapters() {
    const set = new Set();
    state.history.forEach(id => {
      const s = data.scenes && data.scenes[id];
      if (s && s.chapter) set.add(s.chapter);
    });
    return set;
  }

  function renderDrills() {
    const drills = data.drills || {};
    const chapters = Object.keys(drills).filter(k => !k.startsWith('_'));
    if (chapters.length === 0) {
      app.innerHTML = `<p class="empty">No drills loaded.</p>`;
      return;
    }
    const visited = visitedChapters();

    // Compute totals across visited drills
    let answeredAcross = 0, correctAcross = 0, totalAvail = 0;
    chapters.forEach(ch => {
      const set = drills[ch] || [];
      totalAvail += set.length;
      const results = state.drillResults[ch] || {};
      set.forEach((_, i) => {
        const r = results[i];
        if (r) {
          answeredAcross++;
          if (r === 'correct') correctAcross++;
        }
      });
    });

    const summaryHtml = `
      <div class="drills-summary">
        <p class="vocab-summary-label">progressus tuus <em>your progress</em></p>
        <p class="vocab-summary-number"><span class="num-correct">${correctAcross}</span><span class="num-divider">/</span><span class="num-total">${answeredAcross}</span></p>
        <p class="drills-summary-hint"><em>questions answered correctly &middot; ${totalAvail - answeredAcross} drills remaining</em></p>
      </div>
    `;

    const chapterBlocks = chapters.map(ch => {
      const set = drills[ch];
      const isVisited = visited.has(ch);
      const results = state.drillResults[ch] || {};
      const answered = set.filter((_, i) => results[i]).length;
      const correct = set.filter((_, i) => results[i] === 'correct').length;

      const drillsHtml = !isVisited ? `
        <p class="drill-locked"><em>Visit this chapter in the story to unlock its drills.</em></p>
      ` : set.map((d, i) => renderDrillCard(ch, i, d, results[i])).join('');

      return `
        <section class="drill-chapter ${isVisited ? '' : 'locked'}">
          <header class="drill-chapter-head">
            <h3 class="drill-chapter-title">${escapeHtml(ch)}</h3>
            <span class="drill-chapter-tally">${isVisited ? `${correct}/${set.length}` : '—'}</span>
          </header>
          <div class="drill-chapter-body">${drillsHtml}</div>
        </section>`;
    }).join('');

    app.innerHTML = `
      <div class="vocab-summary">
        <div class="vocab-summary-stat">
          ${summaryHtml.match(/<p class="vocab-summary-label[\s\S]*?<\/p>/)[0]}
          ${summaryHtml.match(/<p class="vocab-summary-number[\s\S]*?<\/p>/)[0]}
          <p class="vocab-summary-hint"><em>Latin retrieval drills — produce, don't just recognise. Three per chapter; complete each chapter as you progress through the story.</em></p>
        </div>
      </div>
      <div class="drills-list">${chapterBlocks}</div>
    `;
  }

  function renderDrillCard(chapter, index, drill, result) {
    const optsHtml = drill.options.map((opt, i) => {
      let cls = 'quiz-opt drill-opt';
      if (result) {
        if (i === drill.correct) cls += ' correct';
        if (result === 'wrong:' + i) cls += ' wrong';
      }
      const disabled = result ? 'disabled' : '';
      return `<button class="${cls}" data-drill-chapter="${escapeHtml(chapter)}" data-drill-index="${index}" data-drill-opt="${i}" ${disabled}>${escapeHtml(opt)}</button>`;
    }).join('');

    const explainHtml = result
      ? `<div class="quiz-explain" role="status">${escapeHtml(drill.explain || '')}</div>`
      : '';

    const promptLaHtml = drill.promptLa
      ? `<p class="drill-promptLa">${latinize(drill.promptLa)}${audioBtnHtml(drill.promptLa, 'Listen aloud')}</p>`
      : '';

    const kindLabels = { translate: 'Translate', form: 'Pick the form', vocab: 'Vocabulary' };
    const kindLabel = kindLabels[drill.kind] || drill.kind;

    return `
      <section class="drill-card" aria-label="Drill ${index + 1} for ${escapeHtml(chapter)}">
        <p class="drill-eyebrow">${escapeHtml(kindLabel)}</p>
        <p class="drill-prompt">${escapeHtml(drill.promptEn)}</p>
        ${promptLaHtml}
        <div class="quiz-options">${optsHtml}</div>
        ${explainHtml}
      </section>
    `;
  }

  // --- Latin audio (Web Speech API) ---------------------------------------
  // Browsers rarely ship a Latin voice. Italian is a sensible fallback for
  // ecclesiastical-style pronunciation; Spanish and Portuguese also work
  // tolerably. We pick the best available once and reuse it.
  let _latinVoice = null;
  let _voicesAttempted = false;
  function pickLatinVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const byLang = (prefix) => voices.find(v => v.lang && v.lang.toLowerCase().startsWith(prefix));
    return byLang('la')   // explicit Latin (rare)
        || byLang('it')   // Italian — closest classical pronunciation
        || byLang('es')   // Spanish
        || byLang('pt')   // Portuguese
        || voices[0];     // anything
  }
  function ensureVoice() {
    if (_latinVoice || _voicesAttempted) return _latinVoice;
    _latinVoice = pickLatinVoice();
    if (_latinVoice) _voicesAttempted = true;
    return _latinVoice;
  }
  if ('speechSynthesis' in window) {
    // Voices load asynchronously in some browsers.
    window.speechSynthesis.onvoiceschanged = () => {
      _latinVoice = pickLatinVoice();
      _voicesAttempted = true;
    };
  }

  // Strip the trailing ⓘ marker if present and any HTML when we read text from
  // a DOM element.
  function cleanLatinForSpeech(s) {
    return String(s || '').replace(/[ⓘ]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Word-gap timing — Web Speech API exposes rate but not inter-word pause.
  // To give Year 7 students space to follow each word, we split the line into
  // individual utterances and schedule a setTimeout pause between them.
  const WORD_PAUSE_MS = 350;
  const WORD_RATE = 0.75;

  let _audioQueue = null; // { words, idx, btn, cancelled, timer }

  function cancelAudio() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (_audioQueue) {
      _audioQueue.cancelled = true;
      if (_audioQueue.timer) clearTimeout(_audioQueue.timer);
      _audioQueue = null;
    }
    document.querySelectorAll('.audio-btn.playing').forEach(b => b.classList.remove('playing'));
  }

  function playLatin(text, sourceBtn) {
    if (!('speechSynthesis' in window)) return;
    // Toggle off if the same button is clicked again.
    if (sourceBtn && sourceBtn.classList.contains('playing')) {
      cancelAudio();
      return;
    }
    cancelAudio();

    const cleaned = cleanLatinForSpeech(text);
    // Split on whitespace; punctuation stays attached to its word so prosody
    // around full stops still sounds natural.
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (!words.length) return;

    if (sourceBtn) sourceBtn.classList.add('playing');
    const voice = ensureVoice();
    const speech = window.speechSynthesis;
    const queue = { idx: 0, btn: sourceBtn, cancelled: false, timer: null };
    _audioQueue = queue;

    function speakNext() {
      if (queue.cancelled || queue !== _audioQueue) return;
      if (queue.idx >= words.length) {
        if (sourceBtn) sourceBtn.classList.remove('playing');
        if (_audioQueue === queue) _audioQueue = null;
        return;
      }
      const word = words[queue.idx++];
      const utt = new SpeechSynthesisUtterance(word);
      if (voice) {
        utt.voice = voice;
        utt.lang = voice.lang;
      } else {
        utt.lang = 'la';
      }
      utt.rate = WORD_RATE;
      utt.pitch = 1.0;
      const advance = () => {
        if (queue.cancelled || queue !== _audioQueue) return;
        queue.timer = setTimeout(speakNext, WORD_PAUSE_MS);
      };
      utt.onend = advance;
      utt.onerror = advance;
      try {
        speech.speak(utt);
      } catch (_) {
        advance();
      }
    }

    speakNext();
  }

  function audioBtnHtml(text, label) {
    if (!('speechSynthesis' in window)) return '';
    return `<button type="button" class="audio-btn" data-audio="${escapeHtml(text)}" aria-label="${escapeHtml(label || 'Listen to this Latin line')}" title="Audi — listen aloud">
      <span class="audio-btn-icon" aria-hidden="true">▶</span>
      <span class="audio-btn-label">audi</span>
    </button>`;
  }

  // --- grammar popover ---------------------------------------------------
  function showGrammarPopover(latEl) {
    const word = latEl.getAttribute('data-word') || latEl.textContent.replace(/ⓘ/g, '').trim();
    const en = latEl.getAttribute('data-en') || '';
    const grammar = latEl.getAttribute('data-grammar') || '';
    if (!grammar) return;
    let pop = document.getElementById('grammar-popover');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'grammar-popover';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-modal', 'true');
      pop.setAttribute('aria-labelledby', 'grammar-pop-title');
      document.body.appendChild(pop);
    }
    pop.innerHTML = `
      <button type="button" class="grammar-pop-overlay" aria-label="Close"></button>
      <div class="grammar-pop-card" role="document">
        <button type="button" class="grammar-pop-close" aria-label="Close grammar note">×</button>
        <p class="grammar-pop-eyebrow">Grammar note</p>
        <h3 id="grammar-pop-title" class="grammar-pop-word">${escapeHtml(word)}</h3>
        <p class="grammar-pop-meaning"><em>${escapeHtml(en)}</em></p>
        <p class="grammar-pop-body">${escapeHtml(grammar)}</p>
      </div>
    `;
    pop.classList.add('open');
    const close = () => {
      pop.classList.remove('open');
      pop.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
    const onClick = (ev) => {
      if (ev.target.closest('.grammar-pop-close') || ev.target.matches('.grammar-pop-overlay')) close();
    };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    pop.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    // Focus the close button so screen readers + keyboard land in the dialog.
    setTimeout(() => pop.querySelector('.grammar-pop-close')?.focus(), 0);
  }

  // --- click-to-reveal: line-level translation toggle and per-word reveal --
  document.addEventListener('click', (e) => {
    // Grammar marker (ⓘ) — open the popover and stop the reveal toggle from firing.
    const grammarBtn = e.target.closest('.lat-grammar-btn');
    if (grammarBtn) {
      e.stopPropagation();
      const lat = grammarBtn.closest('.lat');
      if (lat) showGrammarPopover(lat);
      return;
    }
    // Audio play button — read the Latin aloud via Web Speech.
    const audioBtn = e.target.closest('.audio-btn');
    if (audioBtn) {
      e.stopPropagation();
      e.preventDefault();
      const text = audioBtn.getAttribute('data-audio') || '';
      playLatin(text, audioBtn);
      return;
    }
    const toggle = e.target.closest('.reveal-toggle');
    if (toggle) {
      e.stopPropagation();
      const container = toggle.closest('.translatable');
      if (!container) return;
      const revealed = container.classList.toggle('revealed');
      container.querySelectorAll('.reveal-toggle').forEach(t =>
        t.setAttribute('aria-pressed', String(revealed))
      );
      return;
    }
    const lat = e.target.closest('.lat');
    if (!lat) return;
    const wasRevealed = lat.classList.toggle('revealed');
    if (wasRevealed) trackWordClick(lat);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    // Grammar marker keyboard activation has priority.
    const grammarBtn = e.target.closest && e.target.closest('.lat-grammar-btn');
    if (grammarBtn) {
      e.preventDefault();
      const lat = grammarBtn.closest('.lat');
      if (lat) showGrammarPopover(lat);
      return;
    }
    const lat = e.target.closest && e.target.closest('.lat');
    if (!lat) return;
    e.preventDefault();
    const wasRevealed = lat.classList.toggle('revealed');
    if (wasRevealed) trackWordClick(lat);
  });

  // --- quiz / drill click handler ------------------------------------------
  app.addEventListener('click', (e) => {
    const btn = e.target.closest('.quiz-opt');
    if (!btn || btn.disabled) return;
    // Drill answer (lives in the Exercitatio tab).
    if (btn.classList.contains('drill-opt')) {
      const ch = btn.dataset.drillChapter;
      const idx = Number(btn.dataset.drillIndex);
      const opt = Number(btn.dataset.drillOpt);
      const drill = (data.drills && data.drills[ch] && data.drills[ch][idx]);
      if (!drill) return;
      const correct = opt === drill.correct;
      if (!state.drillResults[ch]) state.drillResults[ch] = {};
      state.drillResults[ch][idx] = correct ? 'correct' : 'wrong:' + opt;
      save();
      render();
      return;
    }
    // In-story comprehension quiz.
    const i = Number(btn.dataset.quizIndex);
    const quiz = data.quizzes[state.current];
    if (!quiz) return;
    const correct = i === quiz.correct;
    state.quizDone[state.current] = correct ? 'correct' : 'wrong:' + i;
    save();
    render();
  });

  // --- tabs / reset --------------------------------------------------------
  document.querySelectorAll('.tab').forEach(btn => {
    if (btn.id === 'reset-btn') return;
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
  // Apply the difficulty mode to the body so CSS can scale English support.
  function applyMode() {
    document.body.classList.remove('mode-tiro', 'mode-discipulus', 'mode-magister');
    document.body.classList.add(`mode-${state.mode}`);
    const sel = document.getElementById('mode-select');
    if (sel && sel.value !== state.mode) sel.value = state.mode;
  }

  // Wire the Modus selector.
  const modeSelect = document.getElementById('mode-select');
  if (modeSelect) {
    modeSelect.addEventListener('change', (e) => {
      const v = e.target.value;
      if (['tiro', 'discipulus', 'magister'].includes(v)) {
        state.mode = v;
        save();
        applyMode();
      }
    });
  }

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset the story? Your unlocked fates and the Sphinx victory will be kept.')) return;
    // Skip the prologue riddle on replay if already defeated.
    state.current = state.sphinxSolved ? 'start' : 'sphinx_riddle';
    state.history = [];
    state.clues = [];
    state.charsMet = new Set();
    state.quizDone = {};
    state.traits = {};
    state.chaptersSeen = [];
    // endingsSeen and sphinxSolved are preserved across replays so students
    // see their cumulative progress.
    save();
    setView('story');
  });

  // --- bootstrap -----------------------------------------------------------
  function stripSchema(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const k in obj) if (!k.startsWith('_')) out[k] = obj[k];
    return out;
  }

  async function loadJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return await res.json();
  }

  (async () => {
    try {
      const [scenes, characters, vocab, quizzes, choruses, drills] = await Promise.all([
        loadJSON('data/scenes.json'),
        loadJSON('data/characters.json'),
        loadJSON('data/vocab.json'),
        loadJSON('data/quizzes.json'),
        loadJSON('data/choruses.json').catch(() => ({})),
        loadJSON('data/drills.json').catch(() => ({})),
      ]);
      data.scenes = stripSchema(scenes);
      data.characters = stripSchema(characters);
      data.vocab = stripSchema(vocab);
      data.quizzes = stripSchema(quizzes);
      data.choruses = stripSchema(choruses);
      data.drills = stripSchema(drills);
      load();
      applyMode();
      render();
    } catch (err) {
      app.innerHTML = `
        <div class="empty">
          <p><strong>Could not load story data.</strong></p>
          <p>${escapeHtml(err.message)}</p>
          <p>If you're opening <code>index.html</code> directly via <code>file://</code>, run a local server instead:</p>
          <p><code>python3 -m http.server</code> &nbsp;or&nbsp; <code>npx serve</code></p>
        </div>
      `;
      console.error(err);
    }
  })();
})();
