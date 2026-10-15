const P=new URL('../../plugins/cyber/benchmarks/f3-workload-identity', import.meta.url).pathname;
const {buildWorld}=await import(`${P}/shared/estate.mjs`);
const F=['reconcile-hook','mutating-webhook','owner-reference']; const S=[2000,2001,2002,2003];
let fixed={0:0,1:0,2:0,3:0}, decoyWins=0, n=0;
for(const s of S)for(const f of F){const w=buildWorld({seed:s,family:f}); n++;
  const ri=w.stores.findIndex(st=>st.id===w.evaluator.reaching_store_id); fixed[ri]++;
  // decoy-exclusion guesser: existing object's store is never reaching; exclude it, then guess among the rest.
  const existingStore=w.objects[0].spec.secretStoreRef; const rest=w.stores.filter(st=>st.id!==existingStore);
  // best case for the guesser = reaching store is among 'rest' (always true) -> expected 1/|rest|
}
console.log('offense reaching-store index on the 12 specs:',JSON.stringify(fixed),
 '| best fixed-index reader =',Math.max(...Object.values(fixed))+'/12 =',(Math.max(...Object.values(fixed))/12).toFixed(2));
console.log('decoy-exclusion guesser expected =',(12/3)+'/12 = 1/3 (exclude the existing-object store, guess among 3)');
// min-index-twin over 20k seeds
const {buildDefenseCorpus}=await import(`${P}/shared/corpus.mjs`);
const {labelFlow,visibleFlow,visibleWorld,resolveCausalWriter}=await import(`${P}/shared/estate.mjs`);
let ep=0,insts=0;
for(const f of F)for(let s=8000;s<8000+20000/3;s++){const {world,flows}=buildDefenseCorpus(s,f);insts++;
  const vw=visibleWorld(world); const wlI=Object.fromEntries(vw.workloads.map((w,i)=>[w.principal,i]));
  const vfs=flows.map(visibleFlow);
  const twins=vfs.filter(vf=>vf.outcome==='completed-access'&&vf.causal_ref===2&&vfs.some(o=>o.object_ref.uid===vf.object_ref.uid&&o.causal_ref<vf.causal_ref));
  const widx=twins.map(vf=>wlI[resolveCausalWriter(world.audit,vf.object_ref.uid,vf.causal_ref)]??99);
  const minI=Math.min(...widx);
  let tp=0,fp=0,fn=0; for(let i=0;i<flows.length;i++){const vf=vfs[i]; const isTwin=vf.outcome==='completed-access'&&vf.causal_ref===2&&vfs.some(o=>o.object_ref.uid===vf.object_ref.uid&&o.causal_ref<vf.causal_ref); const pred=isTwin&&(wlI[resolveCausalWriter(world.audit,vf.object_ref.uid,vf.causal_ref)]??99)===minI; const truth=labelFlow(world,flows[i])==='cascade'; if(pred&&truth)tp++;else if(pred&&!truth)fp++;else if(!pred&&truth)fn++;}
  if(tp>=1&&fp===0&&fn===0)ep++;}
console.log(`min-index-twin over ${insts} instances: ${(100*ep/insts).toFixed(2)}% exact-pass (expect ~50%)`);
