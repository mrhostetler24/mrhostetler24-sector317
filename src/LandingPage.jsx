import { useState, useEffect } from "react";

function useParallax() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const fn = () => setOffset(window.scrollY * 0.35);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);
  return offset;
}

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);
  return scrolled;
}

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".lp-reveal");
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("lp-visible"); obs.unobserve(e.target); } }),
      { threshold: 0.07 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@300;400;500;600&display=swap');

.lp{font-family:'Barlow',sans-serif;color:#e8e4dc;background:#111209;overflow-x:hidden;}
.lp *{box-sizing:border-box;margin:0;padding:0;}
.lp-scanlines{position:fixed;inset:0;pointer-events:none;z-index:9998;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.018) 3px,rgba(0,0,0,.018) 6px);}

/* NAV */
.lp-nav{position:fixed;top:0;left:0;right:0;z-index:1000;display:flex;align-items:center;justify-content:space-between;padding:0 3rem;height:70px;transition:all .4s ease;background:rgba(17,18,9,.55);backdrop-filter:blur(8px);border-bottom:1px solid rgba(200,224,58,.08);}
.lp-nav.scrolled{background:rgba(17,18,9,.96);backdrop-filter:blur(16px);border-bottom:1px solid rgba(200,224,58,.18);}
.lp-logo{height:54px;width:auto;cursor:pointer;flex-shrink:0;}
.lp-nav-links{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:2rem;pointer-events:auto;}
.lp-navlink{font-family:'Barlow Condensed',sans-serif;font-size:.9rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:rgba(232,228,220,.92);cursor:pointer;transition:color .2s;background:none;border:none;text-shadow:0 1px 6px rgba(0,0,0,.8);}
.lp-navlink:hover{color:#d4ec46;}
.lp-nav-btns{display:flex;gap:.75rem;align-items:center;}
.lp-btn-login{font-family:'Barlow Condensed',sans-serif;font-size:.85rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;background:rgba(17,18,9,.4);border:1px solid rgba(200,224,58,.5);color:#c8e03a;border-radius:3px;padding:.45rem 1.2rem;cursor:pointer;transition:all .2s;}
.lp-btn-login:hover{border-color:#c8e03a;background:rgba(200,224,58,.15);}
.lp-btn-book{font-family:'Barlow Condensed',sans-serif;font-size:.85rem;font-weight:800;letter-spacing:.15em;text-transform:uppercase;background:#c8e03a;color:#111209;border:none;border-radius:3px;padding:.5rem 1.4rem;cursor:pointer;transition:all .25s;clip-path:polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%);}
.lp-btn-book:hover{background:#d4ec46;box-shadow:0 0 28px rgba(200,224,58,.4);transform:translateY(-1px);}
/* HAMBURGER */
.lp-hamburger{display:none;flex-direction:column;gap:5px;cursor:pointer;padding:.4rem;background:none;border:none;z-index:1001;}
.lp-hamburger span{display:block;width:24px;height:2px;background:#c8e03a;border-radius:2px;transition:all .3s;}
.lp-hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg);}
.lp-hamburger.open span:nth-child(2){opacity:0;}
.lp-hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg);}
.lp-mobile-menu{display:none;position:fixed;top:70px;left:0;right:0;background:rgba(17,18,9,.97);backdrop-filter:blur(20px);border-bottom:1px solid rgba(200,224,58,.2);flex-direction:column;padding:1.25rem 1.5rem 1.75rem;gap:.25rem;z-index:999;}
.lp-mobile-menu.open{display:flex;}
.lp-mobile-navlink{font-family:'Barlow Condensed',sans-serif;font-size:1.1rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:rgba(232,228,220,.85);cursor:pointer;background:none;border:none;text-align:left;padding:.75rem 0;border-bottom:1px solid rgba(200,224,58,.08);transition:color .2s;text-decoration:none;display:block;}
.lp-mobile-navlink:hover{color:#d4ec46;}
.lp-mobile-btns{display:flex;gap:.75rem;margin-top:1rem;flex-wrap:wrap;}
.lp-mobile-btns .lp-btn-login,.lp-mobile-btns .lp-btn-book{flex:1;clip-path:none;border-radius:3px;text-align:center;}

/* HERO */
.lp-hero{position:relative;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;overflow:hidden;padding-bottom:10vh;}
.lp-hero-bg{position:absolute;inset:0;background:url('/hero.png') center 18% / cover no-repeat;will-change:transform;}
.lp-hero-overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(17,18,9,.45) 0%,rgba(17,18,9,.0) 12%,rgba(17,18,9,.0) 30%,rgba(17,18,9,.55) 65%,rgba(17,18,9,.99) 100%);}
.lp-hero-content{position:relative;z-index:2;text-align:center;padding:0 2rem;max-width:720px;animation:lpUp .9s ease both;}
@keyframes lpUp{from{opacity:0;transform:translateY(36px);}to{opacity:1;transform:translateY(0);}}
.lp-line{font-family:'Barlow Condensed',sans-serif;font-size:clamp(1.05rem,2.6vw,1.45rem);font-weight:600;letter-spacing:.06em;line-height:1;display:block;text-shadow:0 2px 20px rgba(0,0,0,.95);margin-bottom:.9rem;}
.lp-line-1{color:rgba(232,228,220,.88);animation:lpUp .9s .1s ease both;}
.lp-line-2{color:#c8e03a;font-size:clamp(1.1rem,2.8vw,1.55rem);font-weight:700;text-shadow:0 0 30px rgba(200,224,58,.5),0 2px 20px rgba(0,0,0,.9);animation:lpUp .9s .2s ease both;}
.lp-line-3{color:rgba(232,228,220,.78);font-weight:500;animation:lpUp .9s .3s ease both;}
.lp-hero-btns{display:flex;align-items:center;justify-content:center;gap:1.25rem;flex-wrap:wrap;margin-top:2.25rem;animation:lpUp .9s .4s ease both;}
.lp-cta-p{font-family:'Barlow Condensed',sans-serif;font-size:1.05rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;background:#c8e03a;color:#111209;border:none;border-radius:3px;padding:.95rem 2.75rem;cursor:pointer;clip-path:polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%);transition:all .25s;box-shadow:0 0 40px rgba(200,224,58,.3);position:relative;overflow:hidden;}
.lp-cta-p::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);transform:translateX(-100%);transition:transform .5s;}
.lp-cta-p:hover{background:#d4ec46;box-shadow:0 0 60px rgba(200,224,58,.55);transform:translateY(-3px);}
.lp-cta-p:hover::after{transform:translateX(100%);}
.lp-cta-s{font-family:'Barlow Condensed',sans-serif;font-size:.95rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;background:none;color:#e8e4dc;border:2px solid rgba(232,228,220,.3);border-radius:3px;padding:.875rem 2rem;cursor:pointer;clip-path:polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%);transition:all .25s;}
.lp-cta-s:hover{border-color:#c8e03a;color:#c8e03a;background:rgba(200,224,58,.12);}
.lp-scroll{position:absolute;bottom:2.5rem;left:50%;transform:translateX(-50%);z-index:2;display:flex;flex-direction:column;align-items:center;gap:.4rem;cursor:pointer;opacity:.55;animation:lpBounce 2.2s ease infinite;}
@keyframes lpBounce{0%,100%{transform:translateX(-50%) translateY(0);}50%{transform:translateX(-50%) translateY(8px);}}
.lp-scroll span{font-family:'Barlow Condensed',sans-serif;font-size:.6rem;letter-spacing:.3em;text-transform:uppercase;color:#c8e03a;}

/* STRIP */
.lp-strip{background:#111209;border-top:1px solid rgba(200,224,58,.15);border-bottom:1px solid rgba(200,224,58,.08);padding:1.3rem 0;}
.lp-strip-inner{display:flex;justify-content:center;align-items:stretch;flex-wrap:wrap;max-width:1100px;margin:0 auto;padding:0 2rem;}
.lp-inc{display:flex;align-items:center;gap:.55rem;padding:.5rem 1.25rem;border-right:1px solid rgba(200,224,58,.1);flex:1;min-width:0;justify-content:flex-start;}
.lp-inc:last-child{border-right:none;}
.lp-inc-icon{font-size:1.2rem;flex-shrink:0;}
.lp-inc-text{font-family:'Barlow Condensed',sans-serif;font-size:.78rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#7a7868;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lp-inc-text strong{color:rgba(232,228,220,.85);display:block;font-size:.86rem;}

/* SECTIONS */
.lp-section{padding:5rem 0;}
.lp-con{max-width:1200px;margin:0 auto;padding:0 3rem;}
.lp-ey{font-family:'Barlow Condensed',sans-serif;font-size:.68rem;font-weight:700;letter-spacing:.5em;text-transform:uppercase;color:#c8e03a;margin-bottom:.5rem;display:flex;align-items:center;gap:.75rem;}
.lp-ey.left::after{content:'';width:40px;height:1px;background:#c8e03a;opacity:.5;display:block;}
.lp-ey.right{justify-content:flex-end;}
.lp-ey.right::before{content:'';width:40px;height:1px;background:#c8e03a;opacity:.5;display:block;}
.lp-h{font-family:'Black Ops One',sans-serif;font-size:clamp(2rem,5vw,3.5rem);text-transform:uppercase;color:#e8e4dc;line-height:.95;margin-bottom:.5rem;}
.lp-h span{color:#c8e03a;}
.lp-h.right{text-align:right;}

/* MISSIONS */
.lp-missions{background:#1a1b14;}
.lp-s2hdr{margin-top:4rem;padding-top:4rem;border-top:1px solid rgba(200,224,58,.1);text-align:right;}
.lp-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-top:2.5rem;}
.lp-card{background:#22231b;border:1px solid #3a3b30;border-radius:4px;padding:2.25rem;position:relative;overflow:hidden;cursor:pointer;transition:all .3s;}
.lp-card:hover{border-color:rgba(200,224,58,.45);transform:translateY(-4px);box-shadow:0 16px 48px rgba(200,224,58,.1);}
.lp-card::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(200,224,58,.05) 0%,transparent 55%);opacity:0;transition:opacity .3s;}
.lp-card:hover::before{opacity:1;}
.lp-card.tacc{border-top:3px solid #9ab02e;}
.lp-card.bacc{border-bottom:3px solid #9ab02e;}
.lp-icon{width:68px;height:68px;border-radius:6px;display:flex;align-items:center;justify-content:center;margin-bottom:1.25rem;background:rgba(200,224,58,.12);border:1px solid rgba(200,224,58,.2);position:relative;overflow:hidden;box-shadow:inset 0 0 20px rgba(200,224,58,.08);}
.lp-icon::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 20% 80%,rgba(200,224,58,.15) 0%,transparent 40%),radial-gradient(circle at 80% 20%,rgba(200,224,58,.1) 0%,transparent 35%);}
.lp-dsub{font-family:'Barlow Condensed',sans-serif;font-size:.67rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:#c8e03a;margin-bottom:.4rem;}
.lp-name{font-family:'Black Ops One',sans-serif;font-size:1.8rem;text-transform:uppercase;color:#e8e4dc;margin-bottom:.65rem;}
.lp-desc{font-size:.86rem;color:#7a7868;line-height:1.65;margin-bottom:1.25rem;}
.lp-meta{display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem;}
.lp-mi{font-family:'Barlow Condensed',sans-serif;font-size:.76rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#7a7868;display:flex;align-items:center;gap:.35rem;}
.lp-mi em{color:#c8e03a;font-style:normal;font-size:1rem;}
.lp-price{font-family:'Barlow Condensed',sans-serif;font-size:1.1rem;font-weight:700;color:#d4ec46;}
.lp-tag{display:inline-block;font-family:'Barlow Condensed',sans-serif;font-size:.6rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;border-radius:2px;padding:.15rem .5rem;margin-left:.5rem;background:rgba(200,224,58,.12);border:1px solid #9ab02e;color:#c8e03a;}

/* HOW */
.lp-how{background:#111209;position:relative;overflow:hidden;}
.lp-how::after{content:'';position:absolute;bottom:-200px;right:-200px;width:600px;height:600px;background:radial-gradient(circle,rgba(200,224,58,.04) 0%,transparent 70%);pointer-events:none;}
.lp-steps{display:grid;grid-template-columns:repeat(5,1fr);gap:1.25rem;margin-top:3rem;}
.lp-step{border-left:2px solid rgba(200,224,58,.18);padding:1.5rem 1.25rem;transition:border-color .3s;}
.lp-step:hover{border-color:#c8e03a;}
.lp-snum{font-family:'Black Ops One',sans-serif;font-size:2.8rem;color:rgba(200,224,58,.14);line-height:1;margin-bottom:.6rem;transition:color .3s;}
.lp-step:hover .lp-snum{color:rgba(200,224,58,.38);}
.lp-stitle{font-family:'Barlow Condensed',sans-serif;font-size:.9rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#e8e4dc;margin-bottom:.4rem;}
.lp-sdesc{font-size:.79rem;color:#7a7868;line-height:1.62;}

/* SOCIAL */
.lp-social{background:#1a1b14;padding:2.75rem 0;border-top:1px solid rgba(200,224,58,.08);border-bottom:1px solid rgba(200,224,58,.08);}
.lp-soc-inner{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1.5rem;max-width:960px;margin:0 auto;padding:0 3rem;}
.lp-soc-title{font-family:'Black Ops One',sans-serif;font-size:2rem;text-transform:uppercase;color:#e8e4dc;margin-bottom:.25rem;}
.lp-soc-title span{color:#c8e03a;}
.lp-soc-sub{font-family:'Barlow Condensed',sans-serif;font-size:.88rem;color:#7a7868;letter-spacing:.06em;}
.lp-soc-links{display:flex;gap:.85rem;flex-wrap:wrap;}
.lp-soc-btn{display:flex;align-items:center;gap:.55rem;font-family:'Barlow Condensed',sans-serif;font-size:.8rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;background:#22231b;border:1px solid #3a3b30;color:#e8e4dc;border-radius:3px;padding:.55rem 1.1rem;cursor:pointer;transition:all .2s;text-decoration:none;}
.lp-soc-btn:hover{border-color:#c8e03a;color:#c8e03a;}
.lp-soc-btn svg{width:17px;height:17px;flex-shrink:0;}

/* HOURS */
.lp-hours{background:#111209;}
.lp-hgrid{display:grid;grid-template-columns:1fr 1fr;gap:3rem;margin-top:2.5rem;align-items:start;}
.lp-htbl{width:100%;border-collapse:collapse;}
.lp-htbl tr{border-bottom:1px solid rgba(200,224,58,.07);}
.lp-htbl tr:last-child{border-bottom:none;}
.lp-htbl td{padding:.72rem 0;font-family:'Barlow Condensed',sans-serif;font-size:.9rem;letter-spacing:.04em;}
.lp-htbl td:first-child{color:#7a7868;text-transform:uppercase;font-weight:600;}
.lp-htbl td:last-child{color:#d4ec46;font-weight:700;text-align:right;}
.lp-loc{background:#22231b;border:1px solid #3a3b30;border-top:3px solid #c8e03a;border-radius:4px;padding:1.75rem;}
.lp-loc-lbl{font-family:'Barlow Condensed',sans-serif;font-size:.66rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:#c8e03a;margin-bottom:.35rem;}
.lp-loc-name{font-family:'Black Ops One',sans-serif;font-size:1.35rem;text-transform:uppercase;color:#e8e4dc;margin-bottom:.5rem;}
.lp-loc-addr{font-size:.86rem;color:#7a7868;line-height:1.7;margin-bottom:1rem;}
.lp-loc-map{width:100%;height:140px;background:#2a2b22;border-radius:3px;border:1px solid #3a3b30;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#7a7868;margin-bottom:.9rem;}
.lp-badge{display:inline-flex;align-items:center;gap:.45rem;background:rgba(200,224,58,.12);border:1px solid rgba(200,224,58,.18);border-radius:3px;padding:.3rem .8rem;font-family:'Barlow Condensed',sans-serif;font-size:.73rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#c8e03a;margin-top:.4rem;}
.lp-badge.dim{background:none;border-color:rgba(200,224,58,.1);color:#7a7868;}

/* FAQ */
.lp-faq{background:#1a1b14;}
.lp-faq-list{margin-top:2.5rem;max-width:820px;}
.lp-faq-item{border-bottom:1px solid rgba(200,224,58,.09);overflow:hidden;}
.lp-faq-q{font-family:'Barlow Condensed',sans-serif;font-size:1rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#e8e4dc;padding:1.2rem 0;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:1rem;transition:color .2s;user-select:none;background:none;border:none;width:100%;text-align:left;}
.lp-faq-q:hover{color:#c8e03a;}
.lp-arr{flex-shrink:0;width:22px;height:22px;border:1px solid rgba(200,224,58,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.78rem;color:#c8e03a;transition:transform .3s,background .2s;}
.lp-faq-item.open .lp-faq-q{color:#c8e03a;}
.lp-faq-item.open .lp-arr{transform:rotate(45deg);background:rgba(200,224,58,.12);}
.lp-faq-a{font-size:.87rem;color:#7a7868;line-height:1.72;max-height:0;overflow:hidden;transition:max-height .4s ease,padding .3s ease;padding:0;}
.lp-faq-item.open .lp-faq-a{max-height:300px;padding-bottom:1.2rem;}
.lp-faq-a a{color:#c8e03a;text-decoration:none;}
.lp-faq-a a:hover{text-decoration:underline;}

/* CTA */
.lp-cta{background:#111209;text-align:center;padding:7rem 3rem;position:relative;overflow:hidden;}
.lp-cta-wm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-family:'Black Ops One',sans-serif;font-size:28vw;color:rgba(200,224,58,.022);pointer-events:none;white-space:nowrap;user-select:none;}
.lp-cta-h{font-family:'Black Ops One',sans-serif;font-size:clamp(2.5rem,6vw,5rem);text-transform:uppercase;color:#e8e4dc;margin-bottom:.75rem;position:relative;}
.lp-cta-h span{color:#c8e03a;}
.lp-cta-sub{font-family:'Barlow Condensed',sans-serif;font-size:1.05rem;color:#7a7868;margin-bottom:2.5rem;letter-spacing:.06em;position:relative;}
.lp-cta-btns{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;position:relative;}

/* FOOTER */
.lp-footer{background:#111209;border-top:1px solid rgba(200,224,58,.1);padding:1.75rem 3rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;}
.lp-flogo{height:46px;width:auto;}
.lp-flinks{display:flex;gap:1.75rem;flex-wrap:wrap;}
.lp-flink{font-family:'Barlow Condensed',sans-serif;font-size:.7rem;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#7a7868;cursor:pointer;transition:color .2s;background:none;border:none;}
.lp-flink:hover{color:#c8e03a;}
.lp-fcopy{font-family:'Barlow Condensed',sans-serif;font-size:.7rem;color:#7a7868;opacity:.5;letter-spacing:.08em;}

/* REVEAL */
.lp-reveal{opacity:0;transform:translateY(26px);transition:opacity .7s ease,transform .7s ease;}
.lp-reveal.lp-visible{opacity:1;transform:translateY(0);}
.lp-d1{transition-delay:.07s;}.lp-d2{transition-delay:.16s;}.lp-d3{transition-delay:.25s;}.lp-d4{transition-delay:.34s;}.lp-d5{transition-delay:.43s;}

@media(max-width:960px){.lp-steps{grid-template-columns:repeat(3,1fr);}}
@media(max-width:1100px){
  .lp-nav{padding:0 1rem;}
  .lp-nav-links{display:none;}
  .lp-nav-btns{display:none;}
  .lp-hamburger{display:flex;}
  /* On portrait mobile the image is wide, shift anchor so logo stays centered */
  .lp-hero-bg{background-position:center 12% !important;}
  .lp-con{padding:0 1.25rem;}
  .lp-section{padding:3rem 0;}
  .lp-grid{grid-template-columns:1fr;}
  .lp-hgrid{grid-template-columns:1fr;}
  .lp-steps{grid-template-columns:repeat(2,1fr);}
  .lp-footer{flex-direction:column;align-items:flex-start;padding:1.5rem 1.25rem;}
  .lp-soc-inner{flex-direction:column;padding:0 1.25rem;}
  .lp-inc{border-right:none;border-bottom:1px solid rgba(200,224,58,.08);}
  .lp-inc:last-child{border-bottom:none;}
  .lp-h{font-size:clamp(1.75rem,7vw,3rem);}
  .lp-cta{padding:4rem 1.5rem;}
  .lp-cta-wm{font-size:40vw;}
  .lp-cta-h{font-size:clamp(2rem,8vw,4rem);}
  .lp-card{padding:1.5rem;}
  .lp-hero-content{padding:0 1.25rem;}
  .lp-hero-btns{flex-direction:column;align-items:stretch;gap:.75rem;margin-top:1.5rem;}
  .lp-cta-p,.lp-cta-s{width:100%;text-align:center;clip-path:none;border-radius:4px;}
  .lp-strip-inner{padding:0 1rem;flex-direction:column;}
  .lp-cta-btns{flex-direction:column;align-items:center;}
  .lp-cta-btns .lp-cta-p,.lp-cta-btns .lp-cta-s{max-width:320px;width:100%;clip-path:none;border-radius:4px;}
  .lp-htbl td{font-size:.82rem;}
  .lp-flinks{gap:1rem;}
  .lp-loc{padding:1.25rem;}
  .lp-faq-list{padding:0;}
  .lp-hours .lp-hgrid>div:first-child{order:2;}
  .lp-hours .lp-hgrid>div:last-child{order:1;}
  .lp-line{font-size:clamp(1.1rem,5vw,1.4rem);}
  .lp-line-2{font-size:clamp(1.2rem,5.5vw,1.5rem);}
  /* Boost all body text on mobile */
  .lp-desc{font-size:.95rem;line-height:1.6;}
  .lp-dsub{font-size:.85rem;}
  .lp-name{font-size:1.6rem;}
  .lp-mi{font-size:.88rem;}
  .lp-price{font-size:1.1rem;}
  .lp-ey{font-size:.8rem;}
  .lp-h{font-size:clamp(2rem,8vw,3.2rem);}
  .lp-sdesc{font-size:.92rem;}
  .lp-stitle{font-size:1.05rem;}
  .lp-faq-q{font-size:1rem;}
  .lp-faq-a{font-size:.9rem;}
  .lp-inc-text strong{font-size:.92rem;}
  .lp-inc-text{font-size:.82rem;}
}
@media(max-width:480px){
  .lp-steps{grid-template-columns:1fr;}
  .lp-hero{min-height:100svh;}
  .lp-hero-bg{background-position:center 8% !important;}
  .lp-name{font-size:1.5rem;}
  .lp-soc-links{flex-direction:column;}
  .lp-soc-btn{width:100%;justify-content:center;}
  .lp-card{padding:1.25rem;}
  .lp-desc{font-size:.93rem;line-height:1.6;}
  .lp-price{font-size:1.05rem;}
  .lp-line{font-size:clamp(1.05rem,6vw,1.35rem);}
  .lp-line-2{font-size:clamp(1.15rem,6.5vw,1.5rem);}
  .lp-sdesc{font-size:.9rem;}
}
`;

const FAQS = [
  { q: "What does CQB stand for and what is a shoot-house?", a: "CQB stands for Close Quarters Battle. It refers to tactical combat conducted in confined spaces like buildings, hallways, and tight indoor environments.  A shoot house is a purpose-built structure designed for tactical training in close-quarters environments. It simulates real-world interior spaces like rooms and hallways so teams can practice movement, communication, and scenario-based missions. There are the same structure types used by military and law enforcement for their tactical training. We feature two separate two-story, 4,700 sq ft structures with modular interior walls that we continually reconfigure to ensure a new experience each time you return. Structures include a variety of rooms, thresholds, blind spots, stairwells, and feature breachable doors as well as various environmental controls." },
  { q: "What do you mean when you say environmental controls?", a: "Each of our structures are packed full of awesome technology. From target sensors to livestream cameras, we track and capture all of the action to form a completely unique experience. Included in this tech package are various visual and audio controls that allow each group to define and redefine the experience they wish to have. Some examples of these controls include our Standard mode (typical house lighting), Cosmic (house lights off, black lights on!), Strobe (not for the easily dizzied or epiliptic), Dark (all lights off, barrel flashlights lead the way), and Cranked (loud music - the way we listened to it in highschool).  If you're feeling extra frisky, ask for Rave mode (Cosmic + Strobe + Cranked - all at once)." },
  { q: "Is this like paintball or laser tag?", a: "Neither. We use 20-round, magazine-fed markers built on an M4-like platform (a similar frame as military and law enforcement officer training weapons used by real operators) firing harmless, water-soluable paint ammunition. Think structured scenario training, not backyard speedball." },
  { q: "Do I need any prior experience to be successful?", a: "Zero. Every session begins with a safety briefing covering core CQB concepts — room clearing, terminology, communication, threat assessment — so even complete beginners feel prepared. Our instructors walk you through everything before you breach your first structure." },
  { q: "What do I need to bring?", a: "Just closed-toe shoes and your competitive spirit. Full loadout and protective gear are provided at no additional cost. We do recommend you wear comfortable athletic clothing — and never wear your favorite shirt. Wear your second favorite shirt." },
  { q: "What's the age requirement?", a: "Participants must be 16 or older. Players aged 16–17 require a consenting adult participating alongside them and a guardian-signed waiver on file." },
  { q: "Can I book the entire venue for a private event?", a: null, jsx: <span>For corporate events, large parties, or custom full-venue packages, reach out at <a href="mailto:events@sector317.com">events@sector317.com</a> and we'll make it happen.</span> },
  { q: "What's at the bar?", a: "Beer, wine, champagne, hard seltzers, mocktails, and sodas. Alcohol is not permitted during active play. Valid ID required. Important to not that while we do not sell food on site, you are more than welcome to bring your own, cater for our crew, or order delivery straight to your table." },
];

const SOCIAL = [
  { label: "Instagram", url: "https://www.instagram.com/sector.317", path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" },
  { label: "Facebook", url: "https://www.facebook.com/sector317", path: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" },
  { label: "Twitch", url: "https://www.twitch.tv/sector317cqb", path: "M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.28 8.28 0 004.84 1.56V6.79a4.85 4.85 0 01-1.07-.1z" },
  { label: "YouTube", url: "https://www.youtube.com/@sector317", path: "M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" },
];

const HOURS = [["Monday","5:30 PM – 9:00 PM"],["Tuesday","5:30 PM – 9:00 PM"],["Wednesday","5:30 PM – 9:00 PM"],["Thursday","5:30 PM – 9:00 PM"],["Friday","5:00 PM – 11:00 PM"],["Saturday","12:30 PM – 11:00 PM"],["Sunday","1:30 PM – 7:00 PM"]];

function StripIcon({ type }) {
  const c = "#c8e03a", c2 = "#9ab02e";
  if (type === "gear") return (
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
      {/* helmet dome */}
      <path d="M7 20c0-6.627 4.925-12 11-12s11 5.373 11 12" fill={c} fillOpacity=".1" stroke={c} strokeWidth="1.8"/>
      {/* helmet sides / ear protection */}
      <path d="M7 20v4c0 1 .5 1.5 1.5 1.5H10" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M31 20v4c0 1-.5 1.5-1.5 1.5H28" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
      {/* ear cups */}
      <rect x="4" y="19" width="4" height="6" rx="1.5" fill={c} fillOpacity=".15" stroke={c} strokeWidth="1.4"/>
      <rect x="30" y="19" width="4" height="6" rx="1.5" fill={c} fillOpacity=".15" stroke={c} strokeWidth="1.4"/>
      {/* NVG mount on top */}
      <rect x="16" y="8" width="6" height="4" rx="1" fill={c} fillOpacity=".2" stroke={c} strokeWidth="1.3"/>
      <rect x="17.5" y="6" width="3" height="2.5" rx=".5" fill={c} fillOpacity=".3" stroke={c} strokeWidth="1"/>
      {/* goggle strap line */}
      <path d="M10 23.5h18" stroke={c} strokeWidth="1.2" strokeLinecap="round" opacity=".4"/>
      {/* goggle lens - wide single visor */}
      <path d="M9 21.5c0-2 1.5-3.5 3.5-3.5h13c2 0 3.5 1.5 3.5 3.5s-1.5 3.5-3.5 3.5h-13c-2 0-3.5-1.5-3.5-3.5z" fill={c} fillOpacity=".12" stroke={c} strokeWidth="1.6"/>
      {/* goggle reflections */}
      <path d="M12 20c1.5-1 3.5-1.2 5-.5" stroke={c2} strokeWidth="1.1" strokeLinecap="round" opacity=".65"/>
      <path d="M20 20c1.5-1 3-1.2 4.5-.5" stroke={c2} strokeWidth="1.1" strokeLinecap="round" opacity=".65"/>
      {/* mic boom */}
      <path d="M8 24.5c-1.5 1-2 2.5-1.5 3.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" opacity=".6"/>
      <circle cx="6.5" cy="28.5" r="1.2" fill={c} fillOpacity=".5" stroke={c} strokeWidth="1"/>
    </svg>
  );
  if (type === "bar") return (
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
      {/* mug body - straight sides, flat bottom */}
      <rect x="7" y="12" width="18" height="18" rx="2" fill={c} fillOpacity=".1" stroke={c} strokeWidth="1.8"/>
      {/* handle - D shape on right */}
      <path d="M25 16h3a3 3 0 010 6h-3" stroke={c} strokeWidth="1.9" strokeLinecap="round" fill="none"/>
      {/* foam line across top */}
      <rect x="7" y="12" width="18" height="4" rx="1.5" fill={c} fillOpacity=".2"/>
      {/* foam bumps */}
      <path d="M9 12c.8-2 1.6-2.5 2.5-1.5s1.8 1.8 2.5.5 1.5-2.2 2.5-.8 1.8 1.8 2.5.3 1.5-2 2.5-1" stroke={c} strokeWidth="1.4" strokeLinecap="round" fill="none" opacity=".7"/>
      {/* bubbles inside */}
      <circle cx="13" cy="22" r="1.1" fill={c2} fillOpacity=".45"/>
      <circle cx="18" cy="26" r=".9" fill={c2} fillOpacity=".35"/>
      <circle cx="15" cy="19" r=".7" fill={c} fillOpacity=".4"/>
    </svg>
  );
  if (type === "structures") return (
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
      <rect x="3" y="15" width="14" height="17" rx="1" fill={c} fillOpacity=".08" stroke={c} strokeWidth="1.5"/>
      <path d="M6 15V11l7-4 7 4v4" stroke={c} strokeWidth="1.5" strokeLinejoin="round"/>
      <rect x="5.5" y="21" width="4" height="4.5" rx=".5" fill={c} fillOpacity=".35"/>
      <rect x="12" y="21" width="4" height="4.5" rx=".5" fill={c} fillOpacity=".35"/>
      <rect x="21" y="9" width="14" height="23" rx="1" fill={c} fillOpacity=".12" stroke={c2} strokeWidth="1.5"/>
      <rect x="23" y="14" width="4" height="3.5" rx=".5" fill={c2} fillOpacity=".5"/>
      <rect x="29" y="14" width="4" height="3.5" rx=".5" fill={c2} fillOpacity=".5"/>
      <rect x="23" y="20" width="4" height="3.5" rx=".5" fill={c2} fillOpacity=".4"/>
      <rect x="29" y="20" width="4" height="3.5" rx=".5" fill={c2} fillOpacity=".4"/>
      <path d="M1 32h36" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
  if (type === "tv") return (
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
      <rect x="3" y="10" width="28" height="19" rx="2.5" fill={c} fillOpacity=".08" stroke={c} strokeWidth="1.7"/>
      <rect x="6" y="13" width="19" height="13" rx="1.5" fill={c} fillOpacity=".07" stroke={c} strokeWidth="1" strokeOpacity=".4"/>
      <path d="M12.5 16.5l8 3-8 3v-6z" fill={c} fillOpacity=".75"/>
      <circle cx="29" cy="16" r="1.5" stroke={c2} strokeWidth="1.2" fill="none" opacity=".7"/>
      <rect x="26.5" y="20" width="5" height="1" rx=".5" fill={c2} fillOpacity=".5"/>
      <rect x="26.5" y="22.5" width="5" height="1" rx=".5" fill={c2} fillOpacity=".4"/>
      <path d="M10 29l-2 4M24 29l2 4" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M11 10L8 4M23 10l4-6" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="35" cy="8" r="2.5" fill={c} fillOpacity=".2" stroke={c} strokeWidth="1"/>
      <circle cx="35" cy="8" r="1.1" fill={c}/>
    </svg>
  );
  if (type === "id") return (
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
      <rect x="3" y="8" width="30" height="22" rx="2.5" fill={c} fillOpacity=".08" stroke={c} strokeWidth="1.7"/>
      <rect x="3" y="11.5" width="30" height="4" fill={c} fillOpacity=".12"/>
      <rect x="6" y="18" width="9" height="9" rx="1" fill={c} fillOpacity=".12" stroke={c2} strokeWidth="1.1"/>
      <circle cx="10.5" cy="21" r="2" fill={c2} fillOpacity=".5"/>
      <path d="M6.5 27c0-2.5 1.8-3.5 4-3.5s4 1 4 3.5" fill={c2} fillOpacity=".35"/>
      <path d="M18 19.5h13" stroke={c} strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M18 23h9" stroke={c} strokeWidth="1.1" strokeLinecap="round" opacity=".5"/>
      <path d="M18 26h11" stroke={c} strokeWidth="1.1" strokeLinecap="round" opacity=".4"/>
      <rect x="24" y="2" width="13" height="11" rx="2" fill="#111209" stroke={c} strokeWidth="1.4"/>
      <text x="30.5" y="10.5" fontFamily="Barlow Condensed, sans-serif" fontSize="7.5" fontWeight="900" fill={c} textAnchor="middle" letterSpacing="-.5">18+</text>
    </svg>
  );
  return null;
}

export default function LandingPage({ onEnterApp }) {
  const parallax = useParallax();
  const scrolled = useScrolled();
  useReveal();
  const [openFaq, setOpenFaq] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const goTo = (id) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); setMenuOpen(false); };

  return (
    <div className="lp">
      <style>{CSS}</style>
      <div className="lp-scanlines" />

      {/* NAV */}
      <nav className={`lp-nav${scrolled ? " scrolled" : ""}`}>
        <img src="/logo.png" className="lp-logo" alt="Sector 317" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
        <div className="lp-nav-links">
          {[["missions","Missions"],["how","How It Works"],["hours","Join Us"],["faq","FAQ"]].map(([id,label]) => (
            <button key={id} className="lp-navlink" onClick={() => goTo(id)}>{label}</button>
          ))}
          <a className="lp-navlink" href="/leaderboard.html" target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>Leaderboard</a>
        </div>
        <div className="lp-nav-btns">
          <button className="lp-btn-login" onClick={onEnterApp}>Sign In</button>
          <button className="lp-btn-book" onClick={onEnterApp}>Book Now</button>
        </div>
        <button className={`lp-hamburger${menuOpen?" open":""}`} onClick={()=>setMenuOpen(o=>!o)} aria-label="Menu">
          <span/><span/><span/>
        </button>
      </nav>
      {/* MOBILE MENU */}
      <div className={`lp-mobile-menu${menuOpen?" open":""}`}>
        {[["missions","Missions"],["how","How It Works"],["hours","Join Us"],["faq","FAQ"]].map(([id,label]) => (
          <button key={id} className="lp-mobile-navlink" onClick={() => goTo(id)}>{label}</button>
        ))}
        <a className="lp-mobile-navlink" href="/leaderboard.html" target="_blank" rel="noreferrer">Leaderboard</a>
        <div className="lp-mobile-btns">
          <button className="lp-btn-login" onClick={()=>{setMenuOpen(false);onEnterApp();}}>Sign In</button>
          <button className="lp-btn-book" onClick={()=>{setMenuOpen(false);onEnterApp();}}>Book Now</button>
        </div>
      </div>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-hero-bg" style={{ transform: `translateY(${parallax}px)` }} />
        <div className="lp-hero-overlay" />
        <div className="lp-hero-content">
          <span className="lp-line lp-line-1">Where Friend Groups Become Fire Teams.</span>
          <span className="lp-line lp-line-2">Breach in. Clear out. Kick back.</span>
          <span className="lp-line lp-line-3">Is your team ready?</span>
          <div className="lp-hero-btns">
            <button className="lp-cta-p" onClick={onEnterApp}>Book Now</button>
            <button className="lp-cta-s" onClick={onEnterApp}>Sign In / My Account</button>
          </div>
        </div>
        <div className="lp-scroll" onClick={() => goTo("strip")}>
          <span>Drop In</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c8e03a" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
        </div>
      </section>

      {/* STRIP */}
      <div className="lp-strip" id="strip">
        <div className="lp-strip-inner">
          {[
            ["gear","Loadout & Gear","We've got you covered"],
            ["bar","Bar & Lounge","Catch the game"],
            ["structures","2 Structures","9,500 sq ft of CQB"],
            ["tv","Livestreams","See how it's done"],
            ["id","18+ to play","16+ with adult"],
          ].map(([iconKey, strong, sub], i) => (
            <div key={i} className={`lp-inc lp-reveal lp-d${i+1}`}>
              <div className="lp-inc-icon"><StripIcon type={iconKey}/></div>
              <div className="lp-inc-text"><strong>{strong}</strong>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MISSIONS */}
      <section className="lp-section lp-missions" id="missions">
        <div className="lp-con">

          <div className="lp-reveal">
            <div className="lp-ey left">Step One</div>
            <div className="lp-h">Pick Your <span>Group</span></div>
          </div>
          <div className="lp-grid">
            {/* Open Play */}
            <div className="lp-card tacc lp-reveal lp-d1" onClick={onEnterApp}>
              <div className="lp-icon">
                <svg width="42" height="42" viewBox="0 0 42 42" fill="none">
                  <circle cx="13" cy="10" r="4.5" fill="#c8e03a" opacity=".9"/>
                  <circle cx="29" cy="10" r="4.5" fill="#9ab02e" opacity=".9"/>
                  <path d="M5 32c0-5 3.5-8 8-8h1" stroke="#c8e03a" strokeWidth="2.5" strokeLinecap="round"/>
                  <rect x="8" y="22" width="10" height="9" rx="2" fill="#c8e03a" opacity=".2" stroke="#c8e03a" strokeWidth="1.5"/>
                  <path d="M37 32c0-5-3.5-8-8-8h-1" stroke="#9ab02e" strokeWidth="2.5" strokeLinecap="round"/>
                  <rect x="24" y="22" width="10" height="9" rx="2" fill="#9ab02e" opacity=".15" stroke="#9ab02e" strokeWidth="1.5"/>
                  <circle cx="21" cy="21" r="5" fill="#c8e03a" opacity=".1"/>
                  <path d="M21 18v6M18 21h6" stroke="#c8e03a" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="lp-dsub">For individuals &amp; small groups</div>
              <div className="lp-name">Open Play</div>
              <div className="lp-desc">Roll in solo or bring a few friends and link up with other operatives to complete the mission. Built for those looking to connect, compete, and sharpen their skills.  Perfect for first-timers; we’ll have you mission-ready.</div>
              <div className="lp-meta">
                <div className="lp-mi"><em>👥</em> Meet new people</div>
                <div className="lp-mi"><em>🚶</em> Walk-ins welcome</div>
              </div>
              <div className="lp-price">$55 <span style={{fontSize:".85rem",fontWeight:400,color:"#7a7868"}}>/&nbsp;person</span><span className="lp-tag">Show up and show out</span></div>
            </div>
            {/* Private Team */}
            <div className="lp-card tacc lp-reveal lp-d2" onClick={onEnterApp}>
              <div className="lp-icon">
                <svg width="42" height="42" viewBox="0 0 42 42" fill="none">
                  <path d="M21 4L36 10V22C36 30 21 38 21 38C21 38 6 30 6 22V10L21 4Z" fill="#c8e03a" opacity=".12" stroke="#c8e03a" strokeWidth="2.2" strokeLinejoin="round"/>
                  <path d="M21 9L31 14V22C31 27 21 33 21 33C21 33 11 27 11 22V14L21 9Z" stroke="#9ab02e" strokeWidth="1.5" strokeLinejoin="round" opacity=".5"/>
                  <rect x="16" y="20" width="10" height="8" rx="1.5" fill="#c8e03a" opacity=".3" stroke="#c8e03a" strokeWidth="1.5"/>
                  <path d="M17.5 20v-2.5a3.5 3.5 0 017 0V20" stroke="#c8e03a" strokeWidth="1.8" strokeLinecap="round"/>
                  <circle cx="21" cy="24" r="1.5" fill="#c8e03a"/>
                </svg>
              </div>
              <div className="lp-dsub">For groups who want their own game</div>
              <div className="lp-name">Private Team</div>
              <div className="lp-desc">Reserve your own private session for your group to run the mission your way. Built for birthdays, big groups, team nights, and revenge matches. Your scenario. Your rules. With nothing in your way.</div>
              <div className="lp-meta">
                <div className="lp-mi"><em>🏆</em> You pick your team</div>
                <div className="lp-mi"><em>🚫</em> No strays allowed</div>
              </div>
              <div className="lp-price">From $270 <span style={{fontSize:".85rem",fontWeight:400,color:"#7a7868"}}>flat rate</span><span className="lp-tag">Stick With Your Crew</span></div>
            </div>
          </div>

          {/* STEP TWO */}
          <div className="lp-s2hdr lp-reveal">
            <div className="lp-ey right">Step Two</div>
            <div className="lp-h right">Select Your <span>Mode</span></div>
          </div>
          <div className="lp-grid">
            {/* Co-Op */}
            <div className="lp-card bacc lp-reveal lp-d1" onClick={onEnterApp}>
              <div className="lp-icon">
                <svg width="42" height="42" viewBox="0 0 42 42" fill="none">
                  <circle cx="21" cy="21" r="15" fill="#c8e03a" opacity=".08" stroke="#c8e03a" strokeWidth="2.2"/>
                  <circle cx="21" cy="21" r="10" stroke="#9ab02e" strokeWidth="1.5" opacity=".45"/>
                  <path d="M21 21V11" stroke="#c8e03a" strokeWidth="2.5" strokeLinecap="round"/>
                  <path d="M21 21L28 26" stroke="#c8e03a" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="21" cy="21" r="2.5" fill="#c8e03a"/>
                  <path d="M21 6v2M21 34v2M6 21H8M34 21h2" stroke="#c8e03a" strokeWidth="2" strokeLinecap="round" opacity=".45"/>
                </svg>
              </div>
              <div className="lp-dsub">Beat the Clock</div>
              <div className="lp-name">Co-Op</div>
              <div className="lp-desc">Six operators — one objective — the clock is ticking. Navigate the structure, eliminate the threats, and complete the mission before time runs out. Static targets demand precision. Live opposition demands composure. Effective communication and coordination separate the winners from the rest…</div>
              <div className="lp-meta">
                <div className="lp-mi"><em>👥</em> Up to 6 players</div>
                <div className="lp-mi"><em>🎯</em> Perfect your craft to climb the leaderboard</div>
              </div>
              <span className="lp-tag">Team vs Objective</span>
            </div>
            {/* Versus */}
            <div className="lp-card bacc lp-reveal lp-d2" onClick={onEnterApp}>
              <div className="lp-icon">
                <svg width="42" height="42" viewBox="0 0 42 42" fill="none">
                  <path d="M8 8L30 30" stroke="#c8e03a" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M8 8L14 6L16 12" stroke="#c8e03a" strokeWidth="2" strokeLinejoin="round" fill="#c8e03a" opacity=".35"/>
                  <rect x="26" y="26" width="8" height="4" rx="1" transform="rotate(45 26 26)" fill="#c8e03a" opacity=".25" stroke="#c8e03a" strokeWidth="1"/>
                  <path d="M34 8L12 30" stroke="#c8e03a" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M34 8L28 6L26 12" stroke="#c8e03a" strokeWidth="2" strokeLinejoin="round" fill="#c8e03a" opacity=".35"/>
                  <rect x="8" y="26" width="8" height="4" rx="1" transform="rotate(-45 8 26)" fill="#c8e03a" opacity=".25" stroke="#c8e03a" strokeWidth="1"/>
                  <circle cx="21" cy="21" r="4" fill="#c8e03a" opacity=".15" stroke="#c8e03a" strokeWidth="1.5"/>
                  <path d="M21 15v-3M21 27v3M15 21h-3M27 21h3" stroke="#c8e03a" strokeWidth="1.5" strokeLinecap="round" opacity=".35"/>
                </svg>
              </div>
              <div className="lp-dsub">Beat Your Opponent</div>
              <div className="lp-name">Versus</div>
              <div className="lp-desc">An unstoppable force meets an immovable object. Something has to give. Two teams vie for one goal — control. One advances through resistance, the other holds the line. Then roles reverse. Structures flip. When the dust settles, only one raises the hardware.</div>
              <div className="lp-meta">
                <div className="lp-mi"><em>👥</em> Up to 6 vs 6 (12 max)</div>
                <div className="lp-mi"><em>⚔️</em> You've gotta beat the best to be the best</div>
              </div>
              <span className="lp-tag">Team vs Team</span>
            </div>
          </div>

        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-section lp-how" id="how">
        <div className="lp-con">
          <div className="lp-reveal">
            <div className="lp-ey left">The Playbook</div>
            <div className="lp-h">How It <span>Works</span></div>
          </div>
          <div className="lp-steps">
            {[
              ["01","Make Your Reservation","Book online in minutes. Pick your group, play mode, date, and time. Use our secure payment system to finalize your reservation and you're all set. Slots fill fast — lock yours in before it's gone."],
              ["02","Arrive Early & Team Up","Show up at least 30 minutes early. Grab a drink, watch the game, and peek in on the live feeds from cameras within the structures. Rally the troops and get your squad locked in before go time."],
              ["03","Brief, Kit Up & Zero In","Receive your safety briefing, draw your full kit of protective gear and tactical equipment including your loadout, then hit the firing range to familiarize yourself with everything and zero in."],
              ["04","Drop In & Dominate","Meet your instructor for mission briefing before you breach into the structure to execute your objectives. Timed scenarios, real opposition, and realer consequences for every decision."],
              ["05","Regroup in the Lounge","Return your gear, fix your hair, and grab a drink so you and your crew can kick back and watch the next group drop in on the live feed. Compare scores, relive the highlights, and plan your comeback."],
            ].map(([n,t,d], i) => (
              <div key={i} className={`lp-step lp-reveal lp-d${i+1}`}>
                <div className="lp-snum">{n}</div>
                <div className="lp-stitle">{t}</div>
                <div className="lp-sdesc">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL */}
      <div className="lp-social">
        <div className="lp-soc-inner">
          <div>
            <div className="lp-soc-title">Follow <span>The Fight</span></div>
            <div className="lp-soc-sub">Tag us in your best shots. We're watching.</div>
          </div>
          <div className="lp-soc-links">
            {SOCIAL.map((s) => (
              <a key={s.label} className="lp-soc-btn" href={s.url} target="_blank" rel="noreferrer">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d={s.path}/></svg>
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </div>

{/* NEWSLETTER / STAY IN THE LOOP */}
      <section style={{background:"linear-gradient(135deg,#1a1b13 0%,#111209 100%)",borderTop:"1px solid rgba(200,224,58,.15)",borderBottom:"1px solid rgba(200,224,58,.15)",padding:"5rem 2rem",textAlign:"center"}}>
        <div style={{maxWidth:560,margin:"0 auto"}}>
          <div style={{fontFamily:"'Black Ops One',sans-serif",fontSize:"clamp(1.6rem,4vw,2.4rem)",color:"#d4ec46",letterSpacing:".06em",textTransform:"uppercase",marginBottom:".6rem",lineHeight:1.1}}>
            Stay In The Loop
          </div>
          <p style={{fontFamily:"'Barlow',sans-serif",fontSize:"1rem",color:"rgba(232,228,220,.65)",lineHeight:1.7,marginBottom:"2rem"}}>
            New missions. Limited runs. Leaderboard resets. Exclusive events.<br/>
            Be the first to know — create your account and we'll keep you in the fight.
          </p>
          <div style={{display:"flex",gap:"1rem",justifyContent:"center",flexWrap:"wrap"}}>
            <button
              onClick={onEnterApp}
              style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"1rem",fontWeight:800,letterSpacing:".15em",textTransform:"uppercase",background:"#c8e03a",color:"#111209",border:"none",borderRadius:3,padding:".75rem 2.2rem",cursor:"pointer",transition:"all .25s",clipPath:"polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)"}}
              onMouseOver={e=>{e.currentTarget.style.background="#d4ec46";e.currentTarget.style.boxShadow="0 0 32px rgba(200,224,58,.45)";}}
              onMouseOut={e=>{e.currentTarget.style.background="#c8e03a";e.currentTarget.style.boxShadow="none";}}
            >
              Count Me IN →
            </button>
          </div>
          <p style={{fontFamily:"'Barlow',sans-serif",fontSize:".75rem",color:"rgba(232,228,220,.3)",marginTop:"1.25rem",letterSpacing:".04em"}}>
            No spam. No noise. Just what matters for Sector 317 operatives.
          </p>
        </div>
      </section>

      {/* HOURS & LOCATION */}
      <section className="lp-section lp-hours" id="hours">
        <div className="lp-con">
          <div className="lp-reveal">
            <div className="lp-ey left">Join Us</div>
            <div className="lp-h">Hours &amp; <span>Location</span></div>
          </div>
          <div className="lp-hgrid">
            <div className="lp-reveal lp-d1">
              <table className="lp-htbl">
                {HOURS.map(([d,h]) => <tr key={d}><td>{d}</td><td>{h}</td></tr>)}
              </table>
              <div style={{marginTop:"1.1rem",display:"flex",flexDirection:"column",gap:".4rem"}}>
                <div className="lp-badge">🔞 Ages 16+ with adult participation</div>
                <div className="lp-badge dim">👟 Closed-toe shoes required · Wear appropriate clothing</div>
                <div className="lp-badge dim">📅 Reservations recommended but not required</div>
              </div>
            </div>
            <div className="lp-loc lp-reveal lp-d2">
              <div className="lp-loc-lbl">Headquarters</div>
              <div className="lp-loc-name">Sector 317 HQ</div>
              <div className="lp-loc-addr">📍 Address TBD, Noblesville, IN<br/>📞 (317) 000-0000<br/>✉️ info@sector317.com</div>
              <div className="lp-loc-map"><span>📍 Map coming soon</span></div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:".72rem",color:"#7a7868",letterSpacing:".05em"}}>Free parking on site</div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-section lp-faq" id="faq">
        <div className="lp-con">
          <div className="lp-reveal">
            <div className="lp-ey left">Need Intel?</div>
            <div className="lp-h">Common <span>Questions</span></div>
          </div>
          <div className="lp-faq-list lp-reveal lp-d1">
            {FAQS.map((f, i) => (
              <div key={i} className={`lp-faq-item${openFaq === i ? " open" : ""}`}>
                <button className="lp-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {f.q}<span className="lp-arr">+</span>
                </button>
                <div className="lp-faq-a">{f.jsx || f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-cta">
        <div className="lp-cta-wm">317</div>
        <div className="lp-reveal">
          <div className="lp-cta-h">Ready to <span>Deploy?</span></div>
          <div className="lp-cta-sub">Sessions fill fast. Lock in your group now.</div>
          <div className="lp-cta-btns">
            <button className="lp-cta-p" style={{fontSize:"1.05rem",padding:"1rem 3.5rem"}} onClick={onEnterApp}>Book Now</button>
            <button className="lp-cta-s" style={{fontSize:".95rem",padding:".9rem 2.2rem"}} onClick={onEnterApp}>Sign In</button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <img src="/logo.png" className="lp-flogo" alt="Sector 317" />
        <div className="lp-flinks">
          {[["missions","Missions"],["how","How It Works"],["hours","Join Us"],["faq","FAQ"]].map(([id,label]) => (
            <button key={id} className="lp-flink" onClick={() => goTo(id)}>{label}</button>
          ))}
          <button className="lp-flink" onClick={onEnterApp}>Book Now</button>
          <a className="lp-flink" href="/leaderboard.html" target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>Leaderboard</a>
        </div>
        <div className="lp-fcopy">© 2026 Sector 317. All rights reserved.</div>
      </footer>
    </div>
  );
}
