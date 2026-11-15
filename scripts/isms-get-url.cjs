const fs=require('fs'), crypto=require('crypto'), https=require('https');
const token=fs.readFileSync('/tmp/isms_rev/token.txt','utf8').trim();
const pem=JSON.parse(fs.readFileSync('/tmp/isms_rev/pubkey.json','utf8')).publicKey;
const orderId=process.argv[2];
const rel='/api/user/recharge-url?order_id='+orderId;
const abs='https://www.i-sms.app'+rel;

function buildHeader(urlForHash){
  const aesKey=crypto.randomBytes(32);
  const h=crypto.createHash('sha256').update(urlForHash).digest('hex');
  const t=Date.now();
  const payload=JSON.stringify({k:aesKey.toString('base64'),t,h});
  const enc=crypto.publicEncrypt({key:crypto.createPublicKey(pem),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(payload));
  return {header:enc.toString('base64'),aesKey};
}
function get(url,header){
  return new Promise(res=>{
    const u=new URL(url);
    https.request({hostname:u.hostname,path:u.pathname+u.search,method:'GET',headers:{'Accept':'application/json','Authorization':'Bearer '+token,'User-Agent':'Mozilla/5.0','X-Encryption-Key':header}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}))}).on('error',e=>res({status:0,body:String(e.message)})).end();
  });
}
function dec(respStr,key){
  try{
    const r=JSON.parse(respStr);
    if(!r.iv||!r.encrypted) return r;
    const iv=Buffer.from(r.iv,'base64'), d=Buffer.from(r.encrypted,'base64');
    const c=crypto.createDecipheriv('aes-256-gcm',key,iv); c.setAuthTag(d.slice(-16));
    return JSON.parse(Buffer.concat([c.update(d.slice(0,-16)),c.final()]).toString('utf8'));
  }catch(e){ return {decryptError:e.message, raw:respStr.slice(0,120)}; }
}
(async()=>{
  for(const [name,hashUrl] of [['rel',rel],['abs',abs]]){
    const {header,aesKey}=buildHeader(hashUrl);
    const r=await get(abs,header);
    const out=dec(r.body,aesKey);
    process.stdout.write(name+' hashUrl='+hashUrl+'\n  -> '+JSON.stringify(out).slice(0,300)+'\n');
  }
})();
