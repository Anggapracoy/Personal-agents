/** Collapse a declined suggestion, retaining an exact rollback if saving fails. */
export async function animateArchiveChoice(row: HTMLElement): Promise<() => void> {
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const front=row.querySelector<HTMLElement>('.wd-proactive-item') ?? row;
 const wasInert=row.inert; row.inert=true;
 const height=row.getBoundingClientRect().height;
 const fade=front.animate([{opacity:1},{opacity:0}],{duration:reduced?100:160,fill:'forwards',easing:'ease-out'});
 const collapse=row.animate([{height:`${height}px`,overflow:'hidden'},{height:'0px',overflow:'hidden'}],{duration:reduced?100:240,delay:reduced?0:60,fill:'forwards',easing:'cubic-bezier(.22,1,.36,1)'});
 await Promise.allSettled([fade.finished,collapse.finished]);
 return ()=>{fade.cancel();collapse.cancel();row.inert=wasInert;};
}
