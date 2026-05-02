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

  const data = { scenes: null, characters: null, vocab: null, quizzes: null, choruses: null };

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
    view: 'story',
  };

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
          return `<span class="lat" tabindex="0" role="button" data-en="${escapeHtml(vocab[clean])}">${escapeHtml(token)}</span>`;
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
    }

    // Riddle-type scenes go through their own renderer.
    if (scene.sceneType === 'riddle') {
      renderRiddle(scene);
      save();
      return;
    }

    const isEnding = !!scene.isEnding;

    // Cast strip — small portrait medallions for characters present in this scene.
    const castIds = (Array.isArray(scene.chars) ? scene.chars : []).filter(id => data.characters[id]);
    const castHtml = castIds.length === 0 ? '' : `
      <div class="scene-cast" aria-label="In this scene">
        ${castIds.map(id => {
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
          <h2 class="scene-title">${escapeHtml(scene.title || '')}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></h2>
          <p class="scene-title-en line-en">${escapeHtml(scene.titleEn || '')}</p>
        </div>
        ${scene.setting ? `<p class="scene-setting">${escapeHtml(scene.setting)}</p>` : ''}
        ${castHtml}
        <div class="narrative">${latinize(scene.latin)}</div>
        ${quizHtml}
        ${isEnding
          ? `<div class="ending-banner">FINIS — fabula completa est.</div>${renderEndingFooter()}`
          : `
            <div class="translatable">
              <p class="question">${latinize(scene.question)}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
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
        <p class="chorus-eyebrow">Chorus &nbsp;·&nbsp; ${escapeHtml(chapter)}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
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
        <p class="epilogue-latin">${latinize(la)}<button type="button" class="reveal-toggle" aria-pressed="false" aria-label="Reveal English translation">en</button></p>
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
      </section>
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
    // Walk every visited scene + every clue. Tokenise everything Latin-bearing.
    const vocab = data.vocab || {};
    const seen = new Set();

    const harvest = (text) => {
      if (!text) return;
      text.split(/(\s+|[.,!?;:"'’“”—–()])/).forEach(tok => {
        const clean = cleanWord(tok);
        if (clean && vocab[clean]) seen.add(clean);
      });
    };

    state.history.forEach(id => {
      const sc = data.scenes[id];
      if (!sc) return;
      harvest(sc.title);
      harvest(sc.latin);
      harvest(sc.question);
      (sc.choices || []).forEach(ch => harvest(ch.latin));
    });
    state.clues.forEach(harvest);

    if (seen.size === 0) {
      app.innerHTML = `<p class="empty">No vocabulary encountered yet.</p>`;
      return;
    }

    const sorted = [...seen].sort();
    const rows = sorted.map(w => `<dt>${escapeHtml(w)}</dt><dd>${escapeHtml(vocab[w])}</dd>`).join('');
    app.innerHTML = `<dl class="vocab-grid">${rows}</dl>`;
  }

  // --- main render dispatcher ----------------------------------------------
  function render() {
    switch (state.view) {
      case 'cards': renderCards(); break;
      case 'clues': renderClues(); break;
      case 'vocab': renderVocab(); break;
      case 'story':
      default: renderStory(); break;
    }
  }

  // --- click-to-reveal: line-level translation toggle and per-word reveal --
  document.addEventListener('click', (e) => {
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
    lat.classList.toggle('revealed');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const lat = e.target.closest && e.target.closest('.lat');
    if (!lat) return;
    e.preventDefault();
    lat.classList.toggle('revealed');
  });

  // --- quiz click handler --------------------------------------------------
  app.addEventListener('click', (e) => {
    const btn = e.target.closest('.quiz-opt');
    if (!btn || btn.disabled) return;
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
      const [scenes, characters, vocab, quizzes, choruses] = await Promise.all([
        loadJSON('data/scenes.json'),
        loadJSON('data/characters.json'),
        loadJSON('data/vocab.json'),
        loadJSON('data/quizzes.json'),
        loadJSON('data/choruses.json').catch(() => ({})),
      ]);
      data.scenes = stripSchema(scenes);
      data.characters = stripSchema(characters);
      data.vocab = stripSchema(vocab);
      data.quizzes = stripSchema(quizzes);
      data.choruses = stripSchema(choruses);
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
