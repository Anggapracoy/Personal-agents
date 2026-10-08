import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

function block(source:string,signature:string){
 const start=source.indexOf(signature);assert.ok(start>=0,signature);
 const opening=source.indexOf('{',start);let depth=0;
 for(let index=opening;index<source.length;index++){
  if(source[index]==='{')depth++;
  if(source[index]==='}'&&--depth===0)return source.slice(start,index+1);
 }
 throw new Error(`Unclosed Swift block: ${signature}`);
}
test('native headers acknowledge identities once and composer/navigation publish complete snapshots once',{skip:process.platform!=='darwin'},()=>{
 const model=readFileSync('ios/DecisionFeed/Web/BrowserModel.swift','utf8');
 const views=readFileSync('ios/DecisionFeed/Views/RootView.swift','utf8');
 const types=['NativeHomeHeaderState','NativeChatHeaderState','NativeComposerState','NativeDraftFile'].map(name=>block(views,`struct ${name}`)).join('\n')+'\n'+block(model,'struct NativeChromeFrame');
 const methods=['updateHomeHeader','updateChatHeader','updateComposer','updateNavigationFrame'].map(name=>block(model,`func ${name}(`)).join('\n');
 const swift=`import Foundation
 import CoreGraphics
 struct UIImage { static var decodes=0; init?(systemName:String) {}
 init?(data:Data){Self.decodes+=1}
 func preparingThumbnail(of size:CGSize)->UIImage?{self}
 }
 ${types}
 struct CachedAvatar {
 let image:String
 private static var cachedSource=""
 private static var cachedPhoto:UIImage?
 ${block(views,'private var embeddedImage:')}
 func photo()->UIImage?{embeddedImage}
 }
 final class Harness {
 var headerWrites=0;var chatWrites=0;var composerWrites=0;var frameWrites=0;var acknowledgements=0
 var homeHeader:NativeHomeHeaderState? {didSet{headerWrites+=1}}
 var cachedHomeHeader:NativeHomeHeaderState?
 var chatHeader:NativeChatHeaderState? {didSet{chatWrites+=1}}
 var departingChatHeader:NativeChatHeaderState?
 var departingHomeHeader:NativeHomeHeaderState?
 var composer:NativeComposerState? {didSet{composerWrites+=1}}
 var homeComposer:NativeComposerState?;var departingComposer:NativeComposerState?
 var sentComposer:(id:String,text:String)?
 var chromeFrame=NativeChromeFrame() {didSet{frameWrites+=1}}
 var composerOffset:CGFloat {get{chromeFrame.composerOffset}set{if chromeFrame.composerOffset != newValue{chromeFrame.composerOffset=newValue}}}
 var navigationInFlight=false;var navigationDragging=false;var navigationPushing=true;var navigationFromLeft=false
 var preserveSendKeyboard=false;var focusNextThreadComposer=false;var departingComposerOnTop=false;var composerDismissal=0
 var dismissedChatHeaderIDs=Set<String>()
 func homeHeaderAction(id:String,action:String){acknowledgements+=1}
 func chatHeaderAction(id:String,action:String){acknowledgements+=1}
 func rememberDismissedChatHeader(_ id:String){dismissedChatHeaderIDs.insert(id)}
 ${methods}
 }
 for _ in 0..<100 {assert(CachedAvatar(image:"data:image/png;base64,YQ==").photo() != nil)}
 assert(UIImage.decodes==1)
 assert(CachedAvatar(image:"data:image/png;base64,Yg==").photo() != nil)
 assert(UIImage.decodes==2)
 for _ in 0..<100 {assert(CachedAvatar(image:"data:image/png;base64,***").photo()==nil)}
 assert(UIImage.decodes==2)
 let h=Harness()
 let button:(String)->[String:Any]={ ["action":$0,"label":$0,"x":0.0,"y":0.0,"width":44.0,"height":44.0] }
 var header:[String:Any]=["id":"home","buttons":[button("archive"),button("search")]]
 for _ in 0..<100 { h.updateHomeHeader(header) }
 assert(h.headerWrites==1 && h.acknowledgements==1)
 header["searching"]=true;h.updateHomeHeader(header)
 assert(h.headerWrites==2 && h.acknowledgements==1)
 header["registrationId"]="home-rebound";h.updateHomeHeader(header)
 for _ in 0..<100 {h.updateHomeHeader(header)}
 assert(h.headerWrites==3 && h.acknowledgements==2)
 let rect:[String:Any]=["x":0.0,"y":0.0,"width":44.0,"height":44.0]
 let chat:[String:Any]=["id":"chat","title":"Trip","back":rect,"label":rect]
 for _ in 0..<100 {h.updateChatHeader(chat)}
 assert(h.chatWrites==1 && h.acknowledgements==3)
 h.dismissedChatHeaderIDs.insert("chat");h.updateChatHeader(chat);assert(h.chatWrites==1)
 let composer:[String:Any]=["id":"composer","variant":"home","value":"draft","replyName":"Mom","replyText":"Dinner","draftFiles":[["id":"file","name":"photo.png"]],"sendMotionSamples":[[0.0,0.0,0.0],[1.0,1.0,1.0]]]
 for _ in 0..<100 {h.updateComposer(composer)}
 assert(h.composerWrites==1 && h.composer?.replyName=="Mom" && h.composer?.draftFiles.count==1)
 let frame:[String:Any]=["phase":"frame","incoming":80.0,"outgoing":-240.0,"opacity":0.7]
 h.updateNavigationFrame(frame)
 assert(h.frameWrites==1 && h.chromeFrame.composerOffset==80 && h.chromeFrame.departingComposerOffset == -240)
 for _ in 0..<100 {h.updateNavigationFrame(frame)}
 assert(h.frameWrites==1)
 h.updateNavigationFrame(["phase":"end"])
 assert(h.frameWrites==2 && h.chromeFrame.composerOffset==0 && h.chromeFrame.composerOpacity==1)

 let navigation=Harness()
 navigation.updateHomeHeader(header)
 navigation.updateComposer(composer)
 navigation.updateNavigationFrame(["phase":"begin"])
 assert(navigation.departingComposer?.text=="draft" && navigation.composer==nil)
 navigation.updateComposer(["id":"thread","variant":"thread","value":"reply"])
 navigation.updateNavigationFrame(["phase":"frame","incoming":0.0,"outgoing":-390.0])
 navigation.updateNavigationFrame(["phase":"end"])
 navigation.navigationPushing=false
 navigation.updateNavigationFrame(["phase":"drag","incoming":320.0,"outgoing":-40.0])
 assert(navigation.departingComposer?.text=="draft" && navigation.composer?.text=="reply")
 navigation.updateNavigationFrame(["phase":"begin"])
 assert(navigation.composer?.text=="draft" && navigation.departingComposer?.text=="reply")
 navigation.updateNavigationFrame(["phase":"end"])
 assert(navigation.composer?.text=="draft" && navigation.departingComposer==nil)
 print("native snapshot and identity checks passed")
 `;
 const directory=mkdtempSync(join(tmpdir(),'dash-chrome-native-'));
 try{const path=join(directory,'test.swift');writeFileSync(path,swift);const result=spawnSync('swift',[path],{encoding:'utf8',timeout:60000});assert.equal(result.status,0,result.stderr||result.stdout);}finally{rmSync(directory,{recursive:true,force:true});}
});
