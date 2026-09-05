import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowDown, ArrowRight, Layers, Menu, X, Check, FileText, ShieldCheck, Boxes, CircleDollarSign, Plus, Pause, Play } from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Brand } from './Public';
import './motion.css';

gsap.registerPlugin(ScrollTrigger);
const chapters = [
  { name: 'Quote', title: 'Set the\npossibility.', caption: '01 — A STRONGER START', copy: 'Hardware, services, subscriptions. Build one clear proposal with the detail behind every decision.', icon: FileText, color: 'paper' },
  { name: 'Approve', title: 'Find your\ngreen light.', caption: '02 — CONFIDENCE, BUILT IN', copy: 'Give every exception a clear path. The right context, the right reviewer, and a record of every decision.', icon: ShieldCheck, color: 'lime' },
  { name: 'Fulfill', title: 'Keep the\npromise.', caption: '03 — MAKE IT HAPPEN', copy: 'Connect confirmed orders to available stock. Coordinate your warehouses and see what’s ready to move.', icon: Boxes, color: 'olive' },
  { name: 'Bill', title: 'Bring it\nfull circle.', caption: '04 — FINISH STRONG', copy: 'One-time and recurring billing, clearly separated. Keep invoices, verified payments, and balances in view.', icon: CircleDollarSign, color: 'black' },
];

function ChapterArt({ index }: { index: number }) {
  if(index===0) return <div className="chapter-art paper-art" aria-hidden="true"><div className="paper-sheet back-sheet"/><div className="paper-sheet front-sheet"><span className="paper-logo"><Layers/> DealOS</span><span className="paper-title">A new<br/>possibility.</span><div className="paper-lines"><i/><i/><i/></div><span className="paper-signature">Let’s make it happen. <ArrowUpRight/></span></div><span className="art-orb"/></div>;
  if(index===1) return <div className="chapter-art seal-art" aria-hidden="true"><div className="seal-orbit"/><div className="approval-seal"><span>CONFIDENCE AT EVERY STEP</span><Check/><span>READY FOR WHAT’S NEXT</span></div><span className="seal-star">✳</span></div>;
  if(index===2) return <div className="chapter-art boxes-art" aria-hidden="true"><div className="parcel parcel-one"><div/><span><Layers/> DEALOS<br/><small>HANDLE WITH CLARITY</small></span></div><div className="parcel parcel-two"><div/><span>↗</span></div><div className="parcel parcel-three"><div/><span>MOVE<br/>FORWARD.</span></div></div>;
  return <div className="chapter-art coin-art" aria-hidden="true"><div className="coin coin-back"/><div className="coin coin-front"><CircleDollarSign/></div><span className="coin-orbit"/><span className="coin-caption">EVERY DETAIL. ACCOUNTED FOR.</span></div>;
}

export function Landing(){
  const root=useRef<HTMLDivElement>(null);
  const workflow=useRef<HTMLElement>(null);
  const track=useRef<HTMLDivElement>(null);
  const [menu,setMenu]=useState(false);
  const [paused,setPaused]=useState(false);
  const [active,setActive]=useState(0);
  const scrollSequence=useRef<ScrollTrigger|null>(null);

  useLayoutEffect(()=>{
    const mm=gsap.matchMedia();
    mm.add({ animated:'(prefers-reduced-motion: no-preference)', desktop:'(min-width: 900px)' },(context)=>{
      if(!context.conditions?.animated || paused) return;
      const ctx=gsap.context(()=>{
        gsap.from('.cinema-title .title-line>span',{yPercent:115,rotate:4,stagger:.13,duration:1.15,ease:'power4.out'});
        gsap.from('.hero-intro, .cinema-hero-bottom',{opacity:0,y:22,duration:.9,delay:.35,ease:'power2.out'});
        gsap.fromTo('.hero-sculpture',{scale:1.13},{scale:1,duration:1.8,ease:'power2.out'});
        gsap.to('.hero-image-layer',{yPercent:23,scale:1.07,ease:'none',scrollTrigger:{trigger:'.cinema-hero',start:'top top',end:'bottom top',scrub:1}});
        gsap.to('.cinema-title',{yPercent:-24,ease:'none',scrollTrigger:{trigger:'.cinema-hero',start:'top top',end:'bottom top',scrub:1}});
        gsap.to('.hero-coordinate',{y:-130,rotation:30,ease:'none',scrollTrigger:{trigger:'.cinema-hero',start:'top top',end:'bottom top',scrub:1.4}});
        gsap.to('.slanted-ribbon-inner',{xPercent:-22,ease:'none',scrollTrigger:{trigger:'.slanted-ribbon',start:'top bottom',end:'bottom top',scrub:1}});
        gsap.fromTo('.manifesto-word',{color:'#b9bfae'},{color:'#1b3326',stagger:.25,ease:'none',scrollTrigger:{trigger:'.manifesto-copy',start:'top 78%',end:'bottom 45%',scrub:1}});
        gsap.fromTo('.manifesto-emphasis',{clipPath:'inset(0 100% 0 0)',rotation:-5},{clipPath:'inset(0 0% 0 0)',rotation:-3,duration:1,ease:'expo.inOut',scrollTrigger:{trigger:'.manifesto-emphasis',start:'top 85%'}});
        gsap.utils.toArray<HTMLElement>('.motion-reveal').forEach(el=>gsap.from(el,{y:35,opacity:0,duration:.8,ease:'power3.out',scrollTrigger:{trigger:el,start:'top 90%',once:true}}));
        const portal=gsap.timeline({scrollTrigger:{trigger:'.connection-scene',start:context.conditions?.desktop?'top top':'top 75%',end:context.conditions?.desktop?'+=85%':'bottom 20%',pin:!!context.conditions?.desktop,scrub:1,anticipatePin:1,invalidateOnRefresh:true}});
        portal.fromTo('.connection-window',{clipPath:'inset(12% 24% 12% 24% round 260px)'},{clipPath:'inset(0% 0% 0% 0% round 0px)',ease:'none'},0);
        portal.fromTo('.connection-image',{scale:1.4,yPercent:-8},{scale:1,yPercent:4,ease:'none'},0);
        portal.fromTo('.connection-title',{y:80,opacity:0},{y:0,opacity:1,ease:'power1.out'},.3);
        if(context.conditions?.desktop && track.current && workflow.current){
          const distance=()=>Math.max(0,track.current!.scrollWidth-window.innerWidth);
          const horizontal=gsap.to(track.current,{x:()=>-distance(),ease:'none',scrollTrigger:{trigger:workflow.current,start:'top top',end:()=>`+=${distance()+250}`,pin:true,scrub:1,anticipatePin:1,invalidateOnRefresh:true,onUpdate:self=>setActive(Math.min(3,Math.round(self.progress*3)))}});
          scrollSequence.current=horizontal.scrollTrigger??null;
          gsap.utils.toArray<HTMLElement>('.chapter-art').forEach((el,i)=>gsap.fromTo(el,{rotation:i%2?-7:7,y:25},{rotation:0,y:-25,ease:'none',scrollTrigger:{trigger:el,containerAnimation:horizontal,start:'left right',end:'right left',scrub:true}}));
        }
        gsap.to('.outro-art',{yPercent:-15,rotation:-7,ease:'none',scrollTrigger:{trigger:'.motion-outro',start:'top bottom',end:'bottom top',scrub:1.5}});
        gsap.fromTo('.outro-title',{y:80},{y:-20,ease:'none',scrollTrigger:{trigger:'.motion-outro',start:'top bottom',end:'bottom top',scrub:1}});
      },root);
      return()=>{scrollSequence.current=null;ctx.revert()};
    });
    let alive=true;
    document.fonts?.ready.then(()=>{if(alive)ScrollTrigger.refresh()});
    return()=>{alive=false;mm.revert()};
  },[paused]);

  function jumpChapter(index:number){
    setActive(index);
    const sequence=scrollSequence.current;
    if(sequence){window.scrollTo({top:sequence.start+(sequence.end-sequence.start)*index/3,behavior:'auto'})}
    else document.getElementById(`chapter-${index}`)?.scrollIntoView({behavior:paused?'auto':'smooth',block:'center'});
  }
  return <div ref={root} className={`cinematic ${paused?'motion-paused':''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <nav className="cinema-nav"><Brand/><div className={`cinema-nav-links ${menu?'open':''}`}><a href="#platform" onClick={()=>setMenu(false)}>The big picture</a><a href="#workflow" onClick={()=>setMenu(false)}>The flow</a><a href="#why-dealos" onClick={()=>setMenu(false)}>Why DealOS</a><a className="cinema-mobile-login" href="/sign-in">Sign in <ArrowUpRight/></a></div><div className="cinema-nav-end"><a className="cinema-login" href="/sign-in">Sign in <ArrowUpRight/></a><a className="cinema-button compact" href="/sign-up">Get started <ArrowUpRight/></a><button className="cinema-menu" aria-expanded={menu} aria-label={menu?'Close navigation':'Open navigation'} onClick={()=>setMenu(!menu)}>{menu?<X/>:<Menu/>}</button></div></nav>
    <main id="main">
      <section className="cinema-hero">
        <div className="hero-image-layer" aria-hidden="true"><img className="hero-sculpture" src="/images/momentum-sculpture.png" alt="" width="1536" height="1024" fetchPriority="high"/></div><div className="hero-photo-shade"/>
        <div className="hero-intro"><span className="live-spark"/> THE OPERATING SYSTEM FOR EVERY DEAL<span className="intro-version">DEALOS / VOL. 01</span></div>
        <h1 className="cinema-title" aria-label="Every deal. In motion."><span className="title-line"><span>EVERY DEAL.</span></span><span className="title-line lime-line"><span>IN MOTION<span className="title-dot">.</span></span></span></h1>
        <div className="hero-coordinate" aria-hidden="true"><span>LESS FRICTION</span><svg viewBox="0 0 90 90"><path d="M45 5v80M5 45h80M17 17l56 56M17 73l56-56"/></svg><span>MORE FORWARD</span></div>
        <div className="cinema-hero-bottom"><div><p>From the first quote to the final payment.<br/>One connected flow. Unstoppable potential.</p><a className="cinema-button" href="/sign-up">Make your next move <ArrowUpRight/></a></div><a className="scroll-dial" href="#platform"><span>SCROLL TO<br/>MOVE FORWARD</span><ArrowDown/></a><span className="hero-side-note">BUILT FOR THE BUSINESS<br/>YOU’RE BECOMING.</span></div>
      </section>
      <div className="slanted-ribbon" aria-label="Quote. Approve. Fulfill. Bill."><div className="slanted-ribbon-inner" aria-hidden="true">{[0,1,2].map(n=><span key={n}>QUOTE <b>✳</b> APPROVE <b>✳</b> FULFILL <b>✳</b> BILL <b>✳</b></span>)}</div></div>
      <section className="manifesto" id="platform"><div className="motion-eyebrow"><span>01 / A DIFFERENT KIND OF FLOW</span><span>CONNECT THE DOTS. MOVE THE DEAL.</span></div><div className="manifesto-layout"><span className="manifesto-asterisk" aria-hidden="true">✳</span><div><h2 className="manifesto-copy">{'Great deals need more than good intentions.'.split(' ').map((word,i)=><span className="manifesto-word" key={i}>{word} </span>)}<br/><span className="manifesto-emphasis">They need momentum.</span></h2><div className="manifesto-bottom motion-reveal"><p>Too many tabs. Too many handoffs. Too much chasing.<br/>Bring sales, approvals, fulfillment, and billing into one place.<br/>Give your next big opportunity a clear way forward.</p><a href="#workflow" className="round-arrow" aria-label="Explore the deal workflow"><ArrowUpRight/></a></div></div></div></section>
      <section className="connection-scene" aria-label="Connected from beginning to end"><div className="connection-window"><img className="connection-image" src="/images/connected-sculpture.png" width="1536" height="1024" alt="Interlocking chrome, lime glass, green ceramic, and stone links representing a connected deal journey" loading="lazy" onLoad={()=>ScrollTrigger.refresh()}/><div className="connection-overlay"/><div className="connection-title"><span className="motion-eyebrow">SEPARATE TEAMS. SHARED MOMENTUM.</span><h2>Everything clicks.<br/><em>Business moves.</em></h2><span className="connection-label"><span/> CONNECTED. FROM BEGINNING TO END.</span></div></div><span className="scene-corner top-left">+</span><span className="scene-corner bottom-right">+</span></section>
      <section className="motion-workflow" id="workflow" ref={workflow}><div className="workflow-heading"><div className="motion-eyebrow">02 / FOLLOW THE FLOW</div><h2>Four moves.<br/><span>One way forward.</span></h2><div className="chapter-controls" role="group" aria-label="Choose a workflow chapter">{chapters.map((chapter,i)=><button key={chapter.name} aria-label={`Explore ${chapter.name}`} aria-pressed={active===i} onClick={()=>jumpChapter(i)}><span>0{i+1}</span>{chapter.name}</button>)}</div></div><div className="chapter-track" ref={track}>{chapters.map((chapter,i)=><article id={`chapter-${i}`} className={`motion-chapter chapter-${chapter.color}`} key={chapter.name}><div className="chapter-top"><span>{chapter.caption}</span><chapter.icon/></div><ChapterArt index={i}/><div className="chapter-text"><span className="chapter-number">0{i+1}</span><h3>{chapter.title.split('\n').map((s,j)=><span key={j}>{s}</span>)}</h3><p>{chapter.copy}</p><a href="/sign-up">Let’s {chapter.name.toLowerCase()} <ArrowUpRight/></a></div></article>)}</div><div className="workflow-progress" aria-hidden="true"><span style={{transform:`translateX(${active*100}%)`}}/></div></section>
      <section className="principles" id="why-dealos"><div className="principles-heading motion-reveal"><div className="motion-eyebrow">03 / THE DEALOS DIFFERENCE</div><h2>Big ambition.<br/><em>Small details, handled.</em></h2><p>The work behind every deal deserves<br/>as much care as the deal itself.</p></div><div className="principle-list">{[{n:'01',title:'Clarity over complexity.',text:'Every commercial line, discount, and billing cadence has a place. See the details behind your decisions.'},{n:'02',title:'Context travels with you.',text:'From ordered approvals to customer conversations, keep the next team connected to what came before.'},{n:'03',title:'Accountability comes built in.',text:'Follow the records behind approvals, stock commitments, invoices, and verified payments.'}].map(p=><article className="principle motion-reveal" key={p.n}><span>{p.n}</span><div><h3>{p.title}</h3><p>{p.text}</p></div><ArrowUpRight/></article>)}</div></section>
      <section className="motion-faq"><div className="motion-eyebrow">A FEW THINGS WORTH KNOWING</div><div className="motion-faq-grid"><h2>Clear answers.<br/><em>No loose ends.</em></h2><div>{[['Who is DealOS built for?','B2B sales teams, managers, finance, and operations teams coordinating quotations, approvals, fulfillment, and billing. Customers enter a separate restricted portal.'],['Can I explore the real workspace?','Yes. Head to sign in and select a local demo role to explore the actual DealOS workspace.'],['What happens when I sign up?','Your account request is saved as pending. Your administrator must activate access before you can sign in.'],['Does DealOS transfer payments?','DealOS records verified payments and tracks invoice balances. It does not transfer money.']].map(([q,a])=><details key={q}><summary>{q}<Plus/></summary><p>{a}</p></details>)}</div></div></section>
      <section className="motion-outro"><img className="outro-art" src="/images/momentum-sculpture.png" alt="" aria-hidden="true" width="1536" height="1024" loading="lazy"/><div className="outro-shade"/><div className="outro-content"><span className="motion-eyebrow">THE NEXT MOVE IS YOURS.</span><h2 className="outro-title">LET’S MAKE<br/><span>MOVES.</span><ArrowUpRight/></h2><a className="cinema-button" href="/sign-up">Start your next chapter <ArrowUpRight/></a></div></section>
    </main>
    <footer className="cinema-footer"><div className="footer-top"><Brand/><p>Less friction. More forward.</p><a href="/sign-in">Enter your workspace <ArrowUpRight/></a><a href="#main" aria-label="Back to top"><ArrowUpRight/></a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} DealOS</span><span>DESIGNED TO KEEP BUSINESS MOVING.</span><button aria-pressed={paused} onClick={()=>setPaused(!paused)}>{paused?<Play/>:<Pause/>}{paused?'Resume motion':'Pause motion'}</button></div></footer>
  </div>
}
