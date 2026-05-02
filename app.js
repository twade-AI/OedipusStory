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

  const data = { scenes: null, characters: null, vocab: null, quizzes: null };

  const state = {
    current: 'start',
    history: [],       // visited scene IDs in order
    clues: [],
    charsMet: new Set(),
    quizDone: {},      // { sceneId: 'correct' | 'wrong' }
    view: 'story',
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

    app.innerHTML = `
      <article class="scene">
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
          ? `<div class="ending-banner">FINIS — fabula completa est.</div>`
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
        state.current = choice.next;
        save();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    save();
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

    return `
      <section class="quiz" aria-label="Comprehension quiz">
        <h3>Quaestio: ${escapeHtml(quiz.q)}</h3>
        <div class="quiz-options">${optsHtml}</div>
        ${explain}
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
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset the story? All progress will be lost.')) return;
    state.current = 'start';
    state.history = [];
    state.clues = [];
    state.charsMet = new Set();
    state.quizDone = {};
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
      const [scenes, characters, vocab, quizzes] = await Promise.all([
        loadJSON('data/scenes.json'),
        loadJSON('data/characters.json'),
        loadJSON('data/vocab.json'),
        loadJSON('data/quizzes.json'),
      ]);
      data.scenes = stripSchema(scenes);
      data.characters = stripSchema(characters);
      data.vocab = stripSchema(vocab);
      data.quizzes = stripSchema(quizzes);
      load();
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
