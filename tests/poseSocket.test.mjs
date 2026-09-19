import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const {outputText}=ts.transpileModule(await readFile(new URL('../src/utils/poseSocket.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {connectPoseSocket}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
function harness(run){
 const names=['performance','location','WebSocket','setTimeout','clearTimeout','setInterval','clearInterval'];
 const saved=Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let now=0,id=0;const timers=new Map(),sockets=[],poses=[],holds=[];
 const timer=(fn,ms)=>{timers.set(++id,{fn,ms});return id;};
 class Socket {constructor(url){this.url=url;sockets.push(this);this.sent=[];}send(value){this.sent.push(JSON.parse(value));}close(){this.onclose?.();}}
 const globals={performance:{now:()=>now},location:{href:'http://demo:5173/',protocol:'http:'},WebSocket:Socket,
 setTimeout:timer,setInterval:timer,clearTimeout:i=>timers.delete(i),clearInterval:i=>timers.delete(i)};
 for(const [k,value]of Object.entries(globals))Object.defineProperty(globalThis,k,{configurable:true,writable:true,value});
 try{const stop=connectPoseSocket((...args)=>poses.push(args),s=>holds.push(s),()=>{});
 run({sockets,poses,holds,timers,stop,time:t=>now=t,tick:ms=>{const entry=[...timers].find(([,t])=>t.ms===ms);assert.ok(entry);timers.delete(entry[0]);entry[1].fn();},
 message:(ws,seq,age=0)=>ws.onmessage({data:JSON.stringify({sent_monotonic_ms:now+10000,transport_rtt_ms:5,age_ms:age,pose:{seq,session_id:'s',map_id:'m',tracking:'tracking'}})})});
 stop();}finally{for(const k of names){if(saved[k])Object.defineProperty(globalThis,k,saved[k]);else delete globalThis[k];}}
}
test('pushes acknowledge receipt, skip duplicates and hold stale or silent streams',()=>harness(h=>{
 const ws=h.sockets[0];ws.onopen();h.message(ws,1);h.message(ws,1);assert.equal(h.poses.length,1);assert.equal(ws.sent.length,2);
 h.time(50);h.message(ws,2,300);assert.equal(h.poses.length,1);assert.ok(h.holds.length);
 h.time(100);h.message(ws,3);assert.equal(h.poses.length,2);h.time(351);h.tick(50);assert.match(h.holds.at(-1),/凍結/);
}));
test('disconnect reconnects without replay and cleanup cancels timers',()=>harness(h=>{
 const ws=h.sockets[0];ws.onopen();h.message(ws,1);ws.close();h.tick(500);assert.equal(h.sockets.length,2);
 const next=h.sockets[1];next.onopen();h.time(20);h.message(next,20);assert.equal(h.poses.at(-1)[0].seq,20);
 h.stop();assert.equal(h.timers.size,0);
}));
test('opening timeout reconnects and malformed data holds instead of moving',()=>harness(h=>{
 h.tick(1500);h.tick(500);const ws=h.sockets[1];ws.onopen();ws.onmessage({data:'not json'});
 assert.equal(h.poses.length,0);assert.ok(h.holds.length);assert.ok([...h.timers.values()].some(t=>t.ms===500));
}));
