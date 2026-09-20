(() => {
  const CONFIG={roundsPerGame:10,clipSeconds:5,maxLives:3};
  const demoTracks=[{trackId:'demo-1',trackName:'Demo',artistName:'Artist',previewUrl:''}];
  const $=id=>document.getElementById(id);
  const state={catalog:[],queue:[],current:null,options:[],round:0,score:0,streak:0,bestStreak:0,correct:0,lives:CONFIG.maxLives,answered:false,clipStarted:false,timer:null,hintUsed:false,reviveUsed:false,ysdk:null,usingDemo:false,preparingGame:false};
  const audioValidityCache = new Map();
  let stats = {bestScore:0, bestStreak:0, roundsPlayed:0};
  
  // === FIREBASE НАСТРОЙКИ (ВСТАВЬ СВОИ ДАННЫЕ) ===
  const firebaseConfig = {
    apiKey: "AIzaSyAF_F3-LODFm7ZDCS5D0x-xq8XJ2e8Atl8",
    authDomain: "guessthesong-97155.firebaseapp.com",
    databaseURL: "https://guessthesong-97155-default-rtdb.firebaseio.com",
    projectId: "guessthesong-97155",
    storageBucket: "guessthesong-97155.firebasestorage.app",
    messagingSenderId: "163574999757",
    appId: "1:163574999757:web:c7d939c4d7a030dde25784",
    measurementId: "G-9YVHHLLX22"
  };

  
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  let myPlayerId = Math.random().toString(36).substr(2, 9);
  let currentRoomId = null;
  let isHost = false;
  let multiplayerMode = false;

  try {
    const saved = localStorage.getItem('gs5_stats');
    if (saved) stats = JSON.parse(saved);
  } catch(e) {}

  const audio=$('audio');
  let lastVolume = 1;
  let player = null;
  let lb = null;

  function sysPauseAudio() { if (!audio.paused && audio.src) { audio.dataset.sysPaused = '1'; audio.pause(); } }
  function sysResumeAudio() { if (audio.dataset.sysPaused === '1') { audio.play().catch(()=>{}); audio.dataset.sysPaused = '0'; } }
  document.addEventListener('visibilitychange', () => { if (document.hidden) sysPauseAudio(); else sysResumeAudio(); });

  const sfx = {
    ctx: null,
    init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
    play(freq, type, duration, vol) {
      if (!this.ctx || audio.volume === 0) return;
      const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(vol * audio.volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(); osc.stop(this.ctx.currentTime + duration);
    },
    click() { this.init(); this.play(600, 'sine', 0.1, 0.05); },
    correct() { this.init(); this.play(523.25, 'sine', 0.1, 0.1); setTimeout(() => this.play(659.25, 'sine', 0.2, 0.1), 100); },
    wrong() { this.init(); this.play(150, 'sawtooth', 0.2, 0.05); setTimeout(() => this.play(100, 'sawtooth', 0.3, 0.05), 150); }
  };

  document.body.addEventListener('click', e => { const btn = e.target.closest('button'); if (btn && !btn.classList.contains('answer-btn')) sfx.click(); });

  function setScreen(name){document.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.id===name+'Screen'));window.scrollTo({top:0,behavior:'smooth'})}
  function saveStats() { try { localStorage.setItem('gs5_stats', JSON.stringify(stats)); } catch(e){} updateHomeStats(); if (player) player.setData(stats).catch(()=>{}); if (lb && stats.bestScore > 0 && !multiplayerMode) lb.setLeaderboardScore('topplayers', stats.bestScore).catch(()=>{}); }
  function updateHomeStats(){$('bestScore').textContent=stats.bestScore.toLocaleString('ru-RU');$('roundsPlayed').textContent=stats.roundsPlayed}
  function toast(message){const node=$('toast');node.textContent=message;node.classList.add('show');clearTimeout(node._timer);node._timer=setTimeout(()=>node.classList.remove('show'),2400)}
  function shuffle(list){return[...list].sort(()=>Math.random()-.5)}
  function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function trackKey(t){return`${t.trackName}::${t.artistName}`}
  
  function renderCover(track) {
    const cover = $('cover');
    cover.style.background = 'transparent'; cover.style.border = 'none'; cover.style.boxShadow = 'none'; cover.style.borderRadius = '50%';
    const initials = (track.trackName || '♫').split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
    cover.innerHTML = `<svg id="vinylSvg" viewBox="0 0 100 100" style="width:100%;height:100%;border-radius:50%;box-shadow:0 10px 30px rgba(0,0,0,0.6);"><circle cx="50" cy="50" r="50" fill="#111"/><circle cx="50" cy="50" r="46" fill="none" stroke="#222" stroke-width="1.5"/><circle cx="50" cy="50" r="41" fill="none" stroke="#1a1a1a" stroke-width="2"/><circle cx="50" cy="50" r="35" fill="none" stroke="#222" stroke-width="1"/><circle cx="50" cy="50" r="28" fill="none" stroke="#1a1a1a" stroke-width="2"/><circle cx="50" cy="50" r="20" fill="none" stroke="#222" stroke-width="1"/><circle cx="50" cy="50" r="14" fill="#a987ff"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#1a102b" font-size="8px" font-weight="900" font-family="sans-serif">${escapeHtml(initials)}</text><circle cx="50" cy="50" r="3" fill="#0d0b17"/></svg>`;
  }

  function setCatalogStatus(text,mode=''){const node=$('catalogStatus');node.textContent=text;node.className=`status-chip ${mode}`}

  async function loadCatalog() {
    setCatalogStatus('Загрузка локальной базы...');
    try {
      const response = await fetch('catalog.json');
      if (!response.ok) throw new Error('Файл catalog.json не найден');
      const data = await response.json();
      if (!data || data.length < 4) throw new Error('Слишком мало треков');
      state.catalog = shuffle(data);
      state.usingDemo = false;
      setCatalogStatus(`${state.catalog.length} треков готовы`, 'online');
    } catch (error) {
      state.catalog = demoTracks; state.usingDemo = true;
      setCatalogStatus('Демо-каталог', 'warn');
    }
    if (state.ysdk && state.ysdk.features?.LoadingAPI?.ready) state.ysdk.features.LoadingAPI.ready();
  }
  
  function initYandex() {
    if (typeof YaGames === 'undefined') { loadCatalog(); return; }
    YaGames.init().then(ysdk => {
      state.ysdk = ysdk; loadCatalog();
      ysdk.getLeaderboards().then(_lb => { lb = _lb; updateLeaderboardUI(); }).catch(()=>{});
      ysdk.getPlayer({ scopes: false }).then(_player => {
          player = _player; return player.getData(['bestScore', 'bestStreak', 'roundsPlayed']);
        }).then(data => {
          if (data && data.bestScore !== undefined) {
            stats.bestScore = Math.max(stats.bestScore, data.bestScore || 0);
            stats.roundsPlayed = Math.max(stats.roundsPlayed, data.roundsPlayed || 0);
            updateHomeStats();
          }
        }).catch(()=>{});
    }).catch(() => { loadCatalog(); });
  }

  function updateLeaderboardUI() {
    if (!lb) return;
    lb.getLeaderboardEntries('topplayers', { quantityTop: 3 }).then(res => {
        const cards = document.querySelectorAll('.side-card'); let lbCard = null;
        cards.forEach(c => { if(c.querySelector('h2') && c.querySelector('h2').textContent.includes('Сегодня в топе')) lbCard = c; });
        if (!lbCard) return;
        let html = '<h2>Сегодня в топе</h2>';
        if (!res.entries || res.entries.length === 0) { html += '<div class="mini-leader"><span class="player" style="color:var(--muted)">Пока нет рекордов. Стань первым!</span></div>'; } 
        else {
          res.entries.forEach(entry => {
            const rank = entry.rank < 10 ? '0' + entry.rank : entry.rank;
            const name = entry.player.publicName || 'Аноним';
            html += `<div class="mini-leader"><span class="rank">#${rank}</span><span class="player">${escapeHtml(name)}</span><span class="score">${entry.score.toLocaleString('ru-RU')}</span></div>`;
          });
        }
        lbCard.innerHTML = html;
      }).catch(()=>{});
  }

  function showFullscreenAd(){
    if(state.ysdk?.adv?.showFullscreenAdv) state.ysdk.adv.showFullscreenAdv({ callbacks: { onOpen: sysPauseAudio, onClose: sysResumeAudio, onError: sysResumeAudio, onOffline: sysResumeAudio }});
  }
  function showRewardedAd(onReward, onFail){
    if(!state.ysdk?.adv?.showRewardedVideo){ onReward(); toast('Демо-режим: реклама пропущена'); return; }
    state.ysdk.adv.showRewardedVideo({ callbacks: { onOpen: sysPauseAudio, onRewarded: onReward, onClose: sysResumeAudio, onError: () => { sysResumeAudio(); toast('Реклама недоступна'); if(onFail) onFail(); } } });
  }

  // === СЕТЕВАЯ ЛОГИКА (ЛОББИ) ===
  $('btnSolo').addEventListener('click', () => { multiplayerMode = false; startGameSolo(); });
  $('btn1v1').addEventListener('click', () => { multiplayerMode = true; startMatchmaking(); });$('btnCustom').addEventListener('click', () => { multiplayerMode = true; showCustomLobbyMenu(); });

  function showCustomLobbyMenu() {
    setScreen('lobby');
    $('lobbyTitle').textContent = 'Игра с друзьями';
    $('roomCodeBox').style.display = 'none';
    $('joinBox').style.display = 'block';$('playersList').innerHTML = '<button class="primary-btn" id="btnCreateRoom" style="width:100%; margin-bottom:20px;">+ Создать свою комнату</button>';
    $('btnCreateRoom').onclick = createCustomRoom;
    $('btnStartMultiplayer').style.display = 'none';
    showFullscreenAd();
  }

  function createCustomRoom() {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    currentRoomId = code; isHost = true;
    db.ref('rooms/' + code).set({ type: 'custom', state: 'waiting', host: myPlayerId, players: { [myPlayerId]: { name: player?.publicName || 'Я (Хост)', score: 0 } } });
    setupLobbyUI(code); listenToRoom(code);
  }

  $('btnJoinRoom').addEventListener('click', () => {
    const code = $('roomCodeInput').value.trim();
    if (code.length !== 6) return toast('Введите 6-значный код');
    db.ref('rooms/' + code).once('value', snapshot => {
      if (!snapshot.exists()) return toast('Комната не найдена');
      if (snapshot.val().state !== 'waiting') return toast('Игра уже началась');
      currentRoomId = code; isHost = false;
      db.ref('rooms/' + code + '/players/' + myPlayerId).set({ name: player?.publicName || 'Игрок', score: 0 });
      setupLobbyUI(code); listenToRoom(code);
    });
  });

  function startMatchmaking() {
    setScreen('lobby');
    $('lobbyTitle').textContent = 'Поиск соперника...';
    $('joinBox').style.display = 'none'; $('roomCodeBox').style.display = 'none';$('playersList').innerHTML = '<div class="loading-dots"><i></i><i></i><i></i></div>';
    $('btnStartMultiplayer').style.display = 'none';

    db.ref('rooms').orderByChild('type').equalTo('1v1').once('value', snap => {
      let found = false;
      snap.forEach(child => {
         let room = child.val();
         if (room.state === 'waiting' && Object.keys(room.players || {}).length === 1) {
            currentRoomId = child.key; isHost = false;
            db.ref('rooms/' + currentRoomId + '/players/' + myPlayerId).set({ name: player?.publicName || 'Соперник', score: 0 });
            listenToRoom(currentRoomId); found = true; return true;
         }
      });
      if (!found) {
         currentRoomId = Math.floor(100000 + Math.random() * 900000).toString(); isHost = true;
         db.ref('rooms/' + currentRoomId).set({ type: '1v1', state: 'waiting', host: myPlayerId, players: { [myPlayerId]: { name: player?.publicName || 'Я', score: 0 } } });
         listenToRoom(currentRoomId);
      }
    });
  }

  function setupLobbyUI(code) {
    $('joinBox').style.display = 'none'; $('roomCodeBox').style.display = 'block';$('roomCodeDisplay').textContent = code;
    if (isHost) {
      $('btnStartMultiplayer').style.display = 'block';$('btnStartMultiplayer').textContent = 'Начать игру';
      $('btnStartMultiplayer').disabled = false;
    }
  }

  function listenToRoom(code) {
    db.ref('rooms/' + code).on('value', snapshot => {
      const data = snapshot.val();
      if (!data) return leaveLobby(); 
      const pl = data.players || {};
      
      if (data.state === 'waiting') {
        $('playersList').innerHTML = Object.keys(pl).map(id => `<div class="player-item"><span class="player-name">${escapeHtml(pl[id].name)}</span><span class="player-status ready">Готов</span></div>`).join('');
        if (isHost && data.type === '1v1' && Object.keys(pl).length === 2) {
          startHostGameProcess();
        }
      }

      if (data.state === 'playing') {
        let opsHtml = '';
        for (let id in pl) {
          if (id !== myPlayerId) opsHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.1); padding:4px 0;"><span>${escapeHtml(pl[id].name)}</span> <b>${pl[id].score}</b></div>`;
        }
        $('opponentsScores').innerHTML = opsHtml || 'Ждем игроков...';
        
        if (!state.preparingGame && state.round === 0 && data.queue) {
          startMultiplayerGame(data.queue);
        }
      }
    });
  }

  $('btnLeaveLobby').addEventListener('click', leaveLobby);
  function leaveLobby() {
    if (currentRoomId) {
      db.ref('rooms/' + currentRoomId + '/players/' + myPlayerId).remove();
      if (isHost) db.ref('rooms/' + currentRoomId).remove();
      db.ref('rooms/' + currentRoomId).off();
    }
    currentRoomId = null; isHost = false;
    setScreen('home');
  }

  // === ВАЛИДАЦИЯ АУДИО ===
  function validateTrackAudio(track) {
    const url = String(track?.previewUrl || '').trim();
    if (!url) return Promise.resolve(false);
    if (audioValidityCache.has(url)) return Promise.resolve(audioValidityCache.get(url));

    return new Promise(resolve => {
      const probe = new Audio(); let settled = false;
      const finish = valid => { if (settled) return; settled = true; clearTimeout(timeout); probe.removeEventListener('canplay', onReady); probe.removeEventListener('error', onError); probe.pause(); probe.removeAttribute('src'); probe.load(); audioValidityCache.set(url, valid); resolve(valid); };
      const onReady = () => finish(true); const onError = () => finish(false);
      const timeout = setTimeout(() => finish(false), 6500);
      probe.preload = 'metadata'; probe.addEventListener('canplay', onReady, { once:true }); probe.addEventListener('error', onError, { once:true });
      probe.src = url; probe.load();
    });
  }

  async function collectValidTracks(requiredCount) {
    const candidates = shuffle(state.catalog).filter(track => track?.previewUrl);
    const valid = []; const checkedUrls = new Set(); const batchSize = 6;
    for (let index = 0; index < candidates.length && valid.length < requiredCount; index += batchSize) {
      const batch = candidates.slice(index, index + batchSize).filter(track => { const url = String(track.previewUrl || '').trim(); if (!url || checkedUrls.has(url)) return false; checkedUrls.add(url); return true; });
      const results = await Promise.all(batch.map(validateTrackAudio));
      batch.forEach((track, i) => { if (results[i] && valid.length < requiredCount) valid.push(track); });
    }
    return valid;
  }

  // === СТАРТ ИГРЫ ===
  $('btnStartMultiplayer').addEventListener('click', startHostGameProcess);
  
  async function startHostGameProcess() {
    if (!isHost) return;
    $('btnStartMultiplayer').disabled = true; $('btnStartMultiplayer').textContent = 'Подготовка треков...';
    const validTracks = await collectValidTracks(CONFIG.roundsPerGame);
    if(validTracks.length < CONFIG.roundsPerGame) { toast('Ошибка каталога'); $('btnStartMultiplayer').disabled = false; return; }
    db.ref('rooms/' + currentRoomId).update({ state: 'playing', queue: validTracks });
  }

  async function startGameSolo() {
    if(state.catalog.length<4){toast('Каталог загружается');return}
    if(state.preparingGame) return;
    state.preparingGame=true; $('btnSolo').disabled=true; $('btnSolo').textContent='Проверяем аудио…';
    try {
      const validTracks=await collectValidTracks(CONFIG.roundsPerGame);
      if(validTracks.length<CONFIG.roundsPerGame){ toast('Мало треков'); return; }
      state.queue=shuffle(validTracks);
      resetGameData();
      $('multiplayerStats').style.display = 'none';
      setScreen('game'); nextRound();
    } finally { state.preparingGame=false; $('btnSolo').disabled=false; $('btnSolo').textContent='👤 Играть одному'; }
  }

  function startMultiplayerGame(sharedQueue) {
    state.preparingGame = true;
    state.queue = sharedQueue;
    resetGameData();
    $('multiplayerStats').style.display = 'block';
    setScreen('game'); nextRound();
    state.preparingGame = false;
  }

  function resetGameData() {
    state.round=0; state.score=0; state.streak=0; state.bestStreak=0; state.correct=0;
    state.lives=CONFIG.maxLives; state.hintUsed=false; state.reviveUsed=false;
    $('scoreLabel').textContent='0'; updateHearts();
  }
  
  function updateHearts(){$('hearts').innerHTML=Array.from({length:CONFIG.maxLives},(_,i)=>`<span class="heart ${i<state.lives?'live':''}">♥</span>`).join('')}
  
  function buildOptions(answer){
    const others=shuffle(state.catalog.filter(t=>trackKey(t)!==trackKey(answer))).slice(0,3);
    state.options=shuffle([answer,...others]);
    $('answerGrid').innerHTML=state.options.map((t,i)=>`<button class="answer-btn" data-index="${i}" type="button"><span class="answer-letter">${String.fromCharCode(65+i)}</span><span class="answer-text"><b>${escapeHtml(t.trackName)}</b><span>${escapeHtml(t.artistName)}</span></span></button>`).join('');
    document.querySelectorAll('.answer-btn').forEach(btn=>btn.addEventListener('click',()=>answerRound(Number(btn.dataset.index))));
  }
  
  function askRevive() {
    if (multiplayerMode) return finishGame(); 
    $('modalTitle').textContent = 'Вторая попытка'; $('modalText').textContent = 'Жизни кончились! Посмотри рекламу, чтобы получить +1 жизнь.';
    $('modalActions').innerHTML = '<button id="btnRevive" class="primary-btn" type="button">🎥 Продолжить</button><button id="btnDie" class="secondary-btn" type="button">Сдаться</button>';
    $('modal').classList.add('open');
    $('btnRevive').onclick = () => {$('modal').classList.remove('open'); showRewardedAd(() => { state.reviveUsed = true; state.lives = 1; updateHearts(); nextRound(); }, () => finishGame()); };
    $('btnDie').onclick = () => {$('modal').classList.remove('open'); finishGame(); };
  }

  function askQuit() {
    $('modalTitle').textContent = 'Выход'; $('modalText').textContent = 'Завершить раунд и выйти на главную?';
    $('modalActions').innerHTML = '<button id="btnConfirmQuit" class="primary-btn" type="button" style="background:var(--danger)">Выйти</button><button id="btnCancelQuit" class="secondary-btn" type="button">Продолжить</button>';
    $('modal').classList.add('open');
    $('btnConfirmQuit').onclick = () => {$('modal').classList.remove('open'); clearTimer(); try { audio.pause(); } catch(e) {} leaveLobby(); };
    $('btnCancelQuit').onclick = () => {$('modal').classList.remove('open'); };
  }

  function nextRound(){
    clearTimer();state.answered=false;state.clipStarted=false;state.hintUsed=false;
    if(state.lives<=0) { if(!state.reviveUsed) return askRevive(); return finishGame(); }
    if(state.round>=CONFIG.roundsPerGame) return finishGame();
    state.current=state.queue[state.round];state.round++;
    $('roundKicker').textContent=`РАУНД ${state.round} / ${CONFIG.roundsPerGame}`;
    $('streakLabel').textContent=`Стрик ${state.streak}`;
    $('roundStatus').textContent='Ждём твоего ответа';
    $('questionSub').textContent=state.usingDemo?'Демо-режим: нет аудиофайлов':'Фрагмент готов — включай и выбирай';
    $('timeProgress').style.width='0\%';$('playClipBtn').textContent='▶ Слушать 5 сек';
    $('playClipBtn').disabled=false;
    $('hintBtn').disabled=multiplayerMode; 
    
    renderCover(state.current); buildOptions(state.current);
    if(state.current.previewUrl){audio.src=state.current.previewUrl;audio.load()}else audio.removeAttribute('src')
  }
  
  function clearTimer(){ clearInterval(state.timer); state.timer=null; $('soundWave').classList.remove('playing'); const vinyl =$('vinylSvg'); if(vinyl) vinyl.style.animation = 'none'; }
  
  async function replaceUnavailableRound() {
    $('playClipBtn').disabled = true; $('playClipBtn').textContent = 'Ищем замену…';
    const used = new Set(state.queue.slice(0, state.round).map(trackKey));
    const candidates = shuffle(state.catalog).filter(track => !used.has(trackKey(track)));
    for (const candidate of candidates) {
      if (await validateTrackAudio(candidate)) {
        state.queue[state.round - 1] = candidate; state.current = candidate;
        renderCover(candidate); buildOptions(candidate);
        audio.src = candidate.previewUrl; audio.load();
        $('questionSub').textContent = 'Трек заменён — можно слушать'; $('roundStatus').textContent = 'Ждём твоего ответа';
        $('playClipBtn').disabled = false; $('playClipBtn').textContent = '▶ Слушать 5 сек';
        return;
      }
    }
    $('playClipBtn').disabled = false; $('playClipBtn').textContent = '▶ Повторить поиск'; $('roundStatus').textContent = 'Нет доступного аудио'; toast('Не удалось найти замену');
  }

  function playClip() {
    if(state.timer || state.answered) return; 
    state.clipStarted = true; $('playClipBtn').disabled = true; $('playClipBtn').textContent = '♪ Играет…'; $('roundStatus').textContent = 'Слушай внимательно'; $('soundWave').classList.add('playing');
    const vinyl = $('vinylSvg'); if(vinyl) vinyl.style.animation = 'spin 2s linear infinite';
    if(audio.src) {
      audio.currentTime = 0;
      audio.play().catch((e) => {
          audioValidityCache.set(state.current.previewUrl, false); clearTimer(); state.clipStarted = false;
          if (multiplayerMode) { toast('Сбой трека. Угадывай наугад!'); $('playClipBtn').textContent = 'Сбой аудио'; $('roundStatus').textContent = 'Выбирай вариант'; } 
          else { $('playClipBtn').disabled = false; $('playClipBtn').textContent = '▶ Другой трек'; toast('Заменяем трек'); replaceUnavailableRound(); }
      });
    } else { toast('Нет аудиофайла'); }
    
    const started = performance.now();
    state.timer = setInterval(() => {
      const pct = Math.min(100, ((performance.now() - started) / (CONFIG.clipSeconds * 1000)) * 100);
      $('timeProgress').style.width = `${pct}%`;
      if (pct >= 100) {
        clearTimer(); try { audio.pause() } catch{}
        $('roundStatus').textContent = 'Фрагмент закончился — выбирай';
        $('playClipBtn').disabled = false; $('playClipBtn').textContent = '↻ Послушать ещё';
      }
    }, 80);
  }
  
  function answerRound(index){
    if(state.answered||!state.clipStarted){if(!state.clipStarted)toast('Сначала включи фрагмент');return}
    state.answered=true;clearTimer();try{audio.pause()}catch{}
    const chosen=state.options[index];const correct=trackKey(chosen)===trackKey(state.current);
    document.querySelectorAll('.answer-btn').forEach((btn,i)=>{btn.disabled=true;if(trackKey(state.options[i])===trackKey(state.current))btn.classList.add('correct')});
    
    if(correct){
      sfx.correct(); document.querySelectorAll('.answer-btn')[index].classList.add('correct');
      state.correct++;state.streak++;state.bestStreak=Math.max(state.bestStreak,state.streak);
      const mult=state.streak>=5?3:state.streak>=3?2:1;const points=100*mult;state.score+=points;
      $('roundStatus').textContent=`Верно! +${points} очков`;toast(`🔥 Стрик ${state.streak}!`);
    } else {
      sfx.wrong(); document.querySelectorAll('.answer-btn')[index].classList.add('wrong');
      state.lives--;state.streak=0;$('roundStatus').textContent=`Не угадал. Это «${state.current.trackName}»`;updateHearts();
    }
    $('scoreLabel').textContent=state.score.toLocaleString('ru-RU');$('streakLabel').textContent=`Стрик ${state.streak}`;$('hintBtn').disabled=true;
    
    if (multiplayerMode && currentRoomId) { db.ref(`rooms/${currentRoomId}/players/${myPlayerId}/score`).set(state.score); }
    setTimeout(()=>nextRound(),correct?900:1300)
  }

  function finishGame(){
    clearTimer();
    if (!multiplayerMode) {
      stats.bestScore=Math.max(stats.bestScore,state.score);stats.bestStreak=Math.max(stats.bestStreak,state.bestStreak);stats.roundsPlayed++;saveStats();
      $('finalScore').textContent=state.score.toLocaleString('ru-RU');$('finalCorrect').textContent=`${state.correct}/${CONFIG.roundsPerGame}`;$('finalStreak').textContent=state.bestStreak;$('finalMultiplier').textContent=`×${state.bestStreak>=5?3:state.bestStreak>=3?2:1}`;
      $('resultTitle').textContent=state.lives<=0?'Жизни закончились':'Раунд окончен';
      $('resultCopy').textContent=state.score>stats.bestScore-1?'Новый личный рекорд!':'Неплохо. Следующий стрик может быть ещё длиннее.';
      setScreen('result');
      if(stats.roundsPlayed%3===0) setTimeout(showFullscreenAd,350);
    } else {
      $('resultTitle').textContent='Матч завершен';
      $('resultCopy').innerHTML='Подводим итоги...';
      $('finalScore').textContent=state.score.toLocaleString('ru-RU');$('finalCorrect').textContent=`${state.correct}/${CONFIG.roundsPerGame}`;$('finalStreak').textContent='—';$('finalMultiplier').textContent='—';
      setScreen('result');
      
      db.ref(`rooms/${currentRoomId}/players`).once('value', snap => {
         let players = []; snap.forEach(p => { players.push(p.val()); });
         players.sort((a,b) => b.score - a.score);
         let rankHtml = players.map((p, i) => `<div style="font-size:18px; margin:10px 0;">#${i+1} <b>${escapeHtml(p.name)}</b>: ${p.score}</div>`).join('');
         $('resultCopy').innerHTML = rankHtml;
      });
      if (isHost) setTimeout(() => { db.ref('rooms/' + currentRoomId).remove(); currentRoomId = null; isHost = false; }, 5000);
      else currentRoomId = null;
    }
  }

  $('playClipBtn').addEventListener('click',playClip);
  $('againBtn').addEventListener('click', () => { if (multiplayerMode) setScreen('home'); else startGameSolo(); });$('homeBtn').addEventListener('click',()=>setScreen('home'));
  $('helpBtn').addEventListener('click',()=>{$('modalTitle').textContent='Как играть'; $('modalText').textContent='За раунд нужно угадать 10 песен. Правильные ответы увеличивают стрик. Ошибка отнимает жизнь.'; $('modalActions').innerHTML='<button id="modalOk" class="primary-btn">Понятно</button>'; $('modal').classList.add('open');$('modalOk').onclick=()=>$('modal').classList.remove('open'); });$('modalClose').addEventListener('click', ()=>{$('modal').classList.remove('open');});$('volumeSlider').addEventListener('input', (e) => { 
    const v = parseFloat(e.target.value); 
    audio.volume = v; 
    if (v > 0) lastVolume = v; 
    $('soundToggle').textContent = v === 0 ? '🔇' : (v < 0.5 ? '🔉' : '🔊'); 
  });
  $('soundToggle').textContent = '🔊';
  $('soundToggle').addEventListener('click', () => { 
    if (audio.volume > 0) { 
      audio.volume = 0; 
      $('volumeSlider').value = 0; 
      $('soundToggle').textContent = '🔇'; 
    } else { 
      audio.volume = lastVolume || 1; 
      $('volumeSlider').value = lastVolume || 1; 
      $('soundToggle').textContent = lastVolume < 0.5 ? '🔉' : '🔊'; 
    } 
  });
  
  $('quitGameBtn').addEventListener('click', askQuit);
  
  updateHomeStats();
  initYandex();
})();