(() => {
  "use strict";


  // -------------------- HUD 설정 --------------------
  // 상단에 떠 있는 '받침대(배경 패널)'을 없애고 싶으면 false로 두면 됩니다.
  // true로 바꾸면 기존처럼 상단 패널(배경)까지 함께 표시됩니다.
  const HUD_BG_PANEL = false;
  // 상단 텍스트를 더 간결하게 표시(지저분한 느낌 줄이기)
  const HUD_COMPACT_TEXT = true;

  // ✅ 우측상단 "⚙(메뉴)" 아이콘을 화면에서 숨기기 (ESC 또는 터치 HUD로 메뉴 가능)
  const HUD_SHOW_GEAR = false;


  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha:false });

  const VIEW_W = 960;
  const VIEW_H = 540;

  function getDpr(){ return Math.max(1, Math.min(2.5, window.devicePixelRatio || 1)); }
  function resize(){
    const dpr = getDpr();
    canvas.width  = Math.floor(VIEW_W * dpr);
    canvas.height = Math.floor(VIEW_H * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.imageSmoothingEnabled = true;
  }
  window.addEventListener("resize", resize, { passive:true });
  resize();

  const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
  const rand  = (a,b)=>Math.random()*(b-a)+a;
  const randi = (a,b)=>Math.floor(rand(a,b+1));
  const pick  = (arr)=>arr[Math.floor(Math.random()*arr.length)];
  const isoNow= ()=>new Date().toISOString();
  const lerp  = (a,b,t)=>a+(b-a)*t;

  // ✅ 기본 동작 방지(모바일 뒤로가기/스크롤/스페이스 등)
  window.addEventListener("keydown",(e)=>{
    const k=e.key.toLowerCase();
    if(["arrowleft","arrowright","arrowup"," ","z","x","escape","i","p","h","enter","backspace"].includes(k)){
      e.preventDefault(); e.stopPropagation();
    }
  },{passive:false});

  // -------------------- Save/Load (수동 저장 전용) --------------------
  const SAVE_KEY = "boss_gate_web_v12_full_fixed"; // 유지(세이브 호환)

  function makeSavePayload(state,gsOverride){
    const p = state.player;
    return {
      ver: state.ver||12,
      createdAt: state.createdAt||isoNow(),
      updatedAt: isoNow(),
      gs: gsOverride || state.gs || "PLAY",
      opt: state.opt || { muted:false, bgm:true, sfx:true },
      stageIndex: state.stageIndex||1,
      inBossRoom: !!state.inBossRoom,
      killed: state.killed||0,
      goalKills: state.goalKills||10,
      player: {
        hp:p.hp,
        hpBase:p.hpBase, atkBase:p.atkBase, defBase:p.defBase, critBase:p.critBase, spdBase:p.spdBase,
        potions:p.potions, gold:p.gold, stage:p.stage||1, kills:p.kills||0,
        appraiseTickets:p.appraiseTickets||0,
        invItems:p.invItems||[],
        equip:p.equip||{weapon:null,chest:null,helm:null,gloves:null,boots:null,ring:null},
      }
    };
  }

  // 세션 저장(로컬스토리지 X): "타이틀로" 갔다가 "재개" 버튼을 살리기 위함
  function sessionSave(state){
    state.sessionSave = makeSavePayload(state, "PLAY");
  }

  function saveGame(state){
    try{
      const payload = makeSavePayload(state, "PLAY");
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      state.msg="저장 완료."; state.msgT=1.4;
      state._dirty=false;
    }catch{
      state.msg="저장 실패(브라우저 저장공간 확인)"; state.msgT=1.6;
    }
  }
  function load(){
    try{
      const raw=localStorage.getItem(SAVE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch{ return null; }
  }
  function markDirty(state){ state._dirty=true; }

  // -------------------- Audio (있으면 쓰고, 없어도 게임 진행) --------------------
  class AudioMan{
    constructor(){
      this.ctx=null; this.master=null; this.bgmGain=null; this.sfxGain=null;
      this.unlocked=false;
      this.muted=false; this.bgmOn=true; this.sfxOn=true;
      this._bases={ bgm:"./assets/bgm", hit:"./assets/sfx_hit", coin:"./assets/sfx_coin" };
      this._exts=[".m4a",".mp3",".mp4"];
      this.files={ bgm:new Audio(), hit:new Audio(), coin:new Audio() };
      this.files.bgm.loop=true;
      for(const k of Object.keys(this.files)){
        const a=this.files[k];
        a.preload="auto";
        a.volume=(k==="bgm")?0.55:0.65;
      }
      this._picked={ bgm:null, hit:null, coin:null };
      this.preResolveAll().catch(()=>{});
    }
    _scoreCanPlay(ext){
      const test=document.createElement("audio");
      const map={ ".mp3":["audio/mpeg"], ".m4a":["audio/mp4","audio/aac"], ".mp4":["audio/mp4","video/mp4"] };
      const mimes=map[ext]||[];
      let best=0;
      for(const m of mimes){
        const r=test.canPlayType(m);
        if(r==="probably") best=Math.max(best,2);
        else if(r==="maybe") best=Math.max(best,1);
      }
      return best;
    }
    _candidateUrls(base){
      const scored=this._exts.map((ext,idx)=>({url:base+ext,score:this._scoreCanPlay(ext),idx}))
        .sort((a,b)=>(b.score-a.score)||(a.idx-b.idx));
      return scored.map(x=>x.url);
    }
    async _exists(url){
      try{ const r=await fetch(url,{method:"HEAD",cache:"no-cache"}); if(r.ok) return true; }catch{}
      try{ const r2=await fetch(url,{method:"GET",cache:"no-cache"}); return r2.ok; }catch{}
      return false;
    }
    async resolve(key){
      if(this._picked[key]) return this._picked[key];
      const base=this._bases[key];
      const urls=this._candidateUrls(base);
      for(const url of urls){
        if(await this._exists(url)){
          this._picked[key]=url;
          this._applySource(key,url);
          return url;
        }
      }
      const fallback=urls[0]||(base+".mp3");
      this._picked[key]=fallback;
      this._applySource(key,fallback);
      return fallback;
    }
    _applySource(key,url){
      const a=this.files[key]; if(!a) return;
      a.src=url; if(key==="bgm") a.loop=true; a.load();
    }
    async preResolveAll(){
      await Promise.all([this.resolve("bgm"),this.resolve("hit"),this.resolve("coin")]);
    }
    ensureCtx(){
      if(this.ctx) return;
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return;
      this.ctx=new AC();
      this.master=this.ctx.createGain();
      this.bgmGain=this.ctx.createGain();
      this.sfxGain=this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.bgmGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.master.gain.value=0.9;
      this.bgmGain.gain.value=0.45;
      this.sfxGain.gain.value=0.75;
    }
    async unlock(){
      if(this.unlocked) return;
      this.ensureCtx();
      try{ if(this.ctx && this.ctx.state!=="running") await this.ctx.resume(); }catch{}
      this.unlocked=true;
      if(this.ctx){
        const o=this.ctx.createOscillator();
        const g=this.ctx.createGain();
        g.gain.value=0.0001;
        o.connect(g); g.connect(this.master);
        o.start(); o.stop(this.ctx.currentTime+0.02);
      }
    }
    setMuted(v){
      this.muted=v;
      if(this.master) this.master.gain.value=v?0:0.9;
      for(const a of Object.values(this.files)) a.muted=v;
    }
    beep(freq,dur,type="square",vol=0.2){
      if(!this.sfxOn||this.muted) return;
      this.ensureCtx(); if(!this.ctx) return;
      const t0=this.ctx.currentTime;
      const o=this.ctx.createOscillator();
      const g=this.ctx.createGain();
      o.type=type;
      o.frequency.setValueAtTime(freq,t0);
      g.gain.setValueAtTime(0.0001,t0);
      g.gain.exponentialRampToValueAtTime(vol,t0+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t0); o.stop(t0+dur+0.02);
    }
    async _safePlay(key,fallbackBeep){
      if(this.muted) return false;
      await this.resolve(key);
      const a=this.files[key];
      try{ a.currentTime=0; await a.play(); return true; }
      catch{
        this._picked[key]=null;
        await this.resolve(key);
        try{ a.currentTime=0; await a.play(); return true; }
        catch{ if(fallbackBeep) fallbackBeep(); return false; }
      }
    }
    async startBgm(){
      if(!this.bgmOn||this.muted) return;
      const ok=await this._safePlay("bgm",()=>{
        this.ensureCtx(); if(!this.ctx) return;
        if(this._bgmNode) return;
        const t0=this.ctx.currentTime;
        const o=this.ctx.createOscillator();
        const g=this.ctx.createGain();
        o.type="sine"; g.gain.value=0.0001;
        o.connect(g); g.connect(this.bgmGain);
        const notes=[220,277.18,329.63,392.0,329.63,277.18];
        for(let i=0;i<999;i++){
          const f=notes[i%notes.length]*(i%12===0?0.5:1);
          o.frequency.setValueAtTime(f,t0+i*0.22);
        }
        g.gain.exponentialRampToValueAtTime(0.12,t0+0.12);
        o.start(t0);
        this._bgmNode={o,g};
      });
      if(ok){
        const bgm=this.files.bgm;
        bgm.loop=true; bgm.volume=0.55;
      }
    }
    stopBgm(){
      const bgm=this.files.bgm;
      try{ bgm.pause(); bgm.currentTime=0; }catch{}
      if(this._bgmNode && this.ctx){
        try{ this._bgmNode.o.stop(); }catch{}
        this._bgmNode=null;
      }
    }
    async playHit(){
      if(!this.sfxOn||this.muted) return;
      await this._safePlay("hit",()=>{
        this.beep(220,0.06,"square",0.18);
        this.beep(120,0.08,"triangle",0.12);
      });
    }
    async playCoin(){
      if(!this.sfxOn||this.muted) return;
      await this._safePlay("coin",()=>{
        this.beep(880,0.05,"triangle",0.12);
        this.beep(1320,0.06,"sine",0.10);
      });
    }
  }

  const audio = new AudioMan();
  const unlockOnce = async ()=>{
    await audio.unlock();
    await audio.startBgm();
    window.removeEventListener("pointerdown", unlockOnce);
    window.removeEventListener("keydown", unlockOnce);
  };
  window.addEventListener("pointerdown", unlockOnce, {passive:true});
  window.addEventListener("keydown", unlockOnce, {passive:true});

  // -------------------- Input --------------------
  const keys = new Set();
  const pressed = { jump:false, atk:false, skill:false, menu:false, inv:false, potion:false };

  window.addEventListener("keydown",(e)=>{
    const k=e.key.toLowerCase();
    keys.add(k);
    if(k===" "||k==="arrowup") pressed.jump=true;
    if(k==="z") pressed.atk=true;
    if(k==="x") pressed.skill=true;
    if(k==="escape"||k==="p") pressed.menu=true;
    if(k==="i") pressed.inv=true;
    if(k==="h") pressed.potion=true;
  },{passive:false});

  window.addEventListener("keyup",(e)=>keys.delete(e.key.toLowerCase()),{passive:true});

  // Touch input
  const touch = document.getElementById("touch");
  const touchDown = new Set();
  function setTouchKey(name,down){ if(down) touchDown.add(name); else touchDown.delete(name); }

  if(touch){
    // ✅ 데스크톱(마우스)에서는 터치 HUD(#touch)를 숨겨서 화면 가림 방지
    const isCoarse = (window.matchMedia && window.matchMedia("(pointer:coarse)").matches) || (navigator.maxTouchPoints>0);
    const isSmall = (window.innerWidth||0) < 900;
    const showTouch = isCoarse || isSmall;
    touch.style.display = showTouch ? "" : "none";
    window.addEventListener("resize", ()=>{
      const _isCoarse = (window.matchMedia && window.matchMedia("(pointer:coarse)").matches) || (navigator.maxTouchPoints>0);
      const _isSmall = (window.innerWidth||0) < 900;
      touch.style.display = (_isCoarse || _isSmall) ? "" : "none";
    }, {passive:true});

    touch.addEventListener("pointerdown",(e)=>{
      const t=e.target;
      if(!(t instanceof HTMLElement)) return;
      const k=t.getAttribute("data-k"); if(!k) return;
      e.preventDefault();
      t.setPointerCapture(e.pointerId);
      setTouchKey(k,true);
      if(k==="jump") pressed.jump=true;
      if(k==="atk") pressed.atk=true;
      if(k==="skill") pressed.skill=true;
      if(k==="menu") pressed.menu=true;
      if(k==="inv") pressed.inv=true;
      if(k==="potion") pressed.potion=true;
    },{passive:false});

    const up = (e)=>{
      const t=e.target;
      if(!(t instanceof HTMLElement)) return;
      const k=t.getAttribute("data-k"); if(!k) return;
      e.preventDefault();
      setTouchKey(k,false);
    };
    touch.addEventListener("pointerup", up, {passive:false});
    touch.addEventListener("pointercancel", ()=>touchDown.clear(), {passive:true});
  }

  function moveAxis(){
    let x=0;
    if(keys.has("arrowleft")||keys.has("a")) x-=1;
    if(keys.has("arrowright")||keys.has("d")) x+=1;
    if(touchDown.has("left")) x-=1;
    if(touchDown.has("right")) x+=1;
    return clamp(x,-1,1);
  }
  function wantAttack(){ return pressed.atk || keys.has("z") || touchDown.has("atk"); }
  function wantSkill(){ return pressed.skill || keys.has("x") || touchDown.has("skill"); }

  // -------------------- Pointer (canvas UI) --------------------
  let pointer = { x:0, y:0, down:false, clicked:false, wheelY:0 };
  function toLogicalXY(cx,cy){
    const rect=canvas.getBoundingClientRect();
    const lx=(cx-rect.left)/rect.width*VIEW_W;
    const ly=(cy-rect.top)/rect.height*VIEW_H;
    return {x:lx,y:ly};
  }
  canvas.addEventListener("pointerdown",(e)=>{
    const p=toLogicalXY(e.clientX,e.clientY);
    pointer.x=p.x; pointer.y=p.y;
    pointer.down=true; pointer.clicked=true;
  },{passive:true});
  canvas.addEventListener("pointerup",()=>{ pointer.down=false; },{passive:true});
  canvas.addEventListener("pointermove",(e)=>{
    const p=toLogicalXY(e.clientX,e.clientY);
    pointer.x=p.x; pointer.y=p.y;
  },{passive:true});
  canvas.addEventListener("wheel",(e)=>{
    e.preventDefault();
    pointer.wheelY += e.deltaY;
  },{passive:false});

  function hitBtn(x,y,w,h){
    return pointer.clicked && pointer.x>=x && pointer.x<=x+w && pointer.y>=y && pointer.y<=y+h;
  }

  // -------------------- Assets --------------------
  function loadImage(src){
    const img=new Image();
    const obj={img,ok:false};
    img.onload=()=>obj.ok=true;
    img.onerror=()=>obj.ok=false;
    img.src=src;
    return obj;
  }
  const IMG={
    player: loadImage("./assets/player_sheet.png"),
    slime:  loadImage("./assets/slime_sheet.png"),
    fxHit:  loadImage("./assets/fx_hit.png"),
    bg:     loadImage("./assets/bg.png"),
  };

  // -------------------- SpriteSheet --------------------
  class SpriteSheet{
    constructor(imageObj,fw,fh,animations){
      this.imageObj=imageObj; this.fw=fw; this.fh=fh; this.anim=animations;
    }
    draw(name,x,y,t,scale=1,flip=false,alpha=1){
      const {img,ok}=this.imageObj;
      const a=this.anim[name]||this.anim.idle;
      const frames=Math.max(1,a.frames);
      const idx=a.loop ? (Math.floor(t*a.fps)%frames) : Math.min(frames-1,Math.floor(t*a.fps));
      const sx=idx*this.fw;
      const sy=a.row*this.fh;

      ctx.save();
      ctx.globalAlpha=alpha;
      ctx.translate(x,y);
      if(flip) ctx.scale(-1,1);

      if(ok){
        ctx.drawImage(img,sx,sy,this.fw,this.fh,-this.fw*scale/2,-this.fh*scale/2,this.fw*scale,this.fh*scale);
      }else{
        ctx.fillStyle="rgba(91,140,255,0.95)";
        if(name==="hurt") ctx.fillStyle="rgba(255,91,110,0.95)";
        if(name==="attack") ctx.fillStyle="rgba(255,207,91,0.95)";
        ctx.fillRect(-22*scale,-26*scale,44*scale,52*scale);
        ctx.fillStyle="rgba(235,240,255,0.85)";
        ctx.fillRect(6*scale,-6*scale,10*scale,6*scale);
      }
      ctx.restore();
    }
  }

  const playerSheet=new SpriteSheet(IMG.player,64,64,{
    idle:{row:0,frames:6,fps:8,loop:true},
    run:{row:1,frames:8,fps:12,loop:true},
    jump:{row:2,frames:4,fps:10,loop:false},
    attack:{row:3,frames:6,fps:16,loop:false},
    hurt:{row:4,frames:4,fps:14,loop:false},
  });

  const slimeSheet=new SpriteSheet(IMG.slime,64,64,{
    idle:{row:0,frames:6,fps:8,loop:true},
    run:{row:1,frames:6,fps:10,loop:true},
    hurt:{row:2,frames:4,fps:14,loop:false},
    attack:{row:3,frames:6,fps:14,loop:false},
    die:{row:4,frames:6,fps:12,loop:false},
  });

  // -------------------- FX --------------------
  class DamageText{
    constructor(x,y,text,color="rgba(235,240,255,0.92)"){
      this.x=x; this.y=y; this.vy=-50;
      this.text=text; this.t=0; this.life=0.8;
      this.color=color;
    }
    update(dt){ this.t+=dt; this.y+=this.vy*dt; }
    draw(cam){
      const a=clamp(1-this.t/this.life,0,1);
      ctx.globalAlpha=a;
      ctx.fillStyle=this.color;
      ctx.font="bold 18px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillText(this.text,this.x-cam.x,this.y-cam.y);
      ctx.globalAlpha=1;
    }
    dead(){ return this.t>=this.life; }
  }
  class Particle{
    constructor(x,y,vx,vy,life,col){
      this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.t=0; this.life=life; this.col=col;
    }
    update(dt){
      this.t+=dt;
      this.vy += 520*dt;
      this.x += this.vx*dt;
      this.y += this.vy*dt;
      this.vx *= Math.pow(0.12,dt);
      this.vy *= Math.pow(0.22,dt);
    }
    draw(cam){
      const a=clamp(1-this.t/this.life,0,1);
      ctx.globalAlpha=a;
      ctx.fillStyle=this.col;
      ctx.fillRect(this.x-cam.x,this.y-cam.y,3,3);
      ctx.globalAlpha=1;
    }
    dead(){ return this.t>=this.life; }
  }
  class HitSpark{
    constructor(x,y){ this.x=x; this.y=y; this.t=0; this.life=0.22; }
    update(dt){ this.t+=dt; }
    draw(cam){
      const a=clamp(1-this.t/this.life,0,1);
      const px=this.x-cam.x, py=this.y-cam.y;
      ctx.save();
      ctx.globalAlpha=a;
      if(IMG.fxHit.ok){
        const fw=64,fh=64,frames=6;
        const i=Math.min(frames-1,Math.floor((this.t/this.life)*frames));
        ctx.drawImage(IMG.fxHit.img,i*fw,0,fw,fh,px-32,py-32,64,64);
      }else{
        ctx.strokeStyle="rgba(255,235,120,0.95)";
        ctx.lineWidth=3;
        const r=10+(1-a)*14;
        for(let i=0;i<8;i++){
          const ang=(Math.PI*2)*(i/8);
          ctx.beginPath(); ctx.moveTo(px,py);
          ctx.lineTo(px+Math.cos(ang)*r,py+Math.sin(ang)*r);
          ctx.stroke();
        }
        ctx.fillStyle="rgba(255,255,255,0.9)";
        ctx.fillRect(px-2,py-2,4,4);
      }
      ctx.restore();
    }
    dead(){ return this.t>=this.life; }
  }

  // ✅ FX/텍스트 잔상 정리(안 지워져서 화면이 지저분해지는 문제 해결)
  function updateEffects(dt,state){
    // HitSpark
    for(let i=state.fx.length-1;i>=0;i--){
      const f=state.fx[i];
      f.update(dt);
      if(f.dead()) state.fx.splice(i,1);
    }
    // DamageText
    for(let i=state.dmgText.length-1;i>=0;i--){
      const t=state.dmgText[i];
      t.update(dt);
      if(t.dead()) state.dmgText.splice(i,1);
    }
    // Particles
    for(let i=state.parts.length-1;i>=0;i--){
      const p=state.parts[i];
      p.update(dt);
      if(p.dead()) state.parts.splice(i,1);
    }
  }

  // -------------------- World --------------------
  const WORLD={ w:4200, h:1200 };
  const GROUND_Y=860;
  const GROUND_SCREEN_Y=VIEW_H-80;
  const CAM_Y=Math.max(0,GROUND_Y-GROUND_SCREEN_Y);

  function stageLabel(i){
    const chap=Math.floor((i-1)/10)+1;
    const step=((i-1)%10)+1;
    return `${chap}-${step}`;
  }
  function isBossStage(i){
    const step=((i-1)%10)+1;
    return (step%5===0);
  }

  function buildPlatforms(stageIndex){
    // ✅ 공중에 떠 있는 발판(플랫폼) 제거: 바닥(지면)만 남김
    const plats=[];
    plats.push({x:0,y:GROUND_Y,w:WORLD.w,h:80});
    return plats;
  }

  // -------------------- Items / Shop / Appraise --------------------
  const SLOTS=["weapon","chest","helm","gloves","boots","ring"];
  const RAR=[
    {k:"N",name:"일반",w:60,opt:0,mult:1.00},
    {k:"R",name:"희귀",w:28,opt:1,mult:1.20},
    {k:"SR",name:"영웅",w:10,opt:2,mult:1.45},
    {k:"SSR",name:"전설",w:2,opt:2,mult:1.85},
  ];
  const NAMES={
    weapon:["나무 검","철검","흑철검","청동 세이버","강철 대검","번개의 검","처형자 대검","흑월도","적룡의 칼날","공명 블레이드"],
    chest:["헌 옷","가죽 갑옷","사슬 갑옷","강철 갑옷","수호의 판금","정찰 조끼","충격 흡수 재킷","강화 섬유복","마력 도포","흑요석 흉갑"],
    helm:["헝겊 두건","가죽 투구","철 투구","강철 헬름","수호의 투구","정찰 헬멧","전술 고글 헬름","룬 각인 두건","흑철 가면","기동 헤드기어"],
    gloves:["낡은 장갑","가죽 장갑","강철 건틀릿","충격 흡수 장갑","정찰 장갑","룬 장갑","암살자 글러브","성기사 장갑","용린 장갑","전술 그립 장갑"],
    boots:["낡은 부츠","가죽 부츠","강철 부츠","기동 부츠","정찰 부츠","룬 부츠","서리 부츠","용린 부츠","성기사 부츠","전술 워커"],
    ring:["동 반지","은 반지","집중의 반지","파괴의 반지","왕의 반지","흡혈의 반지","폭풍의 반지","수호의 반지","연격의 반지","그림자 반지"],
  };
  const AFFIX=[
    {k:"atk",n:"공격",min:1,max:7,w:22},
    {k:"def",n:"방어",min:1,max:6,w:22},
    {k:"hp", n:"체력",min:8,max:26,w:18},
    {k:"crit",n:"치명",min:1,max:7,w:10},
    {k:"spd", n:"이속",min:6,max:18,w:10},
    {k:"atkP",n:"공격%",min:2,max:10,w:8},
    {k:"hpP", n:"체력%",min:3,max:12,w:5},
    {k:"ls",  n:"흡혈",min:1,max:4,w:3},
  ];
  function wpick(list){
    const sum=list.reduce((s,x)=>s+x.w,0);
    let r=Math.random()*sum;
    for(const x of list){ r-=x.w; if(r<=0) return x; }
    return list[0];
  }
  function rollRarity(){
    const sum=RAR.reduce((s,x)=>s+x.w,0);
    let r=Math.random()*sum;
    for(const x of RAR){ r-=x.w; if(r<=0) return x; }
    return RAR[0];
  }
  function uuid(){
    if(crypto?.randomUUID) return crypto.randomUUID();
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
      out.push({k:a.k,n:a.n,v:randi(a.min,a.max)});
    }
    return out;
  }
  function makeItem(slot,level){
    if(slot==="armor") slot="chest";
    const rar=rollRarity();
    const baseName=pick(NAMES[slot]||["이름없는 장비"]);
    const ilvl=Math.max(1,level+randi(-1,2));

    let atk=0,def=0,hp=0,crit=0,spd=0;
    if(slot==="weapon"){ atk=randi(3,7); crit=randi(0,2); }
    if(slot==="chest"){ def=randi(2,7); hp=randi(14,28); }
    if(slot==="helm"){ def=randi(1,5); hp=randi(8,18); crit=randi(0,2); }
    if(slot==="gloves"){ atk=randi(1,4); def=randi(0,3); spd=randi(0,8); }
    if(slot==="boots"){ def=randi(0,3); spd=randi(6,18); }
    if(slot==="ring"){ crit=randi(1,4); atk=randi(1,3); spd=randi(0,6); }

    const mult=rar.mult*(1+(ilvl-1)*0.04);
    const stats={
      atk:Math.round(atk*mult),
      def:Math.round(def*mult),
      hp: Math.round(hp*mult),
      crit:Math.round(crit*mult),
      spd:Math.round(spd*mult),
    };

    const identified=(rar.k==="N");
    const hidden=(rar.opt>0)?rollAffixes(rar.opt):[];

    return {
      id:uuid(), slot, name:baseName,
      rar:rar.k, rarName:rar.name,
      ilvl, enh:0,
      identified, hidden, aff:[],
      stats, createdAt:isoNow()
    };
  }
  function appraise(it){
    if(it.identified) return false;
    it.identified=true;
    it.aff=it.hidden.slice();
    it.hidden=[];
    return true;
  }
  function itemPow(it){
    let p=it.stats.atk*2 + it.stats.def*2 + it.stats.hp*0.6 + it.stats.crit*1.4 + it.stats.spd*0.5 + it.ilvl*2 + it.enh*6;
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
  function sellPrice(it){
    const rarMult=(it.rar==="SSR")?3.2:(it.rar==="SR")?2.2:(it.rar==="R")?1.5:1.0;
    const base=18+it.ilvl*8+Math.floor(itemPow(it)*0.12);
    const idBonus=it.identified?1.15:0.95;
    return Math.max(5,Math.floor(base*rarMult*idBonus));
  }

  const POTION_MAX=12;
  const POTION_HEAL_PCT=0.35;
  const POTION_CD=8.0;

  const POTION_PRICE=60;
  const APPRAISE_PRICE=45;
  const APPRAISE_TICKET_REWARD=1;

  // -------------------- Physics / Combat --------------------
  function aabb(ax,ay,aw,ah,bx,by,bw,bh){
    return ax<bx+bw && ax+aw>bx && ay<by+bh && ay+ah>by;
  }

  const ATTACK_LOCK_ATK=0.18;
  const ATTACK_LOCK_SKL=0.24;
  const CONTACT_DAMAGE_COOLDOWN=0.22;

  const DROP_RATE_NORMAL=0.10;
  const DROP_RATE_ELITE=0.22;
  const DROP_RATE_BOSS=0.70;
  const BOSS_DOUBLE_DROP_RATE=0.22;

  // ✅ 속도 단위를 px/s로 통일(가장 중요한 수정)
  // 이동/충돌에서 x += vx*dt, y += vy*dt 로 변경

  class Player{
    constructor(){
      this.x=220; this.y=200;
      this.vx=0; this.vy=0; // px/s
      this.w=42; this.h=54;
      this.face=1; this.onGround=false;

      this.hpBase=120;
      this.atkBase=14;
      this.defBase=6;
      this.critBase=6;
      this.spdBase=230; // px/s

      this.hp=120;
      this.atkCd=0;
      this.skillCd=0;

      this.inv=0;
      this.hitCd=0;
      this.attackLock=0;

      this.potions=3;
      this.potionCd=0;

      this.gold=120;
      this.stage=1;
      this.kills=0;

      this.appraiseTickets=0;

      this.anim="idle";
      this.animT=0;

      // ✅ 공격 타입 혼동 수정: “이번 스윙이 평타/스킬인지” 고정
      this.swingType=null;        // "atk" | "skill" | null
      this.swingTotal=0;          // 이번 스윙 락 총 길이
      this.swingHitIds=new Set(); // 이번 스윙에서 이미 맞춘 적 id

      this.invItems=[
        makeItem("weapon",1),
        makeItem("chest",1),
        makeItem("helm",1),
        makeItem("gloves",1),
        makeItem("boots",1),
        makeItem("ring",1),
      ];
      this.equip={weapon:null,chest:null,helm:null,gloves:null,boots:null,ring:null};
      this.autoEquipBest();
    }

    derived(){
      let hpMax=this.hpBase, atk=this.atkBase, def=this.defBase, crit=this.critBase, spd=this.spdBase;
      let atkP=0, hpP=0, ls=0;

      for(const s of SLOTS){
        const it=this.equip[s];
        if(!it) continue;

        atk+=it.stats.atk;
        def+=it.stats.def;
        hpMax+=it.stats.hp;
        crit+=it.stats.crit;
        spd+=it.stats.spd;

        if(it.identified){
          for(const a of it.aff){
            if(a.k==="atk") atk+=a.v;
            if(a.k==="def") def+=a.v;
            if(a.k==="hp")  hpMax+=a.v;
            if(a.k==="crit")crit+=a.v;
            if(a.k==="spd") spd+=a.v;
            if(a.k==="atkP")atkP+=a.v;
            if(a.k==="hpP") hpP+=a.v;
            if(a.k==="ls")  ls+=a.v;
          }
        }
      }

      atk=Math.round(atk*(1+atkP/100));
      hpMax=Math.round(hpMax*(1+hpP/100));
      crit=clamp(crit,0,60);
      spd=clamp(spd,160,310);
      ls=clamp(ls,0,12);
      return {hpMax,atk,def,crit,spd,ls};
    }

    autoEquipBest(){
      for(const slot of SLOTS){
        const current=this.equip[slot];
        const cand=this.invItems.filter(it=>it.slot===slot);
        if(current) cand.push(current);
        if(!cand.length) continue;

        cand.sort((a,b)=>itemPow(b)-itemPow(a));
        const best=cand[0];
        if(current && best.id===current.id) continue;
        if(current) this.invItems.push(current);
        this.invItems=this.invItems.filter(it=>it.id!==best.id);
        this.equip[slot]=best;
      }
      const d=this.derived();
      this.hp=clamp(this.hp,1,d.hpMax);
    }
  }

  class Slime{
    constructor(x,y,tier,stageIndex){
      this.id=uuid();
      this.x=x; this.y=y;
      this.vx=0; this.vy=0; // px/s
      this.w=44; this.h=42;
      this.face=-1; this.onGround=false;

      this.tier=tier;
      this.hpMax=55+stageIndex*18+(tier==="elite"?80:0)+(tier==="boss"?420:0);
      this.hp=this.hpMax;
      this.atk=10+stageIndex*4+(tier==="elite"?10:0)+(tier==="boss"?26:0);
      this.def=2+Math.floor(stageIndex/2)+(tier==="elite"?3:0)+(tier==="boss"?8:0);
      this.spd=(tier==="boss"?150:(tier==="elite"?190:170)); // px/s

      this.hitCd=0;
      this.aiT=0;

      this.anim="idle";
      this.animT=0;
      this.dead=false;
      this.dieT=0;

      this.atkCd=0;
      this.attackLock=0;

      // ✅ [추가] 몬스터 공격도 "스윙 1회 타격"과 "활성 프레임"을 갖게 한다
      this.attackTotal = 0;
      this.hitPlayerThisSwing = false;

      // ✅ 몬스터마다 약간의 성격(추적 거리/가속) 차이를 줘서 ‘행렬’ 느낌 완화
      this.bias = rand(-0.12, 0.12);
      this.keepDist = (tier==="boss") ? 90 : (tier==="elite" ? 78 : 72);

      // ✅ 어그로/리시(원위치) 시스템
      //    - 몬스터가 맵 끝에서부터 전부 달려오는 문제 방지
      //    - 플레이어가 앞으로 전진하면서 하나씩 사냥하도록 유도
      //    - "몬스터 인식 범위를 2배"로 늘리고 싶으면 아래 aggroRange 값을 2배로.
      this.aggro = (tier === "boss"); // 보스는 항상 어그로
      this.spawnX = x;                // 원래 위치(리시 기준)
      // ✅ 최근 교전 타이머(맞았거나/때렸으면 일정 시간 리시 무시)
      this.engagedT = 0;
      // ✅ 리시 거리: 너무 짧으면 "도망치면 바로 멈춤" 버그가 생김 → 충분히 크게
      this.leashDist = (tier === "boss") ? 9999 : (tier === "elite" ? 1600 : 1400);

      // ✅ [수정] 인식 범위 2배
      this.aggroRange = ((tier === "boss") ? 260 : (tier === "elite" ? 220 : 200)) * 2;

      this.engageRank = 999;          // 0이 가장 적극적(플레이어 근접/전투)
    }
  }

  class Coin{ constructor(x,y,amount){ this.x=x; this.y=y; this.vx=rand(-40,40); this.vy=rand(-280,-120); this.r=8; this.amount=amount; this.t=0; } }
  class Loot{ constructor(x,y,item){ this.x=x; this.y=y; this.vx=rand(-30,30); this.vy=rand(-240,-120); this.r=10; this.item=item; this.t=0; } }

  const cam={ x:0, y:CAM_Y };

  // -------------------- UI helpers --------------------
  function roundRect(x,y,w,h,r,fill,stroke){
    const rr=Math.min(r,w/2,h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y,x+w,y+h,rr);
    ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);
    ctx.arcTo(x,y,x+w,y,rr);
    ctx.closePath();
    if(fill) ctx.fill();
    if(stroke) ctx.stroke();
  }
  function panel(x,y,w,h,title){
    ctx.save();
    ctx.globalAlpha=0.92;
    ctx.fillStyle="rgba(10,14,24,0.74)";
    roundRect(x,y,w,h,14,true,false);
    ctx.strokeStyle="rgba(255,255,255,0.12)";
    ctx.lineWidth=1;
    roundRect(x,y,w,h,14,false,true);
    ctx.globalAlpha=1;
    ctx.fillStyle="rgba(235,240,255,0.92)";
    ctx.font="bold 18px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(title,x+16,y+30);
    ctx.restore();
  }
  function btn(x,y,w,h,text,hot=false){
    ctx.save();
    ctx.fillStyle=hot?"rgba(91,140,255,0.22)":"rgba(255,255,255,0.07)";
    ctx.strokeStyle=hot?"rgba(91,140,255,0.50)":"rgba(255,255,255,0.14)";
    ctx.lineWidth=1;
    roundRect(x,y,w,h,12,true,true);
    ctx.fillStyle="rgba(235,240,255,0.92)";
    ctx.font="bold 16px system-ui, -apple-system, Segoe UI";
    const tw=ctx.measureText(text).width;
    ctx.fillText(text,x+(w-tw)/2,y+h/2+6);
    ctx.restore();
  }
  function drawIconBtn(x,y,w,h,label,hot=false){
    ctx.save();
    ctx.fillStyle=hot?"rgba(91,140,255,0.22)":"rgba(255,255,255,0.07)";
    ctx.strokeStyle=hot?"rgba(91,140,255,0.55)":"rgba(255,255,255,0.14)";
    roundRect(x,y,w,h,12,true,true);
    ctx.fillStyle="rgba(235,240,255,0.92)";
    ctx.font="900 18px system-ui, -apple-system, Segoe UI";
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.fillText(label,x+w/2,y+h/2+1);
    ctx.restore();
  }
  function rarColor(r){
    if(r==="SSR") return "rgba(255,207,91,0.95)";
    if(r==="SR")  return "rgba(200,140,255,0.95)";
    if(r==="R")   return "rgba(91,140,255,0.95)";
    return "rgba(235,240,255,0.82)";
  }
  function slotName(s){
    return s==="weapon"?"무기"
      : s==="chest"?"흉갑"
      : s==="helm"?"투구"
      : s==="gloves"?"장갑"
      : s==="boots"?"부츠"
      : s==="ring"?"반지"
      : "장비";
  }
  function itemLine(it){
    const idTag=it.identified?"":" (미감정)";
    return `[${it.rar}] ${slotName(it.slot)} | ${it.name}${idTag} | iLv ${it.ilvl} | PWR ${itemPow(it)} | 판매 ${sellPrice(it)}G`;
  }

  const HUD_MENU_BTN   ={ x:14+740+10, y:14,           w:46, h:46 };
  const HUD_POTION_BTN ={ x:14+740+10, y:14+46+8,      w:46, h:46 };
  const HUD_INV_BTN    ={ x:14+740+10, y:14+46+8+46+8, w:46, h:46 };

  // -------------------- Game State --------------------
  function freshState(){
    const p=new Player();
    return {
      ver:12,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      gs:"MENU",
      optionsReturn:"MENU",
      opt:{ muted:false, bgm:true, sfx:true },
      player:p,
      stageIndex:1,
      inBossRoom:false,
      platforms: buildPlatforms(1),
      enemies: [],
      coins: [],
      loots: [],
      goalKills:10,
      killed:0,
      door:null,
      doorHintCd:0,
      dead:false,
      deadT:0,
      fx:[],
      dmgText:[],
      parts:[],
      msg:"보스문을 부숴라. (⚙: 메뉴, 🎒: 인벤, 🧪: 포션)",
      msgT:2.2,
      t:0,
      camX:0,
      invSelId:null,
      invScroll:0,
      shopScroll:0,
      _dirty:false,
      returnGs:"PAUSE",
      // ✅ 타이틀로 나갔을 때 "재개"를 보여주기 위한 세션 플래그
      sessionActive:false,
      // (옵션) 세션 스냅샷(현재는 메뉴 복귀 시 state 자체를 유지하므로 필수는 아님)
      sessionSave:null,
    };
  }

  function applyOptions(state){
    audio.setMuted(!!state.opt.muted);
    audio.bgmOn=!!state.opt.bgm;
    audio.sfxOn=!!state.opt.sfx;
    if(!audio.bgmOn) audio.stopBgm();
    else audio.startBgm();
  }

  function rebuildStage(state){
    const si=state.stageIndex;
    state.platforms=buildPlatforms(si);
    state.enemies=[];
    state.coins=[];
    state.loots=[];
    state.fx=[];
    state.dmgText=[];
    state.parts=[];
    state.door=null;

    state.killed=0;
    state.goalKills=isBossStage(si) ? 1 : clamp(8+Math.floor(si*0.7),8,18);

    state.player.x=220;
    state.player.y=GROUND_Y-120;
    state.player.vx=0; state.player.vy=0;
    state.player.attackLock=0;
    state.player.swingType=null;
    state.player.swingTotal=0;
    state.player.swingHitIds.clear();

    state.camX=0;

    if(isBossStage(si)){
      state.inBossRoom=true;
      const bx=WORLD.w-760;
      state.enemies.push(new Slime(bx,GROUND_Y-120,"boss",si));
      state.msg=`보스게이트 ${stageLabel(si)} — 보스 등장!`;
      state.msgT=1.6;
    }else{
      state.inBossRoom=false;
      const n=state.goalKills;
      for(let i=0;i<n;i++){
        const ex=700+i*260+randi(-80,80);
        state.enemies.push(new Slime(ex,GROUND_Y-120,Math.random()<0.22?"elite":"normal",si));
      }
      state.msg=`스테이지 ${stageLabel(si)} 시작! (${state.goalKills}마리 처치)`;
      state.msgT=1.8;
    }

    // ✅ 게이트는 항상 맵 끝에 표시(잠김 상태).
    //    목표 처치 수(state.killed >= state.goalKills) 달성 시 unlock 됩니다.
    state.door = {
      x: WORLD.w-300,
      y: GROUND_Y-120,
      w: 90, h: 120,
      kind: state.inBossRoom ? "exit" : "next",
      locked: true,
    };

  }

  function startNew(state){
    const opt=state.opt;
    const fresh=freshState();
    fresh.opt=opt;
    Object.assign(state,fresh);
    state.sessionActive=false;
    rebuildStage(state);
    state.gs="PLAY";
    state._dirty=true;
  }

  function revive(saved){
    const state=freshState();
    state.ver = saved.ver||12;
    state.createdAt = saved.createdAt||isoNow();
    state.updatedAt = saved.updatedAt||isoNow();
    state.opt = saved.opt || state.opt;

    state.stageIndex = saved.stageIndex || 1;
    state.inBossRoom = !!saved.inBossRoom;
    state.killed = saved.killed || 0;
    state.goalKills = saved.goalKills || (isBossStage(state.stageIndex)?1:10);

    const p=new Player();
    const sp = saved.player || {};
    p.hpBase = sp.hpBase ?? p.hpBase;
    p.atkBase = sp.atkBase ?? p.atkBase;
    p.defBase = sp.defBase ?? p.defBase;
    p.critBase = sp.critBase ?? p.critBase;
    p.spdBase = sp.spdBase ?? p.spdBase;

    p.potions = sp.potions ?? p.potions;
    p.gold = sp.gold ?? p.gold;
    p.stage = sp.stage ?? p.stage;
    p.kills = sp.kills ?? p.kills;
    p.appraiseTickets = sp.appraiseTickets ?? p.appraiseTickets;

    p.invItems = Array.isArray(sp.invItems) ? sp.invItems : [];
    p.equip = sp.equip || {weapon:null,chest:null,helm:null,gloves:null,boots:null,ring:null};

    p.hp = sp.hp ?? p.hp;
    p.hp = clamp(p.hp, 1, p.derived().hpMax);

    state.player=p;

    // 로드시 현재 스테이지에 맞게 적 다시 생성
    rebuildStage(state);

    state.gs="PLAY";
    state._dirty=false;
    state.msg="불러오기 완료.";
    state.msgT=1.4;
    return state;
  }

  function rollCrit(crit){ return (Math.random()*100)<crit; }
  function damageCalc(atk,def,critChance,mult=1){
    const c=rollCrit(critChance);
    let dmg=Math.max(1,Math.round(atk*mult)-def);
    if(c) dmg=Math.round(dmg*1.65);
    return {dmg,crit:c};
  }

  function spawnHitFX(state,x,y){
    state.fx.push(new HitSpark(x,y));
    for(let i=0;i<14;i++){
      state.parts.push(new Particle(x,y,rand(-220,220),rand(-260,-40),rand(0.18,0.35),"rgba(255,235,120,0.95)"));
    }
    audio.playHit();
  }

  function shouldDropItem(tier){
    if(tier==="boss") return Math.random()<DROP_RATE_BOSS;
    if(tier==="elite") return Math.random()<DROP_RATE_ELITE;
    return Math.random()<DROP_RATE_NORMAL;
  }

  function dropRewards(state,e){
    const baseGold=18+state.stageIndex*10+(e.tier==="elite"?40:0)+(e.tier==="boss"?380:0);
    state.coins.push(new Coin(e.x,e.y,baseGold));

    if(shouldDropItem(e.tier)){
      state.loots.push(new Loot(e.x+rand(-10,10),e.y,makeItem(pick(SLOTS),Math.max(1,Math.floor(state.stageIndex/2)+1))));
      if(e.tier==="boss" && Math.random()<BOSS_DOUBLE_DROP_RATE){
        state.loots.push(new Loot(e.x+rand(-14,14),e.y,makeItem(pick(SLOTS),Math.max(1,Math.floor(state.stageIndex/2)+2))));
      }
    }
    markDirty(state);
  }

  function ensureDoor(state){
    // ✅ 문은 항상 존재(잠김). 여기서는 unlock만 담당한다.
    const x=WORLD.w-300;
    const y=GROUND_Y-120;
    const w=90,h=120;

    if(!state.door){
      state.door={x,y,w,h,kind: state.inBossRoom?"exit":"next", locked:false};
    }else{
      state.door.x=x; state.door.y=y; state.door.w=w; state.door.h=h;
      state.door.kind = state.inBossRoom?"exit":"next";
      state.door.locked = false;
    }

    state.msg=state.inBossRoom ? "출구 게이트가 열렸다!" : "다음 보스게이트가 열렸다!";
    state.msgT=1.4;
  }

  function stageClearReward(state){
    const p=state.player;
    const before=p.potions;

    const addPotion=state.inBossRoom?2:1;
    p.potions=clamp(p.potions+addPotion,0,POTION_MAX);

    const bonusGold=state.inBossRoom?(120+state.stageIndex*18):(40+state.stageIndex*8);
    p.gold += bonusGold;

    p.appraiseTickets += APPRAISE_TICKET_REWARD;

    const got=p.potions-before;
    state.msg=`클리어 보상: +${bonusGold}G ${got>0?`+포션${got}개`:``} +감정권${APPRAISE_TICKET_REWARD}`;
    state.msgT=1.8;
    markDirty(state);
  }

  // -------------------- Death / Respawn --------------------
  function killPlayer(state){
    if(state.dead) return;
    const p=state.player;

    // 사망 페널티(골드 감소) — 원하면 조정 가능
    p.gold = Math.max(0, Math.floor(p.gold*0.85));

    state.dead = true;
    state.deadT = 1.1;

    p.hp = 0;
    p.vx = 0; p.vy = 0;
    p.attackLock = 0;
    p.atkCd = 0;
    p.skillCd = 0;
    p.inv = 0;
    p.hitCd = 0;

    state.msg = "사망… 마을에서 부활합니다.";
    state.msgT = state.deadT;
    markDirty(state);
  }

  function respawnToTown(state){
    const p=state.player;

    // 1스테이지(마을)로 복귀
    state.dead = false;
    state.deadT = 0;
    state.stageIndex = 1;

    rebuildStage(state);

    // HP 회복
    const d=p.derived();
    p.hp = d.hpMax;

    state.msg = "부활했다. (스테이지 1)";
    state.msgT = 1.6;
    markDirty(state);
  }


  // ✅ dt 기반 충돌/이동 (px/s)
  function collidePlatforms(ent,plats,dt){
    ent.onGround=false;

    // X
    ent.x += ent.vx * dt;
    for(const p of plats){
      if(aabb(ent.x-ent.w/2,ent.y-ent.h/2,ent.w,ent.h,p.x,p.y,p.w,p.h)){
        if(ent.vx>0) ent.x=p.x-(ent.w/2);
        else if(ent.vx<0) ent.x=p.x+p.w+(ent.w/2);
        ent.vx=0;
      }
    }

    // Y
    ent.y += ent.vy * dt;
    for(const p of plats){
      if(aabb(ent.x-ent.w/2,ent.y-ent.h/2,ent.w,ent.h,p.x,p.y,p.w,p.h)){
        if(ent.vy>0){
          ent.y=p.y-(ent.h/2);
          ent.vy=0;
          ent.onGround=true;
        }else if(ent.vy<0){
          ent.y=p.y+p.h+(ent.h/2);
          ent.vy=0;
        }
      }
    }

    ent.x=clamp(ent.x,40,WORLD.w-40);
    ent.y=clamp(ent.y,40,WORLD.h-40);
  }

  // ✅ 몬스터끼리 겹쳐서 “줄지어 밀려오는” 느낌을 만드는 문제 해결: 간단 분리
  function separateEnemies(state){
    const arr=state.enemies;
    for(let i=0;i<arr.length;i++){
      const a=arr[i]; if(a.dead) continue;
      for(let j=i+1;j<arr.length;j++){
        const b=arr[j]; if(b.dead) continue;
        const dx=b.x-a.x;
        const dy=b.y-a.y;
        const minX=(a.w+b.w)*0.48;
        const minY=(a.h+b.h)*0.30;
        if(Math.abs(dx)<minX && Math.abs(dy)<minY){
          const push=(minX-Math.abs(dx))*0.5;
          const dir=(dx===0)?(Math.random()<0.5?-1:1):Math.sign(dx);
          a.x -= dir*push;
          b.x += dir*push;
          a.vx *= 0.85;
          b.vx *= 0.85;
        }
      }
    }
  }

  // -------------------- Draw world --------------------
  function drawBackground(){
    if(IMG.bg.ok){
      const img=IMG.bg.img;
      const par=0.35;
      const bx=-(cam.x*par)%img.width;
      for(let x=bx-img.width;x<VIEW_W+img.width;x+=img.width){
        ctx.drawImage(img,x,0,img.width,Math.min(VIEW_H,img.height));
      }
      ctx.fillStyle="rgba(0,0,0,0.25)";
      ctx.fillRect(0,0,VIEW_W,VIEW_H);
    }else{
      const g=ctx.createLinearGradient(0,0,0,VIEW_H);
      g.addColorStop(0,"#061021");
      g.addColorStop(1,"#070a14");
      ctx.fillStyle=g;
      ctx.fillRect(0,0,VIEW_W,VIEW_H);
    }
  }

  function drawPlatforms(plats){
    for(const p of plats){
      const x=p.x-cam.x, y=p.y-cam.y;
      ctx.fillStyle="rgba(255,255,255,0.08)";
      ctx.fillRect(x,y,p.w,p.h);
      ctx.fillStyle="rgba(91,140,255,0.10)";
      ctx.fillRect(x,y,p.w,3);
    }
  }
  function drawDoor(door){
    const x=door.x-cam.x, y=door.y-cam.y;
    const locked = !!door.locked;

    if(locked){
      ctx.fillStyle="rgba(210,215,230,0.10)";
      ctx.strokeStyle="rgba(210,215,230,0.35)";
    }else{
      ctx.fillStyle=door.kind==="next"?"rgba(91,140,255,0.20)":"rgba(255,91,110,0.22)";
      ctx.strokeStyle=door.kind==="next"?"rgba(91,140,255,0.55)":"rgba(255,91,110,0.55)";
    }

    roundRect(x,y,door.w,door.h,10,true,false);
    ctx.lineWidth=2;
    roundRect(x,y,door.w,door.h,10,false,true);

    ctx.fillStyle="rgba(235,240,255,0.92)";
    ctx.font="bold 12px ui-monospace, Menlo, Consolas";

    const title = locked ? "LOCKED" : (door.kind==="next" ? "BOSS GATE" : "EXIT GATE");
    ctx.fillText(title, x+10, y+20);

    if(locked){
      ctx.font="12px ui-monospace, Menlo, Consolas";
      ctx.fillStyle="rgba(235,240,255,0.70)";
      ctx.fillText("KILL TO OPEN", x+10, y+40);
    }

    ctx.lineWidth=1;
  }

  function drawCoins(coins){
    for(const c of coins){
      const x=c.x-cam.x, y=c.y-cam.y;
      ctx.fillStyle="rgba(255,207,91,0.92)";
      ctx.beginPath(); ctx.arc(x,y,c.r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="rgba(255,255,255,0.35)";
      ctx.fillRect(x-2,y-5,3,3);
    }
  }
  function drawLoot(loots){
    for(const l of loots){
      const x=l.x-cam.x, y=l.y-cam.y;
      ctx.fillStyle="rgba(91,140,255,0.92)";
      ctx.beginPath(); ctx.arc(x,y,l.r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="rgba(235,240,255,0.60)";
      ctx.fillRect(x-3,y-3,6,6);
    }
  }

  function tryUsePotion(state){
    const p=state.player;
    const d=p.derived();
    if(p.potionCd>0){ state.msg=`포션 쿨타임 ${p.potionCd.toFixed(1)}s`; state.msgT=0.9; return false; }
    if(p.potions<=0){ state.msg="포션이 없다!"; state.msgT=1.2; return false; }
    if(p.hp>=d.hpMax){ state.msg="HP가 이미 가득하다."; state.msgT=0.9; return false; }

    const heal=Math.max(1,Math.floor(d.hpMax*POTION_HEAL_PCT));
    const before=p.hp;
    p.hp=clamp(p.hp+heal,0,d.hpMax);
    p.potions-=1;
    p.potionCd=POTION_CD;

    audio.playCoin();
    state.dmgText.push(new DamageText(p.x,p.y-72,`+${Math.floor(p.hp-before)}`,"rgba(46,229,157,0.95)"));
    state.msg=`포션 사용! (+${Math.floor(p.hp-before)} HP)`;
    state.msgT=1.1;
    markDirty(state);
    return true;
  }

  // -------------------- HUD --------------------
  function drawHud(state){
    const p=state.player;
    const d=p.derived();

    if(HUD_BG_PANEL){
      ctx.globalAlpha=0.90;
      ctx.fillStyle="rgba(10,14,24,0.70)";
      roundRect(14,14,740,110,14,true,false);
      ctx.strokeStyle="rgba(255,255,255,0.12)";
      roundRect(14,14,740,110,14,false,true);
      ctx.globalAlpha=1;
    }

    const hpPct=clamp(p.hp/d.hpMax,0,1);
    ctx.fillStyle="rgba(255,255,255,0.10)";
    ctx.fillRect(30,34,300,14);
    ctx.fillStyle="rgba(46,229,157,0.85)";
    ctx.fillRect(30,34,300*hpPct,14);

    const sc=clamp(p.skillCd/2.8,0,1);
    ctx.fillStyle="rgba(255,255,255,0.08)";
    ctx.fillRect(30,54,300,10);
    ctx.fillStyle="rgba(91,140,255,0.75)";
    ctx.fillRect(30,54,300*(1-sc),10);

    const pc=clamp(p.potionCd/POTION_CD,0,1);
    ctx.fillStyle="rgba(255,255,255,0.08)";
    ctx.fillRect(30,70,300,10);
    ctx.fillStyle="rgba(255,207,91,0.75)";
    ctx.fillRect(30,70,300*(1-pc),10);

    ctx.fillStyle="rgba(235,240,255,0.92)";
    ctx.font="bold 12px ui-monospace, Menlo, Consolas";
    if(HUD_COMPACT_TEXT){
      ctx.fillText(`STAGE ${stageLabel(state.stageIndex)} ${state.inBossRoom?"BOSS":""} | KILL ${state.killed}/${state.goalKills}`,350,44);
      ctx.fillText(`HP ${Math.floor(p.hp)}/${d.hpMax}  ATK ${d.atk} DEF ${d.def}`,350,64);
      ctx.fillText(`GOLD ${p.gold}G | 🧪 ${p.potions}/${POTION_MAX} | 🎟 ${p.appraiseTickets} ${state._dirty?"| *미저장":""}`,350,84);
    }else{
      ctx.fillText(`BOSS GATE | STAGE ${stageLabel(state.stageIndex)} ${state.inBossRoom?"(BOSS)":""} | KILL ${state.killed}/${state.goalKills}`,350,38);
      ctx.fillText(`HP ${Math.floor(p.hp)}/${d.hpMax}  ATK ${d.atk} DEF ${d.def} CRIT ${d.crit}% SPD ${d.spd}`,350,56);
      ctx.fillText(`GOLD ${p.gold}G | 포션 ${p.potions}/${POTION_MAX} | 감정권 ${p.appraiseTickets} ${state._dirty?"| *미저장":""}`,350,74);
      const hintMenu = HUD_SHOW_GEAR ? "⚙/ESC: 메뉴" : "ESC: 메뉴";
      ctx.fillText(`${hintMenu}  🎒/I: 인벤  H/🧪: 포션`,350,92);
    }

    if(HUD_SHOW_GEAR){
      const hotGear=(pointer.x>=HUD_MENU_BTN.x && pointer.x<=HUD_MENU_BTN.x+HUD_MENU_BTN.w &&
                     pointer.y>=HUD_MENU_BTN.y && pointer.y<=HUD_MENU_BTN.y+HUD_MENU_BTN.h);
      drawIconBtn(HUD_MENU_BTN.x,HUD_MENU_BTN.y,HUD_MENU_BTN.w,HUD_MENU_BTN.h,"⚙",hotGear);
    }

    const hotPot=(pointer.x>=HUD_POTION_BTN.x && pointer.x<=HUD_POTION_BTN.x+HUD_POTION_BTN.w &&
                  pointer.y>=HUD_POTION_BTN.y && pointer.y<=HUD_POTION_BTN.y+HUD_POTION_BTN.h);
    drawIconBtn(HUD_POTION_BTN.x,HUD_POTION_BTN.y,HUD_POTION_BTN.w,HUD_POTION_BTN.h,"🧪",hotPot);

    const hotInv=(pointer.x>=HUD_INV_BTN.x && pointer.x<=HUD_INV_BTN.x+HUD_INV_BTN.w &&
                  pointer.y>=HUD_INV_BTN.y && pointer.y<=HUD_INV_BTN.y+HUD_INV_BTN.h);
    drawIconBtn(HUD_INV_BTN.x,HUD_INV_BTN.y,HUD_INV_BTN.w,HUD_INV_BTN.h,"🎒",hotInv);

    ctx.save();
    ctx.globalAlpha=0.95;
    ctx.fillStyle="rgba(0,0,0,0.35)";
    roundRect(HUD_POTION_BTN.x+26,HUD_POTION_BTN.y+28,20,16,8,true,false);
    ctx.fillStyle="rgba(255,255,255,0.92)";
    ctx.font="bold 11px ui-monospace, Menlo, Consolas";
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(String(state.player.potions),HUD_POTION_BTN.x+36,HUD_POTION_BTN.y+36);
    ctx.restore();

    if(state.msgT>0 && state.msg){
      ctx.globalAlpha=clamp(state.msgT/0.5,0,1);
      ctx.fillStyle="rgba(0,0,0,0.35)";
      roundRect(14,130,920-28,36,12,true,false);
      ctx.fillStyle="rgba(235,240,255,0.92)";
      ctx.font="bold 14px system-ui, -apple-system, Segoe UI";
      ctx.fillText(state.msg,28,154);
      ctx.globalAlpha=1;
    }
  }

  function drawScene(state,dim=false){
    drawBackground();
    drawPlatforms(state.platforms);
    if(state.door) drawDoor(state.door);
    drawCoins(state.coins);
    drawLoot(state.loots);

    for(const e of state.enemies){
      const x=e.x-cam.x, y=e.y-cam.y;
      const flip=(e.face===-1);
      const name=e.dead?"die":e.anim;
      const scale=(e.tier==="boss")?1.45:(e.tier==="elite"?1.15:1.0);
      slimeSheet.draw(name,x,y-8,e.animT,scale,flip,e.hitCd>0?0.75:1);

      if(!e.dead){
        const pct=clamp(e.hp/e.hpMax,0,1);
        ctx.fillStyle="rgba(0,0,0,0.35)";
        ctx.fillRect(x-34*scale,y-56*scale,68*scale,8);
        ctx.fillStyle=(e.tier==="boss")?"rgba(255,91,110,0.85)":"rgba(46,229,157,0.85)";
        ctx.fillRect(x-34*scale,y-56*scale,68*scale*pct,8);
      }
    }

    const p=state.player;
    const px=p.x-cam.x, py=p.y-cam.y;
    playerSheet.draw(p.anim,px,py-10,p.animT,1.15,(p.face===-1),p.inv>0?0.65:1);

    for(const f of state.fx) f.draw(cam);
    for(const t of state.dmgText) t.draw(cam);
    for(const pa of state.parts) pa.draw(cam);

    if(dim){
      ctx.fillStyle="rgba(0,0,0,0.35)";
      ctx.fillRect(0,0,VIEW_W,VIEW_H);
    }
    drawHud(state);
  }

  // -------------------- MENU / OPTIONS / PAUSE --------------------
  function drawMenu(state){
    drawBackground();
    const px=VIEW_W*0.5-260, py=VIEW_H*0.5-210;
    panel(px,py,520,420,"보스게이트");

    ctx.fillStyle="rgba(235,240,255,0.75)";
    ctx.font="14px system-ui, -apple-system, Segoe UI";
    ctx.textAlign="center";
    ctx.fillText("스테이지를 뚫고, 보스문을 부숴라.",VIEW_W*0.5,VIEW_H*0.5-120);
    ctx.textAlign="left";

    const bx=VIEW_W*0.5-180, by=VIEW_H*0.5-88, bw=360, bh=52;
    const hasSave=!!load();
    const canResume=!!state.sessionActive;

    btn(bx,by,bw,bh,"새 게임 시작",true);
    btn(bx,by+64,bw,bh,canResume?"재개(이번 세션)":"재개(세션 없음)",canResume);
    btn(bx,by+128,bw,bh,hasSave?"이어하기(저장)":"이어하기(저장 없음)",hasSave);
    btn(bx,by+192,bw,bh,"옵션");
    btn(bx,by+256,bw,bh,"저장 삭제",false);

    if(hitBtn(bx,by,bw,bh)) startNew(state);

    // ✅ "타이틀로" 갔다 와도 세션 재개 가능
    if(canResume && hitBtn(bx,by+64,bw,bh)){
      state.gs="PLAY";
    }

    if(hasSave && hitBtn(bx,by+128,bw,bh)){
      const s=load();
      if(s){
        const restored=revive(s);
        Object.assign(state,restored);
        state.sessionActive=false; // 저장 이어하기는 세션 플래그 리셋
        applyOptions(state);
        state.gs="PLAY";
      }
    }

    if(hitBtn(bx,by+192,bw,bh)){ state.optionsReturn="MENU"; state.gs="OPTIONS"; }

    if(hitBtn(bx,by+256,bw,bh)){
      localStorage.removeItem(SAVE_KEY);
      state.msg="저장 삭제 완료."; state.msgT=1.5;
    }

    ctx.fillStyle="rgba(235,240,255,0.55)";
    ctx.font="12px ui-monospace, Menlo, Consolas";
    ctx.fillText("모바일: 터치 버튼 / PC: 방향키+Z/X+Space+H+I+ESC",VIEW_W*0.5-240,VIEW_H*0.5+230);
  }

  function drawOptions(state){
    drawBackground();
    panel(VIEW_W*0.5-260,VIEW_H*0.5-170,520,340,"옵션");

    const bx=VIEW_W*0.5-200, by=VIEW_H*0.5-90, bw=400, bh=52;
    const fromPause=(state.optionsReturn==="PAUSE");

    btn(bx,by,bw,bh,`음소거: ${state.opt.muted?"ON":"OFF"}`,!state.opt.muted);
    btn(bx,by+64,bw,bh,`BGM: ${state.opt.bgm?"ON":"OFF"}`,state.opt.bgm);
    btn(bx,by+128,bw,bh,`SFX: ${state.opt.sfx?"ON":"OFF"}`,state.opt.sfx);
    btn(bx,by+212,bw,bh,fromPause?"재개(ESC)":"뒤로가기(ESC)",true);

    if(hitBtn(bx,by,bw,bh)){ state.opt.muted=!state.opt.muted; applyOptions(state); }
    if(hitBtn(bx,by+64,bw,bh)){ state.opt.bgm=!state.opt.bgm; applyOptions(state); }
    if(hitBtn(bx,by+128,bw,bh)){ state.opt.sfx=!state.opt.sfx; applyOptions(state); }

    if(hitBtn(bx,by+212,bw,bh)){ state.gs=fromPause?"PLAY":"MENU"; }

    if(pressed.menu){ pressed.menu=false; state.gs=fromPause?"PLAY":"MENU"; }
  }

  function drawPause(state){
    drawScene(state,true);

    const px=VIEW_W*0.5-260, py=70, pw=520, ph=400;
    panel(px,py,pw,ph,"일시정지 / 메뉴");

    const bx=VIEW_W*0.5-190, by=py+54, bw=380, bh=46, gap=10;

    const items=[
      {t:"재개",hot:true, fn:()=>state.gs="PLAY"},
      {t:"인벤토리(🎒/I)",hot:false, fn:()=>{state.returnGs="PAUSE"; state.gs="INV";}},
      {t:"상점/감정(🏪)",hot:false, fn:()=>{state.returnGs="PAUSE"; state.gs="SHOP";}},
      {t:"옵션",hot:false, fn:()=>{state.optionsReturn="PAUSE"; state.gs="OPTIONS";}},
      {t:`저장(수동) ${state._dirty?"":"(최신)"}`,hot:false, fn:()=>saveGame(state)},
      {t:"타이틀로",hot:false, fn:()=>{
        // ✅ 세션은 유지한 채 타이틀 화면만 보여줌(메뉴에서 "재개" 가능)
        state.sessionActive=true;
        state.gs="MENU";
        state.msg="타이틀로 이동(재개 가능).";
        state.msgT=1.3;
      }},
    ];

    for(let i=0;i<items.length;i++){
      const y=by+i*(bh+gap);
      btn(bx,y,bw,bh,items[i].t,items[i].hot);
      if(hitBtn(bx,y,bw,bh)) items[i].fn();
    }

    ctx.fillStyle="rgba(235,240,255,0.65)";
    ctx.font="12px ui-monospace, Menlo, Consolas";
    ctx.fillText("ESC: 닫기 / I: 인벤 / 저장은 '저장(수동)' 버튼만",bx,py+365);

    if(pressed.menu){ pressed.menu=false; state.gs="PLAY"; }
    if(pressed.inv){ pressed.inv=false; state.returnGs="PAUSE"; state.gs="INV"; }
  }

  // -------------------- Inventory / Shop UI --------------------
  function clampHpAfterEquip(p){
    const d=p.derived();
    p.hp=clamp(p.hp,1,d.hpMax);
  }

  function equipFromBag(state,itemId){
    const p=state.player;
    const idx=p.invItems.findIndex(x=>x.id===itemId);
    if(idx<0) return false;
    const it=p.invItems[idx];
    const slot=it.slot;
    if(!SLOTS.includes(slot)) return false;

    const cur=p.equip[slot];
    if(cur) p.invItems.push(cur);
    p.invItems.splice(idx,1);
    p.equip[slot]=it;

    clampHpAfterEquip(p);
    markDirty(state);
    return true;
  }

  function unequipToBag(state,slot){
    const p=state.player;
    if(!SLOTS.includes(slot)) return false;
    const cur=p.equip[slot];
    if(!cur) return false;
    p.invItems.push(cur);
    p.equip[slot]=null;

    clampHpAfterEquip(p);
    markDirty(state);
    return true;
  }

  function sellItemFromBag(state,itemId){
    const p=state.player;
    const idx=p.invItems.findIndex(x=>x.id===itemId);
    if(idx<0) return false;
    const it=p.invItems[idx];
    const price=sellPrice(it);
    p.gold += price;
    p.invItems.splice(idx,1);
    audio.playCoin();
    state.msg=`판매: ${price}G`; state.msgT=1.2;
    if(state.invSelId===itemId) state.invSelId=null;
    markDirty(state);
    return true;
  }

  function appraiseOne(state,itemId){
    const p=state.player;
    const it = p.invItems.find(x=>x.id===itemId) || Object.values(p.equip).find(x=>x && x.id===itemId);
    if(!it) return false;
    if(it.identified){ state.msg="이미 감정된 아이템."; state.msgT=1.1; return false; }

    if(p.appraiseTickets>0){
      p.appraiseTickets-=1;
      appraise(it);
      audio.playCoin();
      state.msg="감정 완료! (감정권 -1)"; state.msgT=1.4;
      markDirty(state);
      return true;
    }
    if(p.gold<APPRAISE_PRICE){
      state.msg=`골드 부족! (감정 ${APPRAISE_PRICE}G 필요)`; state.msgT=1.4;
      return false;
    }
    p.gold -= APPRAISE_PRICE;
    appraise(it);
    audio.playCoin();
    state.msg=`감정 완료! (-${APPRAISE_PRICE}G)`; state.msgT=1.4;
    markDirty(state);
    return true;
  }

  function drawItemDetail(state,x,y,w,h,it){
    ctx.save();
    ctx.fillStyle="rgba(255,255,255,0.06)";
    ctx.strokeStyle="rgba(255,255,255,0.12)";
    roundRect(x,y,w,h,12,true,true);

    ctx.fillStyle=rarColor(it.rar);
    ctx.font="900 16px system-ui, -apple-system, Segoe UI";
    ctx.fillText(`[${it.rar}] ${it.name} ${it.identified?"":"(미감정)"}`,x+14,y+28);

    ctx.fillStyle="rgba(235,240,255,0.80)";
    ctx.font="12px ui-monospace, Menlo, Consolas";
    ctx.fillText(`${slotName(it.slot)} | iLv ${it.ilvl} | PWR ${itemPow(it)} | 판매 ${sellPrice(it)}G`,x+14,y+48);

    const baseY=y+72;
    ctx.fillStyle="rgba(235,240,255,0.86)";
    ctx.font="bold 13px ui-monospace, Menlo, Consolas";
    ctx.fillText(`기본: ATK ${it.stats.atk} DEF ${it.stats.def} HP ${it.stats.hp} CRIT ${it.stats.crit}% SPD ${it.stats.spd}`,x+14,baseY);

    ctx.fillStyle="rgba(235,240,255,0.72)";
    ctx.font="12px ui-monospace, Menlo, Consolas";
    let yy=baseY+20;

    if(!it.identified){
      ctx.fillStyle="rgba(255,207,91,0.88)";
      ctx.fillText("잠재 옵션: ??? (감정 필요)",x+14,yy);
      yy+=18;
    }else if(it.aff && it.aff.length){
      ctx.fillStyle="rgba(91,140,255,0.85)";
      ctx.fillText("추가 옵션:",x+14,yy); yy+=18;
      ctx.fillStyle="rgba(235,240,255,0.75)";
      for(const a of it.aff){
        const suf=(a.k.endsWith("P")||a.k==="crit"||a.k==="ls")?"%":"";
        ctx.fillText(`- ${a.n} +${a.v}${suf}`,x+24,yy);
        yy+=16;
      }
    }else{
      ctx.fillStyle="rgba(235,240,255,0.55)";
      ctx.fillText("추가 옵션 없음",x+14,yy);
      yy+=18;
    }
    ctx.restore();
  }

  function drawInventory(state){
    drawScene(state,true);

    const x=60,y=50,w=840,h=440;
    panel(x,y,w,h,"인벤토리");

    const p=state.player;

    // 좌: 장착 / 우: 가방
    ctx.fillStyle="rgba(235,240,255,0.80)";
    ctx.font="bold 13px ui-monospace, Menlo, Consolas";
    ctx.fillText("장착", x+18, y+62);
    ctx.fillText(`가방 (${p.invItems.length})`, x+420, y+62);

    // 장착 리스트
    const ex=x+18, ey=y+78;
    const rowH=34;
    for(let i=0;i<SLOTS.length;i++){
      const slot=SLOTS[i];
      const it=p.equip[slot];
      const yy=ey+i*rowH;
      const line=it ? itemLine(it) : `[ ] ${slotName(slot)} | (비어있음)`;
      const hot = pointer.x>=ex && pointer.x<=ex+380 && pointer.y>=yy-18 && pointer.y<=yy+10;
      ctx.fillStyle=hot?"rgba(91,140,255,0.18)":"rgba(255,255,255,0.06)";
      roundRect(ex,yy-22,380,28,10,true,false);
      ctx.fillStyle="rgba(235,240,255,0.88)";
      ctx.font="12px ui-monospace, Menlo, Consolas";
      ctx.fillText(line, ex+10, yy-2);

      if(hitBtn(ex,yy-22,380,28) && it){
        state.invSelId=it.id;
      }
    }

    // 가방 리스트 (스크롤)
    const bx=x+420, by=y+78;
    const listH=280;
    const visRows=Math.floor(listH/rowH);
    const maxScroll=Math.max(0, p.invItems.length - visRows);
    if(pointer.wheelY!==0){
      state.invScroll = clamp(state.invScroll + Math.sign(pointer.wheelY)*1, 0, maxScroll);
      pointer.wheelY=0;
    }

    for(let i=0;i<visRows;i++){
      const idx=i+state.invScroll;
      const it=p.invItems[idx];
      if(!it) break;
      const yy=by+i*rowH;
      const hot = pointer.x>=bx && pointer.x<=bx+400 && pointer.y>=yy-18 && pointer.y<=yy+10;
      const selected = (state.invSelId===it.id);
      ctx.fillStyle=selected ? "rgba(91,140,255,0.22)" : (hot?"rgba(91,140,255,0.12)":"rgba(255,255,255,0.06)");
      roundRect(bx,yy-22,400,28,10,true,false);
      ctx.fillStyle=rarColor(it.rar);
      ctx.font="12px ui-monospace, Menlo, Consolas";
      ctx.fillText(itemLine(it), bx+10, yy-2);

      if(hitBtn(bx,yy-22,400,28)){
        state.invSelId=it.id;
      }
    }

    const sel = p.invItems.find(it=>it.id===state.invSelId) || Object.values(p.equip).find(it=>it && it.id===state.invSelId) || null;
    if(sel){
      drawItemDetail(state, x+18, y+320, 802, 120, sel);

      const bY=y+450-44;
      const bW=190, bH=38;
      const b1X=x+18;
      const b2X=x+18+bW+12;
      const b3X=x+18+(bW+12)*2;
      const b4X=x+18+(bW+12)*3;

      const inBag = p.invItems.some(it=>it.id===sel.id);
      const slot = sel.slot;

      btn(b1X,bY,bW,bH, inBag?"장착":"해제", true);
      btn(b2X,bY,bW,bH, "감정", false);
      btn(b3X,bY,bW,bH, inBag?`판매(+${sellPrice(sel)}G)`:"(판매는 가방만)", false);
      btn(b4X,bY,bW,bH, "닫기(ESC)", false);

      if(hitBtn(b1X,bY,bW,bH)){
        if(inBag) equipFromBag(state, sel.id);
        else unequipToBag(state, slot);
      }
      if(hitBtn(b2X,bY,bW,bH)){
        appraiseOne(state, sel.id);
      }
      if(hitBtn(b3X,bY,bW,bH) && inBag){
        sellItemFromBag(state, sel.id);
      }
      if(hitBtn(b4X,bY,bW,bH)){
        state.gs = state.returnGs || "PAUSE";
      }
    }else{
      ctx.fillStyle="rgba(235,240,255,0.55)";
      ctx.font="12px ui-monospace, Menlo, Consolas";
      ctx.fillText("아이템을 클릭하면 상세/장착/감정/판매가 뜹니다.", x+18, y+338);
      btn(x+18, y+450-44, 802, 38, "닫기(ESC)", true);
      if(hitBtn(x+18, y+450-44, 802, 38)) state.gs = state.returnGs || "PAUSE";
    }

    if(pressed.menu){ pressed.menu=false; state.gs = state.returnGs || "PAUSE"; }
    if(pressed.inv){ pressed.inv=false; state.gs = state.returnGs || "PAUSE"; }
  }

  function drawShop(state){
    drawScene(state,true);

    const x=120,y=80,w=720,h=380;
    panel(x,y,w,h,"상점 / 감정");

    const p=state.player;

    ctx.fillStyle="rgba(235,240,255,0.80)";
    ctx.font="12px ui-monospace, Menlo, Consolas";
    ctx.fillText(`보유 골드: ${p.gold}G   |   포션: ${p.potions}/${POTION_MAX}   |   감정권: ${p.appraiseTickets}`, x+18, y+60);

    const bY=y+92;
    btn(x+18,bY,320,52,`포션 구매 (+1) -${POTION_PRICE}G`, true);
    btn(x+18,bY+64,320,52,`감정 서비스 -${APPRAISE_PRICE}G (또는 감정권)`, false);
    btn(x+18,bY+128,320,52,`가방 정리: "최강 자동장착"`, false);
    btn(x+18,bY+192,320,52,`닫기(ESC)`, false);

    if(hitBtn(x+18,bY,320,52)){
      if(p.potions>=POTION_MAX){ state.msg="포션이 이미 가득하다."; state.msgT=1.2; }
      else if(p.gold<POTION_PRICE){ state.msg="골드가 부족하다."; state.msgT=1.2; }
      else{
        p.gold-=POTION_PRICE;
        p.potions+=1;
        audio.playCoin();
        state.msg="포션 구매 완료!"; state.msgT=1.2;
        markDirty(state);
      }
    }

    if(hitBtn(x+18,bY+64,320,52)){
      const target = p.invItems.find(it=>!it.identified) || Object.values(p.equip).find(it=>it && !it.identified);
      if(!target){ state.msg="미감정 아이템이 없다."; state.msgT=1.2; }
      else appraiseOne(state, target.id);
    }

    if(hitBtn(x+18,bY+128,320,52)){
      p.autoEquipBest();
      state.msg="자동 장착 완료."; state.msgT=1.2;
      markDirty(state);
    }

    if(hitBtn(x+18,bY+192,320,52)){
      state.gs = state.returnGs || "PAUSE";
    }

    ctx.fillStyle="rgba(235,240,255,0.70)";
    ctx.font="13px system-ui, -apple-system, Segoe UI";
    ctx.fillText("TIP", x+380, y+118);
    ctx.fillStyle="rgba(235,240,255,0.60)";
    ctx.font="12px system-ui, -apple-system, Segoe UI";
    ctx.fillText("• 감정권이 있으면 먼저 소모합니다.", x+380, y+144);
    ctx.fillText("• 없으면 골드로 감정합니다.", x+380, y+166);
    ctx.fillText("• 아이템 상세 감정/판매는 인벤에서.", x+380, y+188);
    ctx.fillText("• 저장은 '일시정지 메뉴'에서 수동 저장.", x+380, y+210);

    if(pressed.menu){ pressed.menu=false; state.gs = state.returnGs || "PAUSE"; }
  }

  // -------------------- Gameplay Update --------------------
  function updateCoinsLoot(dt, state){
    for(const c of state.coins){
      c.t+=dt;
      c.vy+=640*dt;
      c.x+=c.vx*dt;
      c.y+=c.vy*dt;
      c.vx*=Math.pow(0.12,dt);
      c.vy*=Math.pow(0.18,dt);
      if(c.y>GROUND_Y-20){ c.y=GROUND_Y-20; c.vy*= -0.25; }
    }
    for(const l of state.loots){
      l.t+=dt;
      l.vy+=640*dt;
      l.x+=l.vx*dt;
      l.y+=l.vy*dt;
      l.vx*=Math.pow(0.12,dt);
      l.vy*=Math.pow(0.18,dt);
      if(l.y>GROUND_Y-22){ l.y=GROUND_Y-22; l.vy*= -0.22; }
    }
  }

  function collectNearby(state){
    const p=state.player;

    for(let i=state.coins.length-1;i>=0;i--){
      const c=state.coins[i];
      const dx=c.x-p.x, dy=c.y-p.y;
      if(dx*dx+dy*dy < 50*50){
        p.gold += c.amount;
        audio.playCoin();
        state.coins.splice(i,1);
        markDirty(state);
      }
    }

    for(let i=state.loots.length-1;i>=0;i--){
      const l=state.loots[i];
      const dx=l.x-p.x, dy=l.y-p.y;
      if(dx*dx+dy*dy < 54*54){
        p.invItems.push(l.item);
        state.msg=`드랍 획득: ${l.item.name}${l.item.identified?"":"(미감정)"}`;
        state.msgT=1.2;
        state.loots.splice(i,1);
        markDirty(state);
      }
    }
  }

  // ✅ 동시에 달라붙는 수를 제한(가만히 있어도 몬스터가 우르르 오는 느낌 완화)
  const MAX_ENGAGE = 4;

  function computeEngageRanks(state){
    const p=state.player;
    const live = state.enemies.filter(e=>!e.dead);
    live.sort((a,b)=>Math.abs((a.x-p.x)) - Math.abs((b.x-p.x)));
    for(let i=0;i<live.length;i++){
      live[i].engageRank = i;
    }
  }

  function updateEnemyAI(dt,state,e){
    if(e.dead) return;

    e.aiT += dt;
    e.atkCd = Math.max(0, e.atkCd - dt);
    e.attackLock = Math.max(0, e.attackLock - dt);

    // ✅ 최근 교전(맞았거나/때렸거나) 상태 유지
    e.engagedT = Math.max(0, (e.engagedT||0) - dt);

    const p=state.player;
    const dx=p.x-e.x;
    const dir = dx===0 ? 0 : Math.sign(dx);
    e.face = dir===0 ? e.face : dir;

    // ✅ 어그로 진입: 일정 범위 안으로 들어오면 추적 시작
    const dist = Math.abs(dx);

    // (1) 최근 교전(맞았거나/때렸거나) 중이면 무조건 어그로 유지
    if(e.engagedT>0) e.aggro = true;

    // (2) 시야 안(인식 범위)으로 들어오면 어그로 진입
    if(!e.aggro && dist <= e.aggroRange){
      e.aggro = true;
    }

    // ✅ 리시: 너무 멀리 유인 + 플레이어도 충분히 멀어졌을 때만 해제(보스 제외)
    //    (도망치자마자 멈추는 버그 방지)
    if(e.tier!=="boss" && e.aggro && e.engagedT<=0){
      const away = Math.abs(e.x - e.spawnX);
      const farFromPlayer = dist > e.aggroRange*3.2;
      if(away > e.leashDist && farFromPlayer){
        e.aggro = false;
      }
    }

    // ✅ 비-어그로 상태: 제자리 근처에서만 약간 움직이거나 대기
    if(!e.aggro){
      const back = e.spawnX - e.x;
      const want = (Math.abs(back) > 16) ? Math.sign(back) : 0;
      const targetV = want * (e.spd*0.35);
      const acc = 10;
      e.vx = lerp(e.vx, targetV, clamp(acc*dt,0,1));

      if(Math.abs(e.vx)>18) e.anim="run";
      else e.anim="idle";
      return;
    }

    // ✅ 동시에 달라붙는 수 제한: 멀티는 접근을 덜 적극적으로
    const engaged = (e.engageRank < MAX_ENGAGE) || (dist < e.keepDist + 14) || (e.engagedT>0);

    // ✅ 너무 멀면 추적, 너무 가까우면 멈춤(개별 keepDist)
    const stopDist = e.keepDist + e.bias*40;
    const want = engaged
      ? ((dist > stopDist) ? dir : 0)
      : ((dist > stopDist*1.6) ? dir*0.6 : 0);

    // ✅ dt 기반 가속/감속 (px/s)
    const targetV = want * e.spd;
    const acc = engaged ? (12 + (e.tier==="boss"?6:0)) : 6;
    e.vx = lerp(e.vx, targetV, clamp(acc*dt, 0, 1));

    // 공격(접근 시) — 가까우면 누구든 공격(engaged는 더 자주/적극적으로)
    if(dist < (stopDist+10) && e.atkCd<=0 && e.attackLock<=0){
      e.anim="attack"; e.animT=0;

      // ✅ 공격 시작 시 "공격 총 길이"와 "이번 공격 1회 타격" 초기화
      e.attackTotal = 0.18;
      e.attackLock  = e.attackTotal;
      e.hitPlayerThisSwing = false;

      const baseCd = (e.tier==="boss")?0.75:0.95;
      e.atkCd = engaged ? baseCd : (baseCd + 0.35);

      e.vx *= 0.35;
    }

    // 가끔 점프(추적 변주) — engaged만
    if(engaged && e.onGround && dist > 300 && Math.random()<0.006){
      e.vy = -360;
      e.onGround=false;
    }

    // 애니메이션
    if(e.attackLock>0) e.anim="attack";
    else if(Math.abs(e.vx)>18) e.anim="run";
    else e.anim="idle";
  }

  function swingActiveWindow(p){
    if(!p.swingType || p.attackLock<=0 || p.swingTotal<=0) return {active:false,mult:1,range:76};
    const prog = 1 - (p.attackLock / p.swingTotal); // 0..1
    if(p.swingType==="atk"){
      const active = (prog>=0.22 && prog<=0.55);
      return {active, mult:1.0, range:76};
    }else{
      const active = (prog>=0.18 && prog<=0.68);
      return {active, mult:1.55, range:110};
    }
  }

  function updatePlay(dt, state){
    const p=state.player;
    const d=p.derived();

    // ✅ 사망 상태: 입력/전투 정지, 잠시 후 마을 부활
    if(state.dead){
      state.deadT -= dt;
      if(state.deadT<=0){
        respawnToTown(state);
      }
      // 카메라(안정)
      state.camX = clamp(p.x - VIEW_W*0.35, 0, WORLD.w - VIEW_W);
      cam.x = lerp(cam.x, state.camX, 0.12);
      return;
    }

    if(HUD_SHOW_GEAR && hitBtn(HUD_MENU_BTN.x,HUD_MENU_BTN.y,HUD_MENU_BTN.w,HUD_MENU_BTN.h)){
      state.gs="PAUSE";
    }
    if(hitBtn(HUD_INV_BTN.x,HUD_INV_BTN.y,HUD_INV_BTN.w,HUD_INV_BTN.h)){
      state.returnGs="PLAY";
      state.gs="INV";
    }
    if(hitBtn(HUD_POTION_BTN.x,HUD_POTION_BTN.y,HUD_POTION_BTN.w,HUD_POTION_BTN.h)){
      tryUsePotion(state);
    }

    if(pressed.menu){ pressed.menu=false; state.gs="PAUSE"; }
    if(pressed.inv){ pressed.inv=false; state.returnGs="PLAY"; state.gs="INV"; }
    if(pressed.potion){ pressed.potion=false; tryUsePotion(state); }

    state.t += dt;
    if(state.msgT>0) state.msgT -= dt;
    if(state.doorHintCd>0) state.doorHintCd -= dt;

    updateEffects(dt,state);

    p.atkCd = Math.max(0,p.atkCd-dt);
    p.skillCd = Math.max(0,p.skillCd-dt);
    p.potionCd = Math.max(0,p.potionCd-dt);
    p.hitCd = Math.max(0,p.hitCd-dt);
    p.inv = Math.max(0,p.inv-dt);
    p.attackLock = Math.max(0,p.attackLock-dt);

    // ✅ 이동 (px/s)
    const ax = moveAxis();
    if(p.attackLock<=0){
      const target = ax * d.spd;
      const acc = 12;
      p.vx = lerp(p.vx, target, clamp(acc*dt,0,1));
      if(ax!==0) p.face = ax>0 ? 1 : -1;
    }else{
      p.vx = lerp(p.vx, 0, clamp(16*dt,0,1));
    }

    // 점프
    if(pressed.jump && p.onGround && p.attackLock<=0){
      p.vy = -420;
      p.onGround=false;
    }
    pressed.jump=false;

    // 중력 (px/s^2)
    p.vy += 980*dt;
    p.vy = clamp(p.vy,-900,900);

    // 충돌
    collidePlatforms(p, state.platforms, dt);

    // 애니메이션
    if(p.hitCd>0) { p.anim="hurt"; }
    else if(p.attackLock>0) { p.anim="attack"; }
    else if(!p.onGround) p.anim="jump";
    else if(Math.abs(p.vx)>18) p.anim="run";
    else p.anim="idle";
    p.animT += dt;

    // 공격 / 스킬 (시작)
    const doAtk = wantAttack() && p.atkCd<=0 && p.attackLock<=0;
    const doSkl = wantSkill() && p.skillCd<=0 && p.attackLock<=0;

    if(doAtk){
      p.anim="attack"; p.animT=0;
      p.swingType="atk";
      p.swingTotal=ATTACK_LOCK_ATK;
      p.swingHitIds.clear();
      p.attackLock = ATTACK_LOCK_ATK;
      p.atkCd = 0.26;
      pressed.atk=false;
    }
    if(doSkl){
      p.anim="attack"; p.animT=0;
      p.swingType="skill";
      p.swingTotal=ATTACK_LOCK_SKL;
      p.swingHitIds.clear();
      p.attackLock = ATTACK_LOCK_SKL;
      p.skillCd = 2.8;
      pressed.skill=false;
    }
    // 스윙 종료 처리
    if(p.attackLock<=0 && p.swingType){
      p.swingType=null;
      p.swingTotal=0;
      p.swingHitIds.clear();
    }

    // ✅ engaged rank 계산
    computeEngageRanks(state);

    // 적 업데이트
    for(const e of state.enemies){
      if(e.dead){
        e.dieT += dt;
        e.animT += dt;
        continue;
      }

      e.hitCd = Math.max(0, e.hitCd - dt);

      e.vy += 980*dt;
      e.vy = clamp(e.vy, -900, 900);

      updateEnemyAI(dt,state,e);

      collidePlatforms(e, state.platforms, dt);
      e.animT += dt;

      // ✅ [수정] 몬스터 공격 판정: 겹침이 아니라 "앞쪽 히트박스"로 1회 타격
      if(e.attackLock>0 && p.inv<=0 && p.hitCd<=0 && !e.hitPlayerThisSwing && e.attackTotal>0){
        const prog = 1 - (e.attackLock / e.attackTotal); // 0..1
        const active = (prog >= 0.22 && prog <= 0.60);   // 공격이 실제로 들어가는 구간

        if(active){
          const range = (e.tier==="boss") ? 96 : (e.tier==="elite" ? 86 : 82);
          const cx = e.x + e.face * range * 0.55;
          const cy = e.y - 10;

          const hit = aabb(
            cx - 52, cy - 38, 104, 76,
            p.x - p.w/2, p.y - p.h/2, p.w, p.h
          );

          if(hit){
            e.hitPlayerThisSwing = true;

            p.hitCd = CONTACT_DAMAGE_COOLDOWN;
            p.inv = 0.18;

            const dmg = Math.max(1, e.atk - d.def);
            p.hp -= dmg;

            // ✅ 교전 상태 유지(도망치면 바로 멈추는 버그 방지)
            e.aggro = true;
            e.engagedT = 2.6;


            state.dmgText.push(new DamageText(p.x,p.y-72,`-${dmg}`,"rgba(255,91,110,0.95)"));
            spawnHitFX(state,p.x,p.y-20);

            if(p.hp<=0){
              killPlayer(state);
            }
          }
        }
      }

      // ✅ 플레이어 공격 판정(이번 스윙 타입으로 고정)
      const sw = swingActiveWindow(p);
      if(sw.active){
        if(p.swingHitIds.has(e.id)) continue;

        const range = sw.range;
        const cx = p.x + p.face*range*0.55;
        const cy = p.y - 12;
        const hit = aabb(cx-50, cy-40, 100, 80, e.x-e.w/2, e.y-e.h/2, e.w, e.h);

        if(hit && e.hitCd<=0){
          p.swingHitIds.add(e.id);

          e.hitCd = 0.14;
          e.anim="hurt"; e.animT=0;

          const {dmg,crit} = damageCalc(d.atk, e.def, d.crit, sw.mult);
          e.hp -= dmg;
          state.dmgText.push(new DamageText(e.x,e.y-64, crit?`★${dmg}`:`${dmg}`, crit?"rgba(255,207,91,0.95)":"rgba(235,240,255,0.92)"));
          spawnHitFX(state,e.x,e.y-10);

          // ✅ 맞은 몬스터는 강제로 교전 상태(리시 무시)로 전환
          e.aggro = true;
          e.engagedT = 2.6;

          // 흡혈
          if(d.ls>0){
            const heal = Math.max(1, Math.floor(dmg*(d.ls/100)));
            const before = p.hp;
            p.hp = clamp(p.hp + heal, 0, d.hpMax);
            if(p.hp>before) state.dmgText.push(new DamageText(p.x,p.y-86,`+${p.hp-before}`,"rgba(46,229,157,0.95)"));
          }

          if(e.hp<=0){
            e.hp=0; e.dead=true; e.anim="die"; e.animT=0;
            state.killed += 1;
            p.kills += 1;
            dropRewards(state,e);
            if(state.killed>=state.goalKills) ensureDoor(state);
          }
        }
      }
    }

    separateEnemies(state);

    updateCoinsLoot(dt,state);
    collectNearby(state);

    // 문 진입
    if(state.door){
      const door=state.door;
      const inDoor = aabb(p.x-p.w/2,p.y-p.h/2,p.w,p.h, door.x,door.y,door.w,door.h);

      if(inDoor){
        if(door.locked){
          // ✅ 잠김: 목표 처치 수를 채우기 전에는 진행 불가(게이트는 항상 보임)
          if(state.doorHintCd<=0){
            state.msg = `게이트가 잠겨 있다. (${state.killed}/${state.goalKills})`;
            state.msgT = 1.2;
            state.doorHintCd = 0.9;
          }
          // 살짝 밀어내기(문 안에 박혀 반복 진입 방지)
          if(p.x > door.x + door.w*0.5) p.x = door.x - 10;
          p.vx = Math.min(p.vx, -60);
        }else{
          stageClearReward(state);
          state.stageIndex += 1;
          rebuildStage(state);
        }
      }
    }

    // 카메라
    state.camX = clamp(p.x - VIEW_W*0.35, 0, WORLD.w - VIEW_W);
    cam.x = lerp(cam.x, state.camX, 0.12);
  }

  // -------------------- Main Loop --------------------
  let state = freshState();
  applyOptions(state);
  rebuildStage(state);

  let last = performance.now();
  function frame(now){
    const dt = clamp((now-last)/1000, 0, 0.033);
    last = now;

    const clicked = pointer.clicked;

    ctx.clearRect(0,0,VIEW_W,VIEW_H);

    if(state.gs==="MENU") drawMenu(state);
    else if(state.gs==="OPTIONS") drawOptions(state);
    else if(state.gs==="PAUSE") drawPause(state);
    else if(state.gs==="INV") drawInventory(state);
    else if(state.gs==="SHOP") drawShop(state);
    else {
      updatePlay(dt,state);
      drawScene(state,false);
    }

    if(clicked) pointer.clicked=false;

    pressed.atk=false;
    pressed.skill=false;

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();
