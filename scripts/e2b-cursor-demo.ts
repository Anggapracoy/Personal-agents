import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {CLOUD_BROWSER_CONTROLLER} from '../lib/harness/browser/cloud-controller';
import {E2BSandboxProvider} from '../lib/harness/sandbox/e2b';
// Real Chromium in a disposable E2B sandbox. Synthetic controls only: no
// account profile, credentials, purchases or messages to other people.
// node --env-file=.env.local --import tsx scripts/e2b-cursor-demo.ts [output.mp4]
const sandbox=new E2BSandboxProvider();
const output=process.argv[2]??'/tmp/dash-signature-arc-e2b.mp4';
try{
 await sandbox.create();
 await sandbox.writeFile('cursor-controller.py',new TextEncoder().encode(CLOUD_BROWSER_CONTROLLER));
 await sandbox.writeFile('cursor-demo.py',readFileSync(new URL('./fixtures/e2b-cursor-demo.py',import.meta.url)));
 const result=await sandbox.exec('python3 /workspace/cursor-demo.py',{timeoutMs:120000});
 console.log(result.stdout);if(result.exitCode)throw new Error(result.stderr||'E2B cursor recording failed');
 const dir=mkdtempSync('/tmp/dash-e2b-cursor-');
 try{
  writeFileSync(dir+'/frames.zip',await sandbox.readFile('out/cursor-frames.zip'));
  execFileSync('unzip',['-q',dir+'/frames.zip','-d',dir+'/frames']);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',dir+'/frames/frames.txt','-vf','format=yuv420p','-r','60','-c:v','libx264','-crf','18','-movflags','+faststart',output]);
 }finally{rmSync(dir,{recursive:true,force:true});}
 console.log(JSON.stringify({video:output,environment:'E2B Chromium',cleanup:'sandbox killed in finally'}));
}finally{await sandbox.destroy();}
