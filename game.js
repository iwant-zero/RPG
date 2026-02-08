(() => {
  "use strict";

  // ----------------- Helpers -----------------
  const $ = (id) => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const nowISO = () => new Date().toISOString();

  // ----------------- Storage -----------------
  const SAVE_KEY = "action_canvas_rpg_v2_stage_auto_sprite";

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function saveGame(state) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  // ----------------- Data -----------------
  const WORLD = { w: 2400, h: 1400 };

  const ITEM_SLOTS = ["weapon", "armor", "ring"];
  const ITEM_NAMES = {
    weapon: ["녹슨 검","철검","흑철검","마나 블레이드","폭풍창","처형자의 대검"],
    armor:  ["가죽 갑옷","사슬 갑옷","강철 갑옷","룬 코트","수호의 판금","용린 갑주"],
    ring:   ["동 반지","은 반지","마력 반지","집중의 반지","파괴의 반지","왕의 반지"]
  };

  const RARITY = [
    { key:"N",   name:"일반", w:60, mult:1.00 },
    { key:"R",   name:"희귀", w:28, mult:1.18 },
    { key:"SR",  name:"영웅", w:10, mult:1.40 },
    { key:"SSR", name:"전설", w: 2, mult:1.85 }
  ];

  const ENEMY_NAME = {
    normal: ["슬라임","늑대","고블린","스켈레톤"],
    elite:  ["광폭 늑대","고블린 주술사","해골 기사","저주받은 갑옷"],
    boss:   ["슬라임 킹","폐허의 리치","철갑 와이번","심연의 기사단장"]
  };

  // 스테이지 규칙:
  // - 챕터는 1-1 ~ 1-10, 2-1 ~ 2-10 식으로 표시(10스테이지마다 챕터 증가)
  // - 매 5스테이지(…-5, …-10) 클리어 문은 "보스 문" 생성 → 보스 처치 시 다음 스테이지로 진행
  // - 일반 스테이지: 처치 목표 달성 시 "다음 문" 생성
  function stageLabel(stageIndex) {
    const chapter = Math.floor((stageIndex - 1) / 10) + 1;
    const step = ((stageIndex - 1) % 10) + 1;
    return `${chapter}-${step}`;
  }
  function isBossStage(stageIndex) {
    const step = ((stageIndex - 1) % 10) + 1;
    return (step === 5 || step === 10);
  }

  // ----------------- Sprites (PNG optional) -----------------
  // assets 폴더에 PNG 있으면 자동 사용, 없으면 도형으로 fallback
  const SPR = {
    player: new Image(),
    enemy_normal: new Image(),
    enemy_elite: new Image(),
    enemy_boss: new Image(),
    coin: new Image(),
    item: new Image(),
    portal: new Image(),
    ok: {
      player:false, enemy_normal:false, enemy_elite:false, enemy_boss:false, coin:false, item:false, portal:false
    }
  };

  function loadSprite(img, key, src) {
    img.onload = () => { SPR.ok[key] = true; };
    img.onerror = () => { SPR.ok[key] = false; };
    img.src = src;
  }

  function initSprites() {
    loadSprite(SPR.player, "player", "./assets/player.png");
    loadSprite(SPR.enemy_normal, "enemy_normal", "./assets/enemy_normal.png");
    loadSprite(SPR.enemy_elite, "enemy_elite", "./assets/enemy_elite.png");
    loadSprite(SPR.enemy_boss, "enemy_boss", "./assets/enemy_boss.png");
    loadSprite(SPR.coin, "coin", "./assets/coin.png");
    loadSprite(SPR.item, "item", "./assets/item.png");
    loadSprite(SPR.portal, "portal", "./assets/portal.png");
  }

  // ----------------- State -----------------
  function cryptoId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  function rollRarity() {
    const total = RARITY.reduce((s, r) => s + r.w, 0);
    let r = Math.random() * total;
    for (const it of RARITY) {
      r -= it.w;
      if (r <= 0) return it;
    }
    return RARITY[0];
  }

  function makeItem(slot, playerLevel) {
    const rar = rollRarity();
    const baseName = pick(ITEM_NAMES[slot]);
    const ilvl = Math.max(1, playerLevel + rand(-1, 2));
    const enhance = 0;

    let atk=0, def=0, hp=0, crit=0;
    if (slot === "weapon") atk = rand(3, 7);
    if (slot === "armor") { def = rand(2, 5); hp = rand(6, 14); }
    if (slot === "ring")  { crit = rand(1, 4); atk = rand(1, 3); }

    const mult = rar.mult * (1 + (ilvl - 1) * 0.04);
    return {
      id: cryptoId(),
      slot,
      rarity: rar.key,
      rarityName: rar.name,
      name: baseName,
      ilvl,
      enhance,
      stats: {
        atk: Math.round(atk * mult),
        def: Math.round(def * mult),
        hp:  Math.round(hp  * mult),
        crit: Math.round(crit * mult)
      },
      locked: false,
      createdAt: nowISO()
    };
  }

  function itemPower(it) {
    const s = it.stats;
    return (s.atk*2) + (s.def*2) + (s.hp*0.6) + (s.crit*1.5) + (it.enhance*6) + (it.ilvl*2);
  }
  function itemLabel(it) {
    return `[${it.rarity}] +${it.enhance} ${it.name}(Lv${it.ilvl}) PWR ${Math.round(itemPower(it))}`;
  }

  function enhanceCost(it) {
    const base = 35 + it.ilvl * 8;
    const step = (it.enhance + 1);
    return Math.round(base * (1 + step * 0.65));
  }
  function enhanceChance(it) {
    const e = it.enhance;
    if (e < 5) return 0.75;
    if (e < 9) return 0.55;
    if (e < 12) return 0.35;
    return 0.22;
  }
  function applyEnhance(it) {
    const e = it.enhance;
    const bump = 1 + (e * 0.06);
    it.stats.atk = Math.round(it.stats.atk * bump);
    it.stats.def = Math.round(it.stats.def * bump);
    it.stats.hp  = Math.round(it.stats.hp  * bump);
    it.stats.crit= Math.round(it.stats.crit * (1 + e * 0.03));
  }

  function freshState() {
    const st = {
      version: 2,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      paused: false,

      // 스테이지 시스템
      inTown: true,
      stageIndex: 1,        // 1부터
      inBossRoom: false,
      stageKills: 0,
      stageGoal: 8,         // 스테이지 시작 시 계산

      // 포탈(문)
      portal: null,         // { kind:"next"|"boss"|"exit", x,y,r }

      cam: { x: 0, y: 0, shake: 0 },

      auto: {
        enabled: false,
        target: true,
        attack: true,
        pickup: true
      },

      player: {
        name: "용사",
        level: 1,
        exp: 0,
        expToNext: 25,
        gold: 80,
        potions: 3,

        hpMaxBase: 70,
        atkBase: 12,
        defBase: 5,
        critBase: 6,

        hp: 70,
        x: WORLD.w/2, y: WORLD.h/2,
        speed: 170,
        facing: { x: 1, y: 0 },

        invuln: 0,
        dodgeCd: 0,
        atkCd: 0,
        skillCd: 0,
        streak: 0
      },

      equip: { weapon:null, armor:null, ring:null },
      inv: [],
      entities: [],
      drops: [],
      stats: { kills:0, bosses:0, gacha:0, enhanced:0 }
    };

    st.inv.push(makeItem("weapon", 1));
    st.inv.push(makeItem("armor", 1));
    st.inv.push(makeItem("ring", 1));

    return st;
  }

  function calcPlayerDerived(state) {
    const p = state.player;
    const eq = state.equip;
    let hpMax = p.hpMaxBase;
    let atk = p.atkBase;
    let def = p.defBase;
    let crit = p.critBase;

    for (const s of ITEM_SLOTS) {
      const it = eq[s];
      if (!it) continue;
      atk += it.stats.atk || 0;
      def += it.stats.def || 0;
      hpMax += it.stats.hp || 0;
      crit += it.stats.crit || 0;
    }
    crit = clamp(crit, 0, 60);
    return { hpMax, atk, def, crit };
  }

  // ----------------- Canvas / Viewport -----------------
  const canvas = $("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    canvas.width = Math.max(320, Math.floor(rect.width * dpr));
    canvas.height = Math.max(240, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ----------------- Input (PC + Mobile) -----------------
  const keys = new Set();
  let wantAttack=false, wantSkill=false, wantDodge=false, wantPotion=false, wantPickup=false;

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup","arrowdown","arrowleft","arrowright"," ","shift","w","a","s","d","j","k","l","h","e"].includes(k)) {
      e.preventDefault();
    }
    keys.add(k);
    if (k === "j" || k === " ") wantAttack = true;
    if (k === "k") wantSkill = true;
    if (k === "l" || k === "shift") wantDodge = true;
    if (k === "h") wantPotion = true;
    if (k === "e") wantPickup = true;
  }, { passive: false });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
  });

  function bindTap(btnId, onPress) {
    const el = $(btnId);
    const handler = (ev) => { ev.preventDefault(); onPress(); };
    el.addEventListener("pointerdown", handler, { passive:false });
  }

  // Virtual Joystick
  const joy = $("joy");
  const joyStick = $("joyStick");
  const joyState = {
    active: false,
    pid: null,
    cx: 0, cy: 0,
    x: 0, y: 0
  };

  function joySetStick(dx, dy) {
    const maxR = 52;
    const len = Math.hypot(dx, dy);
    const s = (len > maxR) ? (maxR / len) : 1;
    const sx = dx * s;
    const sy = dy * s;
    joyStick.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
    joyState.x = clamp(sx / maxR, -1, 1);
    joyState.y = clamp(sy / maxR, -1, 1);
  }
  function joyReset() {
    joyState.active = false;
    joyState.pid = null;
    joyState.x = 0; joyState.y = 0;
    joyStick.style.transform = `translate(-50%, -50%)`;
  }

  joy.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    joy.setPointerCapture(e.pointerId);
    joyState.active = true;
    joyState.pid = e.pointerId;
    const r = joy.getBoundingClientRect();
    joyState.cx = r.left + r.width / 2;
    joyState.cy = r.top + r.height / 2;
    joySetStick(e.clientX - joyState.cx, e.clientY - joyState.cy);
  }, { passive:false });

  joy.addEventListener("pointermove", (e) => {
    if (!joyState.active || e.pointerId !== joyState.pid) return;
    e.preventDefault();
    joySetStick(e.clientX - joyState.cx, e.clientY - joyState.cy);
  }, { passive:false });

  joy.addEventListener("pointerup", (e) => {
    if (e.pointerId !== joyState.pid) return;
    e.preventDefault();
    joyReset();
  }, { passive:false });

  joy.addEventListener("pointercancel", joyReset, { passive:true });

  // ----------------- UI / Log -----------------
  const logEl = $("log");
  function log(text, cls="") {
    const line = document.createElement("div");
    line.className = "line" + (cls ? ` ${cls}` : "");
    line.textContent = text;
    logEl.prepend(line);
    while (logEl.children.length > 120) logEl.removeChild(logEl.lastChild);
  }

  function escapeHtml(s){
    return String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  // ----------------- Stage / Spawns -----------------
  function computeStageGoal(state) {
    const s = state.stageIndex;
    const diff = Math.floor((s-1)/2); // 완만 증가
    return clamp(8 + diff, 8, 22);
  }

  function stageDifficulty(state) {
    const s = state.stageIndex;
    const diff = Math.floor((s-1)/2);
    return diff;
  }

  function spawnStage(state) {
    state.entities.length = 0;
    state.drops.length = 0;
    state.portal = null;

    state.stageKills = 0;
    state.stageGoal = computeStageGoal(state);

    const p = state.player;
    p.x = WORLD.w/2;
    p.y = WORLD.h/2;

    if (state.inTown) return;

    if (state.inBossRoom) {
      // 보스 1마리
      const e = makeEnemy(state, "boss");
      state.entities.push(e);
      log(`보스 방 진입! (${stageLabel(state.stageIndex)})`, "dim");
      return;
    }

    // 일반 스테이지: normal / elite 혼합
    const diff = stageDifficulty(state);
    const baseCount = clamp(6 + Math.floor(diff*0.6), 6, 14);
    for (let i=0;i<baseCount;i++){
      const tier = (Math.random() < 0.18) ? "elite" : "normal";
      state.entities.push(makeEnemy(state, tier));
    }
    log(`스테이지 시작: ${stageLabel(state.stageIndex)}  (목표 ${state.stageGoal}처치)`, "dim");
  }

  function makeEnemy(state, tier) {
    const p = state.player;
    const diff = stageDifficulty(state);
    const lv = Math.max(1, p.level + Math.floor(diff/2) + rand(-1, 2));
    const mult = (tier==="boss") ? 2.6 : (tier==="elite" ? 1.35 : 1.0);

    const name = pick(ENEMY_NAME[tier]);
    const r = (tier==="boss") ? 36 : 22;

    const e = {
      id: cryptoId(),
      type: "enemy",
      tier,
      name,
      level: lv,
      x: rand(180, WORLD.w-180),
      y: rand(180, WORLD.h-180),
      r,
      hpMax: Math.round((45 + lv*18 + diff*18) * mult),
      hp: 0,
      atk: Math.round((8 + lv*4 + diff*4) * mult),
      def: Math.round((2 + lv*2 + diff*2) * mult),
      speed: (tier==="boss") ? 85 : 105,
      hitCd: 0,
      enraged: false
    };
    e.hp = e.hpMax;
    return e;
  }

  function maybeSpawnPortal(state) {
    if (state.portal) return;
    if (state.inTown) return;

    // 보스방이면 보스 처치 후 exit portal
    if (state.inBossRoom) {
      const alive = state.entities.some(e => e.hp > 0);
      if (!alive) {
        state.portal = makePortal("exit");
        log("보스 처치! 출구 문이 열렸다.", "dim");
      }
      return;
    }

    // 일반 스테이지: 목표 처치 달성 시 portal 생성
    if (state.stageKills >= state.stageGoal) {
      // 다음이 보스 스테이지면 "보스 문" 생성
      const nextStage = state.stageIndex;
      const bossNext = isBossStage(nextStage);
      state.portal = makePortal(bossNext ? "boss" : "next");
      log(bossNext ? "보스 문이 나타났다!" : "다음 문이 나타났다!", "dim");
    }
  }

  function makePortal(kind) {
    return {
      kind, // "next" | "boss" | "exit"
      x: rand(220, WORLD.w-220),
      y: rand(220, WORLD.h-220),
      r: 34
    };
  }

  function enterPortal(state) {
    if (!state.portal) return;

    const kind = state.portal.kind;

    if (kind === "boss") {
      state.inBossRoom = true;
      spawnStage(state);
      return;
    }

    if (kind === "exit") {
      // 보스 클리어 → 다음 스테이지로 진행
      state.inBossRoom = false;
      state.stageIndex += 1;
      spawnStage(state);
      return;
    }

    // next
    state.stageIndex += 1;
    spawnStage(state);
  }

  // ----------------- Drops / Loot -----------------
  function dropCoin(state, x, y, amount) {
    state.drops.push({ id: cryptoId(), kind:"coin", x, y, r: 10, amount });
  }

  function dropEquip(state, x, y) {
    const slot = pick(ITEM_SLOTS);
    const it = makeItem(slot, state.player.level);
    state.drops.push({ id: cryptoId(), kind:"equip", x, y, r: 12, item: it });
    log(`드랍: ${itemLabel(it)}`, "dim");
  }

  // ----------------- Combat -----------------
  function dealDamage(baseAtk, def, base, critChance) {
    let dmg = base;
    const isCrit = (Math.random()*100) < critChance;
    if (isCrit) dmg = Math.round(dmg * 1.65);
    dmg = Math.max(1, dmg - def);
    return { dmg, isCrit };
  }

  function playerAttack(state, mode) {
    const p = state.player;
    if (p.atkCd > 0) return;
    if (state.inTown) return;

    const der = calcPlayerDerived(state);
    const range = (mode === "skill") ? 125 : 72;
    const arc = (mode === "skill") ? Math.PI * 0.92 : Math.PI * 0.60;
    const base = (mode === "skill") ? Math.round(der.atk * 1.95) : Math.round(der.atk * 1.08);

    if (mode === "skill") {
      if (p.skillCd > 0) return;
      p.skillCd = 3.2;
      p.atkCd = 0.28;
      cameraShake(state, 7);
      log("스킬 발동!", "dim");
    } else {
      p.atkCd = 0.22;
    }

    const fx = p.facing.x, fy = p.facing.y;
    let hitAny = false;

    for (const e of state.entities) {
      if (e.hp <= 0) continue;

      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > range + e.r) continue;

      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);
      const dot = clamp(nx*fx + ny*fy, -1, 1);
      const ang = Math.acos(dot);
      if (ang > arc/2) continue;

      const { dmg, isCrit } = dealDamage(der.atk, e.def, base + rand(-2, 3), der.crit);
      e.hp = clamp(e.hp - dmg, 0, e.hpMax);
      e.hitCd = 0.08;
      hitAny = true;

      if (mode === "skill") {
        const k = 0.95;
        e.x += nx * (40 * k);
        e.y += ny * (40 * k);
      }
      if (isCrit) cameraShake(state, 4);

      if (e.hp <= 0) onEnemyDead(state, e);
    }

    return hitAny;
  }

  function onEnemyDead(state, e) {
    const p = state.player;
    state.stats.kills += 1;
    if (e.tier === "boss") state.stats.bosses += 1;

    p.streak += 1;
    state.stageKills += 1;

    // rewards
    const diff = stageDifficulty(state);
    const baseGold = 18 + e.level*6 + (e.tier==="elite" ? 32 : 0) + (e.tier==="boss" ? 220 : 0) + diff*6;
    const gold = Math.round(baseGold * (1 + Math.min(p.streak, 10) * 0.03));
    dropCoin(state, e.x, e.y, gold);

    const dropChance = (e.tier==="boss") ? 0.90 : (e.tier==="elite" ? 0.48 : 0.23);
    if (Math.random() < dropChance) dropEquip(state, e.x + rand(-10,10), e.y + rand(-10,10));

    const exp = Math.round(10 + e.level*5 + (e.tier==="elite" ? 18 : 0) + (e.tier==="boss" ? 90 : 0) + diff*3);
    gainExp(state, exp);

    // 스테이지 문 생성 체크
    maybeSpawnPortal(state);
  }

  function gainExp(state, amount) {
    const p = state.player;
    p.exp += amount;
    while (p.exp >= p.expToNext) {
      p.exp -= p.expToNext;
      levelUp(state);
    }
  }

  function levelUp(state) {
    const p = state.player;
    p.level += 1;
    p.expToNext = Math.round(25 + p.level*18 + Math.pow(p.level, 1.15)*2);

    p.hpMaxBase += 10 + rand(0, 4);
    p.atkBase += 2 + rand(0, 2);
    p.defBase += 1 + (p.level % 2 === 0 ? 1 : 0);
    p.critBase += (p.level % 3 === 0 ? 1 : 0);

    const der = calcPlayerDerived(state);
    p.hp = der.hpMax;
    cameraShake(state, 10);
    log(`레벨업! Lv.${p.level}`, "dim");
  }

  function playerUsePotion(state) {
    const p = state.player;
    const der = calcPlayerDerived(state);
    if (p.potions <= 0) { log("포션이 없다.", "dim"); return; }
    if (p.hp >= der.hpMax) { return; }

    p.potions -= 1;
    const amount = Math.round(der.hpMax * 0.45) + rand(6, 12);
    p.hp = clamp(p.hp + amount, 1, der.hpMax);
    log(`포션 사용: +${amount}HP (남은 포션 ${p.potions})`, "dim");
  }

  function playerDodge(state) {
    const p = state.player;
    if (p.dodgeCd > 0) return;
    p.dodgeCd = 1.2;
    p.invuln = 0.35;

    const ix = currentMoveX(), iy = currentMoveY();
    const dx = (Math.hypot(ix,iy) > 0.01) ? ix : p.facing.x;
    const dy = (Math.hypot(ix,iy) > 0.01) ? iy : p.facing.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx/len, ny = dy/len;

    p.x += nx * 100;
    p.y += ny * 100;
    p.x = clamp(p.x, 40, WORLD.w-40);
    p.y = clamp(p.y, 40, WORLD.h-40);
    cameraShake(state, 4);
  }

  function enemyAI(state, dt) {
    const p = state.player;
    if (state.inTown) return;

    const der = calcPlayerDerived(state);

    for (const e of state.entities) {
      if (e.hp <= 0) continue;

      if (!e.enraged && (e.tier!=="normal") && (e.hp / e.hpMax <= 0.35)) {
        e.enraged = true;
        log(`${e.name}가 분노했다!`, "dim");
      }

      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;

      const sp = e.speed * (e.enraged ? 1.18 : 1.0);
      const nx = dx / dist;
      const ny = dy / dist;

      if (dist > (e.r + 36)) {
        e.x += nx * sp * dt;
        e.y += ny * sp * dt;
      } else {
        e.x -= nx * (sp * 0.35) * dt;
        e.y -= ny * (sp * 0.35) * dt;
      }

      e.x = clamp(e.x, 40, WORLD.w-40);
      e.y = clamp(e.y, 40, WORLD.h-40);

      if (e.hitCd > 0) e.hitCd -= dt;

      if (dist < (e.r + 36) && e.hitCd <= 0) {
        e.hitCd = e.tier==="boss" ? 0.75 : (e.tier==="elite" ? 0.9 : 1.0);
        if (p.invuln > 0) continue;

        const base = Math.round(e.atk * (e.enraged ? 1.22 : 1.0)) + rand(-1, 2);
        const taken = Math.max(1, base - der.def);
        p.hp = clamp(p.hp - taken, 0, der.hpMax);
        cameraShake(state, 5);

        if (p.hp <= 0) {
          onPlayerDown(state);
          return;
        }
      }
    }
  }

  function onPlayerDown(state) {
    const p = state.player;
    const lost = Math.round(p.gold * 0.08);
    p.gold = Math.max(0, p.gold - lost);
    p.hp = 1;
    p.streak = 0;
    log(`쓰러졌다… ${lost}G를 잃고 마을로 후퇴.`, "dim");
    goTown(state);
  }

  // ----------------- Pickup / Drops -----------------
  function pickupNearby(state) {
    const p = state.player;
    let picked = 0;

    for (let i = state.drops.length - 1; i >= 0; i--) {
      const d = state.drops[i];
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist > (d.r + 36)) continue;

      if (d.kind === "coin") {
        p.gold += d.amount;
        picked++;
        state.drops.splice(i, 1);
      } else if (d.kind === "equip") {
        state.inv.push(d.item);
        picked++;
        state.drops.splice(i, 1);
      }
    }

    if (picked > 0) log(`줍기: ${picked}개`, "dim");
  }

  function checkPortalCollision(state) {
    if (!state.portal) return;
    const p = state.player;
    const d = Math.hypot(state.portal.x - p.x, state.portal.y - p.y);
    if (d <= (state.portal.r + 22)) {
      log("문 진입!", "dim");
      enterPortal(state);
    }
  }

  // ----------------- Auto Hunt (Target/Attack/Pickup) -----------------
  function nearestEnemy(state, maxDist=900) {
    const p = state.player;
    let best = null;
    let bestD = maxDist;

    for (const e of state.entities) {
      if (e.hp <= 0) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  function autoLogic(state) {
    const a = state.auto;
    if (!a.enabled) return;
    if (state.inTown) return;

    // 오토 줍기
    if (a.pickup) pickupNearby(state);

    // 오토 타겟 + 오토 공격
    const target = a.target ? nearestEnemy(state, 700) : null;
    if (!target) return;

    const p = state.player;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy) || 1;

    // 타겟 바라보기
    p.facing.x = dx / dist;
    p.facing.y = dy / dist;

    // 스킬 조건: 보스/엘리트면 쿨되면 우선
    if (a.attack) {
      if (p.skillCd <= 0 && (target.tier === "boss" || target.tier === "elite")) {
        wantSkill = true;
        return;
      }

      // 일반 공격: 거리 가까우면
      if (dist <= (80 + target.r) && p.atkCd <= 0) {
        wantAttack = true;
      }
    }
  }

  // ----------------- Inventory / Shop -----------------
  function autoEquip(state) {
    for (const slot of ITEM_SLOTS) {
      const candidates = state.inv.filter(it => it.slot === slot);
      const equipped = state.equip[slot];
      if (equipped) candidates.push(equipped);
      if (candidates.length === 0) continue;

      candidates.sort((a,b) => itemPower(b) - itemPower(a));
      const best = candidates[0];
      if (equipped && best.id === equipped.id) continue;

      if (equipped) state.inv.push(equipped);
      state.inv = state.inv.filter(it => it.id !== best.id);
      state.equip[slot] = best;
      log(`장착: ${slot.toUpperCase()} → ${itemLabel(best)}`, "dim");
    }

    const der = calcPlayerDerived(state);
    state.player.hp = clamp(state.player.hp, 1, der.hpMax);
  }

  function sellJunk(state) {
    const inv = state.inv.slice();
    const sellable = inv.filter(it => !it.locked);
    if (sellable.length === 0) { log("판매할 아이템이 없다.", "dim"); return; }

    sellable.sort((a,b) => itemPower(a) - itemPower(b));
    const count = Math.max(1, Math.floor(sellable.length * 0.4));
    const toSell = sellable.slice(0, count);

    let gain = 0;
    for (const it of toSell) {
      gain += Math.max(8, Math.round(itemPower(it) * 0.55));
      state.inv = state.inv.filter(x => x.id !== it.id);
    }
    state.player.gold += gain;
    log(`잡템 판매: ${toSell.length}개 → +${gain}G`, "dim");
  }

  function toggleLock(state, id) {
    const it = state.inv.find(x => x.id === id);
    if (!it) return;
    it.locked = !it.locked;
  }

  function equipFromInv(state, id) {
    const it = state.inv.find(x => x.id === id);
    if (!it) return;
    const slot = it.slot;
    const eq = state.equip[slot];
    if (eq) state.inv.push(eq);
    state.inv = state.inv.filter(x => x.id !== id);
    state.equip[slot] = it;
    log(`장착: ${slot.toUpperCase()} → ${itemLabel(it)}`, "dim");
    const der = calcPlayerDerived(state);
    state.player.hp = clamp(state.player.hp, 1, der.hpMax);
  }

  function dropItem(state, id) {
    const it = state.inv.find(x => x.id === id);
    if (!it) return;
    if (it.locked) { log("잠금 아이템은 버릴 수 없다.", "dim"); return; }
    state.inv = state.inv.filter(x => x.id !== id);
    log(`버림: ${itemLabel(it)}`, "dim");
  }

  function gacha(state) {
    const p = state.player;
    const cost = 90 + p.level * 6;
    if (p.gold < cost) { log(`골드 부족. (뽑기 ${cost}G)`, "dim"); return; }
    p.gold -= cost;
    const slot = pick(ITEM_SLOTS);
    const it = makeItem(slot, p.level + 1);
    state.inv.push(it);
    state.stats.gacha += 1;
    log(`뽑기: ${itemLabel(it)} (-${cost}G)`, "dim");
  }

  function enhance(state) {
    const eqItems = ITEM_SLOTS.map(s => state.equip[s]).filter(Boolean);
    if (eqItems.length === 0) { log("강화할 장비가 없다. 먼저 장착해라.", "dim"); return; }
    eqItems.sort((a,b) => itemPower(b) - itemPower(a));
    const target = eqItems[0];

    const p = state.player;
    const cost = enhanceCost(target);
    if (p.gold < cost) { log(`골드 부족. (강화 ${cost}G)`, "dim"); return; }
    p.gold -= cost;

    const chance = enhanceChance(target);
    const ok = Math.random() < chance;
    if (ok) {
      target.enhance += 1;
      applyEnhance(target);
      state.stats.enhanced += 1;
      log(`강화 성공! +${target.enhance} (${target.name})`, "dim");
    } else {
      log(`강화 실패… (확률 ${Math.round(chance*100)}%)`, "dim");
    }
  }

  // ----------------- Town / Enter Stage -----------------
  function goTown(state) {
    state.inTown = true;
    state.inBossRoom = false;
    state.portal = null;
    state.entities.length = 0;
    state.drops.length = 0;

    const p = state.player;
    p.x = WORLD.w/2;
    p.y = WORLD.h/2;

    // 마을 회복 느낌(양산형)
    const der = calcPlayerDerived(state);
    p.hp = der.hpMax;
    p.atkCd = 0;
    p.skillCd = 0;
    p.dodgeCd = 0;
  }

  function enterStage(state) {
    state.inTown = false;
    state.inBossRoom = false;
    spawnStage(state);
  }

  // ----------------- Camera / Effects -----------------
  function cameraShake(state, strength) {
    state.cam.shake = Math.max(state.cam.shake, strength);
  }

  // ----------------- Rendering -----------------
  function drawSprite(img, ok, x, y, w, h) {
    if (ok) {
      ctx.drawImage(img, x - w/2, y - h/2, w, h);
      return true;
    }
    return false;
  }

  function draw(state, dt) {
    const p = state.player;
    const der = calcPlayerDerived(state);

    const viewW = canvas.getBoundingClientRect().width;
    const viewH = canvas.getBoundingClientRect().height;

    if (state.cam.shake > 0) state.cam.shake = Math.max(0, state.cam.shake - dt * 18);
    const sx = (Math.random()-0.5) * state.cam.shake;
    const sy = (Math.random()-0.5) * state.cam.shake;

    const camX = clamp(p.x - viewW/2, 0, WORLD.w - viewW) + sx;
    const camY = clamp(p.y - viewH/2, 0, WORLD.h - viewH) + sy;
    state.cam.x = camX; state.cam.y = camY;

    // background by mode
    const bg = state.inTown ? "#0e1628" : (state.inBossRoom ? "#220f16" : "#0d1b17");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, viewW, viewH);

    drawGrid(viewW, viewH, camX, camY);
    drawVignette(viewW, viewH);

    // portal
    if (state.portal) drawPortal(state.portal, camX, camY);

    // drops
    for (const d of state.drops) drawDrop(d, camX, camY);

    // enemies
    for (const e of state.entities) if (e.hp > 0) drawEnemy(e, camX, camY);

    // player
    drawPlayer(p, der, camX, camY);

    // UI on canvas
    drawTopBars(state, der, viewW);

    // portal collision check (문 가까이 가면 자동 진입)
    checkPortalCollision(state);
  }

  function drawGrid(w, h, camX, camY) {
    const step = 80;
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "rgba(36,49,77,0.65)";
    ctx.lineWidth = 1;

    const startX = -((camX % step) + step);
    const startY = -((camY % step) + step);

    ctx.beginPath();
    for (let x = startX; x < w + step; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = startY; y < h + step; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawVignette(w, h) {
    const g = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.35, w/2, h/2, Math.max(w,h)*0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);
  }

  function drawTopBars(state, der, w) {
    const p = state.player;
    const hpPct = clamp(p.hp / der.hpMax, 0, 1);
    const expPct = clamp(p.exp / p.expToNext, 0, 1);

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(12, 12, Math.min(620, w-24), 66);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(22, 26, 300, 14);
    ctx.fillStyle = "rgba(46,229,157,0.85)";
    ctx.fillRect(22, 26, 300*hpPct, 14);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(22, 46, 300, 10);
    ctx.fillStyle = "rgba(91,140,255,0.75)";
    ctx.fillRect(22, 46, 300*expPct, 10);

    ctx.fillStyle = "rgba(233,238,252,0.95)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";

    const stageText = state.inTown ? "마을" : (state.inBossRoom ? `보스방(${stageLabel(state.stageIndex)})` : `스테이지 ${stageLabel(state.stageIndex)}`);
    const goalText = state.inTown ? "" : (state.inBossRoom ? "보스 처치 후 출구" : `처치 ${state.stageKills}/${state.stageGoal}`);

    ctx.fillText(`${stageText} | ${goalText}`, 334, 36);
    ctx.fillText(`Lv.${p.level} HP ${p.hp}/${der.hpMax} EXP ${p.exp}/${p.expToNext}  ${p.gold}G  P${p.potions}  AUTO:${state.auto.enabled?"ON":"OFF"}`, 334, 56);
  }

  function drawPortal(portal, camX, camY) {
    const x = portal.x - camX;
    const y = portal.y - camY;

    // glow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = (portal.kind === "boss") ? "rgba(255,91,110,0.7)" : "rgba(91,140,255,0.7)";
    ctx.beginPath();
    ctx.arc(x, y, portal.r + 18, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const used = drawSprite(SPR.portal, SPR.ok.portal, x, y, portal.r*2.2, portal.r*2.2);
    if (!used) {
      ctx.strokeStyle = (portal.kind === "boss") ? "rgba(255,91,110,0.95)" : "rgba(91,140,255,0.95)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, portal.r, 0, Math.PI*2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    ctx.fillStyle = "rgba(233,238,252,0.92)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";
    const label = portal.kind === "boss" ? "BOSS" : (portal.kind === "exit" ? "EXIT" : "NEXT");
    ctx.fillText(label, x-18, y-portal.r-10);
  }

  function drawPlayer(p, der, camX, camY) {
    const x = p.x - camX;
    const y = p.y - camY;

    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y+18, 18, 8, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const blink = (p.invuln > 0) ? (Math.sin(Date.now()/60) > 0 ? 0.45 : 1) : 1;
    ctx.globalAlpha = blink;

    const used = drawSprite(SPR.player, SPR.ok.player, x, y, 44, 44);
    if (!used) {
      ctx.fillStyle = "rgba(91,140,255,0.95)";
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI*2);
      ctx.fill();
    }

    // facing indicator
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(233,238,252,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + p.facing.x*22, y + p.facing.y*22);
    ctx.stroke();
  }

  function drawEnemy(e, camX, camY) {
    const x = e.x - camX;
    const y = e.y - camY;

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y+16, e.r*0.9, e.r*0.35, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (e.hitCd > 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(x, y, e.r+6, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    let used = false;
    if (e.tier === "boss") used = drawSprite(SPR.enemy_boss, SPR.ok.enemy_boss, x, y, 72, 72);
    else if (e.tier === "elite") used = drawSprite(SPR.enemy_elite, SPR.ok.enemy_elite, x, y, 52, 52);
    else used = drawSprite(SPR.enemy_normal, SPR.ok.enemy_normal, x, y, 44, 44);

    if (!used) {
      let col = "rgba(255,91,110,0.90)";
      if (e.tier === "elite") col = "rgba(255,207,91,0.90)";
      if (e.tier === "boss") col = "rgba(255,91,110,0.95)";
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, e.r, 0, Math.PI*2);
      ctx.fill();
    }

    const pct = clamp(e.hp / e.hpMax, 0, 1);
    const bw = e.r*2.2;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x - bw/2, y - e.r - 16, bw, 8);
    ctx.fillStyle = "rgba(46,229,157,0.85)";
    ctx.fillRect(x - bw/2, y - e.r - 16, bw*pct, 8);

    ctx.fillStyle = "rgba(233,238,252,0.85)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";
    ctx.fillText(`${e.name} Lv.${e.level}${e.enraged ? "!" : ""}`, x - bw/2, y - e.r - 22);
  }

  function drawDrop(d, camX, camY) {
    const x = d.x - camX;
    const y = d.y - camY;

    if (d.kind === "coin") {
      const used = drawSprite(SPR.coin, SPR.ok.coin, x, y, 26, 26);
      if (!used) {
        ctx.fillStyle = "rgba(255,207,91,0.92)";
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, Math.PI*2);
        ctx.fill();
      }
    } else {
      const used = drawSprite(SPR.item, SPR.ok.item, x, y, 26, 26);
      if (!used) {
        ctx.fillStyle = "rgba(91,140,255,0.92)";
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, Math.PI*2);
        ctx.fill();
      }
    }
  }

  // ----------------- Movement / Update -----------------
  function currentMoveX() {
    let x = 0;
    if (keys.has("a") || keys.has("arrowleft")) x -= 1;
    if (keys.has("d") || keys.has("arrowright")) x += 1;
    if (Math.abs(joyState.x) > 0.05) x += joyState.x;
    return clamp(x, -1, 1);
  }
  function currentMoveY() {
    let y = 0;
    if (keys.has("w") || keys.has("arrowup")) y -= 1;
    if (keys.has("s") || keys.has("arrowdown")) y += 1;
    if (Math.abs(joyState.y) > 0.05) y += joyState.y;
    return clamp(y, -1, 1);
  }

  function isTouchDevice() {
    return matchMedia("(max-width: 980px)").matches;
  }

  function update(state, dt) {
    if (state.paused) return;

    const p = state.player;
    const der = calcPlayerDerived(state);

    p.invuln = Math.max(0, p.invuln - dt);
    p.dodgeCd = Math.max(0, p.dodgeCd - dt);
    p.atkCd = Math.max(0, p.atkCd - dt);
    p.skillCd = Math.max(0, p.skillCd - dt);

    // Auto logic first (sets facing / wants)
    autoLogic(state);

    // movement
    const mx = currentMoveX();
    const my = currentMoveY();
    const len = Math.hypot(mx, my);

    if (len > 0.01) {
      const nx = mx / len;
      const ny = my / len;
      p.facing.x = nx;
      p.facing.y = ny;

      const sp = p.speed * (p.invuln > 0 ? 1.15 : 1.0);
      p.x += nx * sp * dt;
      p.y += ny * sp * dt;
    }

    p.x = clamp(p.x, 40, WORLD.w-40);
    p.y = clamp(p.y, 40, WORLD.h-40);

    // actions
    if (wantAttack) { playerAttack(state, "attack"); wantAttack = false; }
    if (wantSkill)  { playerAttack(state, "skill");  wantSkill = false; }
    if (wantDodge)  { playerDodge(state);           wantDodge = false; }
    if (wantPotion) { playerUsePotion(state);       wantPotion = false; }
    if (wantPickup) { pickupNearby(state);          wantPickup = false; }

    // 모바일 편의: 자동 줍기(오토가 꺼져도 모바일은 편하게)
    if (isTouchDevice() && !state.auto.enabled) pickupNearby(state);

    // enemy ai
    enemyAI(state, dt);

    // portal spawn check
    maybeSpawnPortal(state);

    // clamp hp
    p.hp = clamp(p.hp, 0, der.hpMax);

    // enemy hitCd decay
    for (const e of state.entities) {
      if (e.hitCd > 0) e.hitCd -= dt;
    }
  }

  // ----------------- Sidebar Render -----------------
  function renderSidebar(state) {
    const p = state.player;
    const der = calcPlayerDerived(state);

    const stageText = state.inTown ? "마을" : (state.inBossRoom ? `보스방(${stageLabel(state.stageIndex)})` : `스테이지 ${stageLabel(state.stageIndex)}`);
    const goalText = state.inTown ? "" : (state.inBossRoom ? "보스 처치 → 출구" : `처치 ${state.stageKills}/${state.stageGoal}`);

    const autoText = `AUTO: ${state.auto.enabled ? "ON" : "OFF"} (타겟/공격/줍기)`;

    $("hud").textContent = `
${stageText}
${goalText}
${autoText}
레벨: ${p.level}  EXP: ${p.exp}/${p.expToNext}
HP: ${p.hp}/${der.hpMax}  포션: ${p.potions}
골드: ${p.gold}G  연속처치: ${p.streak}
ATK: ${der.atk}  DEF: ${der.def}  CRIT: ${der.crit}%
쿨: 공격 ${p.atkCd.toFixed(1)}s / 스킬 ${p.skillCd.toFixed(1)}s / 회피 ${p.dodgeCd.toFixed(1)}s
`.trim();

    const eqLines = ITEM_SLOTS.map(slot => {
      const it = state.equip[slot];
      return it ? `${slot.toUpperCase()}: ${itemLabel(it)}` : `${slot.toUpperCase()}: (없음)`;
    }).join("\n");
    $("equip").textContent = eqLines;

    const inv = state.inv.slice().sort((a,b) => itemPower(b) - itemPower(a));
    const invEl = $("inv");
    invEl.innerHTML = "";
    if (inv.length === 0) {
      invEl.innerHTML = `<div class="small">인벤이 비어있다.</div>`;
    } else {
      for (const it of inv) {
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
          <div>
            <div class="name">${it.locked ? "🔒 " : ""}${escapeHtml(itemLabel(it))}</div>
            <div class="meta">slot=${it.slot} | atk=${it.stats.atk} def=${it.stats.def} hp=${it.stats.hp} crit=${it.stats.crit}</div>
          </div>
          <div class="actions">
            <button class="btn" data-act="equip" data-id="${it.id}">장착</button>
            <button class="btn ghost" data-act="lock" data-id="${it.id}">${it.locked ? "잠금해제" : "잠금"}</button>
            <button class="btn danger" data-act="drop" data-id="${it.id}">버림</button>
          </div>
        `;
        invEl.appendChild(row);
      }
    }
  }

  // ----------------- Autosave -----------------
  let saveTimer = null;
  function autosave(state) {
    state.updatedAt = nowISO();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveGame(state), 180);
  }

  // ----------------- Wiring -----------------
  function bindUI(state) {
    $("btnPause").addEventListener("click", () => {
      state.paused = !state.paused;
      log(state.paused ? "일시정지." : "재개.", "dim");
    });

    $("btnSave").addEventListener("click", () => {
      saveGame(state);
      log("저장 완료.", "dim");
    });

    $("btnReset").addEventListener("click", () => {
      if (!confirm("정말 리셋할까?")) return;
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    });

    // Auto toggle
    const autoBtn = $("btnAuto");
    function refreshAutoBtn(){
      autoBtn.textContent = `자동사냥: ${state.auto.enabled ? "ON" : "OFF"}`;
      autoBtn.classList.toggle("primary", !state.auto.enabled ? true : true); // 그대로 유지
    }
    autoBtn.addEventListener("click", () => {
      state.auto.enabled = !state.auto.enabled;
      log(`자동사냥 ${state.auto.enabled ? "ON" : "OFF"}`, "dim");
      refreshAutoBtn();
      renderSidebar(state);
      autosave(state);
    });
    refreshAutoBtn();

    // Town / Stage enter
    $("btnTown").addEventListener("click", () => {
      goTown(state);
      renderSidebar(state);
      autosave(state);
      log("마을로 이동.", "dim");
    });

    $("btnEnterStage").addEventListener("click", () => {
      enterStage(state);
      renderSidebar(state);
      autosave(state);
    });

    $("btnPortalHint").addEventListener("click", () => {
      if (!state.portal) { log("아직 문이 없다. 목표 처치를 채워라.", "dim"); return; }
      log(`문 위치 힌트: (${Math.round(state.portal.x)}, ${Math.round(state.portal.y)})`, "dim");
    });

    // inventory delegate
    $("inv").addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const act = t.getAttribute("data-act");
      const id = t.getAttribute("data-id");
      if (!act || !id) return;

      if (act === "equip") equipFromInv(state, id);
      if (act === "lock") toggleLock(state, id);
      if (act === "drop") dropItem(state, id);

      renderSidebar(state);
      autosave(state);
    });

    // equip / shop
    $("btnAutoEquip").addEventListener("click", () => {
      autoEquip(state);
      renderSidebar(state);
      autosave(state);
    });

    $("btnSell").addEventListener("click", () => {
      sellJunk(state);
      renderSidebar(state);
      autosave(state);
    });

    $("btnGacha").addEventListener("click", () => {
      gacha(state);
      renderSidebar(state);
      autosave(state);
    });

    $("btnEnhance").addEventListener("click", () => {
      enhance(state);
      renderSidebar(state);
      autosave(state);
    });

    // mobile buttons
    bindTap("btnAtk", () => wantAttack = true);
    bindTap("btnSkill", () => wantSkill = true);
    bindTap("btnDodge", () => wantDodge = true);
    bindTap("btnPotion", () => wantPotion = true);
    bindTap("btnPickup", () => wantPickup = true);
  }

  // ----------------- Boot / Loop -----------------
  function init() {
    initSprites();

    let state = loadSave();
    if (!state || (state.version !== 2)) state = freshState();

    // 안전 필드 보정(구버전 세이브 대비)
    state.entities ??= [];
    state.drops ??= [];
    state.inv ??= [];
    state.equip ??= { weapon:null, armor:null, ring:null };
    state.auto ??= { enabled:false, target:true, attack:true, pickup:true };

    resizeCanvas();
    window.addEventListener("resize", () => resizeCanvas(), { passive:true });

    bindUI(state);
    renderSidebar(state);
    log("접속 완료. (자동 저장 ON)", "dim");

    let last = performance.now();
    function frame(t) {
      const dt = Math.min(0.033, (t - last) / 1000);
      last = t;

      update(state, dt);
      draw(state, dt);

      // autosave + sidebar refresh
      if (!state.paused) {
        if (Math.random() < 0.06) renderSidebar(state);
        if (Math.random() < 0.08) autosave(state);
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    setInterval(() => autosave(state), 6000);
  }

  init();
})();
