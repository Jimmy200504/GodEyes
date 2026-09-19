import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { Quaternion, Vector3 } from 'three';
const source = await readFile(new URL('../src/utils/renderPose.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const js = outputText.replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`);
const { RenderPoseSmoother } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const pose = (x, yaw = 0) => { const q = new Quaternion().setFromAxisAngle(new Vector3(0,1,0), yaw);
  return { x:.5,y:.5,z:1,position:{x,y:0,z:0},orientation:{x:q.x,y:q.y,z:q.z,w:q.w} }; };
const q = p => new Quaternion(...['x','y','z','w'].map(k=>p.orientation[k]));

test('each render frame advances between 20 Hz measurements without overshoot', () => {
 const f = new RenderPoseSmoother(); f.setTarget(pose(0),0); f.step(0); f.setTarget(pose(1),0);
 let prev=0;
 for(let i=1;i<=3;i++){const next=f.step(i*1000/60).position.x;assert.ok(next>prev&&next<1);prev=next;}
 assert.ok(prev>.85);
});
test('60 and 120 Hz produce equivalent position and rotation at equal elapsed time', () => {
 const run=hz=>{const f=new RenderPoseSmoother();f.setTarget(pose(0),0);f.setTarget(pose(1,1),0);
 let p;for(let i=1;i<=hz/10;i++)p=f.step(i*1000/hz);return p;};
 const a=run(60),b=run(120);assert.ok(Math.abs(a.position.x-b.position.x)<1e-10);assert.ok(q(a).angleTo(q(b))<1e-5);
});
test('loss freezes the DISPLAYED pose, reacquisition starts there, and stale frames cannot drift',()=>{
 const f=new RenderPoseSmoother();f.setTarget(pose(0),0);f.setTarget(pose(1),0);const held=f.step(16);
 f.hold();assert.deepEqual(f.step(100),held);f.setTarget(pose(2),200);assert.deepEqual(f.step(200),held);
 const next=f.step(216);assert.ok(next.position.x>held.position.x&&next.position.x<2);
 assert.deepEqual(f.step(451),next);assert.deepEqual(f.step(1000),next);
});
test('quaternion wraparound follows shortest arc and stays normalized',()=>{
 const f=new RenderPoseSmoother();const a=pose(0,179*Math.PI/180);f.setTarget(a,0);f.setTarget(pose(0,-179*Math.PI/180),0);
 const out=f.step(16);assert.ok(q(out).angleTo(q(a))<2*Math.PI/180);assert.ok(Math.abs(q(out).length()-1)<1e-10);
});
test('toggle bypasses smoothing; reset establishes a new origin without interpolating old coordinates',()=>{
 const f=new RenderPoseSmoother();f.setTarget(pose(0),0);f.setTarget(pose(1),0);f.enabled=false;
 assert.equal(f.step(16).position.x,1);f.hold();f.enabled=true;assert.equal(f.step(32).position.x,1);
 f.reset();f.setTarget(pose(0),40);assert.equal(f.step(40).position.x,0);
});


test('background tab resume bounds movement even if fresh targets kept arriving',()=>{
 const f=new RenderPoseSmoother();f.setTarget(pose(0),0);f.step(0);
 f.setTarget(pose(1),1000);const out=f.step(1000);
 assert.ok(out.position.x>0&&out.position.x<.9);
});

test('optional rotation prediction follows source-time velocity and expires without drifting',()=>{
 const f=new RenderPoseSmoother();f.enabled=false;f.predictionEnabled=true;
 f.setTarget({...pose(0,0),sampleTimeMs:0},1000);f.step(1000);
 f.setTarget({...pose(1,.1),sampleTimeMs:50},1070);
 const predicted=f.step(1095);
 assert.ok(q(predicted).angleTo(q(pose(0,.15)))<1e-5);
 assert.equal(predicted.position.x,1); // rotation only, no invented translation
 f.coast();const held=f.step(1169);f.coast();
 assert.deepEqual(f.step(1170),held);assert.deepEqual(f.step(2000),held);
});
test('hard hold, reset and large source-time gaps discard prediction velocity',()=>{
 const f=new RenderPoseSmoother();f.enabled=false;f.predictionEnabled=true;
 f.setTarget({...pose(0),sampleTimeMs:0},0);f.setTarget({...pose(0,.1),sampleTimeMs:50},50);
 const held=f.step(60);f.hold();assert.deepEqual(f.step(90),held);
 f.setTarget({...pose(0,.2),sampleTimeMs:100},100);
 assert.ok(q(f.step(125)).angleTo(q(pose(0,.2)))<1e-5);
 f.setTarget({...pose(0,.4),sampleTimeMs:500},500);
 assert.ok(q(f.step(550)).angleTo(q(pose(0,.4)))<1e-5);
 f.reset();f.setTarget(pose(0),600);assert.ok(q(f.step(620)).angleTo(q(pose(0)))<1e-5);
});
test('prediction respects remaining freshness and quaternion wraparound',()=>{
 const f=new RenderPoseSmoother();f.enabled=false;f.predictionEnabled=true;
 f.setTarget(pose(0,179*Math.PI/180),0);f.setTarget(pose(0,-179*Math.PI/180),50,20);
 const out=f.step(60);assert.ok(q(out).angleTo(q(pose(0,-178.6*Math.PI/180)))<1e-5);
 assert.deepEqual(f.step(70),out);assert.deepEqual(f.step(100),out);
});
