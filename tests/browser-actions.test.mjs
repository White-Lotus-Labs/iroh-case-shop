import test from 'node:test';
import assert from 'node:assert/strict';
import { walletActions, matchesOwner } from '../scripts/multi-case/browser-actions.mjs';

test('exact account creation keeps the dedicated new key and five NEAR deposit', () => {
  assert.deepEqual(walletActions([{type:'CreateAccount'}, {type:'Transfer',deposit:'5000000000000000000000000'}, {type:'AddKey', publicKey:'ed25519:public',permission:'FullAccess'}]), [{type:'CreateAccount'}, {type:'Transfer',params:{deposit:'5000000000000000000000000'}}, {type:'AddKey',params:{publicKey:'ed25519:public',accessKey:{nonce:0,permission:'FullAccess'}}}]);
});
test('function calls preserve literal args, gas and deposits', () => {
  assert.deepEqual(walletActions([{type:'FunctionCall',methodName:'set_paused',args:{paused:true},gas:'30000000000000',deposit:'1'}]), [{type:'FunctionCall',params:{methodName:'set_paused',args:{paused:true},gas:'30000000000000',deposit:'1'}}]);
  assert.throws(()=>walletActions([{type:'DeployContract'}]));
});
test('wallet accounts must all match the existing owner and any returned public key', () => {
  const key='ed25519:approved';
  assert.equal(matchesOwner([{accountId:'needmore_1_near.testnet',publicKey:key}],key),true);
  assert.equal(matchesOwner([{accountId:'needmore_1_near.testnet'}],key),true);
  for(const accounts of [[],[{accountId:'other.testnet'}],[{accountId:'needmore_1_near.testnet',publicKey:'wrong'}]]) assert.equal(matchesOwner(accounts,key),false);
});
