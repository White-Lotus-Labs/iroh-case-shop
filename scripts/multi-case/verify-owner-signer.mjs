import {spawnSync} from 'node:child_process';
import {randomBytes,createHash,createPublicKey,verify} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const account='needmore_1_near.testnet';
const key='ed25519:BntboZwnJtLVnBBh4XffXUDwbaygCsQiMmhWXD3xCi6';
const service='near-testnet-'+account;
const path=fileURLToPath(new URL('../../docs/multi-case/owner-signer-status.json',import.meta.url));
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(s){let n=0n;for(const c of s){const d=alphabet.indexOf(c);assert(d>=0);n=n*58n+BigInt(d);}let hex=n.toString(16);if(hex.length%2)hex='0'+hex;const b=n===0n?Buffer.alloc(0):Buffer.from(hex,'hex');return Buffer.concat([Buffer.alloc(s.length-s.replace(/^1+/,'').length),b]);}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;}
function string(s){const b=Buffer.from(s);return Buffer.concat([u32(b.length),b]);}
function publicObject(raw){assert.equal(raw.length,32);return createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw]),format:'der',type:'spki'});}
// RFC8032 public test vector: no private test material is involved.
assert(verify(null,Buffer.alloc(0),publicObject(Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex')),Buffer.from('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b','hex')));
function rpc(method,params){const r=spawnSync('curl',['--disable','-fsS','--retry','0','--max-time','25','--header','Content-Type: application/json','--data-binary','@-','https://rpc.testnet.fastnear.com'],{input:JSON.stringify({jsonrpc:'2.0',id:'iroh-signer-verification',method,params}),encoding:'utf8'});assert.equal(r.status,0,'Public RPC unavailable');const v=JSON.parse(r.stdout);assert(!v.error,'Public RPC returned an error');return v.result;}
function ownerAt(block){const keys=rpc('query',{request_type:'view_access_key_list',account_id:account,block_id:block});assert.equal(keys.keys.length,1,'Owner key set changed');const row=keys.keys[0];assert.equal(row.public_key,key);assert.equal(row.access_key.permission,'FullAccess');return row;}
const metadata=spawnSync('security',['find-generic-password','-s',service,'-a',account+':'+key],{encoding:'utf8'});assert.equal(metadata.status,0,'Exact public Keychain item not found');assert(metadata.stdout.includes('class: "genp"'));
assert.equal(rpc('status',[]).chain_id,'testnet');const before=rpc('block',{finality:'final'}).header;const beforeKey=ownerAt(before.hash);
const nonce=randomBytes(32);const recipient='iroh-keychain-verification.invalid';
const message='Iroh Case Shop local signer possession check only. Not authorization for a transaction, login, delegation or access change. '+new Date().toISOString();
const args=['--quiet','message','sign-nep413','utf8',message,'nonce',nonce.toString('base64'),'recipient',recipient,'sign-as',account,'sign-with-keychain','network-config','testnet'];
// Only the installed trusted CLI accesses Keychain internally. Never expose raw CLI output on failure.
const cli=spawnSync('/opt/homebrew/bin/near',args,{encoding:'utf8',timeout:240000,maxBuffer:1024*1024});
if(cli.status!==0){const state=JSON.parse(readFileSync(path));state.keychainEntryPresent=true;state.signerVerified=false;state.status='message_signing_failed';state.checkedAt=new Date().toISOString();writeFileSync(path,JSON.stringify(state,null,2)+'\n');throw new Error('NEP-413 signing did not return a public proof. Raw output was not displayed or saved.');}
let result;try{result=JSON.parse(cli.stdout);}catch{throw new Error('CLI did not return the expected public JSON proof. Raw output was not displayed or saved.');}
assert.equal(result.accountId,account,'Returned signer account mismatch');assert.equal(result.publicKey,key,'Returned signer public key mismatch');assert.match(result.signature,/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);const signature=base58(result.signature.slice(8));assert.equal(signature.length,64);
const payload=Buffer.concat([u32(2**31+413),string(message),nonce,string(recipient),Buffer.from([0])]);const digest=createHash('sha256').update(payload).digest();assert(verify(null,digest,publicObject(base58(key.slice(8))),signature),'NEP-413 signature does not verify under the required owner public key');
const after=rpc('block',{finality:'final'}).header;const afterKey=ownerAt(after.hash);assert.equal(afterKey.access_key.nonce,beforeKey.access_key.nonce,'Owner nonce changed during verification');
const state={checkedAt:new Date().toISOString(),network:'testnet',accountId:account,expectedPublicKey:key,onChainPermission:'FullAccess',onChainBlockHeight:after.height,onChainNonce:afterKey.access_key.nonce,keychainService:service,keychainAccount:account+':'+key,keychainEntryPresent:true,signerVerified:true,status:'verified_nep413_possession',secretsReadByAssistant:false,transactionsSubmittedDuringSetup:0,proof:{type:'NEP-413',message,nonceBase64:nonce.toString('base64'),recipient,callbackUrl:null,publicKey:result.publicKey,signature:result.signature,payloadSha256:digest.toString('hex'),signatureVerified:true,beforeBlock:before.height,afterBlock:after.height,nonceUnchanged:true}};
writeFileSync(path,JSON.stringify(state,null,2)+'\n');console.log(JSON.stringify({status:state.status,account,publicKey:key,permission:'FullAccess',signatureVerified:true,nonceUnchanged:true,transactionsSubmitted:0,blockHeight:after.height}));
