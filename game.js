(() => {
  "use strict";

  // ----------------- Helpers -----------------
  const $ = (id) => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const nowISO = () => new Date().toISOString();

  // ----------------- Storage -----------------
  const SAVE_KEY = "action_canvas_rpg_v1";

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
  const LOC = {
    town:   { name: "마을",   diff: 0, spawn: 0,  bg: "#0e1628" },
    field:  { name: "필드",  diff: 1, spawn: 6,  bg: "#0d1b17" },
    dungeon:{ name: "던전",  diff: 2, spawn: 8,  bg: "#161022" },
    boss:   { name: "보스",  diff: 3, spawn: 1,  bg: "#220f16" }
  };

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

  const ENEMY_POOL = {
    field:   ["슬라임","늑대","고블린","스켈레톤"],
    dungeon: ["광폭 늑대","고블린 주술사","해골 기사","저주받은 갑옷"],
    boss:    ["슬라임 킹","폐허의 리치","철갑 와이번","심연의 기사단장"]
  };

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
      version: 1,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      paused: false,
      location: "town",
      cam: { x: 0, y: 0, shake: 0 },
      player: {
        name: "용사",
        level: 1,
        exp: 0,
        expToNext: 25,
        gold: 80,
        potions: 3,
        // base stats
        hpMaxBase: 70,
        atkBase: 12,
        defBase: 5,
        critBase: 6,
        // runtime
        hp: 70,
        x: 0, y: 0,
        vx: 0, vy: 0,
        speed: 160,          // px/sec
        facing: { x: 1, y: 0 },
        invuln: 0,
        dodgeCd: 0,
        atkCd: 0,
        skillCd: 0,
        streak: 0
      },
      equip: { weapon:null, armor:null, ring:null },
      inv: [],
      entities: [],   // enemies
      drops: [],      // ground items (coins/equip)
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

  // 월드 기준 사이즈(무한처럼 보이게)
  const WORLD = { w: 2400, h: 1400 };

  function resizeCanvas() {
    // 고정 내부 해상도(레티나 고려) + CSS로 꽉 채움
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

  // Mobile Buttons
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

  // ----------------- Entities -----------------
  function spawnEnemies(state) {
    state.entities.length = 0;
    state.drops.length = 0;

    const loc = state.location;
    if (loc === "town") return;

    const count = LOC[loc].spawn;
    const p = state.player;

    for (let i=0;i<count;i++){
      const tier = (loc === "boss") ? "boss" : (loc === "dungeon" ? "elite" : "normal");
      const name = pick(ENEMY_POOL[loc]);
      const lv = Math.max(1, p.level + LOC[loc].diff + rand(-1, 2));
      const mult = (tier==="boss") ? 2.4 : (tier==="elite" ? 1.35 : 1.0);

      const e = {
        id: cryptoId(),
        type: "enemy",
        name,
        tier,
        level: lv,
        x: rand(200, WORLD.w-200),
        y: rand(200, WORLD.h-200),
        r: (tier==="boss") ? 34 : 22,
        hpMax: Math.round((45 + lv*18 + LOC[loc].diff*20) * mult),
        hp: 0,
        atk: Math.round((8 + lv*4 + LOC[loc].diff*5) * mult),
        def: Math.round((2 + lv*2 + LOC[loc].diff*2) * mult),
        speed: (tier==="boss") ? 80 : 95,
        hitCd: 0,
        enraged: false
      };
      e.hp = e.hpMax;
      state.entities.push(e);
    }
    log(`${LOC[loc].name} 진입. 적 ${state.entities.length}마리 출현.`, "dim");
  }

  function dropCoin(state, x, y, amount) {
    state.drops.push({
      id: cryptoId(),
      kind: "coin",
      x, y,
      r: 10,
      amount
    });
  }

  function dropEquip(state, x, y) {
    const slot = pick(ITEM_SLOTS);
    const it = makeItem(slot, state.player.level);
    state.drops.push({
      id: cryptoId(),
      kind: "equip",
      x, y,
      r: 12,
      item: it
    });
    log(`드랍: ${itemLabel(it)}`, "dim");
  }

  // ----------------- Combat Logic (Action) -----------------
  function dealDamage(att, def, base, critChance) {
    let dmg = base;
    const isCrit = (Math.random()*100) < critChance;
    if (isCrit) dmg = Math.round(dmg * 1.65);
    dmg = Math.max(1, dmg - def);
    return { dmg, isCrit };
  }

  function playerAttack(state, mode) {
    const p = state.player;
    if (p.atkCd > 0) return;
    if (state.location === "town") return;

    const der = calcPlayerDerived(state);
    const range = (mode === "skill") ? 120 : 70;
    const arc = (mode === "skill") ? Math.PI * 0.85 : Math.PI * 0.55; // 전방 부채꼴
    const base = (mode === "skill") ? Math.round(der.atk * 1.85) : Math.round(der.atk * 1.05);

    // 쿨타임
    if (mode === "skill") {
      if (p.skillCd > 0) return;
      p.skillCd = 3.2;
      p.atkCd = 0.28;
      cameraShake(state, 7);
      log("스킬 발동!", "dim");
    } else {
      p.atkCd = 0.22;
    }

    // 판정: 전방 부채꼴 + 거리
    const fx = p.facing.x, fy = p.facing.y;
    let hitAny = false;

    for (const e of state.entities) {
      if (e.hp <= 0) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > range + e.r) continue;

      // 각도: facing과 적 방향의 내적
      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);
      const dot = clamp(nx*fx + ny*fy, -1, 1);
      const ang = Math.acos(dot);
      if (ang > arc/2) continue;

      // 맞음
      const { dmg, isCrit } = dealDamage(der.atk, e.def, base + rand(-2, 3), der.crit);
      e.hp = clamp(e.hp - dmg, 0, e.hpMax);
      e.hitCd = 0.08;
      hitAny = true;

      if (mode === "skill") {
        // 넉백
        const k = 0.9;
        e.x += nx * (40 * k);
        e.y += ny * (40 * k);
      }

      if (e.hp <= 0) {
        onEnemyDead(state, e);
      } else if (isCrit) {
        cameraShake(state, 5);
      }
    }

    if (!hitAny) {
      // 헛스윙 감
      // (로그 스팸 방지)
    }
  }

  function onEnemyDead(state, e) {
    const p = state.player;
    const loc = state.location;
    const isBoss = (e.tier === "boss");

    state.stats.kills += 1;
    if (isBoss) state.stats.bosses += 1;
    p.streak += 1;

    const baseGold = 18 + e.level*6 + (e.tier==="elite"? 30:0) + (isBoss? 120:0);
    const gold = Math.round(baseGold * (1 + Math.min(p.streak, 10) * 0.03));
    dropCoin(state, e.x, e.y, gold);

    // 드랍 장비 확률
    const dr = Math.random();
    const dropChance = isBoss ? 0.85 : (e.tier==="elite" ? 0.45 : 0.22);
    if (dr < dropChance) dropEquip(state, e.x + rand(-10,10), e.y + rand(-10,10));

    // EXP
    const exp = Math.round(10 + e.level*5 + (e.tier==="elite"? 18:0) + (isBoss? 70:0));
    gainExp(state, exp);

    log(`처치: ${e.name} (연속 ${p.streak}) +EXP ${exp}`, "dim");

    // 보스는 전부 처치하면 자동 클리어 느낌
    if (loc === "boss") {
      const alive = state.entities.some(x => x.hp > 0);
      if (!alive) {
        log("보스 지역 클리어! 보상이 쏟아진다.", "dim");
        dropCoin(state, p.x, p.y, 350 + p.level*40);
        // 보스 지역은 바로 새 보스 1마리 다시 리스폰
        setTimeout(() => spawnEnemies(state), 250);
      }
    }
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

    // 성장
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
    if (p.hp >= der.hpMax) { log("HP가 이미 가득하다.", "dim"); return; }

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
    // 순간 이동 느낌(현재 입력 방향/정면)
    const ix = currentMoveX(), iy = currentMoveY();
    const dx = (Math.hypot(ix,iy) > 0.01) ? ix : p.facing.x;
    const dy = (Math.hypot(ix,iy) > 0.01) ? iy : p.facing.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx/len, ny = dy/len;
    p.x += nx * 95;
    p.y += ny * 95;
    p.x = clamp(p.x, 40, WORLD.w-40);
    p.y = clamp(p.y, 40, WORLD.h-40);
    cameraShake(state, 4);
  }

  function enemyAI(state, dt) {
    const p = state.player;
    if (state.location === "town") return;

    const der = calcPlayerDerived(state);

    for (const e of state.entities) {
      if (e.hp <= 0) continue;

      // 분노 조건(엘리트/보스)
      if (!e.enraged && (e.tier!=="normal") && (e.hp / e.hpMax <= 0.35)) {
        e.enraged = true;
        log(`${e.name}가 분노했다!`, "dim");
      }

      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;

      // 이동
      const sp = e.speed * (e.enraged ? 1.18 : 1.0);
      const nx = dx / dist;
      const ny = dy / dist;

      // 너무 가까우면 살짝 물러서면서 붙었다/떨어졌다 느낌
      if (dist > (e.r + 34)) {
        e.x += nx * sp * dt;
        e.y += ny * sp * dt;
      } else {
        e.x -= nx * (sp * 0.35) * dt;
        e.y -= ny * (sp * 0.35) * dt;
      }

      e.x = clamp(e.x, 40, WORLD.w-40);
      e.y = clamp(e.y, 40, WORLD.h-40);

      // 공격 (근접)
      if (e.hitCd > 0) e.hitCd -= dt;

      if (dist < (e.r + 34) && e.hitCd <= 0) {
        e.hitCd = e.tier==="boss" ? 0.75 : (e.tier==="elite" ? 0.9 : 1.0);

        if (p.invuln > 0) {
          // 무적 회피
          continue;
        }

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
    setLocation(state, "town");
  }

  // ----------------- Pickup / Drops -----------------
  function pickupNearby(state) {
    const p = state.player;
    let picked = 0;

    for (let i = state.drops.length - 1; i >= 0; i--) {
      const d = state.drops[i];
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist > (d.r + 34)) continue;

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
    if (picked > 0) log(`줍기 완료: ${picked}개`, "dim");
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

  // ----------------- Location -----------------
  function setLocation(state, loc) {
    if (!LOC[loc]) return;
    state.location = loc;
    const p = state.player;
    p.streak = 0;
    p.invuln = 0;
    p.dodgeCd = 0;
    p.atkCd = 0;
    p.skillCd = 0;

    // 위치 초기화
    p.x = WORLD.w/2;
    p.y = WORLD.h/2;

    spawnEnemies(state);
  }

  // ----------------- Camera / Effects -----------------
  function cameraShake(state, strength) {
    state.cam.shake = Math.max(state.cam.shake, strength);
  }

  // ----------------- Rendering -----------------
  function draw(state, dt) {
    const loc = LOC[state.location];
    const p = state.player;
    const der = calcPlayerDerived(state);

    // camera center on player
    const viewW = canvas.getBoundingClientRect().width;
    const viewH = canvas.getBoundingClientRect().height;

    // shake
    if (state.cam.shake > 0) {
      state.cam.shake = Math.max(0, state.cam.shake - dt * 18);
    }
    const sx = (Math.random()-0.5) * state.cam.shake;
    const sy = (Math.random()-0.5) * state.cam.shake;

    const camX = clamp(p.x - viewW/2, 0, WORLD.w - viewW) + sx;
    const camY = clamp(p.y - viewH/2, 0, WORLD.h - viewH) + sy;
    state.cam.x = camX; state.cam.y = camY;

    // background
    ctx.fillStyle = loc.bg;
    ctx.fillRect(0, 0, viewW, viewH);

    // grid + vignette 느낌
    drawGrid(viewW, viewH, camX, camY);
    drawVignette(viewW, viewH);

    // draw drops
    for (const d of state.drops) drawDrop(d, camX, camY);

    // draw enemies
    for (const e of state.entities) if (e.hp > 0) drawEnemy(e, camX, camY);

    // draw player
    drawPlayer(p, der, camX, camY);

    // UI overlays on canvas
    drawTopBars(p, der, loc, viewW);
    if (state.location !== "town") drawHintPickup(viewW, viewH);
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

  function drawTopBars(p, der, loc, w) {
    const hpPct = clamp(p.hp / der.hpMax, 0, 1);
    const expPct = clamp(p.exp / p.expToNext, 0, 1);

    // top panel
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(12, 12, Math.min(520, w-24), 58);
    ctx.globalAlpha = 1;

    // HP bar
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(22, 24, 280, 14);
    ctx.fillStyle = "rgba(46,229,157,0.85)";
    ctx.fillRect(22, 24, 280*hpPct, 14);

    // EXP bar
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(22, 44, 280, 10);
    ctx.fillStyle = "rgba(91,140,255,0.75)";
    ctx.fillRect(22, 44, 280*expPct, 10);

    // text
    ctx.fillStyle = "rgba(233,238,252,0.95)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";
    ctx.fillText(`${loc.name} | Lv.${p.level} | HP ${p.hp}/${der.hpMax} | EXP ${p.exp}/${p.expToNext} | ${p.gold}G | P${p.potions}`, 318, 36);
    ctx.fillText(`ATK ${der.atk} DEF ${der.def} CRIT ${der.crit}%  (J/Space 공격, K 스킬, L/Shift 회피, H 포션, E 줍기)`, 318, 56);
  }

  function drawHintPickup(w, h) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(12, h-40, 240, 28);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(233,238,252,0.9)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";
    ctx.fillText("근처 드랍: E(줍기) / 모바일은 그냥 가까이 가면 자동 줍기", 18, h-22);
  }

  function drawPlayer(p, der, camX, camY) {
    const x = p.x - camX;
    const y = p.y - camY;

    // shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y+18, 18, 8, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // body
    const blink = (p.invuln > 0) ? (Math.sin(Date.now()/60) > 0 ? 0.45 : 1) : 1;
    ctx.globalAlpha = blink;

    ctx.fillStyle = "rgba(91,140,255,0.95)";
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI*2);
    ctx.fill();

    // facing
    ctx.strokeStyle = "rgba(233,238,252,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + p.facing.x*22, y + p.facing.y*22);
    ctx.stroke();

    ctx.globalAlpha = 1;

    // name
    ctx.fillStyle = "rgba(233,238,252,0.9)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";
    ctx.fillText("YOU", x-14, y-28);
  }

  function drawEnemy(e, camX, camY) {
    const x = e.x - camX;
    const y = e.y - camY;

    // shadow
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y+16, e.r*0.9, e.r*0.35, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // body color by tier
    let col = "rgba(255,91,110,0.90)";
    if (e.tier === "elite") col = "rgba(255,207,91,0.90)";
    if (e.tier === "boss") col = "rgba(255,91,110,0.95)";

    // hit flash
    if (e.hitCd > 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(x, y, e.r+6, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, e.r, 0, Math.PI*2);
    ctx.fill();

    // HP bar
    const pct = clamp(e.hp / e.hpMax, 0, 1);
    const bw = e.r*2.2;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x - bw/2, y - e.r - 16, bw, 8);
    ctx.fillStyle = "rgba(46,229,157,0.85)";
    ctx.fillRect(x - bw/2, y - e.r - 16, bw*pct, 8);

    // label
    ctx.fillStyle = "rgba(233,238,252,0.85)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";
    ctx.fillText(`${e.name} Lv.${e.level}${e.enraged ? "!" : ""}`, x - bw/2, y - e.r - 22);
  }

  function drawDrop(d, camX, camY) {
    const x = d.x - camX;
    const y = d.y - camY;

    if (d.kind === "coin") {
      ctx.fillStyle = "rgba(255,207,91,0.92)";
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";
      ctx.fillText("G", x-3, y+4);
    } else {
      ctx.fillStyle = "rgba(91,140,255,0.92)";
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace";
      ctx.fillText("I", x-3, y+4);
    }
  }

  // ----------------- Movement / Update -----------------
  function currentMoveX() {
    let x = 0;
    if (keys.has("a") || keys.has("arrowleft")) x -= 1;
    if (keys.has("d") || keys.has("arrowright")) x += 1;
    // 모바일 조이스틱
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

  function update(state, dt) {
    if (state.paused) return;

    const p = state.player;
    const der = calcPlayerDerived(state);

    // cooldowns
    p.invuln = Math.max(0, p.invuln - dt);
    p.dodgeCd = Math.max(0, p.dodgeCd - dt);
    p.atkCd = Math.max(0, p.atkCd - dt);
    p.skillCd = Math.max(0, p.skillCd - dt);

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

    // actions (from keyboard/touch)
    if (wantAttack) { playerAttack(state, "attack"); wantAttack = false; }
    if (wantSkill)  { playerAttack(state, "skill");  wantSkill = false; }
    if (wantDodge)  { playerDodge(state);           wantDodge = false; }
    if (wantPotion) { playerUsePotion(state);       wantPotion = false; }
    if (wantPickup) { pickupNearby(state);          wantPickup = false; }

    // 모바일: 가까이 가면 자동 줍기(편의)
    if (isTouchDevice()) {
      pickupNearby(state);
    }

    // enemy AI
    enemyAI(state, dt);

    // 연속처치 끊김(너무 오래 전투 안하면)
    // 간단하게: 적이 한 마리도 없으면 스택 유지, 아니면 유지(양산형)
    // => 여기선 따로 끊지 않음

    // HP 바깥 요인으로 max 변경되면 clamp
    p.hp = clamp(p.hp, 0, der.hpMax);
  }

  function isTouchDevice() {
    return matchMedia("(max-width: 980px)").matches;
  }

  // ----------------- Sidebar Render -----------------
  function renderSidebar(state) {
    const p = state.player;
    const der = calcPlayerDerived(state);

    $("hud").textContent = `
지역: ${LOC[state.location].name}
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

    // inv
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
    // top
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

    // location
    $("btnTown").addEventListener("click", () => setLocation(state, "town"));
    $("btnField").addEventListener("click", () => setLocation(state, "field"));
    $("btnDungeon").addEventListener("click", () => setLocation(state, "dungeon"));
    $("btnBoss").addEventListener("click", () => setLocation(state, "boss"));

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

    // mobile buttons (pointerdown으로 딜레이/미작동 방지)
    bindTap("btnAtk", () => wantAttack = true);
    bindTap("btnSkill", () => wantSkill = true);
    bindTap("btnDodge", () => wantDodge = true);
    bindTap("btnPotion", () => wantPotion = true);
  }

  // ----------------- Boot / Loop -----------------
  function init() {
    let state = loadSave();
    if (!state || state.version !== 1) state = freshState();

    // 모바일/PC에서 캔버스 스케일 제대로
    resizeCanvas();
    window.addEventListener("resize", () => { resizeCanvas(); }, { passive:true });

    // 위치가 마을이 아닌데 적이 없으면 리스폰
    if (state.location !== "town" && (!state.entities || state.entities.length === 0)) {
      spawnEnemies(state);
    }
    if (!state.entities) state.entities = [];
    if (!state.drops) state.drops = [];

    bindUI(state);
    renderSidebar(state);
    log("접속 완료. (자동 저장 ON)", "dim");

    let last = performance.now();
    function frame(t) {
      const dt = Math.min(0.033, (t - last) / 1000);
      last = t;

      update(state, dt);
      draw(state, dt);

      // autosave + sidebar refresh (너무 잦지 않게)
      if (!state.paused) {
        if (Math.random() < 0.06) renderSidebar(state);
        if (Math.random() < 0.08) autosave(state);
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // safety periodic save
    setInterval(() => autosave(state), 6000);
  }

  init();
})();
