(() => {
  const CONFIG={roundsPerGame:10,clipSeconds:5,maxLives:3};
  const demoTracks=[{trackId:'demo-1',trackName:'Demo',artistName:'Artist',previewUrl:''}];
  const $=id=>document.getElementById(id);
  const state={catalog:[],queue:[],current:null,options:[],round:0,score:0,streak:0,bestStreak:0,correct:0,lives:CONFIG.maxLives,answered:false,clipStarted:false,timer:null,hintUsed:false,reviveUsed:false,ysdk:null,usingDemo:false};
  let stats = {bestScore:0, bestStreak:0, roundsPlayed:0};
  
  // === FIREBASE НАСТРОЙКИ (ВСТАВЬ СВОИ) ===
  const firebaseConfig = {
    apiKey: "ТВОЙ_API_КЛЮЧ",
    authDomain: "твой-проект.firebaseapp.com",
    databaseURL: "https://твой-проект-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "твой-проект",
    storageBucket: "твой-проект.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456:web:abcd"
  };
  
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  let myPlayerId = Math.random().toString(36).substr(2, 9);
  let currentRoomId = null;
  let isHost = false;
  let isMultiplayer = false;
  let inMultiplayerMatch = false;
  let mpRoomRef = null;

  try { const saved = localStorage.getItem('gs5_stats'); if (saved) stats = JSON.parse(saved); } catch(e) {}

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
  function saveStats() { try { localStorage.setItem('gs5_stats', JSON.stringify(stats)); } catch(e){} updateHomeStats(); if (player) player.setData(stats).catch(()=>{}); if (lb && stats.bestScore > 0 && !isMultiplayer) lb.setLeaderboardScore('topplayers', stats.bestScore).catch(()=>{}); }
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

  // --- Загрузка и Яндекс ---
  async function loadCatalog() {
    setCatalogStatus('Загрузка локальной базы...');
    try {
      const response = await fetch('catalog.json');
      if (!response.ok) throw new Error('Файл catalog.json не найден');
      const data = await response.json();
      if (!data || data.length < 4) throw new Error('Слишком мало треков');
      state.catalog = shuffle(data); state.usingDemo = false;
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
            stats.bestStreak = Math.max(stats.bestStreak, data.bestStreak || 0);
            stats.roundsPlayed = Math.max(stats.roundsPlayed, data.roundsPlayed || 0);
            updateHomeStats();
          }
        }).catch(()=>{});
    }).catch(() => { loadCatalog(); });
  }

  function updateLeaderboardUI() {
    if (!lb) return;
    lb.getLeaderboardEntries('topplayers', { quantityTop: 3 }).then(res => {
        let html = '';
        if (!res.entries || res.entries.length === 0) { html = '<div class="mini-leader"><span class="player" style="color:var(--muted)">Стань первым!</span></div>'; } 
        else {
          res.entries.forEach(entry => {
            const rank = entry.rank < 10 ? '0' + entry.rank : entry.rank;
            const name = entry.player.publicName || 'Аноним';
            html += `<div class="mini-leader"><span class="rank">#${rank}</span><span class="player">${escapeHtml(name)}</span><span class="score">${entry.score.toLocaleString('ru-RU')}</span></div>`;
          });
        }
        $('leaderboardContainer').innerHTML = html;
      }).catch(()=>{});
  }

  function showFullscreenAd(){
    if(state.ysdk?.adv?.showFullscreenAdv) state.ysdk.adv.showFullscreenAdv({ callbacks: { onOpen: sysPauseAudio, onClose: sysResumeAudio, onError: sysResumeAudio, onOffline: sysResumeAudio }});
  }
  function showRewardedAd(onReward, onFail){
    if(!state.ysdk?.adv?.showRewardedVideo){ onReward(); toast('Демо-режим: реклама пропущена'); return; }
    state.ysdk.adv.showRewardedVideo({ callbacks: { onOpen: sysPauseAudio, onRewarded: onReward, onClose: sysResumeAudio, onError: () => { sysResumeAudio(); toast('Реклама недоступна'); if(onFail) onFail(); } } });
  }

  // --- МУЛЬТИПЛЕЕР (МОДАЛКА И СЕТЬ) ---
  $('btn1v1').addEventListener('click', () => { showFullscreenAd(); startMatchmaking(); });$('btnCustom').addEventListener('click', () => { showFullscreenAd(); showLobbyModal(); });

  function showLobbyModal() {
    $('mpTitle').textContent = 'Своя игра';
    $('mpSelection').style.display = 'block';
    $('mpLobby').style.display = 'none';$('mpModal').classList.add('open');
  }

  $('btnCreateRoom').addEventListener('click', () => {
    currentRoomId = Math.floor(100000 + Math.random() * 900000).toString();
    isHost = true;
    joinRoomFirebase(currentRoomId, 'custom');
  });

  $('btnJoinRoom').addEventListener('click', () => {
    const code = $('mpRoomInput').value.trim();
    if (code.length !== 6) return toast('Введите 6 цифр');
    db.ref('rooms/' + code).once('value', snap => {
      if (!snap.exists()) return toast('Комната не найдена');
      if (snap.val().state !== 'waiting') return toast('Игра уже началась');
      currentRoomId = code; isHost = false;
      joinRoomFirebase(currentRoomId, 'custom');
    });
  });

  function startMatchmaking() {
    $('mpTitle').textContent = 'Поиск 1 на 1...';
    $('mpSelection').style.display = 'none'; $('mpLobby').style.display = 'block';$('mpCodeBlock').style.display = 'none'; $('btnStartMp').style.display = 'none';$('mpPlayersList').innerHTML = '<div style="text-align:center; margin:20px 0;"><div class="loading-dots" style="color:var(--violet); transform:scale(1.5);"><i></i><i></i><i></i></div></div>';
    $('mpModal').classList.add('open');

    db.ref('rooms').orderByChild('type').equalTo('1v1').once('value', snap => {
      let found = false;
      snap.forEach(child => {
         let room = child.val();
         if (room.state === 'waiting' && Object.keys(room.players || {}).length === 1) {
            currentRoomId = child.key; isHost = false; found = true;
            joinRoomFirebase(currentRoomId, '1v1'); return true;
         }
      });
      if (!found) {
         currentRoomId = Math.floor(100000 + Math.random() * 900000).toString(); isHost = true;
         joinRoomFirebase(currentRoomId, '1v1');
      }
    });
  }

  function joinRoomFirebase(roomId, roomType) {
    isMultiplayer = true; inMultiplayerMatch = false;
    $('mpSelection').style.display = 'none';$('mpLobby').style.display = 'block';
    if(roomType === 'custom') {
       $('mpCodeBlock').style.display = 'block';$('mpRoomCodeDisplay').textContent = roomId;
    }

    mpRoomRef = db.ref('rooms/' + roomId);
    if (isHost) {
      mpRoomRef.set({ type: roomType, state: 'waiting', host: myPlayerId, players: { [myPlayerId]: { name: player?.publicName || 'Я (Хост)', score: 0 } } });
      if(roomType === 'custom') $('btnStartMp').style.display = 'block';
    } else {
      mpRoomRef.child('players/' + myPlayerId).set({ name: player?.publicName || 'Игрок', score: 0 });
    }

    // Слушаем изменения в комнате
    mpRoomRef.on('value', snap => {
      const data = snap.val();
      if (!data) return leaveLobby(); // Хост вышел
      
      const pl = data.players || {};
      
      if (data.state === 'waiting') {
        $('mpPlayersList').innerHTML = Object.keys(pl).map(id => `<div class="mp-player ready"><span>${escapeHtml(pl[id].name)}</span><span style="color:var(--green)">В лобби</span></div>`).join('');
        // Автостарт для 1 на 1
        if (isHost && data.type === '1v1' && Object.keys(pl).length === 2) {
          generateAndStartMpGame();
        }
      }

      if (data.state === 'playing') {
        // Обновляем очки на экране игры
        let opsHtml = '';
        for (let id in pl) {
          if (id !== myPlayerId) opsHtml += `<div class="mp-score-item"><span>${escapeHtml(pl[id].name)}</span><b>${pl[id].score}</b></div>`;
        }
        $('mpOpponentScores').innerHTML = opsHtml || 'Ждем...';

        // Синхронный старт у всех (передаем только ключи треков, чтобы Firebase не съел ссылки!)
        if (data.queueKeys && !inMultiplayerMatch) {
          inMultiplayerMatch = true;
          $('mpModal').classList.remove('open');
          
          // Восстанавливаем локальные объекты треков по ключам
          const mappedQueue = data.queueKeys.map(key => state.catalog.find(t => trackKey(t) === key)).filter(Boolean);
          
          if(mappedQueue.length > 3) {
            state.queue = mappedQueue;
            resetGameData();
            $('mpScoreBoard').style.display = 'block';$('formulaCard').style.display = 'none';
            setScreen('game'); nextRound();
          } else {
            toast('Сбой синхронизации каталога'); leaveLobby();
          }
        }
      }
    });
  }

  $('btnStartMp').addEventListener('click', generateAndStartMpGame);
  
  function generateAndStartMpGame() {
    if (!isHost || !mpRoomRef) return;
    $('btnStartMp').disabled = true; $('btnStartMp').textContent = 'Готовим треки...';
    // Отправляем только ID-шники (чтобы Firebase не сломал структуру объектов)
    const queueKeys = shuffle(state.catalog).slice(0, CONFIG.roundsPerGame).map(trackKey);
    mpRoomRef.update({ state: 'playing', queueKeys: queueKeys });
  }

  $('mpModalClose').addEventListener('click', leaveLobby);
  function leaveLobby() {
    if (mpRoomRef) {
      mpRoomRef.child('players/' + myPlayerId).remove();
      if (isHost) mpRoomRef.remove();
      mpRoomRef.off();
    }
    isMultiplayer = false; inMultiplayerMatch = false; mpRoomRef = null; currentRoomId = null; isHost = false;
    $('mpModal').classList.remove('open'); setScreen('home');
  }

  // --- ОДИНОЧНАЯ ИГРА И ЛОГИКА РАУНДОВ ---
  $('startBtn').addEventListener('click', startGameSolo);

  function startGameSolo(){
    if(state.catalog.length<4){toast('Каталог ещё загружается');return}
    isMultiplayer = false;
    state.queue=shuffle(state.catalog).slice(0,CONFIG.roundsPerGame);
    resetGameData();
    $('mpScoreBoard').style.display = 'none';$('formulaCard').style.display = 'block';
    setScreen('game'); nextRound();
  }
  
  function resetGameData() {
    state.round=0; state.score=0; state.streak=0; state.bestStreak=0; state.correct=0; state.lives=CONFIG.maxLives; state.hintUsed=false; state.reviveUsed=false;
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
    if (isMultiplayer) return finishGame(); // В мультиплеере нет возрождений, игра идет на счет
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
    $('btnConfirmQuit').onclick = () => {$('modal').classList.remove('open'); clearTimer(); try { audio.pause(); } catch(e) {} if(isMultiplayer) leaveLobby(); else setScreen('home'); };
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
    $('hintBtn').disabled=isMultiplayer; // Без подсказок в онлайне
    
    renderCover(state.current); buildOptions(state.current);
    if(state.current.previewUrl){audio.src=state.current.previewUrl;audio.load()}else audio.removeAttribute('src')
  }
  
  function clearTimer(){ clearInterval(state.timer); state.timer=null; $('soundWave').classList.remove('playing'); const vinyl =$('vinylSvg'); if(vinyl) vinyl.style.animation = 'none'; }
  
  function playClip() {
    if(state.timer || state.answered) return; 
    
    // Невидимый хук для разблокировки аудио-контекста в браузере (критично для мультиплеера)
    if(isMultiplayer && state.round === 1 && audio.src) { audio.play().catch(()=>{}); audio.pause(); }

    state.clipStarted = true; $('playClipBtn').disabled = true; $('playClipBtn').textContent = '♪ Играет…'; $('roundStatus').textContent = 'Слушай внимательно'; $('soundWave').classList.add('playing');
    const vinyl = $('vinylSvg'); if(vinyl) vinyl.style.animation = 'spin 2s linear infinite';
    
    if(audio.src) {
      audio.currentTime = 0;
      audio.play().catch((e) => {
          clearTimer(); state.clipStarted = false;
          if (isMultiplayer) { toast('Сбой трека. Угадывай наугад!'); $('playClipBtn').textContent = 'Сбой аудио'; $('roundStatus').textContent = 'Выбирай вариант'; } 
          else { 
            // Одиночная игра: тихая замена сломанного трека
            toast('Сбой аудио — заменяем трек');
            state.round--; state.queue.splice(state.round, 1); state.queue.push(state.catalog[Math.floor(Math.random() * state.catalog.length)]);
            nextRound(); setTimeout(playClip, 100);
          }
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
    
    // Синхронизация счета
    if (isMultiplayer && mpRoomRef) { mpRoomRef.child('players/' + myPlayerId + '/score').set(state.score); }
    setTimeout(()=>nextRound(),correct?900:1300)
  }

  function useHint(){if(state.answered||state.hintUsed)return;showRewardedAd(()=>{state.hintUsed=true;const buttons=[...document.querySelectorAll('.answer-btn')];buttons.forEach((btn,i)=>{if(state.options[i].artistName!==state.current.artistName){btn.disabled=true;btn.style.opacity='.35'}});$('hintBtn').disabled=true;toast(`Подсказка: исполнитель — ${state.current.artistName}`)})}
  
  function finishGame(){
    clearTimer();
    if (!isMultiplayer) {
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
      
      if(mpRoomRef) {
        mpRoomRef.child('players').once('value', snap => {
           let players = []; snap.forEach(p => { players.push(p.val()); });
           players.sort((a,b) => b.score - a.score);
           let rankHtml = players.map((p, i) => `<div style="font-size:18px; margin:10px 0;">#${i+1} <b>${escapeHtml(p.name)}</b>: ${p.score}</div>`).join('');
           $('resultCopy').innerHTML = rankHtml;
        });
      }
      setTimeout(() => { leaveLobby(); }, 8000);
    }
  }

  $('playClipBtn').addEventListener('click',playClip);
  $('againBtn').addEventListener('click', () => { if (isMultiplayer) setScreen('home'); else startGameSolo(); });$('homeBtn').addEventListener('click',()=>setScreen('home'));
  
  $('helpBtn').addEventListener('click',()=>{$('modalTitle').textContent='Как играть'; 
    $('modalText').textContent='За раунд нужно угадать 10 песен. Правильные ответы увеличивают стрик. Ошибка отнимает жизнь.'; 
    $('modalActions').innerHTML='<button id="modalOk" class="primary-btn">Понятно</button>'; 
    $('modal').classList.add('open'); 
    $('modalOk').onclick=()=>$('modal').classList.remove('open'); 
  });
  
  $('modalClose').addEventListener('click', ()=>{$('modal').classList.remove('open');});$('volumeSlider').addEventListener('input', (e) => { 
    const v = parseFloat(e.target.value); 
    audio.volume = v; 
    if (v > 0) lastVolume = v; 
    $('soundToggle').textContent = v === 0 ? '🔇' : (v < 0.5 ? '🔉' : '🔊'); 
  });
  
  $('soundToggle').textContent = '🔊';
  $('soundToggle').addEventListener('click', () => { 
    if (audio.volume > 0) { 
      audio.volume = 0; $('volumeSlider').value = 0; $('soundToggle').textContent = '🔇'; 
    } else { 
      audio.volume = lastVolume || 1; $('volumeSlider').value = lastVolume || 1; $('soundToggle').textContent = lastVolume < 0.5 ? '🔉' : '🔊'; 
    } 
  });
  
  $('quitGameBtn').addEventListener('click', askQuit);
  
  updateHomeStats();
  initYandex();
})();