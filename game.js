(() => {
  "use strict";

  // ============================================================
  // 보스게이트 (BOSS GATE) - Canvas2D 통합 최신본 (안 흔들림 고정)
  //
  // ✅ 핵심 수정:
  // - 게임 논리 해상도(Viewport)를 960x540으로 "완전 고정"
  // - DPR(레티나)만 내부 버퍼에 반영
  // - 카메라/렌더/UI/충돌 모두 960x540 기준 → X 스킬 사용해도 화면 흔들림 없음
  //
  // 자산(없으면 도형/대체 사운드):
  // /assets/bg.png
  // /assets/player_sheet.png
  // /assets/slime_sheet.png
  // /assets/fx_hit.png
  // /assets/bgm.mp3 /assets/sfx_hit.mp3 /assets/sfx_coin.mp3
  // ============================================================

  // -------------------- Canvas --------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  // ✅ 논리 좌표계 고정
  const VIEW_W = 960;
  const VIEW_H = 540;

  // DPR만 반영해서 내부 버퍼 확장(논리좌표는 고정)
  function getDpr() { return Math.max(1, Math.min(2.5, window.devicePixelRatio || 1)); }

  function resize() {
    const dpr = getDpr();
    canvas.width = Math.floor(VIEW_W * dpr);
    canvas.height = Math.floor(VIEW_H * dpr);
    // 논리 좌표계는 960x540로 유지되도록 transform 설정
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  // -------------------- Utils --------------------
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rand = (a, b) => Math.random() * (b - a) + a;
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const isoNow = () => new Date().toISOString();

  // -------------------- Save --------------------
  const SAVE_KEY = "boss_gate_web_v1";
  function save(state) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch {} }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // -------------------- Game States --------------------
  const GS = { MENU:"MENU", OPTIONS:"OPTIONS", PLAY:"PLAY", PAUSE:"PAUSE", INVENTORY:"INVENTORY" };

  // -------------------- Audio --------------------
  class AudioMan {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.bgmGain = null;
      this.sfxGain = null;
      this.unlocked = false;

      this.muted = false;
      this.bgmOn = true;
      this.sfxOn = true;

      this.files = {
        bgm: new Audio("./assets/bgm.mp3"),
        hit: new Audio("./assets/sfx_hit.mp3"),
        coin: new Audio("./assets/sfx_coin.mp3")
      };
      for (const k of Object.keys(this.files)) {
        this.files[k].preload = "auto";
        this.files[k].loop = (k === "bgm");
        this.files[k].volume = 0.6;
      }
    }

    ensureCtx() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.bgmGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.master.gain.value = 0.9;
      this.bgmGain.gain.value = 0.45;
      this.sfxGain.gain.value = 0.75;
    }

    async unlock() {
      if (this.unlocked) return;
      this.ensureCtx();
      try { if (this.ctx && this.ctx.state !== "running") await this.ctx.resume(); } catch {}
      this.unlocked = true;

      // 모바일 오디오 언락 보조
      if (this.ctx) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        g.gain.value = 0.0001;
        o.connect(g); g.connect(this.master);
        o.start(); o.stop(this.ctx.currentTime + 0.02);
      }
    }

    setMuted(v) {
      this.muted = v;
      if (this.master) this.master.gain.value = v ? 0 : 0.9;
      for (const a of Object.values(this.files)) a.muted = v;
    }

    beep(freq, dur, type="square", vol=0.2) {
      if (!this.sfxOn || this.muted) return;
      this.ensureCtx();
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }

    playHit() {
      if (!this.sfxOn || this.muted) return;
      const a = this.files.hit;
      a.currentTime = 0;
      a.play().catch(() => {
        this.beep(220, 0.06, "square", 0.18);
        this.beep(120, 0.08, "triangle", 0.12);
      });
    }

    playCoin() {
      if (!this.sfxOn || this.muted) return;
      const a = this.files.coin;
      a.currentTime = 0;
      a.play().catch(() => {
        this.beep(880, 0.05, "triangle", 0.12);
        this.beep(1320, 0.06, "sine", 0.10);
      });
    }

    startBgm() {
      if (!this.bgmOn || this.muted) return;
      const bgm = this.files.bgm;
      bgm.volume = 0.5;
      bgm.loop = true;
      bgm.play().catch(() => {
        this.ensureCtx();
        if (!this.ctx) return;
        if (this._bgmNode) return;

        const t0 = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "sine";
        g.gain.value = 0.0001;
        o.connect(g); g.connect(this.bgmGain);

        const notes = [220, 277.18, 329.63, 392.0, 329.63, 277.18];
        for (let i=0;i<999;i++){
          const f = notes[i % notes.length] * (i % 12 === 0 ? 0.5 : 1);
          o.frequency.setValueAtTime(f, t0 + i*0.22);
        }
        g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.12);
        o.start(t0);
        this._bgmNode = { o, g };
      });
    }

    stopBgm() {
      const bgm = this.files.bgm;
      bgm.pause(); bgm.currentTime = 0;
      if (this._bgmNode && this.ctx) {
        try { this._bgmNode.o.stop(); } catch {}
        this._bgmNode = null;
      }
    }
  }

  const audio = new AudioMan();
  const unlockOnce = async () => {
    await audio.unlock();
    audio.startBgm();
    window.removeEventListener("pointerdown", unlockOnce);
    window.removeEventListener("keydown", unlockOnce);
  };
  window.addEventListener("pointerdown", unlockOnce, { passive: true });
  window.addEventListener("keydown", unlockOnce, { passive: true });

  // -------------------- Input --------------------
  const keys = new Set();
  const pressed = { jump:false, atk:false, skill:false, menu:false, inv:false };

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();

    // ✅ 키 입력 시 페이지 스크롤/포커스 이동 방지(특히 Space/Arrow)
    if (["arrowleft","arrowright","arrowup"," ","z","x","escape","i","p"].includes(k)) {
      e.preventDefault();
      e.stopPropagation();
    }

    keys.add(k);

    if (k === " " || k === "arrowup") pressed.jump = true;
    if (k === "z") pressed.atk = true;
    if (k === "x") pressed.skill = true;       // ✅ X 스킬
    if (k === "escape" || k === "p") pressed.menu = true; // ✅ 메뉴
    if (k === "i") pressed.inv = true;          // ✅ 인벤
  }, { passive:false });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
  }, { passive:true });

  // 모바일 터치 버튼
  const touch = document.getElementById("touch");
  const touchDown = new Set();
  function setTouchKey(name, down) {
    if (down) touchDown.add(name);
    else touchDown.delete(name);
  }
  if (touch) {
    touch.addEventListener("pointerdown", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const k = t.getAttribute("data-k");
      if (!k) return;
      e.preventDefault();
      t.setPointerCapture(e.pointerId);
      setTouchKey(k, true);
      if (k === "jump") pressed.jump = true;
      if (k === "atk") pressed.atk = true;
      if (k === "skill") pressed.skill = true;
      if (k === "menu") pressed.menu = true;
    }, { passive:false });

    touch.addEventListener("pointerup", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const k = t.getAttribute("data-k");
      if (!k) return;
      e.preventDefault();
      setTouchKey(k, false);
    }, { passive:false });

    touch.addEventListener("pointercancel", () => touchDown.clear(), { passive:true });
  }

  function moveAxis() {
    let x = 0;
    if (keys.has("arrowleft") || keys.has("a")) x -= 1;
    if (keys.has("arrowright") || keys.has("d")) x += 1;
    if (touchDown.has("left")) x -= 1;
    if (touchDown.has("right")) x += 1;
    return clamp(x, -1, 1);
  }

  // -------------------- Pointer (logical coords) --------------------
  // ✅ 화면 크기가 바뀌어도 입력 좌표는 960x540으로 안정적으로 변환
  let pointer = { x:0, y:0, down:false, clicked:false };
  function toLogicalXY(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const lx = (clientX - rect.left) / rect.width * VIEW_W;
    const ly = (clientY - rect.top) / rect.height * VIEW_H;
    return { x: lx, y: ly };
  }
  canvas.addEventListener("pointerdown", (e) => {
    const p = toLogicalXY(e.clientX, e.clientY);
    pointer.x = p.x; pointer.y = p.y;
    pointer.down = true;
    pointer.clicked = true;
  }, { passive:true });
  canvas.addEventListener("pointerup", () => { pointer.down = false; }, { passive:true });
  canvas.addEventListener("pointermove", (e) => {
    const p = toLogicalXY(e.clientX, e.clientY);
    pointer.x = p.x; pointer.y = p.y;
  }, { passive:true });

  function hitBtn(x,y,w,h){
    return pointer.clicked && pointer.x>=x && pointer.x<=x+w && pointer.y>=y && pointer.y<=y+h;
  }

  // -------------------- Assets --------------------
  function loadImage(src) {
    const img = new Image();
    const obj = { img, ok: false };
    img.onload = () => obj.ok = true;
    img.onerror = () => obj.ok = false;
    img.src = src;
    return obj;
  }
  const IMG = {
    player: loadImage("./assets/player_sheet.png"),
    slime:  loadImage("./assets/slime_sheet.png"),
    fxHit:  loadImage("./assets/fx_hit.png"),
    bg:     loadImage("./assets/bg.png"),
  };

  // -------------------- SpriteSheet --------------------
  class SpriteSheet {
    constructor(imageObj, fw, fh, animations) {
      this.imageObj = imageObj;
      this.fw = fw;
      this.fh = fh;
      this.anim = animations;
    }
    draw(name, x, y, t, scale=1, flip=false, alpha=1) {
      const { img, ok } = this.imageObj;
      const a = this.anim[name] || this.anim.idle;
      const frames = Math.max(1, a.frames);
      const idx = a.loop
        ? Math.floor(t * a.fps) % frames
        : Math.min(frames - 1, Math.floor(t * a.fps));
      const sx = idx * this.fw;
      const sy = a.row * this.fh;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      if (flip) ctx.scale(-1, 1);

      if (ok) {
        ctx.drawImage(img, sx, sy, this.fw, this.fh,
          -this.fw*scale/2, -this.fh*scale/2, this.fw*scale, this.fh*scale);
      } else {
        // fallback
        ctx.fillStyle = "rgba(91,140,255,0.95)";
        if (name === "hurt") ctx.fillStyle = "rgba(255,91,110,0.95)";
        if (name === "attack") ctx.fillStyle = "rgba(255,207,91,0.95)";
        ctx.fillRect(-22*scale, -26*scale, 44*scale, 52*scale);
        ctx.fillStyle = "rgba(235,240,255,0.85)";
        ctx.fillRect(6*scale, -6*scale, 10*scale, 6*scale);
      }
      ctx.restore();
    }
  }

  const playerSheet = new SpriteSheet(IMG.player, 64, 64, {
    idle:   { row:0, frames:6, fps:8,  loop:true  },
    run:    { row:1, frames:8, fps:12, loop:true  },
    jump:   { row:2, frames:4, fps:10, loop:false },
    attack: { row:3, frames:6, fps:16, loop:false },
    hurt:   { row:4, frames:4, fps:14, loop:false }
  });

  const slimeSheet = new SpriteSheet(IMG.slime, 64, 64, {
    idle:   { row:0, frames:6, fps:8,  loop:true  },
    run:    { row:1, frames:6, fps:10, loop:true  },
    hurt:   { row:2, frames:4, fps:14, loop:false },
    attack: { row:3, frames:6, fps:14, loop:false },
    die:    { row:4, frames:6, fps:12, loop:false }
  });

  // -------------------- FX --------------------
  class DamageText {
    constructor(x, y, text, color="rgba(235,240,255,0.92)") {
      this.x=x; this.y=y; this.vy=-50;
      this.text=text; this.t=0; this.life=0.8;
      this.color=color;
    }
    update(dt){ this.t+=dt; this.y += this.vy*dt; }
    draw(cam){
      const a = clamp(1 - this.t/this.life, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = this.color;
      ctx.font = "bold 18px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillText(this.text, this.x - cam.x, this.y - cam.y);
      ctx.globalAlpha = 1;
    }
    dead(){ return this.t >= this.life; }
  }

  class Particle {
    constructor(x,y,vx,vy,life, col){
      this.x=x; this.y=y; this.vx=vx; this.vy=vy;
      this.t=0; this.life=life; this.col=col;
    }
    update(dt){
      this.t+=dt;
      this.vy += 520*dt;
      this.x += this.vx*dt;
      this.y += this.vy*dt;
      this.vx *= Math.pow(0.12, dt);
      this.vy *= Math.pow(0.22, dt);
    }
    draw(cam){
      const a = clamp(1 - this.t/this.life, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = this.col;
      ctx.fillRect(this.x - cam.x, this.y - cam.y, 3, 3);
      ctx.globalAlpha = 1;
    }
    dead(){ return this.t >= this.life; }
  }

  class HitSpark {
    constructor(x,y){
      this.x=x; this.y=y; this.t=0; this.life=0.22;
    }
    update(dt){ this.t += dt; }
    draw(cam){
      const a = clamp(1 - this.t/this.life, 0, 1);
      const px = this.x - cam.x, py = this.y - cam.y;
      ctx.save();
      ctx.globalAlpha = a;
      if (IMG.fxHit.ok) {
        const fw=64, fh=64, frames=6;
        const i = Math.min(frames-1, Math.floor((this.t/this.life)*frames));
        ctx.drawImage(IMG.fxHit.img, i*fw, 0, fw, fh, px-32, py-32, 64, 64);
      } else {
        ctx.strokeStyle = "rgba(255,235,120,0.95)";
        ctx.lineWidth = 3;
        const r = 10 + (1-a)*14;
        for(let i=0;i<8;i++){
          const ang = (Math.PI*2)*(i/8);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(ang)*r, py + Math.sin(ang)*r);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(px-2, py-2, 4, 4);
      }
      ctx.restore();
    }
    dead(){ return this.t >= this.life; }
  }

  // -------------------- World/Stage --------------------
  const WORLD = { w: 4200, h: 1200 };
  const GROUND_Y = 860;

  function stageLabel(i){
    const chap = Math.floor((i-1)/10)+1;
    const step = ((i-1)%10)+1;
    return `${chap}-${step}`;
  }
  function isBossStage(i){
    const step = ((i-1)%10)+1;
    return (step % 5 === 0);
  }

  function buildPlatforms(stageIndex){
    const plats = [];
    plats.push({ x: 0, y: GROUND_Y, w: WORLD.w, h: 80 });

    const seed = stageIndex * 1337;
    const rng = (n)=> {
      const s = Math.sin(seed + n*12.9898) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let i=0;i<10;i++){
      const px = 420 + i*320 + randi(-40, 40);
      const py = GROUND_Y - 120 - Math.floor(rng(i)*220);
      plats.push({ x:px, y:py, w: 170 + randi(0, 60), h: 18 });
    }
    plats.push({ x: WORLD.w - 720, y: GROUND_Y - 160, w: 220, h: 18 });
    return plats;
  }

  // -------------------- Items --------------------
  const SLOTS = ["weapon","armor","ring"];
  const RAR = [
    {k:"N",  name:"일반", w:60, opt:0, mult:1.00},
    {k:"R",  name:"희귀", w:28, opt:1, mult:1.20},
    {k:"SR", name:"영웅", w:10, opt:2, mult:1.45},
    {k:"SSR",name:"전설", w: 2, opt:2, mult:1.85},
  ];
  const NAMES = {
    weapon:["나무 검","철검","흑철검","번개의 검","처형자 대검"],
    armor:["헌 옷","가죽 갑옷","사슬 갑옷","강철 갑옷","수호의 판금"],
    ring:["동 반지","은 반지","집중의 반지","파괴의 반지","왕의 반지"]
  };
  const AFFIX = [
    {k:"atk", n:"공격", min:1, max:7, w:22},
    {k:"def", n:"방어", min:1, max:6, w:22},
    {k:"hp",  n:"체력", min:8, max:26, w:18},
    {k:"crit",n:"치명", min:1, max:7, w:10},
    {k:"spd", n:"이속", min:6, max:18, w:10},
    {k:"atkP",n:"공격%",min:2, max:10,w:8},
    {k:"hpP", n:"체력%",min:3, max:12,w:5},
    {k:"ls",  n:"흡혈", min:1, max:4, w:3},
  ];

  function wpick(list){
    const sum = list.reduce((s,x)=>s+x.w,0);
    let r = Math.random()*sum;
    for (const x of list){ r-=x.w; if (r<=0) return x; }
    return list[0];
  }
  function rollRarity(){
    const sum = RAR.reduce((s,x)=>s+x.w,0);
    let r = Math.random()*sum;
    for (const x of RAR){ r-=x.w; if (r<=0) return x; }
    return RAR[0];
  }
  function uuid(){
    if (crypto?.randomUUID) return crypto.randomUUID();
    return "id-"+Math.random().toString(16).slice(2)+Date.now().toString(16);
  }
  function rollAffixes(cnt){
    const used=new Set(); const out=[];
    let tries=0;
    while(out.length<cnt && tries<30){
      tries++;
      const a=wpick(AFFIX);
      if(used.has(a.k)) continue;
      used.add(a.k);
      out.push({k:a.k, n:a.n, v:randi(a.min,a.max)});
    }
    return out;
  }
  function makeItem(slot, level){
    const rar = rollRarity();
    const baseName = pick(NAMES[slot]);
    const ilvl = Math.max(1, level + randi(-1, 2));
    let atk=0,def=0,hp=0,crit=0,spd=0;
    if(slot==="weapon") atk = randi(3,7);
    if(slot==="armor"){ def=randi(2,6); hp=randi(10,22); }
    if(slot==="ring"){ crit=randi(1,4); atk=randi(1,3); spd=randi(0,6); }

    const mult = rar.mult * (1 + (ilvl-1)*0.04);
    const stats = {
      atk: Math.round(atk*mult),
      def: Math.round(def*mult),
      hp:  Math.round(hp*mult),
      crit:Math.round(crit*mult),
      spd: Math.round(spd*mult),
    };

    const identified = (rar.k==="N");
    const hidden = (rar.opt>0) ? rollAffixes(rar.opt) : [];

    return {
      id: uuid(),
      slot,
      name: baseName,
      rar: rar.k,
      rarName: rar.name,
      ilvl,
      enh: 0,
      identified,
      hidden,
      aff: [],
      stats,
      createdAt: isoNow()
    };
  }
  function appraise(it){
    if(it.identified) return false;
    it.identified=true;
    it.aff = it.hidden.slice();
    it.hidden = [];
    return true;
  }
  function itemPow(it){
    let p = it.stats.atk*2 + it.stats.def*2 + it.stats.hp*0.6 + it.stats.crit*1.4 + it.stats.spd*0.5 + it.ilvl*2 + it.enh*6;
    if(it.identified){
      for(const a of it.aff){
        if(a.k==="atk") p+=a.v*3;
        if(a.k==="def") p+=a.v*3;
        if(a.k==="hp")  p+=a.v*0.8;
        if(a.k==="crit")p+=a.v*2;
        if(a.k==="spd") p+=a.v*0.8;
        if(a.k==="atkP")p+=a.v*4;
        if(a.k==="hpP") p+=a.v*3;
        if(a.k==="ls")  p+=a.v*6;
      }
    }
    return Math.round(p);
  }

  // -------------------- Entities --------------------
  function aabb(ax,ay,aw,ah, bx,by,bw,bh){
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  class Player {
    constructor() {
      this.x = 220;
      this.y = 200;
      this.vx = 0;
      this.vy = 0;
      this.w = 42;
      this.h = 54;

      this.face = 1;
      this.onGround = false;

      this.hpBase = 120;
      this.atkBase = 14;
      this.defBase = 6;
      this.critBase = 6;
      this.spdBase = 230;

      this.hp = 120;

      this.atkCd = 0;
      this.skillCd = 0;
      this.inv = 0;

      this.anim = "idle";
      this.animT = 0;

      this.gold = 120;
      this.stage = 1;
      this.kills = 0;

      this.invItems = [ makeItem("weapon",1), makeItem("armor",1), makeItem("ring",1) ];
      this.equip = { weapon:null, armor:null, ring:null };
      this.autoEquipBest();
    }

    derived() {
      let hpMax = this.hpBase;
      let atk = this.atkBase;
      let def = this.defBase;
      let crit = this.critBase;
      let spd = this.spdBase;
      let atkP=0, hpP=0, ls=0;

      for (const s of SLOTS) {
        const it = this.equip[s];
        if (!it) continue;
        atk += it.stats.atk;
        def += it.stats.def;
        hpMax += it.stats.hp;
        crit += it.stats.crit;
        spd += it.stats.spd;

        if (it.identified) {
          for (const a of it.aff) {
            if (a.k==="atk") atk += a.v;
            if (a.k==="def") def += a.v;
            if (a.k==="hp")  hpMax += a.v;
            if (a.k==="crit")crit += a.v;
            if (a.k==="spd") spd += a.v;
            if (a.k==="atkP")atkP += a.v;
            if (a.k==="hpP") hpP += a.v;
            if (a.k==="ls")  ls += a.v;
          }
        }
      }

      atk = Math.round(atk * (1 + atkP/100));
      hpMax = Math.round(hpMax * (1 + hpP/100));
      crit = clamp(crit, 0, 60);
      spd = clamp(spd, 160, 310);
      ls = clamp(ls, 0, 12);

      return { hpMax, atk, def, crit, spd, ls };
    }

    autoEquipBest() {
      for (const slot of SLOTS) {
        const current = this.equip[slot];
        const cand = this.invItems.filter(it => it.slot === slot);
        if (current) cand.push(current);
        if (!cand.length) continue;
        cand.sort((a,b)=>itemPow(b)-itemPow(a));
        const best = cand[0];
        if (current && best.id === current.id) continue;
        if (current) this.invItems.push(current);
        this.invItems = this.invItems.filter(it => it.id !== best.id);
        this.equip[slot] = best;
      }
      const d = this.derived();
      this.hp = clamp(this.hp, 1, d.hpMax);
    }
  }

  class Slime {
    constructor(x,y, tier, stageIndex) {
      this.x=x; this.y=y;
      this.vx=0; this.vy=0;
      this.w=44; this.h=42;
      this.face = -1;
      this.onGround=false;

      this.tier = tier;
      this.hpMax = 55 + stageIndex*18 + (tier==="elite"?80:0) + (tier==="boss"?420:0);
      this.hp = this.hpMax;
      this.atk = 10 + stageIndex*4 + (tier==="elite"?10:0) + (tier==="boss"?26:0);
      this.def = 2 + Math.floor(stageIndex/2) + (tier==="elite"?3:0) + (tier==="boss"?8:0);
      this.spd = (tier==="boss"?150:(tier==="elite"?190:170));

      this.hitCd=0;
      this.aiT=0;

      this.anim="idle";
      this.animT=0;
      this.dead=false;
      this.dieT=0;
    }
  }

  class Coin { constructor(x,y,amount){ this.x=x; this.y=y; this.vx=rand(-40,40); this.vy=rand(-280,-120); this.r=8; this.amount=amount; this.t=0; } }
  class Loot { constructor(x,y,item){ this.x=x; this.y=y; this.vx=rand(-30,30); this.vy=rand(-240,-120); this.r=10; this.item=item; this.t=0; } }

  // -------------------- Camera (shake 없음) --------------------
  const cam = { x:0, y:0 };

  // -------------------- UI helpers --------------------
  function roundRect(x, y, w, h, r, fill, stroke){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }
  function panel(x,y,w,h,title){
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "rgba(10,14,24,0.74)";
    roundRect(x,y,w,h,14,true,false);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    roundRect(x,y,w,h,14,false,true);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(235,240,255,0.92)";
    ctx.font = "bold 18px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(title, x+16, y+30);
    ctx.restore();
  }
  function btn(x,y,w,h,text,hot=false){
    ctx.save();
    ctx.fillStyle = hot ? "rgba(91,140,255,0.22)" : "rgba(255,255,255,0.07)";
    ctx.strokeStyle = hot ? "rgba(91,140,255,0.50)" : "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    roundRect(x,y,w,h,12,true,true);
    ctx.fillStyle = "rgba(235,240,255,0.92)";
    ctx.font = "bold 16px system-ui, -apple-system, Segoe UI";
    const tw = ctx.measureText(text).width;
    ctx.fillText(text, x + (w-tw)/2, y + h/2 + 6);
    ctx.restore();
  }

  // -------------------- State --------------------
  function freshState(){
    const p = new Player();
    return {
      ver: 2,
      game: "보스게이트 (BOSS GATE)",
      createdAt: isoNow(),
      updatedAt: isoNow(),

      gs: GS.MENU,
      opt: { muted:false, bgm:true, sfx:true },

      player: p,
      stageIndex: 1,
      inBossRoom: false,

      platforms: buildPlatforms(1),
      enemies: [],
      coins: [],
      loots: [],

      goalKills: 10,
      killed: 0,

      door: null,
      fx: [],
      dmgText: [],
      parts: [],

      msg: "보스문을 부숴라. (ESC/P: 메뉴, I: 인벤)",
      msgT: 2.2,

      t: 0,
    };
  }

  function applyOptions(state){
    audio.setMuted(!!state.opt.muted);
    audio.bgmOn = !!state.opt.bgm;
    audio.sfxOn = !!state.opt.sfx;
    if (!audio.bgmOn) audio.stopBgm();
    else audio.startBgm();
  }

  function rebuildStage(state){
    const si = state.stageIndex;
    state.platforms = buildPlatforms(si);
    state.enemies = [];
    state.coins = [];
    state.loots = [];
    state.fx = [];
    state.dmgText = [];
    state.parts = [];
    state.door = null;

    state.killed = 0;
    state.goalKills = isBossStage(si) ? 1 : clamp(8 + Math.floor(si*0.7), 8, 18);

    state.player.x = 220;
    state.player.y = 200;
    state.player.vx = 0; state.player.vy = 0;

    if (isBossStage(si)) {
      state.inBossRoom = true;
      const bx = WORLD.w - 760;
      state.enemies.push(new Slime(bx, 200, "boss", si));
      state.msg = `보스게이트 ${stageLabel(si)} — 보스 등장!`;
      state.msgT = 1.6;
    } else {
      state.inBossRoom = false;
      const n = state.goalKills;
      for (let i=0;i<n;i++){
        const ex = 700 + i*260 + randi(-80,80);
        state.enemies.push(new Slime(ex, 200, Math.random()<0.22 ? "elite":"normal", si));
      }
      state.msg = `스테이지 ${stageLabel(si)} 시작! (${state.goalKills}마리 처치)`;
      state.msgT = 1.8;
    }
  }

  function startNew(state){
    const fresh = freshState();
    fresh.opt = state.opt;
    Object.assign(state, fresh);
    rebuildStage(state);
    state.gs = GS.PLAY;
    save(state);
  }

  // -------------------- Combat helpers --------------------
  function rollCrit(crit){ return (Math.random()*100) < crit; }
  function damageCalc(atk, def, critChance, mult=1){
    const c = rollCrit(critChance);
    let dmg = Math.max(1, Math.round(atk*mult) - def);
    if (c) dmg = Math.round(dmg*1.65);
    return { dmg, crit:c };
  }

  function spawnHitFX(state, x, y){
    state.fx.push(new HitSpark(x,y));
    for (let i=0;i<14;i++){
      state.parts.push(new Particle(x,y, rand(-220,220), rand(-260, -40), rand(0.18, 0.35), "rgba(255,235,120,0.95)"));
    }
    audio.playHit();
  }

  function dropRewards(state, e){
    const p = state.player;
    const baseGold = 18 + state.stageIndex*10 + (e.tier==="elite"?40:0) + (e.tier==="boss"?380:0);
    state.coins.push(new Coin(e.x, e.y, baseGold));
    if (Math.random() < (e.tier==="boss" ? 0.95 : e.tier==="elite" ? 0.45 : 0.22)) {
      state.loots.push(new Loot(e.x+rand(-10,10), e.y, makeItem(pick(SLOTS), Math.max(1, Math.floor(state.stageIndex/2)+1))));
    }
  }

  function ensureDoor(state){
    if (state.door) return;
    const x = WORLD.w - 300;
    const y = GROUND_Y - 120;
    const w = 90, h = 120;
    let kind = "next";
    if (state.inBossRoom) kind = "exit";
    state.door = { x, y, w, h, kind };
    state.msg = (kind==="exit") ? "출구 보스문이 열렸다!" : "다음 보스문이 열렸다!";
    state.msgT = 1.4;
  }

  // -------------------- Physics --------------------
  function collidePlatforms(ent, plats){
    ent.onGround = false;

    ent.x += ent.vx;
    for (const p of plats){
      if (aabb(ent.x - ent.w/2, ent.y - ent.h/2, ent.w, ent.h, p.x, p.y, p.w, p.h)){
        if (ent.vx > 0) ent.x = p.x - (ent.w/2);
        else if (ent.vx < 0) ent.x = p.x + p.w + (ent.w/2);
        ent.vx = 0;
      }
    }

    ent.y += ent.vy;
    for (const p of plats){
      if (aabb(ent.x - ent.w/2, ent.y - ent.h/2, ent.w, ent.h, p.x, p.y, p.w, p.h)){
        if (ent.vy > 0) {
          ent.y = p.y - (ent.h/2);
          ent.vy = 0;
          ent.onGround = true;
        } else if (ent.vy < 0) {
          ent.y = p.y + p.h + (ent.h/2);
          ent.vy = 0;
        }
      }
    }

    ent.x = clamp(ent.x, 40, WORLD.w - 40);
    ent.y = clamp(ent.y, 40, WORLD.h - 40);
  }

  // -------------------- Gameplay --------------------
  function updatePlay(state, dt){
    const p = state.player;
    const d = p.derived();

    p.atkCd = Math.max(0, p.atkCd - dt);
    p.skillCd = Math.max(0, p.skillCd - dt);
    p.inv = Math.max(0, p.inv - dt);

    const ax = moveAxis();
    p.vx = ax * d.spd * dt;
    if (ax !== 0) p.face = ax > 0 ? 1 : -1;

    if (pressed.jump && p.onGround) {
      p.vy = -520;
      p.onGround = false;
    }
    pressed.jump = false;

    p.vy += 1200 * dt;
    collidePlatforms(p, state.platforms);

    if (p.inv > 0) p.anim = "hurt";
    else if (!p.onGround) p.anim = "jump";
    else if (Math.abs(ax) > 0.05) p.anim = "run";
    else p.anim = "idle";

    p.animT += dt;
    if (p.anim !== state._prevAnimP) { p.animT = 0; state._prevAnimP = p.anim; }

    // 공격(Z)
    if (pressed.atk && p.atkCd <= 0) {
      p.atkCd = 0.30;
      p.anim = "attack"; p.animT = 0;

      const hx = p.x + p.face * 46;
      const hy = p.y - 10;
      const hw = 72, hh = 52;

      let hit = 0;
      for (const e of state.enemies) {
        if (e.dead) continue;
        if (aabb(hx - hw/2, hy - hh/2, hw, hh, e.x - e.w/2, e.y - e.h/2, e.w, e.h)) {
          const { dmg, crit } = damageCalc(d.atk, e.def, d.crit, 1.05);
          e.hp = clamp(e.hp - dmg, 0, e.hpMax);
          e.hitCd = 0.12;
          hit++;

          spawnHitFX(state, e.x, e.y - 14);
          state.dmgText.push(new DamageText(
            e.x, e.y - 64, `${crit ? "✦" : ""}${dmg}`,
            crit ? "rgba(255,235,120,0.95)" : "rgba(235,240,255,0.92)"
          ));

          if (e.hp <= 0) {
            e.dead = true;
            e.dieT = 0;
            dropRewards(state, e);
            state.killed++;
            p.kills++;
          }
        }
      }
      if (hit === 0) audio.playHit();
    }
    pressed.atk = false;

    // 스킬(X) — 화면 흔들림 없음(논리 해상도 고정이라 카메라 기준 불변)
    if (pressed.skill && p.skillCd <= 0) {
      p.skillCd = 2.8;
      p.atkCd = 0.42;
      p.anim = "attack"; p.animT = 0;

      const hx = p.x + p.face * 78;
      const hy = p.y - 12;
      const hw = 160, hh = 76;

      for (const e of state.enemies) {
        if (e.dead) continue;
        if (aabb(hx - hw/2, hy - hh/2, hw, hh, e.x - e.w/2, e.y - e.h/2, e.w, e.h)) {
          const { dmg, crit } = damageCalc(d.atk, e.def, d.crit, 1.85);
          e.hp = clamp(e.hp - dmg, 0, e.hpMax);
          e.hitCd = 0.16;

          spawnHitFX(state, e.x, e.y - 14);
          state.dmgText.push(new DamageText(
            e.x, e.y - 64, `${crit ? "✦" : ""}${dmg}`,
            "rgba(255,207,91,0.95)"
          ));

          if (e.hp <= 0) {
            e.dead = true;
            e.dieT = 0;
            dropRewards(state, e);
            state.killed++;
            p.kills++;
          }
        }
      }
    }
    pressed.skill = false;

    // 적 AI
    for (const e of state.enemies) {
      if (e.dead) { e.dieT += dt; continue; }
      e.hitCd = Math.max(0, e.hitCd - dt);
      e.aiT += dt;

      const dx = p.x - e.x;
      const ad = Math.abs(dx);
      const chase = ad < 360 || (e.tier==="boss" && ad < 520);
      const dir = dx > 0 ? 1 : -1;
      e.face = dir;

      if (chase) e.vx = dir * e.spd * dt * 0.75;
      else e.vx = Math.sin(e.aiT*1.2) * e.spd * dt * 0.28;

      if (e.onGround && chase && Math.random() < 0.008) e.vy = -420;

      e.vy += 1100 * dt;
      collidePlatforms(e, state.platforms);

      // 충돌 데미지
      if (p.inv <= 0 && aabb(p.x - p.w/2, p.y - p.h/2, p.w, p.h, e.x - e.w/2, e.y - e.h/2, e.w, e.h)) {
        const { dmg } = damageCalc(e.atk, d.def, 0, 1);
        p.hp = clamp(p.hp - dmg, 0, d.hpMax);
        p.inv = 0.45;
        audio.playHit();
        state.dmgText.push(new DamageText(p.x, p.y - 64, `-${dmg}`, "rgba(255,91,110,0.95)"));

        p.vy = -260;
        p.x += -e.face * 36;

        if (p.hp <= 0) {
          const lost = Math.round(p.gold * 0.08);
          p.gold = Math.max(0, p.gold - lost);
          p.hp = d.hpMax;
          state.gs = GS.MENU;
          state.msg = `보스게이트에서 쓰러졌다… ${lost}G 잃음.`;
          state.msgT = 2.0;
          save(state);
          return;
        }
      }

      if (e.dead) e.anim = "die";
      else if (e.hitCd > 0) e.anim = "hurt";
      else if (!e.onGround) e.anim = "run";
      else if (chase) e.anim = "run";
      else e.anim = "idle";

      e.animT += dt;
      if (e.anim !== e._prevAnim) { e.animT = 0; e._prevAnim = e.anim; }
    }

    if (state.killed >= state.goalKills) ensureDoor(state);

    // 코인 줍기
    for (let i=state.coins.length-1;i>=0;i--){
      const c = state.coins[i];
      c.t += dt;
      c.vy += 1100*dt;
      c.x += c.vx*dt;
      c.y += c.vy*dt;
      if (c.y > GROUND_Y - 12) {
        c.y = GROUND_Y - 12;
        c.vy *= -0.22;
        c.vx *= 0.55;
      }
      if (dist(c.x,c.y, p.x, p.y-20) < 38) {
        p.gold += c.amount;
        state.coins.splice(i,1);
        audio.playCoin();
      }
    }

    // 아이템 줍기
    for (let i=state.loots.length-1;i>=0;i--){
      const l = state.loots[i];
      l.t += dt;
      l.vy += 1100*dt;
      l.x += l.vx*dt;
      l.y += l.vy*dt;
      if (l.y > GROUND_Y - 16) {
        l.y = GROUND_Y - 16;
        l.vy *= -0.18;
        l.vx *= 0.45;
      }
      if (dist(l.x,l.y, p.x, p.y-20) < 38) {
        p.invItems.push(l.item);
        state.loots.splice(i,1);
        state.msg = `획득: [${l.item.rar}] ${l.item.name}${l.item.identified?"":"(미감정)"}`;
        state.msgT = 1.5;
      }
    }

    // 문 충돌 → 다음 스테이지
    if (state.door) {
      const d0 = state.door;
      if (aabb(p.x - p.w/2, p.y - p.h/2, p.w, p.h, d0.x, d0.y, d0.w, d0.h)) {
        state.stageIndex += 1;
        state.player.stage = state.stageIndex;
        rebuildStage(state);
        save(state);
      }
    }

    // FX update
    for (const f of state.fx) f.update(dt);
    state.fx = state.fx.filter(x => !x.dead());
    for (const t of state.dmgText) t.update(dt);
    state.dmgText = state.dmgText.filter(x => !x.dead());
    for (const pa of state.parts) pa.update(dt);
    state.parts = state.parts.filter(x => !x.dead());

    if (state.msgT > 0) state.msgT -= dt;

    // ✅ 카메라: VIEW_W / VIEW_H 고정 기준으로만 계산 (절대 흔들림 없음)
    cam.x = clamp(p.x - VIEW_W*0.45, 0, WORLD.w - VIEW_W);
    cam.y = clamp(p.y - VIEW_H*0.60, 0, WORLD.h - VIEW_H);

    // ✅ 인게임 메뉴/인벤
    if (pressed.menu) { pressed.menu = false; state.gs = GS.PAUSE; save(state); return; }
    if (pressed.inv)  { pressed.inv  = false; state.gs = GS.INVENTORY; save(state); return; }
  }

  // -------------------- Render helpers --------------------
  function drawBackground(){
    if (IMG.bg.ok) {
      const img = IMG.bg.img;
      const par = 0.35;
      const bx = - (cam.x * par) % img.width;
      for (let x = bx - img.width; x < VIEW_W + img.width; x += img.width) {
        ctx.drawImage(img, x, 0, img.width, Math.min(VIEW_H, img.height));
      }
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0,0,VIEW_W,VIEW_H);
    } else {
      const g = ctx.createLinearGradient(0,0,0,VIEW_H);
      g.addColorStop(0, "#061021");
      g.addColorStop(1, "#070a14");
      ctx.fillStyle = g;
      ctx.fillRect(0,0,VIEW_W,VIEW_H);
    }
  }

  function drawPlatforms(plats){
    for (const p of plats) {
      const x = p.x - cam.x;
      const y = p.y - cam.y;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x, y, p.w, p.h);
      ctx.fillStyle = "rgba(91,140,255,0.10)";
      ctx.fillRect(x, y, p.w, 3);
    }
  }

  function drawDoor(door){
    const x = door.x - cam.x;
    const y = door.y - cam.y;
    ctx.fillStyle = door.kind==="next" ? "rgba(91,140,255,0.20)" : "rgba(255,91,110,0.22)";
    roundRect(x, y, door.w, door.h, 10, true, false);
    ctx.strokeStyle = door.kind==="next" ? "rgba(91,140,255,0.55)" : "rgba(255,91,110,0.55)";
    ctx.lineWidth = 2;
    roundRect(x, y, door.w, door.h, 10, false, true);
    ctx.fillStyle = "rgba(235,240,255,0.92)";
    ctx.font = "bold 12px ui-monospace, Menlo, Consolas";
    ctx.fillText(door.kind==="next" ? "BOSS GATE" : "EXIT GATE", x+10, y+20);
    ctx.lineWidth = 1;
  }

  function drawCoins(coins){
    for (const c of coins) {
      const x = c.x - cam.x, y = c.y - cam.y;
      ctx.fillStyle = "rgba(255,207,91,0.92)";
      ctx.beginPath(); ctx.arc(x,y,c.r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x-2,y-5,3,3);
    }
  }

  function drawLoot(loots){
    for (const l of loots) {
      const x = l.x - cam.x, y = l.y - cam.y;
      ctx.fillStyle = "rgba(91,140,255,0.92)";
      ctx.beginPath(); ctx.arc(x,y,l.r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(235,240,255,0.60)";
      ctx.fillRect(x-3,y-3,6,6);
    }
  }

  function drawHud(state){
    const p = state.player;
    const d = p.derived();

    ctx.globalAlpha = 0.90;
    ctx.fillStyle = "rgba(10,14,24,0.70)";
    roundRect(14, 14, 740, 78, 14, true, false);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    roundRect(14, 14, 740, 78, 14, false, true);
    ctx.globalAlpha = 1;

    const hpPct = clamp(p.hp / d.hpMax, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(30, 34, 300, 14);
    ctx.fillStyle = "rgba(46,229,157,0.85)";
    ctx.fillRect(30, 34, 300*hpPct, 14);

    const sc = clamp(p.skillCd / 2.8, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(30, 54, 300, 10);
    ctx.fillStyle = "rgba(91,140,255,0.75)";
    ctx.fillRect(30, 54, 300*(1-sc), 10);

    ctx.fillStyle = "rgba(235,240,255,0.92)";
    ctx.font = "bold 12px ui-monospace, Menlo, Consolas";
    ctx.fillText(`BOSS GATE | STAGE ${stageLabel(state.stageIndex)} ${state.inBossRoom ? "(BOSS)" : ""} | KILL ${state.killed}/${state.goalKills}`, 350, 38);
    ctx.fillText(`HP ${p.hp}/${d.hpMax}  ATK ${d.atk} DEF ${d.def} CRIT ${d.crit}%  SPD ${d.spd}`, 350, 56);
    ctx.fillText(`ESC/P: 메뉴  |  I: 인벤  |  Z:공격  X:스킬  Space:점프`, 350, 72);

    if (state.msgT > 0 && state.msg) {
      ctx.globalAlpha = clamp(state.msgT/0.5, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      roundRect(14, 100, 640, 36, 12, true, false);
      ctx.fillStyle = "rgba(235,240,255,0.92)";
      ctx.font = "bold 14px system-ui, -apple-system, Segoe UI";
      ctx.fillText(state.msg, 28, 124);
      ctx.globalAlpha = 1;
    }
  }

  // ✅ 로고 연출
  function drawBossGateLogo(cx, cy, t){
    const flick = 0.6 + 0.4*Math.sin(t*2.6) + (Math.sin(t*17.0)*0.08);
    const glow = 12 + 10*(0.5+0.5*Math.sin(t*3.2));
    const shine = 0.35 + 0.65*(0.5+0.5*Math.sin(t*1.25));

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "900 46px system-ui, -apple-system, Segoe UI";
    ctx.shadowColor = `rgba(91,140,255,${0.55*flick})`;
    ctx.shadowBlur = glow;
    ctx.fillStyle = `rgba(235,240,255,0.92)`;
    ctx.fillText("보스게이트", cx, cy-10);

    ctx.font = "800 16px ui-monospace, Menlo, Consolas";
    ctx.shadowColor = `rgba(255,235,120,${0.35*shine})`;
    ctx.shadowBlur = 10;
    ctx.fillStyle = `rgba(255,235,120,0.85)`;
    ctx.fillText("BOSS GATE", cx, cy+26);

    const w = 520, h = 64;
    const x0 = cx - w/2, y0 = cy - 42;
    const sweepX = x0 + (t*220 % (w+160)) - 80;
    const grad = ctx.createLinearGradient(sweepX, 0, sweepX+120, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, `rgba(255,255,255,${0.25*shine})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");

    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    roundRect(x0, y0, w, h, 12, true, false);

    ctx.restore();
  }

  function drawMenu(state){
    drawBackground();

    const px = VIEW_W*0.5-260, py = VIEW_H*0.5-190;
    panel(px, py, 520, 380, " ");
    drawBossGateLogo(VIEW_W*0.5, VIEW_H*0.5-110, state.t);

    ctx.fillStyle = "rgba(235,240,255,0.75)";
    ctx.font = "14px system-ui, -apple-system, Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("스테이지를 뚫고, 보스문을 부숴라.", VIEW_W*0.5, VIEW_H*0.5-62);
    ctx.textAlign = "left";

    const bx = VIEW_W*0.5-180, by = VIEW_H*0.5-30, bw=360, bh=52;
    const hasSave = !!load();

    btn(bx, by, bw, bh, "새 게임 시작", true);
    btn(bx, by+64, bw, bh, hasSave ? "이어하기" : "이어하기(저장 없음)", hasSave);
    btn(bx, by+128, bw, bh, "옵션");
    btn(bx, by+192, bw, bh, "저장 삭제", false);

    if (hitBtn(bx,by,bw,bh)) startNew(state);

    if (hasSave && hitBtn(bx,by+64,bw,bh)) {
      const s = load();
      if (s) {
        const restored = revive(s);
        Object.assign(state, restored);
        applyOptions(state);
        state.gs = GS.PLAY;
      }
    }

    if (hitBtn(bx,by+128,bw,bh)) state.gs = GS.OPTIONS;

    if (hitBtn(bx,by+192,bw,bh)) {
      localStorage.removeItem(SAVE_KEY);
      state.msg = "저장 삭제 완료.";
      state.msgT = 1.5;
    }

    ctx.fillStyle = "rgba(235,240,255,0.55)";
    ctx.font = "12px ui-monospace, Menlo, Consolas";
    ctx.fillText("모바일: 버튼 조작 / PC: 방향키 + Z/X + Space + ESC/P 메뉴 + I 인벤", VIEW_W*0.5-220, VIEW_H*0.5+210);
  }

  function drawOptions(state){
    drawBackground();
    panel(VIEW_W*0.5-260, VIEW_H*0.5-170, 520, 340, "옵션");

    const bx = VIEW_W*0.5-200, by = VIEW_H*0.5-90, bw=400, bh=52;

    btn(bx, by, bw, bh, `음소거: ${state.opt.muted ? "ON" : "OFF"}`, !state.opt.muted);
    btn(bx, by+64, bw, bh, `BGM: ${state.opt.bgm ? "ON" : "OFF"}`, state.opt.bgm);
    btn(bx, by+128, bw, bh, `SFX: ${state.opt.sfx ? "ON" : "OFF"}`, state.opt.sfx);
    btn(bx, by+212, bw, bh, "뒤로가기", true);

    if (hitBtn(bx,by,bw,bh)) { state.opt.muted = !state.opt.muted; applyOptions(state); save(state); }
    if (hitBtn(bx,by+64,bw,bh)) { state.opt.bgm = !state.opt.bgm; applyOptions(state); save(state); }
    if (hitBtn(bx,by+128,bw,bh)) { state.opt.sfx = !state.opt.sfx; applyOptions(state); save(state); }
    if (hitBtn(bx,by+212,bw,bh)) { state.gs = GS.MENU; }

    ctx.fillStyle = "rgba(235,240,255,0.65)";
    ctx.font = "13px system-ui, -apple-system, Segoe UI";
    ctx.fillText("오디오가 안 나면 화면을 한 번 탭/클릭해서 언락해줘.", VIEW_W*0.5-200, VIEW_H*0.5+70);
  }

  function drawScene(state, dim=false){
    drawBackground();

    drawPlatforms(state.platforms);
    if (state.door) drawDoor(state.door);
    drawCoins(state.coins);
    drawLoot(state.loots);

    for (const e of state.enemies) {
      const x = e.x - cam.x;
      const y = e.y - cam.y;
      const flip = (e.face === -1);
      const name = e.dead ? "die" : e.anim;
      const scale = (e.tier==="boss") ? 1.45 : (e.tier==="elite" ? 1.15 : 1.0);
      slimeSheet.draw(name, x, y-8, e.animT, scale, flip, e.hitCd>0 ? 0.75 : 1);

      if (!e.dead) {
        const pct = clamp(e.hp/e.hpMax, 0,1);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(x-34*scale, y-56*scale, 68*scale, 8);
        ctx.fillStyle = (e.tier==="boss") ? "rgba(255,91,110,0.85)" : "rgba(46,229,157,0.85)";
        ctx.fillRect(x-34*scale, y-56*scale, 68*scale*pct, 8);
      }
    }

    const p = state.player;
    const px = p.x - cam.x;
    const py = p.y - cam.y;
    const flipP = (p.face === -1);
    playerSheet.draw(p.anim, px, py-10, p.animT, 1.15, flipP, p.inv>0 ? 0.65 : 1);

    for (const f of state.fx) f.draw(cam);
    for (const t of state.dmgText) t.draw(cam);
    for (const pa of state.parts) pa.draw(cam);

    if (dim) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0,0,VIEW_W,VIEW_H);
    }

    drawHud(state);
  }

  function drawPause(state){
    drawScene(state, true);

    panel(VIEW_W*0.5-260, VIEW_H*0.5-190, 520, 380, "일시정지 / 메뉴 (BOSS GATE)");

    const bx = VIEW_W*0.5-180, by = VIEW_H*0.5-120, bw=360, bh=52;

    btn(bx, by, bw, bh, "재개", true);
    btn(bx, by+64, bw, bh, "인벤토리", true);
    btn(bx, by+128, bw, bh, "옵션", false);
    btn(bx, by+192, bw, bh, "저장 후 타이틀로", false);
    btn(bx, by+256, bw, bh, "저장 삭제", false);

    const ex = VIEW_W*0.5-180, ey = VIEW_H*0.5+200, ew=360, eh=44;
    btn(ex, ey, ew, eh, "종료(페이지 새로고침)", false);

    if (hitBtn(bx,by,bw,bh)) state.gs = GS.PLAY;
    if (hitBtn(bx,by+64,bw,bh)) state.gs = GS.INVENTORY;
    if (hitBtn(bx,by+128,bw,bh)) state.gs = GS.OPTIONS;

    if (hitBtn(bx,by+192,bw,bh)) {
      save(state);
      state.gs = GS.MENU;
      state.msg = "저장 완료. 타이틀로 이동.";
      state.msgT = 1.5;
    }

    if (hitBtn(bx,by+256,bw,bh)) {
      localStorage.removeItem(SAVE_KEY);
      state.msg = "저장 삭제 완료.";
      state.msgT = 1.5;
    }

    if (hitBtn(ex,ey,ew,eh)) location.reload();

    if (pressed.menu) { pressed.menu = false; state.gs = GS.PLAY; }
  }

  function drawInventory(state){
    drawScene(state, true);

    panel(VIEW_W*0.5-370, VIEW_H*0.5-230, 740, 460, "보스게이트 인벤토리 / 장비(미감정→감정)");

    const p = state.player;
    const d = p.derived();

    ctx.fillStyle = "rgba(235,240,255,0.75)";
    ctx.font = "13px ui-monospace, Menlo, Consolas";
    ctx.fillText(`BOSS GATE | STAGE ${stageLabel(state.stageIndex)} | GOLD ${p.gold}G | HP ${p.hp}/${d.hpMax}`, VIEW_W*0.5-340, VIEW_H*0.5-188);

    const ex = VIEW_W*0.5-340, ey=VIEW_H*0.5-162;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ex, ey, 320, 150, 12, true, false);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    roundRect(ex, ey, 320, 150, 12, false, true);

    ctx.fillStyle = "rgba(235,240,255,0.92)";
    ctx.font = "bold 14px system-ui, -apple-system, Segoe UI";
    ctx.fillText("장착 장비", ex+14, ey+26);

    let lineY = ey+52;
    for (const slot of SLOTS) {
      const it = p.equip[slot];
      const txt = it
        ? `${slot.toUpperCase()}: [${it.rar}] +${it.enh} ${it.name}${it.identified?"":"(미감정)"} (PWR ${itemPow(it)})`
        : `${slot.toUpperCase()}: (없음)`;
      ctx.fillStyle = "rgba(235,240,255,0.78)";
      ctx.font = "12px ui-monospace, Menlo, Consolas";
      ctx.fillText(txt, ex+14, lineY);
      lineY += 22;
    }

    ctx.fillStyle = "rgba(235,240,255,0.60)";
    ctx.font = "12px ui-monospace, Menlo, Consolas";
    ctx.fillText(`ATK ${d.atk} DEF ${d.def} CRIT ${d.crit}% SPD ${d.spd} LS ${d.ls}%`, ex+14, ey+140);

    const ix = VIEW_W*0.5-8, iy=VIEW_H*0.5-162;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ix, iy, 348, 330, 12, true, false);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    roundRect(ix, iy, 348, 330, 12, false, true);

    ctx.fillStyle = "rgba(235,240,255,0.92)";
    ctx.font = "bold 14px system-ui, -apple-system, Segoe UI";
    ctx.fillText(`인벤토리 (${p.invItems.length})`, ix+14, iy+26);

    const list = p.invItems.slice().sort((a,b)=>itemPow(b)-itemPow(a)).slice(0,10);
    let y = iy+54;
    ctx.font = "12px ui-monospace, Menlo, Consolas";
    for (const it of list) {
      const aff = it.identified
        ? (it.aff.length ? it.aff.map(a=>`${a.n}${a.k.endsWith("P")?"%":""}+${a.v}`).join(", ") : "옵션 없음")
        : "옵션 ???";
      const row = `[${it.rar}] ${it.name}${it.identified?"":"(미감정)"} Lv${it.ilvl} PWR ${itemPow(it)} | ${aff}`;
      ctx.fillStyle = "rgba(235,240,255,0.75)";
      ctx.fillText(row.slice(0, 54), ix+14, y);
      y += 22;
    }

    const bx = VIEW_W*0.5-340, by=VIEW_H*0.5+8, bw=160, bh=44;
    btn(bx, by, bw, bh, "자동 장착", true);
    btn(bx+180, by, bw, bh, "감정(미감정)", true);
    btn(bx+360, by, bw, bh, "뽑기(골드)", false);
    btn(bx+540, by, bw, bh, "닫기(I)", true);

    if (hitBtn(bx,by,bw,bh)) {
      p.autoEquipBest();
      state.msg = "자동 장착 완료.";
      state.msgT = 1.2;
      save(state);
    }

    if (hitBtn(bx+180,by,bw,bh)) {
      const targets = p.invItems.filter(it => !it.identified);
      if (!targets.length) { state.msg="미감정 아이템이 없다."; state.msgT=1.2; }
      else {
        let done=0, spent=0;
        for (const it of targets) {
          const cost = 40 + it.ilvl*6 + (it.rar==="SSR"?120:it.rar==="SR"?70:it.rar==="R"?45:0);
          if (p.gold < cost) break;
          p.gold -= cost;
          spent += cost;
          if (appraise(it)) done++;
        }
        state.msg = done>0 ? `감정 ${done}개 완료 (-${spent}G)` : "골드 부족으로 감정 실패.";
        state.msgT = 1.4;
        save(state);
      }
    }

    if (hitBtn(bx+360,by,bw,bh)) {
      const cost = 90 + Math.floor(state.stageIndex*3);
      if (p.gold < cost) { state.msg=`골드 부족(뽑기 ${cost}G)`; state.msgT=1.2; }
      else {
        p.gold -= cost;
        p.invItems.push(makeItem(pick(SLOTS), Math.max(1, Math.floor(state.stageIndex/2)+1)));
        state.msg = `뽑기 완료! (-${cost}G)`;
        state.msgT = 1.2;
        save(state);
      }
    }

    if (hitBtn(bx+540,by,bw,bh)) state.gs = GS.PLAY;

    if (pressed.inv)  { pressed.inv=false; state.gs = GS.PLAY; }
    if (pressed.menu) { pressed.menu=false; state.gs = GS.PAUSE; }
  }

  // -------------------- Revive --------------------
  function revive(raw){
    const st = freshState();
    st.gs = raw.gs || GS.MENU;
    st.opt = raw.opt || st.opt;

    st.player = new Player();
    Object.assign(st.player, raw.player || {});
    st.player.invItems ??= [];
    st.player.equip ??= { weapon:null, armor:null, ring:null };

    st.stageIndex = raw.stageIndex ?? st.stageIndex;
    st.inBossRoom = raw.inBossRoom ?? st.inBossRoom;

    rebuildStage(st);

    st.player.invItems = raw.player?.invItems ?? st.player.invItems;
    st.player.equip = raw.player?.equip ?? st.player.equip;
    for (const s of SLOTS) st.player.equip[s] = st.player.equip[s] || null;

    st.player.gold = raw.player?.gold ?? st.player.gold;
    st.player.hp = raw.player?.hp ?? st.player.hp;

    st.killed = raw.killed ?? 0;
    st.goalKills = raw.goalKills ?? st.goalKills;

    st.msg = raw.msg ?? st.msg;
    st.msgT = raw.msgT ?? 0;

    st.t = 0;
    return st;
  }

  // -------------------- Main Loop --------------------
  let state = load() ? revive(load()) : freshState();
  applyOptions(state);
  if (state.gs === GS.PLAY) rebuildStage(state);

  let last = performance.now();
  function loop(t){
    const dt = Math.min(0.033, (t - last)/1000);
    last = t;

    state.t += dt;

    if (state.gs === GS.PLAY) updatePlay(state, dt);

    state.updatedAt = isoNow();
    if (Math.random() < 0.03) save(state);

    // render
    ctx.clearRect(0,0,VIEW_W,VIEW_H);

    if (state.gs === GS.MENU) drawMenu(state);
    else if (state.gs === GS.OPTIONS) drawOptions(state);
    else if (state.gs === GS.PAUSE) drawPause(state);
    else if (state.gs === GS.INVENTORY) drawInventory(state);
    else drawScene(state);

    pointer.clicked = false;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

})();
