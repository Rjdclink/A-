import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {first,run,id,now} from './core.mjs';

const HOST=/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function secretKey(env){
 const supplied=env.INTEGRATION_MASTER_KEY;
 if(typeof supplied!=='string'||!/^[0-9a-f]{64}$/i.test(supplied))throw Error('Integration secret encryption is not configured');
 return Buffer.from(supplied,'hex');
}
export function validateConnection(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid connection');
 const {name,host,auth_type,secret}=input;
 if(typeof name!=='string'||name.trim().length<2||name.length>100)throw Error('Connection name must be 2-100 characters');
 if(typeof host!=='string'||host.length>253||!HOST.test(host)||host.includes('..'))throw Error('Connection requires a public API hostname');
 if(!['bearer','api_key'].includes(auth_type))throw Error('Choose bearer or API key authorization');
 if(typeof secret!=='string'||!secret.trim()||secret.length>4096||/[\r\n\0]/.test(secret))throw Error('Invalid API credential');
 return {name:name.trim(),host:host.toLowerCase(),auth_type,secret};
}
function seal(secret,tenant,connection,host,env){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secretKey(env),iv);
 cipher.setAAD(Buffer.from(`${tenant}|${connection}|${host}`));
 const value=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
 return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${value.toString('base64url')}`;
}
function open(stored,tenant,connection,host,env){
 const [a,b,c,...rest]=stored.split('.');if(rest.length||!a||!b||!c)throw Error('Encrypted credential is damaged');
 const decipher=createDecipheriv('aes-256-gcm',secretKey(env),Buffer.from(a,'base64url'));
 decipher.setAAD(Buffer.from(`${tenant}|${connection}|${host}`));
 decipher.setAuthTag(Buffer.from(b,'base64url'));
 return Buffer.concat([decipher.update(Buffer.from(c,'base64url')),decipher.final()]).toString('utf8');
}
export function addConnection(db,tenant,input,env){
 const value=validateConnection(input),connectionId=id(),stamp=now();
 const cipher=seal(value.secret,tenant,connectionId,value.host,env);
 run(db,'INSERT INTO connections(id,tenant_id,name,host,auth_type,secret_cipher,created_at) VALUES (?,?,?,?,?,?,?)',connectionId,tenant,value.name,value.host,value.auth_type,cipher,stamp);
 return {id:connectionId,name:value.name,host:value.host,auth_type:value.auth_type,created_at:stamp};
}
export function connectionHeaders(db,tenant,connectionId,url,env){
 if(typeof connectionId!=='string'||!UUID.test(connectionId))throw Error('Invalid connection reference');
 const info=first(db,'SELECT * FROM connections WHERE id=? AND tenant_id=?',connectionId,tenant);
 if(!info)throw Error('Connection not found');
 if(new URL(url).hostname.toLowerCase()!==info.host)throw Error('Credential host does not match integration');
 const value=open(info.secret_cipher,tenant,info.id,info.host,env);
 return {headers:info.auth_type==='bearer'?{authorization:'Bearer '+value}:{'x-api-key':value},secret:value};
}
