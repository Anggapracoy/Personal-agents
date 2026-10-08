/** Runs only in an explicitly authorized, interactable takeover stream. */
export const takeoverInputScript = String.raw`
 const controls=document.querySelector('.takeover-controls');controls.hidden=false;
 const ring=document.createElement('div');ring.className='takeover-pointer';ring.hidden=true;ring.setAttribute('aria-hidden','true');document.body.appendChild(ring);let ringTimer=null;
 const hideRing=()=>{clearTimeout(ringTimer);ring.hidden=true;};
 const showRing=(event,pressed)=>{if(!inputReady||stopped)return;clearTimeout(ringTimer);ring.hidden=false;ring.style.left=event.clientX+'px';ring.style.top=event.clientY+'px';ring.dataset.pressed=String(pressed);};
 let remoteCursor="", autoTypeUntil=0;
 let dragMode=false, pointer=null, pendingMove=null, moveFrame=0, pendingRelease=null;
 const send=(command,data)=>{if(stopped||!inputReady||!image.dataset.ready||socket?.readyState!==WebSocket.OPEN)return false;try{socket.send(JSON.stringify({command,data}));return true;}catch{return false;}};
 const point=event=>{const rect=image.getBoundingClientRect();const scale=Math.min(rect.width/image.width,rect.height/image.height);return {x:Math.max(0,Math.min(image.width,(event.clientX-rect.left-(rect.width-image.width*scale)/2)/scale)),y:Math.max(0,Math.min(image.height,(event.clientY-rect.top-(rect.height-image.height*scale)/2)/scale))};};
 const mouse=(type,p,button='none',extra={})=>send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button,clickCount:1,modifiers:0,...extra});
 const flush=()=>{cancelAnimationFrame(moveFrame);moveFrame=0;if(pendingMove){const {p,button}=pendingMove;pendingMove=null;mouse('mouseMoved',p,button);}};
 const mode=document.querySelector('[data-drag-mode]');mode.onclick=()=>{dragMode=!dragMode;mode.setAttribute('aria-label',dragMode?'Drag mode':'Scroll mode');mode.title=dragMode?'Switch to touch scrolling':'Switch to mouse dragging';mode.setAttribute('aria-pressed',String(dragMode));};
 image.tabIndex=0;
 image.addEventListener('pointerdown',event=>{if(!event.isPrimary||event.button!==0||!image.dataset.ready||!inputReady)return;event.preventDefault();showRing(event,true);image.focus();image.setPointerCapture(event.pointerId);pointer={id:event.pointerId,p:point(event),x:event.clientX,y:event.clientY,moved:false,held:event.pointerType!=='touch'||dragMode};if(pointer.held)mouse('mousePressed',pointer.p,'left',{buttons:1});});
 image.addEventListener('pointermove',event=>{if(event.isPrimary)showRing(event,Boolean(pointer));if(!pointer||pointer.id!==event.pointerId)return;event.preventDefault();const p=point(event);if(pointer.held){pendingMove={p,button:'left'};if(!moveFrame)moveFrame=requestAnimationFrame(flush);}else{pointer.moved ||= Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>5;if(pointer.moved)mouse('mouseWheel',p,'none',{deltaX:pointer.p.x-p.x,deltaY:pointer.p.y-p.y});}pointer.p=p;});
 const release=event=>{if(!pointer||pointer.id!==event.pointerId)return;event.preventDefault();flush();if(pointer.held)mouse('mouseReleased',pointer.p,'left',{buttons:0});else if(event.type==='pointerup'&&!pointer.moved){mouse('mousePressed',pointer.p,'left',{buttons:1});mouse('mouseReleased',pointer.p,'left',{buttons:0});autoTypeUntil=performance.now()+1200;if(remoteCursor==='text'||remoteCursor==='vertical-text')openKeyboard();}pointer=null;ring.dataset.pressed='false';if(event.pointerType==='touch')ringTimer=setTimeout(hideRing,500);};
 image.addEventListener('pointerleave',()=>{if(!pointer)hideRing();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)hideRing();});
 image.addEventListener('pointerup',release);image.addEventListener('pointercancel',release);image.addEventListener('lostpointercapture',release);
 image.addEventListener('wheel',event=>{event.preventDefault();mouse('mouseWheel',point(event),'none',{deltaX:event.deltaX,deltaY:event.deltaY});},{passive:false});
 const key=event=>{if(event.metaKey||event.ctrlKey){if(event.key.toLowerCase()==='v')return;}event.preventDefault();const modifiers=(event.altKey?1:0)|(event.ctrlKey?2:0)|(event.metaKey?4:0)|(event.shiftKey?8:0);const data={key:event.key,code:event.code,windowsVirtualKeyCode:event.keyCode,nativeVirtualKeyCode:event.keyCode,modifiers};send('Input.dispatchKeyEvent',{...data,type:'keyDown'});if(event.key.length===1&&!event.metaKey&&!event.ctrlKey)send('Input.dispatchKeyEvent',{...data,type:'char',text:event.key,unmodifiedText:event.key});send('Input.dispatchKeyEvent',{...data,type:'keyUp'});};
 image.addEventListener('keydown',key);image.addEventListener('paste',event=>{const content=event.clipboardData?.getData('text/plain');if(content){event.preventDefault();send('pasteClipboard',{content,type:'text'});}});
 const text=document.querySelector('[data-browser-text]'), keyboardButton=document.querySelector('[data-browser-type]');let lockedSize=null;
 text.addEventListener('focus',()=>keyboardButton.setAttribute('aria-pressed','true'));
 const openKeyboard=()=>{if(!inputReady||stopped)return;const rect=image.getBoundingClientRect();if(!lockedSize){lockedSize={width:rect.width,height:rect.height};image.style.width=rect.width+'px';image.style.height=rect.height+'px';}text.hidden=false;text.focus({preventScroll:true});window.webkit?.messageHandlers?.decisionFeedNative?.postMessage({version:1,action:'focusBrowserKeyboard',payload:{}});};
 const closeKeyboard=()=>{text.blur();text.hidden=true;};
 document.querySelector('[data-browser-type]').onclick=()=>{if(document.activeElement===text)closeKeyboard();else openKeyboard();};
 text.addEventListener('blur',()=>{keyboardButton.setAttribute('aria-pressed','false');text.hidden=true;setTimeout(()=>{if(document.activeElement!==text){image.style.width='';image.style.height='';lockedSize=null;}},250);});
 const insertText=()=>{if(text.value){send('pasteClipboard',{content:text.value,type:'text'});text.value='';}};
 text.addEventListener('input',event=>{if(!event.isComposing)insertText();});text.addEventListener('compositionend',insertText);
 text.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key==='Backspace'||event.key==='Tab')key(event);});
 handleStreamEvent=data=>{if(data.command==='cursorChange'&&typeof data.data==='string'){remoteCursor=data.data;if(performance.now()<autoTypeUntil&&(remoteCursor==='text'||remoteCursor==='vertical-text'))openKeyboard();}};

 restoreInput=()=>{if(pendingRelease&&mouse('mouseReleased',pendingRelease,'left',{buttons:0}))pendingRelease=null;};
 releaseInput=()=>{closeKeyboard();autoTypeUntil=0;remoteCursor="";hideRing();if(pointer?.held&&!mouse('mouseReleased',pointer.p,'left',{buttons:0}))pendingRelease=pointer.p;pointer=null;pendingMove=null;cancelAnimationFrame(moveFrame);moveFrame=0;};
`;
