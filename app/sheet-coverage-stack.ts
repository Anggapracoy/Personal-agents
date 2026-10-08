"use client";
import { hasNativeBridge, postNativeMessage } from "./native-bridge";

type Coverage = { x:number; y:number; width:number; height:number; viewportWidth:number; radius:number; opacity:number; dimming:number; headerOpacity:number };
const sheets = new Map<HTMLElement,{ refresh:()=>void; coverage?:Coverage }>();

function orderedSheets() {
  return [...sheets.keys()].filter(sheet=>sheet.isConnected).sort((a,b)=>a===b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
}

export function isTopSheet(sheet:HTMLElement) { return orderedSheets().at(-1)===sheet; }

export function updateSheetCoverage(sheet:HTMLElement,coverage:Coverage) {
  const entry=sheets.get(sheet);
  if(!entry) return;
  entry.coverage=coverage;
  const active=orderedSheets().map(sheet=>sheets.get(sheet)!);
  const base=active[0]?.coverage;
  // Background Home/chat chrome is still physically behind the outer sheet.
  // A smaller child must never replace that mask or reset its header fade.
  if(base && hasNativeBridge()) postNativeMessage({version:1,action:"sheetCoverage",payload:{...base,
    dimming:1-active.reduce((light,entry)=>light*(1-(entry.coverage?.dimming ?? 0)),1)}});
}

/** A departing child restores its still-mounted parent instead of clearing it. */
export function registerSheetCoverage(sheet:HTMLElement,refresh:()=>void) {
  sheets.set(sheet,{refresh});
  window.dispatchEvent(new Event("decisionFeed:sheetLayout"));
  return () => {
    sheets.delete(sheet);
    const next=orderedSheets().at(-1);
    if(next) sheets.get(next)?.refresh();
    else if(hasNativeBridge()) postNativeMessage({version:1,action:"sheetCoverage",payload:{ended:true}});
    window.dispatchEvent(new Event("decisionFeed:sheetLayout"));
  };
}
