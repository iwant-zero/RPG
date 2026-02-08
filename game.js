(() => {
  "use strict";

  // ----------------- Helpers -----------------
  const $ = (id) => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const nowISO = () => new Date().toISOString();
  const todayKey = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${dd}`;
  };

  // ----------------- Storage -----------------
  const SAVE_KEY = "action_canvas_rpg_v3_auto_stage_chest_daily_ach_set_appraise";

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

  // ----------------- World -----------------
  const WORLD = { w: 2400, h: 1400 };

  // ----------------- Sprites (PNG optional) -----------------
  const SPR = {
    player: new Image(),
    enemy_normal: new Image(),
    enemy_elite: new Image(),
    enemy_boss: new Image(),
    coin: new Image(),
    item: new Image(),
    portal: new Image(),
    ok: { player:false, enemy_normal:false, enemy_elite:false, enemy_boss:false, coin:false, item:false, portal:false }
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

  // ----------------- Game Data -----------------
  const ITEM_SLOTS = ["weapon", "armor", "ring"];
  const ITEM_NAMES = {
    weapon: ["녹슨 검","철검","흑철검","마나 블레이드","폭풍창","처형자의 대검"],
    armor:  ["가죽 갑옷","사슬 갑옷","강철 갑옷","룬 코트","수호의 판금","용린 갑주"],
    ring:   ["동 반지","은 반지","마력 반지","집중의 반지","파괴의 반지","왕의 반지"]
  };

  const RARITY = [
    { key:"N",   name:"일반", w:60, mult:1.00, opt:0 },
    { key:"R",   name:"희귀", w:28, mult:1.18, opt:1 },
    { key:"SR",  name:"영웅", w:10, mult:1.40, opt:2 },
    { key:"SSR", name:"전설", w: 2, mult:1.85, opt:2 }
  ];

  const ENEMY_NAME = {
    normal: ["슬라임","늑대","고블린","스켈레톤"],
    elite:  ["광폭 늑대","고블린 주술사","해골 기사","저주받은 갑옷"],
    boss:   ["슬라임 킹","폐허의 리치","철갑 와이번","심연의 기사단장"]
  };

  // 세트 효과(2/3세트)
  const SETS = [
    {
      key: "WOLF", name: "늑대 세트",
      two: { speed: 18, crit: 4 },
      three: { atkPct: 8, lifesteal: 2 }
    },
    {
      key: "BONE", name: "해골 세트",
      two: { defPct: 8, hpPct: 8 },
      three: { atkPct: 6, crit: 6 }
    },
    {
      key: "ABYSS", name: "심연 세트",
      two: { atkPct: 10 },
      three: { atkPct: 10, crit: 8, speed: 12 }
    }
  ];

  // 랜덤 옵션(감정 시 해방)
  // type: "flat" | "pct"
  const AFFIX = [
    { key:"atkFlat", name:"공격력", type:"flat", min:1, max:6, weight:22 },
    { key:"defFlat", name:"방어력", type:"flat", min:1, max:5, weight:22 },
    { key:"hpFlat",  name:"체력",   type:"flat", min:6, max:22, weight:18 },
    { key:"crit",    name:"치명",   type:"flat", min:1, max:7, weight:12 },
    { key:"speed",   name:"이속",   type:"flat", min:6, max:18, weight:10 },
    { key:"atkPct",  name:"공격%",  type:"pct",  min:2, max:10, weight:8 },
    { key:"defPct",  name:"방어%",  type:"pct",  min:2, max:10, weight:5 },
    { key:"hpPct",   name:"체력%",  type:"pct",  min:3, max:12, weight:5 },
    { key:"lifesteal", name:"흡혈", type:"flat", min:1, max:4, weight:3 }
  ];

  function weightedPick(list) {
    const total = list.reduce((s,x)=>s + (x.weight ?? 1), 0);
    let r = Math.random() * total;
    for (const x of list) {
      r -= (x.weight ?? 1);
      if (r <= 0) return x;
    }
    return list[0];
  }

  // ----------------- Stage System -----------------
  function stageLabel(stageIndex) {
    const chapter = Math.floor((stageIndex - 1) / 10) + 1;
    const step = ((stageIndex - 1) % 10) + 1;
    return `${chapter}-${step}`;
  }
  function isBossStage(stageIndex) {
    const step = ((stageIndex - 1) % 10) + 1;
    return (step === 5 || step === 10);
  }
  function stageDifficulty(stageIndex) {
    return Math.floor((stageIndex - 1) / 2);
  }
  function computeStageGoal(stageIndex) {
    const diff = stageDifficulty(stageIndex);
    return clamp(8 + diff, 8, 22);
  }

  // ----------------- ID -----------------
  function cryptoId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  // ----------------- Item Generation -----------------
  function rollRarity() {
    const total = RARITY.reduce((s, r) => s + r.w, 0);
    let r = Math.random() * total;
    for (const it of RARITY) {
      r -= it.w;
      if (r <= 0) return it;
    }
    return RARITY[0];
  }

  function rollSet(rarityKey) {
    // 희귀 이상에서 세트 확률 점증
    const p = (rarityKey === "N") ? 0.12 : (rarityKey === "R" ? 0.30 : (rarityKey === "SR" ? 0.55 : 0.75));
    if (Math.random() > p) return null;
    return pick(SETS).key;
  }

  function rollAffixes(count) {
    const got = [];
    const used = new Set();
    let tries = 0;
    while (got.length < count && tries < 30) {
      tries++;
      const a = weightedPick(AFFIX);
      if (used.has(a.key)) continue;
      used.add(a.key);
      const val = rand(a.min, a.max);
      got.push({ key: a.key, name: a.name, type: a.type, value: val });
    }
    return got;
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
    const baseStats = {
      atk: Math.round(atk * mult),
      def: Math.round(def * mult),
      hp:  Math.round(hp  * mult),
      crit: Math.round(crit * mult)
    };

    const setKey = rollSet(rar.key);

    // 감정: 처음엔 미감정(identified=false). 미감정도 기본성능 사용 가능.
    const affixCount = rar.opt;         // 희귀 이상 옵션 존재
    const hiddenAffixes = (affixCount > 0) ? rollAffixes(affixCount) : [];

    return {
      id: cryptoId(),
      slot,
      rarity: rar.key,
      rarityName: rar.name,
      name: baseName,
      ilvl,
      enhance,
      setKey,                // null | "WOLF" | ...
      identified: (rar.key === "N") ? true : false,   // 일반은 감정 없이도 OK로 가볍게
      hiddenAffixes,         // 감정 전 보관
      affixes: [],           // 감정 후 공개
      stats: baseStats,
      locked: false,
      createdAt: nowISO()
    };
  }

  function itemPower(it) {
    const s = it.stats;
    const aff = it.identified ? it.affixes : [];
    // 대충 파워: 기본 + 강화 + 옵션
    let p = (s.atk*2) + (s.def*2) + (s.hp*0.6) + (s.crit*1.5) + (it.enhance*6) + (it.ilvl*2);
    for (const a of aff) {
      if (a.key === "atkFlat") p += a.value*3;
      if (a.key === "defFlat") p += a.value*3;
      if (a.key === "hpFlat") p += a.value*0.8;
      if (a.key === "crit") p += a.value*2.0;
      if (a.key === "speed") p += a.value*0.8;
      if (a.key === "atkPct") p += a.value*4;
      if (a.key === "defPct") p += a.value*3.5;
      if (a.key === "hpPct") p += a.value*3.0;
      if (a.key === "lifesteal") p += a.value*6;
    }
    if (it.setKey) p += 14;
    return p;
  }

  function itemLabel(it) {
    const idt = it.identified ? "" : " (미감정)";
    const set = it.setKey ? ` <${it.setKey}>` : "";
    return `[${it.rarity}] +${it.enhance} ${it.name}${idt}(Lv${it.ilvl})${set} PWR ${Math.round(itemPower(it))}`;
  }

  // 강화
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

  // 감정(아이템 1개)
  function appraiseItem(it) {
    if (it.identified) return false;
    it.identified = true;
    it.affixes = it.hiddenAffixes.slice();
    it.hiddenAffixes = [];
    return true;
  }

  function setName(key) {
    const s = SETS.find(x=>x.key===key);
    return s ? s.name : "";
  }

  // ----------------- State -----------------
  function freshState() {
    const st = {
      version: 3,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      paused: false,

      inTown: true,
      stageIndex: 1,
      inBossRoom: false,
      stageKills: 0,
      stageGoal: computeStageGoal(1),

      portal: null,

      cam: { x: 0, y: 0, shake: 0 },

      auto: {
        enabled: false,
        target: true,
        attack: true,
        pickup: true,
        move: true
      },

      player: {
        name: "용사",
        level: 1,
        exp: 0,
        expToNext: 25,
        gold: 120,
        gems: 0,            // 미션/업적용
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

      // 상자(보상)
      chests: { normal: 0, boss: 0 },

      // 일일 미션
      daily: {
        dayKey: todayKey(),
        tasks: [],        // [{id,title,goal,progress,rewardGold,rewardGems,claimed}]
        claimedCount: 0
      },

      // 업적(영구)
      achievements: {
        // id: {progress, goal, claimed}
        map: {}
      },

      equip: { weapon:null, armor:null, ring:null },
      inv: [],
      entities: [],
      drops: [],

      stats: { kills:0, bosses:0, stages:0, gacha:0, enhanced:0, appraised:0 }
    };

    // starter gear
    st.inv.push(makeItem("weapon", 1));
    st.inv.push(makeItem("armor", 1));
    st.inv.push(makeItem("ring", 1));

    // daily init
    resetDailyIfNeeded(st);
    initAchievementsIfNeeded(st);

    return st;
  }

  // ----------------- Derived Stats (옵션 + 세트 포함) -----------------
  function collectSetCounts(state) {
    const cnt = {};
    for (const slot of ITEM_SLOTS) {
      const it = state.equip[slot];
      if (!it || !it.setKey) continue;
      cnt[it.setKey] = (cnt[it.setKey] ?? 0) + 1;
    }
    return cnt;
  }

  function applyBonus(bonus, acc) {
    if (!bonus) return;
    // flat
    if (bonus.atk) acc.atk += bonus.atk;
    if (bonus.def) acc.def += bonus.def;
    if (bonus.hp)  acc.hp += bonus.hp;
    if (bonus.crit) acc.crit += bonus.crit;
    if (bonus.speed) acc.speed += bonus.speed;
    if (bonus.lifesteal) acc.lifesteal += bonus.lifesteal;

    // pct
    if (bonus.atkPct) acc.atkPct += bonus.atkPct;
    if (bonus.defPct) acc.defPct += bonus.defPct;
    if (bonus.hpPct)  acc.hpPct += bonus.hpPct;
  }

  function calcPlayerDerived(state) {
    const p = state.player;
    const eq = state.equip;

    // base
    let hpMax = p.hpMaxBase;
    let atk = p.atkBase;
    let def = p.defBase;
    let crit = p.critBase;
    let speed = p.speed;
    let lifesteal = 0;

    // pct accum
    let atkPct = 0, defPct = 0, hpPct = 0;

    // equip base stats
    for (const s of ITEM_SLOTS) {
      const it = eq[s];
      if (!it) continue;
      atk += it.stats.atk || 0;
      def += it.stats.def || 0;
      hpMax += it.stats.hp || 0;
      crit += it.stats.crit || 0;

      // affixes only if identified
      if (it.identified) {
        for (const a of it.affixes) {
          if (a.key === "atkFlat") atk += a.value;
          if (a.key === "defFlat") def += a.value;
          if (a.key === "hpFlat") hpMax += a.value;
          if (a.key === "crit") crit += a.value;
          if (a.key === "speed") speed += a.value;
          if (a.key === "atkPct") atkPct += a.value;
          if (a.key === "defPct") defPct += a.value;
          if (a.key === "hpPct") hpPct += a.value;
          if (a.key === "lifesteal") lifesteal += a.value;
        }
      }
    }

    // set bonuses
    const cnt = collectSetCounts(state);
    const setBonusAcc = { atk:0, def:0, hp:0, crit:0, speed:0, lifesteal:0, atkPct:0, defPct:0, hpPct:0 };
    for (const setKey of Object.keys(cnt)) {
      const n = cnt[setKey];
      const set = SETS.find(x=>x.key===setKey);
      if (!set) continue;
      if (n >= 2) applyBonus(set.two, setBonusAcc);
      if (n >= 3) applyBonus(set.three, setBonusAcc);
    }

    atk += setBonusAcc.atk;
    def += setBonusAcc.def;
    hpMax += setBonusAcc.hp;
    crit += setBonusAcc.crit;
    speed += setBonusAcc.speed;
    lifesteal += setBonusAcc.lifesteal;

    atkPct += setBonusAcc.atkPct;
    defPct += setBonusAcc.defPct;
    hpPct  += setBonusAcc.hpPct;

    // apply pct at end
    atk = Math.round(atk * (1 + atkPct/100));
    def = Math.round(def * (1 + defPct/100));
    hpMax = Math.round(hpMax * (1 + hpPct/100));

    crit = clamp(crit, 0, 60);
    speed = clamp(speed, 120, 260);
    lifesteal = clamp(lifesteal, 0, 12);

    return { hpMax, atk, def, crit, speed, lifesteal, atkPct, defPct, hpPct, setCounts: cnt };
  }

  // ----------------- Canvas -----------------
  const canvas = $("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    canvas.width = Math.max(320, Math.floor(rect.width * dpr));
    canvas.height = Math.max(240, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ----------------- Input -----------------
  const keys = new Set();
  let wantAttack=false, wantSkill=false, wantDodge=false, wantPotion=false, wantPickup=false;

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup","arrowdown","arrowleft","arrowright"," ","shift","w","a","s","d","j","k","l","h","e"].includes(k)) e.preventDefault();
    keys.add(k);
    if (k === "j" || k === " ") wantAttack = true;
    if (k === "k") wantSkill = true;
    if (k === "l" || k === "shift") wantDodge = true;
    if (k === "h") wantPotion = true;
    if (k === "e") wantPickup = true;
  }, { passive:false });

  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  function bindTap(btnId, onPress) {
    const el = $(btnId);
    const handler = (ev) => { ev.preventDefault(); onPress(); };
    el.addEventListener("pointerdown", handler, { passive:false });
  }

  // Virtual Joystick
  const joy = $("joy");
  const joyStick = $("joyStick");
  const joyState = { active:false, pid:null, cx:0, cy:0, x:0, y:0 };

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

  // ----------------- Spawns -----------------
  function makeEnemy(state, tier) {
    const p = state.player;
    const diff = stageDifficulty(state.stageIndex);
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

  function spawnStage(state) {
    state.entities.length = 0;
    state.drops.length = 0;
    state.portal = null;

    state.stageKills = 0;
    state.stageGoal = computeStageGoal(state.stageIndex);

    const p = state.player;
    p.x = WORLD.w/2; p.y = WORLD.h/2;

    if (state.inTown) return;

    if (state.inBossRoom) {
      state.entities.push(makeEnemy(state, "boss"));
      log(`보스 방 진입! (${stageLabel(state.stageIndex)})`, "dim");
      return;
    }

    const diff = stageDifficulty(state.stageIndex);
    const baseCount = clamp(6 + Math.floor(diff*0.6), 6, 14);
    for (let i=0;i<baseCount;i++){
      const tier = (Math.random() < 0.18) ? "elite" : "normal";
      state.entities.push(makeEnemy(state, tier));
    }
    log(`스테이지 시작: ${stageLabel(state.stageIndex)} (목표 ${state.stageGoal}처치)`, "dim");
  }

  // ----------------- Portal -----------------
  function makePortal(kind) {
    return { kind, x: rand(220, WORLD.w-220), y: rand(220, WORLD.h-220), r: 34 };
  }

  function maybeSpawnPortal(state) {
    if (state.portal || state.inTown) return;

    if (state.inBossRoom) {
      const alive = state.entities.some(e => e.hp > 0);
      if (!alive) {
        state.portal = makePortal("exit");
        // 보스 상자 + 추가 보상
        state.chests.boss += 1;
        log("보스 처치! 보스 상자 + 출구 문 생성.", "dim");
        onStageClear(state, true);
      }
      return;
    }

    if (state.stageKills >= state.stageGoal) {
      const bossNext = isBossStage(state.stageIndex);
      state.portal = makePortal(bossNext ? "boss" : "next");
      state.chests.normal += 1; // 스테이지 상자
      log(bossNext ? "보스 문이 나타났다! (보상 상자 획득)" : "다음 문이 나타났다! (보상 상자 획득)", "dim");
      onStageClear(state, false);
    }
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
      state.inBossRoom = false;
      state.stageIndex += 1;
      spawnStage(state);
      return;
    }

    // next
    state.stageIndex += 1;
    spawnStage(state);
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

  // ----------------- Drops -----------------
  function dropCoin(state, x, y, amount) {
    state.drops.push({ id: cryptoId(), kind:"coin", x, y, r: 10, amount });
  }
  function dropEquip(state, x, y) {
    const it = makeItem(pick(ITEM_SLOTS), state.player.level);
    state.drops.push({ id: cryptoId(), kind:"equip", x, y, r: 12, item: it });
    log(`드랍: ${itemLabel(it)}`, "dim");
  }

  // ----------------- Combat -----------------
  function dealDamage(def, base, critChance) {
    let dmg = base;
    const isCrit = (Math.random()*100) < critChance;
    if (isCrit) dmg = Math.round(dmg * 1.65);
    dmg = Math.max(1, dmg - def);
    return { dmg, isCrit };
  }

  function playerAttack(state, mode) {
    const p = state.player;
    if (p.atkCd > 0) return false;
    if (state.inTown) return false;

    const der = calcPlayerDerived(state);
    const range = (mode === "skill") ? 125 : 72;
    const arc = (mode === "skill") ? Math.PI * 0.92 : Math.PI * 0.60;
    const base = (mode === "skill") ? Math.round(der.atk * 1.95) : Math.round(der.atk * 1.08);

    if (mode === "skill") {
      if (p.skillCd > 0) return false;
      p.skillCd = 3.2;
      p.atkCd = 0.28;
      cameraShake(state, 7);
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

      const { dmg, isCrit } = dealDamage(e.def, base + rand(-2, 3), der.crit);
      e.hp = clamp(e.hp - dmg, 0, e.hpMax);
      e.hitCd = 0.08;
      hitAny = true;

      // 흡혈(원거리X, 근접 판정이라 바로 적용)
      if (der.lifesteal > 0) {
        const heal = Math.max(1, Math.round(dmg * (der.lifesteal/100)));
        p.hp = clamp(p.hp + heal, 1, der.hpMax);
      }

      if (mode === "skill") {
        e.x += nx * 38;
        e.y += ny * 38;
      }
      if (isCrit) cameraShake(state, 4);

      if (e.hp <= 0) onEnemyDead(state, e);
    }

    return hitAny;
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

    // 업적 진행
    bumpAchievement(state, "LEVEL", 1);
  }

  function onEnemyDead(state, e) {
    const p = state.player;
    state.stats.kills += 1;
    if (e.tier === "boss") state.stats.bosses += 1;

    p.streak += 1;
    state.stageKills += 1;

    // rewards
    const diff = stageDifficulty(state.stageIndex);
    const baseGold = 18 + e.level*6 + (e.tier==="elite" ? 32 : 0) + (e.tier==="boss" ? 220 : 0) + diff*6;
    const gold = Math.round(baseGold * (1 + Math.min(p.streak, 10) * 0.03));
    dropCoin(state, e.x, e.y, gold);

    const dropChance = (e.tier==="boss") ? 0.90 : (e.tier==="elite" ? 0.48 : 0.23);
    if (Math.random() < dropChance) dropEquip(state, e.x + rand(-10,10), e.y + rand(-10,10));

    const exp = Math.round(10 + e.level*5 + (e.tier==="elite" ? 18 : 0) + (e.tier==="boss" ? 90 : 0) + diff*3);
    gainExp(state, exp);

    // daily / achievement progress
    dailyProgress(state, "KILL", 1);
    bumpAchievement(state, "KILL", 1);
    if (e.tier === "boss") {
      dailyProgress(state, "BOSS", 1);
      bumpAchievement(state, "BOSS", 1);
    }

    maybeSpawnPortal(state);
  }

  function playerUsePotion(state) {
    const p = state.player;
    const der = calcPlayerDerived(state);
    if (p.potions <= 0) { log("포션이 없다.", "dim"); return; }
    if (p.hp >= der.hpMax) return;
    p.potions -= 1;
    const amount = Math.round(der.hpMax * 0.45) + rand(6, 12);
    p.hp = clamp(p.hp + amount, 1, der.hpMax);
    log(`포션 사용: +${amount}HP`, "dim");
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
    log(`쓰러졌다… ${lost}G 잃고 마을로 후퇴.`, "dim");
    goTown(state);
  }

  // ----------------- Pickup -----------------
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

  // ----------------- Auto Hunt (오토 이동/추적/공격/줍기/문) -----------------
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

  function nearestDrop(state, maxDist=550) {
    const p = state.player;
    let best = null;
    let bestD = maxDist;
    for (const d of state.drops) {
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  function autoLogic(state) {
    const a = state.auto;
    if (!a.enabled) return;
    if (state.inTown) return;

    // 자동 줍기
    if (a.pickup) pickupNearby(state);

    const p = state.player;

    // 1) 적이 있으면 적을 우선 추적
    const target = a.target ? nearestEnemy(state, 900) : null;
    if (target) {
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;

      // 바라보기
      p.facing.x = dx / dist;
      p.facing.y = dy / dist;

      // 오토 이동(붙기)
      if (a.move && dist > (78 + target.r)) {
        // 이동 입력을 강제로 만들어서 update에서 움직이게 함
        // (조이스틱/키 입력과 합치지 않고, 오토용 별도 벡터로 처리)
        state._autoMove = { x: p.facing.x, y: p.facing.y };
      } else {
        state._autoMove = null;
      }

      // 오토 공격
      if (a.attack) {
        if (p.skillCd <= 0 && (target.tier === "boss" || target.tier === "elite")) {
          wantSkill = true;
        } else if (dist <= (82 + target.r) && p.atkCd <= 0) {
          wantAttack = true;
        }
      }
      return;
    }

    // 2) 적이 없으면 드랍/문 우선
    state._autoMove = null;

    // 문이 있으면 문으로 이동
    if (state.portal && a.move) {
      const dx = state.portal.x - p.x;
      const dy = state.portal.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      p.facing.x = dx / dist; p.facing.y = dy / dist;
      state._autoMove = { x: p.facing.x, y: p.facing.y };
      return;
    }

    // 드랍이 있으면 드랍으로 이동
    const d = nearestDrop(state, 650);
    if (d && a.move) {
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      p.facing.x = dx / dist; p.facing.y = dy / dist;
      state._autoMove = { x: p.facing.x, y: p.facing.y };
    }
  }

  // ----------------- Town / Stage -----------------
  function goTown(state) {
    state.inTown = true;
    state.inBossRoom = false;
    state.portal = null;
    state.entities.length = 0;
    state.drops.length = 0;

    const p = state.player;
    p.x = WORLD.w/2; p.y = WORLD.h/2;

    const der = calcPlayerDerived(state);
    p.hp = der.hpMax;
    p.atkCd = 0; p.skillCd = 0; p.dodgeCd = 0;

    // 일일 리셋 체크(마을 들어오면도 체크)
    resetDailyIfNeeded(state);
  }

  function enterStage(state) {
    state.inTown = false;
    state.inBossRoom = false;
    spawnStage(state);
  }

  // ----------------- Rewards: Chest / Daily / Achievements -----------------
  function openOneChest(state, kind) {
    const p = state.player;
    if (kind === "boss") {
      if (state.chests.boss <= 0) return false;
      state.chests.boss -= 1;

      // 보스 상자: 골드+젬+장비2
      const g = 220 + p.level*30 + stageDifficulty(state.stageIndex)*15;
      const gem = 2 + Math.floor(p.level/10);
      p.gold += g;
      p.gems += gem;

      state.inv.push(makeItem(pick(ITEM_SLOTS), p.level + 1));
      state.inv.push(makeItem(pick(ITEM_SLOTS), p.level + 1));

      log(`보스 상자 오픈! +${g}G +${gem}💎 +장비2`, "dim");
      dailyProgress(state, "CHEST", 1);
      bumpAchievement(state, "CHEST", 1);
      return true;
    } else {
      if (state.chests.normal <= 0) return false;
      state.chests.normal -= 1;

      const g = 90 + p.level*12 + stageDifficulty(state.stageIndex)*8;
      p.gold += g;

      // 일반 상자: 장비 0~1 확률
      if (Math.random() < 0.45) state.inv.push(makeItem(pick(ITEM_SLOTS), p.level));

      log(`상자 오픈! +${g}G`, "dim");
      dailyProgress(state, "CHEST", 1);
      bumpAchievement(state, "CHEST", 1);
      return true;
    }
  }

  function onStageClear(state, bossClear) {
    state.stats.stages += 1;
    dailyProgress(state, "STAGE", 1);
    bumpAchievement(state, "STAGE", 1);
    if (bossClear) bumpAchievement(state, "BOSS_CLEAR", 1);
  }

  function resetDailyIfNeeded(state) {
    const tk = todayKey();
    if (!state.daily) {
      state.daily = { dayKey: tk, tasks: [], claimedCount: 0 };
    }
    if (state.daily.dayKey !== tk) {
      state.daily.dayKey = tk;
      state.daily.claimedCount = 0;
      state.daily.tasks = [];
    }
    if (state.daily.tasks.length === 0) {
      // 오늘 미션 생성(고정 3개 + 가끔 4개)
      state.daily.tasks = [
        { id:"KILL",  title:"몬스터 40마리 처치", goal:40, progress:0, rewardGold:220, rewardGems:0, claimed:false },
        { id:"STAGE", title:"스테이지 6회 클리어", goal:6,  progress:0, rewardGold:260, rewardGems:1, claimed:false },
        { id:"CHEST", title:"상자 5개 열기",     goal:5,  progress:0, rewardGold:180, rewardGems:1, claimed:false },
      ];
      // 보스 미션은 확률로
      if (Math.random() < 0.55) {
        state.daily.tasks.push({ id:"BOSS", title:"보스 1회 처치", goal:1, progress:0, rewardGold:260, rewardGems:2, claimed:false });
      }
    }
  }

  function dailyProgress(state, id, amount) {
    resetDailyIfNeeded(state);
    const t = state.daily.tasks.find(x => x.id === id);
    if (!t || t.claimed) return;
    t.progress = clamp(t.progress + amount, 0, t.goal);
  }

  function claimDaily(state) {
    resetDailyIfNeeded(state);
    let claimed = 0;
    for (const t of state.daily.tasks) {
      if (t.claimed) continue;
      if (t.progress >= t.goal) {
        t.claimed = true;
        state.player.gold += t.rewardGold;
        state.player.gems += t.rewardGems;
        claimed++;
      }
    }
    if (claimed > 0) log(`일일 미션 수령: ${claimed}개`, "dim");
    else log("수령 가능한 일일 보상이 없다.", "dim");
  }

  function initAchievementsIfNeeded(state) {
    state.achievements ??= { map: {} };
    const map = state.achievements.map;

    // 목표치(영구)
    const defs = [
      { id:"KILL", title:"누적 처치 500", goal:500, rewardGems:5, rewardGold:0 },
      { id:"BOSS", title:"보스 20회 처치", goal:20, rewardGems:8, rewardGold:0 },
      { id:"STAGE", title:"스테이지 100회 클리어", goal:100, rewardGems:10, rewardGold:0 },
      { id:"CHEST", title:"상자 80개 오픈", goal:80, rewardGems:6, rewardGold:0 },
      { id:"LEVEL", title:"레벨 30 달성", goal:30, rewardGems:12, rewardGold:0 },
      { id:"BOSS_CLEAR", title:"보스방 클리어 30회", goal:30, rewardGems:10, rewardGold:0 },
      { id:"APPRAISE", title:"감정 60회", goal:60, rewardGems:6, rewardGold:0 },
      { id:"ENHANCE", title:"강화 성공 30회", goal:30, rewardGems:6, rewardGold:0 }
    ];

    state._achDefs = defs; // UI용
    for (const d of defs) {
      if (!map[d.id]) map[d.id] = { progress:0, goal:d.goal, claimed:false, title:d.title, rewardGems:d.rewardGems, rewardGold:d.rewardGold };
    }
  }

  function bumpAchievement(state, id, amount) {
    initAchievementsIfNeeded(state);
    const a = state.achievements.map[id];
    if (!a || a.claimed) return;
    a.progress = clamp(a.progress + amount, 0, a.goal);
  }

  function claimAchievements(state) {
    initAchievementsIfNeeded(state);
    let claimed = 0;
    for (const id of Object.keys(state.achievements.map)) {
      const a = state.achievements.map[id];
      if (a.claimed) continue;
      if (a.progress >= a.goal) {
        a.claimed = true;
        state.player.gold += (a.rewardGold ?? 0);
        state.player.gems += (a.rewardGems ?? 0);
        claimed++;
      }
    }
    if (claimed > 0) log(`업적 보상 수령: ${claimed}개`, "dim");
    else log("수령 가능한 업적 보상이 없다.", "dim");
  }

  // ----------------- Inventory / Equip / Shop -----------------
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

    const it = makeItem(pick(ITEM_SLOTS), p.level + 1);
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
      bumpAchievement(state, "ENHANCE", 1);
      dailyProgress(state, "ENHANCE", 1);
    } else {
      log(`강화 실패… (확률 ${Math.round(chance*100)}%)`, "dim");
    }
  }

  // 감정(마을에서만, 미감정 장비 1개당 비용)
  function appraiseAll(state) {
    if (!state.inTown) { log("감정은 마을에서만 가능.", "dim"); return; }

    const targets = state.inv.filter(it => !it.identified);
    if (targets.length === 0) { log("감정할 미감정 아이템이 없다.", "dim"); return; }

    let count = 0;
    let costSum = 0;

    for (const it of targets) {
      const cost = 40 + it.ilvl * 6 + (it.rarity === "SSR" ? 120 : it.rarity === "SR" ? 70 : it.rarity === "R" ? 45 : 0);
      if (state.player.gold < cost) break;
      state.player.gold -= cost;
      costSum += cost;
      if (appraiseItem(it)) {
        count++;
        state.stats.appraised += 1;
        bumpAchievement(state, "APPRAISE", 1);
      }
    }

    if (count > 0) log(`감정 완료: ${count}개 (-${costSum}G)`, "dim");
    else log("골드 부족으로 감정을 진행하지 못했다.", "dim");
  }

  // ----------------- Camera -----------------
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

  function drawGrid(w, h, camX, camY) {
    const step = 80;
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "rgba(36,49,77,0.65)";
    ctx.lineWidth = 1;

    const startX = -((camX % step) + step);
    const startY = -((camY % step) + step);

    ctx.beginPath();
    for (let x = startX; x < w + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = startY; y < h + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
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

  function drawPortal(portal, camX, camY) {
    const x = portal.x - camX;
    const y = portal.y - camY;

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

  function drawPlayer(state, camX, camY) {
    const p = state.player;
    const der = calcPlayerDerived(state);

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

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(233,238,252,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + p.facing.x*22, y + p.facing.y*22);
    ctx.stroke();

    // 작은 상태 텍스트(흡혈)
    if (der.lifesteal > 0) {
      ctx.fillStyle = "rgba(233,238,252,0.85)";
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";
      ctx.fillText(`LS ${der.lifesteal}%`, x-18, y-28);
    }
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

  function drawTopBars(state, w) {
    const p = state.player;
    const der = calcPlayerDerived(state);
    const hpPct = clamp(p.hp / der.hpMax, 0, 1);
    const expPct = clamp(p.exp / p.expToNext, 0, 1);

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(12, 12, Math.min(690, w-24), 74);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(22, 26, 320, 14);
    ctx.fillStyle = "rgba(46,229,157,0.85)";
    ctx.fillRect(22, 26, 320*hpPct, 14);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(22, 46, 320, 10);
    ctx.fillStyle = "rgba(91,140,255,0.75)";
    ctx.fillRect(22, 46, 320*expPct, 10);

    ctx.fillStyle = "rgba(233,238,252,0.95)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";

    const stageText = state.inTown ? "마을" : (state.inBossRoom ? `보스방(${stageLabel(state.stageIndex)})` : `스테이지 ${stageLabel(state.stageIndex)}`);
    const goalText = state.inTown ? "" : (state.inBossRoom ? "보스 처치 → 출구" : `처치 ${state.stageKills}/${state.stageGoal}`);
    ctx.fillText(`${stageText} | ${goalText}`, 354, 36);
    ctx.fillText(`Lv.${p.level} HP ${p.hp}/${der.hpMax} EXP ${p.exp}/${p.expToNext}  ${p.gold}G  💎${p.gems}  P${p.potions}  AUTO:${state.auto.enabled?"ON":"OFF"}`, 354, 56);
    ctx.fillText(`ATK ${der.atk} DEF ${der.def} CRIT ${der.crit}% SPD ${der.speed} (세트/옵션 반영)`, 354, 74);
  }

  function draw(state, dt) {
    const p = state.player;

    const viewW = canvas.getBoundingClientRect().width;
    const viewH = canvas.getBoundingClientRect().height;

    if (state.cam.shake > 0) state.cam.shake = Math.max(0, state.cam.shake - dt * 18);
    const sx = (Math.random()-0.5) * state.cam.shake;
    const sy = (Math.random()-0.5) * state.cam.shake;

    const camX = clamp(p.x - viewW/2, 0, WORLD.w - viewW) + sx;
    const camY = clamp(p.y - viewH/2, 0, WORLD.h - viewH) + sy;
    state.cam.x = camX; state.cam.y = camY;

    const bg = state.inTown ? "#0e1628" : (state.inBossRoom ? "#220f16" : "#0d1b17");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, viewW, viewH);

    drawGrid(viewW, viewH, camX, camY);
    drawVignette(viewW, viewH);

    if (state.portal) drawPortal(state.portal, camX, camY);
    for (const d of state.drops) drawDrop(d, camX, camY);
    for (const e of state.entities) if (e.hp > 0) drawEnemy(e, camX, camY);
    drawPlayer(state, camX, camY);
    drawTopBars(state, viewW);

    checkPortalCollision(state);
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

    resetDailyIfNeeded(state);
    initAchievementsIfNeeded(state);

    const p = state.player;
    const der = calcPlayerDerived(state);

    // 반영: 이속은 파생치 기반
    p.speed = der.speed;

    p.invuln = Math.max(0, p.invuln - dt);
    p.dodgeCd = Math.max(0, p.dodgeCd - dt);
    p.atkCd = Math.max(0, p.atkCd - dt);
    p.skillCd = Math.max(0, p.skillCd - dt);

    // Auto logic (sets state._autoMove + wants)
    state._autoMove = null;
    autoLogic(state);

    // movement input mix: (유저 입력 + 오토 입력)
    let mx = currentMoveX();
    let my = currentMoveY();

    // 오토 이동이 켜져있으면, "유저 입력이 거의 없을 때" 오토가 우선
    if (state.auto.enabled && state.auto.move && state._autoMove) {
      const userLen = Math.hypot(mx, my);
      if (userLen < 0.25) {
        mx = state._autoMove.x;
        my = state._autoMove.y;
      }
    }

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

    // 모바일 편의: 오토 OFF여도 가까우면 줍기
    if (isTouchDevice() && !state.auto.enabled) pickupNearby(state);

    enemyAI(state, dt);
    maybeSpawnPortal(state);

    p.hp = clamp(p.hp, 0, der.hpMax);

    for (const e of state.entities) if (e.hitCd > 0) e.hitCd -= dt;
  }

  // ----------------- Sidebar Render -----------------
  function renderRewards(state) {
    resetDailyIfNeeded(state);
    initAchievementsIfNeeded(state);

    const p = state.player;
    const d = state.daily;
    const ach = state.achievements.map;

    const dailyLines = d.tasks.map(t => {
      const done = (t.progress >= t.goal) ? "✓" : "";
      const c = t.claimed ? "CLAIMED" : "";
      return `- ${done} ${t.title} (${t.progress}/${t.goal}) ${c} [+${t.rewardGold}G +${t.rewardGems}💎]`;
    }).join("\n");

    // 업적: 완료 가능한 것만 상단에 보이게(너무 길어지니까 6개만)
    const achArr = Object.keys(ach).map(k => ach[k]);
    achArr.sort((a,b) => {
      const ar = (a.claimed ? 2 : (a.progress>=a.goal ? 0 : 1));
      const br = (b.claimed ? 2 : (b.progress>=b.goal ? 0 : 1));
      if (ar !== br) return ar - br;
      return (b.progress/b.goal) - (a.progress/a.goal);
    });
    const achLines = achArr.slice(0,6).map(a => {
      const done = (a.progress >= a.goal) ? "✓" : "";
      const c = a.claimed ? "CLAIMED" : "";
      return `- ${done} ${a.title} (${a.progress}/${a.goal}) ${c} [+${a.rewardGold||0}G +${a.rewardGems||0}💎]`;
    }).join("\n");

    $("rewards").textContent = `
상자: 일반 ${state.chests.normal} / 보스 ${state.chests.boss}
재화: ${p.gold}G / 💎${p.gems}

[일일 미션 - ${d.dayKey}]
${dailyLines}

[업적(상위 6개 표시)]
${achLines}
`.trim();
  }

  function renderSidebar(state) {
    const p = state.player;
    const der = calcPlayerDerived(state);

    const stageText = state.inTown ? "마을" : (state.inBossRoom ? `보스방(${stageLabel(state.stageIndex)})` : `스테이지 ${stageLabel(state.stageIndex)}`);
    const goalText = state.inTown ? "" : (state.inBossRoom ? "보스 처치 → 출구" : `처치 ${state.stageKills}/${state.stageGoal}`);

    const setCounts = der.setCounts || {};
    const setInfo = Object.keys(setCounts).length === 0
      ? "세트: (없음)"
      : "세트: " + Object.keys(setCounts).map(k => `${setName(k)} x${setCounts[k]}`).join(" | ");

    $("hud").textContent = `
${stageText}
${goalText}
AUTO: ${state.auto.enabled ? "ON" : "OFF"} (이동/추적/공격/줍기/문)

레벨: ${p.level}  EXP: ${p.exp}/${p.expToNext}
HP: ${p.hp}/${der.hpMax}  포션: ${p.potions}
골드: ${p.gold}G  💎: ${p.gems}
ATK: ${der.atk}  DEF: ${der.def}  CRIT: ${der.crit}%  SPD: ${der.speed}
흡혈: ${der.lifesteal}%
${setInfo}
`.trim();

    const eqLines = ITEM_SLOTS.map(slot => {
      const it = state.equip[slot];
      if (!it) return `${slot.toUpperCase()}: (없음)`;
      const set = it.setKey ? ` / ${setName(it.setKey)}` : "";
      const aff = it.identified
        ? (it.affixes.length ? ` / 옵션: ${it.affixes.map(a=>`${a.name}${a.type==="pct"?"%":""}+${a.value}`).join(", ")}` : "")
        : " / 옵션: ??? (감정 필요)";
      return `${slot.toUpperCase()}: ${itemLabel(it)}${set}${aff}`;
    }).join("\n");
    $("equip").textContent = eqLines;

    const inv = state.inv.slice().sort((a,b) => itemPower(b) - itemPower(a));
    const invEl = $("inv");
    invEl.innerHTML = "";
    if (inv.length === 0) {
      invEl.innerHTML = `<div class="small">인벤이 비어있다.</div>`;
    } else {
      for (const it of inv) {
        const affText = it.identified
          ? (it.affixes.length ? it.affixes.map(a=>`${a.name}${a.type==="pct"?"%":""}+${a.value}`).join(", ") : "(옵션 없음)")
          : "(옵션 ??? / 감정)";
        const setText = it.setKey ? setName(it.setKey) : "-";

        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
          <div>
            <div class="name">${it.locked ? "🔒 " : ""}${escapeHtml(itemLabel(it))}</div>
            <div class="meta">set=${escapeHtml(setText)} | ${escapeHtml(affText)}</div>
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

    renderRewards(state);
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
    const refreshAutoBtn = () => autoBtn.textContent = `자동사냥: ${state.auto.enabled ? "ON" : "OFF"}`;
    autoBtn.addEventListener("click", () => {
      state.auto.enabled = !state.auto.enabled;
      log(`자동사냥 ${state.auto.enabled ? "ON" : "OFF"}`, "dim");
      refreshAutoBtn();
      renderSidebar(state);
      autosave(state);
    });
    refreshAutoBtn();

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
      log(`문 위치: (${Math.round(state.portal.x)}, ${Math.round(state.portal.y)})`, "dim");
    });

    // rewards
    $("btnOpenChest").addEventListener("click", () => {
      // 보스 상자 우선
      const okBoss = openOneChest(state, "boss");
      const okNorm = okBoss ? true : openOneChest(state, "normal");
      if (!okBoss && !okNorm) log("열 수 있는 상자가 없다.", "dim");
      renderSidebar(state);
      autosave(state);
    });

    $("btnClaimDaily").addEventListener("click", () => {
      claimDaily(state);
      renderSidebar(state);
      autosave(state);
    });

    $("btnClaimAch").addEventListener("click", () => {
      claimAchievements(state);
      renderSidebar(state);
      autosave(state);
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

    $("btnAppraise").addEventListener("click", () => {
      appraiseAll(state);
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
    if (!state || state.version !== 3) state = freshState();

    // safety for older partial saves (just in case)
    state.entities ??= [];
    state.drops ??= [];
    state.inv ??= [];
    state.equip ??= { weapon:null, armor:null, ring:null };
    state.auto ??= { enabled:false, target:true, attack:true, pickup:true, move:true };
    state.chests ??= { normal:0, boss:0 };
    state.stats ??= { kills:0, bosses:0, stages:0, gacha:0, enhanced:0, appraised:0 };
    state.player.gems ??= 0;

    resetDailyIfNeeded(state);
    initAchievementsIfNeeded(state);

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
