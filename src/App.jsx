import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, getDoc, setDoc, getDocs, query, where, updateDoc } from "firebase/firestore";

// ── Firebase config ────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBNIBqorJRrYEdEiA8vFAudU_wKYC0V_9w",
  authDomain: "moveitmay26.firebaseapp.com",
  projectId: "moveitmay26",
  storageBucket: "moveitmay26.firebasestorage.app",
  messagingSenderId: "447998184360",
  appId: "1:447998184360:web:41038b507224178e3a6b9d",
  measurementId: "G-FTT3GYPKCZ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SESSION_KEY = "mim-session";
const GOAL_DAYS       = 20;
const CHALLENGE_MONTH = 3;

// ── Skin tones ────────────────────────────────────────────────────────────────
const SKIN_TONES    = [
  { label:"Default",      mod:"" },
  { label:"Light",        mod:"\u{1F3FB}" },
  { label:"Medium-Light", mod:"\u{1F3FC}" },
  { label:"Medium",       mod:"\u{1F3FD}" },
  { label:"Medium-Dark",  mod:"\u{1F3FE}" },
  { label:"Dark",         mod:"\u{1F3FF}" },
];
const TONE_COLORS   = ["#F5CFA0","#F1C27D","#E0AC69","#C68642","#8D5524","#4A2912"];
const TONE_ELIGIBLE = new Set(["💪","👏","🙌","✊","👋"]);
const STRIP_RE      = /[\u{1F3FB}-\u{1F3FF}]/gu;
const stripTone = (e) => e.replace(STRIP_RE,"");
const addTone   = (e,m) => (!m||!TONE_ELIGIBLE.has(e)) ? e : e+m;

// Text-only workout types (no emoji)
const TYPES = ["Walk","Run","Bike","Lift","Stretch","Dance","Swim","Other"];
const REACTS = ["🔥","💪","👏","🙌","✊"];

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  black:    "#ffffff",
  offblack: "#f5f0e8",
  card:     "#ffffff",
  cardHov:  "#fdf8f2",
  border:   "#e8ddd0",
  borderBright: "#d4c8b8",
  accent:   "#e85d36",
  accentDim:"rgba(232,93,54,0.10)",
  white:    "#141414",
  gray1:    "#8a7868",
  gray2:    "#bfb0a0",
  meHighlight: "rgba(232,93,54,0.06)",
};

const HERO = "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=900&q=80";
const FONTS = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500&display=swap";

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(ts) {
  const m=Math.floor((Date.now()-ts)/60000);
  if(m<1) return "just now";
  if(m<60) return `${m}m ago`;
  const h=Math.floor(m/60);
  if(h<24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}
function dayLabel(ts) {
  const d=new Date(ts), today=new Date(), yest=new Date();
  yest.setDate(today.getDate()-1);
  if(d.toDateString()===today.toDateString()) return "TODAY";
  if(d.toDateString()===yest.toDateString()) return "YESTERDAY";
  return d.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"}).toUpperCase();
}
function getMayDays(posts,email) {
  const days=new Set(
    posts.filter(p=>p.authorEmail===email && new Date(p.ts).getMonth()===CHALLENGE_MONTH)
         .map(p=>new Date(p.ts).toDateString())
  );
  return days.size;
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()); }
async function compressImage(file,maxW=900,q=0.75) {
  return new Promise(res=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const ratio=Math.min(maxW/img.width,1);
        const canvas=document.createElement("canvas");
        canvas.width=img.width*ratio; canvas.height=img.height*ratio;
        canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
        res(canvas.toDataURL("image/jpeg",q));
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Speed lines decoration ────────────────────────────────────────────────────
const SpeedLines = ({style={}}) => (
  <div style={{
    position:"absolute", inset:0, pointerEvents:"none", overflow:"hidden",
    background:"repeating-linear-gradient(100deg, transparent 0px, transparent 18px, rgba(0,0,0,0.018) 18px, rgba(0,0,0,0.018) 19px)",
    ...style
  }}/>
);

export default function MoveItMay() {
  const [step,setStep]               = useState("welcome");
  const [posts,setPosts]             = useState([]);
  const [imgs,setImgs]               = useState({});
  const [profile,setProfile]         = useState(null);
  const [emailIn,setEmailIn]         = useState("");
  const [nameIn,setNameIn]           = useState("");
  const [whyIn,setWhyIn]             = useState("");
  const [emailErr,setEmailErr]       = useState("");
  const [loading,setLoading]         = useState(false);
  const [text,setText]               = useState("");
  const [selType,setSelType]         = useState(null);
  const [pendImg,setPendImg]         = useState(null);
  const [posting,setPosting]         = useState(false);
  const [tonePopover,setTonePopover] = useState(null);
  const [tab,setTab]                 = useState("feed");
  const [expandedReplies,setExpandedReplies] = useState({});
  const [replyText,setReplyText]     = useState({});
  const holdTimer = useRef(null);
  const tone = profile?.tone || "";

  // ── Load initial data from Firestore ───────────────────────────────────────
  useEffect(()=>{
    (async()=>{
      try{
        // Load all posts
        const postsSnap = await getDocs(collection(db, "posts"));
        const loaded = postsSnap.docs.map(d => d.data()).sort((a,b) => b.ts - a.ts);
        setPosts(loaded);
        
        // Load images for posts that have them
        loaded.forEach(async post=>{
          if(post.hasImage){
            try{
              const imgSnap = await getDoc(doc(db, "postImages", String(post.id)));
              if(imgSnap.exists()){
                setImgs(prev=>({...prev,[post.id]:imgSnap.data().img}));
              }
            }catch{}
          }
        });
      }catch{}

      // Check if user is returning
      try{
        const saved = localStorage.getItem(SESSION_KEY);
        if(saved){
          const pr = await getDoc(doc(db, "profiles", saved));
          if(pr.exists()){ 
            setProfile(pr.data()); 
            setStep("app"); 
          }
        }
      }catch{}
    })();
  },[]);

  const savePosts=async(u)=>{ 
    setPosts(u);
    // Write each post to Firestore
    try{
      for(const post of u){
        await setDoc(doc(db, "posts", String(post.id)), post);
      }
    }catch(e){
      console.error("Error saving posts:", e);
    }
  };

  const handleEmailContinue=async()=>{
    setEmailErr("");
    if(!validEmail(emailIn)){ setEmailErr("Enter a valid email to continue."); return; }
    setLoading(true);
    try{
      const normalizedEmail = emailIn.toLowerCase().trim();
      const pr = await getDoc(doc(db, "profiles", normalizedEmail));
      if(pr.exists()){ 
        setProfile(pr.data()); 
        localStorage.setItem(SESSION_KEY, normalizedEmail);
        setStep("app"); 
      }
      else setStep("newuser");
    }catch{ 
      setStep("newuser"); 
    }
    setLoading(false);
  };

  const handleCreateProfile=async()=>{
    if(!nameIn.trim()) return;
    const normalizedEmail = emailIn.toLowerCase().trim();
    const pr={name:nameIn.trim(),email:normalizedEmail,why:whyIn.trim(),tone:"",joinedAt:Date.now()};
    setProfile(pr);
    try{
      await setDoc(doc(db, "profiles", normalizedEmail), pr);
      localStorage.setItem(SESSION_KEY, normalizedEmail);
    }catch(e){
      console.error("Error creating profile:", e);
    }
    setStep("app");
  };

  const saveTone=async(mod)=>{
    const updated={...profile,tone:mod};
    setProfile(updated);
    setTonePopover(null);
    try{
      await updateDoc(doc(db, "profiles", updated.email), {tone:mod});
    }catch(e){
      console.error("Error saving tone:", e);
    }
  };

  const onHoldStart=(ev)=>{
    ev.preventDefault();
    const rect=ev.currentTarget.getBoundingClientRect();
    holdTimer.current=setTimeout(()=>{
      setTonePopover({x:Math.max(8,rect.left+rect.width/2-120),y:Math.max(8,rect.top-62)});
    },420);
  };
  const onHoldEnd=()=>clearTimeout(holdTimer.current);

  const handleImgChange=async(e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    setPendImg(await compressImage(f)); e.target.value="";
  };

  const handlePost=async()=>{
    if(!text.trim()&&!selType&&!pendImg) return;
    setPosting(true);
    const id=Date.now();
    const post={id,authorEmail:profile.email,authorName:profile.name,why:profile.why,type:selType,text:text.trim(),ts:id,cheers:{},replies:[],hasImage:!!pendImg};
    
    // Save post to Firestore
    try{
      await setDoc(doc(db, "posts", String(id)), post);
      
      // Save image separately if exists
      if(pendImg){ 
        await setDoc(doc(db, "postImages", String(id)), {img:pendImg});
        setImgs(prev=>({...prev,[id]:pendImg})); 
      }
      
      await savePosts([post,...posts]);
    }catch(e){
      console.error("Error posting:", e);
    }
    setText(""); setSelType(null); setPendImg(null); setPosting(false);
  };

  const handleReact=async(postId,baseE)=>{
    const updated=posts.map(p=>{
      if(p.id!==postId) return p;
      const c={...p.cheers},key=`${profile.email}:${baseE}`;
      if(c[key]) delete c[key]; else c[key]=true;
      return {...p,cheers:c};
    });
    await savePosts(updated);
  };

  const handleReply=async(postId)=>{
    const replyMsg = replyText[postId]?.trim();
    if(!replyMsg) return;
    
    const updated=posts.map(p=>{
      if(p.id!==postId) return p;
      const replies = p.replies || [];
      const newReply = {id:Date.now(),authorEmail:profile.email,authorName:profile.name,text:replyMsg,ts:Date.now()};
      return {...p,replies:[...replies,newReply]};
    });
    await savePosts(updated);
    setReplyText({...replyText,[postId]:""});
  };

  const rCount=(p,e)=>Object.keys(p.cheers||{}).filter(k=>k.endsWith(`:${e}`)).length;
  const myR=(p,e)=>profile&&!!(p.cheers||{})[`${profile.email}:${e}`];

  const mayDays   = profile ? getMayDays(posts,profile.email) : 0;
  const pct       = Math.min((mayDays/GOAL_DAYS)*100,100);
  const qualified = mayDays>=GOAL_DAYS;

  const grouped=posts.reduce((acc,p)=>{
    const l=dayLabel(p.ts); if(!acc[l]) acc[l]=[]; acc[l].push(p); return acc;
  },{});

  const leaderboard=(() => {
    const map={};
    posts.forEach(p=>{
      if(!map[p.authorEmail]) map[p.authorEmail]={name:p.authorName,email:p.authorEmail,why:p.why,days:new Set()};
      if(new Date(p.ts).getMonth()===CHALLENGE_MONTH) map[p.authorEmail].days.add(new Date(p.ts).toDateString());
    });
    return Object.values(map).map(u=>({...u,count:u.days.size})).sort((a,b)=>b.count-a.count);
  })();

  // ── Shared input style ────────────────────────────────────────────────────
  const inputS={
    width:"100%", background:"rgba(0,0,0,0.06)", border:`1px solid ${C.border}`,
    borderRadius:4, padding:"14px 16px", color:"#141414", fontSize:16,
    fontFamily:"'Barlow',sans-serif", outline:"none", boxSizing:"border-box",
    backdropFilter:"blur(8px)",
  };
  const labelS={
    fontSize:17, letterSpacing:"0.14em", textTransform:"uppercase",
    color:C.gray1, marginBottom:8, display:"block", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:600,
  };
  const ctaBtn=(extra={})=>({
    background:C.accent, color:C.black, border:"none", borderRadius:2,
    padding:"16px 0", width:"100%", fontSize:20, fontWeight:700,
    fontFamily:"'Bebas Neue',sans-serif", letterSpacing:"0.08em",
    cursor:"pointer", ...extra,
  });

  // ── WELCOME ───────────────────────────────────────────────────────────────
  if(step==="welcome") return(
    <>
      <link href={FONTS} rel="stylesheet"/>
      <div style={{minHeight:"100vh",background:"#ffffff",fontFamily:"'Barlow',sans-serif",color:"#141414",display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* Hero image with motion blur overlay */}
        <div style={{position:"relative",height:"52vh",minHeight:280,overflow:"hidden",flexShrink:0}}>
          <img src={HERO} alt="athlete in motion"
            style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center 30%",filter:"blur(1.5px) brightness(0.72)",transform:"scale(1.05)"}}/>
          {/* Speed streak overlay */}
          <div style={{position:"absolute",inset:0,background:"repeating-linear-gradient(100deg,transparent 0px,transparent 22px,rgba(0,0,0,0.08) 22px,rgba(0,0,0,0.08) 23px)"}}/>
          {/* Bottom fade */}
          <div style={{position:"absolute",bottom:0,left:0,right:0,height:"60%",background:"linear-gradient(to top, #ffffff, transparent)"}}/>
          {/* Logo stamped on image */}
          <div style={{position:"absolute",bottom:20,left:20,right:20}}>
            <p style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:72,lineHeight:0.92,color:"#141414",margin:0,letterSpacing:"0.02em"}}>
              MOVE IT<br/>
              <span style={{color:C.accent}}>MAY</span>
            </p>
            <p style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,letterSpacing:"0.18em",color:"rgba(20,20,20,0.45)",marginTop:6,textTransform:"uppercase"}}>
              Community Movement Challenge · May 2026
            </p>
          </div>
        </div>

        {/* Content */}
        <div style={{flex:1,padding:"24px 20px 40px",display:"flex",flexDirection:"column",gap:16}}>

          {/* What is this */}
          <div style={{position:"relative",background:"#ffffff",border:`1px solid ${C.border}`,borderRadius:4,padding:"16px 18px",boxShadow:"0 2px 12px rgba(0,0,0,0.06)",overflow:"hidden"}}>
            <SpeedLines/>
            <p style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,letterSpacing:"0.18em",color:C.accent,marginBottom:8,fontWeight:600}}>THE CHALLENGE</p>
            <p style={{fontSize:16,color:"#4a3828",lineHeight:1.65,margin:0,fontFamily:"'Barlow',sans-serif"}}>
              31 days. Any movement counts. Show up, log your moves, push each other. Hit your goal and you could win back your entry and then some.
            </p>
          </div>

          {/* Rules */}
          <div style={{position:"relative",background:"#ffffff",border:`1px solid ${C.border}`,borderRadius:4,padding:"16px 18px",boxShadow:"0 2px 12px rgba(0,0,0,0.06)",overflow:"hidden"}}>
            <SpeedLines/>
            <p style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,letterSpacing:"0.18em",color:C.accent,marginBottom:12,fontWeight:600}}>THE RULES</p>
            {[
              ["01", "Move 15+ minutes per session. Any movement counts."],
              ["02", "Post it in the app. It only counts if it's logged."],
              ["03", "Hit 20 days by May 31 to qualify for the prize."],
            ].map(([num,txt])=>(
              <div key={num} style={{display:"flex",gap:14,marginBottom:10,alignItems:"flex-start"}}>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:C.accent,flexShrink:0,lineHeight:1.2,position:"relative"}}>{num}</span>
                <p style={{fontSize:16,color:"#4a3828",lineHeight:1.55,margin:0}}>{txt}</p>
              </div>
            ))}
          </div>

          {/* Prize */}
          <div style={{position:"relative",background:"linear-gradient(135deg,#fff8f5,#ffeee6)",border:`1px solid rgba(232,93,54,0.25)`,borderRadius:4,padding:"16px 18px",backdropFilter:"blur(12px)",overflow:"hidden"}}>
            <SpeedLines/>
            <p style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,letterSpacing:"0.18em",color:C.accent,marginBottom:8,fontWeight:600}}>THE 50/50 PRIZE</p>
            <p style={{fontSize:16,color:"#4a3828",lineHeight:1.65,margin:0}}>
              Everyone who qualifies gets entered in a raffle. One winner takes 50% of the total pot. More people in means a bigger prize.
            </p>
          </div>

          <button style={ctaBtn({marginTop:"auto"})} onClick={()=>setStep("email")}>
            I'M IN
          </button>
        </div>
      </div>
    </>
  );

  // ── EMAIL ─────────────────────────────────────────────────────────────────
  if(step==="email") return(
    <>
      <link href={FONTS} rel="stylesheet"/>
      <div style={{minHeight:"100vh",background:"#ffffff",fontFamily:"'Barlow',sans-serif",color:"#141414",display:"flex",flexDirection:"column",padding:"52px 20px 40px",position:"relative",overflow:"hidden"}}>
        <SpeedLines style={{opacity:0.5}}/>
        <p style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:52,lineHeight:0.95,color:C.white,margin:"0 0 4px"}}>
          LET'S<br/><span style={{color:C.accent}}>GO.</span>
        </p>
        <p style={{color:"#6a5848",fontSize:16,marginBottom:40,lineHeight:1.6,fontFamily:"'Barlow',sans-serif"}}>
          Enter your email to get started, or to pick up where you left off on another device.
        </p>

        <label style={labelS}>Your email</label>
        <input
          style={{...inputS,marginBottom:emailErr?6:12,borderColor:emailErr?"#e85d36":C.border}}
          type="email" placeholder="you@example.com"
          value={emailIn} onChange={e=>{setEmailIn(e.target.value);setEmailErr("");}}
          onKeyDown={e=>e.key==="Enter"&&handleEmailContinue()}
          autoCapitalize="off" autoCorrect="off"
        />
        {emailErr&&<p style={{fontSize:16,color:"#e85d36",marginBottom:12,fontFamily:"'Barlow',sans-serif"}}>{emailErr}</p>}
        <p style={{fontSize:16,color:C.gray2,marginBottom:32,lineHeight:1.6}}>
          Your email is your key. Use the same one on any device to access your profile and progress.
        </p>

        <button style={ctaBtn({marginTop:"auto",opacity:loading?0.6:1})} onClick={handleEmailContinue} disabled={loading}>
          {loading?"CHECKING...":"CONTINUE"}
        </button>
      </div>
    </>
  );

  // ── NEW USER ──────────────────────────────────────────────────────────────
  if(step==="newuser") return(
    <>
      <link href={FONTS} rel="stylesheet"/>
      <div style={{minHeight:"100vh",background:"#ffffff",fontFamily:"'Barlow',sans-serif",color:"#141414",display:"flex",flexDirection:"column",padding:"52px 20px 40px",position:"relative",overflow:"hidden"}}>
        <SpeedLines style={{opacity:0.5}}/>
        <p style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:48,lineHeight:0.95,color:C.white,margin:"0 0 4px"}}>
          YOU'RE<br/><span style={{color:C.accent}}>IN.</span>
        </p>
        <p style={{color:"#6a5848",fontSize:16,marginBottom:36,lineHeight:1.6}}>
          Tell the crew who you are.
        </p>

        <label style={labelS}>Your name</label>
        <input
          style={{...inputS,marginBottom:24}}
          placeholder="First name or nickname"
          value={nameIn} onChange={e=>setNameIn(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&document.getElementById("why-in")?.focus()}
        />

        <label style={labelS}>Why are you joining Move It May?</label>
        <textarea
          id="why-in"
          style={{...inputS,resize:"none",lineHeight:1.6,marginBottom:6,fontSize:16}}
          rows={4}
          placeholder="e.g. I want to feel stronger, stop making excuses..."
          value={whyIn} onChange={e=>setWhyIn(e.target.value)}
        />
        <p style={{fontSize:17,color:C.gray2,marginBottom:32,fontFamily:"'Barlow',sans-serif"}}>
          This is visible to everyone in the group. It is your public motivation.
        </p>

        <button style={ctaBtn({marginTop:"auto"})} onClick={handleCreateProfile}>
          LET'S MOVE
        </button>
      </div>
    </>
  );

  // ── MAIN APP ──────────────────────────────────────────────────────────────
  return(
    <>
      <link href={FONTS} rel="stylesheet"/>

      {/* Tone popover */}
      {tonePopover&&(
        <>
          <div onClick={()=>setTonePopover(null)} style={{position:"fixed",inset:0,zIndex:100}}/>
          <div style={{position:"fixed",left:tonePopover.x,top:tonePopover.y,zIndex:101,background:"#ffffff",border:`1px solid ${C.border}`,borderRadius:50,padding:"10px 14px",display:"flex",gap:10,boxShadow:"0 8px 32px rgba(0,0,0,0.18)",alignItems:"center"}}>
            {SKIN_TONES.map((t,i)=>(
              <button key={i} onClick={()=>saveTone(t.mod)} title={t.label}
                style={{width:tone===t.mod?36:28,height:tone===t.mod?36:28,borderRadius:"50%",background:TONE_COLORS[i],border:`3px solid ${tone===t.mod?C.accent:"#e8ddd0"}`,cursor:"pointer",outline:"none",transition:"all 0.15s",flexShrink:0}}/>
            ))}
          </div>
        </>
      )}

      <div style={{minHeight:"100vh",background:"#f5f0e8",fontFamily:"'Barlow',sans-serif",color:"#141414",paddingBottom:80}}>

        {/* Header */}
        <div style={{position:"sticky",top:0,zIndex:10,background:"rgba(255,255,255,0.94)",borderBottom:`1px solid ${C.border}`,backdropFilter:"blur(16px)",padding:"12px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:"0.04em",color:C.white}}>
              MOVE IT <span style={{color:C.accent}}>MAY</span>
            </span>
          </div>
          {/* Progress */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
            <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:17,letterSpacing:"0.1em",color:C.gray1}}>
              {profile?.name?.toUpperCase()}
            </span>
            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:qualified?C.accent:C.white,letterSpacing:"0.06em"}}>
              {qualified?"GOAL REACHED":`${mayDays} / ${GOAL_DAYS} DAYS`}
            </span>
          </div>
          <div style={{height:3,background:"rgba(0,0,0,0.08)",borderRadius:0,overflow:"hidden"}}>
            <div style={{height:"100%",background:qualified?C.accent:`linear-gradient(90deg,${C.accent}88,${C.accent})`,width:`${pct}%`,transition:"width 0.5s"}}/>
          </div>
        </div>

        {/* Qualified banner */}
        {qualified&&(
          <div style={{background:C.accentDim,borderBottom:`1px solid rgba(232,93,54,0.2)`,padding:"10px 16px",textAlign:"center"}}>
            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:"0.1em",color:C.accent}}>
              YOU HIT 20 DAYS. YOU ARE ENTERED IN THE RAFFLE.
            </span>
          </div>
        )}

        {/* Composer */}
        <div style={{position:"relative",background:"#f5f0e8",border:"none",borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,padding:"14px 16px",overflow:"hidden"}}>
          <SpeedLines style={{opacity:0.4}}/>
          {/* Type chips */}
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4,marginBottom:12}}>
            {TYPES.map(t=>{
              const active=selType===t;
              return(
                <button key={t}
                  style={{background:active?C.accent:"#ffffff",color:active?C.black:C.gray1,border:`1px solid ${active?C.accent:C.border}`,borderRadius:2,padding:"6px 14px",fontSize:17,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,letterSpacing:"0.1em",flexShrink:0,transition:"all 0.15s"}}
                  onClick={()=>setSelType(active?null:t)}>
                  {t.toUpperCase()}
                </button>
              );
            })}
          </div>

          <textarea
            style={{width:"100%",background:"#ffffff",border:`1px solid ${C.border}`,borderRadius:2,padding:12,color:C.white,fontSize:16,resize:"none",fontFamily:"'Barlow',sans-serif",boxSizing:"border-box",outline:"none",marginBottom:10,lineHeight:1.55}}
            rows={3}
            placeholder="What did you do? Push the crew forward..."
            value={text}
            onChange={e=>setText(e.target.value)}
          />

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <div style={{position:"relative",display:"inline-block"}}>
                <div style={{background:"transparent",border:`1px solid rgba(255,255,255,0.2)`,borderRadius:2,padding:"8px 14px",fontSize:17,color:"rgba(20,20,20,0.45)",whiteSpace:"nowrap",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,letterSpacing:"0.1em",pointerEvents:"none"}}>
                  + PHOTO
                </div>
                <input type="file" accept="image/*" onChange={handleImgChange}
                  style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%",fontSize:0}}/>
              </div>
              {pendImg&&(
                <div style={{position:"relative"}}>
                  <img src={pendImg} style={{width:44,height:44,objectFit:"cover",borderRadius:2,border:`1px solid ${C.border}`}} alt="preview"/>
                  <button onClick={()=>setPendImg(null)}
                    style={{position:"absolute",top:-5,right:-5,width:16,height:16,borderRadius:"50%",background:C.accent,color:C.black,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>x</button>
                </div>
              )}
            </div>
            <button
              style={{background:C.accent,color:C.black,border:"none",borderRadius:2,padding:"10px 22px",fontSize:17,fontWeight:700,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.1em",cursor:"pointer",opacity:posting?0.6:1}}
              onClick={handlePost} disabled={posting}>
              {posting?"...":"POST MOVE"}
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:"rgba(255,255,255,0.97)"}}>
          {[["feed","FEED"],["leaderboard","LEADERBOARD"]].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id)}
              style={{flex:1,padding:"13px 0",fontSize:16,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:"0.14em",border:"none",cursor:"pointer",background:"transparent",color:tab===id?C.accent:C.gray1,borderBottom:tab===id?`2px solid ${C.accent}`:"2px solid transparent",transition:"all 0.15s"}}>
              {label}
            </button>
          ))}
        </div>

        {/* Feed */}
        {tab==="feed"&&(
          posts.length===0?(
            <div style={{padding:"64px 20px",textAlign:"center"}}>
              <p style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:40,color:"rgba(0,0,0,0.12)",letterSpacing:"0.06em"}}>NO MOVES YET</p>
              <p style={{color:C.gray2,fontSize:16,fontFamily:"'Barlow',sans-serif"}}>Be the first to post.</p>
            </div>
          ):(
            Object.entries(grouped).map(([date,dayPosts])=>(
              <div key={date}>
                <div style={{display:"flex",alignItems:"center",gap:12,padding:"18px 16px 6px"}}>
                  <div style={{flex:1,height:1,background:"rgba(0,0,0,0.06)"}}/>
                  <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,color:C.gray2,letterSpacing:"0.18em",whiteSpace:"nowrap"}}>{date}</span>
                  <div style={{flex:1,height:1,background:"rgba(0,0,0,0.06)"}}/>
                </div>
                {dayPosts.map(post=>(
                  <div key={post.id} style={{position:"relative",background:C.card,borderBottom:`1px solid ${C.border}`,padding:"14px 16px",overflow:"hidden",boxShadow:"0 1px 0 #e8ddd0"}}>
                    <SpeedLines style={{opacity:0.3}}/>
                    <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10,position:"relative"}}>
                      <div style={{width:32,height:32,borderRadius:2,background:C.accentDim,border:`1px solid rgba(232,93,54,0.25)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:700,color:C.accent,flexShrink:0,fontFamily:"'Bebas Neue',sans-serif"}}>
                        {post.authorName?.[0]?.toUpperCase()}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:17,color:"#141414",letterSpacing:"0.04em"}}>{post.authorName?.toUpperCase()}</span>
                          <span style={{fontSize:16,color:C.gray2,flexShrink:0,marginLeft:8,fontFamily:"'Barlow',sans-serif"}}>{timeAgo(post.ts)}</span>
                        </div>
                        {post.why&&<p style={{fontSize:17,color:C.gray2,margin:"2px 0 0",fontStyle:"italic",lineHeight:1.4}}>"{post.why}"</p>}
                      </div>
                    </div>

                    {post.type&&(
                      <div style={{display:"inline-block",background:"transparent",border:`1px solid rgba(255,255,255,0.15)`,borderRadius:2,padding:"3px 10px",fontSize:16,color:"rgba(20,20,20,0.45)",marginBottom:8,fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,letterSpacing:"0.12em",position:"relative"}}>
                        {post.type.toUpperCase()}
                      </div>
                    )}
                    {post.text&&<p style={{fontSize:16,color:"#2a1f17",lineHeight:1.6,marginBottom:post.hasImage?10:12,position:"relative"}}>{post.text}</p>}
                    {imgs[post.id]&&<img src={imgs[post.id]} style={{width:"100%",borderRadius:2,marginBottom:10,maxHeight:320,objectFit:"cover",display:"block",position:"relative"}} alt="workout"/>}

                    <div style={{display:"flex",gap:6,flexWrap:"wrap",position:"relative",marginBottom:8}}>
                      {REACTS.map(e=>{
                        const be=stripTone(e);
                        const count=rCount(post,be);
                        const active=myR(post,be);
                        return(
                          <button key={e}
                            style={{background:active?C.accentDim:"transparent",border:`1px solid ${active?C.accent:C.border}`,borderRadius:2,padding:"5px 10px",fontSize:16,cursor:"pointer",color:active?C.accent:C.gray1,fontFamily:"'Barlow',sans-serif",transition:"all 0.15s",userSelect:"none",WebkitUserSelect:"none"}}
                            onMouseDown={onHoldStart} onMouseUp={onHoldEnd} onMouseLeave={onHoldEnd}
                            onTouchStart={onHoldStart} onTouchEnd={onHoldEnd}
                            onClick={()=>handleReact(post.id,be)}
                            title="Tap to react. Hold to change skin tone.">
                            {addTone(e,tone)}{count>0?` ${count}`:""}
                          </button>
                        );
                      })}
                    </div>
                    <p style={{fontSize:11,color:C.gray2,margin:"4px 0 8px",fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:"0.1em"}}>Hold reaction to set tone</p>

                    {/* Replies section */}
                    {(post.replies || []).length > 0 && (
                      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10,marginTop:10}}>
                        {post.replies.map(reply=>(
                          <div key={reply.id} style={{marginBottom:8,fontSize:16,display:"flex",justifyContent:"flex-end"}}>
                            <div style={{maxWidth:"85%",background:C.accentDim,borderLeft:`3px solid ${C.accent}`,paddingLeft:12,paddingRight:12,paddingTop:6,paddingBottom:6,borderRadius:4}}>
                              <div style={{display:"flex",gap:8,marginBottom:2,justifyContent:"space-between"}}>
                                <strong style={{color:C.accent}}>{reply.authorName}</strong>
                                <span style={{fontSize:16,color:C.gray2}}>{timeAgo(reply.ts)}</span>
                              </div>
                              <p style={{margin:0,color:"#2a1f17",lineHeight:1.5}}>{reply.text}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Reply composer */}
                    {expandedReplies[post.id] && (
                      <div style={{display:"flex",gap:8,marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                        <input
                          type="text"
                          placeholder="Reply..."
                          value={replyText[post.id] || ""}
                          onChange={(e)=>setReplyText({...replyText,[post.id]:e.target.value})}
                          style={{flex:1,padding:"8px 10px",fontSize:16,border:`1px solid ${C.border}`,borderRadius:2,outline:"none"}}
                          onKeyDown={(e)=>e.key==="Enter"&&handleReply(post.id)}
                        />
                        <button
                          onClick={()=>handleReply(post.id)}
                          style={{background:C.accent,color:C.black,border:"none",borderRadius:2,padding:"8px 14px",fontSize:17,fontWeight:700,cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif"}}>
                          SEND
                        </button>
                      </div>
                    )}

                    <button
                      onClick={()=>setExpandedReplies({...expandedReplies,[post.id]:!expandedReplies[post.id]})}
                      style={{marginTop:8,background:"transparent",border:"none",color:C.accent,fontSize:16,cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,padding:0}}>
                      {expandedReplies[post.id]?"CLOSE":"REPLY"}
                    </button>
                  </div>
                ))}
              </div>
            ))
          )
        )}

        {/* Leaderboard */}
        {tab==="leaderboard"&&(
          <div style={{padding:"8px 0"}}>
            {leaderboard.length===0?(
              <div style={{padding:"64px 20px",textAlign:"center"}}>
                <p style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,color:"rgba(0,0,0,0.12)",letterSpacing:"0.06em"}}>NO DATA YET</p>
              </div>
            ):leaderboard.map((u,i)=>{
              const p2=Math.min((u.count/GOAL_DAYS)*100,100);
              const done=u.count>=GOAL_DAYS;
              const isMe=u.email===profile?.email;
              return(
                <div key={u.email} style={{position:"relative",background:isMe?C.meHighlight:C.card,borderBottom:`1px solid ${C.border}`,borderLeft:isMe?`3px solid ${C.accent}`:"3px solid transparent",padding:"14px 16px",overflow:"hidden"}}>
                  <SpeedLines style={{opacity:0.25}}/>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8,position:"relative"}}>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:i===0?C.accent:i<3?C.gray1:C.gray2,width:28,flexShrink:0,letterSpacing:"0.02em"}}>
                      {String(i+1).padStart(2,"0")}
                    </span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                        <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:17,color:isMe?C.accent:"#141414",letterSpacing:"0.04em"}}>
                          {u.name?.toUpperCase()}{isMe&&<span style={{fontSize:11,color:C.accent,marginLeft:8,fontWeight:400,letterSpacing:"0.1em"}}>YOU</span>}
                        </span>
                        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:done?C.accent:"rgba(255,255,255,0.4)",letterSpacing:"0.06em",flexShrink:0}}>
                          {done?"QUALIFIED":`${u.count} / ${GOAL_DAYS}`}
                        </span>
                      </div>
                      {u.why&&<p style={{fontSize:17,color:C.gray2,margin:"2px 0 0",fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>"{u.why}"</p>}
                    </div>
                  </div>
                  <div style={{height:2,background:"rgba(0,0,0,0.06)",overflow:"hidden",position:"relative"}}>
                    <div style={{height:"100%",background:done?C.accent:`rgba(212,245,0,0.4)`,width:`${p2}%`,transition:"width 0.5s"}}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}