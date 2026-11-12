import { NearConnector } from '@hot-labs/near-connect';
import { walletActions, matchesOwner } from './browser-actions.mjs';
const token=location.hash.slice(1);
const status=document.querySelector('#status');
const connect=document.querySelector('#connect');
const advance=document.querySelector('#advance');
const request=document.querySelector('#request');
const hashInput=document.querySelector('#hash');
const connector=new NearConnector({network:'testnet',features:{testnet:true,signInWithoutAddKey:true},autoConnect:false,providers:{testnet:['https://rpc.testnet.fastnear.com']}});
let wallet, state, requested=false;
const show=value=>status.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);
async function local(path,body={}) {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Iroh-Session':token},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error);
  return result;
}
function display(value) {
  state=value; show(value);
  const pending=state.entry && state.entry.status!=='blocked_signer';
  requested=Boolean(pending);
  const finished=state.complete || state.scope_complete;
  request.disabled=!wallet || requested || finished || state.step.signerId!=='needmore_1_near.testnet';
  advance.disabled=!wallet || requested || finished;
  if(state.entry?.tx_hash) hashInput.value=state.entry.tx_hash;
}
async function checkAccount(candidate=wallet) {
  if(candidate.manifest.id!=='meteor-wallet' || candidate.manifest.features?.testnet!==true) throw new Error('Meteor Testnet wallet required');
  const accounts=await candidate.getAccounts({network:'testnet'});
  if(!matchesOwner(accounts,state.owner_public_key)) throw new Error('Only the exact approved Testnet owner and existing public key may connect. Returned public accounts: '+JSON.stringify(accounts.map(({accountId,publicKey})=>({accountId,publicKey}))));
}
connect.onclick=async()=>{
  connect.disabled=true;
  try {
    state=await local('/state');
    // Uses the established no-add-key wallet connection. No private key is requested.
    try {wallet=await connector.wallet('meteor-wallet'); await checkAccount();}
    catch {wallet=await connector.connect({walletId:'meteor-wallet'}); await checkAccount();}
    display(await local('/state'));
  } catch(error){wallet=undefined;show(error.message);}
  finally{connect.disabled=false;}
};
advance.onclick=async()=>{
  advance.disabled=true; request.disabled=true;
  show('Checking the next exact step. Dedicated Keychain steps may run and finalize before the next owner request.');
  try {await checkAccount(); display(await local('/advance'));} catch(error){show(error.message);}
};
request.onclick=async()=>{
  request.disabled=true; advance.disabled=true; connect.disabled=true;
  try {
    if(requested || !wallet) throw new Error('Connect and reconcile any existing request first');
    await checkAccount();
    const prepared=await local('/request'); requested=true;
    show({message:'Review and approve this exact request in Meteor yourself. Do not repeat it if the response is lost.',...prepared});
    const transaction={...prepared.transaction,actions:walletActions(prepared.transaction.actions)};
    const result=await wallet.signAndSendTransaction(transaction);
    const hash=result?.transaction?.hash??result?.transaction_outcome?.id;
    if(typeof hash!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(hash)) throw new Error('Wallet returned no transaction hash. Reconcile wallet history; no automatic retry.');
    hashInput.value=hash;
    display(await local('/result',{hash}));
  } catch(error){show(error.message+' The request remains locked until its actual outcome is reconciled.');}
  finally{connect.disabled=false;}
};
document.querySelector('#verify').onclick=async()=>{
  try {display(await local('/result',{hash:hashInput.value.trim()}));} catch(error){show(error.message);}
};
local('/state').then(display).catch(error=>show(error.message));
