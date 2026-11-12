export function walletActions(actions) {
  return actions.map(action => {
    if (action.type === 'CreateAccount') return {type:'CreateAccount'};
    if (action.type === 'Transfer') return {type:'Transfer',params:{deposit:action.deposit}};
    if (action.type === 'AddKey' && action.permission === 'FullAccess') return {type:'AddKey',params:{publicKey:action.publicKey,accessKey:{nonce:0,permission:'FullAccess'}}};
    if (action.type === 'FunctionCall') return {type:'FunctionCall',params:{methodName:action.methodName,args:action.args,gas:action.gas,deposit:action.deposit}};
    throw new Error('Unsupported approved browser action');
  });
}
export function matchesOwner(accounts, key) {
  return Array.isArray(accounts) && accounts.length > 0 && accounts.every(a => a.accountId === 'needmore_1_near.testnet' && (a.publicKey == null || a.publicKey === key));
}
